# 0024. Beta-Binomial Bayesian posterior 도입 — frequentist 검증과 병기

- Status: Accepted
- Date: 2026-05-27
- Related: [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434)
- Tags: data, statistics, insight

## Context

마스터 #393 Phase 4 (ADR-0019)는 가설 검증에 **Fisher's exact test + BH-FDR multiple testing correction**을 도입했다. 이는 frequentist 통계로, **누적이 충분할 때만** 유의미.

본 마스터 #434는 n=1 단일 환경에서 동작한다. 1인 환경에서 가설 누적 속도가 느려, frequentist 검증으로는 **초기 단계의 hit/miss가 적은 가설**을 평가하기 어렵다 (예: 매트릭 hit 3 / miss 1 → 어떻게 해석?).

또한 frequentist는 "이 가설이 참일 확률"을 직접 답하지 않는다 (p값은 "귀무가설이 참일 때 이 데이터가 우연히 나올 확률"). 사용자에게 가설 카드를 보여줄 때 사후 확신도가 더 직관적.

문제:

- 누적 적은 가설을 어떻게 평가할 것인가
- 사후 확신도를 직접 표현할 수단 필요
- frequentist를 폐기하지 말 것 (multiple testing correction 등 BH-FDR 가치 유지)

## Decision

**Beta-Binomial Bayesian posterior**를 도입해 frequentist 검증과 **병기**한다.

세부 구조:

```sql
-- migration: 065_metric_posterior.sql (예정)
ALTER TABLE saju_signal_metrics
  ADD COLUMN posterior_alpha NUMERIC(8,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN posterior_beta NUMERIC(8,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN posterior_p NUMERIC(6,4);  -- 사후 평균 = alpha / (alpha + beta)
```

업데이트 규칙 (\~100줄 헬퍼):

```typescript
// src/shared/bayesian-posterior.ts (예정)
function updatePosterior(prior: { alpha: number; beta: number }, outcome: 'hit' | 'miss') {
  return outcome === 'hit'
    ? { alpha: prior.alpha + 1, beta: prior.beta }
    : { alpha: prior.alpha, beta: prior.beta + 1 };
}
// inconclusive는 갱신 안 함 (정보 0)

// posterior_p = E[θ|data] = α / (α + β)
// 95% credible interval: betaInv(0.025, α, β), betaInv(0.975, α, β)
```

가설 카드에 frequentist p값 + Bayesian posterior 병기:

```
시드: 甲일 → 수면 7h 미만
검증: Fisher p=0.08 (q=0.21), Bayesian 사후 0.62 [0.41, 0.81]
```

prior: Beta(1, 1) uniform 시작 (운영 누적 후 informed prior 검토).

## Alternatives considered

### A. 본 마스터에서 도입 안 함, 운영 1\~3개월 후 follow-up

- 장점: 본 마스터 scope 작아짐. 검증 운영 데이터를 본 뒤 도입 결정
- 단점:
  - n=1 환경에서 frequentist만으로 누적 적은 단계가 길어짐 (가설 카드 노출 미루기 vs. 노이즈 카드 노출 둘 중 하나)
  - prior 없이 frequentist만 운영 후 도입 시 마이그레이션 + 회고 부담
- 기각 이유: 추가 코드 \~100줄에 비해 n=1 적합성 가치가 큼. 미루는 비용이 도입 비용보다 큼

### B. frequentist 폐기 + Bayesian 단독

- 장점: 단일 통계 모델로 단순화
- 단점:
  - BH-FDR multiple testing correction의 가치 (수십\~수백 가설 평가 시) 손실
  - Frequentist p값은 학술 표준 — 본 시스템의 검증 신뢰성을 외부에 설명할 때 유용
- 기각 이유: 두 통계 모델은 답하는 질문이 다르다. 병기가 적합

### C. frequentist + Bayesian 병기 (선택)

- 장점:
  - frequentist: "이 가설이 우연이 아닌 정도" (p값, q값)
  - Bayesian: "이 가설이 참일 확률 추정치" (사후 확신도)
  - 누적 적은 단계에서도 사후 확신도가 prior로 안정 + 누적 늘면 posterior 자연 수렴
- 단점: 통계 모델 2종 운영 (코드 \~100줄 추가, 컬럼 3개 추가)

→ **C 선택**. 추가 비용 작고 n=1 환경 적합성 큼.

## Consequences

### 장점

- 누적 적은 가설도 사후 확신도로 평가 가능 (초기 단계 hit 3/miss 1 = posterior 0.67)
- 가설 카드 표현이 더 직관적 ("Fisher p=0.08, 사후 0.62" — 사용자 친화)
- frequentist BH-FDR 가치 유지
- 운영 누적 후 informed prior 도입 시 컬럼 구조 그대로 사용 가능

### 단점 / 제약

- 코드 \~100줄 추가 (`src/shared/bayesian-posterior.ts`)
- 컬럼 3개 추가 (`posterior_alpha`, `posterior_beta`, `posterior_p`)
- 매칭 cron에서 매트릭 카운트 UPDATE 시 posterior도 같이 UPDATE (단순 산술)
- credible interval은 beta inverse CDF 필요 — 외부 라이브러리(`@stdlib/stats-base-dists-beta-quantile` 등) 또는 직접 구현

### 후속 작업

- [ ] Phase 1 migration에 `posterior_alpha`, `posterior_beta`, `posterior_p` 컬럼 추가
- [ ] Phase 7 `src/shared/bayesian-posterior.ts` 헬퍼 작성
- [ ] 매칭 cron이 posterior도 UPDATE하도록 수정
- [ ] 가설 카드 본문에 frequentist + Bayesian 병기
- [ ] beta inverse CDF 라이브러리 선택 + 의존성 추가

---

**참고 자료**

- [ADR-0019](0019-saju-hypothesis-verification-pipeline.md) — frequentist 검증 (Fisher + BH-FDR) 원본
- Beta-Binomial 모델: 누적 사건의 사후 확신도를 단순한 산술로 유지하는 Conjugate prior 패턴
