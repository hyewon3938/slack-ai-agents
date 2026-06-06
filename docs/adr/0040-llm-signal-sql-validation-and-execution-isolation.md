# 0040. LLM-생성 신호 SQL 검증·실행 격리 — untrusted 측정 SQL 2단 방어 (+ 옛 LLM 제안 재정의)

- Status: Accepted
- Date: 2026-06-06
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#491](https://github.com/hyewon3938/slack-ai-agents/issues/491), [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md) (승인 게이트 재사용 + LLM은 생성에만), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (signal_defs substrate), [ADR-0027](0027-llm-async-routine-unification.md) (LLM 비동기 = Claude 앱 routine), [ADR-0025](0025-llm-metric-approval-gate.md)·[ADR-0030](0030-llm-metric-suggest-input-and-cadence.md) (옛 LLM 매트릭 제안 — 본 ADR이 signal_defs 모델로 재정의)
- Tags: insight, security, llm, architecture

## Context

P5b는 LLM이 **새 측정 신호**(`signal_defs`, `kind='sql'`)를 자율 제안하는 발굴 트랙이다. ADR-0039가 "LLM은 *기존 데이터를 심판*하지 않고 *새 신호를 생성*하는 P5b 트랙에만"으로 위임했다. 생성된 `sql_body`는 등록 후 **주간 발굴·검증에서 매주, 일별 매칭에서 매일 무인(unattended) 실행**된다.

현 실행 경로(`runMetricSql`)는 `sql_body`를 **신뢰(trusted) SQL로 가정**한다 — `$1`/`$2`를 문자열 치환하고 `statement_timeout`만 건다. 이 가정은 신호가 **사람이 작성한 결정론 seed SQL**(71개)일 때만 성립한다. P5b는 `sql_body`의 출처를 **LLM 생성**으로 확장하므로 그 가정을 더는 쓸 수 없다.

생성자가 사용자 본인의 친화적 routine이어도, LLM-생성 SQL은 **untrusted input으로 다뤄야 한다**:

- LLM은 오류·할루시네이션이 가능하다 (의도와 다른 테이블·범위·부작용).
- `sql_body`는 영속되어 **무인으로 반복 실행**된다 — 한 번 잘못 들어가면 매주/매일 재실행.
- 이 시스템의 정신 자체가 "soft 판단을 믿지 않고 hard 게이트로 검증"이다 (자기기만 방지). 생성 SQL을 "친구가 썼으니 믿는다"는 그 정신과 모순.
- 본 저장소는 Public이고, "코드가 보여도 안전한" 설계를 요구한다.

또한 옛 LLM 매트릭 제안(ADR-0025 승인 게이트 + ADR-0030 입력 풀·재제안·월간 cron)은 **폐기된 `pattern_metrics` 모델** 위에 있어 그대로 못 쓴다. 입력 풀이 참조하던 `pattern_matches.evidence`도 P2에서 폐기됐다. `signal_defs(source='llm')` 모델로 재정의가 필요하다.

## Decision

### 1. LLM-생성 SQL = untrusted → 2단 방어

`sql_body` 출처가 `source='llm'`인 신호는 **untrusted**로 취급하고 두 게이트로 막는다. seed 신호(`source='seed'`, 사람 작성 결정론)는 기존 경로를 유지한다 — 강화는 위험원(`llm`)에만 건다(불필요한 오버헤드·기존 동작 변경 회피).

**게이트 #1 — 승인 시 정적 검증** (봇 서버, 하드):

순수 함수 `validateSignalSql(sqlBody)`가 다음을 강제한다. 통과해야만 승인 액션이 `signal_defs.status`를 `pending → active`로 전이한다(실패 시 카드에 사유 표시, 활성화 안 됨):

- **단일 SELECT/WITH만** — stacked statement(`;`) 차단, DDL/DML(INSERT/UPDATE/DELETE/DROP/...) 금지.
- **플레이스홀더 = `$1`(user_id)·`$2`(date)만** — 그 외 파라미터·문자열 연결 금지.
- **`user_id = $1` 필터 강제** — 타 사용자 데이터 접근 차단(`sql-tools.ts`의 `validateUserIdFilter` 정신).
- **테이블 화이트리스트(allow-list)** — insight 도메인의 raw 데이터 테이블만(`signal_defs` enum domain이 가리키는 일정·루틴·수면·지출·일기메타 raw 테이블). `signal_defs`·`pattern_links`·`pattern_catalog`·`users`·`custom_instructions` 등 메타·검증·민감 테이블, `information_schema`·`pg_catalog` 접근 금지.
- **위험 함수 차단** — `db-proxy.ts`의 검증된 `BLOCKED_PATTERNS`와 정렬(`pg_read_file`·`COPY`·`dblink`·`pg_sleep`·`lo_import`·`set_config`·`DO $`·`CALL` 등).
- **결과 형태 = 단일 숫자** — 한 행·한 열 수치(off-day 엔진이 소비하는 계약).

**게이트 #2 — 실행 시 격리** (봇 서버, 하드):

`source='llm'` 신호 실행은 전용 경로(`runLlmSignalSql`)로 분기:

