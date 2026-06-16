# 0018. 할부 자산 차감 범위 토글 — `distribute_to_runway` 분기

- Status: Superseded by ADR 0051
- Date: 2026-05-20
- Related: #411
- Tags: data, budget

## Context

ADR 0015는 "자산 표시값 = 즉시 쓸 수 있는 돈" 직관을 우선해 할부 2+회차를 INSERT 즉시 자산에서 차감하는 정책을 채택했다. 이 정책은 대부분의 할부(카드 3~6개월 등)에서 잘 작동하지만, **목표 기간(target_date)을 넘어가는 할부**에서는 사용자 의도와 충돌한다.

구체 케이스 (예시):
- 목표 기간이 N개월 후로 설정된 상태
- 12개월 분할 할부 입력 — 사용자 의도: "분산 = 월 자금 부담 완화"
- 현재 동작: INSERT 시 2~12회차 전부 즉시 자산 차감 → 목표 기간까지의 자유 예산이 11개월치 회차분만큼 줄어든 상태로 분배 → 사용자 의도("목표 기간 이후 회차는 그때 갚을 자금")와 정반대

목표 기간 이후로 결제가 이어지는 할부에서 "사용자 의도(미래 자금으로 갚을 예정)"와 "기본 정책(즉시 전체 차감)" 사이 분기가 필요하다.

## Decision

ADR 0015 정책은 **default로 유지**하고, 할부 입력 시 사용자가 명시적으로 OFF할 수 있는 `distribute_to_runway` 토글을 추가한다.

### 토글 의미

| 값 | 동작 |
|----|------|
| `true` (default) | 2~마지막 회차 전부 INSERT 즉시 자산 차감 (= ADR 0015 그대로) |
| `false` | 2회차부터 target_date 이내 회차만 자산 차감. target_date 이후 회차는 자산 무영향 — 각 결제주기 종료 cron에서 자유지출로 처리 |

> 1회차는 토글과 무관 — 항상 현재 결제주기의 자유지출로 잡혀 결제주기 종료 cron에서 정산.

### 토글 노출 조건 — 조건부

할부 입력 폼에서 토글은 **마지막 회차의 결제월(billing_month)이 target_date보다 큰 경우에만** 노출. 같거나 작으면 ON/OFF 동작 동일이라 사용자에게 의미 없는 선택 강요 X.

```ts
// 노출 조건 (pseudocode)
const lastInstallmentBillingMonth = computeLastInstallmentBillingMonth(date, months, paymentMethod);
const showToggle = lastInstallmentBillingMonth > targetDate;
```

### target_date 변경 시 — 자동 재계산 + 변경 직전 안내

사용자가 budget settings에서 target_date를 변경하면:
1. 변경 직전 모달 — 영향받는 OFF 할부 X개, 자산 차감 변화 ±Y원 안내
2. 사용자 확인 시 OFF 할부 전부 순회하며 자산 보정
   - target 늘어남 → 새 범위 안에 들어온 회차분 추가 차감
   - target 줄어듦 → 새 범위 밖으로 나간 회차분 환원

### 회차별 settled 상태 — 새 컬럼 없이 결제주기 기반 계산

토글 사후 변경 / target_date 변경 시 보정 대상은 **"현재 결제주기 시점에서 아직 정산 안 된 미래 회차"** = `installment_num >= 2 AND billing_month > 현재_billing_month`. 추가 컬럼 없이 기존 `isFutureInstallment` 로직 + `billing_month > target_date` 조건만으로 식별.

### 사용자 의도 기록

`expenses.distribute_to_runway` 컬럼은 사용자가 명시적으로 OFF한 케이스만 false. INSERT 시점에 토글이 노출되지 않은 경우(=마지막 회차 ≤ target_date) default true로 저장. 향후 사용자가 의도 분석 / 회고할 때 "이 할부는 분산 의도였는지" 명확히 기록됨.

## Alternatives considered

### A. 자동 보정 (옵션 A) — target 이후 회차분을 allocator 입력 단계에서 환원

