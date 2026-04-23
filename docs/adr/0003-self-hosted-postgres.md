# 0003. DB 자가 호스팅 전환 (Neon → VM PostgreSQL)

- Status: Accepted
- Date: 2026-04-06
- Related: 운영 작업으로 직접 진행 (연결된 PR 없음). 직접 후속: PR #329 (DB 자동 백업 파이프라인)
- Tags: infra, data

## Context

- v3 전환(ADR 0002) 이후 Neon 무료 티어를 DB로 사용 중이었다.
- 무료 티어의 구조적 특성: **compute 한도를 초과하는 순간 쿼리·조회 자체가 자동 차단되며, 결제 전까지 복구되지 않는다.**
- 개발·운영 중 크론 알림 로직이 DB를 과도하게 참조해 compute 한도를 트리거 → **서비스 전체 중단**.
- 차단된 상태에서는 **데이터 조회도 불가능해져 덤프를 떠서 다른 DB로 옮기는 긴급 마이그레이션 경로 자체가 막힘**.
- 즉 **managed DB 무료 티어의 hard limit 정책 자체가 구조적 단일 실패점** — 어떤 운영 실수든 곧바로 전체 중단으로 번진다.

제약:
- 월 고정비 0원 유지
- 이미 확보된 Oracle Cloud Free Tier VM에 봇 외 여유 CPU/메모리/디스크가 있음

## Decision

**DB를 Neon → Oracle VM 내부 PostgreSQL Docker 컨테이너로 이관한다.**

- 봇: 같은 VM 내부에서 localhost 경로로 연결 (`DATABASE_URL`)
- Vercel: 일시적으로 VM의 DB 포트에 직접 연결 (이후 ADR 0004에서 프록시 경유로 전환)
- 데이터 이관: Neon compute를 임시로 살려 `pg_dump` 덤프 → VM PostgreSQL에 `psql` 임포트

## Alternatives considered

### A. Neon 유료 플랜으로 전환

- 장점: 인프라 변경 없이 차단 해소
- 단점: 월 고정비 발생 — 비용 상한 제약과 충돌
- 단점: **유료 플랜에서도 플랜 한도를 초과하면 동일한 hard limit이 작동한다.** 구조적 리스크는 그대로이고, 트리거 시점만 늦춰질 뿐.
- 기각 이유: 돈만 들고 근본 리스크가 남음

### B. 다른 무료 managed DB로 재이전 (Supabase, Cloudflare D1 등)

- 장점: 자가 호스팅보다 운영 부담이 적음
- 단점: **당시 Neon compute가 차단된 상태라 원본 덤프 자체를 뜰 수 없었다.** 정기 백업이 있었다면 열렸을 옵션이지만 **실질적으로 닫혀있던 대안**.
- 단점: 옮기더라도 대부분의 무료 티어는 유사한 hard limit 정책을 가져 같은 리스크가 반복됨.
- 기각 이유: 현실적 접근 불가 + 구조적 리스크 미해결

### C. VM 자가 호스팅 (선택)

- Decision 섹션 참조.

## Consequences

### 장점

- managed DB 무료 티어 hard limit 의존 제거 → 쿼리 폭증이 곧바로 전체 중단이 아니게 됨
- 월 고정비 0원 유지
- 봇-DB 간 레이턴시 감소 (동일 VM 내부 통신)
- DB 통제권 완전 확보 (설정·확장·백업 모두 본인 재량)

### 단점 / 제약

- DB 운영 책임(백업·업그레이드·장애 복구)이 본인에게 이전
- VM의 디스크·메모리 용량이 DB 규모 상한이 됨
- Vercel이 VM의 DB 포트를 직접 노출해야 하는 임시 구조 발생 → **공격 표면 확대** → ADR 0004 필요성

### 교훈

**정기 백업의 부재가 이번 사건의 선택지를 좁혔다.** 원본이 차단된 상태에서 B(다른 무료 DB 재이전) 옵션이 실질적으로 닫혔던 이유가 여기에 있다. 이 ADR의 직접적 후속으로 2026-04-21 **DB 자동 백업 파이프라인(PR #329, pg_dump + Cloudflare R2 + rclone)** 이 도입됐다.

### 후속 작업

- [x] DB 자동 백업 파이프라인 구축 (완료: 2026-04-21, `docs/ops/db-backup.md`)
- [x] Vercel → DB 경로의 보안 재설계 (완료: ADR 0004)

---

**참고**

- [docs/project-history.md](../project-history.md) — Neon → VM 이관 항목
- PR [#329](https://github.com/hyewon3938/slack-ai-agents/pull/329) — 백업 파이프라인 (직접 후속)
