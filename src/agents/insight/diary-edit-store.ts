/**
 * Insight 에이전트 — Slack 일기 수정 저장 (#639).
 * 수정 모달 제출을 트랜잭션 하나로 반영하고, 원문이 바뀐 날짜의 메타 태그를 지운다 (ADR-0064).
 */

import type pg from 'pg';
import { queryOne, withTransaction } from '../../shared/db.js';
import { hashDiaryContent } from './diary-edit.js';

export interface DiaryEntryRow {
  id: number;
  date: string;
  content: string;
}

export interface DiaryEditInput {
  entryId: number;
  /** 모달을 열 때의 날짜·원문 해시 — 그사이 바뀌었으면 stale */
  originalDate: string;
  originalHash: string;
  newDate: string;
  content: string;
}

export type DiaryEditAction = 'unchanged' | 'updated' | 'moved' | 'merged' | 'deleted';

export type DiaryEditResult =
  | { kind: 'not_found' }
  | { kind: 'stale' }
  | {
      kind: 'saved';
      action: DiaryEditAction;
      /** 저장 뒤 남은 일기 (삭제면 null) */
      entry: DiaryEntryRow | null;
      /** 원문이 바뀌어 메타 태그를 지운 날짜 */
      changedDates: string[];
    };

export const findDiaryEntryByDate = (userId: number, date: string): Promise<DiaryEntryRow | null> =>
  queryOne<DiaryEntryRow>(
    `SELECT id, date, content FROM diary_entries WHERE user_id = $1 AND date = $2`,
    [userId, date],
  );

export const findDiaryEntryById = (
  userId: number,
  entryId: number,
): Promise<DiaryEntryRow | null> =>
  queryOne<DiaryEntryRow>(
    `SELECT id, date, content FROM diary_entries WHERE id = $1 AND user_id = $2`,
    [entryId, userId],
  );

type Saved = Extract<DiaryEditResult, { kind: 'saved' }>;

/** 다른 날짜로 옮긴다. 그 날짜에 일기가 있으면 뒤에 이어 붙이고 원래 행을 지운다. */
const moveEntry = async (
  client: pg.PoolClient,
  userId: number,
  current: DiaryEntryRow,
  newDate: string,
  content: string,
): Promise<Saved> => {
  const changedDates = [current.date, newDate];
  const target = await client.query<{ id: number; content: string }>(
    `SELECT id, content FROM diary_entries WHERE user_id = $1 AND date = $2 FOR UPDATE`,
    [userId, newDate],
  );
  const existing = target.rows[0];
  if (!existing) {
    await client.query(
      `UPDATE diary_entries SET date = $1, content = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      [newDate, content, current.id, userId],
    );
    return {
      kind: 'saved',
      action: 'moved',
      entry: { id: current.id, date: newDate, content },
      changedDates,
    };
  }
  const merged = `${existing.content}\n${content}`;
  await client.query(
    `UPDATE diary_entries SET content = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [merged, existing.id, userId],
  );
  await client.query(`DELETE FROM diary_entries WHERE id = $1 AND user_id = $2`, [
    current.id,
    userId,
  ]);
  return {
    kind: 'saved',
    action: 'merged',
    entry: { id: existing.id, date: newDate, content: merged },
    changedDates,
  };
};

/** 내용을 비웠으면 삭제, 날짜가 같으면 내용만, 다르면 이동·병합. */
const writeEdit = async (
  client: pg.PoolClient,
  userId: number,
  current: DiaryEntryRow,
  input: DiaryEditInput,
): Promise<Saved> => {
  if (input.content === '') {
    await client.query(`DELETE FROM diary_entries WHERE id = $1 AND user_id = $2`, [
      current.id,
      userId,
    ]);
    return { kind: 'saved', action: 'deleted', entry: null, changedDates: [current.date] };
  }
  if (input.newDate !== current.date) {
    return moveEntry(client, userId, current, input.newDate, input.content);
  }
  if (input.content === current.content) {
    return { kind: 'saved', action: 'unchanged', entry: current, changedDates: [] };
  }
  await client.query(
    `UPDATE diary_entries SET content = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [input.content, current.id, userId],
  );
  return {
    kind: 'saved',
    action: 'updated',
    entry: { ...current, content: input.content },
    changedDates: [current.date],
  };
};

/**
 * 수정 모달 제출 반영. 모든 쿼리에 user_id 조건을 건다.
 * 원문이 바뀐 날짜의 diary_meta_tags는 source와 상관없이 지운다 — 재추출은 호출부가 맡는다.
 */
export const applyDiaryEdit = (userId: number, input: DiaryEditInput): Promise<DiaryEditResult> =>
  withTransaction(async (client) => {
    const found = await client.query<DiaryEntryRow>(
      `SELECT id, date, content FROM diary_entries WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [input.entryId, userId],
    );
    const current = found.rows[0];
    if (!current) return { kind: 'not_found' };
    if (
      current.date !== input.originalDate ||
      hashDiaryContent(current.content) !== input.originalHash
    ) {
      return { kind: 'stale' };
    }

    const result = await writeEdit(client, userId, current, input);
    if (result.changedDates.length > 0) {
      await client.query(
        `DELETE FROM diary_meta_tags WHERE user_id = $1 AND date = ANY($2::date[])`,
        [userId, result.changedDates],
      );
    }
    return result;
  });
