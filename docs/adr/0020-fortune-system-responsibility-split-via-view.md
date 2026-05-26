# 0020. 사주 풀이 시스템과 v2 매칭 시스템 책임 분리 + view 인터페이스 도입

- Status: Accepted
- Date: 2026-05-26
- Related: #421 (마스터 A), #393 (마스터 v2)
- Tags: data, insight, architecture

## Context

마스터 #393 (프로액티브 인사이트 v2)이 Phase 1~4 동안 누적한 신뢰도 단계별 사주 영향력 데이터(BH-FDR 통과 hypothesis, catalog hit/miss 누적, 일일 매칭)가 **사주 풀이 routine 측에 전혀 주입되지 않고 있었다**. 풀이 측 (`/일운`·`/월운`·`/세운`·`/대운` fast path + weekly-fortune Routine)은 fortune_analyses INSERT만 하고 v2 데이터를 모름.

동시에 기존 weekly-saju-review Routine은:
- prose 1500자 단일 메시지로 가독성 낮음 (사용자가 와도 잘 안 읽음)
- 동일 채널 중복 발송 발생 (현재 비활성화 상태)
- 풀이 LLM이 Sonnet (사용자 선호 Opus)
- v2 데이터 미주입

마스터 A 신설로 이 4개 문제를 한꺼번에 해결하면서, v2 매칭 시스템 (catalog·hypothesis·stats·daily_matches 4개 테이블)을 풀이 routine에 어떻게 노출할지 결정이 필요했다.

### 제약

- 헌장 ① (LLM 텍스트 의존 최소화): Opus 입력에 catalog의 `description` 정도는 허용하되 diary 원문은 금지
- 헌장 ④ (신뢰 비용 분리): 신뢰도 단계(verified/accumulating/recent)를 데이터 레벨에서 명시
- 마스터 #393은 계속 진화 (Phase 5에서 월운 layer 추가 예정) → 인터페이스가 안정적이어야 함
- A3에서 4층 레이어 데이터 expose는 #408 머지 후 진행 — 인터페이스 추가 시점에 기존 routine이 깨지면 안 됨
- 향후 다른 풀이 routine도 같은 데이터 소스를 재사용할 가능성

## Decision

**`saju_influence_summary` PostgreSQL view를 인터페이스로 도입**한다. 풀이 측 routine은 raw 테이블 4개를 직접 SELECT하지 않고 view 1개만 SELECT한다.

view는 3개 소스를 UNION ALL로 통합:
- `verified` — Phase 4 hypothesis가 BH-FDR 통과한 시드 (fdr_q < 0.05)
- `accumulating` — Phase 3 catalog hit/miss 누적 hit rate > 55% (>=5건)
- `recent` — 지난 7일 trigger 발현 매칭 카운트

중복 dedup: `verified` > `accumulating` > `recent` (한 signal이 verified에 있으면 하위 tier에서 제외).

### 컬럼 contract (Routine이 의존)

| 컬럼 | 의미 |
|------|------|
| user_id | WHERE 필터 |
| signal_id | catalog FK (dedup 키) |
| signal_name | 시드 이름 |
| sipsin | 십성 |
| description | 시드 설명 (LLM 표시·해석 입력 허용) |
| trigger_target_type | stem/branch/ganji/relation/element_density/sibiunsung |
| enum_target | 검증된 가설의 diary_meta_tag (verified만) |
| confidence_tier | `verified`/`accumulating`/`recent` |
| metric_value | tier별 의미 (ratio / hit rate / count) |
| fdr_q | BH-FDR q-value (verified만) |
| evaluated_at | 최근 평가일 (recent은 마지막 매칭일) |

Routine은 DB Proxy API를 통해 view를 SELECT한다.

## Alternatives considered

### A. API endpoint 신설 (`GET /api/saju/influence-summary`)

- 장점: 비즈니스 로직(top-N 정렬, tier별 LIMIT)을 한 곳에 응축. DB 외에서도 재사용 가능.
- 단점: 엔드포인트 별로 인증·rate limit·spec 관리 비용. SQL 자율성을 가진 Routine 입장에서 한 단계 더 우회 필요.
- 기각 이유: Routine은 이미 DB Proxy API로 raw SELECT가 가능. 추가 API 레이어가 가치 대비 비용 큼. tier별 LIMIT은 SQL `ORDER BY ... LIMIT`로 충분.

