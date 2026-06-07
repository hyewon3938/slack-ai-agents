# 0041. 교란 플래그 — marginal 공동발현 overlap 탐지 + annotate-only (P6/P7 분리)

- Status: Accepted
- Date: 2026-06-06
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#493](https://github.com/hyewon3938/slack-ai-agents/issues/493), [ADR-0032](0032-metric-first-verification-statistics.md) (§6 교란 데이터 게이트), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (feature 환원), [ADR-0037](0037-verification-fdr-family-split.md) (FDR 가족)
- Tags: insight, statistics, architecture

## Context

off-day 대조 검증(P2)은 "시드 발현일 vs 비발현일"에서 신호 발현율을 2×2로 비교해 **단일 시드의 marginal 연관**만 본다. 그런데 같은 날 공존하는 제3변수가 시드와 신호 둘 다를 끌면 가짜 연관(교란, confounding)이 생긴다. 두 부류:

- **달력 주기**: 요일·주말·월 위치·계절·공휴일. 사주 시드가 우연히 주말에 자주 켜지고 신호도 주말에 높으면, 그 연관은 시드가 아니라 주말의 효과일 수 있다("어부지리").
- **공존 사주 시드**: 같은 날 다른 사주 시드가 같이 켜져서, 진짜 원인은 그쪽인데 이 시드에 공이 돌아가는 경우.

[ADR-0032](0032-metric-first-verification-statistics.md) §6은 교란을 데이터 게이트 자동 활성으로 위임했다 — 두 시드 공동발현 횟수가 임계(\~30일) 넘으면 다변량(elastic-net) 분리 자동 on, **그 전엔 "교란 의심" 플래그만**. 본 ADR은 그 **플래그 절반(Phase 6)** 을 확정한다. 다변량 분리(Phase 7, 데이터 게이트)는 본 ADR 범위 밖.

**헌장 cross-check 결과 — "feature 환원"이 이미 끝나 있다**: 교란변수(요일·계절·월 위치 등)가 이미 18개 `life_signal` 결정론 시드([072](../../db/migrations/072_life_signal_seed_pool.sql): 요일 7 + 주말/평일 2 + 월위치 3 + 계절 4 + 공휴일 2)로 존재한다. 즉 [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md)의 "운 레벨 modulation을 결정론 feature로 환원"이 달력 변수엔 #434 P3에서 이미 적용됐다. 교란 후보가 활성 시리즈를 갖는 시드라, 플래그는 **기존 off-day 프리미티브 재사용**으로 환원된다(P5a 발굴이 쓰는 그 시드/신호 시리즈).

## Decision

교란을 **새 통계 검정이 아니라 기존 off-day 프리미티브 재사용으로 푼다**(feature 환원/층화 노선, P4 결정론 feature 선례). Phase 6는 marginal 플래그까지, 추정치 *조정*(층화/다변량)은 Phase 7(데이터 게이트)로 분리한다.

### 1. 교란 후보 = 모든 공동발현 시드

`life_signal` 달력 18개 + 다른 active 사주 시드 전부를 후보로 둔다. 전부 결정론 활성 시리즈를 가지므로 후보 Z의 시리즈는 이미 계산돼 있다(발굴이 쓰는 active 시드 시리즈 공유). [ADR-0032](0032-metric-first-verification-statistics.md) §6 정의("다중 트리거 공존")와 Context 예시("편재·월말·주말 동시")에 충실 — 달력만이 아니라 사주끼리의 어부지리도 잡는다.

### 2. marginal 플래그 기준 (2조건)

링크 (시드 S × 신호 X)에 대해 후보 Z(≠S)가 둘 다 만족하면 "교란 의심"으로 기록한다:

- **(a) 공동발현 overlap**: `P(Z active | S active) ≥ confoundMinOverlap`, 그리고 공동발현일 수 `≥ confoundMinCofireDays`(노이즈 바닥). S가 켜질 때 Z도 대체로 켜진다.
- **(b) Z↔X 연관**: (Z active vs Z off) × (X pass/fail) 2×2의 rate ratio `≥ minRateRatio`. Z 자체가 신호와 연관돼야 교란원이 될 수 있다.

(a)만으론 부족하다 — 겹치기만 하고 신호와 무관한 시드는 교란이 아니다. 둘 다 기존 `buildContingency`/`verifyContingency` 재사용 → **새 통계 코어 0**.

### 3. annotate-only (정직 플래그)

플래그는 `pattern_links.confound` JSONB([077](../../db/migrations/077_signal_defs_and_links.sql)에서 선언만)에 기록하고 주간 검증 카드에 "교란 의심: {Z} 공존"으로 노출한다:

