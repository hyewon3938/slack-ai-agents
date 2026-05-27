# 0026. `pattern_*` prefix 전면 rename — saju_signal_* 잔존 결정 폐기

- Status: Accepted
- Date: 2026-05-27
- Related: [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434), Supersedes [ADR-0022](0022-target-type-generalization.md)
- Tags: data, insight, architecture, refactor

## Context

ADR-0022는 마스터 #434(본인 1명 패턴 발견 시스템)의 target-type 일반화 결정을 기록하면서, 테이블명은 `saju_signal_catalog` 등 *역사적 명칭*으로 잔존시키기로 결정했다 (대안 C `signal_catalog` rename 기각).

그러나 본 마스터 build 진입 시점에 두 가지 문제가 드러났다:

1. **결정 자체가 사용자 의도와 어긋남** — ADR-0022 작성 직전 인터뷰에서 사용자는 `saju_` 접두어 제거 방향에 동의했으나, /compact 압축 단계에서 그 합의가 누락된 채 새 세션에 진입했고, 결과적으로 `잔존` framing이 단독으로 ADR에 박혔다. 사용자에게 옵션 선택을 명시적으로 묻지 않은 상태였음 (본 사건 회고: `docs/_personal/design-drafts/434-master-setup.md` "결정 reversal 사고")
2. **`saju_signal_` 어휘가 본 마스터 정체성과 불일치** — `life_signal` target_type을 추가하는 시점에 테이블명에 `saju_`가 잔존하면 의미적 부정확. 그리고 5어휘 모델(시드/매트릭/매칭/가설/검증) 중 `signal`만 강조되어 매트릭·매칭·가설·검증이 prefix에 묶이지 못함

문제:

- ADR-0022의 잔존 결정을 어떻게 폐기·전환할 것인가
- 새 prefix는 무엇을 표현해야 하는가 — 5어휘 모두를 자연스럽게 묶을 수 있어야 함
- 운영 자산(`saju_influence_summary` view body, 매칭 cron, shared 코드)을 어떻게 보존하며 rename할 것인가

## Decision

**`saju_signal_*` 어휘를 `pattern_*` 어휘로 전면 rename**. 본 마스터의 시스템 정체성("본인 1명 패턴 발견")을 prefix가 직접 표현하도록 한다. ADR-0022는 Superseded.

세부 매핑:

| 기존 | 신규 |
|------|------|
| `saju_signal_catalog` | `pattern_catalog` |
| `saju_signal_metrics` | `pattern_metrics` |
| `saju_daily_matches` | `pattern_matches` |
| `saju_hypotheses` | `pattern_hypotheses` |
| `saju_stats` | `pattern_stats` |
| `saju_signal_summary` (계획 중) | `pattern_summary` |
| 컬럼 `signal_id` (FK to catalog) | `pattern_id` |
| 컬럼 `trigger_target_type` | 유지 (이미 `trigger_` prefix 존재) |
| 컬럼 `trigger_target_id` | 유지 |
| (신규) `seed_kind` | `pattern_kind` |

`life_signal` target_type 자체는 ADR-0022의 일반화 결정 그대로 유지 (네이밍만 `life_signal`로 보존 — 출처를 표현하므로 의미적). `target_type` enum 확장 방법은 실제 스키마가 TEXT CHECK constraint이므로 CHECK constraint 갱신으로 처리 (ADR-0022 본문의 `ALTER TYPE` 어휘는 정정 필요).

마이그레이션 전략 (Phase 1):

1. `ALTER TABLE ... RENAME TO ...` (5 테이블 + 1 view 신설)
2. `ALTER TABLE pattern_matches RENAME COLUMN signal_id TO pattern_id` 등 FK 컬럼 rename
3. 마스터 A의 `saju_influence_summary` view body 재정의 (`pattern_*` 어휘로 SELECT, 외부 contract는 view 이름 그대로 유지)
4. 코드 변경: `src/agents/insight/*`, `src/cron/*`, `src/shared/*`의 테이블·컬럼 참조 일괄 교체

## Alternatives considered

### A. `saju_signal_*` 잔존 (ADR-0022 안)

- 장점: 마이그레이션 비용 0
- 단점:
  - 테이블명이 본 마스터 정체성과 불일치 (`life_signal` 들어와도 `saju_signal_`)
  - ADR-0022의 잔존 결정이 사용자 의도와 어긋났던 압축 사고로 입력된 framing이었음
- 기각 이유: 의미 불일치 + 결정 자체의 정당성 부재

### B. `seed_*` prefix (시드 강조)