### B. MCP 도구 신설 (`mcp__saju__get_influence_summary`)

- 장점: LLM이 직접 호출. 파라미터 검증·결과 형식 강제 용이.
- 단점: MCP 도구는 봇 측에서 정의·등록·유지 필요. Routine 환경은 Claude 앱 측이라 MCP 도구 즉시 사용 가능 여부 불확실. 도구 spec 변경 시 봇 코드 + Routine 양쪽 정합성 부담.
- 기각 이유: 인터페이스 변경 비용이 view보다 큼. view는 `CREATE OR REPLACE`로 컬럼 추가가 후방 호환 가능.

### C. Routine이 raw 테이블 4개를 직접 SELECT

- 장점: 추가 레이어 없음. 마이그레이션 1개도 안 추가됨.
- 단점: 같은 통합 쿼리(verified + accumulating + recent dedup)를 Routine prompt마다 반복 작성. 헌장 ④ (신뢰도 단계) 강제 불가 — Routine이 raw 데이터에서 자의적으로 tier 정의 가능. 향후 A3에서 월운 layer 추가 시 모든 routine 동시 수정 필요.
- 기각 이유: 신뢰도 라벨링이 routine마다 흩어지면 헌장 ④ 위반. 통합 쿼리 중복도 유지보수 부담.

### D. view 도입 (선택) — `saju_influence_summary`

- 장점:
  - 신뢰도 라벨링이 view에 집중 → 헌장 ④ 준수
  - Routine prompt 단순 (1개 view만 SELECT)
  - `CREATE OR REPLACE`로 컬럼 추가 시 후방 호환
  - 향후 다른 풀이 routine도 재사용
  - A3 확장 (월운 layer) 시 view 한 곳만 수정
- 단점:
  - view 안에 비즈니스 로직(tier 우선순위·임계치)이 박힘 → 변경 시 마이그레이션 필요
  - PostgreSQL 의존 (DB 이식 시 view 별도 변환)

## Consequences

### 장점

- Routine prompt가 단순. 신뢰도 단계를 모르고 SELECT만 해도 dedup·tier가 보장됨
- 헌장 ④ (신뢰 비용 분리) 데이터 레벨에서 강제
- A3에서 월운 layer를 view에 추가하면 기존 Routine 영향 없음 (컬럼 contract 유지 시)
- 다른 풀이 routine이 추가될 때 같은 view 재사용 가능

### 단점 / 제약

- view 컬럼 contract 변경 시 모든 의존 Routine prompt 동시 수정 필요 (지금은 1개)
- view 안의 임계치(`fdr_q < 0.05`, `hit rate > 0.55`, `>= 5건`, `7 days`)가 하드코딩 → 외부화 필요 시 별도 ADR
- PostgreSQL view 성능 — UNION ALL 3개 + dedup용 NOT EXISTS 2개. 사용자 1명·시드 ~20개 규모에선 무시 가능. 향후 사용자 N명 확장 시 인덱스/materialized view 검토 필요

### 후속 작업

- [ ] Phase A1: weekly-saju-review-v2 Routine 구축 시 view SELECT 동작 확인
- [ ] Phase A3 (#408 머지 후): view에 월운 layer 추가 — 컬럼 contract 유지하며 source 확장
- [ ] 임계치 외부화 필요성 운영 후 재평가 (3개월 누적 데이터 검토)

---

**참고 자료**

- 마스터 #393 (인사이트 v2) 헌장: `~/.claude/projects/-Users-ihyewon-slack-ai-agents/memory/project_insight_v2_core_principles.md`
- [ADR-0019](0019-saju-hypothesis-verification-pipeline.md) — Phase 4 가설-검증 파이프라인 (verified tier 데이터 출처)
- [ADR-0017](0017-saju-ganji-master-normalization.md) — 시드 catalog 정규화 (accumulating tier 데이터 출처)
- [design-notebook fortune-rework](../design-notebook/fortune-rework.md) — 마스터 A 서사
- 마이그레이션: `db/migrations/061_saju_influence_summary_view.sql`, `db/migrations/062_saju_weekly_reviews.sql`
