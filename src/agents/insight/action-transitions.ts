/**
 * Insight 액션의 status 전이 코어 — Slack 호출 없이 DB만 바꾼다 (테스트 가능 코어).
 *
 * - 발굴 승인/패스: pending pattern_link → active/archived (#477 P5a, ADR-0039).
 * - LLM 신호 승인/반려: signal_defs(source=llm) pending → active/rejected (#477 P5b, ADR-0040).
 */

import { query } from '../../shared/db.js';
import { findEquivalentSignal } from '../../shared/pattern/signal-defs.js';
import { validateSignalSql } from '../../shared/pattern/signal-sql-guard.js';

// ─── 발굴 승인/패스 — pending pattern_link status 전이 (테스트 가능 코어) ──

/**
 * 발굴 후보 승인 — pending → active. 다음 주간 검증부터 off-day 대조 대상.
 * @returns 전이된 링크 id (pending 아님/타 유저면 null).
 */
export const approveDiscoveryLink = async (
  userId: number,
  linkId: number,
): Promise<number | null> => {
  const res = await query<{ id: number }>(
    `UPDATE pattern_links SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING id`,
    [linkId, userId],
  );
  return res.rows[0]?.id ?? null;
};

/**
 * 발굴 후보 패스 — pending → archived. 사용자 "추적 안 함"이지 통계 'rejected'(데이터 "연관 없음")가 아님.
 * 둘 다 여집합 제외라 재부상 안 함. @returns 전이된 링크 id (pending 아님/타 유저면 null).
 */
export const dismissDiscoveryLink = async (
  userId: number,
  linkId: number,
): Promise<number | null> => {
  const res = await query<{ id: number }>(
    `UPDATE pattern_links SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING id`,
    [linkId, userId],
  );
  return res.rows[0]?.id ?? null;
};

// ─── LLM 신호 승인/반려 — signal_defs(source=llm) status 전이 (테스트 가능 코어, ADR-0040) ──

/**
 * LLM 신호 승인 — 게이트 #1 정적 재검증 통과 시에만 pending → active (#477 P5b).
 * 저장된 sql_body도 불신: 승인 시점에 validateSignalSql 재실행, 실패하면 활성화 거부(미승인 = 실행 0).
 *
 * 재생성 가드(#557): monthly-signal-suggest routine(repo 밖)이 기각 이력이 있는 동일 정의를 다시
 * pending으로 INSERT할 수 있다 — SKILL 프롬프트가 그걸 걸러도 봇 승인 게이트가 최종 방어선이다.
 * 승격 직전 findEquivalentSignal(자신 제외)로 동일 측정 정의를 확인:
 *   - 다른 active/pending 동일 정의가 있으면 중복 활성화 거부(reuse).
 *   - rejected 동일 정의만 있으면 기각 재활성화 거부(skip_rejected) — 사람이 기각한 걸 조용히 되살리지 않는다.
 *
 * 가드: 본인(user_id=$2) + pending + source='llm'만. @returns 활성화된 signalId, 아니면 null.
 */
export const approveLlmSignal = async (
  userId: number,
  signalId: number,
): Promise<number | null> => {
  const sel = await query<{
    sql_body: string | null;
    name: string;
    kind: 'sql' | 'tag';
    direction: string | null;
    threshold: string | null;
    tag_name: string | null;
  }>(
    `SELECT sql_body, name, kind, direction, threshold, tag_name FROM signal_defs
       WHERE id = $1 AND user_id = $2 AND status = 'pending' AND source = 'llm'`,
    [signalId, userId],
  );
  const row = sel.rows[0];
  const sql = row?.sql_body;
  if (!row || !sql) return null;
  const err = validateSignalSql(sql);
  if (err) {
    console.warn(`[Insight Action] llm_signal 승인 거부(검증 실패) id=${signalId}: ${err}`);
    return null;
  }
  const eq = await findEquivalentSignal(
    userId,
    {
      name: row.name,
      kind: row.kind,
      direction: row.direction,
      threshold: row.threshold === null ? null : Number(row.threshold),
      tagName: row.tag_name,
      sqlBody: row.sql_body,
    },
    signalId,
  );
  if (eq.decision !== 'absent') {
    const why = eq.decision === 'reuse' ? '동일 정의 이미 활성/대기' : '기각 이력 재활성화 차단';
    console.warn(`[Insight Action] llm_signal 승인 거부(${why}) id=${signalId}`);
    return null;
  }
  const res = await query<{ id: number }>(
    `UPDATE signal_defs SET status = 'active', approved_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending' AND source = 'llm'
       RETURNING id`,
    [signalId, userId],
  );
  return res.rows[0]?.id ?? null;
};

/**
 * LLM 신호 반려 — pending → rejected. 동일 가드(본인·pending·llm). 재제안 시 LLM이 차이를 명시해야.
 * @returns 반려된 signalId, 아니면 null.
 */
export const rejectLlmSignal = async (userId: number, signalId: number): Promise<number | null> => {
  const res = await query<{ id: number }>(
    `UPDATE signal_defs SET status = 'rejected'
       WHERE id = $1 AND user_id = $2 AND status = 'pending' AND source = 'llm'
       RETURNING id`,
    [signalId, userId],
  );
  return res.rows[0]?.id ?? null;
};
