/**
 * Insight 에이전트 — Slack 일기 수정 (#639).
 * 조회 메시지·수정 모달의 Block Kit 구성과 입력칸 나누기/다시 붙이기. DB·Slack 호출 없음.
 */

import { createHash } from 'node:crypto';
import type { KnownBlock, View } from '@slack/types';
import { resolveDiaryDate, formatDiaryDateLabel } from './diary-fast-path.js';

export const DIARY_EDIT_ACTION_ID = 'diary_edit_open';
export const DIARY_EDIT_VIEW_ID = 'diary_edit_submit';
export const DIARY_DATE_BLOCK_ID = 'diary_date';
export const DIARY_PART_BLOCK_PREFIX = 'diary_part_';
const DATE_ACTION_ID = 'date';
const TEXT_ACTION_ID = 'text';

/** Slack 입력칸·section 하나가 받는 최대 글자 수 */
export const SLACK_TEXT_MAX = 3000;
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

// ─── 입력칸 나누기 / 다시 붙이기 ──────────────────────────

/** 입력칸 사이 경계: 'n' = 원래 줄바꿈, 'c' = 바로 이어진 글 */
export type PartJoin = 'n' | 'c';

export interface DiaryParts {
  parts: string[];
  /** joins[i] = parts[i]와 parts[i+1] 사이 경계 */
  joins: PartJoin[];
}

/**
 * 자를 위치 보정. 서로게이트 쌍과 &amp; 같은 엔티티 중간을 자르지 않는다.
 * 엔티티가 아닌 &에서 앞당겨져도 조각이 조금 짧아질 뿐이다.
 */
const safeCut = (s: string, at: number): number => {
  const amp = s.lastIndexOf('&', at - 1);
  if (amp > at - 5 && amp > 0) {
    const semi = s.indexOf(';', amp);
    if (semi >= at && semi < amp + 5) return amp;
  }
  const code = s.charCodeAt(at - 1);
  return code >= 0xd800 && code <= 0xdbff ? at - 1 : at;
};

/**
 * 일기를 max자 이하 조각으로 나눈다. 줄 경계에서 나누고, max자를 넘는 줄만 글자 수로 자른다.
 * 빈 일기는 빈 조각 1개.
 */
export const splitDiaryContent = (content: string, max: number = SLACK_TEXT_MAX): DiaryParts => {
  const parts: string[] = [];
  const joins: PartJoin[] = [];
  let current: string | null = null;

  const flush = (join: PartJoin): void => {
    if (current === null) return;
    parts.push(current);
    joins.push(join);
    current = null;
  };

  for (const line of content.split('\n')) {
    if (current !== null && current.length + 1 + line.length <= max) {
      current += `\n${line}`;
      continue;
    }
    flush('n');
    let rest = line;
    while (rest.length > max) {
      const cut = safeCut(rest, max);
      parts.push(rest.slice(0, cut));
      joins.push('c');
      rest = rest.slice(cut);
    }
    current = rest;
  }
  parts.push(current ?? '');
  return { parts, joins };
};

/**
 * 입력칸 값을 경계 정보대로 다시 붙인다. 비운 입력칸은 경계째 건너뛴다.
 * 빈 칸 뒤에 오는 경계는 앞쪽 경계 중 줄바꿈을 우선한다.
 */
export const joinDiaryParts = (parts: string[], joins: PartJoin[]): string => {
  let out = '';
  let pending: PartJoin | null = null;
  parts.forEach((part, i) => {
    if (part !== '') {
      if (out !== '') out += pending === 'c' ? '' : '\n';
      out += part;
      pending = null;
    }
    const join = joins[i];
    if (join && out !== '') pending = pending === 'n' || join === 'n' ? 'n' : 'c';
  });
  return out;
};

// ─── 모달 metadata ──────────────────────────────────────

export interface DiaryEditMeta {
  /** diary_entries.id */
  id: number;
  /** 모달을 열 때의 날짜 */
  date: string;
  /** 모달을 열 때의 원문 해시 */
  hash: string;
  /** 조회 메시지 채널·ts (갱신용, 없을 수 있음) */
  channel: string;
  ts: string;
  /** 입력칸 경계 ('n'/'c' 나열) */
  joins: string;
}

export const hashDiaryContent = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 16);

export const encodeDiaryEditMeta = (meta: DiaryEditMeta): string => JSON.stringify(meta);

export const decodeDiaryEditMeta = (raw: string): DiaryEditMeta | null => {
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (
      typeof o.id !== 'number' ||
      typeof o.date !== 'string' ||
      typeof o.hash !== 'string' ||
      typeof o.channel !== 'string' ||
      typeof o.ts !== 'string' ||
      typeof o.joins !== 'string' ||
      !/^[nc]*$/.test(o.joins)
    ) {
      return null;
    }
    return { id: o.id, date: o.date, hash: o.hash, channel: o.channel, ts: o.ts, joins: o.joins };
  } catch {
    return null;
  }
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