- 장점: 사용자 액션 0. 모든 할부에 일괄 적용. ADR 0015 자산 차감 정책 그대로
- 단점: 사용자 의도가 케이스마다 다를 수 있음 ("이 큰 할부는 그냥 미리 다 빼놓을게" vs "이건 분산 부담 완화") — 자동 보정은 이 차이를 표현 못 함. 자산 카드 값과 allocator 계산값 사이 의미 분기 발생 → 사용자에게 매번 설명 필요
- 기각 이유: 사용자가 의식적으로 할부 분산 의도를 결정한 케이스가 있는 만큼, 시스템이 자동 판정하기보다 명시적 선택을 받는 게 의도 기록과 시스템 일관성에 유리

### B. 자산 차감 정책 자체를 결제주기 cron 시점으로 변경

- 장점: 자연스러운 회계 모델 — 매 결제주기마다 그 회차분이 자산에서 차감
- 단점: ADR 0015 핵심 결정("자산 = 즉시 쓸 수 있는 돈" 직관) 정면 뒤집기. "큰 할부를 걸었는데 자산은 1회차분만 빠짐" 사용자 멘탈 모델 충돌. 결제주기 cron 누락 시 사용자가 갑자기 자산이 안 맞는다고 느낌
- 기각 이유: ADR 0015의 직관을 약화시키는 변경. 케이스마다 의도가 다른 문제를 더 큰 정책 변경으로 푸는 건 비례 안 맞음

### C. (선택) `distribute_to_runway` 토글 + default true (현재 동작 유지)

- 장점:
  - ADR 0015 정책 약화 없음 — 보완 ADR이 정책을 **그대로 두고** 분기만 추가
  - OFF가 100% 명시 의도 → DB에 사용자 결정 기록
  - target 변경 시 자동 재계산 정책이 "내가 OFF했으니까"로 자연스럽게 납득
- 단점:
  - 사용자가 큰 할부마다 OFF 선택 (액션 1회 추가)
  - 자산 보정 로직이 분산되는 ADR 0015 단점이 약간 더 늘어남 (createInstallment / updateExpense / deleteExpense + target_date 변경 보정)

### D. 자동 판정 (마지막 회차가 target 넘으면 자동 OFF)

- 장점: 사용자 선택 0
- 단점: "큰 할부도 전부 미리 차감하고 싶다"는 의도일 때 우회 불가. 자동 판정 결과를 사용자가 인지하지 못함 → "왜 자산이 다르게 빠졌지?" 혼란
- 기각 이유: 의도 분기를 시스템이 강제하는 건 사용자 결정권 침해

### E. 사후 PATCH 불가 — 토글은 INSERT 시점에만 결정

- 장점: 자산 보정 로직 단순화 (생성/삭제만 보정)
- 단점: 사용자가 잘못 입력 시 DELETE → 재INSERT 부담
- 기각 이유: 12개월 할부 같은 큰 거래를 잘못 입력하면 사용자 부담 큼. 보정 로직 복잡도는 결제주기 기반 계산으로 흡수 가능

## Consequences

### 장점

- 사용자 의도가 시스템에 명시적으로 기록됨 (`distribute_to_runway` 컬럼)
- ADR 0015 핵심 원칙("자산 = 즉시 쓸 수 있는 돈") 유지 — default 동작 그대로
- target_date 변경 시 자동 재계산이 사용자 명시 OFF에만 적용되어 의도 일관성
- 조건부 노출로 의미 없는 선택 강요 X (마지막 회차 ≤ target_date면 토글 숨김)

### 단점 / 제약

- 자산 보정 로직 분산이 3곳(create/update/delete) → 4곳(+ target_date 변경 보정)으로 늘어남
- 토글 사후 변경 시 결제주기 경계 타이밍 이슈 가능 — 결제주기 종료 cron 직전/직후 PATCH 시 미세한 회차 분류 차이 발생 가능 (월 단위 비교라 영향 작음)
- 마이그레이션 1번 (`distribute_to_runway` 컬럼 추가, default true)

### 후속 작업

- [ ] DB 마이그레이션 작성 (`distribute_to_runway BOOLEAN DEFAULT true`)
- [ ] 자산 보정 로직 단위 테스트 (toggle ON→OFF, OFF→ON, target_date 변경)
- [ ] expense-form 조건부 노출 경계 테스트 (마지막 회차 = target_date 인 경우)
- [ ] budget settings의 target_date 변경 모달 UX 검증 (영향 범위 안내 정확도)

---

**참고 자료**

- ADR 0007 — 자유지출 정의 통일
- ADR 0015 — 자산 자동 차감 정책 (본 ADR의 보완 대상)
