/**
 * Insight 에이전트 — Slack 일기 수정 (#639).
 * 수정 모달 private_metadata의 인코딩·디코딩과 원문 해시. DB·Slack 호출 없음.
 */

import { createHash } from 'node:crypto';

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
