# 루틴 관리 (Routine)

## DB 스키마

```sql
-- 루틴 템플릿
routine_templates:
  id SERIAL PK,
  user_id INTEGER,
  name TEXT,
  time_slot TEXT,        -- '낮' | '밤'
  frequency TEXT,        -- '매일' | '격일' | '3일마다' | '주1회'
  active BOOLEAN,
  deleted_at TIMESTAMPTZ,  -- soft delete
  created_at TIMESTAMPTZ

-- 루틴 일별 기록
routine_records:
  id SERIAL PK,
  user_id INTEGER,
  template_id INTEGER FK -> routine_templates.id,
  date DATE,
  completed BOOLEAN,
  completed_at TIMESTAMPTZ,  -- 완료 시점
  memo TEXT,
  created_at TIMESTAMPTZ
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/routines` | 템플릿 목록 조회 (deleted_at IS NULL) |
| POST | `/api/routines` | 템플릿 생성 |
| PATCH | `/api/routines/[id]` | 템플릿 수정 (name, time_slot, frequency, active) |
| DELETE | `/api/routines/[id]` | 템플릿 삭제 (soft delete: active=false + deleted_at=NOW()) |
| GET | `/api/routines/records?date=` | 날짜별 기록 조회 (템플릿 JOIN) |
| PATCH | `/api/routines/records/[id]` | 기록 토글 (completed) 또는 메모 수정 |
| GET | `/api/routines/stats?from=&to=` | 기간별 달성률 통계 |

## 웹 컴포넌트 구조

```
features/routine/
├── components/
│   ├── routine-page.tsx          # 메인 페이지 (뷰 전환)
│   ├── routine-checklist.tsx     # 일별 체크리스트 (메인 뷰)
│   ├── routine-stats.tsx         # 통계 뷰 (기간별 + 루틴별 달성률)
│   ├── routine-list.tsx          # 템플릿 관리 뷰
│   ├── routine-card.tsx          # 루틴 카드 UI
│   ├── routine-form.tsx          # 템플릿 생성/수정 폼
│   ├── routine-record-detail.tsx # 기록 상세 (메모 편집)
│   ├── date-nav.tsx              # 날짜 네비게이션 (이전/오늘/다음)
│   ├── view-toggle.tsx           # 뷰 전환 (checklist/stats/manage)
│   ├── monthly-heatmap.tsx       # 월간 히트맵
│   └── yearly-heatmap.tsx        # 연간 히트맵 (GitHub 스타일)
├── hooks/
│   └── use-routines.ts           # 상태 관리 + CRUD + 폴링
└── lib/
    ├── types.ts                  # RoutineTemplateRow, RoutineRecordRow, 통계 타입
    └── queries.ts                # 서버 사이드 DB 쿼리
```

## 핵심 로직

### 빈도(Frequency) 시스템
- `매일`: 매일 기록 생성
- `격일`: 2일 간격
- `3일마다`: 3일 간격
- `주1회`: 7일 간격
- 빈도 판별: `shouldCreateToday()` — 마지막 기록 날짜와 비교하여 오늘 생성 여부 결정
- 간격 파싱: `parseIntervalDays()` — '격일' -> 2, 'N일마다' -> N

### 자동 기록 생성 (ensureTodayRecords)
- 웹 접속 시 또는 API 호출 시, 해당 날짜에 아직 기록이 없는 active 템플릿에 대해 자동 생성
- 빈도에 따라 생성 여부 결정 (매일이 아닌 루틴은 간격 확인)
- soft delete된 템플릿(deleted_at IS NOT NULL)은 제외

### 히트맵
- **월간 히트맵**: 달성률 기반 색상 표시
- **연간 히트맵**: GitHub contribution 스타일, 최근 365일 데이터

### 통계
- **일별 달성률**: `RoutineDayStat` — date별 total/completed/rate
- **루틴별 달성률**: `RoutinePerStat` — 템플릿별 total/completed/rate/days_active
  - 전체 기간: active 루틴만 표시
  - 기간 선택: 비활성 포함 (해당 기간에 기록이 있으면)
  - `days_active`: 생성일 이후 경과 일수

### 뷰 모드
- `checklist`: 일별 체크리스트 (기본 뷰)
- `stats`: 달성률 통계 + 히트맵
- `manage`: 템플릿 생성/수정/삭제

### Optimistic Update
- 체크리스트 토글 시 즉시 UI 반영 (`mutatingRef`로 폴링 충돌 방지)
- 실패 시 원복

### 폴링
- 15초 간격 (탭 활성 시)
- `mutatingRef`: 진행 중인 mutation이 있으면 폴링 응답 무시

### Soft Delete
- 템플릿 삭제 시 `active = false`, `deleted_at = NOW()`
- `deleted_at IS NULL` 조건으로 조회에서 제외
- 기존 기록은 보존 (통계에서 확인 가능)

## 관련 Slack 에이전트

- **채널**: #life
- **에이전트**: life 에이전트가 루틴 CRUD + 완료 처리
- **크론**:
  - 09:05 — 낮 루틴 체크리스트
  - 23:55 — 밤 루틴 + 하루 종합 리뷰
- **달성률 분석 규칙**:
  - `routine_templates.created_at` 확인 필수: 생성일 이전 기간은 달성률 계산에서 제외
  - SQL 조건: `AND r.date >= t.created_at::date`
- **루틴 메모**: `routine_records.memo` — Slack에서 메모 추가/수정 가능
