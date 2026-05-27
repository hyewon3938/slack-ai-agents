/**
 * 자동 패턴 발견 — 시드 × enum 전수 스캔으로 후보 가설 발굴.
 * ADR-0019 Phase 4.
 *
 * 두 모드:
 *   - setup: lookbackDays 윈도우 전체 → 1차 셋업 시 backtest CLI에서 호출
 *   - recurring: 전주만 → 주간 cron에서 호출, 이미 active/confirmed 가설은 자동 제외
 */

import { query } from '../../shared/db.js';
import { fisherExact, bhFdr, type TriggerSpec } from '../../shared/saju-hypothesis.js';
import { DIARY_META_TAGS, type DiaryMetaTag } from '../../cron/diary-meta-extract.js';

export type DiscoveryMode =
  | { mode: 'setup'; lookbackDays: number }
  | { mode: 'recurring'; weekStart: string };

export interface CandidateHypothesis {
  triggerSpec: TriggerSpec;
  signalName: string;
  enumTarget: DiaryMetaTag;
  nTriggerDays: number;
  nTotalDays: number;
  rateTrigger: number;
  rateBaseline: number;
  rateRatio: number;
  rawP: number;
  fdrQ: number;
}

const DISCOVERY_MIN_N = 5;
const DISCOVERY_MAX_RAW_P = 0.1;
const DISCOVERY_MAX_FDR_Q = 0.2;
const DISCOVERY_MIN_RATE_RATIO = 1.3;

interface ActiveSignal {
  id: number;
  name: string;
}

const loadActiveSignals = async (userId: number): Promise<ActiveSignal[]> => {
  const res = await query<{ id: number; name: string }>(
    `SELECT id, name FROM pattern_catalog
       WHERE user_id = $1 AND active = true
       ORDER BY id`,
    [userId],
  );
  return res.rows;
};

const loadRegisteredCombos = async (userId: number): Promise<Set<string>> => {
  const res = await query<{ trigger_spec: TriggerSpec; enum_target: string }>(
    `SELECT trigger_spec, enum_target FROM pattern_hypotheses
       WHERE user_id = $1 AND status IN ('active', 'confirmed')`,
    [userId],
  );
  return new Set(res.rows.map((r) => `${JSON.stringify(r.trigger_spec)}::${r.enum_target}`));
};

const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const resolveWindow = (mode: DiscoveryMode): { startDate: string; endDate: string } => {
  if (mode.mode === 'setup') {
    const today = new Date().toISOString().slice(0, 10);
    const startDate = shiftDate(today, -mode.lookbackDays);
    return { startDate, endDate: today };
  }
  const endDate = shiftDate(mode.weekStart, 6);
  return { startDate: mode.weekStart, endDate };
};

interface DayMap {
  triggerByDate: Map<number, Set<string>>;
  enumByDate: Map<string, Set<string>>;
  totalDays: number;
}

const loadDayMap = async (userId: number, startDate: string, endDate: string): Promise<DayMap> => {
  const triggerRes = await query<{ pattern_id: number; date: string }>(
    `SELECT pattern_id, TO_CHAR(date, 'YYYY-MM-DD') AS date
       FROM pattern_matches
      WHERE user_id = $1
        AND date >= $2 AND date <= $3
        AND trigger_activated = true`,
    [userId, startDate, endDate],
  );
  const enumRes = await query<{ tag: string; date: string }>(
    `SELECT tag, TO_CHAR(date, 'YYYY-MM-DD') AS date
       FROM diary_meta_tags
      WHERE user_id = $1 AND date >= $2 AND date <= $3`,
    [userId, startDate, endDate],
  );
  const dayCountRes = await query<{ days: string }>(
    `SELECT (DATE($2) - DATE($1) + 1)::TEXT AS days`,
    [startDate, endDate],
  );

  const triggerByDate = new Map<number, Set<string>>();
  for (const row of triggerRes.rows) {
    const set = triggerByDate.get(row.pattern_id) ?? new Set();
    set.add(row.date);
    triggerByDate.set(row.pattern_id, set);
  }
  const enumByDate = new Map<string, Set<string>>();
  for (const row of enumRes.rows) {
    const set = enumByDate.get(row.tag) ?? new Set();
    set.add(row.date);
    enumByDate.set(row.tag, set);
  }
  return {
    triggerByDate,
    enumByDate,
    totalDays: Number(dayCountRes.rows[0]?.days ?? 0),
  };
};

