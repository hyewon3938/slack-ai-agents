/**
 * FDR 가족 분리 (pattern-verification에서 분리).
 */

import { bhFdr } from './stats-table.js';

// ─── FDR 가족 분리 (#477 P4a, ADR-0037) ──────────────────

export type FdrFamily = 'saju_strength' | 'saju_relation' | 'baseline';

/**
 * 사전등록 가족 (ADR-0037 + #477 P4b ADR-0038):
 *   - strength_band → saju_strength (합화 반영 강도)
 *   - relation·hwa_sipsung → saju_relation (자동 생성 관계 batch + 효과적 십성)
 *   - 그 외(life_signal·기존 사주·태그) → baseline
 * 자동 생성 관계 batch(070 + 귀문/암합)가 빠른 life_signal 트랙 확정을 늦추지 않게 격리.
 */
export const familyOf = (seed: { trigger_target_type: string }): FdrFamily => {
  if (seed.trigger_target_type === 'strength_band') return 'saju_strength';
  if (seed.trigger_target_type === 'relation' || seed.trigger_target_type === 'hwa_sipsung') {
    return 'saju_relation';
  }
  return 'baseline';
};

/**
 * 가족별로 BH-FDR 독립 적용 (ADR-0037). 입력 순서를 보존해 q 배열 반환.
 * 자주 발현하는 강도 밴드(유한 p)가 baseline 가족의 m을 키워 life_signal 확정을 늦추는 것을 차단.
 * 한 가족 추가/제거는 다른 가족 q에 영향 없음(가족 간 격리).
 */
export const bhFdrByFamily = (items: ReadonlyArray<{ p: number; family: FdrFamily }>): number[] => {
  const q = new Array<number>(items.length).fill(NaN);
  const families: FdrFamily[] = ['saju_strength', 'saju_relation', 'baseline'];
  for (const fam of families) {
    const idxs = items.map((it, i) => (it.family === fam ? i : -1)).filter((i) => i >= 0);
    if (idxs.length === 0) continue;
    const qs = bhFdr(idxs.map((i) => items[i]?.p ?? NaN));
    idxs.forEach((i, k) => {
      q[i] = qs[k] ?? NaN;
    });
  }
  return q;
};
