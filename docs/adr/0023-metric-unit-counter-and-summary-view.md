# 0023. hit/miss 카운터는 매트릭 단위 + seed 합계는 view로 derive

- Status: Accepted (어휘 정정 2026-05-27)
- Date: 2026-05-27
- Related: [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434), [ADR-0026](0026-pattern-prefix-rename.md)
- Tags: data, insight, schema

> **Note (어휘 정정, 2026-05-27)**: 본 ADR의 Decision 의도(매트릭 단위 source of truth + view로 시드 합계 derive)는 그대로 유효하다. 단 본 ADR 작성 시점에 사용한 컬럼 어휘(`seed_id`, `target_type`, `target_value`, `saju_signal_catalog`, `saju_signal_metrics`, `saju_signal_summary`)가 실제 v2 스키마와 다르고 본 마스터의 `pattern_*` rename 결정(ADR-0026)과 정렬되지 않아 본문 SQL의 어휘만 `pattern_*` 기준으로 정정한다 (오탈자 범위 정정, 결정 의도는 unchanged).

## Context

마스터 #434는 시드 → 매트릭 → 매칭 → 가설 → 검증 5어휘 데이터 모델 위에서 동작한다.

hit / miss / inconclusive 카운터를 어디에 둘지가 결정 필요:

- 시드(seed) 단위로 두면 시드 1:N 매트릭 관계에서 카운트가 어느 매트릭에서 왔는지 추적 불가
- 매트릭(metric) 단위로 두면 시드 합계는 매번 집계 필요
- v2 마스터 #421 (PR #422, ADR-0020) 패턴: `saju_influence_summary` view로 집계 derive

또한 본 마스터에서 hit/miss 누적은 검증(Fisher, BH-FDR, Bayesian)의 입력이 되므로 **source of truth** 위치가 명확해야 한다.

## Decision

**hit/miss/inconclusive 카운터는 `pattern_metrics` 테이블에 직접 컬럼으로 둔다 (source of truth).** 시드 단위 합계는 `pattern_summary` view로 derive.

세부 구조 (ADR-0026의 `pattern_*` 어휘 적용):

```sql
-- migration: 064_pattern_metrics_counters.sql (예정)
ALTER TABLE pattern_metrics
  ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN miss_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN inconclusive_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_matched_at TIMESTAMPTZ;

CREATE VIEW pattern_summary AS
SELECT
  c.id AS pattern_id,
  c.trigger_target_type,
  c.trigger_target_id,
  c.pattern_kind,
  COUNT(m.id) AS metric_count,
  SUM(m.hit_count) AS total_hits,
  SUM(m.miss_count) AS total_misses,
  SUM(m.inconclusive_count) AS total_inconclusive,
  MAX(m.last_matched_at) AS last_matched_at
FROM pattern_catalog c
LEFT JOIN pattern_metrics m ON m.pattern_id = c.id
WHERE m.status = 'active'
GROUP BY c.id;
```

매칭 cron(`daily-saju-matching.ts` — Phase 4에서 일반화 후 파일명도 변경 검토)이 매일 평가할 때마다 해당 매트릭의 카운트를 UPDATE.

## Alternatives considered

### A. seed에 카운트 컬럼

- 장점: seed 단위 단순 SELECT 가능
- 단점:
  - 시드 1:N 매트릭일 때 어느 매트릭이 hit인지 추적 불가
  - 매트릭이 비활성화(`status='rejected'`)되어도 시드 카운트에 잔존 (history 오염)
  - PR #422 view 패턴과 일관성 ↓
- 기각 이유: source of truth가 매트릭이 아닌 시드가 되면 검증(Fisher 등) 입력 정의가 흐려진다

### B. matches만 두고 매번 집계

- 장점: 정규화 완벽 (DRY)
- 단점: 검증 cron(weekly-hypothesis-review)이 매주 수십 가설을 평가할 때마다 `saju_daily_matches` 전체 집계 → 비용 ↑. 운영 누적이 1년치 쌓이면 더 무거워짐
- 기각 이유: 매주 비용보다 매일 cron이 카운트 1 UPDATE하는 비용이 압도적으로 작음

### C. metric에 카운트 컬럼 + view derive (선택)

- 장점:
  - source of truth가 매트릭 (검증 입력과 일치)
  - 시드 단위 합계는 view로 조회 시점 derive (v2 PR #422 패턴 계승)
  - 매트릭 status 변경 시(rejected) view가 자동으로 제외
- 단점: view 정의가 추가 entity

→ **C 선택**. v2 마스터 #421의 view 인터페이스 패턴(ADR-0020)을 마스터 #434에 일관 적용.

## Consequences

### 장점

- 매트릭이 검증의 단위와 일치 (Fisher 검증, Bayesian posterior 모두 매트릭 단위)
- 시드 단위 view derive로 조회 단순성 유지
- LLM 매트릭이 거절(`status='rejected'`)되어도 시드 카운트에 잔존하지 않음 (history 오염 방지)
- v2 PR #422 view 패턴 일관 (`saju_influence_summary` ← view 패턴 → `pattern_summary`)

### 단점 / 제약

- view 조회 시 매번 GROUP BY 집계 비용 (다만 매트릭 수가 시드의 1\~5배 수준이라 무거움 X)
- 매트릭 1행이 검증 단위가 되므로, "동일 시드를 다른 window로 평가하는 매트릭 N개"가 검증에서 별개로 취급됨 (의도된 동작)

### 후속 작업

- [ ] Phase 1 migration에 hit/miss/inconclusive 컬럼 추가 (`pattern_metrics`)
- [ ] `pattern_summary` view 작성
- [ ] 매칭 cron이 매트릭 카운트 UPDATE하도록 수정
- [ ] 기존 시드의 카운트 backfill — catalog 카운트 → metric 카운트 이전 (Phase 1)

---

**참고 자료**

- [ADR-0020](0020-fortune-system-responsibility-split-via-view.md) — view 인터페이스 패턴 원본
- [ADR-0019](0019-saju-hypothesis-verification-pipeline.md) — Fisher + BH-FDR 검증 입력 정의
