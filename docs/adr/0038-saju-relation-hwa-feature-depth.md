# 0038. 사주 관계·합화 변환 feature 깊이 — 검증 결정론(v1a)·해석 LLM 분리 + FDR 가족 확장

- Status: Accepted
- Date: 2026-06-05
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#487](https://github.com/hyewon3938/slack-ai-agents/issues/487), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (§3 feature substrate·§4 graded main effect), [ADR-0032](0032-metric-first-verification-statistics.md) (통계 스택), [ADR-0036](0036-relative-quantile-strength-bands.md) (상대 분위수 밴드), [ADR-0037](0037-verification-fdr-family-split.md) (FDR 가족 분리)
- Tags: insight, statistics, architecture, saju

## Context

P4b(#487)가 P4(결정론 사주 feature 엔진)의 후반을 맡아 **관계(합충형해파+원진·귀문·암합)·합화·십성 remap**을 인코딩한다. 세 가지를 정해야 한다:

1. **합화를 강도에 어떻게 반영하나.** 합화(천간합/육합/삼합이 化신 지지를 얻어 오행으로 변환)는 명리적으로 원국·운의 *실효 강도 지형*을 바꾼다(化 오행↑, 원재료 오행↓). P4a([ADR-0036](0036-relative-quantile-strength-bands.md)) 강도 엔진은 raw 글자 오행으로만 계산해 합화를 무시한다.
2. **합충 상호작용을 얼마나 깊이 결정론으로 푸나.** 충개합(충이 합을 깸), 탐합망충(합이 충을 푸는 역방향), 쟁합/투합(다중 합 경쟁), 형·파의 합 약화, 글자 거리/위치 — 깊이가 사실상 무한하고 전부 학파 의존이다.
3. **이 정밀도를 검증과 해석 중 어디에 둘 것인가.** 시스템엔 두 소비자가 있다 — off-day 통계 *검증* 엔진(P2·P3)과, 아침 일운 *해석* narrative(weekly-fortune LLM → daily-insight).

제약: n=1, 누적 \~90일. 헌장 ④(미리 구현·데이터 게이트 자동 활성)·⑤(규칙 파라미터화)·①(LLM은 facts 해석만, 생성 금지)·②(off-day 대조)와 [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) §3·§4 위에서 결정한다.

## Decision

### 1. 합화 = 실효강도 엔진 입력단의 공통 변환 pass (별도 시드 아님)

합화를 별도 boolean 시드로 만들지 않고, `saju-strength`가 글자를 tally하기 **전에 합화 변환 pass를 1회** 돌린다. 化신 통근 게이트로 化 성립을 판정하고, 성립한 합의 구성 글자 오행을 化 오행으로 치환한 뒤 강도를 계산한다. 그 결과 **강도·분위수 밴드·절대 신강/신약·효과적 십성이 전부 변환된 글자 기준으로 일관 계산**된다. 합화는 한 번 계산되고 거기서 두 렌즈(magnitude=강도, role=십성)가 파생되므로 같은 사건의 이중 인코딩(FDR 낭비)이 아니다.

### 2. 합충 해소 깊이 = v1a (합 성립 + 충개합), 그 너머는 노브/후속

켜는 깊이는 **합 성립(化신 통근) + 충개합(직접 충이 합 멤버를 치면 합 무효)** 까지다. 탐합망충·쟁합/투합·형/파의 합 약화·글자 거리/위치는 **파라미터 노브(기본 off)** 로 두고, 합충 해소 step을 함수로 분리해 rewrite 없이 추가 가능하게 한다. 나중에 켜는 것은 노브 + SET 전체 리플레이([ADR-0034](0034-evalue-construction-replay-test-martingale.md))로 전 이력 소급 적용된다.

### 3. 검증=결정론 얕게 / 해석=LLM 깊게 (책임 분리)

깊은 합충 정밀도는 **검증이 아니라 해석에 둔다.** off-day 통계 검증은 v1a 결정론 facts로 얕게 한다. 깊은 명리 해석(학파 의존 상호작용)은 narrative LLM(weekly-fortune)이 결정론 facts를 grounding으로 받아 hedged로 추론한다. **결정론 deep 해석 엔진은 만들지 않는다.** 이는 헌장 ①의 경계(LLM은 주어진 facts를 해석, 새 facts·패턴 생성 금지)를 그대로 적용한 것이다 — 합충 *facts*(getRelations: 합·충·형·파·해·삼합·육합·암합 + 합화오행)는 결정론이 주고, *해석*은 LLM이 한다.

### 4. 효과적 십성 시드 (새 trigger 타입)

십성 remap은 합화의 결과다(원래 십성은 기존 stem/cumulative 트리거가 이미 잡는다). 따라서 합화 변환 후 化 오행의 일간 대비 십성을 검정 시드로 둔다 — 새 trigger 타입으로, 합화 변환 pass와 같은 계산에서 파생한다. 합화(원인)와 십성(의미)이 한 변환에 묶인다.

### 5. FDR 가족 확장 — `saju_relation` 신규

관계·효과적 십성 시드를 **자체 BH-FDR 가족(`saju_relation`)** 으로 둔다. 합화를 반영한 강도 시드는 기존 `saju_strength` 가족을 유지한다(시드 수 불변, 값만 정밀화). 기존 풀(`life_signal`·기존 사주·태그)은 `baseline`. 2→3가족이며, [ADR-0037](0037-verification-fdr-family-split.md)이 명시한 "2가족으로 시작, 필요 시 후속 분할"의 연장이다 — 자동 생성 관계 batch(070 + 귀문/암합)가 빠른 `life_signal` 확정을 늦추지 않게 격리한다.

## Alternatives considered

### 합화 깊이

- **v1c 깊은 결정론 엔진** (충개합 + 탐합망충 + 쟁합/투합 + 형파 + 거리): 기각. n=1 \~90일에서 깊은 레이어는 밴드 발현일을 각자 2\~3일 뒤집는 수준이라 off-day 2×2·e-value가 v1a와 v1c를 **구분할 검정력이 없다(unidentifiable)** — 검증 못 하는 정밀도를 비용만 내고 떠안는다. 더 결정적으로, 각 규칙이 학파 의존 선택지라 "유효한" config 공간이 거대해져 패턴을 살리는 config를 (무의식적으로라도) 고를 **연구자 자유도**가 폭발한다 → 시스템 존재 이유(데이터로 자기기만을 거름)를 뒷문으로 무너뜨린다.
- **v1b 합 성립만** (충개합 무시): 기각. 동적 운이 정적 원국 합을 깨는 흔한 경우(충개합)를 놓친다 — 충개합은 충실도 대비 비용이 가장 좋은 첫 확장이라 v1에 포함.

### 합화의 강도 반영 방식

- **X — 합화 강도 무관, 십성 boolean만**: 기각. 합화가 실제로 강도를 바꾸는데 무시 + 십성 remap이 합화와 분리돼 의미가 약해진다. (단 정적 원국 합화는 모든 날 같은 상수를 더해 *상대 분위수 밴드*엔 거의 무영향이라, X의 검정 왜곡은 작다 — 그럼에도 동적 운 합화·절대상태·십성 일관성을 잃는다.)
- **Y — 합화 별도 모디파이어 시드**: Z에 흡수. 입력단 공통 변환이 더 깔끔하고, 강도·십성을 한 변환에서 파생해 중복 검정을 피한다.

### FDR 가족

- **관계 시드를 baseline 편입**: 기각. 자동 생성 batch라 baseline m을 키워 빠른 트랙을 과세한다([ADR-0037](0037-verification-fdr-family-split.md) 정신 위반). 관계가 sparse해 압력이 약하긴 하나, 사전 등록 batch = 가족이 정직한 회계.

## Consequences

### 장점

- 합화의 두 채널(강도·십성)을 한 결정론 변환으로 일관 포착하면서 새 통계 코어 0([ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) §4).
- "한번 셋팅" 욕구를 파라미터 노브 + SET 리플레이로 안전 실현(헌장 ④·⑤) — 깊은 규칙을 지금 안 켜도 미래 비용은 노브이지 rewrite가 아니다.
- 자기기만 자유도를 검증에서 얕게 묶고, 해석 깊이는 LLM의 hedged 추론에 맡겨 false precision을 피함.

### 단점 / 제약

- 합화 변환 pass가 P4a 강도 *값*을 바꿔 strength_band 컷·활성 시리즈가 변동한다(주간 엔진 SET 자동 재계산, \~90일·confirmed 0이라 실손 ≈ 0). P4a 강도 시드의 의미가 "raw 강도"에서 "합화 반영 강도"로 정밀화됨.
- 깊은 합충 해석을 narrative LLM에 의존 — 헌장 ① 경계(facts 해석만) 안에서만 안전. LLM이 facts를 넘어 패턴을 생성하지 않게 grounding을 강제해야 함.
- 3가족은 전역 FDR보다 약간 느슨(가족 늘수록 가족당 거짓발견 여지↑) — n=1 "연관 not 인과" 맥락에서 수용. 가족 경계는 사전 고정(파생 규칙), 추가는 의식적 결정 + 기록.
- 합화 성립 조건(통근 게이트·충개합)은 해석적이라 명시·문서화·파라미터로 조정 가능하게 유지.

### 후속 작업

- [ ] `saju-strength` 합화 변환 pass + 파라미터(化 통근 게이트, 충개합) — 단위 테스트.
- [ ] 효과적 십성 trigger 타입 + `evaluateTrigger`/`computeSeedActivationSeries` 경로.
- [ ] `relation_type` CHECK에 귀문·암합 추가 + 대표 쌍 데이터 + 070 패턴 auto-gen 시드.
- [ ] 고현저 관계 큐레이트 링크(객관 신호 × 양의 연관) + RAISE 검증 블록.
- [ ] `familyOf`에 `saju_relation` 추가 + 테스트.
- [ ] 깊은 합충 노브(탐합망충·쟁합·형파·거리) 기본 off로 선언(헌장 ④ 미리 구현, 활성은 데이터 게이트/후속).
- [ ] narrative raw facts 주입(weekly-fortune)은 별도 follow-up 이슈로(P4b 범위 외).

---

**참고 자료**

- [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) §3 (결정론 feature substrate) · §4 (graded main effect, 상호작용 항 불요)
- [ADR-0037](0037-verification-fdr-family-split.md) (FDR 가족 분리 메커니즘)
- [design-notebook Phase 4b](../design-notebook/metric-first-verification.md)
