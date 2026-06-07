# 0036. 강도 feature 밴드를 상대 분위수로 정의 — n=1 자기 패턴 발견

- Status: Accepted
- Date: 2026-06-05
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#485](https://github.com/hyewon3938/slack-ai-agents/issues/485), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (§4 graded 레벨), [ADR-0032](0032-metric-first-verification-statistics.md) (검정 통계), [ADR-0034](0034-evalue-construction-replay-test-martingale.md) (e-value 결정론 리플레이)
- Tags: insight, statistics, architecture

## Context

P4a(#485)가 결정론 사주 강도(일간 신강/신약 + 오행 5강도)를 graded 밴드 시드로 만든다. [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) §4는 "graded ordinal 레벨 + 레벨별 main effect"를 정했지만 **레벨 경계를 어떻게 긋는지**는 미결로 남겼다. 두 길이 있다:

- **절대 명리학 기준**: 신강/신약 이론 임계로 약/적정/강.
- **상대 분위수**: 그 사람 자신의 강도 분포를 약/적정/강 3등분.

선택이 전체 강도 시드의 의미·저장 구조·검정 가능성을 좌우하므로 ADR로 박는다.

## Decision

검정 시드의 밴드는 **사용자 자신의 강도 분포에 대한 상대 분위수(3등분)** 로 정의한다. 절대 명리학 신강/신약 상태는 **병행 계산해 보존**하되 검정 시드로는 쓰지 않는다(맥락 라벨·향후 활용).

**결정 규칙(한 줄)**: 남과 비교하는 시스템이면 절대 기준, **자기 안에서 패턴을 발견하는 시스템이면 분위수**. 본 시스템은 후자(n=1 자기 종단).

근거 셋:

1. **목적 정합**: n=1은 "내 강도가 *나 기준* 강한 날 vs 약한 날"의 대비가 의미 단위. 절대 보편 척도는 타인 비교용이다.
2. **일별 변동 포착(핵심)**: 강도는 원국(정적)이 대부분이고 매일 바뀌는 건 일운 2글자뿐(월운은 한 달 단위). 절대 컷은 원국이 컷에서 앉은 위치에 휘둘려 — 원국이 컷 위/아래로 멀면 매일 한 밴드로 쏠려 off-day 대조가 죽는다. 분위수는 일운이 만드는 일별 변동을 항상 3등분해 포착한다.
3. **죽은 밴드 회피**: 절대 컷에선 구조적으로 결핍·과다한 오행이 영영 특정 밴드에 못 들어 발현일 0(죽은 시드)이 되거나, 반대로 한 밴드에만 쏠린다. 분위수는 각 밴드 \~1/3을 보장 → off-day 통계력 균형.

구현 정합:

- 밴드 컷은 **주간 검증 엔진이 윈도우(raw 재계산)에서 분위수로 산출**하고, 일별 cron은 저장된 컷으로 "오늘 밴드"를 판정한다. SET 전체 재계산([ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) §2)이라 결정론 리플레이([ADR-0034](0034-evalue-construction-replay-test-martingale.md) e-value)와 정합 — 같은 윈도우 → 같은 분위수 → 같은 밴드 → 같은 day 시퀀스.
- 윈도우가 롤링하며 컷이 주마다 미세 이동하지만, 매주 전체를 새로 리플레이하므로 증분 드리프트 없음(주 내 일관).

## Alternatives considered

### A. 절대 명리학 기준 (신강/신약 이론 임계)

- 장점: 명리학 의미 보존. 매일 독립 판정(윈도우 불요, 기존 per-day trigger 경로). 발현 정의가 데이터 누적과 무관하게 안정.
- 단점: (1) 정적 원국 속성을 매일 outcome에 대보는 셈이라 일별 변동 거의 없음 → 한 밴드 쏠림으로 off-day 대조 붕괴. (2) 구조적 결핍/과다 오행은 죽은 밴드. (3) 컷이 임의 이론값(학파 의존).
- 기각: n=1 자기 패턴 목적에 정합 안 함. 검정 대상은 "타인 비교"가 아니라 "자기 변동"이다.

### B. (선택) 상대 분위수 3등분

- 장점: 목적 정합 + 일별 변동 포착 + 밴드 균형(죽은 시드 없음) + 임의 컷 없음(자가보정, 헌장 ⑤).
- 단점: "신강 밴드"가 절대 신강이 아니라 *상대 상위 1/3*(라벨 해석 주의). 윈도우 2-pass 평가(값→분위수→밴드)로 기존 per-day 독립 평가보다 한 겹. 초기 데이터 적을 때 분위수 노이즈(단 그 구간은 어차피 insufficient).

## Consequences

### 장점

- 강도 feature가 일운 변동을 검정 가능한 신호로 노출. 일운-only 맥락에서 운레벨 강도로 확장.
- 절대 상태 병행 보존 → 향후 "절대 강도 × 체감 데이터" 교차 분석 여지(헌장 ④ 미리 계산).

### 단점 / 제약

- 밴드가 윈도우 의존이라 강도 시드의 "발현 정의"가 데이터 누적과 함께 미세 이동(SET 리플레이로 주 내 일관성은 보장). 절대 시드보다 해석에 한 겹.
- 2-pass 평가가 강도 시드에 한해 엔진 경로를 추가(2×2/통계 코어는 불변).

### 후속 작업

- [ ] 주간 엔진: 강도 시리즈 → 분위수 컷 산출 + 저장 + 밴드 활성 시리즈.
- [ ] 일별 cron: 저장된 컷으로 오늘 밴드 판정(recent tier).
- [ ] 절대 신강/신약 상태 계산 함수(병행, 검정 비사용).
- [ ] 분위수 등분 수(3) calibration은 운영 후 재검토(튜닝 노브).

---

**참고 자료**

- [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) §4 (graded ordinal 레벨)
- [design-notebook Phase 4a](../design-notebook/metric-first-verification.md) (상대 vs 절대 서사)
