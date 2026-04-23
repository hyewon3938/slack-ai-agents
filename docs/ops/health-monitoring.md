# 서비스 헬스체크 & 업타임 모니터링

## 개요

봇·웹의 liveness를 외부에서 주기적으로 점검하고, 장애 감지 시 Slack `#project` 채널로 즉시 알림을 보낸다.

- 모니터링 주체: **GitHub Actions** (자체 구현)
- 체크 간격: 5분 (GitHub cron 특성상 실제 5\~10분)
- 설계 판단 근거: [docs/adr/0005-uptime-monitoring-github-actions.md](../adr/0005-uptime-monitoring-github-actions.md)

## 엔드포인트

### 공개 엔드포인트 (Uptime 모니터용)

| URL | 용도 | 응답 |
|-----|------|------|
| `https://<봇-호스트>/health` | 봇 프로세스 + DB 연결 체크 | `{ ok: true }` or 503 |
| `https://<웹-호스트>/api/health` | Vercel 웹 앱 liveness | `{ ok: true }` |

모니터는 **HTTP 200 + 응답 body에 `"ok":true` 포함**인지 검증한다 (단순 200이 아니라 body 내용도 확인 → 캐시된 구형 응답 감지).

### 내부 엔드포인트 (운영자용)

- `GET /health/detail` — API 키 Bearer 인증 필수
  - 응답 필드: `ok`, `uptime`(초), `db.status`, `db.latencyMs`, `timestamp`
  - 장애 원인 빠른 파악용

```bash
# 사용 예시
curl -H "Authorization: Bearer $DB_PROXY_API_KEY" https://<봇-호스트>/health/detail
```

## GitHub Actions 모니터 구성

### 파일 위치

`.github/workflows/uptime-check.yml`

### 동작 원리

1. **5분마다 cron 트리거** (`*/5 * * * *`)
2. **Matrix strategy**로 봇·웹 잡을 병렬 실행
3. 각 잡에서 **최대 2회 시도** (1차 실패 시 10초 대기 후 재시도)
4. **직전 완료 run**을 `workflow_run` API로 조회
5. 상태 전이 판정:

| 현재 | 직전 | 동작 |
|------|------|------|
| up | up | 조용 |
| up | down | ✅ RECOVERY 알림 |
| down | up | 🔴 DOWN 알림 |
| down | down | 조용 (이미 알림 보냄) |
| any | unknown | down이면 알림, up이면 조용 |

6. Slack Incoming Webhook으로 메시지 전송

### 재시도 설계 — cry wolf 방지

**2회 재시도** 는 일시적 네트워크 튐·배포 순간의 응답 지연 등을 흡수하기 위함. "실제 장애가 아닌데 알림이 오는" 상황(false alarm / cry wolf)이 반복되면 진짜 알림도 무시하게 된다.

- 1차 실패 → 10초 대기 → 2차 시도
- 2차도 실패해야 DOWN 판정
- 1회 성공하면 즉시 up 판정 (재시도 없이 종료)

## 설정 — GitHub Variables / Secrets

### Variables (레포 설정 → Secrets and variables → Actions → Variables)

| 키 | 값 예시 |
|----|---------|
| `BOT_HEALTH_URL` | `https://<봇-호스트>/health` |
| `WEB_HEALTH_URL` | `https://<웹-호스트>/api/health` |

헬스체크 URL은 민감정보가 아니므로 Variables에 저장 (workflow 로그·PR 디프 등에 노출돼도 무해).

### Secrets (동일 경로 → Secrets 탭)

| 키 | 값 |
|----|-----|
| `SLACK_WEBHOOK_URL` | `#project` 채널 Incoming Webhook URL |

Slack webhook은 유출 시 스팸에 악용 가능 → Secret에 저장.

### Slack Incoming Webhook 발급

1. Slack [apps 관리](https://api.slack.com/apps) → 해당 앱 선택
2. **Incoming Webhooks** 활성화
3. **Add New Webhook to Workspace** → `#project` 채널 선택
4. 생성된 URL을 `SLACK_WEBHOOK_URL` Secret에 등록

## 운영 가이드

### 알림 예시

**다운 감지:**
```
🔴 봇 다운 감지
URL: https://<봇-호스트>/health
HTTP: 503
시각 (KST): 2026-04-22 14:35
재시도: 2회 후 실패
[GitHub Actions run 보기]
```

**복구 확인:**
```
✅ 봇 복구 확인
URL: https://<봇-호스트>/health
시각 (KST): 2026-04-22 14:45
[GitHub Actions run 보기]
```

### 수동 실행

장애 감지 후 즉시 재확인이 필요하면 GitHub Actions UI에서 "Run workflow"로 수동 트리거:

```bash
gh workflow run uptime-check.yml
```

### 장애 대응 플로우

1. Slack `#project` 알림 수신
2. `/health/detail` 호출해서 컴포넌트별 상태 확인
   - `db.status: 'error'` → DB 컨테이너 로그 점검
   - `ok: false` + `db.status: 'ok'` → 봇 프로세스/네트워크 로그 점검
   - Vercel `/api/health` 장애 → Vercel 배포 상태 확인
3. 원인에 따라 복구 → 다음 cron에서 RECOVERY 알림 자동 수신

### False alarm 발생 시

1주일 이상 일시적 실패 알림이 반복되면:
1. Actions 로그에서 해당 run의 curl 결과 확인
2. 재시도 간격(현재 10초) · 재시도 횟수(현재 2회) 튜닝 검토
3. 튜닝 시 본 문서와 `0005-uptime-monitoring-github-actions.md` 후속 ADR 동시 업데이트

## 알려진 한계

### 1. GitHub Actions cron 정시성 보장 안 됨

`*/5 * * * *` 은 "5분마다"가 아니라 "5분 간격을 희망"이다. GitHub 공식 문서에 명시된 제약으로, 부하에 따라 5\~10분 간격이 될 수 있다.

→ **개인 프로젝트 SLA로는 5\~10분 감지 지연 수용.** 초분 단위 SLA가 필요하면 별도 서비스 도입 필요.

### 2. Slack 웹소켓(Socket Mode) 연결 끊김 미감지

프로세스는 살아있어 `/health`는 200을 반환하지만, Slack 메시지 응답은 불가능한 상태.

→ 향후 개선: Bolt 앱 `client.ping()` 결과를 DB Proxy의 `/health/detail`에 반영. 본 ADR 범위 바깥.

### 3. GitHub Actions 자체 장애 시 모니터링 정지

GitHub 인프라가 다운되면 업타임 모니터도 멈춘다.

→ GitHub 자체가 다운되는 시나리오는 본 프로젝트 SLA 범위 밖. 외부 보조 모니터가 필요하면 Better Stack 등 SaaS 추가 검토.
