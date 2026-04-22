# 0006. modify_db 대량 변경 확인 플로우

- Status: Accepted
- Date: 2026-04-22
- Related: #342
- Tags: security, llm, ux

## Context

- LLM이 `modify_db` 도구로 생성한 DELETE/UPDATE는 기존 방어층으로 명백한 위험을 차단해 왔다.
  - DDL 키워드(DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE) 전면 차단
  - DELETE/UPDATE에 WHERE 절 필수
  - 모든 쿼리에 `user_id = {caller}` 필터 강제 (교차 사용자 차단)
  - 트랜잭션 + 최대 50행 제한 — 50행 초과 시 자동 ROLLBACK
- 그러나 위 방어는 **형식적 조건만 검증**한다. 형식은 통과하면서 **의도치 않게 광범위한 범위를 건드리는 쿼리**(예: `DELETE FROM schedules WHERE user_id = 1 AND category = 'old'` — 운영 중 'old' 레코드가 30개 있는 상황)는 막지 못한다.
- 도메인 특성상 일정·수면·지출 레코드는 복구 난이도가 높다. 백업은 있지만 복구 과정 자체가 비용이다.
- LLM의 지시 해석 오류·할루시네이션이 상존하므로, **자동 실행 이전의 휴먼 체크 레이어**가 필요했다.
- Threshold 선택은 **False Positive vs False Negative** 트레이드오프이다.
  - **False Positive (FP)**: 안전한 작업인데 확인 카드가 뜸 → UX 피로, 탭 한 번 더
  - **False Negative (FN)**: 실제 위험한 작업이 threshold 미만이라 그냥 실행됨 → 사고로 이어질 수 있음
  - Threshold를 낮게 잡을수록 FN↓ / FP↑, 높게 잡을수록 FN↑ / FP↓.
  - 정답이 하나인 값이 아니므로, 초기값은 경험적 타협점으로 잡고 운영 데이터로 재조정 가능해야 한다.

## Decision

**DELETE/UPDATE 쿼리에 한해 실행 전 dry-run으로 영향 row 수를 계산하고, 임계치 이상이면 Slack 확인 카드로 사용자 승인을 받은 뒤에만 실제 실행한다.**

### 구체 구조

1. **Dry-run**: `BEGIN → 실행 → ROLLBACK` 트랜잭션으로 영향 row 수만 얻는다 (DB 상태 무변경).
2. **임계치 분기**:
   - `rowCount < MODIFY_CONFIRM_THRESHOLD` (기본 3): 기존 즉시 실행 경로
   - `rowCount >= MODIFY_CONFIRM_THRESHOLD`: `pending_modify` 테이블에 token·SQL·TTL(5분) 저장 후 Slack Block Kit 확인 카드 전송
3. **사용자 액션**:
   - "실행" 버튼 → `pending_modify` 조회 → `queryWithRowLimit`로 실제 실행 → 결과 메시지로 카드 교체
   - "취소" 버튼 → `canceled_at` 마킹 → 취소 메시지로 카드 교체
4. **LLM agent-loop는 pending 응답 받은 시점에 종료.** 사용자 클릭 후 실행 결과 보고는 액션 핸들러가 **고정 템플릿**으로 처리한다 (LLM 재호출 없음).
5. **Threshold는 `MODIFY_CONFIRM_THRESHOLD` 환경변수로 외부화.** 재배포 없이 조정 가능하다.

### 보안 설계

- `pending_modify.token`은 crypto.randomBytes(8) → 16 hex chars. URL-safe, 식별용.
- 조회는 항상 `token + user_id` 쌍으로 — 다른 유저의 token 접근을 DB 레벨에서 차단.
- TTL 5분 — 만료되거나 executed/canceled 된 pending은 재사용 불가.
- 액션 핸들러는 `resolveBodyUserId`로 클릭한 Slack 유저 → DB user_id 해석 후 대조.

## Alternatives considered

### A. 모든 DELETE/UPDATE에 확인 요구

- 장점: FN = 0. 절대 실수 없음.
- 단점: 단일 row 수정까지 매번 탭 한 번. UX 피로가 심하고, 특히 대시보드가 아닌 대화형 에이전트 맥락에서 흐름을 끊는다.
- 기각: FP 비용이 너무 큼.

### B. 특정 테이블만 보호 (화이트리스트)

- 장점: 중요 테이블만 선별 보호.
- 단점: 테이블이 늘어날 때마다 수기 유지보수. 신규 테이블이 기본값으로 무방비.
- 기각: 운영 부담 + 누락 위험.

### C. 영향 row 기반 threshold (선택)

