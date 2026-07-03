/**
 * signal_defs 재생성 가드 — #557 (2026-07 감사 S7).
 *
 * 배경: 077이 pattern_metrics(시드별 행)를 signal_defs로 1:1 이관하며 동일 측정 신호가 시드 수만큼
 *   중복 생성됐고(085에서 dedup + active 부분 unique 인덱스로 정리), 이후에도 자동 생성 경로가
 *   "기각 이력이 있는 동일 정의"를 조용히 다시 만들 여지가 남았다. 같은 가설이 기각→재등장→기각
 *   루프를 돌면 승인 카드 피로 + 통계 가족 m-인플레이션을 만든다.
 *
 * findEquivalentSignal: 자동 생성 직전에 "이미 같은 측정을 하는 신호가 있는가"를 판정한다.
 *   - active/pending 동일 정의 존재 → 재사용(reuse) — 새 INSERT 금지.
 *   - rejected 동일 정의만 존재 → 스킵(skip_rejected) + warn — 기각의 의미를 보존(사람이 명시적으로
 *     재도전할 때만 되살린다).
 *   - 부재 → 생성 허용(absent).
 *
 * 동일성 기준(#555 ensureMirrorSignalDef 조회 기준과 일치): (name, direction, kind, threshold, tag_name)
 *   — NULL은 IS NOT DISTINCT FROM으로 매칭 — 에 더해 sql 신호는 sql_body 포함. user_id로 격리(교차 유저
 *   신호를 동일 정의로 오인하지 않게). source(seed/llm)는 판정에서 제외한다 — "무엇을 측정하는가"는
 *   측정 정의이지 누가 제안했는가가 아니다(같은 측정을 llm이 다시 제안해도 중복).
 *
 * 이 헬퍼는 앱(TS) 생성 경로의 방어선이다. monthly-signal-suggest routine(repo 밖)의 pending INSERT는
 * DB Proxy로 raw SQL이 들어오므로 이 헬퍼를 경유하지 않는다 — 그 경로는 봇 승인 게이트(approveLlmSignal)
 * + DB 부분 unique 인덱스가 최종 방어선이다.
 */

import { query } from './db.js';

/** 재생성 판정 대상 신호의 측정 정의. NULL 필드는 IS NOT DISTINCT FROM으로 매칭된다. */
export interface SignalIdentity {
  name: string;
  kind: 'sql' | 'tag';
  direction: string | null;
  threshold: number | null;
  tagName: string | null;
  /** sql 신호의 본문. tag 신호는 null. */
  sqlBody: string | null;
}

export type EquivalentDecision =
  /** active/pending 동일 정의가 이미 있다 — 재사용(새 INSERT 금지). */
  | { decision: 'reuse'; signalId: number; status: 'active' | 'pending' }
  /** rejected 동일 정의만 있다 — 생성 스킵(기각 의미 보존). */
  | { decision: 'skip_rejected' }
  /** 동일 정의 없음 — 생성 허용. */
  | { decision: 'absent' };

interface EquivalentRow {
  id: number;
  status: 'active' | 'pending' | 'rejected';
}

/**
 * 같은 측정 정의(SignalIdentity)를 가진 신호가 이미 있는지 판정한다 (#557).
 *   - active/pending이 있으면 그중 하나를 재사용 대상으로 반환(active 우선, 그다음 MIN id).
 *   - active/pending은 없고 rejected만 있으면 skip_rejected.
 *   - 하나도 없으면 absent.
 * user_id로 격리 — 교차 유저 신호는 동일 정의로 보지 않는다.
 * excludeId — 자기 자신 제외(승인 게이트에서 승격 대상 pending 행이 자신과 매칭되는 것 방지).
 */
export const findEquivalentSignal = async (
  userId: number,
  identity: SignalIdentity,
  excludeId?: number,
): Promise<EquivalentDecision> => {
  const res = await query<EquivalentRow>(
    `SELECT id, status FROM signal_defs
      WHERE user_id = $1
        AND name = $2
        AND kind = $3
        AND direction IS NOT DISTINCT FROM $4
        AND threshold IS NOT DISTINCT FROM $5
        AND tag_name IS NOT DISTINCT FROM $6
        AND sql_body IS NOT DISTINCT FROM $7
        AND ($8::int IS NULL OR id <> $8)`,
    [
      userId,
      identity.name,
      identity.kind,
      identity.direction,
      identity.threshold,
      identity.tagName,
      identity.sqlBody,
      excludeId ?? null,
    ],
  );
  const rows = res.rows;
  const reusable = rows
    .filter((r) => r.status === 'active' || r.status === 'pending')
    .sort((a, b) => {
      // active 우선, 그다음 MIN id — 재사용 대상 안정적 선택.
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return a.id - b.id;
    });
  const chosen = reusable[0];
  if (chosen) {
    return {
      decision: 'reuse',
      signalId: chosen.id,
      status: chosen.status as 'active' | 'pending',
    };
  }
  if (rows.length > 0) {
    // active/pending은 없고 rejected 이력만 존재 — 되살리지 않는다.
    return { decision: 'skip_rejected' };
  }
  return { decision: 'absent' };
};
