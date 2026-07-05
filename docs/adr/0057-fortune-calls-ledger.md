# 0057. 일운 콜 장부를 period_forecasts와 분리된 경량 테이블로

## Status

Accepted (2026-07-05)

## Context

- 월운·세운 예측은 `period_forecasts`(마이그 091)가 신호 pass율 기반으로 사전등록 → 무인 채점한다([ADR-0050](0050-period-forecast-ledger.md)). 판정 대상이 "신호 시계열의 방향"이라 기계 채점이 성립한다.
- 일운 해석(`fortune_analyses`)은 주간 생성만 되고 채점 루프가 없다. 일운·이벤트성 예측은 "특정 구간에 특정 사건·체감이 있을 것"이라는 **서술형 콜**이라 신호 시계열로 환원되지 않는 경우가 많다.
- 검증축(`pattern_links`)은 현재 verified 0·emerging 5 — 통계 게이트가 확정을 내주기 전 구간에서, 반증 가능한 콜의 명시적 채점이 유일한 정성 검증 루프다.

## Decision

- 경량 전용 테이블 `fortune_calls`를 신설한다: `claim`(예측 문장) + `criterion`(판정 기준) + `scope_start/end`(판정 구간) + 3단 판정(`hit`/`partial`/`miss`) + `unmeasurable`.
- 확률 점수(Brier 등)는 두지 않는다 — 표본 없는 층에서 확률 산출은 과대주장(091과 동일 철학). 판정과 근거 노트(`verdict_note`)만.
- 등록·채점은 DB 프록시를 쓰는 주간 routine 경로가 담당하고(등록 주 2\~3개 상한), 주간 통합 카드는 판정 결과를 읽기 전용으로 표시한다. **봇 코드는 이 테이블을 소비하지 않는다** — 스키마만 봇 마이그레이션으로 관리.

## Alternatives

1. **`period_forecasts`에 period_type 확장** — 기각. 채점기(`scoreForecasts`)가 `signal_id`·`computeSignalSeries` 전제라 서술형 콜과 계약 불일치. `baseline_rate` 동결 등 통계 채점 필드가 콜에는 무의미.
2. **마크다운 장부(비공개 문서)** — 기각. 카드 자동 표시·기한 경과 감지·집계가 안 됨.
3. **`fortune_analyses`에 콜 내장**(warnings/recommendations 재사용) — 기각. 해당 필드는 빈 배열 고정 계약(표시 경로 오염)이고, 콜 단위 상태 전이가 불가.

## Consequences

- LLM/수동 판정의 주관성은 criterion 명시로 완화되지만 남는다 — 콜 작성 시 판정 기준을 관찰 가능한 사실로 쓰는 규율이 필요.
- 등록 상한(주 2\~3개)은 운영 규칙이며 스키마로 강제하지 않는다.
- 데이터가 쌓이면(수개월) 적중률 집계·통계화 여부를 재평가한다. 그 전까지 카드 표시는 판정 나열만.
- routine 계약(등록·채점 주체)이 바뀌면 insight.md §44를 갱신한다.
