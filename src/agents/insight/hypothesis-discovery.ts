/**
 * 패턴 발굴 엔진 — 링크 없는 (시드 × 신호) 여집합을 off-day 대조로 스캔 (#477 P5a, ADR-0039).
 *
 * P4a·P4b가 evidence-only로 남긴 결정론 feature 시드(강도 밴드·관계·효과적 십성)는
 * pattern_links가 없어 주간 검증 엔진(verifyUserLinks — active 링크만)이 안 건드린다 →
 * 영영 검증 안 됨. 발굴은 그 여집합을 기존 off-day 2×2 엔진(검증 프리미티브 재사용)으로 스캔해
 * 발견 q 트랙으로 후보만 surface → pending pattern_link 선INSERT → #insight 승인 카드.
 *
 * 2층 통제(ADR-0039 §2): 느슨한 discoverQ로 *띄우기만*, 확정(믿음)은 승인 후 엄격 e-value 트랙.
 * 거짓 발견의 비용 = 승인 카드 1장이지 거짓 믿음이 아니다. 손박기 mass-wiring 아님(헌장 ②).
 *
 * 본 모듈은 읽기(시리즈 계산) + pending 링크 쓰기까지. 검증 UPDATE·status 전이는 주간 엔진.
 */

import { buildWindowDates } from '../../shared/pattern/binarize.js';
import {
  computeSeedActivationMap,
  computeSignalSeriesMap,
} from '../../shared/pattern/series-map.js';
import { bhFdrByFamily, familyOf } from '../../shared/pattern/fdr-family.js';
import { computeUserDataStarts, signalDataStart } from '../../shared/pattern/data-window.js';
import { loadActiveSeeds } from '../../shared/pattern/match-seeds.js';
import { buildNameIdMap } from '../../shared/pattern/match-day.js';
import { INSIGHT_THRESHOLDS } from '../../shared/insight-thresholds.js';
import { loadActiveSignals, loadLinkedPairs } from './hypothesis-discovery-load.js';
import { scanSurvivors } from './hypothesis-discovery-scan.js';
import { toDiscoveryCandidate, rankTopN } from './hypothesis-discovery-rank.js';
import type { DiscoveryCandidate } from './hypothesis-discovery-types.js';

const V = INSIGHT_THRESHOLDS.patternVerification;

/**
 * 미등록 (시드 × 신호) 여집합을 off-day 대조로 스캔 → 발견 q·top-N 통과 후보.
 * 검증 프리미티브 재사용(시드 활성 시리즈·신호 시리즈는 1회씩 계산, P1 전역화 payoff).
 * 사전선별(Fisher) 통과 쌍만 block-perm(Monte Carlo) → 비용 차단. confirm 트랙과 별도 FDR 풀.
 */
export const discoverCandidates = async (
  userId: number,
  today: string,
): Promise<DiscoveryCandidate[]> => {
  const [seeds, signals, linked] = await Promise.all([
    loadActiveSeeds(userId),
    loadActiveSignals(userId),
    loadLinkedPairs(userId),
  ]);
  if (seeds.length === 0 || signals.length === 0) return [];

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  // 데이터-존재 윈도우(#504): 신호별 시작일 기준으로 빈 과거를 결측 처리 → per-pair 클립.
  const dataStarts = await computeUserDataStarts(userId);
  const signalStartById = new Map(
    signals.map((s) => [s.def.id, signalDataStart(s.def.domain, dataStarts)]),
  );

  // 신호 시리즈는 continuous면 raw 보존(Mann-Whitney 효과크기 §4).
  const signalSeriesById = await computeSignalSeriesMap(
    userId,
    signals.map((s) => s.def),
    windowDates,
    signalStartById,
    'Discovery',
  );
  const seedActivationById = await computeSeedActivationMap(
    userId,
    seeds,
    windowDates,
    stemMap,
    branchMap,
  );

  const { survivors, droppedSameDomain } = scanSurvivors({
    seeds,
    signals,
    linked,
    windowDates,
    dataStarts,
    signalStartById,
    signalSeriesById,
    seedActivationById,
  });
  if (droppedSameDomain > 0) {
    console.warn(
      `[Discovery] user=${userId} same-domain 자기상관 ${droppedSameDomain}쌍 제외(#508 ④)`,
    );
  }
  if (survivors.length === 0) return [];

  // 가족별 발견 BH-FDR (ADR-0037·0039 §2 — 확정 트랙과 별도 풀, 가족 간 비용 격리).
  const qValues = bhFdrByFamily(survivors.map((s) => ({ p: s.blockP, family: familyOf(s.seed) })));

  const passed: DiscoveryCandidate[] = [];
  survivors.forEach((s, i) => {
    const q = qValues[i] ?? NaN;
    if (!Number.isFinite(q) || q > V.discoverQ) return;
    passed.push(toDiscoveryCandidate(s, q));
  });

  return rankTopN(passed, userId);
};
