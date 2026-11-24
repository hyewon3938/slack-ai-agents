/**
 * 신호 정의 로더 (pattern-verification에서 분리).
 */

import { query } from '../db.js';
import type { SignalDef, SignalDirection } from './types.js';

export interface SignalDefRow {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  source: 'seed' | 'llm';
  sql_body: string | null;
  value_type: 'binary' | 'continuous' | null;
  direction: SignalDirection | null;
  threshold: string | null;
  tag_name: string | null;
  window_days: number | null;
  domain: string | null;
  /** llm 신호 자작 라벨용 (#504 P2). seed 신호는 룰로 생성하므로 미사용. */
  description: string | null;
}

export const toSignalDef = (row: Omit<SignalDefRow, 'description'>): SignalDef => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  source: row.source,
  sqlBody: row.sql_body,
  valueType: row.value_type,
  direction: row.direction,
  threshold: row.threshold === null ? null : Number(row.threshold),
  tagName: row.tag_name,
  windowDays: row.window_days,
  domain: row.domain,
});

/** signal_defs(active만) id 집합 → 행. SELECT 단일 위치 — verifyUserLinks(라벨까지)·loadSignalDefsByIds 공용. */
export const querySignalDefRows = async (ids: number[]): Promise<SignalDefRow[]> => {
  if (ids.length === 0) return [];
  const res = await query<SignalDefRow>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days, domain, description
       FROM signal_defs
      WHERE id = ANY($1::int[]) AND status = 'active'`,
    [ids],
  );
  return res.rows;
};

/**
 * 신호 id 집합 → SignalDef 맵(active만). verifyUserLinks·scoreForecasts(예측 장부 채점, #531) 공용.
 * toSignalDef가 SignalDef 단일 진실 — 채점 측은 라벨 불요라 SignalDef만 받는다.
 */
export const loadSignalDefsByIds = async (ids: number[]): Promise<Map<number, SignalDef>> => {
  const rows = await querySignalDefRows(ids);
  return new Map(rows.map((r) => [r.id, toSignalDef(r)]));
};
