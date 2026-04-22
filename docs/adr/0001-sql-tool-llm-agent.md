# 0001. SQL 도구 기반 LLM 에이전트 설계

- Status: Accepted
- Date: 2026-03-08
- Related: #34, PR #41
- Tags: architecture, llm, data

## Context

- v1은 Notion 기반 + MCP로 DB별 도구 6개를 노출하는 구조였다. DB 간 JOIN·크로스 도메인 분석이 불가능했고, 새 도메인을 추가할 때마다 도구 개수가 늘었다.
- v2로 통합 PostgreSQL에 모든 도메인을 모으면서, LLM에 어떤 도구를 노출할지 다시 결정해야 했다.
- 도메인별 고수준 API(`createSchedule`, `addRoutine`, `logExpense`, `recordSleep` 등)를 전부 도구로 노출하면 **tool schema 토큰이 도메인 수에 비례해 증가**한다.
- 프로젝트 목표는 일정·루틴·일기·수면·명리·예산 등의 도메인을 **계속 추가해도 복잡도가 선형 증가하지 않는 구조**였다.

## Decision

**범용 SQL 도구 3개만 LLM에 노출하고, 도메인 지식은 스키마 + 프롬프트/문서로 이동한다.**

| 도구 | 용도 |
|------|------|
| `query_db` | SELECT (조회·분석) |
| `modify_db` | INSERT / UPDATE / DELETE (변경) |
| `get_schema` | 현재 DB 스키마 확인 (LLM이 테이블 구조를 런타임에 파악) |

- LLM이 스키마를 조회하고 직접 SQL을 작성한다.
- 도메인별 규칙·컨벤션은 시스템 프롬프트 + `docs/domains/*.md`에서 관리한다 (schedule / routine / insight / budget 각각 분리 문서).
- 새 도메인 추가 = DB 스키마 + 도메인 문서만 추가. 코드 도구는 그대로 유지.

## Alternatives considered

### A. 도메인별 고수준 도구 다수 정의 (`createSchedule`, `updateExpense`, `logSleep` …)

- 장점: 각 도구의 책임이 명확하고, 개별 검증/타입 안전성을 강하게 가져갈 수 있음
- 단점: 도구 수가 도메인 수에 비례해 증가 → LLM 호출마다 수십 개 도구 설명 토큰
- 단점: 새 도메인마다 코드 변경이 필요
- 기각 이유: 확장성과 토큰 비용 양쪽에서 불리

### B. MCP 서버 유지 (v1 방식)

- 장점: 이미 익숙한 구조
- 단점: DB 간 JOIN·크로스 도메인 분석 불가, MCP 계층 오버헤드
- 기각 이유: v1의 근본 한계를 그대로 이어감

### C. SQL 도구 + 스키마 기반 LLM 자율 (선택)

- Decision 섹션 참조.

## Consequences

### 장점

- 도메인 추가 비용이 **DB 스키마 + 도메인 문서 작성**으로 축소. 현재 schedule/routine/insight/budget 4개 도메인이 이 방식으로 확장됨.
- LLM이 JOIN/GROUP BY/윈도우 함수로 크로스 도메인 분석을 자유롭게 수행.
- 도구 수 최소화 → 컨텍스트·토큰 절약, 도구 선택 오류 확률 감소.
- 프롬프트/문서에서 도메인 규칙을 관리 → **코드 수정 없이 LLM 행동을 조정** 가능.

### 단점 / 제약

- LLM이 잘못된 SQL을 생성할 가능성 → 애플리케이션 계층 방어선 필수.
  - 완화: DB Proxy의 SQL 화이트리스트(ADR 0004), 봇 내부 `assertSafeSQL` 검증.
- 스키마 변경 시 LLM이 학습·캐시한 구조와 실제가 다를 수 있음.
  - 완화: `get_schema` 도구로 런타임 재조회, 스키마 변경 후 프롬프트 갱신.
- 멀티유저 지원 시 `user_id` 스코프 강제가 프롬프트/쿼리 생성에 의존 → 런타임 방어 추가 필요.
  - 완화: `user-resolver` + Slack 진입점 파라미터화 (PR #237).
- 도메인 간 복잡한 트랜잭션/무결성 규칙은 SQL 한 번으로 풀리지 않을 수 있음 — 필요 시 범용 도구 위에 얇은 헬퍼 추가.

### 후속 작업

- [x] 도메인별 문서 구조 정착 (완료: `docs/domains/schedule.md`, `routine.md`, `insight.md`, `budget.md`)
- [x] fast path 패턴 도입 (정규식 매칭 → SQL 직결 → LLM 바이패스)로 자주 쓰는 조회의 지연·비용 개선

---

**참고**

- [docs/project-history.md](../project-history.md) — v2 전환 시점의 맥락
- [CLAUDE.md](../../CLAUDE.md) — "핵심 설계 원칙" 섹션
