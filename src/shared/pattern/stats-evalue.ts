/**
 * e-value test martingale (stats에서 분리, 순수·의존 없음) — P3, ADR-0034.
 * 순차 anytime-valid 확정 게이트(optional stopping 통제)와 일자 관측 타입.
 */

/** 일자 순 관측 한 건: active = 시드 발현 여부, pass = 그날 신호 pass 여부(측정불가일은 호출 전 제외). */
export interface DayObservation {
  active: boolean;
  pass: boolean;
}

/**
 * e-value 마틴게일 파라미터 — null 시뮬 빌드 게이트가 type-I ≤ α 를 보증하는 노브(ADR-0034).
 * - bettingFraction: 희석 계수 λ. 매일 베팅을 GRO 최적치의 λ배만 — 추정오차발 type-I 인플레 억제.
 * - priorOff/priorAct: off-day 기준율 r·active alt율 φ 의 Laplace pseudo-count(초기 추정 안정화).
 */
export interface EvalueOptions {
  bettingFraction: number;
  priorOff: number;
  priorAct: number;
}

export const DEFAULT_EVALUE_OPTIONS: EvalueOptions = {
  bettingFraction: 0.5,
  priorOff: 1,
  priorAct: 1,
};

const clampUnit = (x: number, eps = 1e-6): number => Math.min(1 - eps, Math.max(eps, x));

/**
 * 순차 e-value (test martingale)의 누적 supremum 반환 — ADR-0034.
 *
 * 구성: 매 active 일에 "귀무 기준율 r 보다 active pass율이 높다(H1)"에 예측가능(predictable) 베팅.
 *   - r  = 직전까지 *전체 일*(active+off) running pass율 (Laplace prior). H0에서 공통 귀무율 p의
 *          저분산 추정 → Jensen 편향(추정오차발 type-I 인플레)을 off-only 대비 억제. predictable.
 *   - φ  = active-day 까지의 running pass율 (예측가능 대안). φ ≤ r 이면 베팅 안 함(one-sided).
 *   - 희석 대안 φ' = r + λ(φ − r) 로 Bernoulli LR 베팅: pass면 φ'/r, fail이면 (1−φ')/(1−r).
 *     E_H0[log factor] = KL(p‖r) − KL(p‖φ'). r 이 φ' 보다 p 에 가까우면 ≤ 0(안전) — 풀링이 r 을
 *     p 에 붙여 안전쪽으로 민다. 잔여 추정오차는 λ·prior·null 시뮬 빌드 게이트로 통제.
 *
 * 반환 = sup_t E_t. Ville 부등식: H0에서 P(sup_t E_t ≥ 1/α) ≤ α → 임계 1/α(=20, α=0.05)에서 확정.
 * sup 은 시퀀스 prefix 가 자라도 단조 증가 + prequential 추정이 리플레이 불변 → 매주 결정론 재계산 안전.
 */
export const evalueTestMartingale = (
  seq: readonly DayObservation[],
  opts: EvalueOptions = DEFAULT_EVALUE_OPTIONS,
): number => {
  const { bettingFraction: lambda, priorOff, priorAct } = opts;
  let allHits = 0; // 전체 일 누적(귀무 기준율 r용)
  let allN = 0;
  let actHits = 0; // active 일 누적(대안율 φ용)
  let actN = 0;
  let e = 1;
  let peak = 1;

  for (const day of seq) {
    const r = clampUnit((priorOff + allHits) / (2 * priorOff + allN));
    if (day.active) {
      const phi = clampUnit((priorAct + actHits) / (2 * priorAct + actN));
      if (phi > r) {
        const phiDiluted = clampUnit(r + lambda * (phi - r));
        const factor = day.pass ? phiDiluted / r : (1 - phiDiluted) / (1 - r);
        e *= factor;
        if (e > peak) peak = e;
      }
      actHits += day.pass ? 1 : 0;
      actN += 1;
    }
    allHits += day.pass ? 1 : 0;
    allN += 1;
  }
  return peak;
};
