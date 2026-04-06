# 지출/예산 관리 (Budget)

> **상태**: 기능 브랜치에서 개발 중 (main 미병합). 이 문서는 설계 기반 스켈레톤.

## DB 스키마

```sql
-- 지출 기록
expenses:
  id SERIAL PK,
  user_id INTEGER,
  date DATE,
  amount INTEGER,        -- 원 단위
  category TEXT,         -- 식비, 교통비, 문화생활 등
  description TEXT,
  payment_method TEXT,   -- 카드, 현금, 이체 등
  is_fixed BOOLEAN,      -- 고정비 여부
  created_at TIMESTAMPTZ

-- 고정비 템플릿
fixed_costs:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,
  amount INTEGER,
  category TEXT,
  billing_day INTEGER,   -- 매월 결제일
  active BOOLEAN,
  created_at TIMESTAMPTZ

-- 고정비 월별 기록
fixed_cost_records:
  id SERIAL PK,
  user_id INTEGER,
  fixed_cost_id INTEGER FK,
  date DATE,
  amount INTEGER,
  paid BOOLEAN,
  created_at TIMESTAMPTZ

-- 월간 예산
budgets:
  id SERIAL PK,
  user_id INTEGER,
  year_month TEXT,       -- '2026-04'
  total_budget INTEGER,
  category_budgets JSONB,  -- { "식비": 300000, "교통비": 100000, ... }
  created_at TIMESTAMPTZ

-- 자산
assets:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,
  type TEXT,             -- 예금, 투자, 부채 등
  amount INTEGER,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ

-- 수입
incomes:
  id SERIAL PK,
  user_id INTEGER,
  date DATE,
  amount INTEGER,
  source TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ
```

> 위 스키마는 설계 기반 예상. 실제 마이그레이션 파일이 main에 병합되면 업데이트 필요.

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET/POST | `/api/expenses` | 지출 목록 조회 / 지출 등록 |
| PATCH/DELETE | `/api/expenses/[id]` | 지출 수정 / 삭제 |
| GET | `/api/budget` | 월간 예산 조회 |
| PUT | `/api/budget` | 월간 예산 설정 |
| GET | `/api/budget/assets` | 자산 현황 조회 |
| GET | `/api/budget/runway` | 지출 분석 |

## 웹 컴포넌트 구조

```
features/budget/
├── components/
│   ├── expense-list.tsx        # 지출 목록
│   ├── expense-form.tsx        # 지출 등록/수정 폼
│   ├── budget-overview.tsx     # 월간 예산 대비 지출 현황
│   ├── category-chart.tsx      # 카테고리별 지출 차트
│   └── fixed-cost-list.tsx     # 고정비 관리
├── hooks/
│   └── use-budget.ts           # 상태 관리 + CRUD
└── lib/
    ├── types.ts                # 타입 정의
    └── queries.ts              # 서버 사이드 DB 쿼리
```

## 핵심 로직

- **카테고리별 지출 분석**: 월간 카테고리별 지출 합계 + 예산 대비 비율
- **월간 예산 대비 지출 추적**: 전체 예산 + 카테고리별 예산 설정, 초과 시 알림
- **고정비 vs 변동비 분리**: 고정비 템플릿으로 매월 자동 생성, 변동비는 수동 입력
- **지출 분석**: 자산 대비 월 평균 지출 추이 분석

## 관련 Slack 에이전트

- **채널**: #money (예정)
- **에이전트**: money 에이전트 (SQL 도구 기반, 지출 기록 + 분석)
- **크론**: 월초 지출 리포트, 예산 초과 알림 (예정)

## 비공개 참고

> **Claude 필수 행동**: 지출/예산 기능 작업 시 `docs/budget-internal.md` (gitignored)를 반드시 읽을 것.
> 실제 기능 의도, 공개 표현 치환표, 런웨이 계산 상세 로직이 기록되어 있다.
> 이 문서(budget.md)에는 포트폴리오용 기능 설명만 기록하며, 개인 재정 데이터는 포함하지 않는다.
