# features

현재 운영 중인 기능 카탈로그. 신규 합류자나 미래의 자신이 "이 프로젝트 뭐가 되지?"를 1분 안에 파악하기 위한 한눈 문서.

> **상세 스키마·API는** `docs/domains/<domain>.md` 참조. 이 문서는 **무엇이 있는지**만 다룬다.

## 도메인별 기능

### 일정 관리 (`#life` 채널)

- Slack 자연어로 일정 추가/조회/수정/삭제
- 카테고리 분류 (FK 기반, 2026-05-13 마이그레이션)
- 밀린 일정 자동 감지 + 잔소리
- 상세: [docs/domains/schedule.md](./domains/schedule.md)

### 루틴 관리 (`#life` 채널)

- 매일/주간/슬롯별 루틴 정의
- 체크/언체크 인터랙티브 버튼
- 연속 달성(streak) 추적
- 슬롯별 달성률 분석
- 상세: [docs/domains/routine.md](./domains/routine.md)

### 사주 / 일기 (`#insight` 채널)

- 사주 원국 분석 (`saju_profiles`)
- 일운/월운/세운/대운 운세 분석 (`fortune_analyses`)
- 일기 자동 저장 (`diary_entries`)
- 삶의 테마 관리 (`life_themes`, 자동 진화)
- 사주 패턴 cross-domain 분석 (`saju_patterns`, 28일 롤링 윈도우 — LLM 분석)
- 사주 일일 매칭 시드 카탈로그 (`saju_signal_catalog`, Phase 3 — 결정론 매칭)
- 일기 LLM enum 16종 추출 (`diary_meta_tags`, Phase 3)
- 상세: [docs/domains/insight.md](./domains/insight.md)

### 지출 / 예산 (`#money` 채널 / 웹 대시보드)

- 웹 대시보드 기반 입력 (Slack 입력 경로 제거됨)
- 일일 예산 안정화 로직
- 할부 / 카드 결제 주기 / 고정비 관리
- 상세: [docs/domains/budget.md](./domains/budget.md)

## 횡단 기능

### 프로액티브 인사이트 엔진

- SQL 기반 패턴 감지 11종 (streak / sleepTrend / slotGap / weekComparison / overdueAlert / categorySkew / drift / recovery / lapseAlert / weeklyRegression / spottyPattern)
- 매일 morning(09:05) / night(23:55) — 텍스트 형식 짧은 잔소리
- 주간 리포트 — 월요일 09:00 Block Kit
- 임계치 단일 외부 파일 (`src/shared/insight-thresholds.ts`)
- 설계 흐름: [docs/design-notebook/insight-engine-v2.md](./design-notebook/insight-engine-v2.md)
- 결정 기록: [ADR-0014](./adr/0014-insight-engine-unification.md)

### LLM 자율 발견 슬롯 (Phase 2)

- 주간(월요일 09:30) / 월간(매월 1일 09:30) — 정량 데이터 컨텍스트만으로 "신호 → 가설 → 검증 SQL" 자동 작성 (`#life` 채널 발송)
- N일 뒤 검증 cron(매일 09:10)이 SELECT-only SQL 실행 → outcome(hit/miss/inconclusive) 자동 채점
- 4중 안전장치: JSON 파싱 폴백 / SELECT-only 정규식 / result_type 화이트리스트 / verify_after_days clamp 1\~28
- 점진적 노출: 누적 검증 ≥ 10건부터 히트율 공개
- 슬랙 조회: `LLM발견` (약속 명령어 — 자유언어 추출 없음)
- 결정 기록: [ADR-0016](./adr/0016-llm-autonomous-slot-outcome-verification.md)

### 사주 일일 매칭 (Phase 3)

- 60갑자 마스터 정규화(\~466 rows) 위에 시드 catalog를 얹어 사용자 임상 가설을 정량 검증
- polymorphic trigger 6종(stem / branch / ganji / element_density / sibiunsung / relation) + 메트릭 5방향(above_avg / below_avg / above_abs / below_abs / flag_present)
- 매일 09:00 일일 매칭 cron — 어제 pending 매칭 검증(hit/miss/inconclusive) + 오늘 활성 시드 평가 + `#life` 한 줄 발송
- 일기 LLM enum 16종 자동 추출(허용 enum 외 출력 폐기) → `diary_meta_tags` 적재
- 약한 시드(누적 \~10건 + hit rate < 30%) 주간 알림 → 사용자 명령어로 active 토글
- 슬랙 조회/토글: `사주 시드 보기` / `사주 시드 모두 보기` / `사주 시드 끄기 #N` / `사주 시드 켜기 #N`
- 결정 기록: [ADR-0017](./adr/0017-saju-ganji-master-normalization.md)

### Slack fast path 명령어

> **정규식 매칭 → SQL 직접 조회 → Block Kit 응답 (LLM 호출 0회).** 약속된 명령어만 매칭 — 자유언어 추출 없음.

