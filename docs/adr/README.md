# Architecture Decision Records (ADR)

되돌리기 어려운 설계 판단을 기록하는 문서.
**"왜 이렇게 했는가"** 를 남긴다. 구현 세부사항이 아니라 **판단의 근거**가 핵심이다.

---

## ADR이란

설계 판단 중 **되돌리기 어렵고, 여러 선택지를 놓고 고민했고, 판단 기준을 남길 가치가 있는 것**만 ADR로 기록한다.

구현 완료 기록은 [docs/project-history.md](../project-history.md)가 담당한다. ADR은 **판단의 맥락(Context)과 트레이드오프(Consequences)** 를 남기는 데 집중한다.

### 왜 필요한가

- 6개월 뒤 과거의 내가 "왜 이렇게 짰지?" 할 때 답이 된다
- 비슷한 선택이 다시 나왔을 때 같은 고민을 반복하지 않는다
- 외부에 프로젝트를 소개할 때 "어떤 판단을 거쳐 지금 구조가 됐는가"를 보여줄 수 있다

---

## 포맷 — Michael Nygard 형식

```markdown
# <번호>. <짧은 제목>

- Status: Accepted | Superseded by ADR-xxxx | Deprecated
- Date: YYYY-MM-DD
- Related: #이슈번호, PR #PR번호
- Tags: infra | data | security | process | ...

## Context
어떤 상황에서 이 판단이 필요했는가. 배경과 제약 조건.

## Decision
무엇을 선택했는가. 구체적 구조·도구·방법.

## Alternatives considered
어떤 대안을 놓고 고민했는가. 각각의 장단점.

## Consequences
이 선택이 가져온 결과.
- 장점
- 단점 / 제약
- 앞으로 이것 때문에 추가로 할 일
```

---

## 기록 기준 — 언제 ADR을 쓰는가

아래 조건 중 **2개 이상** 해당되면 ADR 작성:

- [ ] **되돌리기 어렵다** — 바꾸려면 여러 파일·문서·외부 시스템 동시 변경 필요
- [ ] **대안이 있었다** — 하나 이상의 대안을 놓고 고민했고, 트레이드오프가 존재
- [ ] **장기 영향이 크다** — 6개월\~1년 뒤에도 이 판단을 참조할 일이 있음
- [ ] **온보딩에서 설명이 필요하다** — "왜 이렇게 짰지?" 하고 새로 합류한 사람이 물어볼 만함
- [ ] **판단 근거가 비자명하다** — 코드만 봐서는 왜 그렇게 짰는지 바로 안 보임

### ADR이 **아닌** 것

- 단순 기능 추가 (예: 새 API 엔드포인트 추가) → `docs/project-history.md`
- 버그 수정 → 커밋 메시지 + 이슈
- 코드 스타일·네이밍 → `docs/conventions.md`
- 라이브러리 버전 업 (호환성 이슈 없으면) → PR만

### 판단이 애매하면

**작게라도 기록하는 쪽**을 선택한다. 나중에 "쓸걸" 하는 비용이 "썼는데 별 내용 아님"의 비용보다 크다.

---

## 운영 규칙

### 파일명

```
docs/adr/NNNN-<kebab-case-제목>.md
```

- `NNNN` — 4자리 zero-padded 번호 (0001, 0002, ...)
- 제목은 간결하게. ADR 자체의 짧은 제목 (예: `0005-uptime-monitoring-github-actions.md`)

### 번호 부여

- 다음 번호를 쓴다. 비어 있는 번호를 재활용하지 않는다
- 동시에 여러 PR에서 ADR을 쓰는 경우 먼저 머지되는 쪽이 낮은 번호를 가진다

### 불변성 (Immutability)

- 한번 `Accepted` 된 ADR의 **Decision / Context / Alternatives / Consequences 본문은 수정하지 않는다**
- 판단이 바뀌면 → **새 ADR**을 만들고, 기존 ADR의 Status를 `Superseded by ADR-NNNN`으로 업데이트
- 오탈자·링크 깨짐 같은 건 수정 가능

### Status 라이프사이클

- `Proposed` — 작성 중, 아직 합의 안 됨
- `Accepted` — 합의 완료. 현재 유효
- `Superseded by ADR-NNNN` — 후속 ADR로 대체됨
- `Deprecated` — 더 이상 유효하지 않으나 대체 ADR 없음

개인 프로젝트에서는 대부분 바로 `Accepted`로 작성하고, 후에 `Superseded`로 전환한다.

---

## 인덱스

