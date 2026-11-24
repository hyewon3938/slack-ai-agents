/**
 * Life Agent modify_db 확인 플로우 버튼 핸들러 (실행·취소).
 */

import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import { updateMessage } from '../../shared/slack.js';
import { queryWithRowLimit, dryRunAffectedRows } from '../../shared/db.js';
import {
  findActivePending,
  markExecuted,
  markCanceled,
  type PendingModifyRow,
} from '../../shared/pending-modify.js';
import { extractAffectedDates } from '../../shared/pending-display.js';
import { loadCurrentStateBlocks } from '../../shared/pending-current-state.js';
import { resolveBodyUserId, type ActionArgs } from './action-shared.js';

const CONFIRM_EXECUTE_TIMEOUT_MS = 10_000;
const CONFIRM_EXECUTE_MAX_ROWS = 50;

/** 확인된 modify_db SQL 실행 + 결과 메시지 갱신 */
const executePendingModify = async (
  client: WebClient,
  pending: PendingModifyRow,
  userId: number,
  channelId: string | undefined,
  messageTs: string | undefined,
): Promise<void> => {
  // 실행 전에 영향받을 row의 date를 dry-run으로 한 번 더 가져와
  // 실행 후 currentState 조회 범위를 정확히 맞춘다.
  let affectedDates: string[] = [];
  try {
    const pre = await dryRunAffectedRows(pending.sql_text, CONFIRM_EXECUTE_TIMEOUT_MS);
    affectedDates = extractAffectedDates(pre.rows);
  } catch {
    // dry-run 재실패해도 실행은 진행. affectedDates 없이 오늘 기준으로 표시.
  }

  const result = await queryWithRowLimit(
    pending.sql_text,
    CONFIRM_EXECUTE_TIMEOUT_MS,
    CONFIRM_EXECUTE_MAX_ROWS,
  );
  await markExecuted(pending.id);

  const summaryText = `✅ 실행 완료 — ${result.rowCount ?? 0}개 행 변경됐어.`;
  const blocks: KnownBlock[] = [{ type: 'section', text: { type: 'mrkdwn', text: summaryText } }];
  if (pending.table_name) {
    const state = await loadCurrentStateBlocks(pending.table_name, {
      userId,
      affectedDates,
    }).catch(() => null);
    if (state) {
      blocks.push({ type: 'divider' });
      blocks.push(...state.blocks);
    }
  }

  if (channelId && messageTs) {
    await updateMessage(client, channelId, messageTs, summaryText, blocks);
  }
};

/** modify_db 확인 플로우: 실행 */
export const handleConfirmModifyExecute = async ({
  ack,
  body,
  client,
}: ActionArgs): Promise<void> => {
  await ack();

  const action = 'actions' in body ? body.actions[0] : undefined;
  if (!action || !('value' in action)) return;
  const token = action.value;
  if (!token) return;

  const userId = await resolveBodyUserId(body);
  const pending = await findActivePending(token, userId);

  const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
  const messageTs = 'message' in body && body.message ? body.message.ts : undefined;

  if (!pending) {
    if (channelId && messageTs) {
      await updateMessage(
        client,
        channelId,
        messageTs,
        '이 요청은 만료됐거나 이미 처리됐어. 다시 요청해줘.',
        [],
      );
    }
    return;
  }

  try {
    await executePendingModify(client, pending, userId, channelId, messageTs);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Life Action] modify_db 실행 오류: ${msg}`);
    if (channelId && messageTs) {
      await updateMessage(client, channelId, messageTs, `실행 실패: ${msg}`, []);
    }
  }
};

/** modify_db 확인 플로우: 취소 */
export const handleConfirmModifyCancel = async ({
  ack,
  body,
  client,
}: ActionArgs): Promise<void> => {
  await ack();

  const action = 'actions' in body ? body.actions[0] : undefined;
  if (!action || !('value' in action)) return;
  const token = action.value;
  if (!token) return;

  const userId = await resolveBodyUserId(body);
  const pending = await findActivePending(token, userId);
  if (pending) await markCanceled(pending.id);

  const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
  const messageTs = 'message' in body && body.message ? body.message.ts : undefined;

  if (channelId && messageTs) {
    await updateMessage(client, channelId, messageTs, '취소했어. 아무것도 바뀌지 않았어.', []);
  }
};
