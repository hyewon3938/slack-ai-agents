# 0010. 일별 예산 로그 cron 시각 — KST 새벽 5시 + 전일 스냅샷

- Status: Accepted
- Date: 2026-05-07
- Related: #380
- Tags: infra, data, process

## Context

`daily-budget-log` Vercel cron이 KST 23:50에 발화해 발화 당일 데이터를 저장하는 구조였다. 두 가지 약점이 누적됐다.

1. **발화 당일 마지막 10분 지출 누락** — 23:50 시점에 그날을 닫으니 23:50~24:00 사이 입력은 빠진다.
2. **자정 슬롯 부하 + 배포 충돌로 cron 스킵 발생** — Vercel cron은 best-effort 스케줄링이며, 자정 근처 슬롯은 글로벌 부하가 높고 배포 진행 중 슬롯이 통과하면 누락된다. 실제 누락 사례 발생.

모닝 크론(node-cron, KST 09:05)에 백필 안전망이 있어 데이터 공백은 막았으나, 근본 개선이 필요했다.

또한 기존 `resolveSnapshotDate(now, driftBufferMs)` 함수는 "발화 당일에서 N시간 차감 후 KST 변환"이라는 모호한 시맨틱이라, 호출 시점만 봐서는 어느 날짜가 저장되는지 즉시 읽히지 않았다.

## Decision

**cron 시각**: KST 05:00 (UTC 20:00, `0 20 * * *`)
**저장 대상**: 발화 시각 기준 **전일** KST 날짜
**날짜 계산 함수**: `resolveSnapshotDate` → `resolvePreviousDayDate` 로 시맨틱 명시 변경

```typescript
export function resolvePreviousDayDate(nowUtc: Date): string {
  const kstMs = nowUtc.getTime() + 9 * 3_600_000;
  const previousDayMs = kstMs - 24 * 3_600_000;
  const kst = new Date(previousDayMs);
  // ... YYYY-MM-DD 반환
}
```

`web/vercel.json`:

```json
{ "path": "/api/cron/daily-budget-log", "schedule": "0 20 * * *" }
```

## Alternatives considered

### A. 발화 시각 유지 + 드리프트 버퍼 확대

- 장점: 코드 변경 최소
- 단점: 자정 슬롯 부하·배포 충돌 문제 미해결. 함수 시맨틱이 여전히 모호("발화 당일에서 N시간 차감")
- 기각 이유: 운영 약점은 그대로

### B. 새벽 5시 + "전일 스냅샷" 명시 시맨틱 (선택)

- 장점:
  - 자정 슬롯 회피 → cron 누락률 감소
  - 데이터 finalized 후 산정 → 마지막 10분 누락 해소
  - 함수 의도("전일")가 시그니처에 명시 → 향후 cron 시각을 다시 옮겨도 안전
- 단점: 호출부·테스트 전면 재작성 필요 (소규모, 1회성)

### C. 외부 모니터링 + 알림으로만 처리

- 장점: cron 시각·로직 변경 불필요
- 단점: 누락 자체는 여전히 발생, 추가 인프라 의존
- 기각 이유: 근본 개선이 아님

## Consequences

### 장점

- Vercel cron 누락률 감소 (자정 슬롯 회피)
- 발화 당일 마지막 10분 누락 해소
- 함수 시그니처가 의도를 표현 → 미래 변경 시 안전성 확보

### 단점 / 제약

- KST 자정~05:00 사이 cron이 누락되면 09:05 모닝 백필까지 4시간 지연 (기존 9시간보다 짧으니 개선)
- 모든 호출부·테스트가 새 시맨틱에 맞춰 갱신돼야 함

### 후속 작업

- [ ] PR 머지 후 다음 발화(다음날 05:00) 정상 동작 확인
- [ ] 다른 Vercel cron(`monthly-settlement` 등) 추가 시 동일 패턴 검토
