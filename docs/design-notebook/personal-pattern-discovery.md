# 본인 1명 패턴 발견 시스템 — 라이프 통념 + 사주 통합 시드 카탈로그

> 마스터 이슈: [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434)
> 시작: 2026-05-27
> 상태: 설계 완료, Phase 1 진입 대기
> Successor of: 마스터 [#393](https://github.com/hyewon3938/slack-ai-agents/issues/393) (v2, 사주 검증 시스템) — 일반화·확장

## 개요

마스터 #393 (프로액티브 인사이트 v2, Phase 1\~4 머지 완료)는 사주를 검증하기 위한 시스템이었다. 본 마스터는 동일한 가설-검증 파이프라인을 **본인 1명 패턴 발견 시스템**으로 일반화한다.

핵심 변화:

- **시드 출처 확장**: 사주 60갑자 6종(stem/branch/ganji/element_density/sibiunsung/relation) → 사주 6종 + 라이프 통념 1종(`life_signal`: 요일·주말·월말·계절 등 결정론적 환경 변수) 통합
- **매트릭 작성 권한 확장**: 결정론 시드(SQL 카탈로그에 작성됨) + **LLM 자율 매트릭(미사용 자료에서 발견, 사용자 승인 후 활성)**
- **검증 모델 확장**: Frequentist(Fisher's exact + BH-FDR, v2 Phase 4 계승) + **Bayesian(Beta-Binomial posterior 사후 확신도)**

## 핵심 원칙 — 자체 헌장 (변경 불가, 변경 시 ADR)

v2 헌장 4개([project_insight_v2_core_principles 메모리](../../.claude/projects/-Users-ihyewon-slack-ai-agents/memory/project_insight_v2_core_principles.md))는 본 마스터에도 그대로 적용된다. 그 위에 본 마스터의 자체 헌장 5개를 더한다.

### 1. 본인 1명 통계 (n=1, single-case design)

모집단 통계 가정 X. 본인 시계열만 추적해 본인 baseline 대비 차이를 측정한다. 다른 사람의 패턴을 차용하지 않고, 본인 데이터가 누적되는 만큼만 검증 신뢰도가 올라간다.

### 2. 5어휘 분리 — 시드(seed) → 매트릭(metric) → 매칭(matching) → 가설(hypothesis) → 검증(verification)

데이터 흐름 어휘를 5개로 명확히 분리한다.

| 어휘 | 정의 | 테이블 (Phase 1 rename 후) |
|------|------|--------|
| **시드** (seed) | "어떤 환경/조건이 자주 등장하는가" 카탈로그 (사주 갑자 + 라이프 통념) | `pattern_catalog` |
| **매트릭** (metric) | 시드를 검증하기 위한 평가 방법 (SQL + window_days + 임계치) | `pattern_metrics` |
| **매칭** (matching) | 매트릭 평가가 발생한 단일 사건 기록 (trigger 발동일 + outcome 결과) | `pattern_matches` |
| **가설** (hypothesis) | trigger seed × outcome seed 인과 후보 (자동 발견 + LLM 발견) | `pattern_hypotheses` |
| **검증** (verification) | 매칭 누적 → Fisher's exact + BH-FDR + Bayesian posterior | `pattern_stats` |

### 3. target-type 일반화 — 사주 + life_signal 통합 (ADR-0022 → ADR-0026)

v2 Phase 3의 6종(stem/branch/ganji/element_density/sibiunsung/relation)에 **`life_signal`** 1종을 추가한다. 사주 갑자와 라이프 통념(요일·주말·월말·계절 등)을 동일한 `pattern_catalog` 스키마에서 다룬다. 별도 테이블 분리하지 않는 이유는 매칭·매트릭·가설 파이프라인이 모두 동일하기 때문 — 출처만 다르고 통계 처리는 동일.

테이블명은 ADR-0026이 `saju_signal_catalog` → `pattern_catalog` 전면 rename으로 정정 (ADR-0022 잔존 결정 폐기).

### 4. 결정론 ↔ LLM 자율 + 승인 게이트 (ADR-0025)

매트릭의 출처를 구분한다.

- **결정론 매트릭**: 시드 카탈로그에 SQL 작성됨 (Phase 1\~3 시드 시드 작업에서 작성). 즉시 매칭 cron에 진입.
- **LLM 자율 매트릭**: 월간 LLM 슬롯이 미사용 데이터 조합에서 발견. **사용자 승인 후에만 활성** — 매트릭에 `status: 'pending' | 'active' | 'rejected'` 컬럼 + Slack 승인 카드 UI.

LLM 매트릭은 월 최대 N개 cap(예: 5개)으로 슬롯 폭주 방지. 매트릭 본문에 `description TEXT NOT NULL` 컬럼을 두어 의도를 자연어로 전달 (SQL 본문은 매트릭 활성화 시점에 사용자가 별도 검토 안 해도 되게).

### 5. 신뢰 비용 분리 (v2 헌장 ④ 계승 + Bayesian 추가)

- **결정론**: 명시 임계치 + Fisher's exact + BH-FDR (v2 Phase 4 계승)
- **자율**: 4안전장치(SELECT-only, get_schema 선호출, 결과 형식 제약, SQL 영속) + outcome 검증
- **공통**: 모든 매트릭이 Beta-Binomial **posterior 확신도**를 누적 (Phase 7 도입). hit/miss 카운트가 적은 초기 단계에서도 prior로 안정 + 누적이 늘면 자연스럽게 posterior 수렴 (ADR-0024).

## 컨텍스트 도메인

- **포함**: schedule(카테고리/상태/시기) + sleep + routine + expense(카테고리 빈도/시기, 금액 노출 X) + saju(원국 데이터) + life_signal(요일/주말/월말/계절 등)
- **제외**: diary(텍스트 의존도 ↑) — v2 헌장 ① 계승

## 8-Phase 흐름 — 운영 검증은 단축 PR 검증으로 대체

> Phase 사이에 1주 운영 검증을 두지 않는다. 짧은 PR 검증(코드 리뷰 + 테스트 + setup 모드 단위 검증)으로 대체. 통계 누적 검증은 마스터 종료 후 운영 1\~3개월 누적 시점에 [부록 E](#부록-e-운영-1-3개월-후-도입-검토-기능-7건) 7건과 함께 회고.

- [x] **Phase 1**: 스키마 일반화 + `pattern_*` rename — 테이블·컬럼 rename (`saju_signal_*` → `pattern_*`, ADR-0026), `trigger_target_type` CHECK constraint 확장(`life_signal` 추가), `pattern_metrics`에 `description TEXT NOT NULL` + `window_days INTEGER` + `hit_count/miss_count/inconclusive_count` + `status` 컬럼, `posterior_alpha/beta/p` 예약, `pattern_summary` view 신설, `saju_influence_summary` view body 재정의 (운영 자산 보존)
- [x] **Phase 2**: 사주 시드 풀 셋 — Phase 3에서 작성된 시드를 카탈로그 풀(전체) 검토 + 누락 보완 (s1 일부만 작성된 상태였음)
- [x] **Phase 2.5**: 사주 시드 운 레벨 차원 도입 + 자동 분포 분석 cron — `pillar_level` 컬럼(원국/대운/세운/월운/일운/cumulative), `cumulative_pillar_count` trigger(N=1..5 풀셋), `expense_category_present` 메트릭, `pillar-level-distribution-review` cron (월요일 09:15 KST). 14개 신규 시드(편재 9 + 화 오행 5). [ADR-0028](../adr/0028-pillar-level-and-threshold-pool.md)
- [x] **Phase 3**: `life_signal` 시드 풀 셋 + 매칭 cron 일반화 — 환경 결정론 + 임계치 풀셋 + 11종 결정론 패턴 승격 = 신규 38개 시드. `trigger_aux.kind` 7 kinds(weekday/weekday_group/month_position/season/calendar_event/threshold/behavior_baseline) discriminated union. [ADR-0029](../adr/0029-life-signal-trigger-aux-standard.md)
- [ ] **Phase 4**: 매칭 cron 카운터 source of truth 전환 + pattern-match rename — verifyDailyMatches가 catalog 대신 `pattern_metrics` 카운터 + Bayesian posterior 산식 갱신. compactMatchedLine은 `pattern_summary` view 정렬. evidence-only 시드는 카운터 SKIP. 파일명 `saju-match.ts` → `pattern-match.ts`, `daily-saju-matching.ts` → `daily-pattern-matching.ts` (잔존 saju-* 파일은 후속 phase 진입 전 별도 PR)
- [ ] **Phase 5**: 가설 발견·검증 업데이트 — `hypothesis-discovery`가 `life_signal` trigger를 포함하도록 일반화. weekly 가설 리뷰 카드 본문에 출처(`pattern_kind`) 표시
- [ ] **Phase 6**: LLM 자율 매트릭 + 승인 게이트 — 월간 LLM 슬롯이 매트릭 후보를 생성, Slack 승인 UI(`/insight metric-approve` + Block Kit inline button). 활성화된 매트릭만 매칭 cron 진입. **운영은 Claude 앱 routines 기반** ([ADR-0027](../adr/0027-llm-async-routine-unification.md))
- [ ] **Phase 7**: Bayesian update 도입 — `posterior_p` 컬럼 채움. Beta-Binomial 사후 갱신 헬퍼(\~100줄). 가설 카드에 frequentist p값 + Bayesian posterior 병기
- [ ] **Phase 8**: 인사이트 카드 UI + 마스터 close — `#insight` 채널 패턴 발견 카드(Block Kit). `life_signal` 패턴(요일 효과 등)도 같은 카드에서 출력. 마스터 회고 + 운영 1\~3개월 시점 follow-up 이슈 7건 일괄 등록

---

## 의사결정 분기점 — 마스터 setup 단계

> 설계 단계에서 사용자와 합의된 분기점들. Phase별 분기점은 각 Phase 섹션에서 추가.

### 1. 마스터 #393 처리 방식

- A. #393 유지 + Phase 5에 흡수 — 마스터가 길어져 응집도 ↓, "사주 검증" 정체성이 흐려짐
- B. #393 close + 새 마스터 신규 — 정체성 재정의 명확, 회고와 후속 작업 경계 분리 (선택)
- C. 별도 PR로 #393 close를 분리 — 본 마스터 시작과 동시에 closing 작업도 분리 PR

→ **B (선택)**. 마스터 정체성이 "사주 검증" → "본인 1명 패턴 발견"으로 바뀌므로 새 마스터가 자연스럽다. 본 PR에 #393 close docs도 함께(c 부분 통합) 포함.

### 2. target-type 확장 위치 + 테이블명 처리

- A. 기존 catalog에 `life_signal` trigger_target_type 추가 (선택, 파이프라인 재사용) — 동일 파이프라인 재사용. 별도 카탈로그 분리 시 매칭·가설 코드 중복
- B. 별도 `life_signal_catalog` 테이블 신설 — 테이블명이 의미적으로 정확하나, 매칭·매트릭·가설·검증 코드 4중 중복
- C. catalog를 `signal_catalog`로 rename — 의미적이나 5어휘 모델(시드/매트릭/매칭/가설/검증) 중 한 어휘에만 묶임. 매칭·가설은 시그널 자체 아님
- D. catalog를 `pattern_catalog`로 rename + 전체 테이블에 `pattern_*` prefix 통일 (최종 선택) — 시스템 정체성("패턴 발견") 직접 표현, 5어휘 모두 자연 묶임

→ **A 안 (파이프라인 재사용) + D 안 (테이블명 `pattern_*` 일괄 rename)**. ADR-0022는 A+잔존을 채택했으나 잔존 결정은 압축 사고로 사용자 명시 합의 없이 박혔음 — ADR-0026으로 잔존 폐기 + `pattern_*` rename 전환. 테이블명은 본 마스터 정체성과 일치 (`life_signal` 들어와도 `saju_signal_` 잔존 안 함).

### 3. hit/miss/inconclusive 카운터 위치

- A. seed에 카운트 컬럼 — v2 PR #422 패턴과 일관되지 않음
- B. metric에 카운트 컬럼 (선택) — 매트릭이 단위 검증 주체이므로 source of truth. seed는 view로 derive
- C. matches만 두고 매번 집계 — view derive 비용 ↑

→ **B + view (선택)**. `pattern_metrics`에 hit/miss/inconclusive 컬럼을 source of truth로 두고, `pattern_summary` view가 seed 단위 합산을 derive (v2 PR #422 `saju_influence_summary` view 패턴 계승). ADR-0023.

### 4. Bayesian update 도입 시점

- A. 본 마스터에서 도입하지 않고 운영 1\~3개월 후 — frequentist만으로 신뢰도 부족할 수 있음
- B. 본 마스터 Phase 7에서 도입 (선택) — 추가 코드 \~100줄, posterior_p 컬럼 1개. 초기 hit 부족 시 prior로 안정.
- C. frequentist만 영구 유지 — n=1 환경에서 누적 적은 가설 평가 어려움

→ **B (선택)**. 본 마스터 안에서 도입. 추가 비용 작고 n=1 환경 적합성 큼. ADR-0024.

### 5. LLM 자율 매트릭 승인 UI

- A. Slack 명령어 + Block Kit 카드 + 자연어 description (선택) — 매트릭 의도를 자연어로 명확히 전달, 사용자가 SQL 본문 검토 안 해도 됨
- B. 웹 대시보드 승인 페이지 — 웹 작업 동선 추가 부담
- C. 자동 승인 (검토 없음) — v2 헌장 ② "결정론↔자율 역할 분리" 위배

→ **A (선택)**. `description TEXT NOT NULL` 컬럼이 자연어 설명을 담고, Slack inline button으로 승인/거절. ADR-0025.

### 6. Phase 사이 1주 운영 검증

- A. Phase별 1주 운영 — 통계 누적 검증 가능하나 마스터 완성 시점이 8주+ 미뤄짐
- B. 짧은 PR 검증(코드 리뷰 + 테스트 + setup 모드)만 (선택) — 통계 누적 검증은 마스터 close 후 운영 1\~3개월 누적 시점에 모아서

→ **B (선택)**. Phase별 코드 검증으로 충분. 통계 검증은 마스터 종료 후 follow-up 7건과 함께.

## 포기한 안 / 미룬 항목

- **세운·대운 LLM 회고 해석** (v2 Phase 5-B): 이미 마스터 #421로 이관됨 (ADR-0020). 본 마스터에서 다시 다루지 않음
- **diary 텍스트 LLM 분석**: 본 마스터 컨텍스트 도메인에서 제외. v2 헌장 ① 계승
- **카테고리 가중치 자동 튜닝**: 운영 1\~3개월 누적 후 별도 이슈로 검토 (부록 E)
- **SPRT / Change Point Detection 등 통계 도구 7건**: 운영 1\~3개월 후 follow-up 이슈로 일괄 등록 (부록 E)

## 미해결 / 가설

- **LLM 매트릭 월 cap**: 초기 5개로 시작. 자율 슬롯이 5건 채워지지 않으면 매월 잔여 cap 소멸 (누적 X). 운영 후 cap 적정성 재평가
- **`life_signal` 시드 첫 셋 범위**: 1차에 14\~20개 시드 (요일 7 + 주말 1 + 평일 1 + 월말 1 + 월초 1 + 계절 4 + 월초후반/월말직전 2\~6). 운영 후 추가
- **Bayesian prior**: Beta(1,1) uniform 시작. 운영 누적 후 informed prior 검토

## 부록 A — 5어휘 데이터 모델 빠른 참조

> [portfolio-candidates 부록 B](../_personal/portfolio-candidates.md)의 표를 공개용으로 간소화한 버전.

```
시드 (pattern_catalog)
  ├─ trigger_target_type ∈ {stem, branch, ganji, element_density, sibiunsung, relation, life_signal}
  ├─ trigger_target_id (예: '甲'·'주말'·'월말'·'木 강')
  ├─ pattern_kind ∈ {saju, life_signal}
  └─ description (자연어)

매트릭 (pattern_metrics) ← seed 1:N (FK: pattern_id)
  ├─ window_days  (외부화된 윈도우 길이)
  ├─ sql_body     (평가 SQL)
  ├─ description  (자연어 설명 — LLM 매트릭 승인 UI에 노출)
  ├─ status ∈ {active, pending, rejected}
  ├─ source ∈ {deterministic, llm_autonomous}
  ├─ hit_count / miss_count / inconclusive_count  (source of truth)
  └─ posterior_alpha / posterior_beta / posterior_p  (Beta-Binomial 사후, Phase 7~)

매칭 (pattern_matches) ← metric 평가 결과 1행 (시드 단위 매일 1행, metric_values JSONB로 N개 매트릭 결과 보관)
  ├─ matched_date
  ├─ trigger_activated
  ├─ metric_values (JSONB, 매트릭별 hit/miss/inconclusive)
  └─ evidence (JSONB, 평가 시점 컨텍스트)

가설 (pattern_hypotheses) ← trigger × outcome 인과 후보
  ├─ trigger_spec (JSONB, 현재는 {type:'seed', signalId})
  ├─ outcome_spec (JSONB, enum_target 등)
  ├─ status ∈ {candidate, active, confirmed, rejected}
  └─ source ∈ {auto_discovered, llm_proposed}

검증 (pattern_stats) ← hypothesis 1:N (주간 시계열)
  ├─ week_start
  ├─ rate_trigger / rate_baseline / rate_ratio
  ├─ raw_p (Fisher's exact)
  ├─ fdr_q (BH-FDR adjusted)
  └─ posterior_p (Beta-Binomial)

뷰 (pattern_summary) ← metric 집계로 시드 단위 derive
```

---

## Phase 1: 스키마 일반화 (예정)

- 이슈: TBD (Phase 1 진입 시 생성)
- 관련 ADR: ADR-0022 (Superseded), ADR-0023, ADR-0024, ADR-0025, ADR-0026 (pattern_* rename)
- 관련 계획서: `.claude/plans/434-phase-1-schema.md`
- 상태: 설계 완료, 구현 대기

### 결정 요약 (TODO: `/build` 구현 후 보강)

테이블 rename: `saju_signal_catalog` → `pattern_catalog`, `saju_signal_metrics` → `pattern_metrics`, `saju_daily_matches` → `pattern_matches`, `saju_hypotheses` → `pattern_hypotheses`, `saju_stats` → `pattern_stats` (ADR-0026). `trigger_target_type` CHECK constraint에 `life_signal` 추가. `pattern_metrics`에 `description NOT NULL` + `window_days` + `hit_count/miss_count/inconclusive_count` + `status` + `source` + `posterior_alpha/beta/p` 컬럼 추가. `pattern_summary` view 신설. catalog → metric으로 카운트 backfill. `saju_influence_summary` view body 재정의 (운영 자산 보존).

### 의사결정 분기점 (TODO)

### 회고 (TODO)

---

## Phase 2: 사주 시드 풀세트 + 빈 매트릭 evidence-only (2026-05-28)

- 이슈: [#437](https://github.com/hyewon3938/slack-ai-agents/issues/437)
- 관련 ADR: [ADR-0023](../adr/0023-metric-unit-counter-and-summary-view.md), [ADR-0025](../adr/0025-llm-metric-approval-gate.md), **[ADR-0027](../adr/0027-llm-async-routine-unification.md) 신설**
- 관련 계획서: `.claude/plans/434-phase-2-seed-pool.md`
- 상태: 설계 완료, 구현 대기

### 결정 요약

사주 6종 풀세트 161개 신규 시드를 `pattern_catalog`에 박는다. 풀셋 단일 시드는 **매트릭 없이** 등록되며, 매일 09:00 매칭 cron이 trigger만 평가 + `pattern_matches.evidence` JSONB 누적. `matched=NULL` + `verify_status='no_metric'`로 hit/miss 채점 스킵. 60+일 evidence 누적 후 Phase 6 LLM 매트릭 제안 슬롯의 가설 후보 풀로 활용.

| 종류 | 마스터 카운트 | 기존 시드 | 신규 시드 | 합계 |
|---|---|---|---|---|
| stem | 10 | 8 | 2 | 10 |
| branch | 12 | 3 + 1 통합 | 9 | 13 (단일 12 + 통합 1) |
| ganji | 60 | 0 | 60 | 60 |
| element_density | 10 | 1 | 9 | 10 |
| sibiunsung | 12 | 1 | 11 | 12 |
| relation | 72 | 2 | 70 | 72 |
| **합계** | **176** | **16** | **161** | **177** |

신규 시드 이름은 `pool_<대상>_<카테고리>` 패턴 (예: `pool_갑_천간`, `pool_자_지지`, `pool_충_진술`). 기존 16개 시드는 이름 보존(운영 자산 우선). 통합 시드(N4_축미 / S6_사지묘지 / S2_사화_사술원진)와 풀셋 단일 시드 둘 다 유지 — 데이터 풍부도 우선, 단일 시드가 분리 검증을 제공.

### 핵심 변경

- **`pattern_matches.matched` NOT NULL → NULL 허용** (Migration 069)
- **`verify_status` enum에 `'no_metric'` 추가** (Migration 069)
- **시드 풀세트 INSERT** (Migration 070 + `scripts/generate-saju-seed-pool.ts`)
- **`src/shared/saju-match.ts`** — 빈 매트릭 시드는 `matched=null`, recordDailyMatches가 `verify_status='no_metric'`로 INSERT, verifyDailyMatches는 자연스럽게 스킵
- **ADR-0027 신설** — LLM 비동기 작업은 모두 Claude 앱 routines로 통일. Phase 6 매트릭 제안 슬롯은 처음부터 routine으로 등록. 기존 6건 LLM cron은 follow-up 이슈로 점진 이관

### 의사결정 분기점

1. **풀셋 범위** — 사주 6종 only (life_signal은 Phase 3) — life_signal과 책임 분리
2. **시드 vs 매트릭** — 시드 풀셋 + 매트릭은 선별 + 빈 매트릭 evidence-only — 사용자 명시 ("매트릭은 전부 채우지 않아도 돼, 시드는 모두 등록")
3. **통합 시드 처리** — 기존 통합 + 풀셋 단일 둘 다 유지 — 데이터 풍부도 우선
4. **LLM 비동기 작업 운영** — Claude 앱 routines 통일 (ADR-0027) — 사용자 명시 "실시간 답변이 아닌 건 무조건 routines" → "LLM 호출 있는 비실시간 작업" 해석
5. **Element density 판정 기준** — 본인 8자 + 일진 2자 = 10자 기준 3+ — 명리학적 정합성 + 운 반영
6. **Relation 시드 trigger 표현** — `trigger_target_id=NULL` + `trigger_aux` JSONB (관계 명세) — relation은 단일 소속 아니므로 JSONB가 자연
7. **description 형식** — `<대상> 발현일 — <십신>(<해석>)` 패턴 + 사용자 임상 데이터 — ADR-0025 `description NOT NULL`과 자연스러움

### 사용자 임상 데이터 반영 (description에 박힘)

- **자수 (지지) — 상관** (사용자 임상 정정, 식신 X) — 충동적 식사/배달/과식, 다 뒤집어 엎기·전면 개편, 관성 충돌
- **갑목 (천간) — 편재** — 충동 지출·투자 명목 지출 주의, 일정 폭주·대청소·다 떠오름 (일을 많이 벌이는 경향)
- **사화 (지지) — 편관** — 추진·도전 + 신체 증상(대상포진·피부 트러블·탈진). 사술원진/오행 쏠림 동반 시 강화 — 분리 검증 필요
- **편인 (자기 일지 술토 / 진토 / 무토)** — 깊은 몰입, 철학적 사고, 영화·책 깊게 봄
- **진술충** — 본인 일지 충, 자기 영역 흔들림, **과거 기억 문득문득 떠오름** ⚠️
- **사술원진** — 본인 일지 원진, **부모님/전남친에 대한 원망 발현** 가능 ⚠️
- **화 과다 (10자 중 3+)** — 화극금(본인 일간 경금 피해, 신체적 피로·발열·피부 트러블)
- **목 과다 (10자 중 3+)** — 재다신약(편재·정재 폭주, 일간 약화)
- **사 / 묘 (십이운성)** — 단절·체력 저하·몸 무거움·지침
- **건록 / 제왕 (십이운성)** — 활력·열정·업무 폭주·운동 잘됨

위 단서는 Phase 6 LLM이 evidence 60+일 보고 매트릭을 제안할 때 가설 hint로 활용. 단순 단일 시드(예: 사화) vs 복합 조건(사화 + 사술원진 / 사화 + 오행 쏠림)의 차별화는 Phase 6 자동 발견 후보.

### 포기한 안 / 미룬 항목

- **기존 16개 시드 이름 통일 마이그레이션** (`S1_갑목_편재_천간` → `pool_갑_천간`) — 운영 자산 보존 우선
- **풀셋 + 매트릭 자동 매핑** — Phase 6 LLM이 evidence 보고 제안. 자동 매핑은 가설 공간 폭주
- **사화 단독 vs 사술원진 vs 오행 쏠림 차별화** — description hint로 박아두고 Phase 6 자동 발견
- **축토 정인 vs 미토 정인 차이** — Phase 6 자동 발견 후보

### 회고

- **TypeScript 타입 변경의 파급 효과** — `SeedMatchResult.matched: boolean → boolean | null` 변경이 `compactMatchedLine`의 `filter((r) => r.matched)`에 자연스럽게 흡수됨 (null도 falsy). 명시적 분기를 추가하지 않고도 의도(evidence-only seed는 Slack 노출 안 함)가 표현됨 — 타입 시스템이 의도를 강제하는 좋은 사례
- **migration 070 생성 전략** — 161개 시드 SQL을 직접 손으로 쓰지 않고 TypeScript 스크립트가 stdout으로 생성. 십신 매핑·description·기존 시드 제외 규칙을 코드로 표현해 휴먼 에러 차단. 다만 `EXISTING_RELATIONS` 상수가 정의됐지만 사용되지 않음(LOOP 내부 하드코딩으로 대체) — 다음 phase에서 일회성 스크립트 정리 시 제거 가능
- **테스트 커버리지 trade-off** — `matchAllSeedsForDay`의 `matched=null` 분기를 직접 단위 테스트하려면 `getDayPillar`/`loadActiveSeeds`/`buildNameIdMap` 등을 새로 mocking해야 함. 3줄 ternary의 테스트 가치 < mocking 부담이라 판단, 대신 `evaluateTrigger`의 새 `relation {type, members}` 포맷을 5건 추가. 가설 후보 풀로 사용되는 trigger 평가가 더 중요한 검증 대상
- **사용자 임상 단서 description 박기** — 명리학적 십신만 적는 게 아니라 사용자 본인이 실제로 관측한 단서(예: "진술충 → 과거 기억 문득문득 떠오름")를 description에 박음. Phase 6 LLM이 evidence 60+일 보고 매트릭 제안할 때 가설 hint로 활용 — 자료가 LLM의 가설 공간을 좁히는 역할
- **ADR-0027 신설의 trigger** — Phase 2 인터뷰 중 Phase 6 LLM 매트릭 제안 슬롯을 어떻게 운영할지 분기점에서 발생. 사용자 명시 "실시간 답변이 아닌 건 무조건 routines" → 신규 ADR로 분리. 기존 Node.js cron 6건은 follow-up 이슈로 점진 이관 — 운영 패턴 통일이라 PR과 별도 트랙으로 분리하는 게 맞음

---

## Phase 2.5: 사주 시드 운 레벨 차원 도입 + 자동 분포 분석 cron (2026-05-28)

> [#445](https://github.com/hyewon3938/slack-ai-agents/issues/445), [ADR-0028](../adr/0028-pillar-level-and-threshold-pool.md)

### 도입 동기 (임상 단서)

Phase 2 풀세트 시드 161개를 머지한 직후, 다음 세 단서가 명료해졌다:

1. **천간 vs 지지 체감 차이**: 같은 십성이라도 천간(드러난 기운)으로 들어올 때와 지지(저변 기운)로 들어올 때 행동 패턴이 다를 가능성 — 사용자 임상
2. **운 레벨 차원 부재**: 일운 발현만 추적하면 월운·세운·대운에 같은 십성이 들어왔을 때 효과를 못 잡음
3. **누적 효과**: 한 오행이 5개 운 레벨(원국·대운·세운·월운·일운) 중 여러 곳에 동시 출현할 때 체감이 강해진다는 임상 단서 (예: 화 오행이 3개 이상 운 레벨에 누적되면 건강 이슈 발생)

Phase 2 시드는 모두 일운 single-shot 평가라 이 단서들을 정량 검증할 수 없었다.

### 결정 요약

**3개 결정을 ADR-0028로 묶음** (분리하면 결정 사이 종속성 사라짐).

#### (a) `pillar_level` 컬럼 도입

```sql
ALTER TABLE pattern_catalog ADD COLUMN pillar_level VARCHAR(20)
  CHECK (pillar_level IN ('wonguk', 'daeun', 'seun', 'wolun', 'ilun', 'cumulative'));

-- Phase 2 161개 시드를 'ilun'으로 backfill
UPDATE pattern_catalog SET pillar_level = 'ilun'
WHERE pattern_kind = 'saju' AND source = 'seed' AND pillar_level IS NULL;
```

`saju-match.ts:evaluateTrigger`는 `pillar_level`에 따라 `ctx.daily_pillar` / `ctx.monthly_pillar` / `ctx.yearly_pillar` / `ctx.major_pillar` / `ctx.natal_pillar` 중 어디서 매칭할지 분기.

#### (b) `cumulative_pillar_count` trigger + 풀셋 임계치

새 trigger type. `trigger_aux = { element?, sipsin?, count_min: N }`. 5개 운 레벨에서 같은 오행/십성이 N번 이상 출현하면 hit.

**임계치 N을 임의로 박지 않는다.** N=1, 2, 3, 4, 5를 **모두 별도 시드**로 등록. 풀셋 철학(Phase 2 갑자 차원)을 **임계치 차원으로 확장**.

14개 신규 시드:

| # | 시드명 | 운 레벨 | trigger | 임상 가설 |
|---|--------|--------|---------|----------|
| 1 | `pool_편재_갑_천간_일운` | ilun | stem=갑 | 천간 편재 일운 → 일 많이 벌이는 경향 |
| 2 | `pool_편재_갑_천간_월운` | wolun | stem=갑 | 천간 편재 월운 → 한 달 단위 일 폭주 |
| 3 | `pool_편재_인_지지_일운` | ilun | branch=인 | 지지 편재 일운 → 천간과 체감 비교 |
| 4 | `pool_편재_인_지지_월운` | wolun | branch=인 | 지지 편재 월운 |
| 5\~9 | `pool_편재_천간_누적_N1` \~ `N5` | cumulative | stem 십성=편재, count_min=N | 천간 편재 누적 N개 운 레벨 |
| 10\~14 | `pool_화_오행_누적_N1` \~ `N5` | cumulative | element=화, count_min=N | 화 오행 누적 N개 → 건강 이슈 |

#### (c) 자동 분포 분석 cron — 임의 가중치 배제

`pillar-level-distribution-review` cron — 매주 월요일 09:15 KST. 결정론 SQL([ADR-0027](../adr/0027-llm-async-routine-unification.md) 분류: 결정론 → Node.js cron).

```sql
-- 운 레벨별 hit rate 분포 + 누적 카운트 N별 hit rate 분포
-- 90일 윈도우, evidence-only 매칭 제외
```

`#insight` 채널에 한 줄 메시지 발송. LLM 해석 없음. 60\~90일 누적 시점에 임계치 학습과 운 레벨 가중치 적용을 **별도 후속 phase**(번호 TBD)로 진행. 자동화 cron 자체가 사용자에게 "지금 임계치 학습할 만한가" 트리거 역할 → 별도 follow-up 이슈 불필요.

### 의사결정 분기점

1. **임의값 박지 않기 원칙 (사용자 명시)**: "미리 임의의 값을 넣어두는 건 좀 별로임" — 운 레벨 가중치(일운 1.0, 월운 0.5 등) 박는 안 즉시 기각. 풀셋 임계치로 우회 결정
2. **천간 vs 지지 비교는 별도 시드** — `pillar_level='ilun'/'wolun'` × `trigger_target_type='stem'/'branch'` 조합으로 자연스럽게 분리. 한 시드 안에 두 차원 섞지 않음
3. **누적 카운트 trigger 도입 위치** — `element_density` 확장 안과 새 `cumulative_pillar_count` trigger 안 중 선택. element_density는 원국 single-shot이라 의미 다름 → 새 trigger 분리
4. **자동화 cron의 LLM 여부** — ADR-0027에 따라 결정론 SQL이므로 Node.js cron 잔존 결정. LLM 해석 도입 시 routines로 이관
5. **운 레벨 가중치 적용 시점** — 즉시 박지 않고 **60\~90일 데이터 누적 후 후속 phase**. 어느 phase 번호인지 미정 (Phase 8 마무리 시점에 부록 E와 함께 결정)
6. **scheduled-check 이슈 등록 여부** — 처음에는 60\~90일 후 점검용 이슈 등록 계획이었으나, 자동화 cron 자체가 트리거되므로 사용자 명시 "자동화 해두면 이슈에 박아둘 필요 없지 않아?" → 이슈 등록 항목 제거

### 핵심 변경

- 마이그레이션 071: `pattern_signals.pillar_level` 컬럼 + CHECK + index + Phase 2 161개 backfill = `'ilun'`
- `trigger_target_type` enum 확장: `'cumulative_pillar_count'` 추가
- `pattern_metrics.source_type` enum 확장: `'expense_category_present'` 추가 (cross-domain 메트릭)
- `saju-match.ts:evaluateTrigger`: `pillar_level` 분기 + `cumulative_pillar_count` 케이스 + `evaluateMetric`의 `expense_category_present` 케이스 + OR 매칭 (한 시드 → 여러 매트릭 후보 중 하나라도 hit이면 hit)
- `saju-calendar.ts`: `computeCumulativePillarCount(natal, daeun, seun, wolun, ilun)` 함수 — 오행/십성 카운트만 (누적 비중 아님)
- `src/cron/pillar-level-distribution-review.ts`: 신규 cron (Monday 09:15 KST, 결정론 SQL)
- `index.ts`: cron 등록
- 14개 신규 시드 SQL

### 사용자 임상 데이터 반영 (description에 박힘)

- "천간 편재 = 일을 많이 벌이는 경향" — 일간 庚金 기준 천간 甲에 해당
- "지지 편재 ≠ 천간 편재 체감" — 같은 십성이라도 체감 다름 (정량 검증 가설)
- "화 오행 누적 → 건강 이슈" — 화극금 체질, `health_complaint` 일기 enum + `의료/건강` 지출 카테고리로 cross-domain 검증

### 포기한 안 / 미룬 항목

- **운 레벨 가중치 박기** — 임의값 배제 원칙 위반. 풀셋 임계치로 우회
- **임계치 자동 추출 시점 이슈 등록** — 자동화 cron으로 대체
- **세운·대운 LLM 회고 해석** — 이미 마스터 #421로 이관됨 (Phase 2와 동일 결정)
- **천간 정관·정인 등 다른 십성도 같은 구조로 분화** — 편재만 1차 도입. 운영 검증 후 다른 십성 동일 패턴 복제 가능 (후속 phase)
- **`pillar_level='wonguk'` 시드** — 원국은 본인 사주 상수(천간 편재 항상 ON, 지지 편재 항상 OFF). 변동 가능한 일운·월운만 1차 도입. 원국 영향 검증은 누적 카운트 trigger가 대신함

### 회고

- **풀셋 임계치 정신을 운 레벨로 확장한 결정이 후속 phase의 길을 열었다** — Phase 2의 60갑자 풀셋과 본 phase의 운 레벨 풀셋(편재 일운/월운, 누적 카운트 시드)이 같은 "임의값 배제 + 데이터로 분포 발견" 원칙을 공유. Phase 3에서 life_signal 임계치 풀셋(수면 4개·streak 5개)을 동일 패턴으로 박을 수 있었던 건 본 phase가 인프라보다 **원칙을 먼저 정립**해 둔 덕
- **분포 분석 cron은 "운영 검증 1\~3개월 후 회고"를 대체하지 않는다** — 분포 분석 cron이 매주 cron으로 돌면서 운 레벨 빈도를 누적하는 형태이지만, 임계치 자동 추출 시점·signal 신호 강도 판단은 여전히 마스터 종료 후 부록 E 누적 회고와 같이 다뤄야 한다는 점이 본 phase 설계 중 명확해졌다
- **`pillar_level` 컬럼을 매트릭이 아닌 시드 catalog에 둔 결정** — 시드 레벨에서 "이 시드가 어느 운(원국/세운/대운/일운/월운)에 속하는지" 명시되니까 후속 cron이 시드 풀셋 전체를 운 레벨로 group by 가능. 매트릭에 박았으면 매트릭 폭주 시 정확도 떨어졌을 것

---

## Phase 3: `life_signal` 시드 풀 셋 + 매칭 cron 일반화 (2026-05-28)

- 이슈: [#447](https://github.com/hyewon3938/slack-ai-agents/issues/447)
- 관련 ADR: **[ADR-0029](../adr/0029-life-signal-trigger-aux-standard.md) 신설** (`life_signal` 단일 통합 + `trigger_aux.kind` 표준)
- 관련 계획서: `.claude/plans/447-phase-3-life-signal.md`
- 상태: 설계 완료, 구현 대기

### 결정 요약

`life_signal` 시드를 세 갈래로 풀세트 등록 + 매칭 cron이 `case 'life_signal'`로 일반화:

1. **환경 결정론 시드** (논리적 풀셋 A군 \~18개) — 요일 7 + 주말/평일 2 + 월말/월초/중순 3 + 계절 4 + 공휴일 + 공휴일 다음날 2
2. **임계치 풀셋 시드** (Phase 2.5 풀셋 임계치 정신 확장) — 수면 ≤ N시간 4개 (N=5,6,7,8) + 루틴 streak ≥ N일 풀셋 (N=3,5,7,14,30)
3. **11종 결정론 패턴 시드 승격** — `insights.ts` 11개 detect 함수(streak·sleepTrend·slotGap·weekComparison·overdueAlert·categorySkew·drift·recovery·lapseAlert·weeklyRegression·spottyPattern)를 `behavior_baseline` kind 시드로 등록

총 신규 시드 **38개**. 모두 `trigger_target_type='life_signal'` + `pattern_kind='life_signal'`. `trigger_aux.kind`(weekday / weekday_group / month_position / season / calendar_event / threshold / behavior_baseline) **7 kinds**로 평가 명세 분기.

매칭 cron(`evaluateTrigger`)에 `case 'life_signal'` 추가 + `src/shared/life-signal-evaluators/` 모듈 디렉토리 신설(kind별 evaluator 7개). `pattern_summary` view 본문은 Phase 4로 분리.

### 핵심 변경

- 마이그레이션 072: 신규 life_signal 시드 INSERT (38개)
- `src/shared/life-signal-evaluators/` — kind별 evaluator 7개 모듈 (lunar 폐기 — 폐기 결정 섹션 참조)
- `src/shared/saju-match.ts:evaluateTrigger` — `case 'life_signal'` 추가, `dispatchLifeSignal` switch
- `src/shared/saju-match.ts` — `LifeSignalKind` enum + `LifeSignalAux` discriminated union + `isLifeSignalAux` type guard
- 공휴일 lookup — `korean-holidays.ts` 정적 상수(2026년 15개 양력 날짜)
- 매트릭 정책 = 혼합 — 강한 임상 가설 있는 시드(예: 수면 ≤ 7시간 → 다음날 health_complaint, 월요일 → 일정 폭주)만 결정론 매트릭 채움. 나머지는 evidence-only(Phase 2 패턴)
- 잔소리 파이프라인(`insights.ts`) 그대로 유지 — 시드는 데이터 누적만, Phase 8 카드 UI에서 통합

### 의사결정 분기점

1. **Phase 4 view 분리** — view 정비(`pattern_summary` 본문)는 별도 Phase 4. Phase 3는 시드 + 매칭 cron까지만. PR 크기 관리 + 데이터 누적 후 view 본문 작성이 자연
2. **매트릭 정책** — 혼합. 강한 임상 가설(수면 ≤ N시간, 월요일·일요일 등)만 결정론 매트릭. 나머지 evidence-only — Phase 2 일관성
3. **1차 셋 범위** — 논리적 풀셋 A군 다 박기. life_signal은 사주 60갑자와 달리 자연 풀세트 경계가 없으나, 환경 차원(요일/월/계절)별로 논리적 풀셋 정의 가능
4. **11종 승격** — Phase 3 포함. 시드 등록만, 잔소리 파이프라인은 기존 `insights.ts` SQL 그대로 유지(일시 공존). Phase 8 카드 UI에서 통합
5. **수면·streak 임계치 풀셋도 Phase 3 포함** — ADR-0028 풀셋 임계치 정신 확장. 임의값 배제 원칙과 일치
6. **`trigger_target_type` 어휘** — `life_signal` 단일 통합. `behavior_signal` 분리 안 함. 평가 분기 본질은 type이 아니라 kind. ADR-0029
7. **`trigger_aux.kind` 표준** — 7 kind(weekday/weekday_group/month_position/season/calendar_event/threshold/behavior_baseline). evaluator 모듈 1:1 매핑. discriminated union 타입 안전성. (설계 시 8 kind였으나 `lunar`는 구현 직전 폐기 — 아래 "폐기 결정" 참조)

### 사용자 임상 데이터 (description에 박힘)

- **월요일** — 일정 폭주, 한 주 시작 부담
- **일요일** — 선데이 블루 가설(아직 임상 미확정)
- **수면 ≤ 7시간** — 다음날 health_complaint enum 발현 가능 (사용자 자주 언급)
- **월말 (마지막 3일)** — 카드 결제일 직전, 마무리 분위기
- **계절 환절기 (봄·가을)** — 알레르기·기분 변화
- **공휴일 다음날** — 명절 후유증 검증

### 포기한 안 / 미룬 항목

- **`behavior_signal` 분리 type** — 의미적 분리 매력적이나 평가 분기 본질이 kind라 type 분리 가치 ↓ (ADR-0029 Alternative A)
- **trigger 평가 SQL을 sql_body로 영속** — 환경 시드는 코드 분기가 단순, 11종은 SQL 복잡. trigger 평가는 code-first, sql_body는 매트릭 영역에 한정 (ADR-0029 Alternative B)
- **view 본문 작성** — Phase 4로 분리. 데이터 누적 후 작성이 자연
- **잔소리 시스템 통합** — Phase 8 인사이트 카드 UI 시점. 본 phase는 시드 시스템과 잔소리 시스템 일시 공존
- **임계치 매트릭 자동 매핑** — Phase 6 LLM 매트릭 발견 슬롯에 맡김 (사주 풀세트 패턴과 일치)
- **11종 detect 함수 폐기 + 시드 evaluator로 source of truth 일원화** — 일시 공존 유지. Phase 8 시점에 일원화 검토

### 폐기 결정 (구현 직후 cleanup)

- **`lunar` kind / 음력 1·15일 시드** — 구현 직후 PR cleanup에서 폐기. 사유:
  - 사주 운(運) 단위는 절기(立春·入夏 등) 기준이지 음력 1/15 기준이 아니다 → `life_signal` 카테고리에 두면 사주 도메인과 어휘 충돌
  - 명절 후유증 가설은 `calendar_event:holiday_next`(양력 한국 공휴일 lookup)로 커버 가능
  - 계절 환절기 효과는 `season:spring|autumn`로 커버 가능
  - 본인 음력 1/15 단일 효과에 대한 임상 가설 0개 → 시드 후보로 안 두는 게 카탈로그 순도 ↑
  - 양력→음력 변환 인프라(`korean-lunar-calendar` 패키지 등) 의존 1개 제거
  - 임상 가설 발견 시 별도 kind로 재도입 + 변환 인프라 신설 (ADR-0029 "폐기 결정" 섹션)
- **`autopay_day` kind 분리** — 시드는 유지하되 별도 kind 없이 `calendar_event:autopay_day`로 흡수. 자동이체일 추적이 환경 결정론 시그널이라는 점은 동일

### 미해결 / 가설

- **매칭 cron 부담** — Phase 2.5 후 175개 시드 + Phase 3 신규 \~35-40개 = \~215개. 매일 매칭 5초 한도 초과 가능. `behavior_baseline` kind는 baseline SQL이 무거우므로 측정 필수
- **공휴일 데이터 source** — 한국 공휴일 정적 상수(\~15개/년) vs API. 1차는 정적 상수, 운영 후 API 검토
- **자동이체일 본인 명시 일자** — 사용자별 설정 테이블 필요 or `.env` 박기. 1차는 한 시드 등록 + 본인 day_of_month 임시 박기 (`trigger_aux.day_of_month`), 사용자 설정 UI는 follow-up
- **잔소리 매트릭 → 시드 매트릭 source 일원화 비용** — Phase 8 시점에 11종 detect 함수 폐기 + 시드 evaluator만 유지로 일원화. 잔소리 메시지 빌드는 별도 layer

### 회고

- **`trigger_aux.kind` 7종 표준 + evaluator 모듈 1:1 매핑은 후속 phase 확장 비용을 크게 낮췄다** — 본 phase에서 7 kind 표준을 박은 직후 Phase 5(가설 발견·검증 파이프라인)에서 `life_signal` 시드도 동일 인터페이스로 처리됨. evaluator 추가 비용 = 새 파일 1개 + dispatch switch 1줄. discriminated union이 가져온 정합성이 후속에서 입증됨
- **`lunar` kind 구현 직전 폐기는 ADR 절차의 효용 사례** — ADR-0029 작성 중 음력 기준이 사주 절기 기준(立春)과 어휘 충돌한다는 점이 부각되어 구현 시작 전 폐기. ADR이 "결정 기록"만이 아니라 "결정 자체를 다시 검토하게 하는 강제 절차"로 기능. 코드 작성 비용 + 의존 패키지 1개 + 잘못된 임상 가설 1개를 사전에 막음
- **본 phase의 threshold sleep_minutes 시드가 실제 sleep_records 스키마와 어긋난 채 머지됨 → follow-up [#456](https://github.com/hyewon3938/slack-ai-agents/issues/456)에서 hotfix** — `evaluateThreshold`가 존재하지 않는 `wake_at`/`sleep_at` 컬럼을 가정. Phase 마무리 측정 좌수 시도 중 발견하지 못했다면 익일 09:00 매칭 cron이 전체 throw할 뻔. **`evaluateTrigger`가 try/catch 없이 호출되어 단일 시드 SQL 오류가 매칭 전체를 죽이는 구조**도 같이 노출됨 — Phase 8 또는 별도 안정성 chore에서 per-seed try/catch 격리 검토 필요
- **인접 reader(insights.ts)의 컬럼명을 따라가는 코드 리뷰 체크리스트가 필요** — 신규 evaluator 작성 시 동일 테이블을 다루는 기존 reader가 어떤 컬럼을 쓰는지 1분 grep으로 확인하는 단계만 있었어도 본 hotfix는 미연 방지 가능. `/build` 5-3 보안 감사 단계에 "동일 테이블의 다른 reader 컬럼 일치 점검" 추가 후보

---

## Phase 4: 매칭 cron 카운터 source of truth 전환 + pattern-match rename (2026-05-28)

- 이슈: [#449](https://github.com/hyewon3938/slack-ai-agents/issues/449)
- 관련 ADR: [ADR-0023](../adr/0023-metric-unit-counter-and-summary-view.md) (실행), [ADR-0024](../adr/0024-bayesian-posterior-update.md) (산식만), [ADR-0026](../adr/0026-pattern-prefix-rename.md) (파일명까지)
- 관련 계획서: `.claude/plans/449-phase-4-metric-counter.md`
- 상태: 설계 완료, 구현 대기

### 결정 요약

ADR-0023이 결정한 매트릭 단위 카운터 source of truth를 실제 코드로 실행한다. 현재는 Phase 1에서 신설된 `pattern_summary` view가 마스터 A 한 곳에서만 활용 중이고, `verifyDailyMatches`는 여전히 `pattern_catalog`의 deprecated 카운터를 UPDATE 중 — 즉 ADR-0023의 의도가 구현 단절 상태.

본 phase로 4개 코드 경로가 전환된다:

1. `verifyDailyMatches` — `pattern_metrics.hit_count/miss_count/inconclusive_count` + `last_matched_at` + Bayesian `posterior_alpha/beta/p` 동시 갱신. evidence-only 시드(matched IS NULL)는 status='inconclusive'만 박고 카운터 SKIP.
2. `compactMatchedLine` — `seed.hit_count` 정렬을 `pattern_summary.total_hits`로 전환 (sync → async).
3. `loadActiveSeeds` — catalog의 deprecated 카운터 컬럼 SELECT 제거.
4. `matchAllSeedsForDay` — 시드 수·duration_ms 로그 (cron 부담 측정, 5초 한도 관측).

추가로 ADR-0026의 prefix 통일성을 파일명까지 확장: `saju-match.ts` → `pattern-match.ts`, `daily-saju-matching.ts` → `daily-pattern-matching.ts`. 잔존 `saju-hypothesis.ts`·`saju-seed-fast-path.ts` 등은 Phase 5 진입 전 follow-up PR로 분리.

### 핵심 변경

- `src/shared/pattern-match.ts` (rename + verifyDailyMatches 매트릭 갱신 + compactMatchedLine async)
- `src/shared/types.ts` — `PatternCatalog`의 hit/miss/inconclusive deprecated 표시 또는 optional
- `src/cron/daily-pattern-matching.ts` (rename + `await compactMatchedLine`)
- import 경로 일괄 갱신 (cron/agents/scripts)
- 새 ADR 없음 — ADR-0023의 실행 단계

### 의사결정 분기점

1. **evidence-only 시드 카운터 처리** — 매트릭 0개면 카운터 자체 비대상 (verify_status='no_metric'만 박고 SKIP). 이중 source 방지 + Phase 2 패턴(`no_metric` enum) 자연 계승
2. **정렬 기준** — `pattern_summary.total_hits` 사용. view derive 패턴 정착. aggregate_posterior_p는 Phase 7 운영 검증 전이라 미루고, 카운트 단순 정렬이 현 단계 적합
3. **Bayesian posterior 갱신 시점** — Phase 4에서 같이 갱신 (산식 `alpha = 1+hit, beta = 1+miss`). counter source가 같은 위치에서 갱신되는 게 정합성 ↑. Phase 7은 UI/가설 카드 노출 + 임계치 정책으로 scope 축소
4. **catalog deprecated 카운터** — 잔존 유지 + 코드 참조 완전 제거. Phase 8에서 DROP 검토 (단발 PR diff 최소화)
5. **매칭 cron 부담 측정** — 본 PR에 포함 (간단한 시간 로그). 5초 한도 초과 시 follow-up 이슈로 인덱스/분리 cron 조치
6. **파일명 rename 범위** — Phase 4는 `pattern-match.ts`·`daily-pattern-matching.ts` 두 쌍만. 나머지(`saju-hypothesis`·`saju-seed-fast-path`·`saju-hypothesis-backtest`)는 사용자 명시 "phase 5 진입 전 후속작업" — 별도 follow-up PR로 빼서 본 phase 의도 명확화

### 포기한 안 / 미룬 항목

- **pattern_summary view를 fast path `/insight pattern-summary` 명령어로 노출** — Phase 8 카드 UI와 중복, 사용자 임상 데이터 결정 기준 명확치 않음
- **분포 분석 cron 신설(pillar-level cron 패턴 확장)** — Phase 6 LLM 슬롯 입력으로도 가능한 정보. PR 비대화 회피
- **catalog 카운터 즉시 DROP** — backfill된 과거 값 손실 + view 정합성 검증 비용. Phase 8까지 marker로 잔존
- **잔존 saju-* 파일 일괄 rename (saju-hypothesis 등)** — Phase 5 진입 전 별도 follow-up PR. 본 phase는 매칭 cron 중심으로 scope 한정
- **시드 1:N 매트릭 분기 처리** — Phase 5+ 시드 1:N 매트릭이 실제 발생하는 시점에 metric_values JSONB로 매트릭별 outcome 기록 + verifyDailyMatches 분배 분기 추가

### 미해결 / 가설

- **매칭 cron 5초 한도** — Phase 2.5 + Phase 3 후 시드 213+개. behavior_baseline 11개가 SQL 부담 주축. 측정값에 따라 인덱스 최적화 또는 분리 cron 필요할 수 있음
- **시드:매트릭 1:1 가정의 수명** — 현 운영 정확. Phase 6 LLM 매트릭이 동일 시드에 추가 매트릭을 붙이는 시점부터 분배 로직 필요

### 회고

- **catalog → metrics 카운터 전환은 4단계 deprecation 패턴이 정착되는 첫 사례**: Phase 1에서 backfill, 본 phase에서 reference 제거, Phase 8에서 DROP. 한 PR에서 다 하면 빌드 깨질 위험 있는 schema migration에서 이 패턴이 비용 대비 안전성 높음
- **evidence-only (matched IS NULL) 분기는 Phase 2의 `no_metric` 패턴이 그대로 카운터에 살아남는 흐름** — Phase 2에서 enum + verify_status 분기를 미리 박아두지 않았으면 Phase 4 verifyDailyMatches가 evidence-only 시드를 잘못 hit/miss로 카운트할 뻔. phase 간 invariant 누적이 효과를 발휘한 케이스
- **compactMatchedLine sync → async 전환은 PR 진단 가치가 높았다**: view SELECT 의존이 생기는 시점에 caller가 자동으로 await하는지 typecheck로 확인. `runDailyPatternMatchingDryRun` 한 곳만 caller라 변경 비용이 작았고 단일 PR로 완결됨
- **파일명 rename은 의외로 import 일괄 갱신이 부담** — 8 evaluator + 6 test + life-cron + insights comment + 3 rename = 18 파일 동시 수정. SLOT_TASKS 키 `dailySajuMatching`만 DB 호환성을 위해 보존하는 비대칭이 발생 (DB 컬럼은 코드 rename을 쉽게 따라가지 못함을 재확인)
- **Bayesian posterior를 Phase 4에 흡수한 결정은 정합성 ↑**: counter source가 같은 위치에서 갱신되니 Phase 7이 UI/임계치 정책에만 집중 가능. 다만 산식 검증 테스트(`posterior_alpha + 1.0` 형태)가 SQL 문자열 매칭으로만 가능해 vitest assertion이 조금 약함 — Phase 7에서 헬퍼로 추출하면서 단위 테스트 추가 예정
- **매칭 cron elapsed log를 본 phase에서 박은 결정이 follow-up [#456](https://github.com/hyewon3938/slack-ai-agents/issues/456)에서 가치 입증** — Phase 5 후 elapsed log 누적 측정 시도(좌수 실행) 중 Phase 3의 threshold SQL 컬럼 불일치를 우연 발견·hotfix. 측정 인프라가 의도된 측정 목적 외에도 운영 정합성 점검 도구로 기능. 측정 누적은 본 PR 머지 후 자연 누적되도록 분리

---

## Phase 5: 가설 발견·검증 파이프라인 target-type 확장 대응 (2026-05-28)

- 이슈: [#454](https://github.com/hyewon3938/slack-ai-agents/issues/454)
- 관련 ADR: 새 ADR 없음. [ADR-0019](../adr/0019-saju-hypothesis-verification-pipeline.md) 위 실행. [ADR-0026](../adr/0026-pattern-prefix-rename.md)·[ADR-0029](../adr/0029-life-signal-trigger-aux-standard.md) 기반
- 관련 계획서: `.claude/plans/454-phase-5-discovery-cards.md`
- 상태: 설계 완료, 구현 대기

### 결정 요약

Phase 4까지 매칭 cron이 saju 175 + life_signal 38 = 213개 시드의 `trigger_activated`를 누적하기 시작했고, `hypothesis-discovery.ts`는 ADR-0019 단계에서 시드 ID 기반 type-agnostic으로 작성됐기에 데이터 흐름은 이미 일반화 완료 상태. 본 phase는 코드 흐름이 아닌 **운영 가시성 + cap 분리 + 동작 검증**에 집중.

남은 작업 3건:

1. **카드 출처 표시** — `buildCandidateCard`·`buildWeeklyReviewBlocks`가 saju/life_signal 출처를 prefix(`[사주]` / `[생활]`)로 표시. 텍스트 prefix 선택(이모지 충돌 회피, 컨벤션 안전)
2. **신규 가설 후보 cap 분리** — `slice(0, 5)` 단일 cap → `pattern_kind`별 분리 cap (saju 최대 5 + life_signal 최대 5, 발견된 만큼만)
3. **DISCOVERY 임계치 유지** — `q<0.2`, `p<0.1`, `ratio≥1.3`, `n≥5` 그대로. BH-FDR이 조합 N으로 자동 보정(`q = p × N / rank` 산식)하므로 N이 13배 늘면 같은 p에 대해 q도 13배 더 엄격. 임의값 박지 않기 헌장 정합

새 ADR 작성 불필요 — UI 표시·cap 분리는 되돌리기 쉽고 ADR-0019 위 운영 결정.

### 핵심 변경

- `src/agents/insight/hypothesis-discovery.ts` — `ActiveSignal`·`CandidateHypothesis`에 `patternKind: 'saju' | 'life_signal'` 필드 추가, `loadActiveSignals` SQL에 `pattern_kind` SELECT
- `src/agents/insight/hypothesis-cards.ts` — `KIND_LABEL` 상수 + `buildCandidateCard` header prefix + `buildWeeklyReviewBlocks`의 cap 분리(saju/life_signal 각각 5개) + 신규 후보 섹션 헤더에 `사주 N / 생활 M` 카운트 + `ActiveHypothesisRow`에 `patternKind`
- `src/cron/weekly-hypothesis-review.ts` — `loadSignalNames` → `loadSignalMeta` (pattern_kind 동반 SELECT), `ActiveHypothesisRow` 빌드 시 `patternKind` 채움
- 신규 vitest — `hypothesis-cards.test.ts`(prefix·cap 분리·카운트 헤더·0건 처리)

### 의사결정 분기점

1. **임계치 재조정 vs 유지** — A 유지 선택. BH-FDR 자동 보정 충분 + 헌장 정합 + 분리 통제(임계치는 신뢰도용, cap은 노출용 책임 분리). B 안(q<0.1) C 안(n≥7)은 운영 데이터 없이 추측해 박는 추가 임의값
2. **prefix 어휘** — `[사주]` / `[생활]` 텍스트 선택. 이모지 prefix는 본 프로젝트 에이전트 말투 톤(이모지 금지)과 충돌, 텍스트 prefix는 안전 + 카드 라벨링 컨벤션 자연
3. **cap 분리 방식** — 종류별 5개씩 분리 (saju 5 + life_signal 5). 발견된 만큼만 노출 — 0건이면 안 나옴. 단일 cap(5) 시 saju 임상 가설 강해 life_signal 가려질 위험 회피
4. **새 ADR 작성 여부** — 불필요. UI 표시·cap 분리는 되돌리기 쉽고, 임계치 유지는 ADR-0019 결정 그대로
5. **discovery 코드 변경 범위** — `CandidateHypothesis`에 `patternKind` 필드 1개만 추가, 통계 알고리즘은 변경 없음. 검증 부담 ↓

### 사용자 임상 데이터

본 phase는 데이터 모델·통계 신규 도입 없음. Phase 3에서 박힌 life_signal 시드 38개의 description(요일 효과·수면 ≤ N시간·streak 등 사용자 임상 단서)이 카드 노출에서 그대로 활용됨.

### 포기한 안 / 미룬 항목

- **임계치 조이기** (q<0.1·n≥7 등) — 헌장 "임의값 박지 않기" 위배. 운영 1~3개월 누적 후 데이터 보고 재조정. 마스터 close 시 follow-up 이슈 일괄 등록
- **outcome enum 확장** (life_signal/metric 카운터를 outcome으로) — 본 phase scope 외. 데이터 모델 확장 + 통계 의미 확장이라 별도 phase 후보. 현재는 `diary_meta_tags` 22개만 outcome
- **cap 늘리기** (5→8 또는 10) — 단순 확장은 사용자 검토 부담만 증가. 분리 cap(5+5)으로 두 카테고리 노출 보장
- **카드 디자인 별도 섹션 분리** — saju 후보 / 생활 후보 두 section header로 묶는 안. prefix만으로 충분히 시각 구분, 디자인 부담 ↑
- **이모지 prefix** — 에이전트 말투 톤(이모지 금지)과 충돌 회피

### 미해결 / 가설

- **첫 주 후보 노출량** — saju 175 + life_signal 38 × enum 22 = 4,686 조합 BH-FDR 보정 후 임계치 통과 후보가 몇 개 나올지 사전 예측 불가. 0개일 가능성도 있고 30개일 가능성도 있음. 운영 첫 주 결과 보고 follow-up 판단
- **active 가설 prefix 일관성** — 현재 active 가설은 ADR-0019 시점에 등록된 사주 시드 기반. life_signal 시드의 첫 active 가설은 본 phase 머지 후 후보 → 등록 사이클을 통해야 발생. 첫 사례 발생 시 카드 표시 검증
- **behavior_baseline kind 11개의 discovery 부담** — 매칭 cron 5초 한도 점검은 Phase 4 미해결 사항으로 표시. discovery는 setup 모드(lookbackDays=90)에서 가장 부담. 운영 데이터 보고 분리 cron 검토

### 회고 (TODO: `/build` 구현 후 보강)

> 회고는 PR 머지 후 추가. 운영 첫 주 결과(saju/life_signal 후보 비율, 노이즈 정도, 카드 가독성)도 같이 보강.

---

## Phase 6\~8 (TODO: 각 Phase 진입 시 섹션 누적)

> 각 Phase 진입 시 `/design`이 본 문서에 해당 Phase 섹션을 추가한다. 템플릿: 결정 요약 / 의사결정 분기점 / 포기한 안 / 회고.

## 기술적 의의

- target-type 일반화로 사주 검증 시스템을 본인 1명 패턴 발견 시스템으로 확장. 사주 갑자와 라이프 통념(요일·계절 등)을 동일 통계 파이프라인에서 처리
- Frequentist(Fisher + BH-FDR)와 Bayesian(Beta-Binomial posterior)을 병기해 n=1 환경의 누적 단계별 신뢰도 추정 강화
- LLM 자율 매트릭 + 사용자 승인 게이트로 결정론과 자율 영역의 신뢰 비용 분리 유지
