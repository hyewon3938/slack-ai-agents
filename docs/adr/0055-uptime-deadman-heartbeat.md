# 0055. 업타임 dead-man's-switch heartbeat (봇 프로세스 송신)

- Status: Accepted
- Date: 2026-07-04
- Related: #577
- Tags: infra, observability, reliability

## Context

[ADR-0005](0005-uptime-monitoring-github-actions.md)에서 GitHub Actions `schedule`(`*/5 * * * *`)로 봇·웹 헬스를 5분 간격 폴링하는 자체 업타임 모니터를 도입했다. 당시에도 "GitHub Actions cron은 정시성을 보장하지 않는다"는 제약을 알고 있었으나, 개인 프로젝트 SLA에서는 5\~10분 감지 지연을 수용 가능하다고 판단했다.

2026-07-04 실제 실행 이력을 집계한 결과, 실효 주기가 애초 가정보다 크게 벌어져 있었다.

- 최근 30일 · 298개 실행 표본 기준, 인접 실행 간격의 **중앙값이 약 2시간**, **최댓값 약 6시간**
- 의도한 5분대(4\~6분) 간격으로 실행된 건은 **0건**
- 원인은 GitHub Actions `schedule` 트리거의 구조적 스로틀링 — 공용 러너 부하에 따라 예약 실행이 큐잉·지연·병합되며, 특히 저부하 리포지터리의 고빈도 cron은 강하게 눌린다 (공식 문서에 "정시 실행 보장 안 됨" 명시)

즉, 2차 방어선으로 두었던 폴링이 실질적으로는 **수 시간 단위 감지**만 제공하고 있었다. 봇이나 VM이 내려가도 다음 폴링이 돌 때까지 감지가 지연된다.

### 제약 조건

- **비용 0원 유지** — 개인 프로젝트, 월 고정비 최소화 (ADR-0005와 동일)
- **정확한 5분 주기 감지** — 스로틀링에 종속되지 않는 송신 경로가 필요
- **모니터는 대상 바깥에서 관측** — 업타임 모니터링 기본 원칙 (자기 참조 구조 회피)
- **배포 파이프라인에 편승** — 별도 수동 인프라(호스트 crontab 등)를 늘리지 않는다
- **점진 도입 안전성** — 외부 서비스(healthchecks.io) 가입 전에 코드가 먼저 배포돼도 무해해야 함

## Decision

**"봇 프로세스가 직접 송신하는 heartbeat + 외부 dead-man's-switch(healthchecks.io) 관측"으로 1차 방어선을 재구성하고, 기존 GitHub Actions 폴링은 2차 보조망으로 강등한다.**

핵심은 **핑 송신자를 GitHub Actions가 아니라 봇 프로세스 자체로** 옮기는 것이다. 봇은 상시 상주하며 node-cron으로 정확한 5분 주기를 돌릴 수 있어, Actions `schedule`의 스로틀링에 종속되지 않는다.

### 동작

봇 프로세스가 5분마다(node-cron, 인프라 레벨 상주 태스크):

1. **봇 self-health** — DB `SELECT 1` (기존 `GET /health`와 동일 의미론). 정상이면 `HC_PING_URL_BOT`으로 GET, 실패면 `HC_PING_URL_BOT + '/fail'`로 GET(즉시 알림)
2. **웹 health** — `WEB_HEALTH_URL`을 fetch → HTTP 200 + body에 `"ok": true` 포함 검증 (기존 `uptime-check.yml`과 동일 의미론). 정상이면 `HC_PING_URL_WEB`, 실패면 `+ '/fail'`

healthchecks.io는 이 ping이 **정해진 주기(권장 Period 5분, Grace 10\~15분) 안에 도착하지 않으면** 봇/VM이 내려간 것으로 보고 알림을 낸다. dead-man's-switch — "핑이 끊기는 것"이 곧 장애 신호다.

### 설계 포인트

- **세 env(`HC_PING_URL_BOT`·`HC_PING_URL_WEB`·`WEB_HEALTH_URL`)는 전부 선택적.** 미설정이면 부팅 로그 한 줄 남기고 완전 no-op → healthchecks.io 가입 전에 배포돼도 안전. `requireEnv` 사용 안 함.
- **인프라 레벨 태스크.** DB(`notification_settings`) 기반 Life Cron 슬롯이 아니다. 부팅 진입점(`src/app.ts`)에서 DB 프록시와 나란히 `node-cron`으로 직접 등록.
- **heartbeat는 어떤 경우에도 봇을 죽이지 않는다.** 모든 fetch에 타임아웃(\~10초) + try-catch. ping 전송 실패는 로그만 — 재시도 루프 없음(healthchecks.io grace가 흡수).
- **헬스 판정 로직 재사용.** 봇은 기존 `/health`의 DB ping을, 웹은 기존 폴링의 body 검증을 그대로 미러링 → 두 경로의 "정상" 정의가 어긋나지 않는다.

## Alternatives considered

### A. GitHub Actions를 그대로 송신자로 사용 (healthchecks.io만 추가)

