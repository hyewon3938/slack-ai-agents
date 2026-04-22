# 0005. GitHub Actions 기반 자체 업타임 모니터링

- Status: Accepted
- Date: 2026-04-22
- Related: #334
- Tags: infra, observability

## Context

이전 PR(#332, #333)에서 봇·웹 양쪽에 헬스체크 엔드포인트를 추가했다.

- 봇: `GET /health` (DB ping 포함) + `GET /health/detail` (API Key 인증, latency·uptime 노출)
- 웹: `GET /api/health` (Vercel liveness)

원래 계획은 **UptimeRobot 무료 티어로 5분 간격 폴링 + Slack 알림** 연결이었다. 배포 후 실제 가입해 설정하려다 무료 티어 제약을 확인했다.

- Slack 연동 → 유료
- Incoming Webhook 전송 → 유료
- Keyword Alert (`"ok":true` 검증) → 유료
- Email 알림만 무료

Email 알림은 실시간성도 낮고 지금 운영 컨텍스트(Slack 중심)에도 맞지 않는다. 대안을 다시 검토해야 했다.

### 제약 조건

- **비용 0원** — 개인 프로젝트. 월 고정비는 최소화한다
- **Slack 알림 필수** — 이미 운영 알림 채널(#project)이 Slack으로 통일되어 있음
- **운영 부담 최소** — 별도 인프라 추가 운영 안 함
- **다운 + 복구 알림 모두 필요** — 다운 후 사용자가 수동 확인해야 하는 "복구됐나?" 의 스트레스 제거

## Decision

**GitHub Actions의 `schedule` 트리거로 자체 업타임 모니터를 구현한다.**

핵심 구성:

```yaml
# .github/workflows/uptime-check.yml
on:
  schedule:
    - cron: '*/5 * * * *'   # 5분 간격
  workflow_dispatch:         # 수동 실행 허용

jobs:
  check:
    strategy:
      fail-fast: false
      matrix:
        target:
          - name: 봇
            url: ${{ vars.BOT_HEALTH_URL }}
          - name: 웹
            url: ${{ vars.WEB_HEALTH_URL }}
    steps:
      - name: Health check (2-retry)
      - name: Notify (down / recovery)
```

### 설계 포인트

**1. Matrix strategy로 봇·웹 병렬 체크**
- 한 잡의 단일 스크립트로 여러 엔드포인트를 순차 검사하지 않고, 매트릭스로 병렬 실행
- 장애가 섞이지 않고 잡 단위로 독립적으로 통과/실패 → 어느 쪽 문제인지 바로 식별

**2. 2회 재시도로 일시적 네트워크 튐 흡수 (cry wolf 방지)**
- 1차 실패 → 10초 대기 → 2차 시도
- 2차도 실패해야 "다운"으로 판정
- 배포 순간의 순간적 응답 지연, 외부 CDN 일시 장애 등의 false alarm 차단

**3. Down + Recovery 양방향 알림을 stateless로 구현**

GitHub Actions는 실행 간 상태를 공유하지 않는다. 별도 state store 없이 **workflow_run API**로 직전 실행 결과를 조회해 상태 전이를 판정한다:

- 이번 실패 + 직전도 실패 → 이미 알림 보냄, 스킵 (반복 알림 방지)
- 이번 실패 + 직전 성공 → **DOWN 알림**
- 이번 성공 + 직전 실패 → **RECOVERY 알림**
- 이번 성공 + 직전 성공 → 무시

`GITHUB_TOKEN`은 workflows에 자동 제공되므로 별도 PAT(Personal Access Token) 불필요.

**4. Secrets vs Variables 분리**
- `secrets.SLACK_WEBHOOK_URL` — 외부 유출 시 Slack 스팸 가능 → Secret
- `vars.BOT_HEALTH_URL`, `vars.WEB_HEALTH_URL` — 공개돼도 무해(헬스 엔드포인트는 민감정보 미노출) → Variable
- 보안 원칙: "최소 권한으로 최소한만 비밀"

## Alternatives considered

### A. UptimeRobot 무료 티어 (원래 계획)

- 장점: 설정 30초, 운영 부담 0
- 단점: 무료 티어에서 Slack·Webhook·Keyword Alert 모두 불가능. Email 알림만 가능
- 기각 이유: Email 알림은 Slack 운영 패턴과 안 맞음. 실시간성·확인 용이성 모두 낮음

### B. Better Stack / Healthchecks.io 등 다른 무료 SaaS

- 장점: Slack 연동·Webhook 가능한 대안 존재
- 단점:
  - 또 다른 외부 서비스 계정 추가 → 관리 대상 증가
  - 무료 티어 정책이 언제 바뀔지 모름 (UptimeRobot 사건 재발 가능)
  - 대부분 모니터 수·간격에 제약
- 기각 이유: 외부 의존을 줄이는 방향으로 결정. 기존 인프라(GitHub)로 커버 가능하면 그쪽 선호

### C. VM 내 cron + curl + Slack Webhook

- 장점: 완전 자체 제어
- 단점:
  - 모니터링 대상(VM)이 모니터링 주체가 되는 자기 참조 구조 — VM 자체 다운 시 알림 불가
  - 운영자가 매번 VM 접속해서 로그 확인
- 기각 이유: 업타임 모니터링의 기본 원칙(**모니터는 대상 바깥에 있어야 한다**) 위반

### D. GitHub Actions 기반 자체 모니터 (선택)

- 장점:
  - 비용 0원 (퍼블릭 레포는 GitHub Actions 무제한)
  - 외부 서비스 의존 제로
  - 알림 로직을 코드로 완전 통제 (재시도·복구 판정·메시지 포맷 모두 workflow 안)
  - VM과 독립 (GitHub 인프라에서 실행)
  - 실행 로그가 Actions UI에 남아 감사 가능
- 단점:
  - GitHub Actions cron은 **정시에 정확히 실행되지 않음** — 부하에 따라 수 분 지연 가능 (공식 문서 명시)
  - → 5분 간격도 실제로는 5\~10분 간격으로 돌 수 있음. 초분 단위 SLA가 필요하면 부적절
  - Stateless한 구조 때문에 복구 알림 로직에 workflow_run API 호출 한 단계 추가
- 선택 근거: **개인 프로젝트 SLA로는 5\~10분 감지도 충분**. 운영 부담·비용·외부 의존 제거가 정시성보다 중요

## Consequences

### 장점

- 월 고정비 0원 유지
- Slack 알림·복구 알림 모두 확보 (운영 편의 손실 없음)
- 모니터링 로직이 코드로 버전 관리됨 → 변경 이력 추적 가능
- 외부 SaaS 계정 추가 없음

### 단점 / 제약

- **정시성 보장 안 됨** — 5분 cron이 실제로는 5\~10분마다 돌 수 있음
  - 완화: 개인 프로젝트에서 다운 감지가 1분 늦는다고 체감 큰 손해 없음
- **GitHub Actions 장애 시 모니터링 자체 정지** — 모니터의 단일 실패점
  - 완화: GitHub 자체가 다운되는 시나리오는 본 프로젝트 SLA 범위 밖
- **workflow_run API 호출이 알림 경로에 포함됨** — 직전 실행 조회가 실패하면 보수적으로 DOWN 알림을 보내도록 처리 필요

### 후속 작업

- [ ] 헬스체크 엔드포인트 URL을 `vars.BOT_HEALTH_URL`, `vars.WEB_HEALTH_URL`로 GitHub Variables에 등록
- [ ] `secrets.SLACK_WEBHOOK_URL` 등록 (#project 채널 Incoming Webhook)
- [ ] `docs/ops/health-monitoring.md`를 GitHub Actions 기반으로 재작성
- [ ] 한 달 운영 후 false alarm 발생 빈도 점검 → 재시도 간격·횟수 튜닝 필요 시 재평가

### 관측성 범위 (현재 ADR 범위 바깥)

본 ADR은 **liveness**(프로세스·HTTP 응답 여부)만 다룬다. 아래는 별도 과제:

- Slack 웹소켓 연결 끊김 감지 — 프로세스는 살아있지만 메시지 응답 불가 상태
- 에러율·응답 시간 SLO 측정
- LLM 호출 실패율 추적

---

**참고**

- [GitHub Actions: Scheduled events](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule) — cron 정시성 경고 포함
- [workflow_run REST API](https://docs.github.com/en/rest/actions/workflow-runs)
- Michael Nygard, *Documenting Architecture Decisions* (2011)
