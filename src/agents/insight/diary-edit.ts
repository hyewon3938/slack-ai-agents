/**
 * Insight 에이전트 — Slack 일기 수정 (#639).
 * 조회 명령 해석, 조회 메시지·수정 모달의 Block Kit 구성, 제출 값 읽기. DB·Slack 호출 없음.
 */

import type { KnownBlock, View } from '@slack/types';
import { resolveDiaryDate, formatDiaryDateLabel } from './diary-fast-path.js';
import {
  SLACK_TEXT_MAX,
  splitDiaryContent,
  joinDiaryParts,
  type PartJoin,
} from './diary-edit-parts.js';
import { hashDiaryContent, encodeDiaryEditMeta, type DiaryEditMeta } from './diary-edit-meta.js';

export const DIARY_EDIT_ACTION_ID = 'diary_edit_open';
export const DIARY_EDIT_VIEW_ID = 'diary_edit_submit';
export const DIARY_DATE_BLOCK_ID = 'diary_date';
export const DIARY_PART_BLOCK_PREFIX = 'diary_part_';
const DATE_ACTION_ID = 'date';
const TEXT_ACTION_ID = 'text';

/** 마지막 입력칸이 이 길이를 넘으면 빈 입력칸을 하나 더 둔다 */
const EXTRA_INPUT_THRESHOLD = 2000;

// ─── 조회 명령 ───────────────────────────────────────────

/** 메시지 전체가 "M/D 일기"일 때만 조회 명령 */
const DIARY_LOOKUP_RE = /^(\d{1,2})\/(\d{1,2})\s*일기$/;

export type DiaryLookupParse =
  | { kind: 'none' }
  | { kind: 'date'; date: string }
  | { kind: 'invalid_date'; token: string };

/** @param todayISO 달력 기준 KST 오늘 — 날짜 지정 일기와 같은 기준 */
export const parseDiaryLookup = (text: string, todayISO: string): DiaryLookupParse => {
  const m = DIARY_LOOKUP_RE.exec(text);
  if (!m) return { kind: 'none' };
  const date = resolveDiaryDate(Number(m[1]), Number(m[2]), todayISO);
  if (!date) return { kind: 'invalid_date', token: `${m[1]}/${m[2]}` };
  return { kind: 'date', date };
};
// ─── Block Kit ──────────────────────────────────────────

const escapeMrkdwn = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 조회 메시지: 날짜 제목 + 본문(3000자 단위 section) + 수정 버튼 */
export const buildDiaryLookupBlocks = (
  entryId: number,
  date: string,
  content: string,
  todayISO: string,
): KnownBlock[] => {
  const title = `*${formatDiaryDateLabel(date, todayISO)} 일기*`;
  // 이스케이프한 뒤에 나눠야 section 글자 수 제한을 지킨다. 제목 몫을 남겨 둔다
  const { parts } = splitDiaryContent(escapeMrkdwn(content), SLACK_TEXT_MAX - title.length - 1);
  const sections: KnownBlock[] = parts.map((part, i) => ({
    type: 'section',
    text: { type: 'mrkdwn', text: i === 0 ? `${title}\n${part}` : part },
  }));
  return [
    ...sections,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: DIARY_EDIT_ACTION_ID,
          text: { type: 'plain_text', text: '수정' },
          value: String(entryId),
        },
      ],
    },
  ];
};

/** 수정 모달. 입력칸을 전부 비우고 저장하면 일기를 지운다. */
export const buildDiaryEditModal = (
  meta: Omit<DiaryEditMeta, 'joins' | 'hash'>,
  content: string,
): View => {
  const { parts, joins } = splitDiaryContent(content);
  const last = parts[parts.length - 1] ?? '';
  if (last.length > EXTRA_INPUT_THRESHOLD) {
    parts.push('');
    joins.push('n');
  }
  const multi = parts.length > 1;

  const inputs: KnownBlock[] = parts.map((part, i) => ({
    type: 'input',
    block_id: `${DIARY_PART_BLOCK_PREFIX}${i}`,
    optional: true,
    label: { type: 'plain_text', text: multi ? `내용 ${i + 1}/${parts.length}` : '내용' },
    element: {
      type: 'plain_text_input',
      action_id: TEXT_ACTION_ID,
      multiline: true,
      max_length: SLACK_TEXT_MAX,
      ...(part ? { initial_value: part } : {}),
    },
  }));

  const fullMeta: DiaryEditMeta = {
    ...meta,
    hash: hashDiaryContent(content),
    joins: joins.join(''),
  };

  return {
    type: 'modal',
    callback_id: DIARY_EDIT_VIEW_ID,
    private_metadata: encodeDiaryEditMeta(fullMeta),
    title: { type: 'plain_text', text: '일기 수정' },
    submit: { type: 'plain_text', text: '저장' },
    close: { type: 'plain_text', text: '취소' },
    blocks: [
      {
        type: 'input',
        block_id: DIARY_DATE_BLOCK_ID,
        label: { type: 'plain_text', text: '날짜' },
        element: { type: 'datepicker', action_id: DATE_ACTION_ID, initial_date: meta.date },
      },
      ...inputs,
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '내용을 전부 비우고 저장하면 이 날짜 일기를 지워.' }],
      },
    ],
  };
};

/** 일기를 찾지 못했을 때 띄우는 안내 모달 (저장 버튼 없음) */
export const buildDiaryNotFoundModal = (): View => ({
  type: 'modal',
  title: { type: 'plain_text', text: '일기 수정' },
  close: { type: 'plain_text', text: '닫기' },
  blocks: [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '이 일기를 찾을 수 없어. 날짜를 다시 조회해줘.' },
    },
  ],
});

// ─── 제출 값 읽기 ────────────────────────────────────────

type ViewStateValues = Record<
  string,
  Record<string, { value?: string | null; selected_date?: string | null }>
>;

export interface DiaryEditSubmission {
  date: string | null;
  content: string;
}

/** view.state.values에서 날짜와 다시 붙인 내용을 꺼낸다 */
export const readDiaryEditSubmission = (
  values: ViewStateValues,
  joins: string,
): DiaryEditSubmission => {
  const date = values[DIARY_DATE_BLOCK_ID]?.[DATE_ACTION_ID]?.selected_date ?? null;
  const parts: string[] = [];
  for (let i = 0; ; i++) {
    const block = values[`${DIARY_PART_BLOCK_PREFIX}${i}`];
    if (!block) break;
    parts.push(block[TEXT_ACTION_ID]?.value ?? '');
  }
  return { date, content: joinDiaryParts(parts, joins.split('') as PartJoin[]) };
};
