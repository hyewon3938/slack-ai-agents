/**
 * Insight 에이전트 — Slack 일기 조회·수정 핸들러 (#639).
 * "M/D 일기" 조회 메시지의 수정 버튼 → 모달 → 저장 → 조회 메시지 갱신 + 확인 문구.
 */

import type { App, SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { sendMessage, sendBlockMessage, updateMessage, postToChannel } from '../../shared/slack.js';
import { getTodayISO, getEffectiveTodayISO } from '../../shared/kst.js';
import { resolveUserId, DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import { backfillDiaryMetaTags, formatDiaryDateLabel } from './diary-fast-path.js';
import {
  DIARY_EDIT_ACTION_ID,
  DIARY_EDIT_VIEW_ID,
  DIARY_DATE_BLOCK_ID,
  DIARY_PART_BLOCK_PREFIX,
  buildDiaryLookupBlocks,
  buildDiaryEditModal,
  buildDiaryNotFoundModal,
  decodeDiaryEditMeta,
  readDiaryEditSubmission,
} from './diary-edit.js';
import {
  applyDiaryEdit,
  findDiaryEntryById,
  findDiaryEntryByDate,
  type DiaryEditResult,
} from './diary-edit-store.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const resolveActor = async (slackUserId: string): Promise<number> =>
  (slackUserId ? await resolveUserId(slackUserId) : null) ?? DEFAULT_USER_ID;

/** 일기 조회 응답. 일기가 있으면 수정 버튼을 붙인다. */
export const showDiary = async (say: SayFn, userId: number, date: string): Promise<void> => {
  const todayISO = getTodayISO();
  const label = formatDiaryDateLabel(date, todayISO);
  try {
    const entry = await findDiaryEntryByDate(userId, date);
    if (!entry) {
      const empty =
        date === getEffectiveTodayISO() ? '아직 오늘 일기가 없어.' : `${label} 일기는 없어.`;
      await sendMessage(say, empty);
      return;
    }
    const blocks = buildDiaryLookupBlocks(entry.id, entry.date, entry.content, todayISO);
    await sendBlockMessage(say, `${label} 일기`, blocks);
  } catch (error: unknown) {
    console.error('[Insight Agent] 일기 조회 오류:', error);
    await sendMessage(say, '일기 조회 중 오류가 발생했어.');
  }
};

/** 날짜 선택 검증. 미래 날짜(달력 기준 KST 오늘보다 뒤)는 받지 않는다. */
export const validateDiaryEditDate = (date: string | null, todayISO: string): string | null => {
  if (!date || !ISO_DATE_RE.test(date)) return '날짜를 골라줘.';
  if (date > todayISO) return '오늘보다 뒤 날짜로는 옮길 수 없어.';
  return null;
};

type Saved = Extract<DiaryEditResult, { kind: 'saved' }>;

export const formatDiaryEditConfirmation = (
  result: Saved,
  originalDate: string,
  todayISO: string,
): string => {
  const label = formatDiaryDateLabel(result.entry?.date ?? originalDate, todayISO);
  switch (result.action) {
    case 'unchanged':
      return '바뀐 게 없어서 그대로 뒀어.';
    case 'updated':
      return '고쳐뒀어.';
    case 'moved':
      return `${label} 일기로 옮겼어.`;
    case 'merged':
      return `${label} 일기 뒤에 이어 붙였어.`;
    case 'deleted':
      return `${label} 일기를 지웠어.`;
  }
};

/** 저장 뒤 처리: 메타 태그 재추출, 조회 메시지 갱신, 확인 문구 */
const afterDiaryEdit = async (
  client: WebClient,
  userId: number,
  result: Saved,
  meta: { date: string; channel: string; ts: string },
): Promise<void> => {
  const { entry } = result;
  if (entry && result.changedDates.includes(entry.date) && entry.date < getEffectiveTodayISO()) {
    void backfillDiaryMetaTags(userId, entry.date);
  }
  if (!meta.channel) return;

  const todayISO = getTodayISO();
  const confirmation = formatDiaryEditConfirmation(result, meta.date, todayISO);
  if (meta.ts && result.action !== 'unchanged') {
    const label = formatDiaryDateLabel(entry?.date ?? meta.date, todayISO);
    const blocks = entry
      ? buildDiaryLookupBlocks(entry.id, entry.date, entry.content, todayISO)
      : [
          {
            type: 'section' as const,
            text: { type: 'mrkdwn' as const, text: `${label} 일기는 지웠어.` },
          },
        ];
    await updateMessage(client, meta.channel, meta.ts, `${label} 일기`, blocks);
  }
  await postToChannel(client, meta.channel, confirmation);
};

const extractEntryId = (body: unknown): number | null => {
  const actions = (body as { actions?: Array<{ value?: unknown }> }).actions;
  const value = actions?.[0]?.value;
  const id = typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const registerDiaryEditActions = (app: App): void => {
  app.action(DIARY_EDIT_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const b = body as {
      trigger_id?: string;
      user?: { id?: string };
      channel?: { id?: string };
      message?: { ts?: string };
    };
    const entryId = extractEntryId(body);
    if (!b.trigger_id || entryId === null) return;
    try {
      const userId = await resolveActor(b.user?.id ?? '');
      const entry = await findDiaryEntryById(userId, entryId);
      const view = entry
        ? buildDiaryEditModal(
            {
              id: entry.id,
              date: entry.date,
              channel: b.channel?.id ?? '',
              ts: b.message?.ts ?? '',
            },
            entry.content,
          )
        : buildDiaryNotFoundModal();
      await client.views.open({ trigger_id: b.trigger_id, view });
    } catch (error: unknown) {
      console.error('[Insight Action] diary_edit_open 오류:', error);
    }
  });

  app.view(DIARY_EDIT_VIEW_ID, async ({ ack, body, view, client }) => {
    const meta = decodeDiaryEditMeta(view.private_metadata);
    if (!meta) {
      console.warn('[Insight Action] diary_edit_submit: metadata 디코딩 실패');
      await ack();
      return;
    }
    const submission = readDiaryEditSubmission(view.state.values, meta.joins);
    const dateError = validateDiaryEditDate(submission.date, getTodayISO());
    if (dateError || !submission.date) {
      await ack({ response_action: 'errors', errors: { [DIARY_DATE_BLOCK_ID]: dateError ?? '' } });
      return;
    }

    const contentBlock = `${DIARY_PART_BLOCK_PREFIX}0`;
    let userId: number;
    let result: DiaryEditResult;
    try {
      userId = await resolveActor(body.user.id);
      result = await applyDiaryEdit(userId, {
        entryId: meta.id,
        originalDate: meta.date,
        originalHash: meta.hash,
        newDate: submission.date,
        content: submission.content.trim(),
      });
    } catch (error: unknown) {
      console.error('[Insight Action] diary_edit_submit 저장 오류:', error);
      await ack({
        response_action: 'errors',
        errors: { [contentBlock]: '저장하다 오류가 났어. 다시 해줘.' },
      });
      return;
    }
    if (result.kind !== 'saved') {
      const message =
        result.kind === 'stale'
          ? '그사이 일기가 바뀌었어. 닫고 다시 열어줘.'
          : '이 일기를 찾을 수 없어. 날짜를 다시 조회해줘.';
      await ack({ response_action: 'errors', errors: { [contentBlock]: message } });
      return;
    }

    await ack();
    try {
      await afterDiaryEdit(client, userId, result, meta);
    } catch (error: unknown) {
      console.error('[Insight Action] diary_edit_submit 후처리 오류:', error);
    }
  });
};
