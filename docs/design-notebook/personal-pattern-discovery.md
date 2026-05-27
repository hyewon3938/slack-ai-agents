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

- [ ] **Phase 1**: 스키마 일반화 + `pattern_*` rename — 테이블·컬럼 rename (`saju_signal_*` → `pattern_*`, ADR-0026), `trigger_target_type` CHECK constraint 확장(`life_signal` 추가), `pattern_metrics`에 `description TEXT NOT NULL` + `window_days INTEGER` + `hit_count/miss_count/inconclusive_count` + `status` 컬럼, `posterior_alpha/beta/p` 예약, `pattern_summary` view 신설, `saju_influence_summary` view body 재정의 (운영 자산 보존)
- [ ] **Phase 2**: 사주 시드 풀 셋 — Phase 3에서 작성된 시드를 카탈로그 풀(전체) 검토 + 누락 보완 (s1 일부만 작성된 상태였음)
- [ ] **Phase 3**: `life_signal` 시드 풀 셋 — 요일(월\~일 7) / 주말(2) / 월말(1) / 월초(1) / 계절(4) 등 1차 셋. 결정론 매트릭으로 작성
- [ ] **Phase 4**: 매칭 cron + view 정비 — 매칭 cron이 `trigger_target_type='life_signal'`도 처리하도록 확장. `pattern_summary` view 본문 작성
- [ ] **Phase 5**: 가설 발견·검증 업데이트 — `hypothesis-discovery`가 `life_signal` trigger를 포함하도록 일반화. weekly 가설 리뷰 카드 본문에 출처(`pattern_kind`) 표시
- [ ] **Phase 6**: LLM 자율 매트릭 + 승인 게이트 — 월간 LLM 슬롯이 매트릭 후보를 생성, Slack 승인 UI(`/insight metric-approve` + Block Kit inline button). 활성화된 매트릭만 매칭 cron 진입
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

## Phase 2\~8 (TODO: 각 Phase 진입 시 섹션 누적)

> 각 Phase 진입 시 `/design`이 본 문서에 해당 Phase 섹션을 추가한다. 템플릿: 결정 요약 / 의사결정 분기점 / 포기한 안 / 회고.

## 기술적 의의

- target-type 일반화로 사주 검증 시스템을 본인 1명 패턴 발견 시스템으로 확장. 사주 갑자와 라이프 통념(요일·계절 등)을 동일 통계 파이프라인에서 처리
- Frequentist(Fisher + BH-FDR)와 Bayesian(Beta-Binomial posterior)을 병기해 n=1 환경의 누적 단계별 신뢰도 추정 강화
- LLM 자율 매트릭 + 사용자 승인 게이트로 결정론과 자율 영역의 신뢰 비용 분리 유지