- 장점: FN/FP 균형점. 테이블 무관하게 일괄 적용.
- 단점: threshold 초기값이 경험적. 재조정 필요.
- 완화: 환경변수로 외부화 + 운영 데이터로 조정.

### D. LLM agent-loop를 pending 상태로 일시정지하고 사용자 클릭 후 재개

- 장점: 실행 결과를 LLM이 받아 자연스럽게 후속 대화 (예: "취소했다면 다른 조건으로 다시 시도할까?"). 에이전트로서의 자율성이 유지됨.
- 단점:
  - Durable state 관리 필요 (LLM 대화 컨텍스트·message history를 DB 또는 Redis에 직렬화 저장)
  - 클릭 시점에 Claude API를 1회 더 호출 → 비용 증가
  - 실패 경로(만료, 재시작 중 크래시 등) 처리 복잡
- 기각: 현시점에서 과잉 설계. 수정 후 후속 LLM 판단이 거의 필요 없고, 확인 플로우는 "실행 or 취소" 두 결과로 수렴.

## Consequences

### 장점

- 기존 방어층(DDL 차단, WHERE 필수, user_id 스코프, 50행 제한)을 그대로 유지하며 **"범위는 괜찮지만 넓은 쿼리"**에 대한 마지막 안전망 추가
- 실수 복구 비용이 높은 도메인(일정·수면·지출)에 휴먼 체크 플로우 도입
- Claude API 호출 수는 **기존 대비 감소 가능** — 기존에는 도구 결과를 받아 LLM이 응답 문장을 생성했지만, 이제는 고정 템플릿이 대체
- Threshold 외부화로 운영 중 재배포 없이 튜닝 가능

### 단점 / 제약

- DELETE/UPDATE마다 트랜잭션 1회 (dry-run) 추가 — DB 부하 측면에서 사실상 영향 미미하나, 이론상 2배 IO
- `pending_modify` 테이블의 만료 레코드 정리 책임이 생김 (현재는 조회 시 `expires_at > NOW()` 필터로 배제. 주기적 cleanup은 선택적)
- 초기 threshold 3은 경험적 — 데이터·UX에 따라 재조정 필요
- LLM이 후속 판단을 하지 않으므로, 사용자가 실행 후 "다른 방식으로 다시" 같은 멀티스텝 인터랙션은 새 메시지로 재시작해야 함

### 현재 선택의 맥락

이 프로젝트의 장기 방향성은 LLM이 대화를 이어가며 자율적으로 후속 판단을 수행하는 **풀 에이전트**다.
현시점에서는 LLM 호출 비용 제약으로 대시보드 중심 UX를 채택 중이며, Slack 에이전트 상호작용은 fast path 바이패스와 최소 호출 전략으로 운영된다.

이 맥락에서 본 ADR은 **D안(LLM agent-loop 재개)이 장기 방향성에 더 부합함을 인정**하면서도, 현재 단계의 비용·단순성 요구에 따라 **C안 + 고정 템플릿 종료**를 선택한다.
D안의 durable state 관리·추가 LLM 호출 비용은 현재 트래픽에서 과잉이며, 우선 가드레일 자체의 정확성과 구현 단순성을 확보한다.

### D안 전환 시나리오

향후 LLM 호출 예산이 확보되거나 다단계 인터랙션 기능이 필요해지는 시점에 다음 변경으로 전환:

1. `pending_modify` 스키마에 `llm_context` JSONB 컬럼 추가 (직전 메시지 N개 저장)
2. 액션 핸들러(execute)가 실행 후 agent-loop를 `llm_context` 복원해서 재진입
3. tool 결과 반환 형식 변경 (`pending: true` flag → LLM이 읽을 수 있는 후속 프롬프트 구조)
4. 고정 템플릿 응답 경로는 fallback으로 유지

**전환 트리거 조건**:
- 월간 Claude API 비용이 안정적으로 예산 이하로 내려올 때
- 사용자 요청 중 "확인 후 후속 대화" 니즈가 반복 관찰될 때
- 다른 LLM 도구에서도 유사한 multi-step 인터랙션 요구가 생길 때

### 후속 작업

- [ ] Threshold 값 운영 후 재평가 (env로 외부화 완료, 사용 데이터 축적 후 조정)
- [ ] `pending_modify` 만료 레코드 주기적 정리 (경량 크론 or 조회 시 무시)
- [ ] 향후 다른 LLM 도구(예: 파일 쓰기, 외부 API 호출) 추가 시 동일 패턴 재사용 검토

---

**참고**

- [CLAUDE.md](../../CLAUDE.md) — "핵심 설계 원칙"
- [ADR 0001](0001-sql-tool-llm-agent.md) — SQL 도구 기반 LLM 에이전트 설계 (이 ADR의 기반)
