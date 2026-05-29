# 프로젝트 히스토리

개인 라이프 데이터 AI 에이전트 시스템의 **포트폴리오 timeline**.
의미 있는 마일스톤(기능 출시, 아키텍처 전환, 인프라 변화 등)만 기록한다.

> **역할 분담**: 설계 판단은 [docs/adr/](adr/), 마스터 단위 설계 서사(분기·포기·회고)는 [docs/design-notebook/](design-notebook/), 현재 기능 카탈로그는 [docs/features.md](features.md). 본 문서는 외부 청중에게 보여줄 만한 마일스톤 timeline.

> **추가 기준**: 외부에 보여줄 만한 변화인가? (기능 출시·아키텍처 전환·인프라 변화) — YES면 여기, 부분 개선·버그 fix는 제외.

> 2026-04-07 이전 기록은 [history/archive-v1-v2.md](history/archive-v1-v2.md) 참조.

---

## 2026-05-29: 본인 1명 패턴 발견 시스템 마스터 close (#434)

5어휘 데이터 모델(시드 → 매트릭 → 매칭 → 가설 → 검증) + LLM 자율 매트릭 승인 게이트 + Bayesian posterior 시드 영향력 리포트가 정착되며 마스터 #434 close. Phase 1\~8 머지 완료, 8 phase 동안 코드·문서·운영 cron이 같은 5어휘 위에서 정렬됨.

