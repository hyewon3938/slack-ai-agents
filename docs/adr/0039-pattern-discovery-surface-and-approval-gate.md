# 0039. 패턴 발굴 — surface-only 제안 + 사람 승인 게이트 (노출·큐레이션 vs 믿음 분리)

- Status: Accepted
- Date: 2026-06-05
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#489](https://github.com/hyewon3938/slack-ai-agents/issues/489), [ADR-0032](0032-metric-first-verification-statistics.md) (§2 발견/확정 q 분리), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (source=discovery), [ADR-0034](0034-evalue-construction-replay-test-martingale.md) (확정 게이트 e-value), [ADR-0037](0037-verification-fdr-family-split.md) (FDR 가족), [ADR-0019](0019-saju-hypothesis-verification-pipeline.md)·[ADR-0025](0025-llm-metric-approval-gate.md)·[ADR-0030](0030-llm-metric-suggest-input-and-cadence.md) (옛 발굴/승인 흐름 — 본 ADR이 pattern_links 모델로 재정의)
- Tags: insight, statistics, architecture

## Context

P4a·P4b가 결정론 사주 feature 시드(강도 밴드·관계·효과적 십성)를 다수 추가했으나, 그 중 다수는 큐레이트 링크 없이 **evidence-only**(활성 로그만 누적)로 남았다. 오행 밴드(토·금·수 전체 + 목/화 약·적정)·070 자동생성 관계 70개·대표 암합·일부 효과적 십성이 여기 해당한다. 주간 off-day 검증 엔진(P2·P3, `verifyUserLinks`)은 **`status='active'` 링크만** 검정하므로 — 링크 없는 이 시드들은 영영 검증되지 않는다. P4a·P4b 회고가 명시적으로 "P5 discovery가 시드×태그를 넘어 **시드×sql신호까지** 집어 올려야 한다, 안 하면 영영 검증 안 됨"으로 위임했다.

발굴을 어떻게 할지에 두 가지 긴장이 있다:

1. **손박기 vs 발견** — 십성 전체·관계 전수를 손으로 링크하면 1000+ speculative active 링크가 생겨 FDR을 낭비하고 헌장 ②(off-day로 발견)를 위반한다. 반대로 안 하면 evidence-only가 죽는다.
2. **"데이터로만 가린다" 헌장 vs 사람 개입** — 시스템 명제는 "기분탓·확증편향 없이 데이터로만 패턴을 가린다"인데, 발견된 후보에 사람 승인 게이트를 두는 게 이 명제와 충돌하는가?

옛 발굴/승인 흐름(ADR-0019 Fisher 발굴, ADR-0025·0030 LLM 매트릭 제안·승인)은 폐기된 `pattern_hypotheses`·`pattern_metrics` 모델 위에 있어 그대로 못 쓴다. pattern_links(시드×신호) 모델로 재정의가 필요하다.

## Decision

### 1. 발굴 = 여집합 그리드 off-day 스캔 (검증 프리미티브 재사용)

발굴은 **링크 없는 (시드 × 신호) 여집합**을 기존 off-day 2×2 엔진으로 스캔하는 것이다. 별도 발굴 로직을 만들지 않고 P2·P3 프리미티브(`computeSeedActivationSeries`·`computeSignalSeries`·`buildContingency`·`verifyContingency`·`blockPermutationP`·`bhFdrByFamily`)를 재사용한다. 시드 활성 시리즈는 시드당 1회, 신호 시리즈는 신호당 1회 계산(P1 전역화 payoff) — 검증이 쓰던 그 시리즈를 active 외 시드/신호까지 넓혀 미등록 쌍에 조인 + 2×2.

- 범위 = **active 시드 × active 신호 중 pattern_links에 (어떤 status로도) 없는 쌍**. 이미 active/confirmed/rejected/weak/pending/archived인 쌍은 제외(rejected 재부상·중복 방지).
- 신호는 **sql(객관 1차) + tag(주관 보조) 둘 다** — Phase 표 초안의 "시드×태그 전수"를 P4a·P4b 위임이 sql까지 확장하도록 정정(evidence-only 강도 밴드는 sql 신호로만 잡힌다). 강도 밴드 시드는 2-pass 분위수 활성을 그대로 받는다.
- 결과는 **연관/경향**(인과 아님, ADR-0032 §7).

### 2. surface-only — 발굴은 *제안*만, *확정*은 안 함 (2층 통제)

발굴의 출력은 **`status='pending'` pattern_link**이지 active/confirmed가 아니다. 다중검정·연구자 자유도는 두 층에서 통제한다:

- **발견 q 트랙**(느슨, `discoverQ`≈0.15) — *띄우기만* 한다. ADR-0032 §2의 "발견 q 느슨 / 확정 q 엄격" 분리. 발굴 후보 집합에 자체 BH-FDR을 돌리되 **FDR 가족 분리**(ADR-0037) 적용 — 강도 밴드 발굴이 빠른 baseline 발굴을 과세하지 않게. 확정 트랙(`verifyUserLinks`)의 FDR과 별도 풀.
- **확정 게이트는 여전히 엄격 e-value 트랙**(P3, ADR-0034) — 승인돼 active가 된 뒤에야, 그것도 `confirmQ`≤0.05 + 누적 e-value≥20을 넘겨야 confirmed. **거짓 발견의 비용 = 승인 카드 1장이지 거짓 믿음이 아니다.**
- 사전 고정 규칙(off-day 대조·신호 direction 고정·시드 고정)이라 "패턴을 보이게 만드는" 사후 노브가 없다 — 헌장 ②.

