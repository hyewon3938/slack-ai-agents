# 0034. e-value 구성 — 결정론 리플레이 betting test martingale

- Status: Accepted
- Date: 2026-06-05
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#483](https://github.com/hyewon3938/slack-ai-agents/issues/483), [ADR-0032](0032-metric-first-verification-statistics.md) (통계 스택 — 본 ADR이 구체화), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (SET 재계산), [ADR-0024](0024-bayesian-posterior-update.md) (Beta-Binomial)
- Tags: insight, statistics

## Context

[ADR-0032](0032-metric-first-verification-statistics.md) §3이 "알림 발동 기준 = 누적 e-value(test martingale)"를 확정하면서, 정확한 e-variable 공식은 빌드 게이트로 남겼다 — "비교적 최신 방법이라 잘못 구현하면 보장이 조용히 깨진다 → 구현 전 ① 공식 출처 핀 ② null 시뮬 통과"(원논문 arXiv 2106.02693 수식 미검증). P3(#483) 진입에서 이 공식 계열을 핀해야 한다.

추가 제약 — P2가 채택한 **SET 전체 재계산**([ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) §2: 매주 윈도우를 raw에서 처음부터 재계산, 증분 아님)과 e-value의 본질(시간 순 곱 = 순차 누적)이 긴장한다. 매주 전체를 새로 계산하는데 마틴게일은 순차 곱이라서.

구현 환경: PostgreSQL + 순수 TypeScript. 무거운 수치 패키지·MCMC 지양. 데이터 n=1, 일별 자기상관, 매주 점검(peeking 구조).

## Decision

e-value를 **per-day predictable betting factor의 곱 = test martingale**으로 구성하고, 매주 **전체 윈도우를 결정론 리플레이**해 재생성한다.

- **마틴게일**: 윈도우의 날을 시간 순으로 훑으며 각 날 betting factor를 곱해 누적 e-value. factor는 **predictable** — 그날 *직전까지*의 데이터로만 결정(미래 미참조). predictable factor의 곱은 귀무 하 비음수 마틴게일 → **어느 정지시각(매주 월요일 peek)에서도 type-I 보장**(optional stopping). 판정: `e ≥ 1/α = 20`(α=0.05) → 확정.
- **SET 정합 (리플레이 결정론)**: 마틴게일은 *순서 있는 데이터의 순수 함수*다. 매주 동일 데이터를 처음부터 리플레이하면 동일 마틴게일 값 → SET 재계산과 정합, 드리프트 0. 증분 상태를 들고 다닐 필요 없음 — **주간 스냅샷은 감사·진행표시용이지 계산 입력이 아니다**.
- **정확한 factor + nuisance(공통 pass율) 처리는 null 시뮬레이션이 심판**:
  - 1차 구성: **순차 조건부 betting**(running margin 조건부로 공통 pass율 nuisance 제거 — Fisher의 순차판). nuisance-free.
  - fallback: **Turner-Grünwald GRO 2×2 mixture**(arXiv 2106.02693, null을 prior로 적분). 1차가 underpower거나 null 시뮬 실패 시 전환.
  - **null 시뮬레이션 (빌드 게이트)**: 무관 active/off Bernoulli 스트림을 실제 시드 발현 빈도로 수천 회 생성 → `P(어느 주든 sup_t e_t ≥ 20) ≤ α` 실측. 통과 못 하는 구성은 **머지 불가**(ADR-0032 §3 게이트 실행).
- **betting 전략**: growth-rate 지향(Kelly/ONS 류 plug-in) — 과거 데이터로 적합한 예측을 베팅에 반영, 데이터 쌓일수록 자동으로 강해짐([metric-first 헌장 ④](../design-notebook/metric-first-verification.md)). 데이터 적으면 중립(factor≈1)에서 출발.

## Alternatives considered

### A. Turner-Grünwald GRO 2×2 batch e-variable을 1차로

- 장점: ADR-0032 지명 출처. 2×2 GROW 최적. 단일 테이블에 정확.
- 단점: batch-per-table(테이블당 e-value, optional continuation으로 곱)이라 일별 스트리밍·SET 리플레이 구조에 맞추려면 주-블록 경계 모델링 필요. GRO prior(JIPr)가 2×2에선 표준 Bayes factor 아님 → 수치 최적화 부담.
- 기각(1차로는): 과함. 단 **fallback으로 보존** — 1차가 underpower거나 null 시뮬 실패 시 채택.

### B. 순수 Bayesian peeking (e-value 없이, posterior 임계)

- 장점: 기존 Beta-Binomial 그대로.
- 기각: ADR-0032 §3 — Bayesian도 optional stopping 면역 아님. 고정 임계 stop-on-success는 거짓양성률을 크게 부풀림.

### C. (선택) per-day predictable betting test martingale via 결정론 리플레이

- 장점: 순차 누적이 본질이라 "매주 peek" 구조에 직접 맞음. 리플레이 결정론 → SET 정합(드리프트 0). 순수 TS(곱). null 시뮬 단순. 데이터 적어도 valid(중립 출발).
- 단점: betting 전략이 검정력을 좌우(약한 betting = 약한 검정력). 정확 factor의 nuisance 처리가 미묘 → null 시뮬 게이트로 강제 검증.

## Consequences

### 장점

- ADR-0032 §3 "언제 멈추든 e-value" 보장을 구조로 실현. 주간 반복 점검의 거짓양성 누적 차단.
- 설계 중 식별된 **"마틴게일 ↔ SET 재계산" 긴장을 리플레이 결정론으로 해소**.
- verified tier 승격([ADR-0035](0035-graded-confidence-exposure.md))의 게이트 = `e ≥ 20` 단일 임계(임의값 박지 않음, 헌장 5).

### 단점 / 제약

- e-value 메서드는 비교적 최신 → **null 시뮬 게이트가 정확성의 유일한 보증**. 게이트 통과 없이 머지 금지.
- 데이터 \~90일 + 약한 효과면 e가 20에 한참 못 미침 → verified tier가 거의 빈다(정상 — ADR-0035 emerging tier가 가시성 담당).

### 후속 작업

- [ ] 1차(순차 조건부 betting) 구현 + null 시뮬 테스트(무관 데이터 거짓양성 ≤ α 실측)
- [ ] 실패 시 Turner-Grünwald fallback 전환
- [ ] `pattern_links.e_value` 갱신 + 주간 스냅샷에 마틴게일 trail 기록

---

**참고 자료**

- Turner & Grünwald, *Generic E-Variables for Exact Sequential k-Sample Tests* (arXiv 2106.02693)
- Ramdas et al., *Game-Theoretic Statistics & Safe Anytime-Valid Inference*
- Safe Testing vignette (safestatistics.com)
- [ADR-0032](0032-metric-first-verification-statistics.md) §3 (e-value 빌드 게이트)