- **Phase 1\~2.5**: 스키마 일반화(`pattern_*` rename) + 사주 시드 풀셋 161개 + 운 레벨 차원(`pillar_level`) + 자동 분포 분석 cron
- **Phase 3\~4**: `life_signal` target-type 추가로 사주/생활 통념 통합 + 매트릭 단위 카운터 source 전환 + `pattern_summary` view derive
- **Phase 5\~6**: 가설 발견·검증 파이프라인 target-type 확장 + LLM 자율 매트릭 routine + 승인 게이트(첫 가동 2026-07-01)
- **Phase 7\~8**: 가설 단위 Beta-Binomial posterior 헬퍼 + 카드 한 줄 병기 + 시드 영향력 top 5 섹션 + per-seed try/catch 격리 + `verify_status='error'` enum + close docs
- **헌장 누적**: v2 헌장 4개(LLM 텍스트 의존 최소화 / 결정론↔자율 분리 / outcome 검증 / 신뢰 비용 분리) + 마스터 #434 자체 헌장 5개(n=1 single-case / 5어휘 분리 / target-type 일반화 / 승인 게이트 / Bayesian + frequentist 병기) — 모두 8 phase 전반에서 작동
- **운영 1\~3개월 후 도입 검토** → [design-notebook 부록 E](design-notebook/personal-pattern-discovery.md). follow-up 5\~6건은 GitHub Issues 카테고리 묶음
- **분리 트랙 유지**: Phase 5 (#408, 월운 매칭)는 별도 트랙으로 본격 진입 보류 정책 계승

설계 판단 → [ADR-0022](adr/0022-target-type-generalization.md) \~ [ADR-0030](adr/0030-llm-metric-suggest-input-and-cadence.md) (9개). 마스터 서사·마무리 회고 → [design-notebook/personal-pattern-discovery.md](design-notebook/personal-pattern-discovery.md#마무리-회고-2026-05-29-close).

---

## 2026-05-27: 프로액티브 인사이트 v2 close + 본인 1명 패턴 발견 시스템 신규 마스터 (#393 close, #434 open)

마스터 #393 (사주 검증 시스템) close + 마스터 #434 (본인 1명 패턴 발견 시스템) open. 정체성 재정의 — 사주 단일 검증 → 사주 + 라이프 통념 통합 가설-검증 파이프라인.

- **마스터 #393 누적**: Phase 1\~4 머지 완료 (\~13일). SQL 결정론 11종, LLM 자율 슬롯 + outcome 검증, 사주 60갑자 일일 매칭, 가설-검증 정량 파이프라인(Fisher + BH-FDR)
- **마스터 #434 setup**: 5어휘 데이터 모델 분리(시드 → 매트릭 → 매칭 → 가설 → 검증), target-type 일반화(`life_signal` 추가), 매트릭 단위 카운터 + view derive, Beta-Binomial Bayesian posterior 도입, LLM 자율 매트릭 승인 게이트. 8-Phase 흐름 설계
- **분리 트랙 유지**: Phase 5 (#408, 월운 매칭) — 검증 사이클 길이 차이로 본격 진입 보류 정책 계승. 운영 1\~3개월 누적 후 본격 인터뷰
- **헌장 계승 + 확장**: v2 헌장 4개(LLM 텍스트 의존 최소화 / 결정론↔자율 분리 / outcome 검증 / 신뢰 비용 분리) 그대로 + 마스터 #434 자체 헌장 5개 추가(n=1 single-case design / 5어휘 분리 / target-type 일반화 / 승인 게이트 / Bayesian + frequentist 병기)

설계 판단 → [ADR-0022](adr/0022-target-type-generalization.md), [ADR-0023](adr/0023-metric-unit-counter-and-summary-view.md), [ADR-0024](adr/0024-bayesian-posterior-update.md), [ADR-0025](adr/0025-llm-metric-approval-gate.md). 마스터 서사 → [design-notebook/personal-pattern-discovery.md](design-notebook/personal-pattern-discovery.md). v2 close 서사 → [design-notebook/insight-engine-v2.md](design-notebook/insight-engine-v2.md#마스터-close-2026-05-27).

---

## 2026-05-26: 사주 풀이 시스템 책임 분리 + 주간 사주 회고 v2 (#421, PR #422·#423)

사주 풀이 routine과 v2 매칭 시스템 사이의 데이터 흐름을 정리.

- **view 인터페이스 도입** — `saju_influence_summary` PostgreSQL view 하나로 verified(BH-FDR 통과 시드) · accumulating(catalog hit rate > 55%, n≥5) · recent(지난 7일 매칭) 3 tier를 통합 노출. 풀이 routine은 raw 테이블 4개를 직접 SELECT하지 않고 view만 SELECT
- **신뢰도 라벨링 자동화** — `confidence_tier` 컬럼이 데이터 레벨에서 신뢰도 단계를 강제 (v2 헌장 ④ 신뢰 비용 분리 준수). 풀이 LLM이 신뢰도에 따른 해석 강도 조절 가능
- **idempotency 테이블 신설** — `saju_weekly_reviews (user_id, week_start)` UNIQUE 제약 + ON CONFLICT DO NOTHING RETURNING. routine retry·prompt 중복 호출 어떤 원인이든 차단해 발송 정확히 1회 보장
- **신 routine `weekly-saju-review-v2`** — Claude 앱 scheduled task로 매주 월요일 08:00 KST 발송. Opus가 view 결과 + 라이프 메트릭(schedule done/total · routine rate · diary_meta_tag · sleep avg)으로 사주 관점 회고 prose 4\~6줄 + 학습 3섹션을 Block Kit 카드 한 장으로 `#insight` 발송. 일기 원문 LLM 입력 금지(헌장 ①)
- **마스터 분리 후 view 매개 통합** — 매칭 마스터(#393)와 풀이 마스터(#421)가 같은 view를 진화시키며 책임은 분리, 데이터 흐름은 단일. Phase A3에서 #408 머지 후 월운 layer를 view에 추가 예정 (컬럼 contract 유지로 후방 호환)

설계 판단 → [ADR-0020](adr/0020-fortune-system-responsibility-split-via-view.md). 마스터 서사 → [design-notebook/fortune-rework.md](design-notebook/fortune-rework.md).

---

## 2026-05-15: 4문서 아키텍처 도입 (#401, PR #402)

설계 사고가 코드만 남으면 휘발되는 문제를 해결하기 위해 문서 체계를 4계층으로 재편.

| 문서 | 역할 | 수명 |
|------|------|------|
| `.claude/plans/<이슈>-*.md` | 구현 직전 메모 | 휘발 |
| `docs/design-notebook/<master>.md` | 마스터 단위 서사 (분기점·포기·회고) | 영구, 누적 |
| `docs/adr/NNNN-*.md` | 되돌리기 어려운 결정 | 영구, 불변 |
| `docs/features.md` | 현재 기능 카탈로그 | 현황 |

`docs/design-notebook/insight-engine-v2.md`를 첫 산출물로 작성 (Phase 1 회고 backfill + Phase 2 진입 준비). features.md는 도메인 4개 + 횡단 기능 + 인프라 한 페이지 요약.

---

## 2026-05-14: 프로액티브 인사이트 엔진 v2 Phase 1 (#389, PR #396)

매일/주간 인사이트의 결정론적 SQL 패턴을 통합·확장하고 임계치를 외부화. 추후 사주 매핑 단계에서 한 곳에서 튜닝 가능한 구조 확보.

- **SQL 패턴 6개 신설**: categorySkew / drift / recovery / lapseAlert / weeklyRegression / spottyPattern — 기존 5개와 합쳐 총 11개
- **임계치 외부화**: `src/shared/insight-thresholds.ts` 단일 export. Phase 4 사주 매핑 튜닝 대비
- **타입 확장**: `timing` (morning/night/weekly) + `domain` (routine/sleep/schedule)
- **동적 노출 정책**: priority ≥5 + domain dedupe + 최대 3개, 0개면 메시지 발송 안 함
- **주간 리포트 재구성**: 일요일 23:00 → 월요일 09:00 이동, Block Kit 인사이트→한눈에→총평 순서로 재구성

판단 근거: [ADR 0014](adr/0014-insight-engine-unification.md). 마스터 #393의 Phase 1 완료.

---

## 2026-05-13: 일정 카테고리 FK 전환 (#394, PR #395)

`schedules.category(TEXT) + subcategory(TEXT)` → `category_id(INTEGER FK)`로 통합하고 계층은 `categories.parent_id`로 표현. 카테고리 기반 분석의 선행 작업.

- **3중 안전망**: pg_dump 전체 백업 + 백업 테이블 + 단일 트랜잭션 빅뱅 마이그레이션 (실패 시 ROLLBACK 한 번으로 원복)
- **표준 JOIN 패턴**: `LEFT JOIN categories c + p` + `COALESCE(c.type, p.type)` 타입 상속
- **웹**: `ScheduleRow.category_id` 단일 필드, `validateCategoryOwnership`으로 cross-user FK 차단
- **필터 바**: 카테고리/하위 카테고리 필터를 number 기반 Set으로 전환

판단 근거: [ADR 0013](adr/0013-schedule-category-fk-migration.md) — 단일 FK + parent_id 계층 채택.

---

## 2026-05-08: 운세 분석 개인화 — 라이프 테마 두 트랙 (#383, PR #385)

운세 분석에 의사결정 가이드 + 라이프 테마 활성/잠재 두 트랙을 도입. 자연 prose 톤으로 통일.

- **분석 8 관점**: 십성/합충형/십이운성/월운/개인 패턴/라이프 테마 + 의사결정 가이드(LLM 자유 선택 3\~5개) + 잠재 카테고리 surface(십성→영역 매핑)
- **두 트랙**: 활성(active life_themes 직접 연결) + 잠재(운에서 활성화되는 영역 자동 surface)
- **자연 prose**: 마크다운 헤더/이모지/라벨 제거, summary(*볼드*) + analysis + advice(_기울임_) 결합
- **표시 경로 통일**: `src/shared/fortune-format.ts` 공유 헬퍼 — 아침 푸시 + fast path 동일 포맷

판단 근거: [ADR 0012](adr/0012-fortune-personalization.md).

---

## 2026-05-08: 사주 패턴 cross-domain 분석 (#382, PR #384)

`weekly-saju-review`의 분석 도메인이 일기·수면 외(지출/일정/루틴/중간기상)로 확장됨에 따라 패턴 저장 구조 결정.

- `saju_patterns` 테이블 통합 유지 (도메인별 분리 X) + evidence JSONB 표준 형식 정의
- 모든 도메인 28일 롤링 윈도우 통일
- 예산 초과 판정은 [ADR 0009](adr/0009-daily-log-baseline-anchor.md) 기준 일 예산 사용

판단 근거: [ADR 0011](adr/0011-saju-pattern-cross-domain.md).

---

## 2026-05-06: 일 예산 산정 모델 이중화 (#376, PR #377)

일 예산을 두 값으로 분리해 자유 예산 마이너스 + 신규 수입 시점의 멘탈 모델 어긋남 해결.

- `todayBudget` (기준 일 예산): 사이클 시작 시 약속, 사이클 동안 사실상 불변. UI 회색 보조 텍스트
- `todayRecommended` (오늘 예산): 매일 갱신되는 동적 권장값. 잔여 음수 시 0 클램프 → 회복 모드 진입 신호. UI 메인 표시
- 회복 모드 안내 메시지: `todayRecommended === 0 && monthRemaining < 0` 조건
- `daily_budget_logs.budget`은 `todayRecommended`를 저장 (의미 정렬, 스키마 변경 없음)

판단 근거: [ADR 0008](adr/0008-daily-budget-dual-model.md).

---

## 2026-04-29: README 포트폴리오용 전면 재설계 (PR #370)

README를 포트폴리오 메인 진입 문서로 재구성.

- 차별점 4개: 프로액티브 인사이트 / LLM 운영 하네스 / 다층 보안 / 1인+AI 협업
- 주요 기능 6섹션 도메인 단위 구성 + 채널 매핑 (#life·#insight·웹 전용)
- 동작 방식 블록: 처리 흐름·인프라 분리·비동기 파이프라인·배포·관측
- architecture.svg 메커니즘 강조 표현으로 갱신
- 섹션 순서: 동작 방식 → 프로젝트 구조 → 기술 스택 → 개발 히스토리

---

## 2026-04-23: modify_db 확인 플로우 UX 재정비 (#348)

2026-04-22 도입된 확인 플로우의 세 가지 UX 문제를 한 번에 정리.

**1) 확인 카드: SQL 노출 → row 이름 리스트**
- `dryRunRowCount`(카운트만) → `dryRunAffectedRows`(RETURNING \*로 영향 row 전체 반환)
- `ensureReturningClause`: DELETE/UPDATE 쿼리에 `RETURNING *`을 자동 주입 (주석·문자열 리터럴 제거 후 검사하여 우회 방지)
- `pending_modify.table_name` 컬럼(045 migration) 추가로 실행 시점까지 테이블 컨텍스트 보존
- `pending-display.ts` 신규 모듈: 9개 테이블(schedules/routine_records/routine_templates/sleep_records/sleep_events/reminders/notification_settings/custom_instructions/categories)별 row formatter를 switch로 분기
- 확인 카드: "⚠️ 확인 필요 — 이 N개가 삭제/변경될 예정이야" 헤더 + 테이블별 그룹 리스트 + 20행 초과 시 "외 N개 더"

**2) pending 후 LLM 중복 응답 → earlyExit**
- `modify_db`가 pending 처리한 경우 반환 JSON에 `__earlyExit: true` 마커 추가
- `agent-loop.ts`: tool result에서 마커 감지 시 LLM 재호출 없이 즉시 종료(`{text: '', earlyExit: true}`)
- `life/index.ts`: `result.earlyExit` true면 텍스트 메시지·history 추가 모두 스킵
- 효과: 취소 시 예시 메시지가 남지 않아 혼선 제거

**3) 실행 완료 "N개 변경" → 현재 상태 재표시**
- `loadCurrentStateBlocks`: 테이블명 + 영향 날짜 컨텍스트로 현재 상태를 Block Kit으로 반환
- `extractAffectedDates`: RETURNING 결과에서 date 컬럼 추출해 범위 조정(오늘/내일/백로그 자동 선택)
- 실행 완료 카드: "✅ 실행 완료 — N개 변경됐어" + divider + 현재 상태 블록
- 실패/미지원 테이블이면 요약 행만 표시하고 조용히 폴백

**안전성**:
- dry-run은 기존과 동일한 BEGIN → 실행 → ROLLBACK 구조 유지
- `ensureReturningClause`는 기존 RETURNING이 있으면 그대로 둠(중복 주입 방지)
- `loadCurrentStateBlocks` 실패는 fire-and-forget — 실행 자체는 영향받지 않음

완료 작업: [ADR 0006](adr/0006-modify-db-confirm-flow.md)의 UX 완성. 판단 근거 자체는 기존 ADR에서 다루므로 신규 ADR 없이 project-history만 기록.

---

## 2026-04-22: modify_db 대량 변경 확인 플로우 (#342, PR #343)

LLM이 `modify_db` 도구로 생성한 DELETE/UPDATE의 영향 row가 임계치(기본 3) 이상이면 즉시 실행 대신 Slack 확인 카드로 전환해 사용자 승인을 받는 구조 추가.

**구조**:
- `dryRunRowCount`(BEGIN → 실행 → ROLLBACK)로 DB 상태 변경 없이 영향 row 수만 계산
- `pending_modify` 테이블(token/user_id/TTL 5분)에 대기 쿼리 저장
- `buildConfirmModifyCard`로 SQL 미리보기 + 실행/취소 버튼 카드 생성
- 사용자 클릭 시 `queryWithRowLimit`(50행 한도 유지)로 실제 실행, 결과 메시지로 카드 교체
- `MODIFY_CONFIRM_THRESHOLD` 환경변수로 재배포 없이 임계치 조정

기존 가드레일(DDL 차단, WHERE 필수, user_id 스코프, 50행 제한) 전부 유지. "범위는 괜찮지만 넓은 쿼리"에 대한 추가 안전망.

판단 근거: [ADR 0006](adr/0006-modify-db-confirm-flow.md) — C안(threshold) + 고정 템플릿 종료 채택 근거와 D안(LLM agent-loop 재개) 전환 시나리오 기록.

---

## 2026-04-22: 관측성 레이어 & ADR 체계 도입 (#334)

**업타임 모니터링 자체 구현**: 봇·웹 헬스체크를 GitHub Actions cron으로 5분 간격 폴링하는 자체 모니터 구축. 외부 SaaS(UptimeRobot 등) 무료 티어 제약을 피해 완전 자체 통제 구조로 전환.

- Matrix strategy로 봇·웹 병렬 체크
- 2회 재시도로 일시적 네트워크 튐 흡수 (cry wolf 방지)
- `workflow_run` API로 직전 상태 조회 → DOWN/RECOVERY 양방향 Slack 알림
- Variables(URL) / Secrets(Webhook) 분리로 최소 권한 원칙 적용

**ADR 체계 도입**: 되돌리기 어려운 설계 판단을 Michael Nygard 포맷으로 별도 기록하는 구조 신설. `docs/adr/README.md`에 기록 기준·운영 규칙 명시. `/design`·`/build` 스킬에 ADR 작성 판단 단계 내장.

- 첫 ADR: [GitHub Actions 기반 자체 업타임 모니터링](adr/0005-uptime-monitoring-github-actions.md) — 당시 0001로 기록됐고, 이후 #339에서 핵심 아키텍처 판단 4건 백필과 함께 0005로 rename됨
- 후속 백필: #339에서 SQL 도구 기반 에이전트·v3 전환·Neon→VM·DB Proxy 판단 4건을 ADR 0001\~0004로 소급 기록

---

## 2026-04-21: 관측성 기반 준비 (#327, #332, #333)

봇·웹 양쪽에 헬스체크 엔드포인트 신설.

- 봇: `GET /health` (DB ping 포함) + `GET /health/detail` (API Key 인증, uptime·latency 노출)
- 웹: `GET /api/health` (Vercel liveness)
- Next.js 프록시에서 `/api/health`를 공개 경로로 등록

이 PR의 후속으로 2026-04-22에 GitHub Actions 기반 자체 모니터 구현.

---

## 2026-04-15: 지출/예산 계산 엔진 재설계 Phase 1 (#283, PR #284)

지출/예산 기능의 계산 로직을 계층별 순수 함수로 분리. TDD 기반으로 145개 테스트 작성.

**계층 구조**:
- `billing/cycle.ts` — 결제 주기 날짜 유틸 (KST 기준, 전월 16일\~당월 15일)
- `allocator/month-allocator.ts` — 자산/런웨이 → 월별 예산 배분 (프로레이션 적용)
- `allocator/day-allocator.ts` — 월 예산 + 지출 → 일 예산 (월 초과 시 0 클램프)
- `settlement/settle.ts` — 월 경계 감지 + 정산 스냅샷 구조 생성

**핵심 원칙**: 순수 함수(DB 의존 없음) + 두 축 분리(자산/런웨이 축 A vs 지출 축 B)

기존 코드(`queries.ts`, `budget-calc.ts`)는 Phase 5에서 교체 예정. 현재는 신규 모듈만 추가.

---

## 2026-04-15: 지출/예산 계산 엔진 재설계 Phase 2 (#285, PR #286)

`monthly_budget_snapshots` 테이블 신설 (DB 마이그레이션 041).
과거 월 불변 스냅샷 구조 준비. Phase 3 Repository/Facade 레이어 추가 예정.

---

## 2026-04-15: 지출/예산 계산 엔진 재설계 Phase 3 (#287, PR #288)

Repository / Snapshot / Facade 레이어 신설.

**Repository 레이어** (7개): assets / expenses / fixed-costs / incomes / installments / planned / settings  
**Snapshot 레이어**: `monthly_budget_snapshots` CRUD (ON CONFLICT DO NOTHING — idempotent)  
**Facade 레이어**: `getMonthlyAllocation`, `getTodayAllocation`, `runSettlementIfDue` 3개 공개 API

기존 `queries.ts` 미변경 (Phase 5 cutover 예정). `budget_settings.updated_at` 신규 facade 미사용 (의미 전환).

---

## 2026-04-15: 지출/예산 계산 엔진 재설계 Phase 4 (#289, PR #290)

API 라우트 + 월 경계 정산 cron 연결 — facade 계층의 외부 진입점 구축.

**v2 API 라우트** (네임스페이스 격리):
- `GET /api/budget/v2/monthly` — `getMonthlyAllocation` 노출
- `GET /api/budget/v2/today` — `getTodayAllocation` 노출
- 기존 `/api/budget`은 Phase 5 cutover까지 병행 운영

**월 경계 정산 cron**:
- `GET /api/cron/monthly-settlement` (Vercel Cron, `30 15 * * *` UTC = 00:30 KST)
- `listAllUserIds` 멀티유저 루프 + 유저별 try-catch 에러 격리
- `runSettlementIfDue` 멱등 → 매일 실행해도 16일에만 실제 스냅샷

**축 A/B 의미 분리**:
- `readDistributableIncomeTotal` 추가 — 자산 유입 수입(distribute_to_budget=true)만 합산
- `computeTotalAvailable`에서 사용 전환 — 당월만 쓸 수입이 자산으로 흘러드는 구조 제거
- 정산 스냅샷의 income_total은 전체 기록용으로 `readIncomeTotal` 유지

Phase 5 남은 작업: 프론트엔드 전환 + 기존 코드 제거.

---

## 2026-04-13: API 비용 최적화 (#261, PR #262)

월 LLM API 비용 절감을 위한 3가지 최적화 적용.

**프롬프트 캐싱**: Anthropic `cache_control: ephemeral`을 system 프롬프트와 도구 정의에 적용. 캐시 히트 시 토큰 비용 90% 절감 (TTL 5분).

**Insight 일기 fast path**: 운세 조회·명령 패턴 이외 메시지를 LLM 없이 직접 DB 저장. 랜덤 확인 문구 20종. 하루 일기는 밤 크론에서 LLM 1회로 통합 리뷰.

**크론 정리**: 아침 크론에서 LLM 인사 제거(일정+루틴 체크리스트만 전송), `sleepCheck`/`morningSchedule`/`nightReview` 슬롯 제거, `nightReview` 내용을 `night`에 통합.

예상 효과: 월 ~$30\~35 → ~$15\~21.

자세한 내용: [docs/optimization/llm-cost.md](optimization/llm-cost.md)

---

## 2026-04-10: 배포 파이프라인 최적화 (#227, PR #228/#229/#230)

GitHub Actions에서 Docker 이미지를 빌드해 GHCR에 푸시하고, 배포 대상 서버는 이미지를
pull 하여 재기동하는 구조로 전환. 서버에서 수행하던 yarn install/build를 제거해
VM 리소스 경쟁 해소 + 의존성 변경 시 최악 케이스(4\~10분, 간헐적 타임아웃 실패) 제거.
BuildKit GHA 캐시와 Dockerfile cache mount 조합으로 warm build 최적화. docker-compose
app 서비스는 `image:` 필드 기반으로 재구성.

**실측:** 이전 Deploy via SSH 스텝은 48\~471초 범위(중앙값 61초, 평균 109초)로 편차가
컸고 타임아웃 실패도 간헐 발생. 이후 총 파이프라인은 cold cache 180초, warm cache **81초**로
안정화(PR #231 측정). 중앙값은 기존 수준이지만 **편차 13배 → 2배 내, 최악 케이스 제거**가
핵심 성과.

### 삽질 기록
- **PR #229**: BuildKit cache mount 경로에서 `yarn cache clean` 호출 시 rmdir EBUSY 발생 → 제거
- **PR #230**: 빌드 이미지 대상 플랫폼과 배포 서버 런타임 불일치로 실행 포맷 에러 발생 → 러너·플랫폼 옵션을 배포 환경에 맞춰 수정. 교훈: 외부 런타임과 엮인 파이프라인 설계 시 대상 환경의 실제 플랫폼을 설계 전 현장 검증.

### 후속 개선 (PR #233, #234)
- **이미지 누적 자동 정리**: build-image 잡에 `actions/delete-package-versions@v5` 추가(최근 10개 유지, `latest` 제외). VM 측 `deploy.sh`는 앱 이미지 최신 2개만 보존하여 디스크 사용량 바운드 + 즉시 롤백 여유분 확보.
- **크리덴셜 로테이션 가이드**: `docs/_personal/credentials-internal.md`(gitignored)에 만료일·갱신 절차 기록. GitHub 자동 알림 + 개인 캘린더 이중화 방침 수립.
- **보안 아키텍처 점검**: DB Proxy API 호스트 포트 바인딩을 `0.0.0.0:3100` → `127.0.0.1:3100`으로 전환. 외부 트래픽이 호스트 Caddy의 TLS 종료를 반드시 거치도록 defense-in-depth 강화. README의 인프라 클레임(테스트 수, 서비스 구성, 사용자 격리 범위 등)과 실제 코드·구성 간 정합성 재점검 및 보정.

자세한 분석: [docs/optimization/deployment-pipeline.md](optimization/deployment-pipeline.md)

---

## 2026-04-10: 마이그레이션 idempotent 가드 (PR #244)

DB 마이그레이션 파일에 `IF NOT EXISTS` / `IF EXISTS` 가드를 기본 적용하고, 컨벤션 문서에 작성 규칙·운영 규칙을 명문화. 앱 시작 시 `runMigrations()`가 `schema_migrations` 테이블을 기준으로 재실행하므로, 중복 실행에 안전해야 컨테이너 재시작 루프를 방지할 수 있다.

### 교훈
- **진단 순서**: 대시보드 API 500 에러 조사 시 코드 레벨 원인(Next.js 16 `revalidateTag` 시그니처 변경, DB Proxy 네트워크) 추론에 시간을 쓰기 전에, 런타임 인프라 상태(`docker ps`, 앱 컨테이너 로그)를 **먼저** 확인했어야 했다. 실제 원인은 마이그레이션 재실행 실패로 앱 컨테이너가 재기동 루프에 빠지면서 DB Proxy까지 같이 내려간 것. 증상(HTTP 500)과 가장 가까운 레이어 대신, 가장 쉽게 "살아있음/죽어있음"을 판정할 수 있는 레이어부터 훑는 게 효율적.
- **컨벤션화**: `docs/conventions.md`에 "DB 마이그레이션" 섹션 신설 — 모든 DDL은 idempotent하게 작성하고, 수동 실행은 금지(예외 시 `schema_migrations`에 동시 INSERT).

---

## 2026-04-09: 수입 전체 기간 분배 옵션 (#204, PR #205)

수입(환불 등)이 이번 달 예산만 높이지 않고 목표 기간 전체에 균등 분배하는 옵션 추가.

- `expenses.distribute_to_budget` 컬럼: 수입별 "이번 달 / 전체 분배" 선택
- 분배 수입은 `currentMonthIncome` 집계에서 제외 → `budgetBase`에 유지되어 `dailyFree` 계산 시 전체 기간에 자동 분산
- 수입 등록/수정 폼에 토글 UI 추가 (기존 수입은 `DEFAULT false`로 동작 유지)
- 일별 예산 현황 누적 세이브/런웨이 영향 일수에 툴팁 설명 추가

---

## 2026-04-09: 일별 예산 현황 로그 (#202, PR #203)

매일 자정 전 예산 스냅샷을 저장하고, 관리탭에서 일별 세이브/초과 현황을 확인하는 기능.

- DB: `daily_budget_logs` 테이블 (일별 예산/지출/세이브 스냅샷, UPSERT)
- Vercel cron: 매일 23:50 KST에 `queryRunway` 결과 스냅샷 저장
- 관리탭 서브탭 "일별 현황" 추가 (지출 | 일별 현황 | 카테고리)
- 누적 세이브/초과량 + 런웨이 영향 일수 표시
- 과거 대금기간도 조회 가능 (스냅샷 기반 고정값)

---

## 2026-04-09: 예산 계산 리팩토링 + 단위 테스트 (#200, PR #201)

`queries.ts`에서 `calcBudgetPreview`와 `queryRunway`가 공유하던 \~115줄의 중복 계산 로직을 순수 함수로 추출했다. TDD로 개발: 테스트 먼저 작성 → 공통 함수 추출 → 테스트 통과 확인.

- `budget-calc.ts` 신규: 빌링 유틸 4개(addBillingMonths, getCurrentBillingMonth, getBillingRange, calcCycleDays) + `calculateBudgetAllocation` 순수 함수
- `budget-calc.test.ts` 신규: 28개 단위 테스트 (빌링 유틸 + 예산 배분 핵심 케이스)
- `queries.ts` -155줄: 중복 locked 루프 제거, 공통 함수 호출로 대체
- 동작 변경 없는 리팩토링 — API 응답값 동일 유지

---

## 2026-04-07: 결제수단 선택 + 카드 할부 입력 (#179, PR #180)

지출 입력 폼에 결제수단 선택 및 카드 할부 기능을 추가했다.

- 지출 폼에 카드/현금 토글 UI 추가
- 카드 선택 시 할부 개월 수(일시불/2\~12개월) 입력 가능
- 할부 선택 시 "월 N원 × N개월" 실시간 미리보기
- API에서 총액을 월별 분할하여 N건의 할부 지출 자동 생성 (미래 날짜 포함)
- 끝전 보정 적용 (마지막 회차에서 나머지 흡수)

