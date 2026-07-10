# 0060. 일정 삭제 사유 수집 — tombstone 사유 컬럼 + fill-NULL-only enrichment

- Status: Accepted
- Date: 2026-07-10
- Related: [#590](https://github.com/hyewon3938/slack-ai-agents/issues/590), [ADR-0054](0054-audit-net-displacement-and-trigger-writer.md)(전제 — 삭제 tombstone·기록 트리거 단일 계기), [ADR-0040](0040-llm-signal-sql-validation-and-execution-isolation.md)(신호 SQL 화이트리스트), [ADR-0044](0044-discovery-measurement-validity.md)(데이터-존재 윈도우)
- Tags: data, ux, insight

## Context

두 계기가 겹쳤다.

- **중복 confirm 버그**: 웹 캘린더 액션 메뉴에서 일정을 삭제하면 확인 confirm이 두 번 연속 뜬다 — 확인 로직이 컴포넌트(`action-menu.tsx`)와 훅(`use-schedules.ts` `handleDeleteById`) 양쪽에 중복 구현되어 있었다. 삭제 확인 UX를 어차피 단일 지점으로 재설계해야 한다.
- **tombstone에 "왜"가 없음**: 삭제 tombstone(ADR-0054, 마이그레이션 100)은 삭제 사실과 삭제 시점 상태(`{date, status, category_id}`)만 남긴다. 같은 "삭제"라도 실수 교정과 마음이 바뀐 포기는 행동적으로 전혀 다른 사건인데 구분할 수 없다. 삭제 사유는 일정 취소 행동을 해석할 수 있는 메타데이터로, 패턴 검증 시스템의 입력 가치가 있다.

제약 조건:

- `schedule_changes`는 append-only 감사 로그이고, **행 생성은 DB 트리거 단일 계기**다(ADR-0054 — 이 원칙은 불변).
- 웹은 DB Proxy 단일문 요청 계약이라, 트리거와 앱 코드 사이의 동일 트랜잭션 조율이 어렵다.

## Decision

### 1. 새 장부 없이 기존 tombstone에 사유 컬럼 2개 (마이그레이션 106)

| 컬럼 | 정의 |
|------|------|
| `delete_reason_category TEXT` | 고정 어휘 5종 CHECK. deleted 행에서만 허용 |
| `delete_reason_text TEXT` | 자유 텍스트 — `other`면 필수, 그 외 선택(수집 규약). deleted 행에서만 허용 |

고정 어휘 5종:

| 코드 | 의미 |
|------|------|
| `mistake` | 실수로 만든 일정 |
| `changed_mind` | 하기 싫어짐·마음 바뀜 |
| `external` | 상대방·외부 사정 |
| `rescheduled` | 다른 일정으로 대체 |
| `other` | 기타 (자유 텍스트 필수) |

마이그레이션 번호는 106 — 105는 진행 중인 다른 브랜치가 선점했다(096 결번 전례처럼 번호 갭은 무해).

### 2. 기록 주체 규약 — 행 생성은 트리거, 사유는 fill-NULL-only enrichment

- tombstone **행 생성은 트리거 단일 계기를 유지**한다(ADR-0054 불변).
- 사유는 삭제 직후 앱이 **UPDATE 1회로 enrichment**한다: `WHERE ... AND delete_reason_category IS NULL` — 사유가 NULL인 행만 1회 채울 수 있다(fill-NULL-only).
- 이것이 append-only 감사 로그에 허용하는 **유일한 예외**다. 트리거가 쓴 필드(`change_type`·`before_value` 등)는 불변이고, 이미 채워진 사유의 덮어쓰기도 불가.

### 3. 경로별 커버리지

| 경로 | 수집 방식 |
|------|----------|
| 웹 삭제 | **삭제 사유 모달**(라디오 5종 + 기타 텍스트)이 유일한 확인 지점 — 중복 confirm 전부 제거. DELETE API body로 사유 전달 → API가 삭제 후 enrichment |
| Slack 에이전트 자연어 | 프롬프트 지침으로 대화에서 사유를 받아 동일 UPDATE. 사용자가 안 주면 미기록으로 진행(수집 강제 없음) |
| Slack 오버플로우 버튼 | **미기록(NULL)** — 빠른 액션 특성상 수용, 커버리지 한계로 명시 |

### 4. 통계 연동

1. **seed 신호 1종 신설** — `audit_cancel_changed_mind`: `delete_reason_category='changed_mind'`인 삭제의 일 카운트(KST). `domain='audit'`·`source='seed'`·`status='active'`(승인 게이트는 LLM 신호 전용이라 비대상 — 마이그 100·101 전례). 다음 월요일 주간 발굴(P5a)이 (시드×신호) 후보 여집합에 자동 편입한다.
2. **P5b(LLM 신호 제안) 재료** — `schedule_changes`는 P5b 도입 시점부터 신호 SQL 테이블 화이트리스트(`SIGNAL_TABLE_WHITELIST`, ADR-0040)에 포함되어 있다. 사유 카테고리 컬럼이 생기면서 이 테이블 기반 신호 제안이 처음으로 의미 있는 재료를 얻는다.
3. **`schedule_fate` view 확장** — view 끝에 `delete_reason_category` 컬럼 추가. #574 생성일 코호트 레이어가 사유별 슬라이스를 할 수 있다.

### 5. 원문 비노출 — 카테고리만 신호화

`delete_reason_text`(사용자 원문)는 검증·발굴·제안 어떤 LLM 입력에도 넣지 않고, 신호 SQL도 카테고리만 사용한다 — v2 헌장 ① 원문 비노출 유지(`diary_entries`를 화이트리스트에서 제외한 것과 같은 원칙). 화이트리스트는 테이블 단위 검사라 컬럼까지 못 막으므로, LLM 신호 SQL의 `delete_reason_text` 참조는 `signal-sql-guard.ts` BLOCKED_PATTERNS에 컬럼명을 추가해 **정적으로 차단**한다(프롬프트 지시 의존이 아닌 코드 레벨 강제).

### 6. 존재-윈도우 주의 — 좌단 아티팩트

삭제 이벤트 관측은 tombstone 도입(마이그레이션 100, 2026-07-04)부터, 사유는 본 건(마이그레이션 106, 2026-07-10)부터다. 그 사이 약 1주의 삭제는 사유가 NULL이라 `audit_cancel_changed_mind` 신호값이 0으로 관측되는 좌단 아티팩트가 있다. 삭제가 희소 이벤트라 실질 영향은 없지만 정직하게 명시해 둔다(ADR-0044 정신).

## Alternatives considered

### A. 별도 사유 장부 테이블

- 장점: tombstone의 append-only 순수성을 그대로 유지
- 단점: 트리거 tombstone과 같은 삭제 이벤트를 두 테이블에 이중 기록 — ADR-0054 "단일 계기" 원칙 훼손. 소비 시 JOIN 부담
- 기각 이유: 같은 이벤트의 기록 계기가 둘로 갈라지는 구조 자체가 ADR-0054가 제거한 문제의 재도입

### B. soft delete (`deleted_at` 컬럼)

- 장점: 행이 살아 있으니 사유를 그 행에 그대로 쓰면 됨
- 단점: LLM 자유 SQL을 포함한 **전 조회 경로**에 `deleted_at IS NULL` 필터 부담. 기존 "soft delete 안 씀" 프롬프트 원칙과 충돌
- 기각 이유: 조회 경로 전체에 영구 비용을 지우는 대가가 사유 컬럼 2개의 가치를 크게 초과

### C. 트리거 세션 변수 (`set_config`로 트리거가 사유까지 기록)

- 장점: 기록 주체가 트리거 하나로 완결 — enrichment 예외 자체가 불필요
- 단점: 웹 DB Proxy가 단일문 요청 계약이라 `set_config`와 DELETE의 동일 트랜잭션 보장이 복잡
- 기각 이유: 인프라 계약을 흔드는 비용 대비 이득이 과함

### D. tombstone 사유 컬럼 + fill-NULL-only enrichment (선택)

- 장점: 새 테이블 0. 삭제 이벤트 기록은 여전히 트리거 단일 계기, 사유는 부가 enrichment로 역할이 명확히 분리
- 단점: append-only 순수성에 예외 1개 — fill-NULL-only + 트리거 필드 불변으로 범위 최소화

## Consequences

### 장점

- 중복 confirm 버그가 사유 모달 단일 지점화의 부산물로 해소 — 버그 수정과 데이터 수집이 한 재설계로 정렬
- 일정 취소 행동의 해석 가능 메타데이터가 배포일부터 축적 — `changed_mind` 신호가 P5a 발굴 대상에 진입
- 새 테이블 0 — 기존 audit 파이프라인(존재-윈도우·`schedule_fate` view) 위에 컬럼 2개로 얹힘

### 단점 / 제약

- Slack 오버플로우 버튼 경로는 미기록 — 채널 선택이 상황과 상관되면 결측이 랜덤이 아닐 수 있음(ADR-0054가 지적한 기록 경로 비대칭과 같은 계열의 한계, 규모는 작음)
- 사유는 자기보고라 주관 — 고정 어휘 5종으로 최소한의 구조화만 강제
- 사용자가 사유를 안 주면 NULL로 남는다(수집 강제 없음)
- append-only 예외 1개 도입 — fill-NULL-only 조건과 트리거 필드 불변으로 범위를 최소화

### 후속 작업

- [ ] 마이그레이션 106 + 웹 사유 모달 + 에이전트 프롬프트 지침 + 신호 시드 구현·배포 (#590)
- [ ] 사유 표본 축적 후(수개월) `changed_mind` 외 카테고리(`external`·`rescheduled`)의 신호화 여부 재평가
- [ ] Slack 버튼 경로 미기록 수용 지속 여부 — 전체 삭제 중 버튼 경로 비중이 유의미해지면 재검토
