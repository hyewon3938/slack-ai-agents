# 서비스 헬스체크 & 업타임 모니터링

## 개요

봇·웹의 liveness를 이중으로 감시하고, 장애 감지 시 Slack으로 알림을 보낸다.

| 방어선 | 주체 | 감지 주기 | 설계 근거 |
|--------|------|-----------|-----------|
| **1차망** | 봇 프로세스 heartbeat + [healthchecks.io](https://healthchecks.io/) dead-man's-switch | 정확한 5분 | [ADR-0055](../adr/0055-uptime-deadman-heartbeat.md) |
| **2차망** | GitHub Actions 폴링 (보조) | 실효 수 시간일 수 있음 | [ADR-0005](../adr/0005-uptime-monitoring-github-actions.md) |

핵심: **핑 송신자는 봇 프로세스 자체**다. 봇이 5분마다 자기·웹 헬스를 확인해 외부 dead-man's-switch로 ping을 보내고, 핑이 끊기면(=봇/VM 다운) healthchecks.io가 알린다. GitHub Actions `schedule`은 구조적 스로틀링으로 실효 주기가 수 시간까지 벌어질 수 있어(2026-07-04 실측), 정확한 5분을 보장하는 봇 송신을 1차로 두고 폴링은 보조망으로 남긴다.

## 엔드포인트

### 공개 엔드포인트 (모니터용)

| URL | 용도 | 응답 |
|-----|------|------|
| `https://<봇-호스트>/health` | 봇 프로세스 + DB 연결 체크 | `{ ok: true }` or 503 |
| `https://<웹-호스트>/api/health` | Vercel 웹 앱 liveness | `{ ok: true }` |

"정상"의 정의는 **HTTP 200 + 응답 body에 `"ok":true` 포함**이다 (단순 200이 아니라 body 내용도 확인 → 캐시된 구형 응답 감지). 봇 heartbeat와 GitHub Actions 폴링이 같은 판정 의미론을 공유한다.

### 내부 엔드포인트 (운영자용)

- `GET /health/detail` — API 키 Bearer 인증 필수
  - 응답 필드: `ok`, `uptime`(초), `db.status`, `db.latencyMs`, `timestamp`
  - 장애 원인 빠른 파악용

```bash
# 사용 예시
curl -H "Authorization: Bearer $DB_PROXY_API_KEY" https://<봇-호스트>/health/detail
```

---

## 1차망 — 봇 heartbeat + healthchecks.io dead-man's-switch

### 동작 원리

봇 프로세스가 상주하며 **5분마다**(node-cron, 인프라 레벨 태스크):

1. **봇 self-health** — DB `SELECT 1` 실행 (`GET /health`와 동일 의미론)
   - 정상 → `HC_PING_URL_BOT`으로 GET
   - 실패 → `HC_PING_URL_BOT + '/fail'`로 GET (즉시 알림)
2. **웹 health** — `WEB_HEALTH_URL`을 fetch → HTTP 200 + body `"ok":true` 검증
   - 정상 → `HC_PING_URL_WEB`으로 GET
   - 실패 → `HC_PING_URL_WEB + '/fail'`로 GET (즉시 알림)
3. **저하 사이클 기록** — 헬스 확인이 3초를 넘으면 "저하"로 판정해 인메모리 장부에 적는다
   - **알림을 내지 않는다.** 저하는 죽음이 아니므로 알리면 알림 무감각만 늘고 진짜 다운 알림의 신뢰도가 깎인다
   - 다음 **정상** ping을 POST로 보내며 장부를 body에 동봉 → healthchecks.io ping 로그에 뒤늦게라도 남는다
   - 전송에 성공한 분량만 비우므로, 침묵 구간을 건너뛴 이력도 다음 사이클로 이월된다

healthchecks.io는 이 ping이 정해진 주기 안에 도착하지 않으면 장애로 보고 알림을 낸다. **dead-man's-switch** — "핑이 끊기는 것"이 곧 신호다. 다만 "핑 없음"은 죽음·느려짐·네트워크 손실을 구분하지 못한다 → 3의 저하 기록이 그 해상도를 보완한다 ([ADR-0063](../adr/0063-resource-contention-uptime-judgment.md)).

### 구현 위치

- 모듈: `src/ops/uptime-heartbeat.ts` (named export `startUptimeHeartbeat`)
- 등록: 부팅 진입점 `src/app.ts` (DB 프록시와 나란히)
- **DB(`notification_settings`) 기반 Life Cron 슬롯이 아니다** — 인프라 레벨 상주 태스크

### 안전 설계

- **세 env 전부 선택적** — 하나라도 미설정이면 해당 대상은 스킵, 셋 다 없으면 부팅 로그 한 줄 남기고 완전 no-op. healthchecks.io 가입 전에 배포돼도 안전
- **heartbeat는 봇을 죽이지 않는다** — 모든 fetch에 타임아웃 + try-catch. ping 전송 실패는 로그만 (재시도 루프 없음 — healthchecks.io grace가 흡수)
- **타임아웃은 30초** — 자원 경합 구간에서 응답이 느려지는 것은 죽음이 아니라 저하다. 짧은 타임아웃은 저하를 죽음으로 오판해 ping 자체를 소실시키고, dead-man은 그 침묵을 다운으로 읽는다. heartbeat 주기(5분) 대비 30초는 충분히 짧아 진짜 다운 감지 시점을 늦추지 않는다
- **저하는 알림이 아니라 기록** — 판정 근거가 아닌 진단 보조다. 인메모리 장부라 봇 재시작으로 소실돼도 기능 손실이 아니다 (최대 12사이클 = \~1시간치 보관)

### 설정 절차

1. **healthchecks.io check 2개 생성** — 봇용·웹용
   - 권장 **Period 5분 / Grace 10\~15분** (봇 송신 주기 5분 + 네트워크·배포 지연 여유)
   - 각 check의 **ping URL**을 확보 (형식: `https://hc-ping.com/<uuid>`)
2. **VM `.env`에 등록** — 봇 서버 `.env`에 아래 3개 키 추가

   | 키 | 값 |
   |----|-----|
   | `HC_PING_URL_BOT` | 봇 check ping URL |
   | `HC_PING_URL_WEB` | 웹 check ping URL |
   | `WEB_HEALTH_URL` | 웹 헬스 엔드포인트 (`https://<웹-호스트>/api/health`) |

3. **재배포** — `gh workflow run deploy.yml` 또는 GitHub UI "Run workflow"
   - 부팅 로그에서 `[Heartbeat] 업타임 heartbeat 시작 (5분 간격): 봇, 웹` 확인
   - healthchecks.io 대시보드에서 최초 ping 수신 확인

> 알림 채널(Slack 등) 연결은 healthchecks.io check의 Integration 설정에서 구성한다.

---

## 2차망 — GitHub Actions 폴링 (보조)

봇 heartbeat가 1차망을 담당하므로 GitHub Actions 폴링은 **보조망**이다. healthchecks.io 자체 장애 등 1차망이 침묵하는 경우를 별도 경로로 커버한다.

### 파일 위치

`.github/workflows/uptime-check.yml`

### 동작 원리

1. **5분마다 cron 트리거** (`*/5 * * * *`) — 단, 실효 주기는 스로틀링으로 수 시간까지 벌어질 수 있음(아래 "알려진 한계" 참조)
2. **Matrix strategy**로 봇·웹 잡을 병렬 실행
3. 각 잡에서 **최대 2회 시도** (1차 실패 시 10초 대기 후 재시도 — cry wolf 방지)
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

### 설정 — GitHub Variables / Secrets

**Variables** (레포 설정 → Secrets and variables → Actions → Variables)

| 키 | 값 예시 |
|----|---------|
| `BOT_HEALTH_URL` | `https://<봇-호스트>/health` |
| `WEB_HEALTH_URL` | `https://<웹-호스트>/api/health` |

헬스체크 URL은 민감정보가 아니므로 Variables에 저장 (workflow 로그·PR 디프 등에 노출돼도 무해).

**Secrets** (동일 경로 → Secrets 탭)

| 키 | 값 |
|----|-----|
| `SLACK_WEBHOOK_URL` | 알림 채널 Incoming Webhook URL |

Slack webhook은 유출 시 스팸에 악용 가능 → Secret에 저장.

### 수동 실행

장애 감지 후 즉시 재확인이 필요하면 GitHub Actions UI에서 "Run workflow"로 수동 트리거:

```bash
gh workflow run uptime-check.yml
```

---

## 장애 시나리오별 감지 경로

| 시나리오 | 1차망 (봇 heartbeat) | 2차망 (GH Actions) |
|----------|----------------------|---------------------|
| **VM 다운** (봇·DB 함께 정지) | ping 송신 중단 → healthchecks.io가 grace 초과 감지 | 봇 URL 폴링 실패 → DOWN (단, 실효 주기 늦음) |
| **봇 프로세스 다운** (VM은 생존) | ping 송신 중단 → dead-man 감지 | 봇 URL 폴링 실패 → DOWN |
| **웹 다운** (Vercel 장애) | 웹 헬스 실패 → `HC_PING_URL_WEB/fail` 즉시 알림 | 웹 URL 폴링 실패 → DOWN |
| **DB만 다운** (봇 프로세스는 생존) | self-health `SELECT 1` 실패 → 봇 check `/fail` 즉시 알림 | 봇 `/health` 503 → DOWN |
| **모니터 자체 정지** (healthchecks.io 장애) | 감지 불가 (1차망 침묵) | GH Actions가 독립 경로로 잔존 → 커버 |
| **GitHub Actions 정지** | 1차망 정상 동작 (독립) | 감지 불가 |

두 방어선이 서로의 단일 실패점을 덮는다. VM/봇/웹/DB 장애는 1차망이 정확한 5분 창으로 잡고, healthchecks.io 자체 장애는 2차망이 잔존 경로로 커버한다.

### 장애 대응 플로우

1. Slack 알림 수신 (healthchecks.io 또는 GitHub Actions)
2. `/health/detail` 호출해서 컴포넌트별 상태 확인
   - `db.status: 'error'` → DB 컨테이너 로그 점검
   - `ok: false` + `db.status: 'ok'` → 봇 프로세스/네트워크 로그 점검
   - Vercel `/api/health` 장애 → Vercel 배포 상태 확인
3. 원인에 따라 복구 → 봇 heartbeat 재개 시 healthchecks.io가 자동으로 up 처리

### 다운 알림 오탐 판별 (재배포 **전** 필수)

같은 VM에서 도는 다른 워크로드(빌드 등)가 메모리를 잠식하면, 봇은 죽지 않았는데도 스왑 스래싱으로 모든 응답이 느려져 ping이 유실되고 dead-man이 다운으로 읽는다(2026-08-19 실측). 이 경우 **재배포는 해법이 아니라 부하 추가**다 — 알림을 받으면 아래 순서로 먼저 판별한다.

1. **컨테이너가 실제로 죽었나** — 재시작 횟수와 상태 확인. 값이 그대로면 프로세스는 산 것이다
   ```bash
   ssh oracle-prod "docker inspect -f '{{.State.Status}} restarts={{.RestartCount}} started={{.State.StartedAt}}' slack-ai-agents"
   ```
2. **내부 헬스가 응답하나** — 컨테이너 안에서 직접 찔러본다. 200이면 봇·DB는 정상, 문제는 바깥이다
   ```bash
   ssh oracle-prod "docker exec slack-ai-agents node -e \"fetch('http://localhost:3100/health').then(r=>console.log(r.status))\""
   ```
3. **호스트 자원 압력** — 스왑 사용량이 크고 available이 바닥이면 경합 상황이다
   ```bash
   ssh oracle-prod "free -m && uptime"
   ```
4. **경합 원인 워크로드** — 같은 VM의 다른 프로젝트가 빌드 중인지 확인 (컨테이너 목록·최근 이미지 빌드 시각)
5. **저하 기록 확인** — healthchecks.io 해당 check의 **Log** 탭에서 최근 ping body를 본다. `degraded N cycle(s) ... bot=8000ms` 형태가 남아 있으면 "느려졌다가 살아난 것"이 확정된다

1\~2가 정상이고 3\~5가 경합을 가리키면 **아무것도 하지 않는다.** 원인 워크로드가 끝나면 자연 회복되고 healthchecks.io가 자동으로 up 처리한다. 이 판별을 건너뛴 재배포는 경합 중인 호스트에 이미지 pull + 컨테이너 재생성 부하를 얹는다.

### VM 재프로비저닝 체크리스트

호스트를 새로 만들거나 갈아엎을 때 아래 두 가지는 코드 배포로 따라오지 않는다 — 수동으로 다시 넣어야 한다.

1. **스왑 성향 하향** — 커널이 스왑으로 압력을 흡수해버리면 아무도 죽지 않고 다 같이 느려져서 자정(自淨)이 일어나지 않는다. 값을 낮춰 압력이 스래싱 대신 OOM으로 빠르게 판정되게 한다
   ```bash
   echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf && sudo sysctl --system
   ```
2. **컨테이너 메모리 상한** — `docker-compose.yml`의 `mem_limit`/`mem_reservation`/`oom_score_adj`. 재배포 후 적용 여부 확인
   ```bash
   ssh oracle-prod "docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.MemoryReservation}} {{.HostConfig.OomScoreAdj}}' slack-ai-agents slack-ai-agents-db"
   ```

> 상한은 **보호가 아니라 억제**다. 이 스택이 경합의 원인이 되지 않게 자기를 묶는 장치이지, 바깥에서 오는 압력을 막아주지 않는다. 상세 근거는 [ADR-0063](../adr/0063-resource-contention-uptime-judgment.md).

---

## 알려진 한계

### 1. GitHub Actions cron 실효 주기 (2차망)

`*/5 * * * *`은 "5분마다"가 아니라 "5분 간격을 희망"이다. GitHub 공식 문서에 명시된 스로틀링 제약으로, 실측(2026-07-04, 30일 표본)상 실효 주기가 수 시간까지 벌어질 수 있다.

→ 이 때문에 정확한 5분 감지는 봇 heartbeat(**1차망**)이 담당한다. GitHub Actions는 보조망으로만 유지.

### 2. 무증상 실패 (1차망 한계)

봇 프로세스는 살아있으나 헬스 판정이 실제 상태와 어긋나 거짓 정상 ping을 보내는 경우.

→ 완화: 봇 self-health를 기존 `/health`와, 웹 검증을 기존 폴링과 동일 의미론으로 미러링. 능동 폴링(대상 바깥에서 직접 찔러보는 방식)이 필요해지면 Better Stack 등 SaaS 보완 검토 (ADR-0055 대안 C).

### 3. 자원 경합 구간의 판정 해상도

dead-man's-switch는 ping의 유무만 본다 — "죽음"과 "느려짐"과 "네트워크 손실"이 같은 신호(침묵)로 들어온다. 관측 실패가 관측 대상과 같은 호스트에서 상관돼 발생하는 구조적 한계다.

→ 완화: 타임아웃 확대(느린 ping도 도착하게) + 저하 사이클 기록(사후에 성격 판별 가능). 실시간으로 "저하 중"을 알려주지는 않는다 — 알림 무감각을 피하려는 의도적 선택 ([ADR-0063](../adr/0063-resource-contention-uptime-judgment.md)).

### 4. Slack 웹소켓(Socket Mode) 연결 끊김 미감지

프로세스는 살아있어 `/health`는 200을 반환하지만, Slack 메시지 응답은 불가능한 상태.

→ 향후 개선: Bolt 앱 `client.ping()` 결과를 `/health/detail`에 반영. 현재 범위 바깥.
