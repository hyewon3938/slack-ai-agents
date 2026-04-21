# 서비스 헬스체크 & 업타임 모니터링

## 개요

- 봇·웹의 liveness를 외부에서 주기적으로 점검
- 장애 감지 시 Slack `#project` 채널로 즉시 알림
- 모니터링 서비스: UptimeRobot (무료 티어, 5분 간격)

## 엔드포인트

### 공개 엔드포인트 (외부 모니터용)

| URL | 용도 | 응답 |
|-----|------|------|
| `https://<봇-호스트>/health` | 봇 프로세스 + DB 연결 체크 | `{ ok: true }` or 503 |
| `https://<웹-호스트>/api/health` | Vercel 웹 앱 liveness | `{ ok: true }` |

### 내부 엔드포인트 (운영자용)

- `GET /health/detail` — API 키 Bearer 인증 필수
  - 응답 필드: `ok`, `uptime`(초), `db.status`, `db.latencyMs`, `timestamp`
  - 장애 원인 빠른 파악용

```bash
# 사용 예시
curl -H "Authorization: Bearer $DB_PROXY_API_KEY" https://<봇-호스트>/health/detail
```

## UptimeRobot 설정

### 1. 계정 & 모니터 생성

- [ ] [UptimeRobot](https://uptimerobot.com) 계정 생성 (무료 티어)
- [ ] "Add New Monitor" 클릭
- [ ] Monitor Type: **HTTP(s)**
- [ ] Friendly Name: `봇 헬스체크` / `웹 헬스체크`
- [ ] URL: `https://<봇-호스트>/health` 또는 `https://<웹-호스트>/api/health`
- [ ] Monitoring Interval: **5 minutes**
- [ ] Advanced Settings > Keyword Alert: `"ok":true` (body에 해당 문자열 없으면 장애로 판단)

### 2. Slack 알림 연동

- [ ] UptimeRobot 대시보드 → My Settings → Alert Contacts
- [ ] "Add Alert Contact" → Type: **Slack**
- [ ] Slack Webhook URL 입력 (`#project` 채널용 Incoming Webhook)
- [ ] 생성한 Alert Contact를 각 모니터의 Alert When Down에 연결

### 3. 권장 옵션

- Monitor Type: HTTP(s) + Keyword
- Keyword: `"ok":true` (200이어도 body가 이상할 때 감지)
- 체크 간격: 5분
- Alert When Down: 2회 연속 실패 후 (일시적 네트워크 튐 흡수)

## 장애 대응 플로우

1. Slack `#project` 알림 수신
2. `/health/detail` 호출해서 컴포넌트별 상태 확인
   - `db.status: 'error'` → DB 컨테이너 점검
   - `ok: false` + `db.status: 'ok'` → 봇 프로세스/네트워크 점검
   - Vercel `/api/health` 장애 → Vercel 배포 상태 확인
3. 원인에 따라 대응

## 알려진 gap

- **Slack 웹소켓(Socket Mode) 연결 끊김은 현재 `/health`에 반영되지 않음**
  - 프로세스는 살아있지만 메시지 응답 불가 상태를 감지할 수 없음
  - 향후 개선: Bolt 앱 연결 상태를 DB Proxy 모듈에 주입하는 구조 필요
