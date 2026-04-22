# 0004. DB Proxy API 패턴 — Vercel → VM DB 직결 제거

- Status: Accepted
- Date: 2026-04-09
- Related: PR #217 (도입), PR #218 (아키텍처 문서 갱신), PR #234 (프록시 루프백 바인딩 강화)
- Tags: infra, security

## Context

- ADR 0003 이후 Vercel이 VM의 PostgreSQL 포트에 **직접 연결**하는 임시 구조였다.
- **DB 포트를 공개 인터넷에 노출**하는 형태 → 공격 표면 확대.
- 자가 호스팅 DB는 managed DB가 기본 제공하는 방어선(WAF, 레이트 제한, 인증 강화 등)을 갖추지 않는다.
- 본 프로젝트는 ORM 없이 LLM이 생성한 SQL을 직접 실행하는 구조라 **애플리케이션 경계에서 SQL 수준 방어선**을 추가할 여지가 있었다.

## Decision

**봇 서버 프로세스 안에 HTTP 기반 DB Proxy API를 추가하고, Vercel은 그 API만 호출한다.** 별도 프록시 서버 프로세스는 띄우지 않는다.

- 경로: `Vercel 웹 → HTTPS (Bearer API Key) → 봇 서버 내부 DB Proxy 엔드포인트 → VM 내부 DB`
- 환경변수: `DB_PROXY_URL`, `DB_PROXY_API_KEY`
- `POST /api/db/query`만 허용 (서버 간 호출이라 CORS 불필요)
- SQL 화이트리스트:
  - 허용 키워드: `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`
  - 차단: DDL (`DROP`/`ALTER`/`CREATE`/`TRUNCATE`/`GRANT`/`REVOKE`), 파일 I/O (`COPY`/`pg_read_file`/`lo_import` 등), 프로시저 (`DO`/`CALL`), `dblink`, `pg_sleep`
- 복수 문(`;`) 금지, SQL 길이·파라미터 수·바디 크기 상한
- API Key 32자+ 강제, `timingSafeEqual` 상수 시간 비교
- 프록시 포트 `127.0.0.1:3100` 바인딩 (호스트 Caddy TLS 종료 경유 강제, PR #234)

## Alternatives considered

### A. Vercel 아웃바운드 IP를 DB 방화벽 허용 리스트에 고정

- 장점: 구현 공수 최소 (방화벽 규칙만 추가)
- 단점: **Vercel serverless 함수의 아웃바운드 IP는 동적**이며, 프리티어에서 고정 IP를 제공하지 않음 → 방화벽 허용 리스트 고정 불가
- 기각 이유: 플랫폼 제약으로 근본 동작 불가

### B. VM에 VPN 설치 후 Vercel이 VPN 클라이언트로 경유

- 장점: 네트워크 계층에서 터널로 DB 보호
- 단점: 1인 프로젝트 규모에 VPN 서버 운영은 오버엔지니어링
- 단점: **VPN 크리덴셜을 Vercel 환경변수에 보관해야 함** — 환경변수 유출 시 블래스트 반경이 네트워크 계층까지 확장됨
- 기각 이유: 운영 부담 + 크리덴셜 블래스트 반경 모두 불리

### C. 봇 서버 프로세스 안에 HTTP API 레이어 추가 (= DB Proxy) (선택)

- Decision 섹션 참조. 별도 프록시 인프라 없이 기존 봇 Node.js 프로세스에 엔드포인트만 추가.

## Consequences

### 장점

- DB 포트를 외부에 노출하지 않아 공격 표면 축소
- 애플리케이션 계층에 SQL 화이트리스트 방어선 추가 (ORM 부재 보완)
- **크리덴셜 유출 블래스트 반경 제한** — Vercel은 DB 직접 크리덴셜을 모르고 Proxy API Key만 보유. 환경변수 유출 시 피해 범위가 **화이트리스트된 쿼리 실행**으로 한정됨 (비교: SSH 터널·VPN 방식이었다면 크리덴셜 유출 시 VM 쉘 접근이나 네트워크 계층 침투까지 가능)
- 감사 로그를 프록시에 중앙화 가능 (쿼리 단위 기록)

### 단점 / 제약

- Vercel → VM 왕복이 한 번 추가되어 레이턴시 증가
- 프록시 서버 프로세스 장애 시 웹 대시보드의 DB 접근 불가 (봇 프로세스와 SPOF 공유)
- 화이트리스트가 비즈니스 쿼리 유연성과 트레이드오프 — 새 쿼리 패턴 도입 시 프록시 검증 로직 점검 필요

### 후속 작업

- [x] 프록시 헬스체크 & 외부 업타임 모니터링 (완료: ADR 0005)
- [ ] 프록시 실패 시 Vercel 측 폴백/캐시 전략 검토

---

**참고**

- PR [#217](https://github.com/hyewon3938/slack-ai-agents/pull/217), [#218](https://github.com/hyewon3938/slack-ai-agents/pull/218), [#234](https://github.com/hyewon3938/slack-ai-agents/pull/234)
- `src/db-proxy.ts` — 구현체
