# 0002. v3 아키텍처 — Vercel 웹 + VM 봇 + managed DB

- Status: Accepted
- Date: 2026-03-12
- Related: #94, PR #96
- Tags: infra, architecture

## Context

- v2는 Oracle Cloud ARM VM 한 대에서 Docker 4 서비스(app/db/web/caddy)를 운영했다.
- **웹 대시보드 빌드 4분+, 전체 배포 8\~9분** — ARM 스펙 + 동시 빌드 한계.
- **배포 자동화가 없어** 매번 SSH로 VM에 접속해 `git pull && docker compose up -d --build`를 수동 실행해야 했다.
- Caddy로 직접 TLS를 종료하는 구조 → 인증서 갱신·도메인 관리를 운영자가 감당.
- 웹·봇·DB가 같은 VM에서 CPU·메모리를 경합 → 봇 응답성에 간헐적 영향.

이 ADR의 **핵심 동기는 웹 배포 경험의 개선**이다. DB 이동은 Vercel serverless 환경과 pooled connection 호환을 맞추기 위한 **부산물**이지, 이동 자체가 동기가 아니다.

## Decision

**역할별 3-tier로 인프라를 분리한다.**

- **웹 대시보드**: Oracle VM Docker → Vercel 자동 배포 (GitHub push 트리거, Root Directory: `web/`)
- **데이터베이스**: VM Docker → Neon managed PostgreSQL
  - Vercel 웹: Neon pooled endpoint (serverless 함수와의 pooled connection 호환)
  - VM 봇: Neon direct endpoint (장기 실행 프로세스)
- **Slack 봇**: Oracle VM Docker 유지 (Socket Mode 장기 실행 + 크론 스케줄러 특성)
- **TLS/도메인**: Vercel이 웹 HTTPS를 담당 → VM의 Caddy 및 80/443 포트 제거

결과적으로 VM에는 Docker 서비스 1개(app)만 남는다.

## Alternatives considered

### A. VM 유지 + 빌드 파이프라인 최적화 (BuildKit 캐시, 멀티스테이지 개선, 별도 CI 도입)

- 장점: 인프라 구조 유지, 학습 비용 없음
- 단점: ARM 스펙 한계와 3서비스 동시 빌드의 근본 병목은 해소되지 않음. 자동 배포도 별도 구축 필요.
- 기각 이유: 재투자 대비 개선 폭이 작음

### B. 전 구성요소를 Vercel/Serverless로 이전

- 장점: 관리 포인트 최소화
- 단점: 봇은 Slack Socket Mode 기반의 장기 실행 프로세스 + 크론 스케줄러 → serverless 모델과 부적합.
- 기각 이유: 봇 런타임 특성과 정면 충돌

### C. Vercel 웹 + VM 봇 + Neon DB (선택)

- Decision 섹션 참조.

## Consequences

### 장점

- 웹 빌드/배포 \~1\~2분으로 단축, 전체 파이프라인 시간 감소
- **GitHub push → 자동 배포** — 수동 SSH 배포 제거
- VM 자원 경합 해소 → 봇 응답 안정성 개선
- VM의 80/443 포트를 닫을 수 있어 공격 표면 축소
- 웹 인증서·도메인 관리가 Vercel로 위임 → Caddy 제거

### 단점 / 제약

- 인프라가 2개 플랫폼으로 나뉘어 환경변수·배포 이력 관리 대상이 늘어남
- **Neon 무료 티어라는 외부 의존이 추가**됨 → 후일 이것이 단일 실패점으로 작동 → ADR 0003의 계기

### 후속 작업

- [x] Vercel/VM 양쪽 환경변수 동기화 규칙 정립
- [x] VM 내 Docker 서비스 정리 (app 외 제거)

---

**참고**

- [docs/project-history.md](../project-history.md) — v3 전환 항목
- PR [#96](https://github.com/hyewon3938/slack-ai-agents/pull/96)
