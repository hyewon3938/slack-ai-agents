# 지출/예산 관리 (Budget)

> **상태**: v2 아키텍처 운영 중 (Phase 5 완료).

## DB 스키마

```sql
-- 지출 기록
expenses:
  id SERIAL PK,
  user_id INTEGER,
  date DATE,
  amount INTEGER,
  category TEXT,
  description TEXT,
  payment_method TEXT,
  is_installment BOOLEAN,
  installment_num INTEGER,
  installment_total INTEGER,
  installment_group TEXT,
  source TEXT,
  memo TEXT,
  type TEXT DEFAULT 'expense',         -- 'expense' | 'income'
  planned_expense_id INTEGER FK,
  exclude_from_budget BOOLEAN,
  distribute_to_budget BOOLEAN,
  created_at TIMESTAMPTZ

-- 고정비 템플릿
fixed_costs:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,
  amount INTEGER,
  category TEXT,
  is_variable BOOLEAN,
  day_of_month INTEGER,
  active BOOLEAN,
  memo TEXT,
  created_at TIMESTAMPTZ

-- 자산
assets:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,
  type TEXT,
  balance INTEGER,
  available_amount INTEGER,
  is_emergency BOOLEAN,
  memo TEXT,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ

-- 예산 설정 (목표 기간, 시작일)
budget_settings:
  id SERIAL PK,
  user_id INTEGER UNIQUE,
  target_date VARCHAR(7),              -- 'YYYY-MM'
  updated_at TIMESTAMPTZ

-- 예정 지출 (계획된 큰 지출)
planned_expenses:
  id SERIAL PK,
  user_id INTEGER,
  year_month VARCHAR(7),
  amount INTEGER,
  category TEXT,
  description TEXT,
  is_recurring BOOLEAN,
  created_at TIMESTAMPTZ

-- 일별 예산 로그 (cron 스냅샷)
daily_budget_logs:
  id SERIAL PK,
  user_id INTEGER,
  date DATE,
  billing_month VARCHAR(7),
  budget INTEGER,
  spent INTEGER,
  saved INTEGER,
  created_at TIMESTAMPTZ,
  UNIQUE(user_id, date)

-- 월별 예산 스냅샷 (과거 월 정산)
monthly_budget_snapshots:
  id SERIAL PK,
  user_id INTEGER,
  year_month VARCHAR(7),
  allocated_budget INTEGER,
  fixed_total INTEGER,
  installment_total INTEGER,
  planned_total INTEGER,
  flexible_spent INTEGER,
  excluded_spent INTEGER,
  income_total INTEGER,
  available_at_start INTEGER,
  available_at_end INTEGER,
  sealed_at TIMESTAMPTZ,
  UNIQUE(user_id, year_month)
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET/POST | `/api/expenses` | 지출 목록 / 지출 등록 |
| GET | `/api/expenses/summary` | 월간 요약 |
| PATCH/DELETE | `/api/expenses/[id]` | 지출 수정 / 삭제 |
| GET | `/api/budget/today` | 오늘 예산 할당 |
| GET | `/api/budget/monthly` | 월 예산 할당 |
| GET | `/api/budget/runway` | 런웨이 프로젝션 |
| GET/PUT | `/api/budget/settings` | 목표 기간 조회/설정 |
| GET | `/api/budget/assets` | 자산 현황 |
| PATCH | `/api/budget/assets/[id]` | 자산 잔액 수정 |
| GET | `/api/budget/fixed-costs` | 고정비 목록 |
| GET | `/api/budget/daily-logs` | 일별 예산 로그 |
| GET/POST | `/api/budget/planned-expenses` | 예정 지출 목록 / 등록 |
| DELETE | `/api/budget/planned-expenses/[id]` | 예정 지출 삭제 |
| GET | `/api/cron/daily-budget-log` | 일별 스냅샷 cron (내부용) |

## 코드 구조

```
features/budget/
├── components/
│   ├── budget-tab.tsx              # 탭 진입점
│   ├── budget-overview.tsx         # 월 개요 (달력 + 요약)
│   ├── expense-list.tsx            # 지출 목록
│   ├── expense-form.tsx            # 지출 등록/수정 폼
│   ├── month-summary.tsx           # 월간 요약 카드
│   ├── runway-card.tsx             # 런웨이 시뮬레이션 카드
│   ├── budget-settings-page.tsx    # 예산 설정 탭
│   └── ...
├── hooks/
│   └── use-budget.ts               # 상태 관리 + CRUD
└── lib/
    ├── types.ts                    # 타입 정의
    ├── queries.ts                  # DB 쿼리 (지출 CRUD, 요약, 로그)
    ├── facade.ts                   # v2 통합 인터페이스
    ├── allocator/                  # 순수 계산 함수
    │   ├── day-allocator.ts        # 일일 예산 배분
    │   ├── month-allocator.ts      # 월별 예산 배분
    │   ├── runway-projection.ts    # 런웨이 시뮬레이션
    │   ├── runway-warn.ts          # 런웨이 단축 경고
    │   └── proration.ts            # 당월 잔여 일수 계산
    ├── billing/                    # 결제주기 유틸리티
    │   ├── cycle.ts                # 빌링 월/범위/일수 계산
    │   └── snapshot-date.ts        # cron 드리프트 보정
    └── repository/                 # DB 읽기/쓰기 레이어
        ├── expenses-repo.ts
        ├── assets-repo.ts
        ├── fixed-costs-repo.ts
        ├── planned-repo.ts
        └── settings-repo.ts
```

## 핵심 로직

- **카드 결제주기 기반**: 전월 16일 \~ 당월 15일을 한 달로 계산
- **동적 일일 예산**: (월 자유 예산 \- 이번 달 자유 지출) / 남은 일수
- **런웨이 시뮬레이션**: 월별 고정비 + 할부 + 예정지출을 차감해 가용자금 소진 시점 예측
- **자동 월 예산 배분**: 가용자금을 목표 기간까지 균등 분배
- **Vercel cron 드리프트 보정**: 발화 시각에서 1시간 버퍼 차감 후 KST 날짜 결정
- **3개월 평균 변동 지출**: 런웨이 기준 수치 (참고용)

## 관련 Slack 에이전트

- **채널**: #money
- **에이전트**: money 에이전트 (SQL 도구 기반, 지출 기록 + 분석)

## 비공개 참고

> **Claude 필수 행동**: 지출/예산 기능 작업 시 `docs/_personal/budget-internal.md` (gitignored)를 반드시 읽을 것.
> 실제 기능 의도, 공개 표현 치환표, 런웨이 계산 상세 로직이 기록되어 있다.
> 이 문서(budget.md)에는 포트폴리오용 기능 설명만 기록하며, 개인 재정 데이터는 포함하지 않는다.
