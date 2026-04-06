# 명리학 인사이트 (Insight)

## DB 스키마

```sql
-- 사주 프로필
saju_profiles:
  id SERIAL PK,
  user_id INTEGER,
  year_pillar TEXT,
  month_pillar TEXT,
  day_pillar TEXT,
  hour_pillar TEXT,
  gender TEXT,
  daewun_start_age INTEGER,
  daewun_direction TEXT,
  daewun_list JSONB,
  gyeokguk TEXT,         -- 격국
  yongshin TEXT,         -- 용신
  strength TEXT,         -- '신강' | '중화' | '신약'
  heeshin TEXT,          -- 희신
  gishin TEXT,           -- 기신
  hanshin TEXT,          -- 한신
  profile_summary TEXT,
  birth_date DATE,
  birth_time TIME,
  created_at TIMESTAMPTZ

-- 운세 분석
fortune_analyses:
  id SERIAL PK,
  user_id INTEGER,
  date DATE,
  period TEXT,           -- 'daily' | 'monthly' | 'yearly' | 'major'
  day_pillar TEXT,
  month_pillar TEXT,
  year_pillar TEXT,
  analysis TEXT,         -- 분석 본문
  summary TEXT,
  warnings JSONB,
  recommendations JSONB,
  advice TEXT,
  model TEXT,            -- 분석에 사용된 LLM 모델
  created_at TIMESTAMPTZ,
  UNIQUE(user_id, date, period)

-- 일기
diary_entries:
  id SERIAL PK,
  user_id INTEGER,
  date DATE UNIQUE,      -- 날짜당 1개 (누적 방식)
  content TEXT,          -- 줄바꿈으로 append
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ

-- 삶의 테마/고민
life_themes:
  id SERIAL PK,
  user_id INTEGER,
  theme TEXT,
  category TEXT,         -- career/family/romance/health/finance/기타
  detail TEXT,           -- 상세 상황 (자동 진화)
  active BOOLEAN,
  source TEXT,           -- 'user' | 'auto'
  first_mentioned TIMESTAMPTZ,
  mention_count INTEGER,
  created_at TIMESTAMPTZ

-- 사주 패턴 (일기 x 일운 상관 분석)
saju_patterns:
  id SERIAL PK,
  user_id INTEGER,
  pattern_type TEXT,     -- 'sipsin' | 'ganji' | 'relation' | 'sibiunsung'
  trigger_element TEXT,
  description TEXT,
  evidence JSONB,
  active BOOLEAN,
  detection_count INTEGER,
  first_detected TIMESTAMPTZ,
  last_detected TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  source TEXT,           -- 'auto' | 'user'
  confidence TEXT,       -- 'high' | 'medium' | 'low'
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
```

## Slack 채널 + 에이전트

- **채널**: #insight
- **에이전트**: insight 에이전트 (`src/agents/insight/`)
- **LLM**: Claude Sonnet (대화), Gemini (운세 분석 생성용, 크론)
- **SQL 도구 기반**: query_db, modify_db, get_schema

## 핵심 로직

### 1. 운세 조회 (Fast Path)
정규식 매칭으로 LLM 바이패스, DB 직접 조회 후 즉시 응답:
- `일운` / `오늘 일운` -> period='daily', date=오늘
- `내일 일운` -> period='daily', date=내일
- `월운` / `이번 달 월운` -> period='monthly', date=해당 월 1일
- `세운` / `올해 세운` -> period='yearly', date=해당 년 1월 1일
- `대운` -> period='major', ORDER BY date DESC LIMIT 1

### 2. 일기 자동 저장
- 사용자 메시지가 일기/감정/이벤트 성격이면 `diary_entries`에 자동 저장
- 같은 날짜에 이미 기록 있으면 기존 content에 줄바꿸으로 append (중복 제거)
- 저장 시 사주 해석을 일기 내용에 추가하지 않음 (사용자 원문만 정리)
- 저장 알림 없이 자연스럽게 대화하면서 조용히 기록

### 3. 삶의 테마 관리 (life_themes)
- 사용자 요청 또는 일기에서 반복 감지 시 자동 추가 (source='auto')
- category: career / family / romance / health / finance / 기타
- **detail 자동 진화**: 일기/대화에서 상황 변화 감지 시 detail 업데이트
- 해결 시 `active = false`

### 4. 사주 패턴 (saju_patterns)
- 월간 자동 분석(Opus)으로 감지, 사용자 수동 관리 가능
- pattern_type: sipsin(십신) / ganji(특정 글자) / relation(합/형/충) / sibiunsung(십이운성)
- 감지 횟수 추적 (detection_count), 신뢰도 평가 (confidence)
- 비활성화 시 `active = false`, `deactivated_at = NOW()`

### 5. 시스템 프롬프트 구성
`buildInsightSystemPrompt()`가 실시간으로 아래 데이터를 로드하여 프롬프트에 주입:
- 활성 life_themes (현재 삶의 맥락)
- 활성 saju_patterns (확인된 개인 패턴)
- 오늘/내일 fortune_analyses (일운 컨텍스트)
- 십성 매핑표, 오행 상생상극, 사용자 원국 정보 (정적)

### 6. 일기 응답 시 사주 연결 규칙
- 일기 날짜 = 오늘: 프롬프트에 로드된 오늘 일운 사용
- 일기 날짜 != 오늘: fortune_analyses에서 해당 날짜 조회 후 사용
- 일운 데이터 없으면 사주 해석 없이 공감 위주 응답
- 독립적 오행/십성 분석 금지 (fortune_analyses 기반만)

### 7. 대화 히스토리
- `ChatHistory` 클래스로 채널별 대화 기록 유지
- LLM 에이전트 루프에 이전 대화 맥락 전달

## 파일 구조

```
src/agents/insight/
├── index.ts    # 에이전트 생성, fast path 패턴 매칭, LLM 에이전트 루프
├── prompt.ts   # 시스템 프롬프트 빌더 (DB 데이터 실시간 로드)
├── actions.ts  # 인터랙티브 버튼 핸들러
└── blocks.ts   # Slack Block Kit 메시지 빌더
```