```json
{ "scannedAt": "2026-06-08",
  "suspected": [{ "seedId": 0, "seedName": "주말", "overlap": 0.0, "effectZX": 0.0, "nCofire": 0 }] }
```

**verdict·status·e-value·tier는 건드리지 않는다.** 추정치 보정·확정 취소는 Phase 7의 일이다. 플래그는 "이 연관은 Z와 겹쳐 어부지리일 수 있다"를 사용자에게 정직하게 알릴 뿐, 확정을 죽이지 않는다. `scannedAt`을 항상 기록해 "점검했으나 깨끗"과 "미점검"을 구분한다.

### 4. always-on (데이터 게이트 아님)

플래그 계산은 싸고(캐시된 시리즈 위 overlap + 2×2) marginal이라 데이터 적어도 valid → 매주 무조건 실행한다. `nCofire`를 기록해 Phase 7이 `≥ 임계(\~30일)`에서 다변량 분리를 자동 활성하게 한다([ADR-0032](0032-metric-first-verification-statistics.md) §6, 헌장 ④).

### 5. 노브 외부화 (헌장 ⑤)

`insight-thresholds.confound = { minOverlap, minCofireDays, minEffectZX, topN }`. `minEffectZX`는 `patternVerification.minRateRatio`(1.3) 승계. 값은 calibration 노브(첫 몇 주 튜닝).

## Alternatives considered

### A. 새 confound 전용 통계 검정 (partial correlation / 조건부 로지스틱)

- 장점: 한 번에 조정된 추정치까지.
- 기각: n=1 소표본 회귀 부담 + "새 통계 코어 0"(P4a/P4b/P5a 4연속) 이탈. 교란변수가 이미 결정론 시드라 회귀 없이 시드 overlap으로 충분. Mantel-Haenszel 층화·elastic-net 같은 *조정*은 Phase 7(데이터 게이트)로 미룬다.

### B. overlap만으로 플래그 (Z↔X 연관 검사 생략)

- 장점: 더 단순.
- 기각: 공동발현만 보면 신호와 무관한 시드까지 다 플래그돼 노이즈가 폭발한다. 교란의 정의상 Z는 신호와도 연관돼야 한다 → (b) 필수.

### C. annotate가 아니라 soft-demote (교란 의심 확정 링크를 검증됨→검증중 강등)

- 장점: 더 강한 보수성.
- 기각(Phase 6에선): 강등은 추정치 *판단*이라 Phase 7 다변량 분리의 결과로 해야 정직하다. marginal 겹침만으로 임의 강등하면 진짜 패턴을 죽일 위험. Phase 6 = 노출(정직), Phase 7 = 조정(데이터).

### D. 교란변수를 달력 18개로 한정

- 장점: 단순.
- 기각: [ADR-0032](0032-metric-first-verification-statistics.md) §6 정의가 "다중 트리거 공존"(시드 일반)이고 Context 예시도 사주+달력 혼합. 사주 시드끼리의 어부지리를 놓친다.

## Consequences

### 장점

- **새 통계 코어 0 · 마이그레이션 0**(077 `confound` 컬럼 재사용) — P5a/P5b 패턴 4연속 유지.
- 교란을 "데이터로만 가린다" 정신 위에서 정직하게 노출 — 확정을 숨기지도, 임의로 죽이지도 않는다.
- `nCofire` 기록으로 Phase 7 다변량 분리가 데이터 게이트로 자동 얹힌다(헌장 ④).

### 단점 / 제약

- marginal 플래그는 "겹친다"까지만 — Z를 통제하면 S 효과가 *실제로* 사라지는지는 Phase 7까지 미확정. 플래그 = 의심이지 판정 아님(카피에 명시).
- 달력 near-duplicate(주말 ≡ 토+일)는 중복 플래그 → 표시 단계 dedup·`topN` cap으로 완화.
- 교란 후보 스캔이 (claimable 링크 × active 시드)라 비용 증가 — 월 1회 n=1 수용, 배칭은 후속.

### 후속 작업

- [ ] **Phase 7**: `nCofire ≥ 임계` 시 층화/elastic-net 다변량 분리(데이터 게이트 자동 on) + daily-insight verified tier 교란 caveat(`saju_influence_summary` 재정의).
- [ ] 교란 후보 정책·임계 변경 시 ADR 갱신.

---

**참고 자료**

- [ADR-0032](0032-metric-first-verification-statistics.md) §6 (교란 분리 데이터 게이트), References의 Mantel-Haenszel·elastic-net
- [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (운 레벨 → 결정론 feature 환원)
