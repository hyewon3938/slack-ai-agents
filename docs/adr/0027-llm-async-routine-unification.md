# 0027. LLM 비동기 작업 Claude 앱 routines 기반 통일

- Status: Accepted
- Date: 2026-05-28
- Related: #434, #437, PR TBD
- Tags: process, llm, infra, ops

## Context

이 프로젝트에는 LLM 호출이 들어가는 비실시간(스케줄러 기반) 작업이 다수 존재한다. 마스터 #421 (사주 풀이 책임 분리) 진행 중 `weekly-saju-review-v2`를 **Claude 앱의 routines 기능 기반**으로 운영하는 패턴을 도입했고, 이후 신규/기존 LLM 비동기 작업이 두 가지 운영 패턴으로 공존하게 되었다.

| 패턴 | 위치 | 비용 | 현재 작업 |
|------|------|------|-----------|
| Node.js cron (`node-cron`) | 봇 서버 (Oracle VM Docker) | Claude API 키 호출(=종량) | morning/night insight, weekly-report, weekly-llm-insight, monthly-llm-insight, diary-meta-extract |
| Claude 앱 routines | 사용자 Claude 앱 (구독료에 포함된 Opus) | 구독료 잠금(추가 종량 X) | weekly-saju-review-v2 |

문제:

- 신규 LLM 비동기 작업 진입 시(예: 마스터 #434 Phase 6 LLM 매트릭 제안 슬롯) **어느 쪽으로 운영해야 하는지 일관된 기준 없음**
- 두 패턴이 임의로 섞이면 SKILL.md 위치(repo 외부) ↔ 코드(repo) 분기점이 흐려져 운영 부담
- 사용자 명시: "실시간 답변이 아닌 건 무조건 routines" (2026-05-28 마스터 #434 Phase 2 인터뷰)

## Decision

**LLM 호출 들어가는 비실시간 작업은 모두 Claude 앱 routines로 운영**한다. 결정론 cron(LLM 호출 없는 SQL/평가 작업)은 Node.js cron을 유지한다.

분류 기준:

| 작업 유형 | 운영 방식 | 예 |
|-----------|-----------|----|
| LLM 호출 있는 비실시간 작업 | **Claude 앱 routines** | morning/night insight, weekly-report, weekly-llm, monthly-llm, diary-meta-extract, weekly-saju-review-v2, 마스터 #434 Phase 6 매트릭 제안 |
| 결정론 SQL/평가 (LLM 호출 없음) | Node.js cron 유지 | daily-saju-matching, verify-llm-insights, weekly-hypothesis-review, 마스터 #434 Phase 4 매칭 cron 확장 |
| Slack 실시간 응답 (fast path / 자연어 대화) | 봇 서버 (현재 유지) | fast path 명령어, 자연어 대화 응답 |

신규 LLM 비동기 작업 등록 절차:

1. `mcp__scheduled-tasks__create_scheduled_task`로 routine 생성
2. SKILL.md를 `~/.claude/scheduled-tasks/<task_id>/SKILL.md`에 작성 (repo 외부, git 비추적)
3. `weekly-saju-review-v2`의 운영 패턴 그대로 적용 — model selector 사용자 직접 지정 (`opus` 명시), 결과는 `mcp__slack__slack_post_message`로 채널에 발송

## Alternatives considered

### A. 전체 Node.js cron 유지

- 장점: 단일 운영 환경, 봇 서버 한 곳에 모든 스케줄 집중, 코드 가시성 ↑
- 단점: Claude 앱 구독료에 포함된 Opus 사용량을 활용 불가 → 종량 API 키 호출이 누적됨. 구독료 잠금된 비용 vs 종량 누적의 트레이드오프에서 후자가 불리
- 기각 이유: 비용 효율 + 사용자가 이미 구독 중인 Claude 앱 자원을 사용하는 게 자연스러움. 마스터 #421이 이미 routine 패턴 도입

### B. 모든 비동기 작업 routine (결정론 포함)

- 장점: 단일 운영 패턴, 분기 없음
- 단점: 결정론 작업도 routine 호출 시 LLM 컨텍스트 로드가 일어남 → 토큰 낭비 + 단순 SQL 평가에 LLM 개입할 이유 없음. 결정론은 안정적 + 빠른 cron이 적합
- 기각 이유: LLM 호출 없는 작업까지 routine으로 묶는 건 본질에 안 맞음

### C. LLM 호출 비동기만 routine (선택)

- 장점: LLM 호출 = 구독료 활용 + 결정론 = Node.js cron 유지로 분기 본질에 맞음. 비용/성능/단순성 균형
- 단점: 운영 패턴이 2종 공존 → 신규 작업 진입 시 분류 판단 필요 (하지만 분류 기준이 명확하므로 부담 작음)

## Consequences

### 장점

- LLM 호출 비용을 Claude 앱 구독료에 잠금 — 종량 API 키 누적 회피
- 결정론 작업은 봇 서버에서 빠르게 처리(LLM 컨텍스트 로드 없음)
- 신규 LLM 비동기 작업 등록 시 운영 패턴이 명확 — `weekly-saju-review-v2` 1건이 운영 검증 끝낸 상태(2026-06-01 첫 발송 예정)

### 단점 / 제약

- SKILL.md가 `~/.claude/scheduled-tasks/<id>/SKILL.md`에 있어 repo 외부 → 변경 이력이 git에 안 남음. 운영 노트는 design-notebook이나 도메인 문서에서 별도 기록 필요
- 운영 패턴 2종 분기 — 결정론 ↔ LLM 비동기 경계가 모호한 작업이 나오면 case-by-case 판단 (분류 기준 표가 가이드)
- routine 실패 시 fallback 경로 별도 — Slack DM 알림 or 다음 실행에서 누락 보완 패턴 설계 필요

### 후속 작업

기존 6건 LLM cron의 routine 이관 (follow-up 이슈로 분리):

- [ ] morning 인사이트 routine 이관 (`life-cron.ts` 09:05 부분)
- [ ] night 인사이트 routine 이관 (`life-cron.ts` 23:55 부분)
- [ ] weekly-report routine 이관 (월요일 09:00)
- [ ] weekly-llm-insight routine 이관 (월요일 09:30)
- [ ] monthly-llm-insight routine 이관 (매월 1일 09:30)
- [ ] diary-meta-extract routine 이관 (매일 23:55-05:30)

이관 시점: 마스터 #434 Phase 2 PR 머지 후 점진. 각 이슈에 본 ADR link + `weekly-saju-review-v2` 마이그레이션 패턴 참조.

마스터 #434 Phase 6 (LLM 매트릭 제안 슬롯)은 신규 작업이므로 처음부터 routine으로 등록.

---

**참고 자료**

- 마스터 #421 PR #423 — `weekly-saju-review-v2` routine 패턴 첫 도입
- [ADR-0016](0016-llm-autonomous-slot-outcome-verification.md) — LLM 자율 발견 슬롯 (Node.js cron 기반, 이관 follow-up 대상)
- [ADR-0025](0025-llm-metric-approval-gate.md) — LLM 매트릭 승인 게이트 (Phase 6 routine 진입 정책의 직접 컨텍스트)
