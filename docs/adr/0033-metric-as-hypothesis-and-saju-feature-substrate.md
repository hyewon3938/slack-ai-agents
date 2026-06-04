# 0033. 매트릭=가설 5어휘 재정의 + 결정론 사주 feature substrate

- Status: Accepted
- Date: 2026-06-04
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [ADR-0032](0032-metric-first-verification-statistics.md) (통계 스택), 마스터 #434 (5어휘 원형), [ADR-0023](0023-metric-unit-counter-and-summary-view.md) (매트릭 단위 카운터), [ADR-0028](0028-pillar-level-and-threshold-pool.md) (운 레벨·임계 풀)
- Tags: insight, schema, architecture, statistics

## Context

#477 재설계에서 (a) 매트릭/가설/outcome 관계, (b) 신호 측정·저장 방식, (c) 사주 운 레벨 modulation 처리, (d) 비단조(inverted-U) 패턴 처리를 결정해야 한다. 마스터 #434의 5어휘 모델은 매트릭(SQL)과 outcome(일기 태그)을 별도 파이프라인으로 두었고, 그 결과 가설이 일기 태그(주관)로만 구성되는 의도-역전이 발생했다(#474 정합성 점검에서 발견). 통계 스택은 ADR-0032가 확정.

## Decision

### 1. 5어휘 재정의 — 매트릭이 곧 검증 단위(가설)

(시드 × 신호) 쌍 자체가 검증 대상 가설이다. 별도 `가설` 엔티티를 폐기한다. 기존 `outcome`(일기 태그)은 **신호의 한 종류**(`kind=tag`)로 흡수되고, SQL 신호(`kind=sql`)와 동격이다. 객관 SQL 신호가 1차, 주관 태그 신호가 보조.

- `signal_defs`: 전역 신호 정의 (kind=sql|tag, value_type, sql_body|tag_name, direction, threshold, source, status). 시드와 무관.
- `pattern_links`: (시드 × 신호) 등록 = 가설 + 누적 검증 상태. source(manual|discovery|llm), status, test_type(fisher_2x2|mann_whitney) + 공통 통계(effect·p·q·posterior·evalue) + `test_detail` JSONB + `confound` JSONB.

### 2. 신호 전역 측정 + 주간 재계산 (일별 precompute 없음)

신호는 시드 무관하게 매일 측정 가능한 전역 정의다. 일별 파생 테이블(daily_signals/seed_activation)을 두지 않고, **주간 검증 job이 원시 데이터 + 결정론 규칙으로 윈도우를 재계산**한다. n=1이라 재계산 비용이 낮고 드리프트가 없다. off-day baseline = 시드 비활성일. 옛 `pattern_matches` 일별 행은 폐기(오늘 시드활성은 아침 잔소리용 transient 계산).

### 3. 결정론 사주 feature 엔진 (substrate)

운 레벨 modulation(생·극, 합·충·형·해·파, 합화, 오행 비율)을 **통계 상호작용으로 검증하지 않고, 결정론 규칙으로 "실효 강도/상태" feature를 계산**해 시드/신호/covariate로 통계층에 투입한다. 명리학(결정론 feature 계산) ↔ 통계(나에게 유효한가 검정)를 분리한다.

- 대표 규칙부터 + 확장형: 오행 비율 / 생·극 가중 실효 강도 / 활성 합충형해파(원진·귀문 포함, 강도감소 여부는 규칙 정의) / 기본 합화(천간합+통근 조건, 지지 육합/삼합 + 십성 재매핑).
- 규칙은 **파라미터화(사용자의 명리학 프레임이 정본)** — 하드코딩 금지. feature가 불완전·부정확해도 통계가 거른다(무관 feature는 상관 안 나옴).

### 4. 비단조(inverted-U)·용량-반응 지원

강도 feature는 이진이 아니라 **graded ordinal 레벨**(약/적정/강 등)로 표현하고 **레벨별로 outcome을 검정**한다. 같은 변수가 레벨에 따라 반대 부호(적정→+, 과다→−)인 역U자를 레벨별 main effect로 포착한다(상호작용 항 불요 — 복잡성을 결정론 feature 레벨에 접음). `cumulative_pillar_count`(N=1..5)·`element_density`가 그 원형.

### 5. 객관 outcome 우선

사주 feature 검정은 **객관 outcome(지출·수면·루틴 — 믿음에 안 흔들리는 정량)을 우선**, 주관 일기 태그는 보조. 사주를 안다는 사실이 자기보고를 오염시키는 기대편향(observer bias)을 회피하기 위함.

## Alternatives considered

- **매트릭/가설/outcome 별도 유지(현행)** — 의도 역전·중복 파이프라인. 기각.
- **운 레벨 modulation을 통계 상호작용 항으로 검증** — n=1에서 데이터 헝그리(주효과보다 훨씬 많은 데이터 필요). 결정론 feature로 환원하는 쪽이 우월.
- **강도 이진 트리거** — inverted-U 못 잡음(평균 상쇄). graded 레벨 채택.
- **사주 규칙 하드코딩** — 학파 의존 + 하드코딩 리스크. 파라미터화로.
- **일별 precompute(daily_signals/seed_activation)** — 결정론이라 재계산 가능, 불필요. 기각.

## Consequences

- `signal_defs`·`pattern_links` 신설, `pattern_metrics` 일반화/대체, `pattern_matches` 일별 행 폐기(마이그레이션 + 잔소리 경로 수정).
- 사주 feature 엔진 = 새 phase. 대표 규칙 결정론 계산, 확장형, 사용자 규칙 파라미터화. 가장 어려운 합화 전체 정밀화는 데이터 보고 확장.
- 비단조 패턴은 graded 레벨로. 희귀 극단(강한 화 넉다운 등)은 표본 누적이 느려 늦게 확정됨(정직히 명시).
- 확증편향 방어: 규칙은 feature를 계산할 뿐 효과를 단언 안 함 + 독립 객관 outcome에 off-day 대조 검정 + 사전 고정 규칙 + FDR/e-value. 디테일이 편향으로 굳지 않음.
- ADR-0032 통계 스택 위에서 동작. explainer·도메인 문서는 빌드 후 갱신.
- 가중치·합화 성립 조건은 해석적이라 명시·문서화·조정 가능하게 유지.