- 장점: 기존 워크플로우 재사용, 봇 코드 변경 없음
- 단점: 송신 주기가 Actions `schedule` 스로틀링에 그대로 종속 → dead-man's-switch의 grace를 아무리 늘려도 "핑이 늦게 오는 것"과 "장애로 핑이 안 오는 것"을 구분 못 함
- 기각 이유: 스로틀링이 grace로 **전염**된다. 실효 주기가 수 시간인 송신자로는 짧은 감지 창을 만들 수 없음 — 문제의 원인을 그대로 끌고 감

### B. VM 호스트 crontab + curl로 healthchecks.io ping

- 장점: 봇 프로세스와 독립, 구현 단순
- 단점: 배포 파이프라인 바깥의 수동 인프라 — 서버에 직접 붙어 등록·유지해야 하고, 코드 리뷰·버전 관리 대상에서 벗어남. VM 프로비저닝을 다시 하면 재설정 누락 위험
- 기각 이유: "배포 파이프라인에 편승" 제약 위반. 봇 프로세스 송신이면 이미지 배포만으로 함께 굴러감

### C. Better Stack 등 SaaS의 능동 폴링(HTTP 모니터)

- 장점: 외부에서 능동적으로 헬스 엔드포인트를 찔러주므로 봇이 "정상인데 거짓 핑"을 보낼 여지가 없음. 무증상 실패 커버리지가 송신자 정직성에 의존하지 않음
- 단점: 무료 티어 정책 변동 리스크, 계정·대시보드 추가 관리. 능동 폴링도 결국 봇 self-health의 판정 깊이(DB ping 여부 등)까지는 못 봄
- 기각 이유: 차선. dead-man's-switch(수동 관측) 쪽이 비용·운영 부담이 더 낮고, "봇 프로세스가 살아서 스스로 헬스를 확인하고 송신한다"는 신호 자체가 더 강한 liveness 증거. 다만 능동 폴링의 무증상 실패 내성은 유효한 장점 — 향후 보완 후보로 남긴다

### D. 현상 수용 (ADR-0005 유지, 아무것도 바꾸지 않음)

- 장점: 작업 없음
- 단점: 실효 감지 주기가 수 시간에 머묾
- 기각 이유: 실측상 2차망만으로는 감지 창이 지나치게 넓음. 1차망 신설로 좁힐 여지가 명확

### E. 봇 heartbeat 송신 + 외부 dead-man 관측 + GH Actions 보조망 유지 (선택)

- 장점:
  - 정확한 5분 주기 (node-cron, 스로틀링 비종속)
  - 배포 파이프라인 편승 (이미지 배포로 함께 굴러감)
  - 외부 관측자가 대상 바깥에 위치 (VM 다운 시에도 healthchecks.io가 핑 부재를 감지)
  - 선택적 env → 점진 도입 안전
  - 기존 폴링을 보조망으로 남겨 이중화 (healthchecks.io 자체 장애 커버)
- 단점: 무증상 실패(봇이 살아있으나 헬스 판정이 거짓 양성) 커버리지가 self-health 정직성에 의존 → 헬스 판정 로직을 기존 엔드포인트와 동일하게 미러링해 완화

## Consequences

### 장점

- 봇/VM 다운 감지 창이 수 시간 → 수 분(권장 grace 10\~15분) 수준으로 축소
- 월 고정비 0원 유지 (healthchecks.io 무료 티어 범위)
- heartbeat 로직이 코드로 버전 관리 + 단위 테스트 대상
- 봇·웹 각각 독립 check → 어느 쪽 장애인지 분리 식별
- 외부 서비스 미가입 상태에서도 안전(no-op) → 배포와 설정 시점을 분리 가능

### 단점 / 제약

- **healthchecks.io 의존 추가** — 무료 티어 정책 변동 리스크. 완화: 기존 GitHub Actions 폴링을 2차 보조망으로 유지
- **무증상 실패는 여전히 한계** — 봇 프로세스는 살아있으나 헬스 판정이 실제 상태와 어긋나면 거짓 정상 핑 가능. 완화: 판정 의미론을 기존 헬스 엔드포인트와 일치. 능동 폴링(대안 C)이 필요해지면 재검토
- **모니터 자체 정지 시나리오** — healthchecks.io가 내려가면 dead-man 관측이 멈춘다. 완화: 2차망(GH Actions)이 별도 경로로 잔존

### 후속 작업

- [ ] healthchecks.io에 봇·웹 check 2개 생성 (권장 Period 5분 / Grace 10\~15분)
- [ ] 각 check의 ping URL을 VM `.env`에 `HC_PING_URL_BOT`·`HC_PING_URL_WEB`로 등록, `WEB_HEALTH_URL`도 함께 등록 → 재배포
- [ ] 한 달 운영 후: dead-man 오탐 빈도 점검, grace 튜닝 필요 시 재평가
- [ ] 무증상 실패 커버리지가 중요해지면 능동 폴링(Better Stack 등) 보완 검토

---

**참고**

- [ADR-0005](0005-uptime-monitoring-github-actions.md) — 본 ADR이 supersede (2차 보조망으로 강등)
- [GitHub Actions: Scheduled events](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule) — cron 정시성 미보장 명시
- [healthchecks.io](https://healthchecks.io/) — dead-man's-switch 모니터링
- Michael Nygard, *Documenting Architecture Decisions* (2011)
