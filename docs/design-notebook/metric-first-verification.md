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

---

## 회고 (TODO: `/build` 구현 후 보강)

> 빌드 후 추가. e-value 시뮬레이션 검증 결과, 첫 운영 신호 품질도 같이.
