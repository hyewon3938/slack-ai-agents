# 0025. LLM 자율 매트릭 승인 게이트 — `description NOT NULL` + Slack inline button

- Status: Accepted
- Date: 2026-05-27
- Related: [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434)
- Tags: data, llm, ux

## Context

마스터 #393 Phase 2 (ADR-0016)는 LLM 자율 발견 슬롯을 도입했다. LLM은 가설을 제기하지만, 매트릭(평가 SQL + window)은 시드 카탈로그 작성 시점에 결정론적으로 작성된 상태였다.

마스터 #434는 매트릭 작성 자체를 LLM이 자율적으로 할 수 있도록 확장한다. LLM이 매트릭 후보를 제안 → 사용자 승인 → 활성화. 활성 매트릭만 매칭 cron에 진입.

문제:

- LLM 자율 매트릭을 자동 활성화하면 v2 헌장 ② (결정론 ↔ 자율 역할 분리) 위배
- 사용자가 매트릭 SQL 본문을 매번 검토하는 건 비효율적
- 매트릭 cap을 두지 않으면 슬롯 폭주 가능

## Decision

**LLM 자율 매트릭은 `status: 'pending'`으로 생성되며, 사용자 승인 후에만 `'active'`로 전환**. 매칭 cron은 `status='active'`만 처리.

세부 구조:

```sql
-- migration: 066_llm_metric_approval.sql (예정)
ALTER TABLE saju_signal_metrics
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'rejected')),
  ADD COLUMN source TEXT NOT NULL DEFAULT 'deterministic'
    CHECK (source IN ('deterministic', 'llm_autonomous')),
  ADD COLUMN proposed_at TIMESTAMPTZ,
  ADD COLUMN approved_at TIMESTAMPTZ;
```

승인 UX (Slack):

1. 월간 LLM 슬롯이 매트릭 후보 N개(cap 5) 제안 → DB에 `status='pending'` 저장
2. `#insight` 채널에 Block Kit 카드 자동 발송 (또는 사용자가 `/insight metric-approve` 호출)
3. 카드 본문:
   - 매트릭 이름
   - 의도 (`description` 컬럼, 자연어)
   - 평가 시드(어떤 seed를 검증하는지)
   - window_days (예: "최근 7일 기준")
   - hit/miss 분류 기준 (예: "수면 7시간 미만이면 hit")
4. inline button: `[승인]` / `[거절]`
5. 승인 시 `status='active'` + `approved_at=now()`. 다음 cron 사이클부터 매칭 시작.

cap: 월 최대 5개 매트릭 제안 (`status='pending'` 누적이 cap 도달 시 추가 제안 차단). 잔여 cap은 누적 X (월간 reset).

`description` 컬럼이 `NOT NULL`인 이유:

- LLM 매트릭 승인 시 사용자가 SQL 본문 대신 자연어 설명을 검토. SQL 검토 부담 없이 매트릭 의도를 명확히 전달
- 결정론 매트릭(Phase 1 backfill)도 description 채움 — 도메인 문서나 추후 디버깅 시 동일하게 유용

## Alternatives considered

### A. Slack 명령어 + Block Kit 카드 + 자연어 description (선택)

- 장점:
  - description으로 매트릭 의도 명확히 전달 (사용자 검토 부담 ↓)
  - Slack 동선 통합 (별도 웹 페이지 X)
  - inline button으로 1-click 승인
- 단점: Block Kit 카드 한 종류 추가 (`src/agents/insight/metric-approval-cards.ts` 신규)

### B. 웹 대시보드 승인 페이지

- 장점: SQL 본문 + 평가 시뮬레이션 등 풍부한 UX 가능
- 단점:
  - 웹 작업 동선 추가 부담 (Next.js 페이지 + DB Proxy API 라우트 추가)
  - 본 마스터 scope에서 웹 작업까지 끌어오면 Phase 수 ↑
- 기각 이유: 자연어 description으로 Slack에서 충분히 검토 가능. 웹 페이지는 향후 운영 누적 후 follow-up 검토

### C. 자동 승인 (검토 없음)

- 장점: UX 가장 단순
- 단점: v2 헌장 ② 위배. LLM 매트릭 폭주 위험. 잘못된 매트릭이 hit/miss 누적 시 노이즈 → 검증 오염
- 기각 이유: 자율 영역과 결정론 영역의 신뢰 비용 분리 무너짐

→ **A 선택**.

## Consequences

### 장점

- LLM 자율 매트릭이 결정론 매트릭과 동일 테이블에 공존하되 활성화 게이트로 분리
- `description NOT NULL`로 모든 매트릭의 의도가 자연어로 문서화 (결정론·자율 모두)
- Slack 동선 통합, 사용자 1-click 승인
- 월 cap으로 매트릭 폭주 방지

### 단점 / 제약

- description 컬럼 추가 + 기존 결정론 매트릭 backfill 필요 (Phase 1)
- Block Kit 승인 카드 컴포넌트 한 종류 추가 (`metric-approval-cards.ts`)
- `/insight metric-approve` 명령어 추가 (fast path 정규식 1줄)
- 승인 후 30일 이상 미평가 매트릭 자동 비활성화 정책은 별도 follow-up (운영 누적 후)

### 후속 작업

- [ ] Phase 1 migration에 `description NOT NULL`, `status`, `source`, `proposed_at`, `approved_at` 컬럼 추가
- [ ] 기존 결정론 매트릭의 description backfill (Phase 1)
- [ ] Phase 6에서 월간 LLM 슬롯이 `status='pending'` 매트릭 생성
- [ ] Phase 6에서 Block Kit 승인 카드 + `/insight metric-approve` 명령어 구현
- [ ] Phase 8에서 카드 UI 통합

---

**참고 자료**

- [ADR-0016](0016-llm-autonomous-slot-outcome-verification.md) — LLM 자율 슬롯 + 4안전장치 원본
- [v2 헌장 ② — 결정론 ↔ LLM 자율 역할 분리](../../.claude/projects/-Users-ihyewon-slack-ai-agents/memory/project_insight_v2_core_principles.md)
