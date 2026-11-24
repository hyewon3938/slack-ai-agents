/**
 * 신호·시드 시리즈 일괄 계산 — 검증·발굴·교란 진입점이 공유하는 헬퍼.
 * 진입점 흐름은 각자 격리하고(자체 로드·자체 계산) 시리즈를 모으는 루프만 공유한다.
 */

import type { DailyContext, SajuSeedWithMetrics } from './match-types.js';
import type { BandCuts } from './quantile.js';
import {
  type SignalSeriesResult,
  computeSeedActivationSeries,
  computeSignalSeries,
} from './series.js';
import type { SignalDef } from './types.js';

/**
 * 신호 시리즈(신호당 1회) — 넘겨받은 순서대로 순차 계산, 결과 Map도 그 순서.
 * 각 신호는 자기 도메인 시작일(signalStartById) 기준으로 빈 과거를 결측 처리한다.
 */
export const computeSignalSeriesMap = async (
  userId: number,
  signals: Iterable<SignalDef>,
  windowDates: string[],
  signalStartById: Map<number, string | null>,
): Promise<Map<number, SignalSeriesResult>> => {
  const signalSeriesById = new Map<number, SignalSeriesResult>();
  for (const signal of signals) {
    signalSeriesById.set(
      signal.id,
      await computeSignalSeries(
        userId,
        signal,
        windowDates,
        signalStartById.get(signal.id) ?? null,
      ),
    );
  }
  return signalSeriesById;
};

/**
 * 시드 활성 시리즈(시드당 1회, strength_band 2-pass 포함) — 넘겨받은 순서대로 순차 계산.
 * ctx·강도·컷 캐시는 호출 1회 안에서만 시드끼리 공유한다(18 밴드 시드가 6 target 계산을 공유).
 */
export const computeSeedActivationMap = async (
  userId: number,
  seeds: Iterable<SajuSeedWithMetrics>,
  windowDates: string[],
  stemMap: Map<string, number>,
  branchMap: Map<string, number>,
): Promise<Map<number, Map<string, boolean>>> => {
  const ctxCache = new Map<string, DailyContext | null>();
  const strengthCache = new Map<string, Map<string, number>>();
  const cutCache = new Map<string, BandCuts>();
  const seedActivationById = new Map<number, Map<string, boolean>>();
  for (const seed of seeds) {
    seedActivationById.set(
      seed.id,
      await computeSeedActivationSeries(
        seed,
        userId,
        windowDates,
        ctxCache,
        stemMap,
        branchMap,
        strengthCache,
        cutCache,
      ),
    );
  }
  return seedActivationById;
};
