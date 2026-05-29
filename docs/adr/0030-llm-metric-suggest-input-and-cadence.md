# 0030. LLM 매트릭 제안 슬롯 — 입력 풀 구성 + 거절 재제안 + 월간 cron

- Status: Accepted
- Date: 2026-05-28
- Related: [#458](https://github.com/hyewon3938/slack-ai-agents/issues/458), 마스터 [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434) Phase 6
- Tags: llm, insight, ops

## Context

[ADR-0025](0025-llm-metric-approval-gate.md)는 LLM 자율 매트릭의 승인 게이트(`status='pending' → 'active'`, 월 cap 5, Slack inline button, `description NOT NULL`) 골격을 결정했다. [ADR-0027](0027-llm-async-routine-unification.md)은 LLM 비동기 작업이 Claude 앱 routines로 통일된다는 운영 패턴을 결정했다.

본 ADR이 다루는 잔여 결정 3건:

1. **LLM이 매트릭 후보를 만들 때 입력 데이터를 어떻게 구성하는가** — Phase 2에서 박은 161개 evidence-only 시드의 `pattern_matches.evidence` JSONB 60+일 누적이 본래 가설 풀 가정이었으나, 마스터 #434 Phase 2 머지일이 2026-05-28이라 본 phase 진입 시점 evidence 누적 = 0일. 입력 풀이 빈 상태에서도 의미있는 후보를 만들 수 있어야 함
2. **거절된 매트릭의 재제안 정책** — 동일 (seed_id, outcome) 무한 반복 차단 + 새 근거 발견 시 재평가 가능성 보존을 어떻게 양립
3. **routine 실행 빈도** — ADR-0025의 "월 cap 5"와 자연스럽게 호환되는 주기

## Decision

### (a) LLM 입력 풀 — 3 결합

routine 컨텍스트에 다음 3종 데이터를 LLM에 노출. 본 데이터는 사용자 텍스트 원문(일기·schedule 제목 등)을 포함하지 않는다 (v2 헌장 ① 계승).

| 입력 | 출처 | 의도 |
|------|------|------|
| **evidence JSONB 누적 요약** | `pattern_matches.evidence` WHERE `verify_status='no_metric'`, 최근 60일 | trigger 발현 시 같이 관측된 outcome 카운트 패턴 (누적 부족 단계에서는 자연 0건, 누적되면 자연 풍부) |
| **시드 description** | `pattern_catalog.description` (Phase 2 시드 풀세트가 사용자 임상 단서 박아둠) | 가설 공간 좁히는 hint. "사화 발현일 → 신체 증상(대상포진·피부)" 등 사용자 본인이 관측한 패턴 |
| **라이프 메트릭 표** | 최근 30일, schedule done/total, sleep_avg, routine streak, expense category count 등 메타데이터 (금액 X) | trigger와 outcome의 cross-domain 동조 패턴 발견 입력. v2 헌장 ① 준수 (메타데이터만) |

LLM 프롬프트 지침에 다음 명시:

- 근거 부족하면 부족하다고 말하고 0개 제안 가능 — cap 5는 max이지 무조건 5개 아님
- SQL 본문은 evaluateMetric 가능한 패턴(SELECT 단일 쿼리 + outcome 카운트 평가)으로만
- 매트릭 description은 자연어 + 사용자가 SQL 본문 검토 없이 의도 파악 가능한 수준

### (b) 거절 재제안 — rejected 목록 LLM 노출 + 자율 판단

routine 컨텍스트에 다음도 같이 노출:

```sql
SELECT pattern_id, description, proposed_at, rejected_at
FROM pattern_metrics
WHERE status = 'rejected'
ORDER BY rejected_at DESC
LIMIT 30;
```

LLM 프롬프트 지침:

- "이미 거절된 (seed_id, outcome) 조합은 **새 근거**(누적 evidence 변화·다른 outcome·다른 window)가 있을 때만 재제안"
- 재제안 시 description에 "이전 거절 사유와 다른 점" 명시 의무
- 새 근거 없는 동일 조합 반복은 금지

→ 영구 거절 vs 무제한 재제안의 절충. 무한 반복은 LLM 자율 판단 + 사용자 거절 게이트가 거름. 사용자 시각으로 봤을 때 "왜 또 이거?" 의문이 생기지 않게 LLM이 차이점을 설명해야 한다는 의무 부과.

### (c) routine 실행 빈도

**매월 1일 09:30 KST**.

- ADR-0025의 "월 cap 5"와 자연 일치 (월 1회 실행 = 월 cap 자동 reset)
- 기존 monthly-llm-insight cron과 동일 패턴 (운영 입증된 시간대)
- routine 위치: `~/.claude/scheduled-tasks/monthly-metric-suggest/SKILL.md`
- model: opus (구독료 잠금 — ADR-0027)

routine 실행 흐름:

1. 입력 데이터 3 결합 SELECT
2. LLM (Opus) 매트릭 후보 0\~5개 생성
3. 후보별로 `pattern_metrics` INSERT (`status='pending'`, `source='llm_autonomous'`, `proposed_at=NOW()`)
4. 후보별 Block Kit 메시지 1건씩 `#insight` 채널에 발송 ([승인]/[거절] 버튼)
5. 후보 0건이면 "X월 제안 없음" 메시지 1건

승인/거절 인터랙션은 봇 서버 `src/agents/insight/actions.ts`가 받는다 (routine ≠ Slack interactivity endpoint).

## Alternatives considered

### A. evidence + 시드 description + 라이프 메트릭 표 (선택)

- 장점:
  - evidence 누적 부족 단계에서도 시드 description + 라이프 메트릭으로 의미있는 후보 생성 가능
  - 누적될수록 evidence 풀이 자연 풍부 → 후보 품질 자동 향상 (인프라 변경 없이)
  - 3 입력은 서로 독립적 신호 — LLM이 교차 검증 가능
- 단점: 프롬프트 토큰 길어짐 + LLM이 라이프 메트릭 표를 잘못 해석하면 인과 가설 폭주 위험

### B. evidence + 시드 description만

- 장점: 입력 단순, 프롬프트 토큰 최소화
- 단점: evidence 0일 단계에서 후보 생성 실질 불가. LLM이 "trigger X가 outcome Y와 함께 나타난다" 관찰을 못함
- 기각 이유: 본 phase 진입 시점 evidence 누적 = 0일이라 이 안은 빈 cron이 됨

### C. evidence + description + 메트릭 + active 가설 상태

- 장점: 현재 active 가설의 hit/miss 추세도 LLM에 노출. "기존 가설이 검증되는 방향에서 더 세분한 매트릭 제안" 유도
- 단점: 프롬프트 복잡·토큰 더 ↑. 가설 공간 더 좁아지지만 입력 복잡도 비용 vs 효용이 본 단계에 불명확
- 기각 이유: 운영 누적 후 검토. 1차는 3 결합으로 시작

→ **A (3 결합) 선택**.

### 거절 재제안 정책 대안

#### α. rejected 목록 노출 + LLM 자율 판단 (선택)

- 장점: 영구 차단·임의 cool down 둘 다 피함. 새 근거 있으면 재평가 가능
- 단점: LLM 판단 의존 — "새 근거"의 기준이 자율적이라 일관성 변동 가능

#### β. rejected 목록 노출 + 90일 cool down

- 장점: 명확한 규칙
- 단점: 임의값 박기 (마스터 #434 헌장 "임의값 배제" 부분 위배)

#### γ. rejected 목록 비노출 (동일 조합 반복 허용)

- 장점: 구현 단순
- 단점: 사용자가 매번 같은 거절 반복 → UX 저하
- 기각 이유: 사용자 부담만 ↑

### routine 빈도 대안

#### x. 매월 1일 09:30 KST (선택)

- 장점: 월 cap 5와 자연 호환, monthly-llm-insight 운영 패턴 계승
- 단점: 가설 제안 주기가 길어 운영 누적 빠른 단계에 답답할 수 있음

#### y. 매주 월요일 09:30 KST

- 장점: 가설 제안 주기 빠름
- 단점: 월 cap 5와 충돌 — 주 4\~5회 × cap 5 = 철소 처리 추가 복잡도
- 기각 이유: ADR-0025 cap 정책과 자연 호환 안 됨

#### z. evidence 누적 임계치 기반 자동 트리거

- 장점: 데이터 충분할 때만 routine 실행
- 단점: 메타 cron(daily check) 필요 + 임계치 자동 판단 임의값 박기. 1차 도입 이른 가능성
- 기각 이유: 운영 누적 1\~3개월 후 follow-up 검토. 1차는 fixed monthly로 충분

## Consequences

### 장점

- evidence 누적 0일 단계에서도 routine 첫 실행 가능 → 인프라 + 운영 검증 동시 진행
- 입력 풀 3 결합이 본 phase에서 표준화 → 후속 LLM 매트릭 슬롯 확장(예: weekly 후보 슬롯 분리) 시 같은 표준 위에서 결정 가능
- rejected 목록 LLM 노출 + 자율 판단으로 임의 cool down 없이 노이즈 차단
- monthly cron = ADR-0025 cap과 자연 호환, monthly-llm-insight 운영 패턴 재사용

### 단점 / 제약

- LLM 프롬프트 토큰 ↑ — evidence 60일 + description 161개 + 메트릭 표. Opus 토큰 비용은 routine(Claude 앱 구독료 잠금)이라 종량 부담 없음 (ADR-0027 효용)
- 첫 cron 발사가 빈약한 후보(0\~2개)가 될 가능성 ↑. 운영 누적될수록 자연 향상
- LLM이 "새 근거" 판단이 일관되지 않으면 동일 거절 반복 가능. 운영 1\~3개월 후 정책 재검토
- routine 실패 fallback 미정 — routine 실행 실패 시 알림 경로는 별도 ADR/follow-up

### 후속 작업

- [ ] Phase 6 PR: routine SKILL.md + metric-approval-cards.ts + actions.ts METRIC_APPROVE/REJECT + index.ts fast path 정규식 + 도메인 문서 본문 채우기
- [ ] 첫 routine 발사 후(2026-07-01) 후보 품질 회고 — design-notebook Phase 6 회고 섹션
- [ ] 운영 1\~3개월 누적 후 follow-up: rejected 재제안 정책 일관성 평가, 입력 풀 확장(active 가설 상태 노출) 검토, evidence 누적 임계치 자동 트리거 검토

---

**참고 자료**

- [ADR-0025](0025-llm-metric-approval-gate.md) — 승인 게이트 골격
- [ADR-0027](0027-llm-async-routine-unification.md) — routine 운영 통일
- 마스터 #434 자체 헌장 ④ (결정론↔자율 + 승인 게이트): `docs/design-notebook/personal-pattern-discovery.md`
- v2 헌장 ① (텍스트 원문 노출 금지): `.claude/projects/-Users-ihyewon-slack-ai-agents/memory/project_insight_v2_core_principles.md`
