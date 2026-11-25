/**
 * Life Agent modify_db 확인 플로우 버튼 핸들러 (실행·취소).
 */

import type { KnownBlock } from '@slack/types';
import { updateMessage } from '../../shared/slack.js';
import { queryWithRowLimit, dryRunAffectedRows } from '../../shared/db.js';
import {
  findActivePending,
  claimPendingExecution,
  releasePendingExecution,
  markCanceled,
  type PendingModifyRow,
} from '../../shared/pending-modify.js';
import { extractAffectedDates, hasUndatedRow } from '../../shared/pending-display.js';
import { loadCurrentStateBlocks } from '../../shared/pending-current-state.js';
import { resolveBodyUserId, type ActionArgs } from './action-shared.js';

const CONFIRM_EXECUTE_TIMEOUT_MS = 10_000;
const CONFIRM_EXECUTE_MAX_ROWS = 50;
const EXPIRED_TEXT = '이 요청은 만료됐거나 이미 처리됐어. 다시 요청해줘.';
const ALREADY_HANDLED_TEXT = '이 요청은 만료됐거나 이미 처리돼서 취소할 게 없어.';

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 실행 결과: 바뀐 행 수 + 현재 상태 조회 범위(실행 전 dry-run 기준) */
interface ExecutionOutcome {
  rowCount: number;
  affectedDates: string[];
  hasBacklog: boolean;
}

/**
 * 선점한 pending의 SQL 실행. 실패하면 선점을 풀어 다시 시도할 수 있게 하고 예외를 다시 던진다.
 */
const runClaimedModify = async (pending: PendingModifyRow): Promise<ExecutionOutcome> => {
  // 실행 전에 영향받을 row의 date를 dry-run으로 한 번 더 가져와
  // 실행 후 currentState 조회 범위를 정확히 맞춘다.
  let affectedDates: string[] = [];
  let hasBacklog = false;
  try {
    const pre = await dryRunAffectedRows(pending.sql_text, CONFIRM_EXECUTE_TIMEOUT_MS);
    affectedDates = extractAffectedDates(pre.rows);
    hasBacklog = hasUndatedRow(pre.rows);
  } catch {
    // dry-run 재실패해도 실행은 진행. affectedDates 없이 오늘 기준으로 표시.
  }

  try {
    const result = await queryWithRowLimit(
      pending.sql_text,
      CONFIRM_EXECUTE_TIMEOUT_MS,
      CONFIRM_EXECUTE_MAX_ROWS,
    );
    return { rowCount: result.rowCount ?? 0, affectedDates, hasBacklog };
  } catch (err: unknown) {
    // 트랜잭션이 ROLLBACK돼 아무것도 바뀌지 않았으므로 선점을 되돌린다.
    await releasePendingExecution(pending.id).catch((releaseErr: unknown) => {
      console.error(`[Life Action] pending 선점 해제 실패: ${errorMessage(releaseErr)}`);
    });
    throw err;
  }
};

/** 실행 완료 메시지 블록 (현재 상태 조회 실패는 요약만 남긴다) */
const buildExecutedBlocks = async (
  pending: PendingModifyRow,
  userId: number,
  summaryText: string,
  outcome: ExecutionOutcome,
): Promise<KnownBlock[]> => {
  const blocks: KnownBlock[] = [{ type: 'section', text: { type: 'mrkdwn', text: summaryText } }];
  if (!pending.table_name) return blocks;
  const state = await loadCurrentStateBlocks(pending.table_name, {
    userId,
    affectedDates: outcome.affectedDates,
    hasBacklog: outcome.hasBacklog,
  }).catch(() => null);
  if (state) {
    blocks.push({ type: 'divider' });
    blocks.push(...state.blocks);
  }
  return blocks;
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
  const update = async (text: string, blocks: KnownBlock[]): Promise<void> => {
    if (channelId && messageTs) await updateMessage(client, channelId, messageTs, text, blocks);
  };

  // 실행 전에 원자적으로 선점해 같은 pending이 두 번 실행되지 않게 한다.
  let outcome: ExecutionOutcome;
  try {
    if (!pending || !(await claimPendingExecution(pending.id))) {
      await update(EXPIRED_TEXT, []);
      return;
    }
    outcome = await runClaimedModify(pending);
  } catch (err: unknown) {
    const msg = errorMessage(err);
    console.error(`[Life Action] modify_db 실행 오류: ${msg}`);
    await update(`실행 실패: ${msg}`, []);
    return;
  }

  // 여기부터는 SQL이 이미 반영된 상태다. 실패해도 "실행 실패"로 표시하지 않는다.
  const summaryText = `✅ 실행 완료 — ${outcome.rowCount}개 행 변경됐어.`;
  try {
    const blocks = await buildExecutedBlocks(pending, userId, summaryText, outcome);
    await update(summaryText, blocks);
  } catch (err: unknown) {
    console.error(`[Life Action] modify_db 실행 후 메시지 갱신 실패: ${errorMessage(err)}`);
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
  const canceled = pending ? await markCanceled(pending.id) : false;

  const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
  const messageTs = 'message' in body && body.message ? body.message.ts : undefined;

  if (channelId && messageTs) {
    const text = canceled ? '취소했어. 아무것도 바뀌지 않았어.' : ALREADY_HANDLED_TEXT;
    await updateMessage(client, channelId, messageTs, text, []);
  }
};