- **매 실행 전 `validateSignalSql` 재검증** — 저장된 `sql_body`도 불신한다(defense in depth: 검증 규칙 진화·DB 변조·게이트 #1 우회 대비).
- **읽기전용 트랜잭션 강제** — `BEGIN; SET TRANSACTION READ ONLY; … ; ROLLBACK`(앱 레벨). 검증을 우회한 어떤 쓰기도 PG가 거부.
- **row cap + statement_timeout** — 폭주·비용 차단(`queryWithRowLimit` 정신 + 기존 타임아웃).

### 2. 미승인 신호 = 실행 0 (스키마가 이미 보장)

`signal_defs.status='pending'`은 매칭·검증·발굴에서 자동 제외된다(`loadActiveSignals` 등 모든 적재가 `status='active'`만). 즉 **미승인 `sql_body`는 inert data**이고, 사람 승인 + 게이트 #1 통과 후에만 실행 진입한다. 077 스키마(`source IN ('seed','llm')`, `status IN ('active','pending','rejected')`)가 이 경계를 이미 선언해 둠(헌장 ④).

### 3. 사람 = 큐레이션, LLM = 생성, 통계 = 판정 (ADR-0039 §3 재사용)

routine이 후보를 만들면 `pending` 신호로 INSERT → #insight 맥락 카드 → 사람이 [측정 시작]으로 **노출·큐레이션**("측정할 가치가 있나")을 게이트. 진짜 연관인지("믿음")는 active 후 off-day 통계가 가린다. **LLM 자기승인·자동 활성 아님**(v2 헌장 ①, ADR-0025 C안 계승). 카드·payload·승인 액션은 P5a 패턴(`buildDiscoveryCandidateCard`/`approveDiscoveryLink`)을 신호용으로 포팅.

### 4. 옛 LLM 매트릭 제안 재정의 (ADR-0025·0030 승계)

- **모델**: `pattern_metrics` → `signal_defs(source='llm', status='pending')`. 승인 = `signal_defs` status UPDATE(P5a는 `pattern_links` UPDATE였던 것과 대칭).
- **입력 풀**(v2 헌장 ① — 메타데이터·카운트만, 텍스트 원문 0): 라이프 메트릭 표 + 시드 description + 기존 active 신호(중복 제안 방지) + rejected `signal_defs`(재제안 자율 판단). **폐기된 `pattern_matches.evidence`는 제거**.
- **주기**: 월간 Claude 앱 routine(Opus, 구독료 잠금 — ADR-0027). cap 월 N(누적 pending이 cap이면 추가 제안 차단).

## Alternatives considered

- **등록-시 검증만, 실행 격리 없음** — 마찰 적으나 저장 후 검증 규칙 진화·DB 변조·게이트 우회에 무방비. 기각 — 무인 반복 실행이라 defense in depth 필수.
- **전용 read-only DB role** — 격리를 DB가 강제(앱 레벨보다 강함). 그러나 `.env`·커넥션 풀·배포 인프라 변경이 필요(되돌리기 더 무거움). 1차는 앱 레벨 read-only TX(인프라 0), 전용 role은 후속 옵션으로 명시.
- **전체 신호 재검증(seed 포함)** — 가장 보수적이나 사람 작성 결정론 seed 71개가 화이트리스트/형태 검증을 전수 통과하는지 불확실 + 매 실행 오버헤드 + 기존 동작 변경 리스크. 기각 — 위험원(`llm`)만 정밀 타격.
- **블랙리스트만(화이트리스트 없음)** — 새 위험 함수·테이블이 추가되면 취약. 기각 — 테이블 allow-list가 안전(deny-by-default).
- **LLM이 신호 + 시드 링크 동시 제안** — 헌장 ②(off-day로 발견) 충돌 + LLM이 가설 연결을 판정. 기각 — P5b는 신호 *생성*만, 시드 연결은 P5a 발굴이 off-day로.
- **LLM 자기승인 / 자동 활성** — v2 헌장 ① + ADR-0025 C안 계승. 기각.

## Consequences

### 장점

- LLM 자율 확장의 **보안 기준선**을 확립 — 이후 LLM이 새 측정·신호를 만드는 모든 트랙이 이 2단 방어 위에서 결정 가능.
- 미승인·미검증 SQL의 실행이 0(스키마 게이트 + 검증 게이트 이중).
- 헌장 ①(생성/판정 분리) 유지 — LLM은 측정 정의를 만들 뿐, 진짜인지는 통계가 가린다.
- P5a 승인 게이트 인프라(맥락 카드 + pending→active)를 재사용(새 통계 코어 0).

### 단점 / 제약

- 매 실행 재검증 오버헤드 — `source='llm'`만이라 작고, off-day 엔진의 시리즈 계산 비용에 비하면 무시 가능.
- 테이블 화이트리스트가 정당한 새 테이블을 차단할 수 있음 — 운영 중 화이트리스트 확장(노브).
- 앱 레벨 read-only TX는 전용 role보다 약함 — 검증 + TX 이중이라 1차 수용, 전용 role은 후속.
- LLM "새 근거" 재제안 판단의 일관성(ADR-0030 승계 제약) — rejected 노출 + 자율 판단 + 사용자 게이트가 거름.

### 후속 작업

- [ ] `validateSignalSql` + `runLlmSignalSql`(read-only TX) + 승인 액션(`signal_defs` pending→active).
- [ ] LLM 신호 제안 routine(월간, signal_defs 모델) — 옛 `monthly-metric-suggest` 재정의·교체.
- [ ] 전용 read-only DB role(인프라 후속, 옵션).
- [ ] 화이트리스트 운영 확장 정책 + routine 첫 발사 후 후보 품질 회고.

---

**참고 자료**

- [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md) §3 (사람 = 큐레이션, 믿음 = 통계)
- [ADR-0027](0027-llm-async-routine-unification.md) (LLM 비동기 = Claude 앱 routine, Opus)
- [db-proxy.ts `BLOCKED_PATTERNS`](../../src/db-proxy.ts) — 검증된 위험 함수 차단 목록(정렬 기준)
- v2 헌장 ① (LLM은 생성, 판정은 통계): `.claude/projects/-Users-ihyewon-slack-ai-agents/memory/project_insight_v2_core_principles.md`