### 3. 사람 승인 게이트 — 노출·큐레이션 vs 믿음 분리

발굴 후보(pending 링크)는 **#insight 맥락 풍부 카드**로 제시하고 사람이 [추적 시작]/[패스] 버튼으로 게이트한다. pending→active는 **자동도 LLM 심판도 아닌 사람 승인** 한 경로.

- 카드는 *충분한 맥락*을 담는다: off-day 통계(발현일 vs 비발현일 pass율·effect·n·발견 q) + 시드/신호가 뭘 뜻하는지 평어 설명 + "승인 = 추적 시작, 진짜인지는 통계가 몇 주에 걸쳐 가린다 / 연관이지 인과 아님" 프레이밍.
- **명제 충돌 해소** — 사람은 *진실*을 판정하지 않는다. 사람이 게이트하는 건 **노출·큐레이션**("추적할 가치가 있나")이고, **믿음**("진짜인가")은 끝까지 e-value 트랙의 일이다. active/confirmed 링크가 daily-insight·주간 카드(`saju_influence_summary` tier)를 먹이므로, 게이트 없이 느슨한 q 발견을 자동 활성하면 미검증 연관이 "emerging(검증중)"으로 조기 노출된다. 사람 게이트는 그 노출만 막고, 통계는 여전히 데이터로만 가린다.

## Alternatives considered

- **자동 활성(통계가 심판, 게이트 없음)** — 마찰은 적으나 느슨한 q 발견이 active로 직행해 emerging tier 조기 노출 + 주간 카드/링크 스팸. "데이터로만"에 더 충실해 보이나, 노출 통제를 잃는다. 기각(게이트 = 노출만 통제, 믿음은 여전히 통계).
- **LLM 선별 후 승인** — LLM이 후보의 도메인 타당성 1차 선별. v2 헌장 ①(LLM 텍스트 의존 최소화) 긴장 + LLM이 데이터 판정을 덮어쓸 위험. 기각 — LLM은 *기존 데이터를 심판*하지 않는다. LLM은 *새 신호를 생성*하는 P5b 트랙에만(거기선 생성이지 판정이 아님).
- **손박기 mass-wiring**(십성·관계 전수 링크) — 1000+ speculative active 링크 → FDR 낭비 + 헌장 ② 위반. 기각 — 발굴이 off-day로 데이터에서 띄운다.
- **옛 standalone `discoverCandidates`**(폐기 스키마, 시리즈 로직 중복) — pattern_links 모델·검증 프리미티브 재사용으로 대체.
- **시드×태그 전용**(Phase 표 문자 그대로) — evidence-only 강도 밴드(sql 신호 필요)를 영영 못 잡음 → P4a·P4b 위임 실패. 기각, sql까지 확장.

## Consequences

### 장점

- evidence-only 결정론 feature 시드가 데이터 기반으로 검증 트랙에 연결됨(P4a·P4b 위임 해소).
- 발굴이 검증 프리미티브를 재사용 → 새 통계 코어 0, 시리즈 계산도 공유.
- 2층(surface q / 확정 e-value) + 사람 큐레이션이 다중검정·조기노출·자기기만을 각각 막음.
- 승인 게이트 인프라(맥락 카드 + pending→active 액션)를 P5b(LLM 신호 제안)가 재사용.

### 단점 / 제약

- 여집합 스캔은 active 시드/신호 전부의 시리즈를 계산(검증보다 무거움) — n=1·주간이라 수용, 배칭은 후속 최적화.
- pending 링크가 미승인 누적될 수 있음 → top-N cap(주당 surface 상한) + 발굴 노브(`discoverQ`·min-active·min-effect·topN) 외부화로 관리(헌장 ⑤ 튜닝 노브).
- 발굴은 **주변(marginal) 연관**만 — 공존 시드 교란(어부지리) 분리는 P6 플래그/P7 데이터 게이트.
- 발견 q는 전역보다 느슨 — surface 전용이고 확정은 엄격 e-value가 잡으므로 수용.

### 후속 작업

- [ ] 발굴 스캐너: 여집합 enumerate → 시리즈 재사용 → 가족별 발견 BH-FDR(`discoverQ`) → min-active/min-effect/top-N → pending 링크 INSERT.
- [ ] 맥락 카드 빌더 + pending→active 승인 액션(pattern_links, `{linkId}` payload).
- [ ] 주간 cron 통합(검증 후 발굴).
- [ ] P5b가 LLM 신호 제안에 같은 승인 게이트 재사용.

---

**참고 자료**

- [ADR-0032](0032-metric-first-verification-statistics.md) §2 (발견/확정 q 분리), §7 (연관 not 인과)
- [ADR-0037](0037-verification-fdr-family-split.md) (FDR 가족 분리)
