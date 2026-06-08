/**
 * 포화 시드 양방향 가드 (#508 P③, ADR-0046).
 *
 * 시드 트리거가 데이터-존재 윈도우 내 거의 매일 발현하면(활성률 ≥ saturationRate) off-day가 소멸해
 * off-day 대조 검정이 수학적으로 불가능해진다(#477 헌장 ②). 이는 "말 되는 후보냐"는 큐레이션 판단
 * (ADR-0039 사람 게이트)이 아니라 "검정 가능하냐"는 사실 → 자동 위생 대상.
 *
 *   - archive: 활성 시드의 트리거 활성률 ≥ saturationRate & 윈도우 ≥ saturationMinDays
 *     → active=false, archived_reason='saturation'(+ 링크 archive). 전부 가역.
 *   - revive(대칭): archived_reason='saturation' 시드를 현재 윈도우로 재계산(트리거 결정론이라 비활성
 *     이어도 활성 시리즈 산출) → 탈포화(활성률 < saturationRate)면 active=true, archived_reason=NULL 부활.
 *
 * archived_reason 스코프가 핵심: ②의 누적 시드(delegated_to_strength_band)·수동 archive는 부활 제외.
 * 강도 밴드는 상대 분위수라 ~33%씩 갈려 절대 포화 불가 → archive 대상에 안 걸림(②의 위임분이 다시 잡히지 않음).
 *
 * 포화 판정 입력은 트리거 발현(seed_daily_activations.trigger_activated) — matched(연결 매트릭 통과,
 * evidence-only 시드는 null)가 아니라 트리거 자체의 발현 빈도. off-day 대조의 활성/비활성 축과 일치.
 */

import { query } from './db.js';
import {
  buildWindowDates,
  computeSeedActivationSeries,
  computeUserDataStarts,
  seedDataStart,
} from './pattern-verification.js';
import {
  buildNameIdMap,
  type SajuSeed,
  type SajuSeedWithMetrics,
  type DailyContext,
} from './pattern-match.js';
import { seedLabel } from './insight-labels.js';
import { INSIGHT_THRESHOLDS } from './insight-thresholds.js';

const S = INSIGHT_THRESHOLDS.patternVerification;

/** ② 위임·수동 archive와 구분되는 ③ 포화 archive 사유 — 부활 대상 스코프. */
export const SATURATION_REASON = 'saturation';

/** 포화 판정: 윈도우 ≥ minDays & 트리거 활성률 ≥ rate (off-day 소멸 → 검정 불가). 소표본은 minDays가 막음. */
export const isSaturated = (activeRate: number, nDays: number): boolean =>
  nDays >= S.saturationMinDays && activeRate >= S.saturationRate;

/** 탈포화 판정(부활): 윈도우 ≥ minDays & 활성률 < rate (off-day 생김 → 다시 검정 가능). */
export const isDesaturated = (activeRate: number, nDays: number): boolean =>
  nDays >= S.saturationMinDays && activeRate < S.saturationRate;

export interface SweepSeed {
  id: number;
  /** 카드용 자연어 라벨 (변수명 노출 0 불변식, #506/ADR-0045). */
  label: string;
}

export interface SaturationSweepResult {
  archived: SweepSeed[];
  revived: SweepSeed[];
}

interface SatRow {
  id: number;
  name: string;
  description: string | null;
  n_eval: string;
  n_active: string;
}

/** 활성 시드의 트리거 활성률을 일별 핸드오프 로그로 집계(데이터-존재 = 기록된 일수). */
const detectSaturatedActive = async (userId: number, today: string): Promise<SweepSeed[]> => {
  const res = await query<SatRow>(
    `SELECT c.id, c.name, c.description,
            COUNT(*)::text AS n_eval,
            COUNT(*) FILTER (WHERE m.trigger_activated)::text AS n_active
       FROM pattern_catalog c
       JOIN seed_daily_activations m ON m.pattern_id = c.id
      WHERE c.user_id = $1 AND c.active = true
        AND m.date >= ($2::date - $3::int)
      GROUP BY c.id, c.name, c.description`,
    [userId, today, S.windowCapDays],
  );
  const out: SweepSeed[] = [];
  for (const r of res.rows) {
    const nEval = Number(r.n_eval);
    const nActive = Number(r.n_active);
    if (nEval <= 0) continue;
    const rate = nActive / nEval;
    if (isSaturated(rate, nEval)) {
      console.warn(
        `[Saturation] user=${userId} seed=${r.name} 활성률 ${(rate * 100).toFixed(0)}% (${nEval}일) → archive`,
      );
      out.push({ id: r.id, label: seedLabel({ name: r.name, description: r.description }) });
    }
  }
  return out;
};

