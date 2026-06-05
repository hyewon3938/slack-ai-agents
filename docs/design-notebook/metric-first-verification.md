# 매트릭 중심 패턴 검증 — 정량 신호를 가설 검증의 1차 축으로

> 마스터 이슈: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477)
> 시작: 2026-06-04
> 상태: 마스터 설계 확정 (헌장 + ADR-0032·0033 + Phase 구획 P1\~P7) → P1 구현 진입
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

## Phase 구획 (2026-06-04 확정 — 각 phase = 독립 세션 + 1 PR)

> 마스터 설계(헌장 + [ADR-0032](../adr/0032-metric-first-verification-statistics.md)·[ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md) + 아래 데이터 모델 섹션)가 정본. **각 phase 세션은 휘발 컨텍스트(브랜치·머지 상태)만 들고 시작하고 본문은 이 문서·ADR 링크로 참조 — 문서/헌장 복제 금지.** 순서는 의존 기준.

| Phase | 범위 | 의존 | 출구 |
|---|---|---|---|
| **P1 스키마 + 신호 전역화** | `signal_defs`·`pattern_links` 신설, `pattern_metrics`·기존 매트릭 이관, 22 태그→tag signal, `pattern_matches` 일별행 폐기, 일별 cron은 오늘 시드활성 transient 계산으로 잔소리 유지 | — | 새 스키마 + 데이터 이관 + 기존 알림 무탈 |
| **P2 주간 검증 엔진** | 주간 job: window 재계산(raw+규칙)→2×2→Fisher+BH-FDR+Beta-Binomial, status 전이 기본, graded 레벨 신호 지원, off-day 대조 | P1 | (시드×신호) 가설이 trigger vs baseline으로 confirmed/rejected |
| **P3 통계 엔진 보강** | block permutation, e-value(이진 게이트)+**null 시뮬레이션 검증**, Mann-Whitney+효과크기(연속), empirical-Bayes, 발견/확정 q 분리 (ADR-0032 풀스택) | P2 | ADR-0032 완비 + 검증 테스트 통과 |
| **P4 결정론 사주 feature 엔진** | 오행비율·생극 실효강도·합충형해파(원진·귀문)·기본 합화(천간합+통근, 지지합)+십성 remap·graded 레벨, 규칙 파라미터화, feature→시드/신호/covariate (ADR-0033 §3) | P1·2 (P3 권장) | 운레벨 맥락 feature 검정 진입, 일운-only 해제 |
| **P5 발굴 + 승인 게이트** | discovery(시드×태그 전수 Fisher+FDR) + LLM 신호 제안(열린 SQL)→pending→#insight 승인 카드 | P2·3 | 자동 발견 + 승인 흐름 |
| **P6 알림 + 큐레이션 + 교란 플래그** | confirmed→#life 잔소리+#insight 카드, 교란 플래그(공존 시드 표시), weak 후순위, status 관리 명령 | P2(+5) | 사용자 도달 + 정직 플래그 |
| **P7 교란 다변량 분리 (데이터 게이트)** | 공존 시드 충분 시 elastic-net/층화로 독립 기여 분리, 아니면 플래그 유지, 데이터 임계 자동 on | P2·3+누적 | "어부지리" 차단(데이터 차면) |

> 옵션: P2+P3 합치면 "통계 완비 엔진" 한 번에 (세션 크기 vs 완결성 트레이드오프, 기본은 분리). P4가 가장 큼 — 필요시 P4a(오행·생극)/P4b(합충·합화·remap)로 분할.

### 각 phase 세션 시작법