| 번호 | 제목 | Status | Date | Tags |
|------|------|--------|------|------|
| [0001](0001-sql-tool-llm-agent.md) | SQL 도구 기반 LLM 에이전트 설계 | Accepted | 2026-03-08 | architecture, llm, data |
| [0002](0002-v3-architecture-split.md) | v3 아키텍처 — Vercel 웹 + VM 봇 + managed DB | Accepted | 2026-03-12 | infra, architecture |
| [0003](0003-self-hosted-postgres.md) | DB 자가 호스팅 전환 (Neon → VM PostgreSQL) | Accepted | 2026-04-06 | infra, data |
| [0004](0004-db-proxy-api.md) | DB Proxy API 패턴 — Vercel→VM DB 직결 제거 | Accepted | 2026-04-09 | infra, security |
| [0005](0005-uptime-monitoring-github-actions.md) | GitHub Actions 기반 자체 업타임 모니터링 | Accepted | 2026-04-22 | infra, observability |
| [0006](0006-modify-db-confirm-flow.md) | modify_db 대량 변경 확인 플로우 | Accepted | 2026-04-22 | security, llm, ux |
| [0007](0007-flexible-spent-unified-definition.md) | 자유지출 정의 통일 — directFlex + plannedOverflow | Accepted | 2026-05-06 | data, budget |
| [0008](0008-daily-budget-base-vs-recommended.md) | 일 예산 산정 모델 이중화 — 기준 일 예산 + 오늘 예산 | Accepted | 2026-05-06 | data, budget, ux |
| [0009](0009-daily-log-baseline-anchor.md) | 일별 로그 평가 기준 — 기준 일 예산 단일 anchor | Accepted | 2026-05-06 | data, budget, ux |
| [0010](0010-daily-log-cron-schedule.md) | 일별 예산 로그 cron 시각 — KST 새벽 5시 + 전일 스냅샷 | Accepted | 2026-05-07 | infra, data, process |
| [0011](0011-saju-patterns-cross-domain.md) | 사주 패턴 cross-domain 통합 + evidence JSONB 표준화 | Accepted | 2026-05-08 | data, insight, process |
| [0012](0012-fortune-personalization.md) | 운세 분석 개인화 — 라이프 테마 두 트랙 + 의사결정 가이드 + 자연 prose | Accepted | 2026-05-08 | data, llm, ux |
| [0013](0013-schedule-category-fk-migration.md) | 일정 카테고리 — TEXT 참조 → 단일 FK + parent_id 계층화 | Accepted | 2026-05-13 | data, schema, refactor |
| [0014](0014-insight-engine-unification.md) | 프로액티브 인사이트 엔진 통합 — 매일·주간 단일 엔진 + 임계치 외부화 | Accepted | 2026-05-13 | data, insight, process |
| [0015](0015-asset-auto-deduction-policy.md) | 자산 자동 차감 정책 — 결제주기 종료 cron + 할부 미래 회차 즉시 반영 | Superseded by [0051](0051-budget-model-simplification-runway-locked.md) | 2026-05-14 | data, budget |
| [0016](0016-llm-autonomous-slot-outcome-verification.md) | LLM 자율 발견 슬롯 + Outcome-based 검증 | Superseded ([0043](0043-retire-v2-llm-autonomous-discovery.md)) | 2026-05-16 | data, insight, llm |
| [0017](0017-saju-ganji-master-normalization.md) | 사주 60갑자 마스터 정규화 + 카탈로그 기반 일일 매칭 | Accepted | 2026-05-17 | data, architecture |
| [0018](0018-installment-runway-scope-toggle.md) | 할부 자산 차감 범위 토글 — `distribute_to_runway` 분기 | Superseded by [0051](0051-budget-model-simplification-runway-locked.md) | 2026-05-20 | data, budget |
| [0019](0019-saju-hypothesis-verification-pipeline.md) | 프로액티브 인사이트 v2 Phase 4 — 가설-검증 정량 파이프라인 | Accepted | 2026-05-21 | data, llm, statistics |
| [0020](0020-fortune-system-responsibility-split-via-view.md) | 사주 풀이 시스템과 v2 매칭 시스템 책임 분리 + view 인터페이스 도입 | Accepted | 2026-05-26 | data, insight, architecture |
| [0021](0021-web-shared-saju-code-duplication.md) | web shared 사주 계산 코드 — 복제 방식 채택 | Accepted | 2026-05-26 | process, web, shared-code |
| [0022](0022-target-type-generalization.md) | target-type 일반화 — 사주 6종 + life_signal 통합 (단일 카탈로그) | Superseded by ADR-0026 | 2026-05-27 | data, insight, architecture |
| [0023](0023-metric-unit-counter-and-summary-view.md) | hit/miss 카운터는 매트릭 단위 + seed 합계는 view로 derive | Accepted (어휘 정정) | 2026-05-27 | data, insight, schema |
| [0024](0024-bayesian-posterior-update.md) | Beta-Binomial Bayesian posterior 도입 — frequentist 검증과 병기 | Accepted | 2026-05-27 | data, statistics, insight |
| [0025](0025-llm-metric-approval-gate.md) | LLM 자율 매트릭 승인 게이트 — `description NOT NULL` + Slack inline button | Accepted | 2026-05-27 | data, llm, ux |
| [0026](0026-pattern-prefix-rename.md) | `pattern_*` prefix 전면 rename — saju_signal_* 잔존 결정 폐기 | Accepted | 2026-05-27 | data, insight, architecture, refactor |
| [0027](0027-llm-async-routine-unification.md) | LLM 비동기 작업 Claude 앱 routines 기반 통일 | Accepted | 2026-05-28 | process, llm, infra, ops |
| [0028](0028-pillar-level-and-threshold-pool.md) | 사주 시드 운 레벨 차원 도입 + 풀셋 임계치 철학 + 임의값 배제 | Accepted | 2026-05-28 | data, insight, architecture, process |
| [0029](0029-life-signal-trigger-aux-standard.md) | `life_signal` 단일 type 통합 + `trigger_aux.kind` 평가 명세 표준 | Accepted | 2026-05-28 | data, insight, architecture, schema |
| [0030](0030-llm-metric-suggest-input-and-cadence.md) | LLM 매트릭 제안 슬롯 — 입력 풀 구성 + 거절 재제안 + 월간 cron | Accepted | 2026-05-28 | llm, insight, ops |
| [0031](0031-daily-insight-synthesis.md) | 일일 종합 인사이트 — 개인화 주입 지점을 생성에서 발송으로 이동 + 신뢰도 tier 종합 | Accepted | 2026-06-03 | data, insight, llm, architecture |
| [0032](0032-metric-first-verification-statistics.md) | n=1 패턴 검증 통계 스택 — Fisher+permutation / BH-FDR / Beta-Binomial+e-value / Mann-Whitney / empirical-Bayes | Accepted | 2026-06-04 | insight, statistics, architecture |
| [0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) | 매트릭=가설 5어휘 재정의 + 결정론 사주 feature substrate (생극·합충·합화 → feature, graded 레벨 비단조) | Accepted | 2026-06-04 | insight, schema, architecture, statistics |
| [0034](0034-evalue-construction-replay-test-martingale.md) | e-value 구성 — 결정론 리플레이 betting test martingale (SET 정합 + null 시뮬 빌드 게이트) | Accepted | 2026-06-05 | insight, statistics |
| [0035](0035-graded-confidence-exposure.md) | 등급별 노출 정책 — 검증됨/검증중/오늘발현 3-tier (엄격 게이트는 확정 주장에만) | Accepted | 2026-06-05 | insight, ux, architecture |
| [0036](0036-relative-quantile-strength-bands.md) | 강도 feature 밴드를 상대 분위수로 정의 — n=1 자기 패턴 발견(남 비교면 절대, 자기 패턴이면 분위수) | Accepted | 2026-06-05 | insight, statistics, architecture |
| [0037](0037-verification-fdr-family-split.md) | 검정 FDR 가족 분리 — 강도 feature 시드를 자체 가족으로(빠른 트랙 보호) | Accepted | 2026-06-05 | insight, statistics |
| [0038](0038-saju-relation-hwa-feature-depth.md) | 사주 관계·합화 변환 feature 깊이 — 검증 결정론(v1a)·해석 LLM 분리 + FDR 가족 확장 | Accepted | 2026-06-05 | insight, statistics, architecture, saju |
| [0039](0039-pattern-discovery-surface-and-approval-gate.md) | 패턴 발굴 — surface-only 제안 + 사람 승인 게이트(노출·큐레이션 vs 믿음 분리) | Accepted | 2026-06-05 | insight, statistics, architecture |
| [0040](0040-llm-signal-sql-validation-and-execution-isolation.md) | LLM-생성 신호 SQL 검증·실행 격리 — untrusted 측정 SQL 2단 방어 (+ 옛 LLM 제안 재정의) | Accepted | 2026-06-06 | insight, security, llm, architecture |
| [0041](0041-confound-cofiring-flag.md) | 교란 플래그 — marginal 공동발현 overlap 탐지 + annotate-only (P6/P7 분리) | Accepted | 2026-06-06 | insight, statistics, architecture |
| [0042](0042-confound-multivariate-stratification.md) | 교란 다변량 분리 — Mantel-Haenszel 층화 + 데이터 게이트 + 노출 레이어 soft-demote | Accepted | 2026-06-06 | insight, statistics, architecture |
| [0043](0043-retire-v2-llm-autonomous-discovery.md) | v2 LLM 자율 발견 슬롯 은퇴 — 통계 기반 발굴(0039/0040)로 대체 | Accepted | 2026-06-07 | insight, llm, process, cleanup |
| [0044](0044-discovery-measurement-validity.md) | 발굴·검증 측정 타당성 — 데이터-존재 윈도우 + 연속신호 효과크기 랭킹 | Accepted | 2026-06-08 | insight, statistics, architecture |
| [0045](0045-card-label-layer.md) | 카드 라벨 레이어 — 런타임 코드 번역 (DB 컬럼 아님) | Accepted | 2026-06-08 | insight, architecture |
| [0046](0046-signal-seed-precision.md) | 신호·시드 측정 정밀화 — 방향 분리 + 누적→강도밴드 위임 + 포화 양방향 가드 + 동어반복 필터 | Accepted | 2026-06-08 | insight, statistics, architecture |
| [0047](0047-discovery-recommendation-cadence.md) | 발굴 후보 재추천 — 데일리 반응형 cadence (전용 슬롯 + pattern_links 파생 상태, 묶음 전부 패스 시 다음 best) | Accepted | 2026-06-08 | insight, architecture, process |
| [0048](0048-enrollment-clip-and-rebaseline.md) | enrollment 클립 + 측정 로직 변경 시 재기준선 (발굴 선택 편향 차단 + sticky confirmed 재검증 경로) | Accepted | 2026-06-13 | insight, statistics, process |
| [0049](0049-response-profile-aggregation.md) | 개인화 가중치 집계 레이어 — saju_response_profile (글자→십성→그룹 단일레벨 + element_band, 이중계산 구조적 차단 + shrunk 효과) | Accepted | 2026-06-13 | insight, statistics, architecture, saju |
| [0050](0050-verifiability-ladder-and-forecast-ledger.md) | 검증가능성 사다리 + 예측 장부 — 상위 주기(월/세/대운) 해석의 인식 지위 (일운 실증 / 월운 축적-실증 / 세운 장부한정 / 대운 비실증, 전이 가설 미검증 라벨) | Accepted | 2026-06-13 | insight, statistics, saju, architecture |
| [0051](0051-budget-model-simplification-runway-locked.md) | 예산 모델 단순화 — 자금 단일화 + 목표기간 기준 묶인 돈 일괄 처리 (reservation/depletion 분리, 건별 토글 제거, ADR 0015·0018 supersede) | Accepted | 2026-06-16 | data, budget |
| [0052](0052-weekly-insight-single-card-merge.md) | 주간 인사이트 단일 카드 통합 — routine 단독 발송 + 봇 검증 카드 은퇴 + posterior 노출 제거 | Accepted | 2026-06-16 | process, data, ux |
| [0053](0053-signal-suggest-idempotency.md) | 월간 신호 제안 루틴 idempotency — DB 클레임 테이블 (최초 원자적 클레임, 재실행 중복 발송 차단) | Accepted | 2026-07-01 | data, process, reliability |
| [0054](0054-audit-net-displacement-and-trigger-writer.md) | 일정 변경 audit 순변위 측정 + 기록 트리거 단일 계기 — 왕복 상쇄·30분 유예·FK 제거 로그화·tombstone·운명 view | Accepted | 2026-07-04 | data, process, reliability |

> **주**: ADR 0001\~0004는 2026-04-22 이후 소급 기록된 백필이다. 원본 판단 근거는 [docs/project-history.md](../project-history.md)와 관련 PR에 남아있으며, 각 ADR의 Date는 실제 판단이 내려진 시점을 사용했다.

---

## 템플릿

새 ADR을 작성할 때는 [template.md](template.md)를 복사해서 쓴다.

```bash
# 다음 번호 확인
ls docs/adr/ | grep -E '^[0-9]{4}-' | tail -1

# 복사
cp docs/adr/template.md docs/adr/NNNN-<제목>.md
```
