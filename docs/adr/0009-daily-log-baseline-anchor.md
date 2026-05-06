# 0009. 일별 로그 평가 기준 — 기준 일 예산(todayBudget) 단일 anchor

- Status: Accepted
- Date: 2026-05-06
- Related: #378, refines [ADR 0008](0008-daily-budget-base-vs-recommended.md)
- Tags: data, budget, ux

## Context

ADR 0008로 일 예산이 두 값(`todayBudget` 기준 + `todayRecommended` 동적 권장)으로 분리되면서, `daily_budget_logs.budget`에 어느 값을 저장할지 결정이 필요했다. ADR 0008은 `todayRecommended`를 저장하기로 했다.

운영해보니 일별 평가의 anchor가 매일 변하면 누적 분석에서 멘탈 모델과 어긋난다:

- 매일의 `todayRecommended`는 잔여/남은일자로 산출되어 어제와 오늘이 다른 기준선이 된다.
- "이번 달 누적 세이브", "일평균 세이브", "런웨이 N일 연장 효과" 같은 합산 지표는 anchor가 흔들리면 의미가 휘발된다.
- 사용자가 일별 로그를 볼 때 기대하는 멘탈 모델은 "내가 약속한 기준선 대비 그날 얼마나 잘 지켰나"다.

## Decision

`saveDailyBudgetLog`는 `daily_budget_logs.budget` 컬럼에 `todayBudget`(기준 일 예산)을 저장한다.

- **anchor 단일화**: 사이클 동안 사실상 불변인 기준 일 예산을 매일의 평가 기준으로 사용.
- **누적 분석 정합**: 합산되는 모든 지표(세이브 합계, 일평균, 런웨이 환산)가 같은 기준선을 공유.
- **UI 안내**: 누적 요약 카드의 InfoTooltip에 "기준 일 예산(사이클 시작 시 약속된 동일한 값) 대비"임을 명시.
- **이중 모델 핵심 결정 유지**: ADR 0008의 `todayBudget` + `todayRecommended` 이중 산출 자체는 그대로. UI 메인 표시(현재 시점 권장값)는 여전히 `todayRecommended`.

## Alternatives considered

### A. `todayRecommended` 저장 (ADR 0008 초기 결정)

- 장점: "그날의 권장값" 그 자체가 기록되어 시점 권장이 사후 추적 가능.
- 단점: 매일 anchor가 다르므로 누적 분석에서 평가의 일관성 깨짐. UI도 "이게 기준이 뭔지" 매번 설명 필요.
- 기각 이유: 일별 평가의 본질은 약속선 대비이지, 시점별 권장 추적이 아니다.

### B. `todayBudget` 저장 (선택)

- 장점: anchor 단일화 → 누적 분석 정합. 사용자 멘탈 모델 일치 ("내 약속선 대비 평가").
- 단점: "그날의 권장값" 자체는 일별 로그에서 사후 확인 불가 (UI 보조 표시 또는 별도 컬럼 필요).

### C. 두 값 모두 저장 (스키마 추가)

- 장점: 과거 권장값과 약속선 모두 보존.
- 단점: 스키마 마이그레이션 필요. 사용성 측면에서 한 컬럼만 정확히 의미를 가지면 충분 — 권장값 사후 추적 수요가 명확히 발생할 때 추가하는 것이 합리적.
- 기각 이유: 현재 수요 대비 과한 디테일.

## Consequences

### 장점

- 누적 세이브, 일평균 세이브, 런웨이 환산이 모두 같은 기준선(약속선)을 공유 → 분석 일관성.
- UI에서 "기준 대비 평가"를 한 줄로 설명 가능. 사용자 멘탈 모델 정합.
- 기준 일 예산 자체가 사이클 동안 불변이므로 백필 없이도 ADR 0009 이후 신규 로그부터 일관된 의미.

### 단점 / 제약

- 그날의 동적 권장값(`todayRecommended`) 자체는 일별 로그에서 사후 추적 불가. 필요 시 별도 컬럼 추가는 후속 결정.
- ADR 0008 본문의 "saveDailyBudgetLog는 budget 컬럼에 `todayRecommended`를 저장한다" 문장은 ADR 0008 시점 결정으로 남고, 현재 운영 정책은 본 ADR이 SSOT.
- 과거 로그(ADR 0008 머지 \~ 본 ADR 머지 사이)는 `todayRecommended`로 저장된 행이 일부 존재할 수 있음. 백필은 하지 않는다 (수일 분량, 누적 분석 영향 미미).

### 후속 작업

- [ ] 그날의 동적 권장값 사후 추적 수요 발생 시 `recommended_budget` 컬럼 추가 검토.

---

**참고 자료**

- [ADR 0008. 일 예산 산정 모델 이중화](0008-daily-budget-base-vs-recommended.md) — 본 ADR이 부수 결정(저장값) 정렬.