interface RawComboStat {
  signal: ActiveSignal;
  enumTarget: DiaryMetaTag;
  triggerHits: number;
  triggerDays: number;
  nonTriggerHits: number;
  nonTriggerDays: number;
  totalDays: number;
}

const computeRawStat = (
  signal: ActiveSignal,
  enumTarget: DiaryMetaTag,
  triggerDates: Set<string> | undefined,
  enumDates: Set<string> | undefined,
  totalDays: number,
): RawComboStat => {
  const triggers = triggerDates ?? new Set<string>();
  const enums = enumDates ?? new Set<string>();
  const triggerDays = triggers.size;
  const nonTriggerDays = totalDays - triggerDays;
  let triggerHits = 0;
  let nonTriggerHits = 0;
  for (const d of enums) {
    if (triggers.has(d)) triggerHits++;
    else nonTriggerHits++;
  }
  return {
    signal,
    enumTarget,
    triggerHits,
    triggerDays,
    nonTriggerHits,
    nonTriggerDays,
    totalDays,
  };
};

/**
 * 시드 × enum 전수 스캔. 임계 필터(p<0.1, q<0.2, ratio≥1.3, n≥5) 통과 후보만 반환.
 * 효과 크기(rate_ratio) 내림차순 정렬.
 */
export const discoverCandidates = async (
  userId: number,
  discovery: DiscoveryMode,
): Promise<CandidateHypothesis[]> => {
  const signals = await loadActiveSignals(userId);
  if (signals.length === 0) return [];

  const { startDate, endDate } = resolveWindow(discovery);
  const dayMap = await loadDayMap(userId, startDate, endDate);
  const registered =
    discovery.mode === 'recurring' ? await loadRegisteredCombos(userId) : new Set<string>();

  const rawCombos: RawComboStat[] = [];
  for (const signal of signals) {
    const triggerDates = dayMap.triggerByDate.get(signal.id);
    for (const enumTarget of DIARY_META_TAGS) {
      const triggerSpec: TriggerSpec = { type: 'seed', signalId: signal.id };
      const key = `${JSON.stringify(triggerSpec)}::${enumTarget}`;
      if (registered.has(key)) continue;
      rawCombos.push(
        computeRawStat(
          signal,
          enumTarget,
          triggerDates,
          dayMap.enumByDate.get(enumTarget),
          dayMap.totalDays,
        ),
      );
    }
  }

  const pValues = rawCombos.map((c) => {
    if (c.triggerDays < DISCOVERY_MIN_N) return NaN;
    return fisherExact(
      c.triggerHits,
      c.triggerDays - c.triggerHits,
      c.nonTriggerHits,
      c.nonTriggerDays - c.nonTriggerHits,
    );
  });
  const qValues = bhFdr(pValues);

  const candidates: CandidateHypothesis[] = [];
  for (let i = 0; i < rawCombos.length; i++) {
    const raw = rawCombos[i];
    const p = pValues[i];
    const q = qValues[i];
    if (!raw || p === undefined || q === undefined) continue;
    if (Number.isNaN(p) || Number.isNaN(q)) continue;
    if (p >= DISCOVERY_MAX_RAW_P) continue;
    if (q >= DISCOVERY_MAX_FDR_Q) continue;

    const rateTrigger = raw.triggerDays > 0 ? raw.triggerHits / raw.triggerDays : 0;
    const rateBaseline = raw.nonTriggerDays > 0 ? raw.nonTriggerHits / raw.nonTriggerDays : 0;
    const rateRatio = rateBaseline > 0 ? rateTrigger / rateBaseline : 0;
    if (rateRatio < DISCOVERY_MIN_RATE_RATIO) continue;

    candidates.push({
      triggerSpec: { type: 'seed', signalId: raw.signal.id },
      signalName: raw.signal.name,
      enumTarget: raw.enumTarget,
      nTriggerDays: raw.triggerDays,
      nTotalDays: raw.totalDays,
      rateTrigger,
      rateBaseline,
      rateRatio,
      rawP: p,
      fdrQ: q,
    });
  }

  candidates.sort((a, b) => b.rateRatio - a.rateRatio);
  return candidates;
};