interface ArchivedSeedRow {
  id: number;
  user_id: number;
  name: string;
  sipsin: string | null;
  description: string | null;
  trigger_target_type: SajuSeed['trigger_target_type'];
  trigger_target_id: number | null;
  trigger_aux: Record<string, unknown> | null;
  pillar_level: SajuSeed['pillar_level'];
  active: boolean;
  source: SajuSeed['source'];
}

/** 포화-archive 시드를 현재 윈도우로 재계산해 탈포화면 부활(트리거 결정론 — 비활성이어도 시리즈 산출). */
const reviveDesaturated = async (userId: number, today: string): Promise<SweepSeed[]> => {
  const res = await query<ArchivedSeedRow>(
    `SELECT id, user_id, name, sipsin, description,
            trigger_target_type, trigger_target_id, trigger_aux, pillar_level, active, source
       FROM pattern_catalog
      WHERE user_id = $1 AND active = false AND archived_reason = $2`,
    [userId, SATURATION_REASON],
  );
  if (res.rows.length === 0) return [];

  const windowDates = buildWindowDates(today, S.windowCapDays);
  const dataStarts = await computeUserDataStarts(userId);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);
  const ctxCache = new Map<string, DailyContext | null>();

  const out: SweepSeed[] = [];
  for (const row of res.rows) {
    try {
      const seed: SajuSeedWithMetrics = { ...row, metrics: [] };
      const activation = await computeSeedActivationSeries(
        seed,
        userId,
        windowDates,
        ctxCache,
        stemMap,
        branchMap,
      );
      const start = seedDataStart(seed, dataStarts);
      let nEval = 0;
      let nActive = 0;
      for (const [date, active] of activation) {
        if (start !== null && date < start) continue; // 데이터-존재 윈도우 밖(빈 과거) — ADR-0044
        nEval += 1;
        if (active) nActive += 1;
      }
      const rate = nEval > 0 ? nActive / nEval : 1;
      if (isDesaturated(rate, nEval)) {
        console.warn(
          `[Revive] user=${userId} seed=${row.name} 활성률 ${(rate * 100).toFixed(0)}% (${nEval}일) → 부활`,
        );
        out.push({
          id: row.id,
          label: seedLabel({ name: row.name, description: row.description }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Revive] 재계산 실패 seed=${row.name} id=${row.id}: ${msg}`);
    }
  }
  return out;
};

/**
 * 주간 포화 양방향 sweep — archive(검정 불가 시드 정리) + revive(탈포화 시드 복귀). 전부 가역.
 * 검증/발굴과 독립 격리(호출부 try/catch) — 실패해도 검증 카드는 무탈. 멱등(활성률 재산출).
 */
export const runSaturationSweep = async (
  userId: number,
  today: string,
): Promise<SaturationSweepResult> => {
  const archived: SweepSeed[] = [];
  for (const s of await detectSaturatedActive(userId, today)) {
    try {
      // active=true 가드로 멱등·경합 안전. 링크는 archived(가역) — 부활 시 발굴이 자연 재페어링.
      await query(
        `UPDATE pattern_catalog SET active = false, archived_reason = $3
          WHERE id = $1 AND user_id = $2 AND active = true`,
        [s.id, userId, SATURATION_REASON],
      );
      await query(
        `UPDATE pattern_links SET status = 'archived', updated_at = NOW()
          WHERE seed_id = $1 AND user_id = $2 AND status IN ('active', 'pending', 'weak', 'confirmed')`,
        [s.id, userId],
      );
      archived.push(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Saturation] archive 실패 seed=${s.id}: ${msg}`);
    }
  }

  const revived: SweepSeed[] = [];
  for (const s of await reviveDesaturated(userId, today)) {
    try {
      // 'saturation' 스코프 가드 — delegated·수동 archive는 절대 부활 안 함. 링크는 archived 유지.
      await query(
        `UPDATE pattern_catalog SET active = true, archived_reason = NULL
          WHERE id = $1 AND user_id = $2 AND active = false AND archived_reason = $3`,
        [s.id, userId, SATURATION_REASON],
      );
      revived.push(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Revive] 부활 실패 seed=${s.id}: ${msg}`);
    }
  }

  return { archived, revived };
};