| 채널 | 명령어 | 동작 |
|------|--------|------|
| `#life` | `일정` / `오늘 일정` | 오늘 일정 조회 |
| `#life` | `내일 일정` | 내일 일정 조회 |
| `#life` | `백로그` | 밀린 일정 조회 |
| `#life` | `LLM발견` | LLM 자율 발견 누적 정확도 + 최근 5건 |
| `#insight` | `일운` / `오늘 일운` | 오늘 일운 조회 |
| `#insight` | `내일 일운` | 내일 일운 조회 |
| `#insight` | `월운` | 이번 달 월운 조회 |
| `#insight` | `세운` | 올해 세운 조회 |
| `#insight` | `대운` | 최근 대운 조회 |
| `#insight` | `오늘 일기` | 오늘 일기 조회 |
| `#insight` | `사주 시드 보기` | 활성 시드 + hit rate 목록 (Phase 3) |
| `#insight` | `사주 시드 모두 보기` | 비활성 포함 전체 시드 (Phase 3) |
| `#insight` | `사주 시드 끄기 #N` | signal_id=N active=false (Phase 3) |
| `#insight` | `사주 시드 켜기 #N` | signal_id=N active=true (Phase 3) |

띄어쓰기·존댓말 어미는 유연하게 매칭(`일정 보여줘`, `LLM 발견`, `오늘 일운` 등). 자세한 정규식은 각 에이전트 파일 상단 주석 참조.

### 크론 시스템

| 시간 | 내용 |
|------|------|
| 09:00 | 사주 일일 매칭 — 어제 검증(hit/miss/inconclusive) + 오늘 평가 + `#life` 한 줄 (Phase 3) |
| 09:05 | 오늘 일정 + 낮 루틴 체크리스트 + 어제 리뷰 + morning 인사이트 |
| 09:10 | LLM 자율 발견 outcome 검증 (대기열 50건) |
| 월요일 09:00 | 주간 인사이트 리포트 (Block Kit) |
| 월요일 09:30 | 주간 LLM 자율 발견 슬롯 (Block Kit) |
| 매월 1일 09:30 | 월간 LLM 자율 발견 슬롯 (Block Kit) |
| 23:55 | 하루 종합 리뷰 + 밤 루틴 + 마무리 잔소리 + night 인사이트 |
| 23:55 → 익일 05:30 (hotfix 진행 중) | 일기 메타 enum 추출 (Phase 3) |

타임존: `Asia/Seoul` 고정.

### 웹 대시보드 (Vercel)

- Next.js 16
- 일정/루틴/예산/수면/사주 시각화
- 봇 서버 DB Proxy API 경유 (Vercel은 DB 직결 X)

### DB Proxy API

- 봇 서버(Oracle VM)에서 `/api/db/proxy` 엔드포인트로 SQL 실행 대행
- `DB_PROXY_URL` + `DB_PROXY_API_KEY` 인증
- 동적 user_id 보안 검증 적용

## 인프라

| 항목 | 위치 / 방식 |
|------|-----------|
| Slack 봇 | Oracle VM (Docker, Socket Mode) |
| PostgreSQL | Oracle VM (Docker 컨테이너) |
| 웹 | Vercel 자동 배포 (GitHub push → 빌드) |
| 봇 배포 | GitHub Actions `Deploy` 워크플로우 (main push 자동 + 수동 트리거) |
| 모니터링 | (TBD) |

## 마스터 단위 진행 중 작업

- **프로액티브 인사이트 v2** ([#393](https://github.com/hyewon3938/slack-ai-agents/issues/393)) — Phase 1\~4 머지 완료 (Phase 4 = 가설-검증 정량 파이프라인, 2026-05-22 PR [#415](https://github.com/hyewon3938/slack-ai-agents/pull/415)). Phase 5([#408](https://github.com/hyewon3938/slack-ai-agents/issues/408)) 월운·세운·대운 확장은 Phase 4 운영 1\~3개월 데이터 누적 후 진입 예정. 흐름: [design-notebook](./design-notebook/insight-engine-v2.md)

## 문서 지도

| 문서 | 역할 |
|------|------|
| [README.md](../README.md) | 프로젝트 소개 + 핵심 흐름 다이어그램 |
| [CLAUDE.md](../CLAUDE.md) | Claude 작업 컨텍스트 |
| **이 문서 (features.md)** | **현재 어떤 기능이 있는지 한눈에** |
| `docs/domains/*.md` | 도메인별 스키마·API·로직 상세 |
| `docs/design-notebook/*.md` | 마스터 단위 설계 흐름 (분기점·포기·회고) |
| `docs/adr/*.md` | 되돌리기 어려운 결정 (Michael Nygard 포맷) |
| `docs/conventions.md` | 코드 컨벤션 + 보안 체크리스트 |
| `docs/project-history.md` | 마일스톤 timeline |
