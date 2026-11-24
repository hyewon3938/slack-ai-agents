/**
 * 거울 신호 정의 보장 (pattern-verification에서 분리).
 */

import { query } from '../db.js';
import { findEquivalentSignal } from './signal-defs.js';
import type { SignalDefRow } from './load-signal-defs.js';
import type { SignalDirection } from './types.js';

// ─── 거울 신호 보장 (#555) ────────────────────────────────
// 역방향 종결(direction_mismatch)로 링크를 버릴 때 정보까지 버리지 않도록, 반대 방향 신호 "정의"를
// 보장한다. 신호 정의 생성은 측정 정의일 뿐 믿음이 아니다(ADR-0039 2층 분리) — 링크 생성·검증은
// 발굴 엔진(P5a)의 기존 게이트가 담당하므로 여기서 pattern_links는 만들지 않는다. 다음 주 발굴 스캔이
// (시드 × 거울신호) 쌍을 자연히 후보로 집어 올린다.

/** above_avg ↔ below_avg 반전. 그 외 direction은 반전 대상 아님(null). */
const mirrorDirection = (direction: SignalDirection | null): SignalDirection | null => {
  if (direction === 'above_avg') return 'below_avg';
  if (direction === 'below_avg') return 'above_avg';
  return null;
};

export type MirrorSignalOutcome = 'created' | 'exists' | 'skipped_rejected' | 'ineligible';

export interface MirrorSignalResult {
  outcome: MirrorSignalOutcome;
  /** 생성됐을 때만 non-null — 새 signal_defs.id. */
  mirrorSignalId: number | null;
}

/** 거울 신호 정의 INSERT(status='active') + 생성 로그. */
const insertMirrorSignal = async (
  userId: number,
  signalId: number,
  row: SignalDefRow,
  mirror: SignalDirection,
): Promise<MirrorSignalResult> => {
  const ins = await query<{ id: number }>(
    `INSERT INTO signal_defs
        (user_id, name, kind, sql_body, value_type, direction, threshold, domain, window_days, description, source, status)
     VALUES ($1, $2, 'sql', $3, $4, $5, $6, $7, $8, $9, 'seed', 'active')
     RETURNING id`,
    [
      userId,
      row.name,
      row.sql_body,
      row.value_type,
      mirror,
      row.threshold,
      row.domain,
      row.window_days,
      row.description ?? '',
    ],
  );
  const mirrorSignalId = ins.rows[0]?.id ?? null;
  console.warn(
    `[MirrorSignal] user=${userId} signal=${signalId} 거울 신호 생성(${row.name} ${row.direction}→${mirror}) id=${mirrorSignalId}`,
  );
  return { outcome: 'created', mirrorSignalId };
};

/**
 * 종결된 링크의 신호에 대해 반대 방향(above_avg↔below_avg) 신호 정의를 보장한다 (#555).
 *   - 대상: kind='sql' AND direction ∈ {above_avg, below_avg} 인 신호만.
 *     (above_abs/below_abs는 절대 임계라 반전이 임계 의미와 일치하지 않고, tag/flag_present는 방향이 없다 → ineligible.)
 *   - 거울 = 같은 (name, sql_body, threshold, domain, kind, source='seed')에 direction만 반전한 행.
 *   - 거울이 status IN ('active','pending')으로 이미 있으면 no-op('exists').
 *   - 기각 이력만 있으면(active/pending 없음) 생성 스킵('skipped_rejected', 로그) — 재기각을 되살리지 않는다.
 *   - 없으면 status='active'로 INSERT('created'). pattern_links는 만들지 않는다(발굴 엔진 위임).
 * INSERT 컬럼 구성은 signal_defs 기존 생성 경로(마이그 086 등)를 따른다.
 * user_id 가드 — 교차 유저 신호 생성 차단.
 */
export const ensureMirrorSignalDef = async (
  userId: number,
  signalId: number,
): Promise<MirrorSignalResult> => {
  const res = await query<SignalDefRow>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days, domain, description
       FROM signal_defs
      WHERE id = $1 AND user_id = $2`,
    [signalId, userId],
  );
  const row = res.rows[0];
  if (!row) return { outcome: 'ineligible', mirrorSignalId: null };

  const mirror = mirrorDirection(row.direction);
  if (row.kind !== 'sql' || row.source !== 'seed' || mirror === null || row.sql_body === null) {
    return { outcome: 'ineligible', mirrorSignalId: null };
  }

  // 같은 측정 정의(name·kind·threshold·sql) + 반전 direction 신호가 이미 있으면 재생성 금지 (#557 공통 가드).
  // NULL threshold는 IS NOT DISTINCT FROM으로 매칭. active/pending → 재사용(exists), rejected만 → 스킵.
  const eq = await findEquivalentSignal(userId, {
    name: row.name,
    kind: 'sql',
    direction: mirror,
    threshold: row.threshold === null ? null : Number(row.threshold),
    tagName: null,
    sqlBody: row.sql_body,
  });
  if (eq.decision === 'reuse') {
    return { outcome: 'exists', mirrorSignalId: null };
  }
  if (eq.decision === 'skip_rejected') {
    console.warn(
      `[MirrorSignal] user=${userId} signal=${signalId} 거울(${row.name} ${mirror}) 기각 이력만 존재 — 생성 스킵`,
    );
    return { outcome: 'skipped_rejected', mirrorSignalId: null };
  }

  return insertMirrorSignal(userId, signalId, row, mirror);
};
