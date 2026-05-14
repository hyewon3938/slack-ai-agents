# 0015. 자산 자동 차감 정책 — 결제주기 종료 cron + 할부 미래 회차 즉시 반영

- Status: Accepted
- Date: 2026-05-14
- Related: #397
- Tags: data, budget

## Context

결제주기 동안 누적된 자유지출이 자산에 반영되지 않아 새 사이클 시작 시 일 예산 권장값이 점프하는 문제가 발생했다.

- `computeTotalAvailable`이 자산 합계를 그대로 반환 → 결제주기 동안 누적 지출이 자산에 미반영
- 새 결제주기 시작 시 가용자금이 그대로 남아 일 예산 권장값이 갑자기 커짐 (사용자 체감 문제)
- `monthly_budget_snapshots.available_at_end`는 계산만 되고 가용자금 산출에 미사용 (사실상 데드 스토리지)
- ADR 0008의 일 예산 이중화 모델(`todayBudget` vs `todayRecommended`)은 "사이클 도중 자산이 흔들리지 않음"을 전제

자산은 사용자 수동 갱신 전제로만 동작했기 때문에, 사용자가 매 결제주기 종료마다 직접 자산을 깎아야 했고, 이 작업을 빠뜨리면 다음 사이클 권장값이 신뢰할 수 없게 된다.

## Decision

결제주기 종료 cron에서 이전 사이클 자유+제외 지출을 default 자산에서 차감, 수입은 증액. 할부 2+회차는 INSERT 즉시 자산 차감하고, allocator의 `installmentSum`에서 미래 회차를 제외(수학적 동등 유지).

### 자산 변동 시점

| 항목 | 자산 변동 시점 | 비고 |
|------|---------------|------|
| 일반 자유지출 (`exclude_from_budget=false`) | 결제주기 종료 cron | `runSettlementIfDue`에서 일괄 |
| 제외지출 (`exclude_from_budget=true`) | 결제주기 종료 cron | 동일 합산 |
| 수입 (`type='income'`) | 결제주기 종료 cron | 증액 방향 |
| 할부 1회차 (현재 결제주기) | 변동 없음 | `totalLocked`로 monthBudget에 반영 |
| 할부 2+회차 (미래 결제주기) | INSERT 즉시 차감 | `installmentSum`에서 제외 |

### Default 자산 + cascading fallback

- `assets.is_default=true` 자산을 차감 우선순위 1순위
- 부족 시 `is_emergency=false`인 다른 자산으로 cascade (`available_amount` 내림차순)
- 마지막 fallback 자산은 음수 허용 (마이너스 통장 의미상)
- 증액(수입)은 default 자산에만 단순 증액 (분배 불필요)
- `balance`는 건드리지 않음 — 실제 계좌 잔액은 사용자가 가끔 직접 갱신, `available_amount`만 변동

### 이중 차감 회피 — `installmentSum` 미래 회차 제외

자산 100, 3개월 3만원 할부 케이스:
- 기존: `totalAvailable=100, totalLocked=9, totalFree=91`
- 신규: `totalAvailable=94(자산-6), totalLocked=3(1회차만), totalFree=91` ✅

수학적 동등성 유지되어 monthBudget 계산은 변하지 않음. 사용자 멘탈 모델만 "자산이 즉시 줄어듦"으로 직관적이 됨.

### Idempotency

`saveSnapshotIfAbsent`가 `UNIQUE(user_id, year_month)` 제약으로 중복 저장을 차단. 자산 변동도 `saveSnapshotIfAbsent.saved === true`일 때만 실행하므로 같은 yearMonth에 cron이 재실행되어도 자산 재차감 없음.

## Alternatives considered

### A. 수동 갱신 + 알림 강화

- 장점: 코드 변경 최소, 기존 모델 유지
- 단점: 사용자가 결제주기 종료마다 직접 자산을 깎아야 함. 누락 위험 + 인지 부하
- 기각 이유: 자동화 가능한 작업을 사용자에게 떠넘기는 것은 알림으로도 본질적 해결 안 됨

### B. snapshot 기반 동적 계산 (`available_at_end + 누적 변화`)

- 장점: 자산 테이블은 사용자 수동 갱신값으로 보존, 가용자금은 계산값
- 단점: 자산 테이블과 가용자금 표시가 분리되어 사용자 멘탈 모델과 충돌. "자산은 100인데 가용자금은 94" 같은 표시 차이를 매번 설명해야 함
- 기각 이유: 사용자가 자산 화면을 봤을 때 "내가 쓸 수 있는 돈"이 바로 보여야 한다는 직관과 충돌

### C. (선택) 자동 차감 + cascading fallback

- 장점: 자산 = 가용자금 직관 유지. 결제주기 단위 cron 처리로 ADR 0008의 base 안정성 보존. 할부 미래 회차도 시각화됨
- 단점: 자산 자동 변동과 사용자 수동 갱신이 충돌할 여지 (사용자가 보정 필요할 수 있음)

## Consequences

### 장점

- 사용자가 별도 갱신 없이 가용자금 자동 추적
- 결제주기 전환 시 일 예산 권장값 점프 문제 해소
- 할부 미래 회차가 자산에 즉시 반영되어 "쓸 수 있는 돈" 직관 정확
- ADR 0008의 일 예산 이중화 모델(base 안정성) 보존

### 단점 / 제약

- 자산 자동 변동 ↔ 사용자 수동 갱신이 충돌할 여지 (사용자가 가끔 실잔액 보정 필요)
- 할부 amount 수정/삭제 시 자산 재조정 로직이 분산됨 (createInstallmentExpenses / updateExpense / deleteExpense 세 곳)
- DB Proxy API 구조상 트랜잭션 보장이 없어 idempotency를 `saveSnapshotIfAbsent`의 UNIQUE 제약에 의존

### 후속 작업

- [ ] 자동 변동 이력 감사 로그 (운영 중 의문 발생 시 추가)
- [ ] 할부 1회차 `isNew` 경계 처리 검증 (allocator 테스트)
- [ ] 기존 할부 잔여 회차 backfill 스크립트 운영 환경 1회 실행
- [ ] default 자산 시드 SQL 운영 환경 적용

---

**참고 자료**

- ADR 0007 — 자유지출 정의 통일
- ADR 0008 — 일 예산 산정 모델 이중화
- ADR 0009 — 일별 로그 평가 기준
- ADR 0010 — 일별 예산 로그 cron 스케줄
