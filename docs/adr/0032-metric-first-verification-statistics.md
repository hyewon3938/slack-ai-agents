# 0032. n=1 패턴 검증 통계 스택 — 정량 매트릭 중심 재설계

- Status: Accepted
- Date: 2026-06-04
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), 마스터 #434 (계승), [ADR-0019](0019-saju-hypothesis-verification-pipeline.md) (Fisher + BH-FDR 파이프라인), [ADR-0024](0024-bayesian-posterior-update.md) (Beta-Binomial posterior)
- Tags: insight, statistics, architecture

## Context

패턴 검증 엔진을 "정량 매트릭이 1차, 일기 태그 outcome은 보조"로 재설계하면서(#477), 검증 통계를 어떤 스택으로 갈지 결정이 필요했다. 기존 스택은 Fisher's exact + Benjamini-Hochberg FDR + Beta-Binomial posterior 3종(ADR-0019·0024).

이 시스템의 구조적 제약을 기준으로 통계 방법을 재검토했다:

- **n=1**: 단 한 사람 종단 데이터. 모집단 가정 없음.
- **일별 시계열**: 연속된 날이 독립이 아님(자기상관).
- **이진 트리거 다중 공존**: 같은 날 여러 시드(예: 편재·월말·주말)가 동시에 켜짐 → 교란(confounding).
- **이진 + 연속 신호**: 일기 태그·플래그(이진) + 지출액·수면시간(연속).
- **매일 누적 + 주간 점검**: 반복/순차 검정 → 거짓양성 누적 위험.
- **자동 동작 선호**: 임계치 수동 튜닝 최소화, 데이터 늘면 자연히 강해지는 방법. 후속으로 미루지 않고 데이터 게이트로 자동 활성.
- **구현 환경**: PostgreSQL + 순수 TypeScript 함수. 무거운 외부 패키지 지양.

방법론을 별도 조사했고(출처 하단), 그 결론을 본 ADR에 정본으로 박는다.

## Decision

검증 통계 스택을 다음으로 확정한다.

### 1. 이진 신호 연관 — Fisher's exact + block permutation 보완

시드(트리거) × 이진 신호의 2×2 분할표에 Fisher's exact를 1차 스크리닝으로 유지한다. 단, **일별 자기상관이 Fisher를 anti-conservative(거짓양성 ↑)하게** 만들므로, 주 단위 **block permutation test**(연속 블록 단위로 트리거 라벨 셔플 → 귀무분포 생성)를 한 겹 덧대 보정한다. 일반(IID) permutation은 무상관 귀무 하에서 타당성이 깨지므로 블록 구조 보존이 필수.

### 2. 다중 비교 — BH-FDR 유지 + 발견/확정 트랙 q 분리

다수 (시드 × 신호) 쌍 동시 검정에 BH-FDR을 유지한다(교체 안 함). n=1 자동 시스템은 검정력보다 **재현 안정성**이 우선이라 Storey q-value·knockoffs보다 BH가 적합. **발견 트랙은 q를 느슨하게(예: q ≤ 0.10\~0.20), 확정 트랙은 엄격하게(예: q ≤ 0.05) + 사전 등록 가설**로 보정 강도를 분리한다. lag·다중 쌍이 늘어도 BH가 자동 흡수.

### 3. 누적 확신도 — Beta-Binomial posterior + 누적 e-value (핵심 보강)

Beta-Binomial posterior는 유지하되, **알림 발동 기준은 누적 e-value(test martingale)로 한다.** "확신도가 임계를 넘으면 알림"은 통계적으로 optional stopping(엿보다 성공 시 정지)이고, **Bayesian posterior도 여기 면역이 아니다**(고정 임계 stop-on-success는 거짓양성률을 크게 부풀림). e-value는 귀무 하 기댓값 ≤ 1인 비음수 통계량으로, **언제 멈추든(매주 점검) 곱이 여전히 e-value라 type-I이 보장**되고, 곱으로 누적돼 데이터가 늘수록 자동으로 강해진다. 임계는 1/α 하나(예: e ≥ 20 ⇔ α = 0.05).

> **구현 게이트**: e-value/test martingale은 비교적 최신 방법이라 잘못 구현하면 보장이 조용히 깨진다. 구현 전 ① 정확한 2×2 e-variable 공식을 검증된 출처에 핀, ② **null 시뮬레이션 테스트**(무관 데이터로 반복 점검 시 거짓양성률 ≤ α 실측)를 통과시켜야 한다. n 작아도 valid하므로 데이터 게이트 없이 처음부터 적용.

### 4. 연속 신호 — 이진화 금지, Mann-Whitney + 효과크기

지출액·수면시간 같은 연속 신호는 **이진화하지 않는다**(정규분포 기준 정보 ≥ 36% 손실). 시드 켜진 날 vs 안 켜진 날의 **분포를 Mann-Whitney(자기상관 시 permutation 버전)로 비교 + 효과크기(예: Hodges-Lehmann 중앙값 차)**를 함께 저장한다. 원칙은 **"연속으로 계산하고, 해석만 임계로"** — 내부 통계는 원시값, 사용자 알림 문구에서만 "평소보다 더 ○○" 식으로 임계 번역. 효과크기 병기로 "유의 + 실질 의미" 분리.

### 5. 소표본 수축 — empirical-Bayes 공통 prior

희귀·소표본 (시드 × 신호) 쌍의 과신을 막기 위해, 전체 쌍의 관측 발현율로 **공통 prior(Beta α₀·β₀)를 경험적으로 추정(empirical Bayes)** 하고 각 쌍 posterior를 그 위에서 갱신한다. 닫힌형이라 MCMC 불필요(순수 TS). 단 BH-FDR을 대체하지 않는다(보완재).

### 6. 데이터 게이트 자동 활성 (후속으로 미루지 않음)

소량 데이터에서 해로운 기법은 **미리 구현해두고 데이터 임계 넘으면 자동 활성**한다:

- **교란 분리(다중 트리거)**: 두 시드 공동 발현 횟수가 임계(예: 30일) 넘으면 자동으로 다변량 점검 on. 그 전엔 "교란 의심" 플래그만. 다변량은 **확정 후보 한정 + 트리거 2\~3개 한정 + elastic net**(ridge는 소표본 불안정, full MLE는 과적합).
- **empirical-Bayes 수축**: 전체 쌍 수가 적으면 prior 약하게, 쌓이면 자동으로 수축 강해짐.

### 7. 인과 vs 상관, lagged effect

n=1 관측 데이터이므로 **인과 주장 금지** — 모든 노출은 "연관/경향"으로 표현. lagged effect(시드(t) → 신호(t+1))는 시드 컬럼을 lag-shift해 동일 파이프라인에 태우고, 늘어난 검정 수는 BH-FDR이 보정한다.

## Alternatives considered

- **순수 Bayesian peeking (e-value 없이)** — 기각. "Bayesian이라 반복 검정에 면역"은 오해. 고정 posterior 임계 stop-on-success는 거짓양성률을 크게(시뮬레이션상 최대 ~80%) 부풀림.
- **Storey q-value / knockoffs** — 기각. Storey는 검정력↑이나 안정성↓(자동 시스템엔 안정성이 우선). knockoffs는 상관된 예측자 변수선택용이라 독립 쌍 p값 검정 구조엔 과함.
- **연속값 이진화 후 Fisher** — 기각. 정보 ≥ 36% 손실. "연속 계산, 임계 해석"으로 대체.
- **전면 다변량 로지스틱 / LASSO / full MCMC / Bayesian logistic** — 기각(또는 데이터 게이트 후 제한 도입). n=1 소표본 과적합 + 순수 TS 제약(MCMC 무거움). ridge는 소표본·희소에서 불안정.
- **SCED(단일사례 실험설계) randomization test** — 기각. 타당성이 실제 무작위 배정에 의존하는데, 본 시스템 시드는 달력 기반 **결정론**이라 무작위 배정 전제가 없음. (Tau-U 같은 자기상관-강건 효과크기·"효과크기 + 신뢰구간 항상 병기" 관행만 차용 검토.)

## Consequences

- 기존 Fisher / BH-FDR / Beta-Binomial 코드를 재사용하고, **e-value · block permutation · Mann-Whitney · empirical-Bayes**를 추가한다. 우선순위: ① e-value(순차 검정 구멍, 가장 중요) ② 연속 신호 분포 비교 ③ Fisher block permutation ④ EB 수축 ⑤ 발견/확정 q 분리.
- e-value는 **구현 전 공식 출처 확정 + null 시뮬레이션 테스트**가 빌드 게이트(위 3절).
- 교란 분리·EB 수축은 데이터 임계로 **자동 활성**(수동 후속 작업 없음).
- 사용자 노출 문구는 항상 "연관/경향" — "인과" 금지.
- 통계 의미 변경이 크므로, 5어휘 모델 재정의(매트릭=검증 단위, 일기 태그=매트릭의 한 종류)는 별도 ADR로 분리한다.

## References (조사 출처)

검증 통계 일반:
- Fisher 독립성 위반 → 유효표본 과대 → type-I 팽창: https://scales.arabpsychology.com/stats/fishers-exact-test/
- Fisher가 본래 보수적(상쇄 이해용): http://www.biostathandbook.com/fishers.html
- 시계열 의존 하 permutation test 한계와 블록 수정 (Romano & Tibshirani 2022): https://arxiv.org/abs/2009.03170

다중 비교:
- BH vs Storey 안정성/검정력, knockoffs 용도: https://www.stat.cmu.edu/~ryantibs/journalclub/knockoff.pdf
- FDR 방법 비교(BH 보수·안정): https://bookdown.org/mike/data_analysis/sec-false-discovery-rate.html

순차/반복 검정 (e-value):
- Bayesian이 peeking에 면역 아님 (시뮬레이션): https://www.alexmolas.com/2025/10/30/bayesian-ab-test-peeking.html
- 동일 결론(별도 출처): https://blog.analytics-toolkit.com/2017/bayesian-ab-testing-not-immune-to-optional-stopping-issues/
- e-value 정의·곱 성질·optional continuation·1/e: https://en.wikipedia.org/wiki/E-values
- 2×2 분할표 e-variable, Fisher 대비 optional stopping 우위 (Turner & Grünwald): https://arxiv.org/abs/2106.02693

연속 신호:
- 이진화 정보 손실(≥36%, "abandon dichotomization"): https://pmc.ncbi.nlm.nih.gov/articles/PMC12875020/
- Mann-Whitney 소표본 검정력 + permutation 확장: https://www.causeweb.org/usproc/sites/default/files/usclap/2016/Final%20Project.pdf

교란 / 다변량:
- Mantel-Haenszel 교란 통제와 한계: https://metricgate.com/docs/mantel-haenszel-test/
- 소표본·희귀사건 penalized 회귀(ridge 주의, elastic net 무난): https://pmc.ncbi.nlm.nih.gov/articles/PMC4982098/
- ridge 소표본 불안정: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8482588/

계층/empirical-Bayes:
- partial pooling 수축 메커니즘: https://cran.r-project.org/web/packages/rstanarm/vignettes/pooling.html
- 계층모델 ↔ 다중비교 (Gelman et al. 2012, 한계 포함): https://arxiv.org/abs/0907.2478

n=1 / 단일사례 / 인과:
- SCED randomization test는 무작위 배정 전제 필요: https://pmc.ncbi.nlm.nih.gov/articles/PMC6955662/
- N-of-1 실용 권장(serial t-test, Tau-U 자기상관 강건): https://pmc.ncbi.nlm.nih.gov/articles/PMC12930012/
- Granger causality 원칙·잠재 교란 한계: https://en.wikipedia.org/wiki/Granger_causality

> 조사 신뢰도: 대부분 복수 독립 출처로 교차검증. e-value의 2×2 구체 구현 공식(arXiv 2106.02693)은 수식 레벨 미검증 — 구현 전 원논문 본문 확인 필요(위 3절 게이트).
