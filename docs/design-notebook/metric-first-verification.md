# 매트릭 중심 패턴 검증 — 정량 신호를 가설 검증의 1차 축으로

> 마스터 이슈: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477)
> 시작: 2026-06-04
> 상태: 설계 중 (데이터 모델 인터뷰 단계)
> Successor of: 마스터 [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434) (본인 1명 패턴 발견 시스템) — 검증 축 재정의

## 개요

마스터 #434는 시드 → 매트릭 → 매칭 → 가설 → 검증 5어휘 위에 패턴 발견 시스템을 세웠다. 그러나 explainer 정합성 점검(#474) 중, 구현이 **설계 의도와 역전**돼 있음이 드러났다:

- 가설 발굴·검증·잔소리가 **일기에서 추출한 주관적 enum 태그(diary_meta_tags)** 만 outcome 축으로 쓴다.
- 객관 정량 매트릭(일정·수면·루틴·지출 카테고리 SQL)의 hit/miss는 **시드 큐레이션 신호로만** 쓰이고 가설·확정·알림 경로 밖에 있다.
- 의도는 "정량 매트릭이 1차, 일기 태그는 보조"였고, design-notebook(#434) L609에 "metric 카운터를 outcome으로" 확장이 known gap으로 이미 식별돼 있었다.

게다가 #434 컨텍스트 도메인 헌장은 `diary`를 "텍스트 의존도↑"로 **제외**했는데(v2 헌장 ① 계승), 정작 outcome 축이 그 제외 대상인 diary였다. 즉 현 구현은 의도뿐 아니라 **헌장과도 긴장 상태**. 본 마스터는 이를 바로잡아 정량 매트릭을 검증의 1차 축으로 올린다.

## 핵심 원칙 — 자체 헌장 (변경 불가, 변경 시 ADR)

v2 헌장 4개 + 마스터 #434 헌장 5개를 계승한다 (본문 복제하지 않음 — [#434 design-notebook 핵심 원칙](personal-pattern-discovery.md) + [project_insight_v2_core_principles 메모리](../../.claude/projects/-Users-ihyewon-slack-ai-agents/memory/project_insight_v2_core_principles.md) 참조). 그 위에 본 마스터의 재정의·추가 4개를 둔다.

### 1. 정량 매트릭이 1차 검증 축, 일기 태그는 보조

검증의 중심 단위는 **매트릭**이다. 매트릭은 "시드가 켜진 날 이런 일이 일어난다"는 검증 가능한 명제이고, 두 종류를 가진다 — **SQL 매트릭**(객관: 지출·수면·루틴·일정 등 정량 평가)과 **태그 매트릭**(주관: 일기 enum 태그 존재 확인). SQL 매트릭이 객관이라 1차, 태그 매트릭은 보조. 이는 #434 헌장 ②(5어휘 분리)의 재정의다 — `매트릭`이 곧 검증 단위이고 `가설`은 별도 엔티티가 아니라 (시드 × 매트릭) 쌍 자체이며, 기존 `outcome`(일기 태그)은 매트릭의 한 종류로 흡수된다. → **[ADR-0033](../adr/) 예정** (5어휘 재정의).

### 2. off-day 대조가 증명의 핵심

"시드 켜진 날만 본다"로는 증명이 안 된다. 시드 켜진 날의 신호 발현을 **안 켜진 날(baseline)과 대조**해야 "진짜 패턴"과 "원래 자주 그럼 / 기분탓"을 가를 수 있다. 따라서 신호(SQL·태그 공통)는 시드와 무관하게 **매일 측정**하고, 검증은 트리거 발현일 vs 비발현일 대조로 한다. "시드 켜진 날에 측정한다"의 진짜 의미는 "그 시드에 지정된 테마를, 시드 활성 여부를 조건으로 검증한다"이지 당일 데이터만 본다는 게 아니다.

### 3. 통계 스택 = ADR-0032 (인과 아닌 연관)

검증 통계는 [ADR-0032](../adr/0032-metric-first-verification-statistics.md)로 확정 — Fisher + block permutation / BH-FDR(발견·확정 분리) / Beta-Binomial + e-value(순차 검정 거짓양성 통제) / 연속 신호 Mann-Whitney + 효과크기 / empirical-Bayes 수축. n=1 관측 데이터이므로 모든 노출은 "연관/경향"으로, "인과" 주장 금지.

### 4. 후속 미루지 않기 — 데이터 게이트 자동 활성

데이터 누적이 필요한 기능(교란 분리·EB 수축 등)도 **별도 후속 phase로 미루지 않고 미리 구현**, 데이터가 임계를 넘으면 **스스로 활성**되게 한다. 수동 재진입이 필요한 "나중에 할 일"을 남기지 않는다.

## 통계 스택을 다시 고른 이유 (서사)

기존 3종(Fisher + BH-FDR + Beta-Binomial)을 그대로 쓸지 점검하기 위해, 본 구조(n=1·일별·다중 트리거 공존·이진/연속 신호·매일 누적+주간 점검)에 맞는 방법을 별도 조사했다. 핵심 발견:

- **"확신도 높으면 알림" = optional stopping**이고, Bayesian posterior도 이 함정에 면역이 아니다(고정 임계 stop-on-success는 거짓양성 누적). → **누적 e-value(test martingale)** 도입이 정공법. "데이터로 기분탓을 거른다"는 전제를 지키려면 이 보강이 필수.
- 연속값 이진화는 정보 ≥ 36% 손실 → Mann-Whitney + 효과크기로 원시값 비교.
- 일별 자기상관이 Fisher를 anti-conservative하게 만듦 → block permutation 보완.
- BH-FDR은 안정성 때문에 유지(Storey·knockoffs 불필요).

결정·기각 대안·출처 14개 전부 [ADR-0032](../adr/0032-metric-first-verification-statistics.md)에 정본 보관. explainer §8(통계)은 빌드 후 ADR-0032를 요약·링크한다.

## Phase 윤곽 (데이터 모델 설계 후 확정)

> 아직 확정 전. 데이터 모델 인터뷰 결과에 따라 조정.

1. **데이터 모델** — 신호 매일 측정 + baseline, SQL·태그 매트릭 통합, pattern_matches 구조 변경, 라이프사이클(활성/후순위/비활성)
2. **통계 엔진** — e-value·block permutation·Mann-Whitney·empirical-Bayes 추가 + null 시뮬레이션 검증
3. **발굴** — LLM 제안(열린 공간: 새 SQL·태그 매트릭) + 통계 전수 스캔(고정 어휘 태그), 승인 게이트
4. **큐레이션·알림** — 확신도 기반 매트릭 관리, 초개인화 잔소리(고-확신 매트릭 우선)
5. **교란 분리·수축** — 데이터 게이트 자동 활성

## 의사결정 분기점 — 마스터 setup 단계

> Phase별 분기점은 각 Phase 섹션에서 추가.

1. **범위** — 새 마스터 #477 신설 (vs #434 후속 단일 이슈 / 부록 E 묶음 편입). 모델 재정의 + 통계 + 데이터 모델 변경이 묶여 phase 다수 → 새 마스터.
2. **모델 재정의** — 매트릭 1차 / 일기 태그 = 매트릭 subtype / 가설 = (시드 × 매트릭) 쌍 (vs 현행 별도 파이프라인 유지). 의도·헌장 정합 위해 재정의.
3. **off-day 측정 수용** — 신호 매일 측정, 트리거 발현·비발현 대조 (vs 시드 켜진 날만). 증명 가능성 위해 수용.
4. **통계 — e-value 정공법** — 누적 e-value 도입 (vs 보수적 "고정 시점 + stop-on-success 금지"). 정공법 선택, 검증(null 시뮬레이션)을 빌드 게이트로 내장.
5. **design-notebook 신규 파일** — 본 파일 신설 (vs #434 후속 섹션). 모델 정체성 재정의라 새 서사.

## 포기한 안 / 미룬 항목

- **보수적 고정시점 검정** (e-value 대신) — 정공법(e-value) 선택으로 미채택.
- **연속값 이진화** — 정보 ≥ 36% 손실로 기각 (ADR-0032).
- **전면 다변량 회귀 / 풀 MCMC** — n=1 과적합 + 순수 TS 제약. 교란 분리는 데이터 게이트 후 elastic net 제한 도입.
- **SCED randomization test** — 시드가 결정론이라 무작위 배정 전제 없음. 기각.

## 데이터 모델 + 사주 feature substrate (2026-06-04 인터뷰)

> 결정 정본은 [ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md) + [ADR-0032](../adr/0032-metric-first-verification-statistics.md). 여기는 골격 스케치 + 분기.

### 스키마 골격 (Model A — 신호 전역 측정 + 주간 재계산)

- **pattern_catalog** (시드, 기존) — saju + life_signal (+ 운레벨 맥락). 교란 covariate도 전부 시드(수면부족 등 이미 존재).
- **signal_defs** (신규, 전역 신호 정의) — kind: sql|tag / (sql) sql_body·value_type(binary|continuous)·direction·threshold / (tag) tag_name / description·source(seed|llm)·status(active|pending|rejected). 시드 무관.
- **pattern_links** (신규, 매트릭=가설=시드×신호) — seed_id·signal_id·source(manual|discovery|llm)·status(active|weak|confirmed|rejected|archived) / test_type(fisher_2x2|mann_whitney) + 공통(effect·p·q·posterior·evalue) + test_detail JSONB + confound JSONB.
- **pattern_stats** (기존 유지) — link당 주 1행 스냅샷(트렌드·e-value 추이·감사).
- **raw** (기존) — expenses/sleep/routine/schedule/diary_meta_tags. 주간 재계산 소스.
- ❌ daily_signals·seed_activation 안 만듦. 옛 pattern_matches 일별 행 폐기(transient 계산 + 마이그레이션).

### 주간 검증 job 흐름

1. window 재계산(raw + 결정론 규칙) → 일자별 시드활성 + 신호값/pass + 사주 feature.
2. 각 link: 2×2(이진)/분포(연속) → Fisher+block permutation / Mann-Whitney+효과크기 → posterior·e-value 갱신 → 교란(공존 시드 충분하면 다변량 분리, 아니면 플래그) → status 갱신 → pattern_stats 스냅샷.
3. 발굴: 미등록 (시드×태그) 전수 Fisher+FDR(discovery) + LLM 신호 제안(llm) → pending → 승인 카드.
4. 알림: confirmed link → #life/#insight (교란 플래그 동반).

### 결정론 사주 feature 엔진 (substrate)

운 레벨 modulation을 통계 상호작용이 아니라 결정론 feature로 환원(원국+대운+세운+월운+일운). 대표 규칙: 오행 비율 / 생·극 가중 실효 강도 / 활성 합충형해파(원진·귀문 포함) / 기본 합화(천간합+통근, 지지 육합/삼합 + 십성 재매핑). 규칙은 파라미터화(사용자 명리학 프레임 정본), 확장형. feature 불완전해도 통계가 거름. 상세 ADR-0033 §3.

### 분기/결정 (이번 인터뷰)

- **A 채택 — 운 레벨 substrate 지금 포함** (vs #408로 전부 미룸). 시드가 일운-only로 굳는 것 방지. 완전한 modulation *검증*은 데이터 게이트 후속(#408 합류).
- **상호작용 → 결정론 feature 환원** (vs 통계 상호작용 항). n=1 데이터 부담 회피, 주효과로.
- **비단조(inverted-U) → graded ordinal 레벨 + 레벨별 검정** (vs 이진/단조). 적정→+ / 과다→− 부호 반전 포착. cumulative_pillar_count가 원형.
- **객관 outcome 우선** (vs 주관 태그 동격). 기대편향 오염 회피.
- **e-value 게이트는 이진**(연속은 baseline 이진화), 연속 효과는 Mann-Whitney+효과크기 보고용.
- **source enum 유지**(manual/discovery/llm). discovery=통계 스캔(태그), llm=LLM 제안(열린 SQL).
- **사주 규칙 파라미터화** (vs 하드코딩). 학파 의존 + 명리학 권위 아님.

### 확증편향 방어 (인터뷰 중 사용자 제기)

디테일한 사주 규칙 인코딩이 확증편향 아니냐는 우려: 규칙은 feature를 *계산*할 뿐 효과를 *단언*하지 않음 + 독립 객관 outcome에 off-day 대조 검정 → 틀린 규칙 feature는 상관 안 나와 걸러짐. 위험 셋(주관 태그 오염→객관 우선 / feature 과다→FDR·절제 / 결과 보고 튜닝→사전 고정)만 지키면 디테일이 목적에 봉사. 단 데이터 검증 전 무한 정밀화는 비효율 → 대표 규칙부터, 데이터가 어떤 feature 사는지 보고 확장.

## 회고 (TODO: `/build` 구현 후 보강)

> 빌드 후 추가. e-value 시뮬레이션 검증 결과, 첫 운영 신호 품질도 같이.
