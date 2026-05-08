# 0011. 사주 패턴 cross-domain 통합 + evidence JSONB 표준화

- Status: Accepted
- Date: 2026-05-08
- Related: #382
- Tags: data, insight, process

## Context

`weekly-saju-review` routine은 매주 일요일 밤 최근 4주 데이터를 일운과 교차 분석하여 사주 패턴을 감지/저장한다. 초기에는 일기 ↔ 일운 상관만 다뤘고 이후 수면 ↔ 일운이 추가됐다. 분석 도메인이 일기·수면 2종으로 제한되어 있어, 사주 시그널이 cross-domain으로 발현되는 특성을 충분히 포착하지 못했다.

같은 사화일에 일기에서는 가족 갈등이, 수면에서는 짧은 수면이, 지출에서는 충동 소비가 동시에 나타나는 식의 cross-domain 시그널은 한 도메인만 보면 파편적으로만 보인다. 분석 도메인을 지출/일정/루틴/식사 등으로 확장할 계획이 있어, **패턴 저장 구조를 어떻게 잡을지** 결정이 필요했다.

또한 현재 evidence JSONB는 도메인마다 자유 형식이라(`{date, diary_excerpt, fortune_element}` vs `{date, sleep_data, fortune_element}`), 분석 코드가 형식을 일관되게 처리하기 어려웠고 새 도메인을 추가할 때마다 형식 협의가 필요했다.

## Decision

### 1. saju_patterns 테이블 통합 유지

도메인별로 테이블을 쪼개지 않는다. `pattern_type`은 사주 구조 분류(`sipsin`/`ganji`/`relation`/`sibiunsung`)로 유지하며, 도메인은 `evidence` 안에서 추적한다.

### 2. evidence JSONB 형식 표준화

```json
{
  "date": "YYYY-MM-DD",
  "domain": "diary" | "sleep" | "expense" | "schedule" | "routine" | ...,
  "summary": "1~2문장 요약",
  "fortune_element": "편재" | "사화" | "사해충" | "장생" | ...,
  ...domain_specific_fields
}
```

도메인별 추가 필드 예시:
- diary: `{event_keywords, emotion}`
- sleep: `{deviation_minutes, sleep_type, mid_wake_count}`
- expense: `{category, amount, over_budget, memo_excerpt}`
- schedule: `{signal_type, count, categories}`
- routine: `{rate, slot_rates}`

### 3. 분석 윈도우 28일 통일

지출/일정/루틴을 포함한 모든 도메인을 4주(28일) 롤링으로 통일. 패턴 감지의 본질이 반복성 검증이므로 더 짧은 윈도우(예: 1주)는 우연을 패턴으로 오인할 위험이 있다.

### 4. 예산 초과 판정 — 기준 일 예산 사용

`daily_budget_logs.budget`(=todayBudget, [ADR 0009](0009-daily-log-baseline-anchor.md))과 `spent`를 비교해 `saved < 0`인 날을 초과일로 본다. 동적 추천 예산(todayRecommended) 초과 판정은 retroactive 추적이 불가능하므로 본 작업 범위에서는 다루지 않는다.

## Alternatives considered

### A. 도메인별 테이블 분리 (`saju_patterns_diary`, `saju_patterns_sleep`, ...)

- 장점: 도메인별 스키마 최적화, 도메인 추가 시 영향 범위 작음
- 단점: 같은 trigger_element가 여러 도메인에 동시 발현하는 cross-domain 시그널을 통합적으로 추적 못 함. 패턴 매칭 로직이 도메인 수만큼 복잡해짐.
- 기각 이유: 사주 패턴의 본질이 cross-domain이라 분리는 시그널 손실.

### B. evidence 자유 형식 유지 (도메인별 ad-hoc 필드)

- 장점: 마이그레이션/표준화 없음
- 단점: 도메인 추가 시 매번 형식 협의 필요. 분석 코드가 evidence 형식을 일관되게 처리하지 못함.
- 기각 이유: 도메인 추가가 예정된 상황에서 표준 없이 시작하면 부채.

### C. 표준 컬럼 추가 (`evidence_domain TEXT`)

- 장점: SQL 쿼리에서 도메인 필터링 직접 가능
- 단점: 한 패턴의 evidence가 멀티 도메인일 수 있음(같은 trigger의 cross-domain 발현 누적). 단일 컬럼으로는 표현 불가.
- 기각 이유: cross-domain 표현력 손실.

### D. 본 결정 — 통합 + JSONB 표준화 (선택)

- 장점: cross-domain 통합 추적 + 도메인 추가 시 마이그레이션 불필요
- 단점: 도메인 필터링은 JSONB 쿼리 필요 (`evidence @> '[{"domain": "expense"}]'`)

## Consequences

### 장점

- cross-domain 시그널 통합 추적 — 한 trigger_element가 여러 도메인에 발현한 누적 evidence가 한 row에 모임
- 도메인 추가 시 마이그레이션 불필요 — evidence 안에서 새 domain 값과 추가 필드만 정의하면 끝
- pattern_type을 사주 구조(sipsin/ganji/relation/sibiunsung)로 유지하므로 기존 분석 코드(insight prompt 등) 무영향
- 28일 윈도우 통일로 도메인 간 비교 가능, 분석 일관성 확보

### 단점 / 제약

- evidence 안에서 도메인별 필터링은 JSONB 쿼리 필요. 활성 패턴이 누적되면 인덱스 추가가 필요해질 수 있음
- evidence 형식이 표준 외로 어긋나면 분석 코드가 깨짐 — SKILL.md에 형식 명시 + 검증 책임은 분석 routine(LLM)에 위임
- 동적 추천 예산 초과 판정은 본 ADR 범위 밖. 추후 별도 결정 필요

### 후속 작업

- [ ] 식사·운동 등 신규 도메인 추가 시 본 ADR의 domain enum 갱신
- [ ] evidence JSONB의 domain별 인덱스 필요성 모니터링 (활성 패턴이 100건 이상이고 도메인 필터 쿼리가 잦아질 때)
- [ ] 동적 추천 예산 초과 판정을 위한 `daily_budget_logs.recommended_budget` 컬럼 도입 검토 (별도 이슈)

---

**참고 자료**

- [ADR 0009 — 일별 로그 평가 기준 (기준 일 예산 단일 anchor)](0009-daily-log-baseline-anchor.md)
- [docs/domains/insight.md](../domains/insight.md) — saju_patterns 스키마 및 cross-domain 분석 도메인 정의
