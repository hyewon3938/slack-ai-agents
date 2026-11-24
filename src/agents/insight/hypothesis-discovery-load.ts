/**
 * 패턴 발굴 엔진의 입력 로딩 — active 신호 정의·이미 링크된 (시드, 신호) 쌍.
 */

import { query } from '../../shared/db.js';
import { type SignalDef } from '../../shared/pattern/types.js';
import { toSignalDef, type SignalDefRow } from '../../shared/pattern/load-signal-defs.js';

export interface LoadedSignal {
  def: SignalDef;
  description: string | null;
}

/** active 신호 전부 (description 동반 — 카드 평어용). */
export const loadActiveSignals = async (userId: number): Promise<LoadedSignal[]> => {
  const res = await query<SignalDefRow>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days, domain, description
       FROM signal_defs
      WHERE user_id = $1 AND status = 'active'
      ORDER BY id`,
    [userId],
  );
  return res.rows.map((r) => ({
    def: toSignalDef(r),
    description: r.description,
  }));
};

/** 이미 링크된 (시드, 신호) 쌍 — 모든 status. 여집합 제외 + rejected 재부상/중복 차단. */
export const loadLinkedPairs = async (userId: number): Promise<Set<string>> => {
  const res = await query<{ seed_id: number; signal_id: number }>(
    `SELECT seed_id, signal_id FROM pattern_links WHERE user_id = $1`,
    [userId],
  );
  return new Set(res.rows.map((r) => `${r.seed_id}:${r.signal_id}`));
};