1. 새 세션 열기 → 프롬프트는 **휘발 컨텍스트만**: "마스터 #477 Phase N 시작. `docs/design-notebook/metric-first-verification.md` + ADR-0032·0033 참조. 현재 main 머지 상태/브랜치 [...]." (헌장·ADR 본문 복제 금지 — drift 방지)
2. 그 세션: `/design`(해당 phase 계획서 `.claude/plans/477-pN-*.md`) → `/compact` → `/build`
3. phase = 1 이슈(#477 하위) + 1 PR. 도메인 문서(`docs/domains/insight.md`) phase 골격은 `/design`이 작성, `/build`가 채움

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

## Phase 1: 스키마 + 신호 전역화 (2026-06-05)

- 이슈: [#479](https://github.com/hyewon3938/slack-ai-agents/issues/479)
- 관련 계획서: `.claude/plans/479-p1-schema.md`
- 상태: 구현 완료 (PR 대기)

### 결정 요약

시드 종속 `pattern_metrics`를 전역 `signal_defs`(신호 정의) + `pattern_links`(시드×신호 = 가설 + 누적 검증상태)로 분리한다. diary 22태그를 `kind=tag` 신호로 흡수(객관 sql 신호와 동격, 보조). `pattern_hypotheses`·`pattern_stats`(0행)·`pattern_metrics`(이관 완료) DROP, 두 뷰(`pattern_summary`·`saju_influence_summary`) 재정의.

**빌드 중 설계 수정 (Option A)**: `pattern_matches` 일별행을 P1에서 폐기하려던 원안은 **daily-insight(#insight) 라이브 알림을 끊는다**는 사실이 빌드 탐색에서 드러나 철회. `saju_influence_summary` recent tier(최근 7일 trigger, 96/97행)가 `pattern_matches`에 의존하고 daily-insight routine이 이를 소비한다(ADR-0031). → `pattern_matches`는 **P2까지 유지**(archive·transient·verify는 주간 엔진과 함께 P2로 이동). 일별 cron은 raw trigger-log 기록을 유지하되 verify(카운터 확정)·confirmed 가설 라인만 제거. 주간 cron 중 가설×통계 의존인 `weekly-hypothesis-review`만 중단, `pillar-level-distribution-review`는 `pattern_matches` 유지로 무탈 → 살려둠.

### 의사결정 분기점

- **`pattern_matches` 처리 (빌드 중 재결정)**: 원안은 archive(rename) 후 P2 DROP. 그러나 빌드 탐색에서 `saju_influence_summary` 3층 뷰(ADR-0020)의 recent tier가 `pattern_matches` 최근 7일 trigger에 의존(현재 97행 중 96행)하고, 이를 **daily-insight #insight 라이브 알림**이 소비함을 발견. 사용자 체크포인트 → **유지(P2까지)** 채택. 위상 경계도 더 정합적 — "지속 검증 → transient" 전환은 그것을 대체할 P2 주간 엔진이 생긴 뒤가 맞다. (놓친 이유: 설계 cross-check가 검증 서브시스템 4테이블에 집중, 별도 마스터 #421 산출물인 daily-insight의 뷰 의존을 못 봄.)
- **매트릭 이관 (전역화 정도)**: dedup(즉시 전역 실현) / 1:1(구조만 전역) — **1:1** 채택. P1은 이관 리스크 최소화가 우선. signal_defs 스키마는 전역 지원하되 기존 84 매트릭은 링크 단위 1:1, 미래 신호부터 공유. diary는 예외 — 태그가 본질상 전역이라 22 tag signal로 자연 dedup(35 link가 참조).
- **pending 미승인 표현 (uniform)**: signal.status / link.status 어디에 둘지 — **link.status='pending'** 채택(`pattern_links` enum에 추가). tag 신호는 객관 detection이라 항상 active여야 해서, sql/tag 통일하려면 미승인성을 링크가 들어야 함. 매칭 게이트 = `link.status='active' AND signal.status='active'`. P5 승인 = 링크 활성화 단일 경로.
- **value_type 매핑**: 데이터가 갈라줌 — `flag_present` → binary, 나머지 → continuous. 빌드 검증: 비-diary 49 중 binary 5(expense_category_present) / continuous 44, tag 22 binary.
- **주간 cron 처리**: A 채택으로 `pattern_matches` 유지되니 `pillar-level-distribution-review`는 안 깨짐 → **유지**(무탈). 가설×통계 테이블 DROP에 의존하는 `weekly-hypothesis-review`만 플래그 중단.

### 포기한 안 / 미룬 항목

- **dedup 이관**: 미룸. 기존 중복 sql 신호는 P5 발굴 단계에서 자연 통합. P1 강제 dedup은 name/의미 정규화 리스크라 제외.
- **주간 검증 엔진**(window 재계산·Fisher·BH-FDR·status 전이) + **`pattern_matches` archive/transient/일별 verify**: P2 (한 묶음 — transient는 주간 엔진이 지속 검증을 대체한 뒤).
- **e-value·block permutation·Mann-Whitney·EB 수축**: P3. 단 컬럼(`e_value`·`test_detail`·`confound`)은 P1에서 미리 선언(헌장 ④ "후속 미루지 않기"), 로직만 P2/P3.
- **매트릭 승인 게이트·가설 발굴 인터랙션**: P2(발굴)/P5(승인 게이트) 재설계까지 플래그 중단. 데이터(pending 링크 5건)는 보존.

### 미해결·가설 → 빌드에서 해소

- **diary 매트릭 35 → tag 매핑** (해소): 모든 diary_meta 매트릭이 `SELECT … WHERE tag='X'` 형식 → 정규식 `tag\s*=\s*''?([a-z_]+)`로 추출. 35개 전부 추출 성공, (시드,tag) 충돌 0 → 35 링크 전부 고유 형성. 마이그레이션이 DROP 전 DO 블록으로 카운트·합 대조(불일치 시 롤백).
- **잠재 버그 발견**: `pattern_metrics`에 `user_id` 컬럼이 없어 `showPendingMetrics`/`metric_approve`의 `WHERE user_id=$2`가 이미 깨진 상태였음 — P1 포팅(signal_defs/pattern_links, user_id 보유)이 부수적으로 교정.
- **transient 매칭 정확도**: A 채택으로 일별 기록을 유지하므로 쟁점 소멸(P2에서 transient 전환 시 재검토).

### 회고

> TODO(`/build`): 첫 운영 신호(P2 진입 전 pattern_links 누적) 확인 후 보강. daily-insight 의존성을 설계가 놓친 점 — cross-check 범위에 "이 마스터 밖이지만 같은 테이블을 읽는 소비자"를 넣는 교훈.

## Phase 2: 주간 검증 엔진 + 일별 활성 로그 전환 (2026-06-05)

- 이슈: [#481](https://github.com/hyewon3938/slack-ai-agents/issues/481)
- 관련 계획서: `.claude/plans/481-p2-weekly-verification.md`
- 상태: 설계 완료 (구현 대기)

### 결정 요약

(시드 × 신호) 링크를 **off-day 대조**로 검증하는 주간 엔진을 세우고, 일별 `pattern_matches`를 검증 책임에서 떼어내 핸드오프 로그(`seed_daily_activations`)로 전환한다.

- **주간 검증 엔진** (월요일, `weekly-hypothesis-review` 대체): raw 데이터로 윈도우 재계산 → 링크마다 off-day 2×2(시드 발현일 vs 비발현일 × 신호 pass/fail) → Fisher's exact + BH-FDR + Beta-Binomial posterior → status 전이(active/weak/confirmed/rejected). 검증 진실은 `pattern_links` 단일.
- **핵심 통찰 — 신호 전역화(P1)의 payoff**: 신호가 전역(`signal_defs`)이라 **신호별 일자 시리즈를 신호당 1회**, **시드별 활성 시리즈를 시드당 1회** 계산하고, 링크는 그 위 조인 + 2×2. 옛 per-link 재계산 대비 O(신호 + 시드)로 환원.
- **off-day 대조가 본질** (헌장 ②): 옛 방식은 신호를 "자기 28일 평균"과 비교했는데, P2는 "시드 발현일 vs 비발현일"을 대조. "원래 자주 그럼 / 기분탓"을 가르는 건 비발현일 baseline.
- **일별 테이블 전환**: `pattern_matches` → `seed_daily_activations` rename + 검증용 컬럼(`metric_values`·`verify_status`·`error_message`) DROP. 일별 cron은 "오늘 발현 시드"만 transient 기록(검증·백필 없음).

### 의사결정 분기점

1. **`pattern_matches` 처리 (인터뷰 중 사용자 재질문으로 명료화)**: 원안의 "transient = 일별 저장 폐기"가 daily-insight를 끊는지 재점검. **daily-insight(#insight 08:00)는 07:00 매칭 cron이 쓴 "오늘 발현 시드"를 매일 읽는 핸드오프가 구조상 필요** — 사주 트리거 발현은 TS(사주 calendar·sibiunsung)로만 계산되지 순수 SQL view로 재계산 불가하기 때문. → **매일 저장 유지**(검증 책임만 제거 = 슬림 핸드오프 로그). "매일 저장 vs 주간 몰아서"는 양자택일이 아니라 **층이 다름** — 매일="어떤 시드 켜졌나"(daily-insight 입력), 주간="얼마나 연관 있나"(off-day 통계). daily-insight는 둘을 곱해 씀.
2. **verified tier 복원 타이밍**: P2 confirm을 `saju_influence_summary` verified tier로 복원하면 daily-insight #insight로 즉시 노출. 그러나 e-value(P3) 없는 "주간 q≤0.05 확정"은 optional stopping(ADR-0032 §3)이라 거짓양성 부풀림. → **verified tier 노출은 P3까지 보류**. P2는 status 전이를 `pattern_links`에 계산 + 주간 리뷰 카드(모니터링용)에 provisional로만 표시. 데이터 ~90일이라 실질 confirm 거의 없어 노출 손실 ≈ 0.
3. **discovery 범위 (헌장 vs plan note 충돌)**: 헌장 Phase 표는 discovery를 P5에, P1 plan note는 "P2(발굴)" 표기 → **소스 우선순위상 헌장(P5) 우선**. P2 exit("기존 링크 confirmed/rejected")에 발굴은 불필요 → 안 땡겨옴(사용자 원칙: 뒤 작업 미리 끌어오지 않기).
4. **#life 시드 한 줄(`compactMatchedLine`)**: 사용자 미확인 → **발송 제거 + 함수 삭제**(죽은 코드 0). 매칭 cron은 조용히 저장만.
5. **윈도우/세트 시맨틱**: 전체 이력(raw 깊이까지, 캡 365일) 재계산 + **SET**(증분 아님) — n=1이라 재계산 저렴·드리프트 없음(ADR-0033 §2). P2 첫 run이 frozen 이관 카운터를 raw 재계산 진실로 덮어씀.

### 포기한 안 / 미룬 항목

- **주간 스냅샷 테이블 재생성**(옛 `pattern_stats`): P3로. e-value martingale 트레일이 필요해질 때 재생성. P2 status 전이는 단일 현재 윈도우 cumulative 통계로 충분(다주 안정성 체크는 e-value의 일).
- **주간 카드 주간대비(prev delta)**: P3(스냅샷 의존). P2 카드는 현재 검증 상태만.
- **로그 연속성 백필**: 제거 — transient = 오늘만, cron 다운타임 갭은 윈도우 롤링으로 자가 치유(descriptive 뷰가 갭 허용).
- **e-value · block permutation · Mann-Whitney · empirical-Bayes 수축 · verified tier 노출**: P3.

### 미해결·가설 → 빌드에서 해소

- **재계산 비용** (49 sql 신호 × 윈도우 일수): 신호 raw 값 시리즈를 신호당 1회 쿼리 → in-memory rolling으로 baseline·pass 도출(28일 평균 재쿼리 회피). 배칭은 후속 최적화, 정확성 우선.
- **연속 신호 P2 처리**: `direction` 기반 binary `passed`로 2×2(헌장 e-value 게이트는 이진). raw 분포 비교(Mann-Whitney)는 P3.
- **graded 레벨 시드**(cumulative_pillar_count N=1..5 등): P2는 각 레벨 시드를 **독립 binary 트리거**로 검정. 완전 graded/inverted-U(레벨별 baseline)는 P4.
- **`pillar-level-distribution-review` 재배선**: `pattern_matches`→`seed_daily_activations`, `verify_status` 필터 제거(`matched IS NOT NULL`로 대체), `created_at`→`date`.
- **`loadSeedInfluence` 복구**: P1에서 DROP된 `pattern_metrics`를 참조해 깨진 상태 → `pattern_links`로 재배선(주간 카드 시드 영향력 top5).

### 기술적 의의

신호 전역화(P1)를 활용해 신호 시리즈를 신호당 1회 계산하고 링크를 조인으로 환원 — off-day 대조 검증을 O(신호 + 시드)로. 검증(주간 통계, `pattern_links`)과 핸드오프(일별 활성, `seed_daily_activations`)를 책임 분리.

### 회고

> TODO(`/build`): 첫 주간 엔진 run 결과(확정/기각 분포, 재계산 시간) 확인 후 보강.

## Phase 3: 통계 엔진 보강 — e-value 확정 게이트 + 등급별 노출 (2026-06-05)

- 이슈: [#483](https://github.com/hyewon3938/slack-ai-agents/issues/483)
- 관련 계획서: `.claude/plans/483-p3-statistics.md`
- 상태: 설계 완료 (구현 대기)

### 결정 요약

ADR-0032 통계 스택을 완비한다. 핵심 둘 — (1) 주간 반복 점검의 거짓양성 누적(optional stopping)을 **누적 e-value**로 막아 "확정"을 통계적으로 안전하게 만들고([ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md)), (2) 검증 결과를 **검증됨 / 검증중 / 오늘발현 3-tier**로 등급화해 노출한다([ADR-0035](../adr/0035-graded-confidence-exposure.md)). 풀스택 1 PR — block permutation·Mann-Whitney·empirical-Bayes·발견/확정 q 분리까지 같은 함수 위에서 함께.

### 목표 정합 점검 (설계 진입 시 사용자와 cross-check)

> 이 phase는 통계 정교함이 *목표에 봉사하는지*를 사용자가 직접 되물어 검증한 대화에서 나왔다. 그 판단을 남긴다.

- **목표(한 문장)**: n=1 누적 데이터로 "사주(saju)·생활통념(life_signal)이 내 실제 삶에 *측정 가능하게* 연관되나"를 기분탓·확증편향 없이 데이터로만 가린다. 검증된 것만 노출.
- **정교함은 데이터 양이 아니라 자기기만 위험에 비례**한다. 약한 n=1 신호를 잡으며 안 속으려는 거라, 통계 스택 각 조각은 군더더기가 아니라 *특정 자기기만 하나씩에 대한 방어*다:

  | 조각 | 막는 자기기만 |
  |------|--------------|
  | off-day 대조 (P2) | "원래 자주 그럼"을 패턴으로 착각 |
  | **e-value** | **"매주 보다 우연히 유의해진 주"(peeking)** — 주간 리포트 구조의 핵심 위험 |
  | block permutation | 일별 자기상관이 만드는 가짜 유의 |
  | empirical-Bayes 수축 | 소표본 쌍의 과신 |
  | FDR / 발견·확정 q 분리 | 다중 신호 중 우연 유의 |
  | Mann-Whitney | 연속값 이진화로 버린 정보 회수 |

- **"느린 수율 = 정직"**: \~90일에선 거의 다 insufficient + 일부 reject, confirm 거의 0 — 실패가 아니라 *정답*이다. 강한 진짜 패턴만 e-value가 시간 들여 20을 넘는다. 검출 가능한 강한 연관이 별로 없으면 시스템은 "증거 불충분"이라 정직히 답한다(빈손이 아니라 결론).
- **생활통념이 단기 수율의 핵심**: `life_signal` 시드(주말·월말)는 발현일이 빨리 쌓여 드문 사주 트리거보다 먼저 판정 구간에 든다. 첫 confirm/ emerging 후보는 십중팔구 여기.
- **목표 재정의**: "패턴 많이 찾기"가 아니라 **"패턴을 믿을 자격을 얻기"**. 회의적인 친구가 "데이터상 아직 몰라"라고 말해주는 시스템. → 이 목표에 통계 스택이 정합.

### 의사결정 분기점

1. **e-value 구성 — 결정론 리플레이 betting martingale** (→ [ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md)). ADR-0032가 미검증으로 남긴 e-variable을 per-day predictable betting factor 곱(test martingale)으로 핀. 매주 전체 윈도우 리플레이 → P2의 SET 재계산과 정합(마틴게일이 순서 있는 데이터의 순수 함수라 드리프트 0). 정확 factor·nuisance는 **null 시뮬 빌드 게이트**가 심판. 1차 = 순차 조건부 betting(nuisance-free), fallback = Turner-Grünwald GRO 2×2(ADR-0032 지명 출처). ADR-0032 본문 deviation이라 새 ADR.

2. **emerging "검증중" 중간 tier 도입** (→ [ADR-0035](../adr/0035-graded-confidence-exposure.md)). 원안은 strict verified tier 복원에 중심 → "너무 엄격해 몇 달 침묵 아니냐"를 사용자가 제기. 깨달음: **단일 임계를 medium에 두는 게 최악, 라벨 다른 두 층이 정답.** verified(`e≥20`, "검증됨")는 *진실 주장*, emerging(느슨·hedged, "요새 이런 경향—검증중")은 *가시성* 담당. 엄격함은 확정 주장에만 걸고 가시성은 별도 층이 나르니 → 침묵도 거짓말도 안 한다. emerging에 e-value 진행바(`e=4.2/20`) 동반 → 반복 노출이 오히려 "아직 멀었다"를 상기(peeking 심리 방어).

3. **풀스택 1 PR** (vs P3a/P3b 분할). 사용자가 "남은 phase 다 지체없이"라 deferral 이득 0 + 꼬리(block perm·EB·q분리)가 핵심과 *같은 함수*(`verifyUserLinks`·`verifyContingency`·`stats.ts`)라 분할 시 같은 표면을 두 번 연다 → 1 PR. e-value 빌드 게이트는 PR 내 커밋 마일스톤으로 관리(PR 경계 불요).

4. **타이밍 — 지금 진행, 06-08 첫 run은 머지 게이트**. P3 통계는 ADR-0032 정본이라 첫 run 데이터에 의존 안 함. 단 미리 빌드(헌장 ④)는 휴면 후 *무인 자동 활성*이라 검증이 *더* 중요 → null 시뮬(통계 정합·빌드 게이트) + P2 첫 주간 검증 운영 점검(2026-06-08, 운영 정합·머지 게이트) 둘 다 필수.

### 미해결·가설 → 빌드에서 해소

- **accumulating tier off-day 누락** (발견): 현행 `saju_influence_summary.accumulating`(발현일 pass율 55%↑)이 off-day 대조를 안 해 헌장 ② 위반 소지 → emerging tier(off-day 효과 기반)가 **대체**하며 동시 수정.
- **emerging 바 시작값**: `effect≥1.3` + 최소 표본(잠정, verified의 `minActiveDays=30`보다 낮게) → 첫 몇 달 calibration. 임의값 고정 아닌 튜닝 노브(헌장 5).
- **e-value betting 전략·정확 factor**: null 시뮬 통과가 유일 기준. 1차(순차 조건부 betting) 실패 시 Turner-Grünwald fallback.
- **주간 스냅샷 형태**: link당 주 1행(e-value trail·2×2·posterior) — 마틴게일 *입력 아님*(그건 늘 리플레이), 감사·트렌드·emerging 진행바 데이터용.

### 포기한 안 / 미룬 항목

- **발견(discovery) 트랙**: q 분리는 confirm q=0.05만 활성, discovery q(0.10\~0.20)는 **P5까지 휴면 파라미터**(헌장 ④ 미리 선언, 활성은 P5). discovery 스캔 자체도 P5.
- **Turner-Grünwald 1차 채택**: fallback로만(1차는 순차 조건부 betting).
- **완전 graded / inverted-U 레벨별 baseline**: P4(사주 feature 엔진).
- **교란 다변량 분리**: P6 플래그 / P7 데이터 게이트(공존 시드 충분 시 자동 on).

### 기술적 의의

순차 검정의 거짓양성 누적(optional stopping)을 누적 e-value(test martingale)로 통제하고, 결정론 리플레이로 SET 재계산과 정합시켰다. 신뢰도를 3-tier로 등급화해 "느린 확정 수율"이 사용자 침묵이 되지 않게 하면서, 미검증 경향을 확정처럼 노출하지 않는 균형을 잡았다.

### 회고

> TODO(`/build`): null 시뮬 거짓양성 실측치, 1차 vs fallback 채택 결과, 첫 emerging/verified 노출 품질 확인 후 보강.

## Phase 4a: 결정론 사주 강도 feature 엔진 — 실효강도 + 상대 분위수 밴드 (2026-06-05)

- 이슈: [#485](https://github.com/hyewon3938/slack-ai-agents/issues/485)
- 관련 계획서: `.claude/plans/485-p4a-strength-engine.md`
- 상태: 설계 완료 (구현 대기)

### 결정 요약

Phase 표의 "P4 결정론 사주 feature 엔진"이 가장 큰 phase라 **P4a/P4b로 분할**한다. P4a는 **강도 feature 패밀리**(오행 비율 + 생·극 가중 실효 강도 + graded 밴드)를, P4b는 관계·변환 패밀리(합충형해파+귀문 + 합화 통근 + 십성 remap)를 맡는다.

핵심 진단(빌드 부담 환원): **새 통계 엔진이 거의 필요 없다.** 주간 엔진(`verifyUserLinks`)이 시드 활성을 일별 boolean으로 받아 off-day 2×2로 검증하므로, "graded 레벨별 baseline"(P2·P3가 P4로 위임)은 **밴드마다 독립 시드를 만들면** 그대로 실현된다([ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md) §4 "레벨별 main effect, 상호작용 항 불요"). P4a의 실제 무게는 ① 결정론 강도 *계산*(`saju-calendar.ts` 확장), ② 밴드→시드 생성, ③ 명리학 규칙 *파라미터화* — 엔진/통계 코어는 거의 불변.

- **실효 강도 모델**: 생조(인성+비겁) − 극설(재+관+식상) 가중합 + **월령(득령)** + **통근**. 일간 신강/신약 + 오행 5강도 모두 산출. 가중치·통근 조건은 전부 config 파라미터(하드코딩 금지, [ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md) §3). `cumulative_pillar_count`·`element_density`(무가중 카운트)가 이 모델의 원형.
- **graded 밴드 = 상대 분위수**(약/적정/강 3등분) — 검정 시드용. 절대 신강/신약 상태도 병행 계산해 보존(맥락·향후). → [ADR-0036](../adr/0036-relative-quantile-strength-bands.md).
- **FDR 가족 분리**: 강도 시드를 자체 BH-FDR 가족으로 두어 빠른 `life_signal` 트랙 보호. → [ADR-0037](../adr/0037-verification-fdr-family-split.md).
- 비율은 강도에 흡수(별도 시드 없음, 계산·노출은 유지).

### 의사결정 분기점

1. **규모 — P4a/P4b 분할** (vs 단일). 두 개의 독립적 난이도 높은 명리학 인코딩(생극 실효강도 / 합화 통근)이 묶여 검증 체크포인트 과부하 → 분할. P4a가 graded밴드→시드 infra + 파라미터 config를 깔면 P4b는 거기 feature만 얹음(깔끔한 의존).
2. **강도 대상 — 일간 + 5오행 둘 다 미리 계산** (vs 일간 먼저 + per-element 후속). *사용자 주도*: "후속으로 두면 까먹는다, 미리 다 만들고 빠른 건 빨리·느린 건 데이터 모으며 자동 발현" = 헌장 ④ 그 자체. 단 "느린 시드 무방해"는 *희귀 트리거*엔 맞아도 *자주 발현하는 밴드*엔 안 맞음(밴드는 첫 주부터 FDR 가족에 낌) → 분기 4(FDR 가족)로 비용 격리.
3. **강도 모델 — 월령 + 통근 둘 다, 파라미터화** (vs 단순 위치가중). 월령은 명리학 강약 1순위라 빼면 실효강도가 무의미. 단 가중치는 config로 빼서 0으로 끌 수 있게(헌장 ⑤ 튜닝 노브). 통근의 *합화 게이트* 용도는 P4b, P4a는 *강도 가중* 용도만.
4. **FDR 가족 분리** (vs 한 가족 / 3가족). [ADR-0037](../adr/0037-verification-fdr-family-split.md). 강도 18개를 다 켜도 빠른 트랙이 안 늦게. ADR-0032 §2 "발견/확정 q 분리"의 연장 축.
5. **밴드 경계 — 상대 분위수** (vs 절대 명리학 기준). **본 phase 가장 중요한 판단, 사용자가 문서화 명시 요청.** 결정 규칙: *남과 비교하는 시스템이면 절대, 자기 안에서 패턴 발견이면 분위수.* 본 시스템은 후자. 더해 — 강도는 원국(정적)이 대부분이고 매일 바뀌는 건 일운 2글자뿐이라, 절대 컷은 원국 위치에 휘둘려 한 밴드로 쏠려(off-day 대조 붕괴)/죽은 밴드가 생김. 분위수는 일운 변동을 항상 3등분해 포착. 절대 상태는 버리지 않고 병행 계산(향후 "절대 강도 × 체감 데이터" 교차 여지). → [ADR-0036](../adr/0036-relative-quantile-strength-bands.md).
6. **비율 — 강도에 흡수** (vs 별도 시드 가족). 실효강도 = 비율 + 생극·월령·통근 가중이라 비율 따로 시드화하면 거의 같은 가설 중복 검정(FDR 낭비). 계산·노출은 유지, 시드는 강도로 단일화.

### 포기한 안 / 미룬 항목

- **절대 명리학 기준 밴드**: 검정 시드로는 미채택([ADR-0036](../adr/0036-relative-quantile-strength-bands.md)). 단 절대 신강/신약 *상태*는 병행 계산해 보존(맥락·미래).
- **비율 별도 시드**: 강도에 흡수. 비율-강도 괴리(비율 높은데 극당해 강도 낮은 날)가 데이터에서 실제로 갈라지면 후속 재검토.
- **covariate(교란) 투입**: P4a는 feature → *시드*만. 교란 covariate 조정은 P6(플래그)/P7(데이터 게이트 다변량).
- **P4b 전체**: 활성 합충형해파(+귀문) · 기본 합화(천간합+통근, 지지 육합/삼합) · 십성 remap.
- **3가족 이상 FDR**: 2가족(`saju_strength`|`baseline`)으로 시작, 필요 시 후속 분할.
- **오행 밴드 광범위 검증 링크 → P5 의존**: P4a는 큐레이트 앵커 13개만(일간 행동 + 화 건강 + 목 지출). 나머지 오행 밴드(토·금·수 전체, 목/화 약·적정)는 링크 없이 활성만 누적. **P5 discovery를 시드×태그 → 시드×sql신호까지 확장**해야 데이터 기반으로 채워진다 — 안 하면 그 밴드들은 영영 활성 로그만 쌓이고 검증은 안 됨. 십성 전체 손박기는 회피(discovery가 off-day 대조로 발견하는 게 헌장 ② 정신, 1260 페어 speculative active 방지).

### 미해결·가설 → 빌드에서 해소

- **분위수 컷 저장·핸드오프**: 주간 엔진이 윈도우에서 컷 산출 → 저장 → 일별 cron이 저장된 컷으로 "오늘 밴드" 판정(recent tier). 저장 위치(전용 테이블 vs 캐시 컬럼)는 빌드에서 결정. SET 리플레이 결정론 보존이 제약([ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md)).
- **강도 trigger 평가 경로**: 밴드 시드는 per-day 독립 평가 불가(분위수가 윈도우 의존) → `computeSeedActivationSeries`에 강도-밴드 2-pass 경로 추가(값 시리즈 → 분위수 → 밴드 활성). 2×2/통계 코어는 불변.
- **trigger_target_type 추가**: `strength_band`(가칭) + aux `{target: 'day_master'|element, band: 'low'|'mid'|'high'}`. CHECK 확장 마이그레이션.
- **파라미터 config 형태**: 명리학 프레임 전용 모듈(통계 노브 `insight-thresholds`와 분리). 생조/극설 base weight, 위치가중(천간/지지본기/지장간 여기·중기·정기), 월령 배수, 통근 배수, 분위수 등분.
- **시드 생성 방식**: 강도 밴드 시드 자동 생성(마이그레이션 seed) — 일간 3 + 오행 5×3, 일부는 발현 0으로 자연 휴면.

### 기술적 의의

운레벨 강도 modulation을 통계 상호작용 항이 아니라 결정론 feature로 환원하고, 그 feature를 *상대 분위수 밴드*로 잘라 기존 off-day 엔진의 검정 단위(독립 binary 시드)에 그대로 태웠다 — 새 통계 코어 없이 graded·비단조를 실현. 밴드를 절대가 아닌 상대로 정의한 판단(자기 종단 n=1의 의미 단위 + 일별 변동 포착)과, 강도 시드를 자체 FDR 가족으로 격리해 "미리 다 구현"(헌장 ④)의 비용을 빠른 트랙에서 떼어낸 게 핵심.

### 회고

**구현 산출**: `saju-strength.ts`(생조−극설 가중합 + 간결 월령 + 통근 게이트 + 절대 신강/신약 + 오행 비율) · `saju-strength-params.ts`(명리학 노브, 통계와 분리) · `quantile.ts`(tertile + value-vs-cut 공통 규칙). `strength_band_cutpoints` 핸드오프 테이블 + `bhFdrByFamily` 가족 분리 + 18 시드 + 13 큐레이트 링크(마이그레이션 081). 설계 대비 정련 4가지:

1. **큐레이트 링크는 양의 연관만**: off-day 엔진은 발현일 신호 pass율↑(effect≥1.3)만 confirm한다. 그래서 신호의 *고정 direction*과 가설 방향이 정합되는 페어만 선택 — 신약→루틴↓은 `routine_completion_rate`(direction=below_avg, pass=낮은 루틴)로 거니 발현일 positive가 됨. prod 신호 introspection으로 13개 확정(silent fail 방지 위해 마이그레이션 검증 블록이 링크 수 13 강제).
2. **컷 저장은 일별 경로 전용**: 주간 엔진은 자체 윈도우로 컷을 재계산하므로(결정론) 저장 컷에 의존하지 않는다 — 저장은 순수 일별 cron 핸드오프용. `computeStrengthCutpoints`는 읽기전용, 저장(`strength_band_cutpoints` UPSERT)은 `weekly-verification`이 담당(읽기/쓰기 책임 분리 유지). 강도는 주당 2회 계산(검증용+저장용)되나 둘 다 같은 순수 함수 → drift 없음.
3. **통근 double-count 회피**: 본기=정기라 지지를 본기 1회만 tally(중기·여기만 추가), 통근은 그 위에 *이진 게이트 보너스*로 분리(천간 투출 + 지장간 뿌리 동시). 위치가중 tally와 통근 보너스가 겹치지 않게.
4. **옵션 B 보안 경계**: 오행 밴드 링크(화→건강, 목→지출)는 [071](../../db/migrations/071_pattern_signals_pillar_level.sql)에 이미 공개된 매핑(편재=목, 화극금 건강)만 활용 — 신규 원국 노출 0. 십성 전체 매트릭스 손박기는 회피(P5 discovery가 데이터로).

> 운영 검증 TODO: 첫 주간 엔진 실행 후 — 강도 가중치 첫 분포, 분위수 밴드 발현 균형(죽은 시드 여부), 컷 산출·일별 핸드오프 동작, FDR 가족 분리 후 baseline 트랙 영향, 첫 강도 시드 검정(현 데이터로 대부분 insufficient 예상=정직).

## Phase 4b: 결정론 사주 관계·합화 변환 feature 엔진 (2026-06-05)

- 이슈: [#487](https://github.com/hyewon3938/slack-ai-agents/issues/487)
- 관련 계획서: `.claude/plans/487-p4b-relation-hwa.md`
- 상태: 구현 완료 (머지+배포 시 앱 startup `runMigrations`가 082 적용)

### 결정 요약

P4의 후반 — P4a(강도)에 이은 **관계·변환 패밀리**. P4a와 동일하게 **새 통계 코어 0**: 전부 결정론 boolean/밴드 시드로 기존 off-day 엔진에 태운다([ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md) §4). 정본 결정은 [ADR-0038](../adr/0038-saju-relation-hwa-feature-depth.md).

- **합화 = 실효강도 입력단 공통 변환 pass**(별도 시드 아님): `saju-strength`가 글자 tally 전에 합화 변환 1회(化신 통근 게이트 → 化 오행 치환). 강도·밴드·절대상태·효과적 십성이 변환 글자 기준 일관. 한 변환에서 magnitude(강도)·role(십성) 두 렌즈 파생 → 이중 인코딩 아님.
- **합충 해소 깊이 = v1a**(합 성립 + 충개합). 탐합망충·쟁합/투합·형파·거리는 파라미터 노브(기본 off)/후속.
- **효과적 십성 시드**(새 trigger 타입): 합화 후 化 오행의 일간 대비 십성. 십성 remap은 합화의 결과라 같은 변환에서 파생.
- **관계 확장**: 자동 생성 관계 풀(070, 합충형해파+원진)을 재사용하고 **귀문 + 대표 암합만 추가** + 고현저 관계 큐레이트 링크.
- **FDR 가족 `saju_relation` 신규**(2→3가족, [ADR-0037](../adr/0037-verification-fdr-family-split.md) 연장). 합화 반영 강도는 `saju_strength` 유지.

### 의사결정 분기점

1. **합화 표현 — 강도 입력단 공통 변환(Z)** (vs X 십성만·강도 무관 / Y 별도 모디파이어 시드). 인터뷰에서 X→Y→Z로 진화. 사용자가 **정적 원국 내부 합화**(원국 글자끼리 합화로 한 오행이 강화되는 경우)로 raw 강도가 그 사람 강도 지형을 과소평가함을 제기 → 합화를 강도에 반영해야 한다는 결론. 비자명 뉘앙스: **정적 원국 합화는 모든 날 같은 상수를 더해 *상대 분위수 밴드*엔 거의 무영향**(순위 보존) — 검정 왜곡의 진짜 출처는 동적 운 합화(운이 합을 완성/파괴) + 절대상태 + 십성 일관성. 어느 쪽이든 결론은 "강도에 반영", 방식은 입력단 공통 변환(중복 검정 회피).
2. **합충 해소 깊이 v1a** (vs v1b 합성립만 / v1c 깊은 엔진). v1c 기각 근거 둘: ① n=1 \~90일에서 깊은 레이어는 밴드 발현일을 각자 2\~3일만 뒤집어 off-day·e-value가 **구분 불가(unidentifiable)** — 검증 못 하는 정밀도. ② 각 규칙이 학파 의존 선택지라 **연구자 자유도 폭발** → 패턴 살리는 config 선택 여지 = 시스템 목적(자기기만 방지) 자해. 충개합은 충실도 대비 비용 최적이라 v1에 포함. 깊이는 노브 + SET 리플레이로 미래 비용 = rewrite 아닌 노브(헌장 ④·⑤).
3. **검증/해석 책임 분리**: 깊은 명리 정밀도는 검증이 아니라 해석에. 검증=결정론 v1a facts(얕게), 깊은 해석=narrative LLM(weekly-fortune)이 facts grounding 위에서 hedged 추론. **결정론 deep 해석 엔진 미채택** — 헌장 ① 적용(facts는 결정론이, 해석은 LLM이).
4. **관계 시드 = 070 자동생성 재사용** (빌드 탐색 중 발견). [070](../../db/migrations/070_saju_seed_pool.sql)이 이미 `branch_relations`/`stem_relations` 전수 LOOP로 관계 풀셋 70개를 P4a식 패턴으로 생성(원국에 없는 쌍은 휴면). 전부 evidence-only(링크 없음). → P4b는 "처음부터"가 아니라 **귀문/대표암합 확장 + 큐레이트 링크**(검증 연결). 합화오행은 TS 상수(`CHEONGAN_HAP`/`JIJI_*`)에 이미 있어 합화 변환은 데이터 추가 0.
5. **FDR 가족 saju_relation**. 자동 생성 관계 batch가 빠른 `life_signal` 트랙을 과세하지 않게 격리.
6. **스코프 = 검증 코어만**. 검증된 관계/합화 패턴은 P4a 강도처럼 daily-insight에 자동 노출(`saju_influence_summary` tier). weekly-fortune에 raw 명리 facts 주입(교과서 해석 풍부화)은 별도 routine + 헌장 ① 입력 확장이라 follow-up.

### 포기한 안 / 미룬 항목

- **v1c 깊은 결정론 합충 엔진**(탐합망충·쟁합/투합·형파·거리): 검정엔 미채택. 파라미터 노브로 기본 off 선언(헌장 ④ 미리 구현), 활성은 데이터 게이트/후속. 깊은 해석은 narrative LLM이 대신.
- **합화 별도 boolean 시드(X) / 모디파이어 시드(Y)**: 입력단 공통 변환(Z)에 흡수.
- **narrative raw facts 주입**(weekly-fortune LLM 입력 확장): 별도 follow-up 이슈. P4b는 검증 코어만.
- **관계 mass-wiring**(70 관계 × 신호 전수 손박기): 회피 — P5 sql-discovery가 off-day로 발견(P4a "오행 밴드 → P5 의존"과 같은 정신). P4b는 고현저 앵커만 큐레이트.
- **합화 별도 FDR 가족**: 합화 반영 강도는 `saju_strength` 유지(시드 수 불변), 효과적 십성·관계만 `saju_relation`. 3가족 이상 분할은 후속.

### 미해결·가설 → 빌드에서 해소

- **합화 성립 조건**: 천간합/육합/삼합 + 化신 통근 게이트(saju-strength `hasStem && hasRoot` 패턴 재사용). 일간이 합에 끼는 경우 변질 여부는 학파별 → 1차 보수적으로 일간 불변(파라미터). 파라미터 위치(saju-strength-params 확장 vs 새 모듈)는 빌드 결정.
- **충개합 규칙**: 직접 충이 합 멤버를 치면 합 무효(化 안 됨). 합충 해소 step을 함수로 분리(확장 노브 진입점).
- **효과적 십성 trigger 타입**: 타입명(`hwa_sipsung` 가칭)·aux(`{sipsin, via:'hwa'}`)·`evaluateTrigger`/`computeSeedActivationSeries` 경로. 합화는 풀셋 계산이라 per-day evaluateTrigger로 충분(강도 밴드 같은 2-pass 불요 — 십성은 윈도우 비의존 범주값).
- **큐레이트 링크 셋**: 고현저 관계(귀문 포함, S2 임상 테마 정합) × 객관 신호, **양의 연관만**(off-day 엔진은 발현일 pass율↑만 confirm — P4a 정련 1 교훈). prod 신호명 introspection으로 확정 + 마이그레이션 RAISE 검증(silent fail 방지).
- **귀문/암합 master 데이터**: `relation_type` CHECK에 귀문·암합 추가 + 대표 쌍(귀문관살 + 주요 정기-정기 암합 인축/묘신/사유/오해) + 070식 auto-gen.
- **070 관계 시드 prod 잔존 확인**: P1(077)이 signal_defs/pattern_links만 건드려 pattern_catalog 시드는 보존 예상 — 빌드 시 카운트·링크 없음 확인.

### 빌드 산출 (설계 대비 정련)

1. **관계 큐레이트 링크 미채택 → 효과적 십성만 큐레이트(10링크)**. 설계는 "고현저 관계 큐레이트 링크"를 예상했으나, 빌드 분석에서 이 원국의 유일한 고현저 귀문 쌍(사술)이 **기존 공개 시드 S2 사술원진과 발현이 동일**(같은 날 fire)함을 확인 → 중복 가설. 나머지 관계는 P5 sql-discovery에 위임(헌장 ②, mass-wiring 회피). 관계(귀문/암합)는 evidence-only 시드만 추가. 검증 연결은 **효과적 십성 × generic 행동 신호**에 집중(원국 무관, 071 공개 범위).
2. **대표 암합 4쌍(인축·묘신·사유·오해) 전부 이 원국에선 휴면**. 정기-정기 천간합 대표 4쌍이 모두 자/술과 무관 → 활성 0. 헌장 ④ 인프라로 유지(미리 구현). *활성 암합을 원하면 무계(자술) 추가가 필요* — 별도 결정(follow-up). 설계의 "대표 암합" 정의를 그대로 따르되 휴면 사실을 명시.
3. **`computeElementRatios` 합화 미적용(raw 유지)**. 설계 §2의 "모두 자동 반영"을 정련 — 오행 비율은 "원국이 무슨 글자로 구성됐나(composition covariate)"라 변환 전 분포가 맞다. 합화 반영은 강도(magnitude) 함수에만(`computeElementStrengths`/`ForTarget`/`AbsoluteStrengthState`).
4. **`saju-calendar.ts` 파생 상수 export 추가**(계획 파일 목록 외 필요 변경). `saju-hwa.ts`가 합화오행을 재계산하지 않고 단일 출처(`CHEONGAN_HAP`/`JIJI_*`)에서 쓰도록 문자 기반 `*_RULES`·`JIJI_CHUNG_PAIRS`를 파생·export(중복 테이블=drift 위험 회피). index 상수의 element 타입을 `string`→`Element`로 정밀화(부수 개선).
5. **효과적 십성 = 5그룹(polarity-free)**. 化 오행의 음양 polarity는 학파 의존이라 편/정 미세분 없이 비겁/식상/재성/관성/인성 5그룹(`elementToSipsinGroup`). 십성 remap을 합화 변환과 같은 계산에서 파생.

### 기술적 의의

합화를 별도 시드가 아니라 실효강도 엔진 입력단의 공통 변환으로 환원해, magnitude(강도)와 role(십성) 두 렌즈를 한 결정론 계산에서 파생시켰다(이중 인코딩·FDR 낭비 회피). 명리 정밀도의 깊이를 **검증(결정론, 얕게)과 해석(LLM, 깊게)으로 분리**해, n=1에서 데이터가 구분 못 하는 정밀화(unidentifiable)와 학파 선택지가 만드는 자기기만 자유도를 검증에서 차단하면서 해석 풍부함은 LLM의 hedged 추론에 맡겼다. 자동 생성 관계 인프라(070)를 재사용해 P4b 무게를 확장·연결로 환원.

### 회고

> 운영 검증 TODO: 첫 주간 엔진 실행(다음 월 06:00) 후 — 합화 변환이 P4a 강도 밴드 컷을 얼마나 이동시키는지, 충개합 발현 빈도, 효과적 십성 5시드 발현 균형(합화 성립일 sparse 예상), 귀문/암합 auto-gen 시드 활성(대부분 휴면 예상), `saju_relation` 가족 분리 후 baseline 트랙 영향, 첫 효과적 십성 링크 검정(현 데이터로 대부분 insufficient=정직 예상) 확인 후 보강.
>
> 빌드 회고: 인터뷰가 합화 모델을 X→Y→Z로 끌어올린 데 더해, 빌드 탐색이 설계의 "관계 큐레이트 링크"를 **이 원국에선 중복(사술귀문≡S2)**임을 드러내 효과적 십성으로 무게중심을 옮긴 게 핵심. 도메인 직관(설계)과 데이터 현실(빌드 introspection)이 한 번 더 교차해 스코프를 정련.

---

## 회고 (TODO: `/build` 구현 후 보강)

> 빌드 후 추가. e-value 시뮬레이션 검증 결과, 첫 운영 신호 품질도 같이.
