# 0043. v2 LLM 자율 발견 슬롯 은퇴 — 통계 기반 발굴로 대체

- Status: Accepted
- Date: 2026-06-07
- Related: [ADR-0016](0016-llm-autonomous-slot-outcome-verification.md) (이 ADR로 Superseded), [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md) (P5a 통계 발굴), [ADR-0040](0040-llm-signal-sql-validation-and-execution-isolation.md) (P5b LLM 신호 제안), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (#477 헌장), #477
- Tags: insight, llm, process, cleanup

## Context

[ADR-0016](0016-llm-autonomous-slot-outcome-verification.md)(#393 Phase 2)은 LLM이 정량 컨텍스트로 "신호 → 가설 → 검증 SQL"을 자유서술로 생성하고 N일 뒤 outcome으로 채점하는 **LLM 자율 발견 슬롯**(weekly/monthly 발견 + 검증 cron)을 도입했다. 그러나:

- **생애 0건 산출**: `llm_insights` 테이블이 운영 내내 0행 — 자율 분석이 한 번도 발견을 surface하지 않았다(사용자에게 발송된 적 없음). 사실상 휴면.
- **헌장 이동**: 마스터 #477이 검증축을 "정량 매트릭 1차 + LLM 텍스트 의존 최소화"로 재정의([ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md))하면서 발견 역할이 통계 기반으로 이관됐다 — [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md)(off-day 여집합 통계 발굴) + [ADR-0040](0040-llm-signal-sql-validation-and-execution-isolation.md)(LLM은 측정 신호만 제안, 판정은 통계). 0016의 "LLM 자유 발견" 접근이 더 엄격한 통계 발견으로 대체됨.

## Decision

v2 LLM 자율 발견 슬롯을 **완전 은퇴**한다. 0016의 판단(LLM 자유서술 발견)을 #477의 통계 기반 발견(0039/0040)이 대체하므로 죽은 코드·스키마·cron을 즉시 제거한다:

- **cron 슬롯 제거**: `weeklyLlmInsight`·`monthlyLlmInsight`·`verifyLlmInsights` (notification_settings + `SLOT_TASKS`).
- **테이블 DROP**: `llm_insights` (0행, FK 의존 0 — 마이그레이션 084).
- **코드 삭제**: `weekly/monthly-llm-insight.ts`·`verify-llm-insights.ts`·`llm-insights.ts`·`llm-insight-prompts.ts`·`llm-insight-verify.ts`·`llm-insight-fast-path.ts` + 테스트.
- **fast path 제거**: `LLM발견` 명령.

발견 기능은 [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md)(#insight 통계 발굴 카드) + [ADR-0040](0040-llm-signal-sql-validation-and-execution-isolation.md)(#insight LLM 신호 제안)이 담당한다.

## Alternatives considered

- **살려서 고치기** (왜 0건인지 진단 후 produce하게): 기각 — #477 헌장이 "LLM 자유서술 발견"에서 "통계 1차"로 이동했고 0039/0040이 그 역할을 더 엄격하게 수행. 살려도 헌장 충돌 + 채널/목적 중복.
- **dormant 유지** (코드 둔 채 비활성): 기각 — 죽은 코드·빈 테이블·0산출 cron이 카탈로그 정확도를 흐리고 유지보수 표면만 늘린다.

## Consequences

- 죽은 코드·빈 테이블·0산출 cron 제거로 표면·유지보수 부담 감소. 발견은 #477 P5a/P5b 단일 트랙으로 정리.
- [ADR-0016](0016-llm-autonomous-slot-outcome-verification.md)의 "4중 안전장치" 설계는 역사 기록으로 남고, 현행 LLM-생성 SQL 방어는 [ADR-0040](0040-llm-signal-sql-validation-and-execution-isolation.md)의 2단 방어가 계승.
- `llm_insights` 0행이라 데이터 손실 없음. 되돌리려면 048 + 코드 복원(git).