- 장점: 시드가 모든 entity의 출발점이라 시작 어휘로 자연스러움. 코드 가독성 ↑
- 단점:
  - 매트릭·매칭·가설·검증은 시드"에서 파생"이지 시드 자체 아님. `seed_hypotheses`는 *가설이 시드의 일부*라는 잘못된 인상
  - 향후 잔소리(노출 layer) entity 도입 시 `seed_nag_log` 같은 이름이 의미적으로 어색
- 기각 이유: 5어휘 중 한 어휘에 종속됨. 시스템 정체성 표현 약함

### C. `pattern_*` prefix (선택)

- 장점:
  - 시스템 정체성 직접 표현 — 본 시스템은 "패턴을 발견·평가·검증·노출하는 시스템"
  - 5어휘 모두 *패턴을 다루는 단계*로 자연스럽게 묶임 (매트릭은 패턴 평가 방법, 매칭은 패턴 발현 기록, 가설은 패턴 후보, 검증은 패턴 신뢰도)
  - 향후 잔소리·우선순위·반응 추적 entity 추가 시 (예: `pattern_nag_log`) 자연스럽게 확장
  - 도메인 이름(insight)이 애매한 상태이지만 *테이블 prefix*가 시스템 정체성을 표현하므로 도메인 이름 변경 작업과 분리 가능
- 단점:
  - 본 마스터 시점에 검증된 패턴 N건은 0개 (시작 시점에 "발견 중인" 시스템) — prefix가 미래형
  - rename 마이그레이션 + 코드 일괄 변경 비용
- 채택 이유: 정체성 표현 가치 > 미래형 단점 + 마이그레이션 비용

## Consequences

### 장점

- 테이블·컬럼 어휘가 시스템 정체성과 일치 (코드만 봐도 "패턴 시스템"임이 명확)
- 5어휘 모두 prefix로 자연 묶임 — 매트릭·매칭·가설·검증 모두 `pattern_*` 안에 위치
- `life_signal` target_type 추가가 테이블명과 충돌하지 않음 (catalog가 사주 전용이라는 인상 사라짐)
- 향후 잔소리·우선순위 entity 도입 시 prefix 확장 자연
- ADR-0022의 미신뢰 framing을 정직하게 폐기 + ADR-0026이 사용자 명시 합의 위에서 작성됨

### 단점 / 제약

- Phase 1 마이그레이션이 *rename + 컬럼 추가 + view 신설 + view body 재정의*를 동시에 처리해야 함 (트랜잭션 분리 설계 필요)
- 코드 변경 범위 광범위 — `src/agents/insight/*`, `src/cron/daily-saju-matching.ts`, `src/cron/weekly-hypothesis-review.ts`, `src/shared/saju-match.ts`, `src/shared/saju-hypothesis.ts`, `src/shared/insights.ts` 일괄 교체
- `saju_influence_summary` view (마스터 A 운영 중)의 body 재정의 필요 — view 이름·컬럼 contract는 유지하되 SELECT 안 어휘는 `pattern_*`로 변경
- ADR-0023 본문 SQL의 컬럼 어휘가 ADR-0026 어휘로 정정 필요 (오탈자 범위 정정으로 처리, Decision 의도는 유지)
- 향후 사주 도메인 기능(원국·일운·세운 등 사주 계산 자체)이 다시 분리될 가능성을 본 prefix가 가리지 않음 — `saju_*`는 *사주 계산 도메인*(`saju_profiles`, `fortune_analyses` 등), `pattern_*`는 *패턴 발견 시스템*으로 분리

### 후속 작업

- [ ] Phase 1 migration: 테이블 rename 마이그레이션 작성 (전 단계 정합성 우선)
- [ ] Phase 1 migration: 컬럼 추가 마이그레이션 (description, window_days, hit/miss/inconclusive, status, source, posterior_alpha/beta/p, pattern_kind)
- [ ] Phase 1 migration: `pattern_summary` view 신설
- [ ] Phase 1 migration: `saju_influence_summary` view body 재정의 (view 이름·컬럼 contract 보존)
- [ ] 코드 변경: src/agents/insight/, src/cron/, src/shared/ 의 테이블·컬럼 참조 일괄 교체
- [ ] ADR-0022 Status → Superseded by ADR-0026
- [ ] ADR-0023 본문 SQL 어휘 정정 (오탈자 범위, 결정 의도는 동일)
- [ ] design-notebook `personal-pattern-discovery.md` 전면 어휘 정정
- [ ] domain doc `insight.md` Section 14~21 TODO 마커 어휘 정정

---

**참고 자료**

- [ADR-0022](0022-target-type-generalization.md) — Superseded. 본 ADR로 결정 전환
- [ADR-0023](0023-metric-unit-counter-and-summary-view.md) — Decision 의도 유지, 어휘만 정정
- 결정 reversal 사고 회고: `docs/_personal/design-drafts/434-master-setup.md` (gitignored)
