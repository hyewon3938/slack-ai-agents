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

-- 사주 패턴 (cross-domain x 일운 상관 분석)
saju_patterns:
  id SERIAL PK,
  user_id INTEGER,
  pattern_type TEXT,     -- 'sipsin' | 'ganji' | 'relation' | 'sibiunsung'
  trigger_element TEXT,
  description TEXT,
  evidence JSONB,        -- [{date, domain, summary, fortune_element, ...domain_specific}]
                         -- domain: 'diary' | 'sleep' | 'expense' | 'schedule' | 'routine'
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
- **LLM**: Claude Sonnet (대화 + 운세 분석 생성)
- **SQL 도구 기반**: query_db, modify_db, get_schema

## 핵심 로직

### 1. 운세 조회 (Fast Path)
정규식 매칭으로 LLM 바이패스, DB 직접 조회 후 즉시 응답:
- `일운` / `오늘 일운` -> period='daily', date=오늘
- `내일 일운` -> period='daily', date=내일
- `월운` / `이번 달 월운` -> period='monthly', date=해당 월 1일
- `세운` / `올해 세운` -> period='yearly', date=해당 년 1월 1일
- `대운` -> period='major', ORDER BY date DESC LIMIT 1

표시 포맷: 공유 헬퍼 `src/shared/fortune-format.ts`의 `formatFortuneText` — `summary` *볼드* + `analysis` 본문 + `advice` _기울임_ 결합. (유저 트리거 /일운 조회 전용. 아침 일운 자동 발송은 2026-06-03부터 일일 종합 인사이트 routine으로 이관 — §23)

### 1-1. 운세 분석 생성 정책 (weekly-fortune)
weekly-fortune routine이 일운/월운/세운/대운을 생성. fortune_analyses 필드 활용:
- `analysis`: 자연 prose 본문 (마크다운 헤더/이모지/라벨 X, 단락은 빈 줄 구분)
- `summary`: 한 줄 hook (50자 내외)
- `advice`: 1\~2문장 명리학적 격언/권유
- `warnings` / `recommendations`: **빈 배열 `'[]'::jsonb`** — 본문에 녹임

**분석 프레임워크 8 관점**: ① 십성 ② 합·충·형·파·해 ③ 십이운성 ④ 월운 맥락 ⑤ 개인 패턴(saju_patterns) ⑥ 라이프 테마 연결 ⑦ 의사결정 가이드 ⑧ 잠재 카테고리 surface

**라이프 테마 연결 두 트랙**:
- **활성** (`life_themes.active = true`) — 본문에서 명시적 연결 + 의사결정 가이드 직접 제공
- **잠재** — day_pillar 십성 → 영역 매핑(식상/재성/관성/인성/비겁)으로 추론 → active life_themes 미포함 영역도 한 문장으로 부드럽게 surface

**period별 길이**: daily 350\~500자 / monthly 600\~800자 / yearly·major 800\~1200자. advice는 모든 period에서 1\~2문장.

**톤**: 명리학자가 애정을 담아 풀어주는 / 사실 숨기지 않는 / 권유형. 상세는 [ADR 0012](../adr/0012-fortune-personalization.md) 참조.

**발송 분리 (2026-06-03, #475)**: weekly-fortune은 미래 7일 일운 생성 + /일운 조회 베이스로 **불변**. 매일 아침 발송은 일일 종합 인사이트 routine(§23)이 이 생성물(오늘치)을 베이스로 학습 데이터(`saju_influence_summary` view)와 종합해 발송. 상세 [ADR-0031](../adr/0031-daily-insight-synthesis.md).

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
- 누적된 패턴은 시스템 프롬프트 조회에 계속 사용. 갱신 routine(구 `weekly-saju-review`)은 2026-05-26 비활성화 (마스터 #421 A1 신 routine 검증 후 archive 예정)
- pattern_type: sipsin(십신) / ganji(특정 글자) / relation(합/형/충) / sibiunsung(십이운성)
- **분석 도메인**: 일기, 수면, 지출, 일정, 루틴 (cross-domain 통합 분석, 28일 롤링 윈도우)
- **evidence 표준 형식**: `{date, domain, summary, fortune_element, ...domain_specific}` — 도메인 추가(식사·운동 등) 시 마이그레이션 없이 확장 가능. 상세는 [ADR 0011](../adr/0011-saju-patterns-cross-domain.md) 참조
- 같은 trigger_element가 여러 도메인에 발현하면 분리하지 않고 같은 row의 evidence에 누적
- 감지 횟수 추적 (detection_count), 신뢰도 평가 (confidence)
- 비활성화 시 `active = false`, `deactivated_at = NOW()`
- **일일 종합 인사이트(§23)는 `saju_patterns`를 쓰지 않는다** — `saju_influence_summary` view(verified/accumulating/recent, #393/#434 학습 결과)를 사용. `saju_patterns`는 시스템 프롬프트 조회 + weekly-fortune 관점 5 용으로만 잔존 (정리는 마스터 A A3 후속)

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

### 8. 프로액티브 인사이트 엔진 (Phase 1)

`src/shared/insights.ts`의 SQL 기반 패턴 감지 엔진. LLM 호출 없음 (비용 0).

#### 패턴 일람

| type | timing | domain | 톤 | 트리거 |
|------|--------|--------|----|--------|
| streak | morning | routine | 칭찬 | 매일 루틴 3·5·7·10·14·21·30일 연속 |
| sleepTrend ↓ | night | sleep | 잔소리 | 최근 3일 수면 감소 + 7h 미만 |
| sleepTrend ↑ | night | sleep | 칭찬 | 최근 3일 수면 증가 |
| slotGap | night | routine | 관찰 | 시간대별 달성률 격차 30%p+ |
| weekComparison ↑ | morning | routine | 칭찬 | 이번주 - 지난주 ≥5%p |
| weekComparison ↓ | night | routine | 잔소리 | 이번주 - 지난주 ≤-5%p |
| overdueAlert | morning | schedule | 잔소리 | 밀린 일정 3건+ |
| categorySkew | night/weekly | schedule | 관찰 | 7일/지난주 1위 카테고리 ≥50% |
| drift | weekly | sleep | 관찰/잔소리 | 4주 평균 대비 취침·기상 30분+ 또는 중간기상 1.5배+ |
| recovery | morning | routine | 칭찬 | streak 5일+ 깨진 후 1일 만에 재시작 |
| lapseAlert | night | routine | 잔소리 | 7일 100% 루틴이 오늘 빠짐 |
| weeklyRegression | weekly | routine | 잔소리 | 지난주 ≥90% → 이번주 ≤60% |
| spottyPattern | night | routine | 잔소리 | 7일 중 3\~4일 산발 빠짐 |

#### 동적 노출

- 매일 morning(09:05) / night(23:55): priority ≥5인 패턴 최대 3개, 같은 도메인은 priority 최상위 1개만
- 주간 리포트(월요일 09:00): weekly 패턴 전체 (cap 없음, Block Kit으로 표시)
- 0건이면 매일 메시지 발송 안 함 (no-news is good news). 주간 리포트는 "잔잔했어" 한 줄 발송.

#### 임계치

모든 임계치는 `src/shared/insight-thresholds.ts`의 `INSIGHT_THRESHOLDS`에서 단일 관리. Phase 4 사주 매핑 단계에서 튜닝 가능.

상세 배경 및 대안 비교는 [ADR 0014](../adr/0014-insight-engine-unification.md) 참조.

### 9. 프로액티브 인사이트 v2 — Phase 2 (LLM 자율 슬롯)

Phase 1(결정론적 SQL 11종)에 더해 **주간/월간 한정 LLM 자율 발견 슬롯**을 운영. LLM이 사용자 데이터 요약 컨텍스트를 보고 "신호 → 가설 → 검증 SQL"을 스스로 작성하면, N일 뒤 cron이 SQL을 실행해 outcome(hit/miss/inconclusive)을 채점한다. 텍스트(일기/사주)는 컨텍스트에서 배제 — 정량 데이터만 사용.

#### 슬롯 시각

| slot | cron | 트리거 |
|------|------|--------|
| weeklyLlmInsight | 월요일 09:30 | 28일 윈도우 → 1\~2개 finding |
| monthlyLlmInsight | 매월 1일 09:30 | 90일 윈도우 → 1\~2개 finding |
| verifyLlmInsights | 매일 09:10 | `verify_at <= NOW()` 대기열 50건 채점 |

#### 컨텍스트 도메인 (텍스트 제외)

`buildLlmInsightContext(userId, slot)` 가 LLM에 전달하는 데이터:
- **수면**: 평균 / 취침·기상 시각 / 중간기상 횟수 / 일수
- **루틴**: 전체 달성률 / 슬롯별 달성률 / 산발 빠짐 일자
- **일정**: 카테고리 분포 (제목 미포함)
- **지출**: 카테고리 발생 빈도 (금액 미포함)

#### 4중 안전장치

LLM 응답을 `validateLlmInsightResponse(text)` 가 순서대로 검사 — 하나라도 실패하면 해당 finding 폐기:

1. **JSON 파싱 폴백**: 본문 추출 실패 시 빈 배열
2. **SELECT-only 정규식**: `insert|update|delete|drop|truncate|alter|create|grant|revoke` 포함 시 제외
3. **result_type 화이트리스트**: `boolean | scalar_count | ratio` 만 허용
4. **verify_after_days clamp**: 1\~28 범위로 강제

검증 SQL 실행은 `executeVerificationSql`이 `SET statement_timeout = 5000ms` 트랜잭션 안에서 처리. 에러 시 `outcome='inconclusive'` + errorText 보관.

#### outcome 분류 (`classifyOutcome`)

| result_type | hit | miss | inconclusive |
|-------------|-----|------|--------------|
| boolean | first col truthy (true / 't' / 'true' / '1') | falsy | 빈 rows 또는 null |
| scalar_count | 양수 | 0 | 빈 rows 또는 null |
| ratio | 양수 | 0 | 빈 rows 또는 null |

#### 점진적 노출 (progressive disclosure)

신뢰 확보 전에는 LLM이 "그럴듯한 헛소리"를 할 수 있으므로 메시지를 보수적으로 노출:

- **누적 검증 < 10건**: finding 본문만 발송 (히트율 미공개)
- **누적 검증 ≥ 10건**: "지난 검증 N건 중 M건 적중 (X%)" 한 줄 추가 — 사용자가 신호를 채점하면서 보기

`tryLlmInsightFastPath` (정규식: `발견.*검증 | 정확도 | LLM.*어땠`) 로 누적 hit/miss/inconclusive + 최근 5건 조회 가능.

#### 데이터 모델

`llm_insights` 테이블 (마이그레이션 048):
- 발견: signal_text / hypothesis_text / domains[] / confidence(high·medium)
- 검증 계약: verification_sql / verification_result_type / verify_at
- 검증 결과: outcome / verified_at / verification_result_json / verification_error
- 노출 추적: shown_in_slot_at

설계 배경 및 대안 비교는 [ADR 0016](../adr/0016-llm-autonomous-slot-outcome-verification.md) 참조.

### 10. 프로액티브 인사이트 v2 — Phase 3 (사주 일일 매칭)

사용자 임상에서 관찰된 사주 발현 가설을 정량 데이터로 검증하는 결정론적 매칭 엔진. 60갑자 마스터 정규화 위에 시드 카탈로그를 얹어 매일 09:00 평가, hit/miss 누적으로 가설을 검증한다. LLM 호출은 일기 → enum 태그 추출 단 1회(`#life` 매칭 메시지 생성에는 LLM 미사용).

#### 데이터 모델

**마스터 테이블** (마이그레이션 049~050, ~466 rows):
- `stems_master` — 천간 10개 (오행·음양·한자)
- `branches_master` — 지지 12개 (오행·음양·계절·동물)
- `ganji_master` — 60갑자 (FK to stems/branches)
- `sipsin_lookup` — 십성 매핑 220 (10 천간 일간 × 22 대상 글자)
- `sibiunsung_lookup` — 십이운성 120 (10 천간 일간 × 12 지지)
- `branch_relations` — 지지 관계 ~46 (육합/삼합/방합/충/형/파/해/원진)
- `stem_relations` — 천간 관계

**운영 테이블** (마이그레이션 051~053):
- `pattern_catalog` — 시드 정의 (name / sipsin / trigger_type / trigger_target / active / hit_count / miss_count / inconclusive_count / source='seed'|'llm_promoted')
- `pattern_metrics` — 시드 1:N 메트릭 (metric_key / expected_direction / threshold / sql_template)
- `pattern_matches` — 일일 매칭 결과 (pattern_id / date / trigger_activated / matched / metric_values JSONB / verify_status='pending'|'hit'|'miss'|'inconclusive')
- `diary_meta_tags` — 일기 LLM enum 태그 (date / tag / source='llm')

#### Polymorphic Trigger 6종

시드의 발현 조건은 다음 6가지 중 하나로 정의 (`pattern_catalog.trigger_target_type`):

| trigger_type | 의미 | 예시 |
|--------------|------|------|
| stem | 일운 천간이 특정 글자 | `갑` 들어오면 발현 |
| branch | 일운 지지가 특정 글자 | `오` 들어오면 발현 |
| ganji | 일운 60갑자가 특정 조합 | `갑오` 들어오면 발현 |
| element_density | 사주 8글자 + 일운 2글자 중 특정 오행 ≥ N개 | 토 5개 이상이면 발현 |
| sibiunsung | 일간 기준 일운 지지의 12운성 | `사지` 들어오면 발현 |
| relation | 본명 지지와 일운 지지의 관계 | `진술충` 발현 |

#### 메트릭 5방향

시드 trigger 활성 일에 metric을 평가, baseline과 비교 (`pattern_metrics.expected_direction`):

| direction | 의미 | hit 조건 |
|-----------|------|----------|
| above_avg | 28일 평균 대비 상승 | value > avg × threshold (예: 1.5x) |
| below_avg | 28일 평균 대비 하락 | value < avg × threshold (예: 0.7x) |
| above_abs | 절대 임계치 초과 | value > threshold |
| below_abs | 절대 임계치 미만 | value < threshold |
| flag_present | 특정 플래그/태그 존재 | tag IN diary_meta_tags |

Baseline 윈도우는 `BASELINE_WINDOW_DAYS = 28`. SQL 템플릿은 `$user_id`, `$date`, `$baseline_start` 토큰 치환.

#### Hit / Miss / Inconclusive 사이클

매일 09:00 매칭 cron 실행 시:

1. **어제 pending 매칭 검증** — 시드 메트릭 SQL 실행 → outcome 결정
   - 메트릭 조건 충족 → `hit`, `pattern_catalog.hit_count++`
   - 메트릭 조건 미충족 → `miss`, `pattern_catalog.miss_count++`
   - 메트릭 SQL 데이터 부족 (null/0건) → `inconclusive`, `pattern_catalog.inconclusive_count++`
2. **오늘 활성 시드 평가** — 6가지 trigger 평가 → `pattern_matches` UPSERT (`verify_status='pending'`)
3. **`matched=true` 시드 압축** — `#life` 채널에 잔소리 끝 한 줄 추가 (priority sort, cap 3개)

#### 약한 시드 처리

`INSIGHT_THRESHOLDS.WEAK_MIN_TOTAL = 10`, `WEAK_HIT_RATE = 0.3` 임계치. 누적 검증 ≥10건 + hit rate < 30%이면 주간 리포트(`#insight`)에서 "약한 시드 N건" 알림. 자동 비활성화는 하지 않음 — 사용자가 명령어로 토글.

#### Fast Path 명령어 (`#life` 채널)

> 자유언어 추출 없음. 약속된 단일 명령어만 매칭 (`^명령어[.?!]?$`).

| 명령어 | 동작 |
|--------|------|
| `사주 시드 보기` | 활성 시드 + hit rate 목록 |
| `사주 시드 모두 보기` | 비활성 포함 전체 |
| `사주 시드 끄기 #N` | signal_id=N active=false |
| `사주 시드 켜기 #N` | signal_id=N active=true |

#### 일기 메타 LLM 추출

`#life` 또는 `#insight` 에 저장된 일기 본문 → LLM이 정해진 enum 16개 중 해당 태그만 JSON 배열로 반환:

`irritation / health_complaint / low_energy / mood_down / confidence_high / analytical_mode / deep_thought / rest / peaceful / mood_high / cooking / creating / talkative / nostalgia / anxiety / past_memory`

화이트리스트 필터 후 `diary_meta_tags`에 UPSERT. 원문 저장은 `diary_entries`만, 매칭 메트릭은 enum 플래그로 참조. 안정성 강화를 위해 enum 외 출력 시 폐기.

#### 크론 시각

| 시각 | 작업 |
|------|------|
| 09:00 | 일일 사주 매칭 (어제 검증 + 오늘 평가 + #life 한 줄) |
| 05:30 | 일기 메타 enum 추출 — 어제 일기 대상 (migration 054 적용, 자정 넘긴 일기 커버) |

#### 시드 카탈로그 → 매칭 → 검증 흐름

```
[일간 경금 사주]
  ↓
[09:00 cron] ──→ [evaluateTrigger 6종] ──→ pattern_matches (verify_status=pending)
                                              ↓
                                       [매칭된 시드 → #life 한 줄]
                                              ↓ (다음날)
                                       [메트릭 SQL 실행] ──→ hit/miss/inconclusive
                                              ↓
                                       [pattern_catalog 카운터 증가]
                                              ↓ (주간)
                                       [약한 시드 알림 → #insight]
```

#### Phase 5 확장 가능성

동일 polymorphic trigger 구조로 월운/세운/대운 확장 가능. `period` 컬럼 + `period_scope` 시드 컬럼 추가만으로 구조적 확장. 단 검증 사이클이 길어 통계 누적 속도 차이 큼 (월운 \~2년, 세운 \~28년). 상세: [#408](https://github.com/hyewon3938/slack-ai-agents/issues/408).

설계 배경 및 대안 비교는 [ADR-0017](../adr/0017-saju-ganji-master-normalization.md) 참조.

### 11. 프로액티브 인사이트 v2 — Phase 4 (가설-검증 정량 파이프라인)

Phase 3까지는 11종 결정론 패턴 + 60갑자 일일 매칭으로 "기록"만 했다. Phase 4는 그 위에 통계적으로 검증된 가설만 잔소리로 노출하는 자동 파이프라인을 얹는다. 사람 직관(혹은 LLM 추측)이 아니라 누적 데이터의 효과량 + p-value로 active/confirmed/rejected를 판정.

#### 데이터 모델 (migration 058)

| 테이블 | 역할 | 키 컬럼 |
|--------|------|---------|
| `pattern_hypotheses` | 가설 정의 + 현재 상태 | `trigger_spec` JSONB, `enum_target`, `status`, `source` |
| `pattern_stats` | 주간 통계 시계열 (`UNIQUE(hypothesis_id, week_start)`) | `n_trigger_days`, `n_total_days`, `rate_trigger`, `rate_baseline`, `rate_ratio`, `raw_p`, `fdr_q` |

`trigger_spec`은 polymorphic 구조 — 현재는 `{type:'seed', signalId}` (Phase 3 시드 ID 재사용). 향후 합성 트리거(`{type:'and', specs:[...]}` 등) 확장 여지.

`status`: `active` → `confirmed` / `rejected` / `archived`(수동). `source`: `discovery`(자동 발견 후 사용자 등록) / `manual`(직접 입력).

#### enum 확장 (migration 059)

`diary_meta_tags` CHECK 제약 16 → 22. 추가: `wealth_awareness` / `self_observation` / `social_activity` / `physical_activity` / `task_completion` / `clumsy_overflow`. `self_observation` 정의도 명확화(메타 인지/내성).

LLM 추출은 Sonnet → Opus 이관 ([#409](https://github.com/hyewon3938/slack-ai-agents/issues/409)) — meta-extract cron이 createDiaryMetaLLMClient() 경유로 Opus 호출.

#### 통계 알고리즘 (`src/shared/saju-hypothesis.ts`)

- **Fisher's exact test (two-sided)**: hypergeometric log-space sum. n_trigger_days × n_baseline_days 2×2 분할표.
- **Rate ratio**: `rate_trigger / rate_baseline` (효과량). 통계적 유의성 ≠ 실질적 의미를 분리 판단.
- **BH-FDR**: Benjamini-Hochberg False Discovery Rate. 같은 주에 평가하는 가설 수만큼 multiple testing 보정. NaN(n<5 skip) 보존.

임계치 (`saju-hypothesis.ts` 모듈 상단 상수, Phase 4에서만 사용):

| 변수 | 값 | 의미 |
|------|----|----|
| `MIN_TRIGGER_SAMPLE` | 5 | 통계 계산 skip 하한 (trigger 발현일 < 5면 raw_p = NaN) |
| `BASELINE_LOOKBACK_DAYS` | 90 | rate_baseline 계산 윈도우 |
| `CONFIRM_MIN_N` | 30 | confirmed 진입 누적 trigger 발현일 |
| `CONFIRM_MAX_Q` | 0.05 | 최근 4주 평균 FDR-corrected q-value 상한 |
| `CONFIRM_MIN_RATE_RATIO` | 1.3 | 최근 4주 평균 효과량 하한 |
| `REJECT_RATE_LOW` / `HIGH` | 0.95 / 1.05 | rejected: 최근 4주 모두 rate_ratio가 1 근처 |
| `RECENT_WEEKS` | 4 | 상태 평가 윈도우 |

발견 단계 임계치 (`hypothesis-discovery.ts`):

| 변수 | 값 | 의미 |
|------|----|----|
| `DISCOVERY_MIN_N` | 5 | 후보 평가 최소 trigger 발현일 |
| `DISCOVERY_MAX_RAW_P` | 0.1 | 1차 거르기 (BH-FDR 전, 보수적) |
| `DISCOVERY_MAX_FDR_Q` | 0.2 | 다중 비교 보정 후 q-value 상한 |
| `DISCOVERY_MIN_RATE_RATIO` | 1.3 | 효과량 하한 |

#### 자동 패턴 발견 (`src/agents/insight/hypothesis-discovery.ts`)

단일 함수 `discoverCandidates(userId, mode)`로 1차 셋업(`{mode:'setup', lookbackDays}`)과 주간 운영(`{mode:'recurring', weekStart}`) 모두 처리. 모든 (signalId × enum_target) 조합을 평가해 다음 조건 통과한 후보만 반환:

- `DISCOVERY_MIN_N` (5)
- `DISCOVERY_MAX_RAW_P` (0.1) → 1차 거르기 (보수적, BH-FDR 전)
- `DISCOVERY_MAX_FDR_Q` (0.2) → multiple testing 보정 후
- `DISCOVERY_MIN_RATE_RATIO` (1.3)

`rate_ratio` 내림차순 정렬. CLI 백테스트는 `scripts/saju-hypothesis-backtest.ts` (`yarn tsx scripts/saju-hypothesis-backtest.ts --user 1 --lookback 60`).

#### Block Kit 카드 (`src/agents/insight/hypothesis-cards.ts`)

- **`buildCandidateCard`**: discoverCandidates 결과를 등록/폐기 버튼 카드로 변환. action_id: `hypothesis_register` / `hypothesis_dismiss`. payload는 type-safe JSON 인코딩.
- **`buildWeeklyReviewBlocks`**: active 가설 표 (전주 대비 rate_ratio 변화 ▲▼─ 10% 임계) + 신규 후보 묶음.

액션 핸들러 (`src/agents/insight/actions.ts`):
- `hypothesis_register`: `INSERT INTO pattern_hypotheses (status=active, source=auto_discovered)`
- `hypothesis_dismiss`: 카드 메시지 update (DB 변경 X — 거부 기록만)

#### Cron 시각

| 시각 | 슬롯 | 의도 | 산출물 |
|------|------|------|--------|
| 월 08:00 KST | `weeklyHypothesisReview` | 주간 가설 통계 갱신 + 상태 평가 + 신규 후보 발굴 | #insight 묶음 카드 (active 표 + 후보 리스트) |

`weekly-hypothesis-review.ts`는 매일 08:00 발송되지만 `getKSTDayOfWeek() !== 1`이면 즉시 return — `weeklyReport` / `weeklyLlmInsight`와 동일 패턴 (cron 슬롯 하나당 매일 발송 + 본체에서 요일 게이트).

#### 일일 통합 흐름

09:00 #life 사주 매칭 메시지 (Phase 3) 직후, 같은 cron에서 confirmed 가설을 1줄 잔소리로 추가 노출:

```
[Phase 3 결정론 + 60갑자 매칭 라인]
[Phase 1 LLM 인사이트 ── 있을 때]
*<signal_name>* 패턴 켜졌어 → `<enum_target>` 주의 (평균 1.5x).
```

`pickConfirmedHypothesisLines`는 `pattern_hypotheses` confirmed × 오늘 `pattern_matches.trigger_activated = true` JOIN. Phase 1 11패턴 코드는 **무수정** — confirmed 가설이 11패턴 옆에 자동 합류하는 것은 별도 함수로 분리해 dedupe 로직과 격리.

#### 가설 lifecycle

```
auto_discovered → active → confirmed → (영구 노출)
                       ↓
                    rejected (rate_ratio → 1, 4주 연속) → 잔소리 미노출
                       ↓
                    archived (수동, 본인이 더 안 보고 싶을 때)
```

상태 전이는 `evaluateStatusTransition(hypothesisId)` 단일 함수 — pure logic, DB 적용은 `applyStatusTransition`이 별도 수행.

#### Phase 5 확장 가능성

`trigger_spec`의 polymorphic JSONB 구조 덕에 시간 단위 확장(일운/월운/세운/대운)이 데이터 모델 변경 없이 가능 — 새 시드 카탈로그 + period 컬럼만 추가하면 동일 통계 파이프라인이 그대로 적용. 검증 사이클이 길어 누적 속도 차이 큼(세운 1년/대운 10년 단위). 상세: [#408](https://github.com/hyewon3938/slack-ai-agents/issues/408).

#### Fast Path 명령어

Phase 4는 신규 fast path 명령어 없음. 카드 액션 버튼(`hypothesis_register` / `hypothesis_dismiss`)만 노출.

설계 배경 및 대안 비교는 [ADR-0019](../adr/0019-saju-hypothesis-verification-pipeline.md) 참조.

### 12. 프로액티브 인사이트 v2 — Phase 5 (월운 매칭 + 4층 영향력 데이터 expose)

> [#408](https://github.com/hyewon3938/slack-ai-agents/issues/408) · 본격 진입 보류 (Phase 4 운영 1\~3개월 후) · 마스터 A([#421](https://github.com/hyewon3938/slack-ai-agents/issues/421)) 일부와 연결
> 설계 서사: [design-notebook/insight-engine-v2.md](../design-notebook/insight-engine-v2.md) Phase 5 섹션

본격 진입 전 골격만 기록. 본격 진입 시 본문 채우기.

#### 작업 (예정)

- **Phase 5-A** 월운 매칭: pattern_matches → period 컬럼 추가, pattern_catalog → period_scope 컬럼 추가, 월운 매칭 cron(매월 1일), 월 단위 baseline 윈도우 별도 설계
- **Phase 5-B** 4층 영향력 데이터 expose: 일운·월운 누적 영향력을 마스터 A view(`saju_influence_summary`)로 통합 노출 (마스터 A A3에서 소비)

#### 헌장 cross-check (마스터 #393)

- 매칭 영역, 텍스트 원문 노출 없음 (헌장 ①)
- 결정론 SQL 매칭 (헌장 ②)
- 일운·월운까지 outcome 사이클 적용 (헌장 ③)
- 세운·대운 자체 outcome 검증 영구 기각, 대신 마스터 A 풀이로 우회

### 13. 사주 풀이 시스템 책임 분리 + 주간 분석 재설계 (마스터 A)

> [#421](https://github.com/hyewon3938/slack-ai-agents/issues/421) · design 완료, build 대기
> 설계 서사: [design-notebook/fortune-rework.md](../design-notebook/fortune-rework.md)
> 구현 계획: `.claude/plans/421-fortune-rework-A1-A2.md` (gitignored)

마스터 #393 Phase 5 진입 인터뷰 중 파생. 사주 풀이 시스템 단일 책임화 + 주간 분석 메시지 형태 재설계 + v2 데이터 주입 경로 확립.

#### Phase A2 — `saju_influence_summary` view + idempotency 테이블

마이그레이션:
- `db/migrations/061_saju_influence_summary_view.sql` — view 정의
- `db/migrations/062_saju_weekly_reviews.sql` — idempotency 테이블

view 컬럼 contract (Routine 의존):

| 컬럼 | 의미 |
|------|------|
| `user_id` | WHERE 필터 |
| `signal_id` | catalog FK · dedup 키 |
| `signal_name` | 시드 이름 (예: `S1_갑목_편재_천간`) |
| `sipsin` | 십성 |
| `description` | 시드 설명 (LLM 표시·해석 입력 허용) |
| `trigger_target_type` | `stem`/`branch`/`ganji`/`relation`/`element_density`/`sibiunsung` |
| `enum_target` | 검증된 가설의 diary_meta_tag (verified만) |
| `confidence_tier` | `verified`/`accumulating`/`recent` |
| `metric_value` | tier별 의미 (ratio / hit rate / count) |
| `fdr_q` | BH-FDR q-value (verified만) |
| `evaluated_at` | 최근 평가일 (recent은 마지막 매칭일) |

view 동작 (UNION ALL 3 source):

| Tier | 소스 | 조건 | metric_value |
|------|------|------|-------------|
| `verified` | `pattern_hypotheses` (status='active', trigger_spec type='seed') + `pattern_stats` 최근 주 | `fdr_q < 0.05` | `rate_ratio` |
| `accumulating` | `pattern_summary` view (active=true) | `(hit_count+miss_count) ≥ 5` AND `hit/(hit+miss) > 0.55` | hit rate |
| `recent` | `pattern_matches` (지난 7일, trigger_activated=true) | GROUP BY (user_id, pattern_id) | 발현 횟수 |

중복 dedup: 같은 pattern_id가 여러 tier 동시 충족 시 최상위 tier에만 (`verified` > `accumulating` > `recent`). 구현은 `NOT EXISTS` 서브쿼리로 하위 tier에서 상위 tier pattern_id 제외.

> **2026-05-27 Phase 1 view body rebuild**: 마스터 #434 Phase 1에서 `saju_signal_*` → `pattern_*` rename 후 view body를 재정의(`db/migrations/068_saju_influence_summary_rebuild.sql`). **컬럼 이름·view 이름은 보존**(컬럼 `signal_id`/`signal_name`은 `pattern_id`/`pattern_name` 별칭) — Routine `weekly-saju-review-v2` 등 소비자는 영향 없음. 내부 카운터 소스는 `pattern_summary` view(매트릭 단위 SoT, ADR-0023)로 이전.

임계치 하드코딩 사실 (ADR-0020에 후속 작업으로 외부화 검토 명시):
- `fdr_q < 0.05` — verified 컷오프
- `(hit+miss) ≥ 5` AND `hit rate > 0.55` — accumulating 컷오프
- `INTERVAL '7 days'` — recent 윈도우

idempotency 테이블 `saju_weekly_reviews`:
- 컬럼: `id` / `user_id` / `week_start` / `posted_at` / UNIQUE (`user_id`, `week_start`)
- 사용: Routine 발송 직전 `INSERT ... ON CONFLICT (user_id, week_start) DO NOTHING RETURNING id` — 영향 row 0이면 즉시 종료 (Routine retry · prompt 중복 호출 어떤 원인이든 차단)

#### Phase A1 — `weekly-saju-review-v2` Routine + Block Kit 카드

신 Routine `weekly-saju-review-v2` 배치 (Claude 앱 scheduled tasks 영역, 봇 cron 아님).

**발송 메타**
- Routine ID: `weekly-saju-review-v2`
- 위치: `~/.claude/scheduled-tasks/weekly-saju-review-v2/SKILL.md` (사용자 HOME, repo 외부)
- cron: `0 8 * * 1` (매주 월요일 08:00 KST, scheduler jitter로 실제 발송는 08:04 표기)
- 발송 채널: `#insight`
- LLM: Claude Opus (Claude 앱 model selector에서 사용자가 지정 — schema에 model 파라미터 없음, 주의사항으로 명시)
- 의존: `saju_influence_summary` view + `saju_weekly_reviews` 테이블 (A2 머지 후 사용 가능)

**실행 단계 (SKILL.md 기반)**
| 단계 | 동작 | 헌장 cross-check |
|------|------|----------------|
| 0 | `.env`에서 `DB_PROXY_URL` / `DB_PROXY_API_KEY` 추출 (특정 변수만 grep+cut) | secrets 노출 방지 |
| 1 | `saju_weekly_reviews` INSERT idempotency 통과 시에만 진행 | ② 정확히 1회 발송 |
| 2 | `saju_influence_summary` SELECT + accumulating raw counts(`pattern_summary` view, 2026-05-27 rebuild) + 라이프 메트릭 4종(schedule done/total · routine rate · diary_meta_tag top5 · sleep avg) | ① 메트릭만, 일기 원문 SELECT 금지 |
| 3 | Opus가 회고 prose 4\~6줄 작성 (반말·이모지 금지·diary 원문 인용 금지) | ① LLM 입력에 user 텍스트 노출 금지 |
| 4 | Block Kit 카드 1개를 `chat.postMessage`로 `#insight` 발송 | ② 정확히 1회 |
| 5 | 결과 요약 출력 (verified N / accumulating N / recent N) | — |

**Block Kit 카드 구조**
- Header: `🔮 주간 사주 리뷰 — YYYY-MM-DD 주`
- Section 1 — 이번주 회고: Opus prose 4\~6줄
- Section 2 — 학습 ▸ 검증됨: 최대 3개, 형식 `• \`{signal_name}\` _{sipsin}_ — {description} (q={fdr_q:.3f}, ratio {metric_value:.1f}x)` / 0건 시 `_아직 통계 검증 통과한 시드 없음_`
- Section 3 — 학습 ▸ 누적 중: 최대 5개, 형식 `• \`{signal_name}\` _{sipsin}_ — hit rate {pct}% ({hit}/{hit+miss})` / 0건 시 `_아직 누적 패턴 없음 (5건 이상 누적 필요)_`
- Section 4 — 학습 ▸ 최근 7일 활동: `지난 7일 매칭 {N}회, 상위 시드: {top3 signal_name 콤마}` / 0건 시 `_지난 7일 매칭 없음_`
- Context: `_다음 주 월요일 아침 같은 시각에 다시 알려줄게_`
- 섹션 사이 Divider

**실패 모드**
- idempotency INSERT 실패(=중복): 즉시 종료 (재발송 금지)
- 발송 실패: `saju_weekly_reviews` row 별도 DELETE 안 함 — 해당 주는 재발송 불가, 다음 주 정상 동작 (정합성 우선)

#### Phase A3 — 4층 레이어 데이터 주입 (의존: #408 머지)

TODO: #408 Phase 5-B(영향력 데이터 expose) 완료 후 view 확장 + 풀이 prompt 결합 설계. 본 섹션은 #408 진행 시점에 다시 채움.

#### 영향 받지 않는 영역 (본 마스터 범위 외)

- `fortune_analyses` 테이블 (weekly-fortune routine은 계속 INSERT)
- `insightMorningTask` 09:05 일운 발송 (역할 분리: 아침 짧은 일운 / 월요일 종합 회고)
- fast path 명령어 (`/일운`·`/월운`·`/세운`·`/대운`)
- Phase 3/4 매칭·검증 파이프라인

#### 폐기 / 비활성화

- `weekly-saju-review` routine (구) — 2026-05-26 비활성화. A1 신 routine 검증 후 archive
- `saju_patterns` 갱신 동작 — 구 routine 폐기와 함께 자연 정지. 다른 소비자 있는지 A1 build 시 확인

#### 헌장 cross-check (마스터 #393)

- 풀이 LLM 입력에 사용자 텍스트 원문(diary 등) 노출 금지 (헌장 ①)
- 본 마스터는 자율(LLM) 영역, 매칭·outcome 검증은 #408 (헌장 ②)
- 풀이 자체는 outcome 검증 대상 아니나 v2 데이터 주입으로 정확도 향상 (헌장 ③)
- 풀이 LLM은 view 결과 안에서만 해석, 새 가설 만들지 않음 (헌장 ④)

설계 결정 배경: [ADR-0020](../adr/0020-fortune-system-responsibility-split-via-view.md) — 사주 풀이 시스템과 v2 매칭 시스템 책임 분리 + view 인터페이스 도입.

### 14. 본인 1명 패턴 발견 시스템 — Phase 1 (스키마 일반화 + `pattern_*` rename)

> [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434) Phase 1
> 설계 서사: [design-notebook/personal-pattern-discovery.md](../design-notebook/personal-pattern-discovery.md)
> 구현 계획: `.claude/plans/434-phase-1-schema.md` (gitignored)

마스터 #393(프로액티브 인사이트 v2)을 close하고 정체성을 **본인 1명 패턴 발견 시스템**으로 재정의하면서, 사주 한정 어휘(`saju_signal_*`)를 5어휘 모델(시드 → 매트릭 → 매칭 → 가설 → 검증)을 직접 표현하는 `pattern_*`로 전면 rename. 동시에 라이프 통념(`life_signal` target_type)도 같은 파이프라인에서 다룰 수 있도록 스키마를 일반화.

#### 데이터 모델 변경

**테이블·컬럼 rename**

| 변경 전 | 변경 후 |
|---------|---------|
| `saju_signal_catalog` | `pattern_catalog` |
| `saju_signal_metrics` | `pattern_metrics` |
| `saju_daily_matches` | `pattern_matches` |
| `saju_hypotheses` | `pattern_hypotheses` |
| `saju_stats` | `pattern_stats` |
| `pattern_metrics.signal_id` (FK) | `pattern_metrics.pattern_id` |
| `pattern_matches.signal_id` (FK) | `pattern_matches.pattern_id` |

인덱스 6종 동시 rename(`*_user_date`, `*_signal`, `*_pattern_lookup` 등). View `saju_influence_summary` body 재정의(다음 절).

**`pattern_catalog` 신규 컬럼**

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `pattern_kind` | `TEXT NOT NULL DEFAULT 'saju' CHECK (pattern_kind IN ('saju','life_signal'))` | 시드 출처 분류 (사주 / 라이프 통념) — Phase 3에서 `life_signal` 시드 14\~20개 작성 시 활용 |
| `trigger_target_type` | (CHECK 확장) | 기존 6종(`stem`/`branch`/`ganji`/`element_density`/`sibiunsung`/`relation`)에 `life_signal` 추가 |

**`pattern_metrics` 신규 컬럼 (13종)**

| 컬럼 | 타입 / 기본값 | 의미 |
|------|---------------|------|
| `description` | `TEXT NOT NULL DEFAULT ''` | LLM 표시 + 매트릭 승인 게이트 대상 (ADR-0025). Phase 2에서 시드 풀 검토 시 정식 본문 채움 |
| `window_days` | `INTEGER` (NULL 허용) | 매트릭 평가 윈도우 (예: 28일 이동평균) |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | `'pending'`(LLM 제안) / `'active'`(승인) / `'rejected'`(거절) — Phase 6 LLM 게이트 도입 시 활용 |
| `source` | `TEXT NOT NULL DEFAULT 'deterministic'` | `'deterministic'` / `'llm'` — 매트릭 출처 추적 |
| `proposed_at` / `approved_at` | `TIMESTAMPTZ` (NULL 허용) | 제안·승인 시각 |
| `hit_count` / `miss_count` / `inconclusive_count` | `INTEGER NOT NULL DEFAULT 0` | 매트릭 단위 카운터 (ADR-0023 — catalog 카운터는 DEPRECATED 전환) |
| `last_matched_at` | `TIMESTAMPTZ` (NULL 허용) | 마지막 매칭 발생 시각 |
| `posterior_alpha` | `NUMERIC NOT NULL DEFAULT 1.0` | Beta-Binomial 사후 분포 α (ADR-0024) |
| `posterior_beta` | `NUMERIC NOT NULL DEFAULT 1.0` | Beta-Binomial 사후 분포 β |
| `posterior_p` | `NUMERIC` (NULL 허용) | `α / (α+β)` 계산값 (편의용 캐시) |

부분 인덱스 `idx_pattern_metrics_status_active ON pattern_metrics (pattern_id) WHERE status='active'` — 매칭 cron이 active 매트릭만 빠르게 탐색.

#### 신규 view `pattern_summary` (seed-level 집계)

매트릭 카운터(ADR-0023)에서 seed-level hit/miss를 합성하는 view. accumulating tier 임계치 판정 + 풀이 prompt 보조 용도.

```sql
CREATE OR REPLACE VIEW pattern_summary AS
SELECT
  c.id AS pattern_id, c.user_id, c.name AS pattern_name, c.sipsin, c.pattern_kind,
  c.trigger_target_type, c.trigger_target, c.active,
  COALESCE(SUM(m.hit_count), 0)          AS hit_count,
  COALESCE(SUM(m.miss_count), 0)         AS miss_count,
  COALESCE(SUM(m.inconclusive_count), 0) AS inconclusive_count,
  -- Beta 합성: α=1+Σhit, β=1+Σmiss
  1.0 + COALESCE(SUM(m.hit_count), 0)  AS aggregate_alpha,
  1.0 + COALESCE(SUM(m.miss_count), 0) AS aggregate_beta,
  CASE WHEN COALESCE(SUM(m.hit_count + m.miss_count), 0) > 0
       THEN (1.0 + COALESCE(SUM(m.hit_count), 0))
          / (2.0 + COALESCE(SUM(m.hit_count + m.miss_count), 0))
       ELSE 0.5
  END AS aggregate_posterior_p,
  MAX(m.last_matched_at) AS last_matched_at
FROM pattern_catalog c
LEFT JOIN pattern_metrics m
  ON m.pattern_id = c.id AND m.status = 'active'
GROUP BY c.id;
```

#### `saju_influence_summary` view body 재정의 (운영 자산 보존)

| 항목 | 결정 |
|------|------|
| view 이름 | **유지** (`saju_influence_summary`) — Routine `weekly-saju-review-v2` SKILL.md가 view 이름으로 SELECT |
| 컬럼 이름 | **유지** (`signal_id`/`signal_name`이지만 내부 source는 `pattern_id`/`pattern_name`로 alias) |
| 내부 source | 모두 `pattern_*`로 변경 + accumulating tier는 `pattern_summary` view 경유 (ADR-0023 SoT) |

마이그레이션 `068_saju_influence_summary_rebuild.sql`이 `CREATE OR REPLACE VIEW` 한 번에 처리. 외부 contract는 변하지 않으므로 Routine·풀이 prompt 영향 없음.

#### 마이그레이션 번호 매핑

| 번호 | 내용 |
|------|------|
| `063_pattern_rename.sql` | 5개 테이블 + FK 컬럼 2개 + 인덱스 6종 rename |
| `064_pattern_trigger_target_type_and_kind.sql` | CHECK constraint 재정의(`life_signal` 추가) + `pattern_kind` 컬럼 추가 |
| `065_pattern_metrics_extension.sql` | `pattern_metrics` 신규 컬럼 13종 + 부분 인덱스 |
| `066_pattern_metric_backfill.sql` | description placeholder backfill + catalog raw → metric counter 이전 + Bayesian α/β/p 초기화 + 기존 catalog 카운터 DEPRECATED 주석 |
| `067_pattern_summary_view.sql` | `pattern_summary` view 신설 |
| `068_saju_influence_summary_rebuild.sql` | `saju_influence_summary` view body 재정의 (이름·컬럼 contract 보존) |

#### Backfill 정책

**description backfill (Phase 2 보강)**
- Phase 1은 placeholder 문구로 일괄 채움(예: `'(매트릭 설명 미작성 — Phase 2에서 보강)'`). NOT NULL 제약 만족이 목표
- Phase 2(시드 풀 보완)에서 매트릭별로 사람이 읽을 수 있는 description 작성

**hit/miss/inconclusive backfill (catalog → metric)**
- `pattern_matches` raw 데이터를 매트릭 단위로 GROUP BY(pattern_id, status별 COUNT)
- `pattern_metrics`의 카운터 컬럼에 UPDATE — 이때 status='active' 매트릭만 대상(`source='deterministic'`인 시드는 status='active'로 기본 시작)
- `pattern_catalog`의 기존 `hit_count`/`miss_count` 컬럼은 **DEPRECATED 주석만** — Phase 4 매칭 cron 확장 시점에 컬럼 자체 제거 검토

**Bayesian α/β/p backfill (ADR-0024)**
- `posterior_alpha = 1.0 + hit_count`
- `posterior_beta = 1.0 + miss_count`
- `posterior_p = α / (α+β)` (단, hit+miss = 0이면 NULL 유지)

#### Phase 1 적용 범위 (단독 머지 동작)

| 영역 | Phase 1 변경 | Phase 4 이후 |
|------|-------------|--------------|
| 매칭 cron(`daily-saju-matching.ts`) | 어휘만 교체(테이블·컬럼명) — catalog 카운터는 그대로 UPDATE | catalog 카운터 UPDATE 제거 → `pattern_metrics` 카운터로 이전 |
| 가설 검증(`saju-hypothesis.ts`) | 어휘만 교체 | `pattern_metrics.status='active'`만 검증 대상 |
| 시드 카탈로그 | `pattern_kind = 'saju'` 기본값 (기존 시드 전부) | Phase 3에서 `life_signal` 14\~20종 추가 |
| LLM 매트릭 승인 | status enum 정의만 (`'active'` 기본) | Phase 6에서 `/insight metric-approve` 명령어 + Block Kit 승인 카드 |

→ **Phase 1 단독 머지로는 동작 변화 0**. 어휘만 바뀌고 외부 contract(view 이름·컬럼·Routine 의존)는 유지. 회귀 테스트는 기존 vitest suite + view SELECT 결과 동등성으로 확인.

#### 영향 받지 않는 영역

- `weekly-saju-review-v2` Routine — view 인터페이스 유지로 영향 없음 (Section 13)
- `weekly-fortune` Routine + `fortune_analyses` 테이블 — 본 마스터 범위 외
- `diary_meta_tags` enum 22종 — 마스터 #393 Phase 4 (그대로)
- fast path 명령어(`/일운`·`/월운`·`/세운`·`/대운`) — 그대로

#### 다음 Phase

- **Phase 2** — 시드 카탈로그 풀 검토 + 누락 보완. 매트릭 description 정식 본문 채움
- **Phase 3** — `life_signal` 시드 1차 셋 작성(요일 7 + 주말 1 + 평일 1 + 월말 1 + 월초 1 + 계절 4)
- **Phase 4** — 매칭 cron이 `pattern_metrics` 카운터로 이전 + `life_signal` 처리 + `pattern_summary` view 활용

#### 헌장 cross-check (마스터 #434)

- ① **본인 1명 데이터**: 변동 없음 (n=1 가정 유지)
- ② **결정론 매칭 + 통계 검증**: 어휘 교체뿐 매칭 로직 불변
- ③ **5어휘 모델 직접 표현**: `pattern_*` prefix가 시드·매트릭·매칭·가설·검증 5어휘를 직접 표현 — 본 Phase의 핵심 산출물
- ④ **확장 가능 스키마**: `pattern_kind` + `trigger_target_type='life_signal'`로 라이프 통념 합류 준비 완료
- ⑤ **LLM 매트릭 승인 게이트**: status enum 정의로 게이트 진입점 마련 (Phase 6에서 본격 활용)

설계 결정 배경: [ADR-0022](../adr/0022-target-type-generalization.md) (Superseded by 0026), [ADR-0023](../adr/0023-metric-unit-counter-and-summary-view.md), [ADR-0024](../adr/0024-bayesian-posterior-update.md), [ADR-0025](../adr/0025-llm-metric-approval-gate.md), [ADR-0026](../adr/0026-pattern-prefix-rename.md)

### 15. 본인 1명 패턴 발견 시스템 — Phase 2 (사주 시드 풀세트 + 빈 매트릭 evidence-only)

#### 시드 풀세트 카운트

사주 6종 풀세트 161개 신규 시드를 `pattern_catalog`에 박는다. 풀셋 단일 시드는 매트릭 없이 등록되며, 매일 매칭 cron이 trigger만 평가하고 `pattern_matches.evidence` JSONB만 누적한다.

| 종류 | 마스터 카운트 | 기존 시드 | 신규 시드 | 합계 |
|------|------|------|------|------|
| stem | 10 | 8 | 2 | 10 |
| branch | 12 | 3 + 1 통합 | 9 | 13 (단일 12 + 통합 1) |
| ganji | 60 | 0 | 60 | 60 |
| element_density | 10 | 1 | 9 | 10 |
| sibiunsung | 12 | 1 | 11 | 12 |
| relation | 72 | 2 | 70 | 72 |
| **합계** | **176** | **16** | **161** | **177** |

신규 시드 이름은 `pool_<대상>_<카테고리>` 패턴 (예: `pool_갑_천간`, `pool_자_지지`, `pool_충_진술`). 기존 16개 시드는 이름 보존(운영 자산 우선). 통합 시드와 풀셋 단일 시드 둘 다 유지 — 데이터 풍부도 우선.

#### 데이터 모델 변경

| 마이그레이션 | 내용 |
|------|------|
| `069_pattern_matches_no_metric.sql` | `pattern_matches.matched` NOT NULL → NULL 허용. `verify_status` CHECK 재정의 (`'no_metric'` 추가). 부분 인덱스 `idx_pattern_matches_no_metric ON pattern_matches (user_id, date) WHERE verify_status='no_metric'` |
| `070_saju_seed_pool.sql` | 신규 161개 시드 INSERT (`pattern_catalog`) + 같은 ID `pattern_metrics` row 생성. `ON CONFLICT DO NOTHING` (멱등). 풀셋 시드는 `pattern_metrics`에 row가 없으므로 evidence-only로 동작 |

마이그레이션 070은 직접 SQL을 손으로 쓰지 않고 `scripts/generate-saju-seed-pool.ts`가 stdout으로 생성한 SQL을 파일로 저장한 형태. 십신 매핑·description·기존 시드 제외 규칙을 모두 TypeScript 코드로 표현해 휴먼 에러 차단.

#### Evidence-only 흐름 (`src/shared/saju-match.ts`)

매칭 결과 인터페이스 확장:

```typescript
export interface SeedMatchResult {
  seed: SajuSeedWithMetrics;
  triggerActivated: boolean;
  metricEvaluations: MetricEvaluation[];
  matched: boolean | null;       // 매트릭 없으면 null
  isEvidenceOnly: boolean;       // seed.metrics.length === 0
}
```

매칭 cron 분기:

```
matched        = isEvidenceOnly ? null : triggerActivated && passed
verify_status  = isEvidenceOnly ? 'no_metric' : 'pending'
```

`verifyDailyMatches`는 `verify_status='pending'` 행만 평가하므로 `no_metric` 행은 자연 스킵. 누적된 `evidence` JSONB는 Phase 6 LLM 매트릭 제안 슬롯의 가설 후보 풀로 사용.

#### 시드별 trigger 표현

| 종류 | trigger_target_type | trigger_target | trigger_aux |
|------|------|------|------|
| stem | `stem` | 천간 1자 | — |
| branch | `branch` | 지지 1자 | — |
| ganji | `ganji` | 갑자 1조 | — |
| element_density | `element_density` | NULL | `{"element": "화", "mode": "over"}` 또는 `"lack"` (10자 기준 3+/0) |
| sibiunsung | `sibiunsung` | NULL | `{"name": "장생"}` 등 |
| relation | `relation` | NULL | `{"type": "branch_clash", "members": ["진", "술"]}` 등 (`branch_*` / `stem_*` prefix) |

기존 `relation` 시드는 `{"day_branch": ..., "natal_branches": [...], "relation_types": [...]}` 포맷도 유지 (regression 방지). `evaluateTrigger`에서 새 `{type, members}` 포맷을 먼저 처리하고 폴백.

#### 사용자 임상 단서를 description에 박기

description 형식: `<대상> 발현일 — <십신>(<해석 + 사용자 임상 단서>)`. 사용자가 실제로 그날 어떤 패턴이 나타났는지 임상적으로 관측한 단서를 시드 description에 직접 박아 Phase 6 LLM 매트릭 제안 시 가설 hint로 활용. 십신 매핑 정정도 함께 반영 — **자수(지지) = 상관** (식신 X, 사용자 임상 정정). 60갑자 자수 ganji 시드(갑자/병자/무자/경자/임자)에도 동일 적용.

상세 단서 목록: [design-notebook Phase 2 — 사용자 임상 데이터 반영](../design-notebook/personal-pattern-discovery.md#사용자-임상-데이터-반영-description에-박힘).

#### Phase 6 연결

60+일 evidence JSONB 누적 → Phase 6 LLM 매트릭 제안 슬롯이 가설 후보 풀로 활용. Phase 6 운영 형태는 **Claude 앱 routines 기반** ([ADR-0027](../adr/0027-llm-async-routine-unification.md)) — 기존 Node.js cron이 LLM API를 호출하던 비실시간 작업 6건도 routines로 점진 이관.

#### 파일 구조

```
scripts/
  generate-saju-seed-pool.ts   # SQL 생성기 (TypeScript, stdout)

db/migrations/
  069_pattern_matches_no_metric.sql
  070_saju_seed_pool.sql       # 생성기 출력 (1154줄, 161 시드)

src/shared/
  saju-match.ts                # SeedMatchResult.matched: boolean | null
                               # evaluateTrigger('relation') 새 {type, members} 포맷 분기
```

설계 결정 배경: [ADR-0023](../adr/0023-metric-unit-counter-and-summary-view.md), [ADR-0025](../adr/0025-llm-metric-approval-gate.md), [ADR-0027](../adr/0027-llm-async-routine-unification.md), [design-notebook Phase 2](../design-notebook/personal-pattern-discovery.md#phase-2-사주-시드-풀세트--빈-매트릭-evidence-only-2026-05-28)

### 16. 본인 1명 패턴 발견 시스템 — Phase 2.5 (운 레벨 차원 + 풀셋 임계치 + 자동 분포 분석 cron)

Phase 2의 사주 시드는 모두 일운(日運) 단위로만 발현되어 "월운/세운/대운 단위로도 같은 패턴이 나타나는가?" 라는 질문을 데이터로 답할 수 없었다. Phase 2.5는 시드의 발현 운 레벨을 데이터 모델 차원으로 끌어올리고, 임의 임계치를 박는 대신 풀셋(N=1..5) 형태로 누적 카운트 자체를 시드화한다. 어느 N 임계치가 의미 있는지는 누적된 데이터가 결정 ([ADR-0028](../adr/0028-pillar-level-and-threshold-pool.md)).

#### 데이터 모델 변경

| 마이그레이션 | 내용 |
|------|------|
| `071_pattern_signals_pillar_level.sql` | `pattern_catalog.pillar_level VARCHAR(20)` 추가 (CHECK enum 6값) + Phase 2 사주 시드 161개 backfill (`pillar_level='ilun'`) + `trigger_target_type` CHECK에 `cumulative_pillar_count` 추가 + `pattern_metrics.domain` CHECK에 `expense_category_present` 추가 + 부분 인덱스 + 신규 14 시드 + cron 슬롯 시드 |

`pattern_catalog.pillar_level` enum:

| 값 | 의미 |
|------|------|
| `wonguk` | 원국(natal) — Phase 2.5 1차에서는 직접 매칭 시드 없음. cumulative 카운트에는 포함 |
| `daeun` | 대운 (10년 단위, `saju_profiles.daewun_list`에서 추출) |
| `seun` | 세운 (해당 연도 year pillar) |
| `wolun` | 월운 (해당 월 month pillar) |
| `ilun` | 일운 (해당 일 day pillar) — Phase 2 시드 161개 기본값 |
| `cumulative` | 5개 운 레벨 누적 카운트 시드 (별도 trigger type) |

`life_signal` 및 `pillar_level IS NULL`은 미적용 (Phase 3 이후 life_signal 시드는 본 차원과 무관).

#### `cumulative_pillar_count` trigger type

5개 운 레벨(원국/대운/세운/월운/일운) 중 오행 또는 십성이 발현된 레벨 수를 세서 `count_min` 임계치와 비교. 발현 정의는 "해당 레벨의 천간 또는 지지 1자라도 해당 오행/십성에 해당하면 +1".

| trigger_aux | 의미 |
|------|------|
| `{"element": "화", "count_min": 3}` | 화 오행이 5개 레벨 중 3개 이상에서 발현 |
| `{"sipsin": "편재", "count_min": 2}` | 편재가 5개 레벨 중 2개 이상에서 발현 |

원국 레벨은 4주(年月日時) 중 하나라도 해당하면 카운트 +1. 대운이 미적용 구간(생년 이전 또는 daewun_list 비어있음)이면 해당 레벨은 0으로 처리. 풀셋 임계치 — N=1..5를 각각 별도 시드로 등록해 데이터가 임계치를 결정.

#### `expense_category_present` 메트릭 domain

지출 카테고리 발현 여부를 cross-domain 메트릭으로 식별. 본 phase에서는 화 오행 누적 시드의 보조 메트릭(`expense_의료건강` — 화극금 건강 가설 검증)으로 사용. `pattern_metrics.expected_direction='flag_present'` + `expected_threshold=1`.

#### 14개 신규 시드 카탈로그

| 카테고리 | 시드 수 | 이름 패턴 | trigger_target_type | pillar_level |
|------|------|------|------|------|
| 편재 천간(갑) | 2 | `pool_편재_갑_천간_<일운\|월운>` | `stem` | `ilun` / `wolun` |
| 편재 지지(인) | 2 | `pool_편재_인_지지_<일운\|월운>` | `branch` | `ilun` / `wolun` |
| 편재 누적 N=1..5 | 5 | `pool_편재_누적_N<1..5>` | `cumulative_pillar_count` | `cumulative` |
| 화 오행 누적 N=1..5 | 5 | `pool_화_오행_누적_N<1..5>` | `cumulative_pillar_count` | `cumulative` |

화 오행 누적 시드 5개는 각각 2개 메트릭 (OR 매칭):
- `diary_health_complaint` (`diary_meta_tags.tag='health_complaint'`, domain=`diary_meta`)
- `expense_의료건강` (`expenses.category='의료/건강'`, domain=`expense_category_present`)

매트릭 둘 중 하나만 hit이어도 시드 hit — `saju-match.ts`의 `metricEvaluations.some((e) => e.passed)`가 기존부터 OR 동작.

편재 9개 시드는 매트릭 없는 evidence-only (Phase 2 풀셋과 동일).

#### `saju-match.ts` 운 레벨 분기

`evaluateTrigger`의 `stem` / `branch` 케이스가 `pickPillarByLevel(seed.pillar_level, ctx)`로 평가 대상 pillar를 선택:

```typescript
const pickPillarByLevel = (level: PillarLevel | null, ctx: DailyContext): Pillar | null => {
  switch (level) {
    case null: case 'ilun': return ctx.ilun;
    case 'wolun': return ctx.wolun;
    case 'seun': return ctx.seun;
    case 'daeun': return ctx.daeun;  // 미적용 구간이면 null → trigger false
    case 'wonguk': case 'cumulative': return null;  // 직접 매칭 불가
  }
};
```

`cumulative_pillar_count` 케이스는 별도 `evaluateCumulativePillarCount(seed, ctx)`로 분기. `DailyContext`에 `ilun`/`wolun`/`seun`/`daeun` 필드 추가, `NatalContext`에 `pillars`/`birthDate`/`daewunList` 추가.

#### `saju-calendar.ts:computeCumulativePillarCount`

```typescript
export const computeCumulativePillarCount = (
  dayMaster: Cheongan,
  pillars: PillarSet,
): CumulativeCount => { ... }
```

5개 레벨 각각에 대해 천간/지지 → 오행/십성 변환 후, 레벨 내 발현 집합을 만들어 누적. 같은 레벨 내 중복은 1회만 카운트(`Set`). 원국은 4주 통합(`pillars.wonguk: readonly Pillar[]`), 그 외는 1주씩.

#### `pillar-level-distribution-review` cron (월요일 09:15 KST)

`pattern_matches` 90일 윈도우의 `pillar_level`별 hit-rate 분포 + `cumulative_pillar_count` trigger의 N=1..5 분포를 한 줄로 압축해 `#insight` 채널에 발송. 결정론 SQL만 사용 — LLM 호출 없음([ADR-0027](../adr/0027-llm-async-routine-unification.md) 준수).

- `getKSTDayOfWeek() !== 1`이면 즉시 return (다른 요일에도 09:15에 트리거되지만 본체가 스킵 — `weeklyHypothesisReview`와 동일 패턴).
- 양쪽 분포 모두 빈 결과면 `buildMessage` → null → 발송 스킵 (`데이터 부족` 로그만).
- `verify_status='no_metric'` 행은 hit-rate 분포에서 제외 (evidence-only 시드의 채점은 무의미).
- 멀티유저: `queryAllUserMappings()` 순회 + 유저별 channel fallback.

```
📊 운 레벨 분포 (90일 윈도우)
- ilun: 120건, hit 18.5%
- wolun: 40건, hit 8.0%
...
🔢 누적 카운트 분포 (오행/십성 × N=1..5)
- 화 오행 N=1: 70건, hit 12
- 화 오행 N=2: 25건, hit 6
- 편재 N=3: 4건, hit 0
...
```

자동으로 "어느 N이 의미 있는 임계치인가?"의 판단 단서를 노출. 사용자가 분포를 보고 Phase 6 LLM 매트릭 제안 슬롯에 임계치 hint를 줄 수 있도록.

#### 크론 시각

| 시각 | 슬롯 | 의도 | 산출물 |
|------|------|------|------|
| 09:15 (월요일만) | `pillarLevelDistributionReview` | 운 레벨별·누적별 hit-rate 분포 노출 | `#insight` 채널 한 줄 압축 메시지 |

`weeklyReport`(09:00 월요일) / `weeklyHypothesisReview`(08:00 월요일)와 시간대 겹치지 않게 분리.

#### 파일 구조

```
db/migrations/
  071_pattern_signals_pillar_level.sql  # 컬럼·CHECK·backfill·14 시드·cron 슬롯

src/shared/
  saju-calendar.ts                       # +computeCumulativePillarCount, +getDaeunPillar, +makePillar
                                         # +types: Element, PillarSet, CumulativeCount
  saju-match.ts                          # +pickPillarByLevel, +evaluateCumulativePillarCount
                                         # +DailyContext.{ilun,wolun,seun,daeun}
                                         # +NatalContext.{pillars,birthDate,daewunList}

src/cron/
  pillar-level-distribution-review.ts    # 월요일 09:15 KST 결정론 분포 cron
  life-cron.ts                           # SLOT_TASKS에 pillarLevelDistributionReview 등록
```

#### 다음 phase 연결

본 phase에서 추가된 `pillar_level` 차원은 Phase 3 이후 `life_signal` 시드에서는 미적용 (`pillar_level IS NULL` 유지). Phase 5 가설 검증·BH-FDR 그룹은 `pillar_level`도 그룹화 키로 활용 가능 (예: "월운 기준으로만 confirmed된 가설 그룹"). 자동 분포 cron은 Phase 6 LLM 매트릭 제안 슬롯의 임계치 hint 입력으로 사용.

설계 결정 배경: [ADR-0028](../adr/0028-pillar-level-and-threshold-pool.md), [design-notebook Phase 2.5](../design-notebook/personal-pattern-discovery.md#phase-25-운-레벨-차원-도입--자동-분포-분석-cron-2026-05-28)

### 17. 본인 1명 패턴 발견 시스템 — Phase 3 (life_signal 시드 풀 셋 + 매칭 cron 일반화)

설계 결정 배경: [ADR-0029](../adr/0029-life-signal-trigger-aux-standard.md), [design-notebook Phase 3](../design-notebook/personal-pattern-discovery.md#phase-3-life_signal-시드-풀-셋--매칭-cron-일반화-2026-05-28)

#### 데이터 모델 — `life_signal` 단일 통합 + `trigger_aux.kind` 분기

Phase 1 ADR-0022(`life_signal` 추가)와 Phase 2 ADR-0026(`pattern_*` rename) 위에서, Phase 3는 사주 외 환경/임계치/행동 데이터를 **하나의 `trigger_target_type='life_signal'`로 통합** + `trigger_aux.kind` 디스크리미네이터로 평가 명세 분기.

| `trigger_aux.kind` | 평가 방식 | 시드 수 |
|---|---|---|
| `weekday` | dow 매칭 (월\~일) | 7 |
| `weekday_group` | weekend / weekday 분류 | 2 |
| `month_position` | start (1\~3일) / end (말일-3\~말일) / mid (11\~20일) | 3 |
| `season` | spring (3\~5월) / summer (6\~8) / autumn (9\~11) / winter (12·1·2) | 4 |
| `calendar_event` | 한국 공휴일 / 공휴일 다음날 | 2 (자동이체일은 후속 — 사용자별 day_of_month 설정 필요) |
| `threshold` | 수면 분 ≤ N (4개) + 루틴 streak ≥ N일 (5개) | 9 |
| `behavior_baseline` | `insights.ts` 11종 detect 함수 위임 | 11 |

총 **7 kinds / 38개 신규 시드** (catalog INSERT 기준). 설계 시 8 kinds였으나 `lunar`(음력 1·15일) kind는 구현 직후 폐기 — 사주 운(運)은 절기 기준이지 음력 1/15 기준이 아니며, 명절/계절 효과는 `calendar_event:holiday_next`와 `season`으로 커버 가능. 본인 음력 단일 효과에 대한 임상 가설도 0개. 상세: [ADR-0029 폐기 결정 섹션](../adr/0029-life-signal-trigger-aux-standard.md).

#### 평가 흐름

```
matchAllSeedsForDay(userId, date)
  → loadActiveSeeds(userId)         // pattern_kind='life_signal' 포함
  → getDailyContext(userId, date)   // DailyContext.userId 포함 (Phase 3 신설)
  → for each seed:
       evaluateTrigger(seed, ctx, stemMap, branchMap)
         → case 'life_signal':
              if (!isLifeSignalAux(aux)) return false   // type guard
              return dispatchLifeSignal(aux, ctx)        // 7-way dispatch
                → src/shared/life-signal-evaluators/<kind>.ts
```

`evaluateTrigger` 시그너처는 변경 X (4 args 유지). 본인 데이터 SELECT가 필요한 `threshold` / `behavior_baseline` evaluator는 `DailyContext.userId`를 통해 접근 — 인터페이스 안정성 + 테스트 stub 간소화.

#### 매트릭 정책 — 혼합 (강한 임상 가설만 결정론)

| 시드 | metric_name | direction | SQL 요약 |
|---|---|---|---|
| `life_sleep_le_7` | `same_day_health_complaint` | flag_present | 같은날 `diary_meta_tags.tag='health_complaint'` COUNT |
| `life_dow_월` | `schedule_count_today` | above_avg | 같은날 schedules COUNT vs 28일 baseline |
| `life_holiday` | `schedule_count_today` | below_avg | 같은날 schedules COUNT vs 28일 baseline |

나머지 35개는 evidence-only — `pattern_matches.matched=NULL`, `verify_status='no_metric'`. 60+일 누적 후 Phase 6 LLM 매트릭 제안 슬롯 가설 후보로 활용.

> 매트릭은 모두 **같은날**(`$2`) 평가. 다음날 효과(예: 수면→다음날 컨디션)는 현 `pattern_matches` 1:1 모델에서는 표현이 까다로워 1차에서 단순화. follow-up으로 재검토.

#### 잔소리 시스템 일시 공존

`insights.ts`의 11개 detect 함수(`detectStreak` 등)는 **잔소리 응답 생성**에 계속 사용. 시드 evaluator(`behavior-baseline.ts`)는 같은 detect 함수를 호출해 **매칭 데이터 누적**용으로만 동작. 두 시스템이 같은 SQL을 두 번 실행 — Phase 8에서 시드 evaluator로 일원화.

#### 마이그레이션

- `db/migrations/072_life_signal_seed_pool.sql` — 시드 38개 INSERT + 매트릭 3개 INSERT (모두 멱등 `ON CONFLICT DO NOTHING`)

#### 외부 의존성 (1차 정적 상수)

- 한국 공휴일: `src/shared/life-signal-evaluators/korean-holidays.ts` — 2026년 15개 양력 날짜 (`KOREAN_HOLIDAYS` Set). 2027+ 데이터는 follow-up

#### 파일 구조 갱신

```
src/shared/
├── life-signal-evaluators/         (신규 디렉토리)
│   ├── index.ts                    dispatcher (kind → evaluator, 7-way)
│   ├── weekday.ts                  WeekdayAux / WeekdayGroupAux
│   ├── month-position.ts           start / end / mid
│   ├── season.ts                   봄·여름·가을·겨울
│   ├── calendar-event.ts           공휴일 / 공휴일 다음날 / 자동이체일
│   ├── threshold.ts                sleep_minutes / routine_streak_max
│   ├── behavior-baseline.ts        insights.ts 11종 detect 위임
│   ├── korean-holidays.ts          KOREAN_HOLIDAYS 정적 Set (2026)
│   └── __tests__/
│       ├── weekday.test.ts
│       ├── month-position.test.ts
│       ├── season.test.ts
│       ├── calendar-event.test.ts
│       ├── threshold.test.ts
│       └── behavior-baseline.test.ts
└── saju-match.ts                   case 'life_signal' + LifeSignalAux 타입 + isLifeSignalAux 가드
```

#### 다음 phase 연결

- **Phase 4**: `pattern_summary` view 본문 작성, 매칭 cron 파일명 일반화(`daily-saju-matching` → `daily-pattern-matching`) 검토, `pattern_metrics` hit/miss UPDATE 로직
- **Phase 5\~7**: 가설 발견·검증 파이프라인이 `pattern_kind` 무관하게 동작 (이미 일반화 완료)
- **Phase 8**: `insights.ts` detect 함수 → 시드 evaluator로 일원화 (잔소리 시스템 통합)

### 18. 본인 1명 패턴 발견 시스템 — Phase 4 (매칭 cron 카운터 source of truth 전환 + pattern-match rename)

ADR-0023 실행 단계. Phase 1\~3에서 매칭 결과가 `pattern_catalog.hit_count/miss_count/inconclusive_count`에 누적되던 것을, **매트릭 단위 카운터(`pattern_metrics`) + Bayesian posterior**로 전환하고 시드 단위 합계는 `pattern_summary` view에서 derive하도록 정리. 잔존 catalog 카운터는 Phase 8에서 DROP.

#### 변경된 데이터 흐름

| 단계 | Phase 3 (Before) | Phase 4 (After) |
|------|-----------------|-----------------|
| `verifyDailyMatches` 카운터 대상 | `pattern_catalog.hit_count/miss_count` | `pattern_metrics.hit_count/miss_count/inconclusive_count` |
| Bayesian 갱신 | (없음) | `posterior_alpha/beta/p` 동시 UPDATE — ADR-0024 산식 |
| `last_matched_at` | (없음) | UPDATE마다 `NOW()` 기록 |
| evidence-only(matched IS NULL) | inconclusive UPDATE만, 카운터는 catalog UPDATE | inconclusive UPDATE만, 매트릭 카운터 SKIP (no_metric 자연 계승) |
| `compactMatchedLine` 정렬 키 | `seed.hit_count` (in-memory) | `pattern_summary.total_hits` (view SELECT) |
| 함수 시그니처 | sync `(ctx, results) => string \| null` | **async** `(ctx, results) => Promise<string \| null>` |
| 매칭 부담 로그 | (없음) | `console.warn('[pattern-match] user=… date=… seeds=… elapsed=…ms')` |

#### Bayesian posterior 산식 (ADR-0024)

```
hit:  alpha' = alpha + 1, p' = (alpha + 1) / (alpha + beta + 1)
miss: beta'  = beta + 1,  p' = alpha / (alpha + beta + 1)
```

`posterior_p` 초기값 0.5 (uniform prior `alpha=beta=1`). 매트릭이 hit/miss 누적될수록 `p`가 실측 비율로 수렴.

#### evidence-only 시드 처리

매트릭이 0개인 시드(Phase 2 `no_metric` 패턴)는 `matched IS NULL`로 기록된다. `verifyDailyMatches`는:

1. `SELECT … WHERE trigger_activated = true AND matched IS NOT NULL` → hit/miss 카운터 UPDATE
2. `SELECT … WHERE trigger_activated = false OR matched IS NULL` → `verify_status='inconclusive'`만 박음. matched IS NULL이면 매트릭 카운터 SKIP (그래야 evidence-only 시드가 카운터에 오염을 안 줌).

#### 파일명 rename (ADR-0026 확장)

| 이전 | 이후 |
|------|------|
| `src/shared/saju-match.ts` | `src/shared/pattern-match.ts` |
| `src/cron/daily-saju-matching.ts` | `src/cron/daily-pattern-matching.ts` |
| `src/shared/__tests__/saju-match.test.ts` | `src/shared/__tests__/pattern-match.test.ts` |

import 일괄 갱신(15+ 파일): 8 life-signal-evaluator + 6 evaluator test + `insights.ts` comment + `life-cron.ts`. SLOT_TASKS 키 `dailySajuMatching`은 DB `notification_settings.slot_name` 호환성을 위해 보존(value만 `dailyPatternMatchingTask`로). 함수명도 `dailyPatternMatching*`로 일관 변경.

잔존 `saju-hypothesis.ts`·`saju-seed-fast-path.ts`·`scripts/saju-hypothesis-backtest.ts`·`weekly-report.ts`의 catalog 카운터 SELECT는 Phase 5 follow-up PR로 분리.

#### 후속 정리 항목

- `saju-seed-fast-path.ts`의 catalog `hit_count/miss_count` 표시 → view `total_hits/total_misses` 전환
- `weekly-report.ts`의 사주 시드 섹션 → view 기반 재구성
- `pattern_catalog.hit_count/miss_count/inconclusive_count` 컬럼 DROP (Phase 8)

#### 결정 기록

- [ADR-0023](../adr/0023-metric-unit-counter-and-summary-view.md) (counter source of truth) — Phase 4가 실행 단계
- [ADR-0024](../adr/0024-beta-binomial-bayesian-posterior.md) (Beta-Binomial posterior) — `posterior_alpha/beta/p` 산식
- [ADR-0026](../adr/0026-pattern-prefix-rename.md) (pattern_* prefix) — 파일명까지 확장

### 19. 본인 1명 패턴 발견 시스템 — Phase 5 (가설 발견·검증 파이프라인 target-type 확장 대응)

> 이슈: [#454](https://github.com/hyewon3938/slack-ai-agents/issues/454) · 계획서: `.claude/plans/454-phase-5-discovery-cards.md` · 관련 design-notebook: [personal-pattern-discovery.md](../design-notebook/personal-pattern-discovery.md)
>
> 한 줄 요약: ADR-0019 위 운영 결정 — UI 가시성(prefix)·노출 cap(종류별 분리)·동작 검증. discovery 통계 알고리즘(Fisher + BH-FDR)·임계치(`q<0.2`·`p<0.1`·`ratio≥1.3`·`n≥5`)는 변경 없음.

#### 변경 파일

- `src/agents/insight/hypothesis-discovery.ts` — `ActiveSignal`·`CandidateHypothesis`에 `patternKind: 'saju' | 'life_signal'` 필드 추가. `loadActiveSignals` SQL이 `pattern_kind` SELECT.
- `src/agents/insight/hypothesis-cards.ts` — `KIND_LABEL` 상수, `buildCandidateCard` header에 prefix(`[사주]` / `[생활]`), `buildWeeklyReviewBlocks` 후보 노출을 종류별 cap 5+5로 분리, 신규 후보 섹션 헤더에 종류별 카운트 표기, `ActiveHypothesisRow`에 `patternKind` + active row 라인에도 prefix.
- `src/cron/weekly-hypothesis-review.ts` — `loadSignalNames` → `loadSignalMeta` 전환, `pattern_kind`까지 함께 적재하여 `ActiveHypothesisRow.patternKind` 채움.
- `src/agents/insight/__tests__/hypothesis-cards.test.ts` (신규) — prefix·종류별 cap·카운트 헤더·0건 처리·active row prefix 검증.
- `src/agents/insight/__tests__/hypothesis-discovery.test.ts` (신규) — saju + life_signal 섞어 입력 시 두 후보 모두 `patternKind` 채워지는지 검증.

#### 카드 표시 어휘

| `pattern_kind` | prefix | 의도 |
|---|---|---|
| `saju` | `[사주]` | 사주 시드 (175개, Phase 1\~2 확정) |
| `life_signal` | `[생활]` | 생활 시드 (38개, Phase 3에서 도입) |

이모지 prefix(🌙/🏃 등) 후보가 있었으나, Slack iOS/macOS 간 이모지 렌더링 차이로 정렬이 깨지는 경우가 있어 텍스트 prefix 채택.

#### cap 분리 정책

신규 가설 후보는 `pattern_kind`별로 **각각 최대 5건**까지 노출 (합 최대 10건, 발견된 만큼만):

```typescript
const CANDIDATE_CAP_PER_KIND = 5;
const sajuCands = candidates
  .filter((c) => c.patternKind === 'saju')
  .slice(0, CANDIDATE_CAP_PER_KIND);
const lifeCands = candidates
  .filter((c) => c.patternKind === 'life_signal')
  .slice(0, CANDIDATE_CAP_PER_KIND);
```

배경: Phase 4까지 단일 `slice(0, 5)`였으나, 조합 풀이 352→4,686(13배) 늘면서 통계가 강한 saju 후보가 cap을 점유해 life_signal이 carbon-copy 가려지는 위험이 있었음. 종류별 cap으로 두 카테고리 모두 가시성 보장.

신규 후보 섹션 헤더에 종류별 카운트 표기:

```
*신규 후보 (사주 3 / 생활 1)* — 등록할 거 골라
```

#### DISCOVERY 임계치 유지 결정 근거

`q<0.2`·`p<0.1`·`ratio≥1.3`·`n≥5` 그대로. BH-FDR 보정 산식 `q_i = (p_i × N) / rank_i`에서 조합 수 N이 13배 늘면 q도 자동으로 그만큼 보수적으로 보정됨. 본 마스터 자체 헌장 5번 "임의값 박지 않기" 준수 — 운영 1\~3개월 누적 후 데이터 기반 재조정 후보 (마스터 close 시 follow-up 부록 E에 합류).

#### 운영 검증

머지 후 첫 월요일 08:00 KST 자동 가동 시점에 `#insight` 채널 카드 관측:

- 두 카테고리(`[사주]` / `[생활]`) prefix가 카드 header에 모두 노출되는지
- 신규 후보 섹션 헤더에 `사주 N / 생활 M` 카운트가 정확히 표기되는지
- life_signal 후보가 종류별 cap 분리 덕분에 카드에 살아남는지 (Phase 4까지 단일 cap에서는 saju 강 후보에 가려졌던 케이스)

운영 검증 결과는 design-notebook Phase 5 "회고" 섹션에 추가.

### 20. 본인 1명 패턴 발견 시스템 — Phase 6 (LLM 자율 매트릭 + 승인 게이트)

Phase 1\~5에서 결정론 매트릭만 평가되던 구조 위에 **LLM이 매트릭 후보를 자율 제안하는 슬롯**을 도입. 새 매트릭은 `status='pending'`으로 INSERT되고 사용자가 Slack 승인/거절 버튼을 눌러야 매칭 cron이 평가에 반영. v2 헌장 ④ (승인 게이트) 진입점.

#### 운영 형태

| 항목 | 값 |
|------|-----|
| routine 위치 | `~/.claude/scheduled-tasks/monthly-metric-suggest/SKILL.md` (repo 외부, Claude 앱 routines 기반 — [ADR-0027](../adr/0027-llm-async-routine-unification.md)) |
| cron 시각 | 매월 1일 09:30 KST (`30 9 1 * *`) |
| 모델 | Opus 권장 (사용자가 Claude 앱 model selector에서 지정) |
| 후보 cap | 월 최대 5개 ([ADR-0025](../adr/0025-llm-metric-approval-gate.md)) |
| 가동 채널 | `#insight` |
| idempotency | 같은 달에 `source='llm_autonomous'` INSERT 이력 있으면 즉시 종료 |

#### LLM 입력 풀 (3 결합, [ADR-0030](../adr/0030-llm-metric-suggest-input-and-cadence.md))

| 입력 | 출처 | 의도 |
|------|------|------|
| ① evidence JSONB 누적 | `pattern_matches`의 `verify_status='no_metric'` 행, 최근 60일 | Phase 2 evidence-only 시드에서 누적된 사용자 임상 단서 후보 |
| ② 시드 description | `pattern_catalog.description IS NOT NULL` 행 | Phase 2에서 박힌 사용자 임상 가설 hint |
| ③ 라이프 메트릭 표 | schedules / routine_records / sleeps / diary_meta_tags 30일 메타데이터 | 사용자 텍스트 원문 노출 없이 컨텍스트 제공 (헌장 ① 위 — 카운트·태그 enum·평균값만) |

추가 입력: ④ rejected 매트릭 30건 + ⑤ active 매트릭 — LLM이 중복 제안 회피 + 거절 재제안 자율 판단에 활용.

#### 거절 재제안 정책 (ADR-0030)

- `status='rejected'` 매트릭 목록을 LLM 입력에 노출
- LLM은 **새 근거**(누적 evidence 변화·다른 outcome·다른 window) 있을 때만 재제안
- 재제안 시 `rejection_diff` 필드에 이전 거절 대비 차이점 명시 의무 — 카드 detail에 "재제안 사유: ..." 줄로 노출
- 임의 N일 cool-down은 마스터 #434 헌장 "임의값 박지 않기" 위배라 채택 거부

#### 데이터 모델

`pattern_metrics` 테이블에 추가된 컬럼 (Phase 1 migration 065 + 본 phase migration 073):

| 컬럼 | 타입 | 의도 |
|------|------|------|
| `status` | `TEXT CHECK(active/pending/rejected)` | LLM 자율 매트릭은 `pending`으로 시작 |
| `source` | `TEXT CHECK(deterministic/llm_autonomous)` | 결정론 시드 vs LLM 자율 |
| `description` | `TEXT NOT NULL` | 사용자가 SQL 본문 검토 없이 의도 파악 가능한 자연어 |
| `proposed_at` | `TIMESTAMPTZ` | LLM 제안 시각 |
| `approved_at` | `TIMESTAMPTZ` | 사용자 승인 시각 |
| `rejected_at` | `TIMESTAMPTZ` | 사용자 거절 시각 (migration 073, 본 phase) |

#### 인터랙션 흐름

```
[매월 1일 09:30 KST]
        │
        ▼
[monthly-metric-suggest routine (Claude 앱)]
        │ ① idempotency 체크 → ② 입력 풀 수집 → ③ Opus 호출 → ④ INSERT pending
        ▼
[#insight 채널에 후보별 1메시지 (Block Kit 승인 카드)]
        │
        ▼
[사용자 클릭]
        │
        ├─ [승인] ─→ actions.ts:METRIC_APPROVE_ACTION_ID
        │             → UPDATE status='active', approved_at=NOW()
        │             → 매칭 cron 다음 회부터 평가 반영
        │
        └─ [거절] ─→ actions.ts:METRIC_REJECT_ACTION_ID
                      → UPDATE status='rejected', rejected_at=NOW()
                      → 다음 달 routine 입력 풀의 rejected 목록에 노출
```

#### fast path 명령어

| 명령어 | 정규식 | 동작 |
|--------|--------|------|
| `insight metric-list` | `/^\/?insight\s+metric-list[.?!]?$/` | `status='pending'` 매트릭 후보 20건 목록 조회 (디버깅·놓친 카드 재확인) |

자유 문장 부분추출 금지 헌장(`feedback_no_freeform_regex_extraction`) 준수 — 약속된 단일 명령어 매칭만.

#### 보안

- LLM `metric_sql`은 SELECT 단일 쿼리만 허용. INSERT/UPDATE/DELETE/DDL 키워드 발견 시 후보 폐기. 매칭 cron 실행 전에도 `verifyDailyMatches` 정규식 차단 (Phase 4).
- 액션 핸들러는 `resolveBodyUserId(body)` 통해 Slack user ID → DB user_id 매핑. 다른 user의 매트릭은 UPDATE 안 됨 (`WHERE user_id = $2`).
- routine은 DB Proxy API 경유 (Vercel→VM 직결 없음, [ADR-0004](../adr/0004-db-proxy-api.md))
- 사용자 텍스트 원문(diary content, schedule title, routine name)은 LLM 입력에 미포함 — 메타데이터만 (v2 헌장 ①).

#### 다음 phase 연결

Phase 7 (Bayesian update)에서 active 매트릭의 `posterior_alpha/beta/p`가 매칭 cron 평가 결과로 갱신. Phase 8 (인사이트 카드 UI)에서 active 매트릭의 verified 결과를 사용자에게 노출하는 카드 통합.

### 21. 본인 1명 패턴 발견 시스템 — Phase 7 (Bayesian posterior 헬퍼·카드 병기 + 시드 영향력 섹션)

**데이터 모델 (Migration 074)** — `pattern_stats`에 가설 단위 Beta-Binomial posterior 3컬럼 추가:

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `posterior_alpha` | NUMERIC(8,2) | prior Beta(1,1) + 누적 hit |
| `posterior_beta`  | NUMERIC(8,2) | prior Beta(1,1) + 누적 miss |
| `posterior_p`     | NUMERIC(6,4) | α / (α + β) |

기존 row(Phase 4 이후 1주분만 누적)는 NULL. 다음 weekly cron이 자연스럽게 채움 — 별도 backfill SQL 생략.

매트릭 단위 posterior(`pattern_metrics.posterior_alpha/beta/p`, Phase 4 도입)는 매칭 cron의 SQL inline UPDATE 그대로 유지(atomicity 보호). 가설 단위는 weekly UPSERT 흐름이 메모리 합산 → UPSERT 한 번이라 헬퍼로 산출.

**헬퍼 (`src/shared/bayesian-posterior.ts`)**:

| 함수 | 시그니처 | 용도 |
|------|---------|------|
| `updatePosterior(prior, 'hit'\|'miss')` | `BetaPosterior → BetaPosterior` | 단발 갱신(테스트·유닛 케이스) |
| `posteriorMean(α, β)` | `→ number` | 사후 평균 |
| `credibleInterval(α, β, conf=0.95)` | `→ {lower, upper}` | Beta inverse CDF로 신뢰구간 |
| `cumulativePosteriorFromHitMiss(h, m)` | `→ {alpha:1+h, beta:1+m}` | 누적 hit/miss → posterior |

라이브러리: `@stdlib/stats-base-dists-beta-quantile` (Beta inverse CDF 단일 함수).

**누적 산식 (`computeAndPersistWeeklyStats`)** — 가설별:

1. 이전 주들의 누적 hit/miss를 `pattern_stats`에서 SELECT (`SUM(rate_trigger × n_trigger_days)`로 derive)
2. 이번 주 hit/miss는 메모리에서 derive
3. `cumulativePosteriorFromHitMiss(priorHits + weekHits, priorMisses + weekMisses)` → α/β
4. `posteriorMean` + `credibleInterval` → mean + CI
5. UPSERT는 9컬럼 → 12컬럼 (α/β/p 추가)

> hit를 별도 컬럼으로 추가하지 않고 `rate_trigger × n_trigger_days`로 derive하는 이유: 기존 row만으로 충분, 스키마 변경 최소.

**UI 흐름**

가설 카드(`buildCandidateCard`)는 frequentist(p/q)와 Bayesian(사후/CI)를 한 줄에 병기:

```
[사주] *갑목일주* → `mood_high`
발현일 n=8 · trigger 50.0% vs baseline 20.0% · ratio 2.50x
p=0.040 q=0.150 · 사후 50% [21%, 79%]
```

주간 리뷰 카드 상단에 **시드 영향력 top 5** 섹션 신설(사주·생활 통합, `pattern_summary` view + 매트릭 α/β 합산 query). 정렬 기준은 **95% credible interval lower bound 내림차순** — N 적으면 CI가 자동으로 넓어져 lower 페널티 발생(임의 컷오프 회피, #434 헌장 ⑤ 준수). 안내문: `_사후 = 본인 패턴일 확률 추정 (50%=우연, 80%↑=강함) · [] = 95% 신뢰 구간 (좁을수록 정확)_`

**시드 영향력 데이터 소스**

`pattern_summary` view에는 `aggregate_posterior_p`(평균)만 노출되어 있고 α/β는 view contract에 없다. credible interval은 α/β 모두 필요하므로 별도 query로 `SUM(posterior_alpha), SUM(posterior_beta)` 추가 SELECT — view 시그니처는 보존(외부 의존 자산 보호).

**버튼 라벨 정리**

| Phase | Before | After |
|-------|--------|-------|
| Phase 4 가설 카드 | `가설 등록` / `이번엔 패스` | `가설 승인` / `가설 반려` |
| Phase 6 매트릭 카드 | `승인` / `거절` | `승인` / `반려` |

action_id, value, handler 동작, DB SQL은 그대로 — 사용자 노출 텍스트만 변경. dismiss 시 DB write 없음(자동 재발현 정책 유지).

**관련 결정**: [ADR-0024](../adr/0024-bayesian-posterior-update.md) (Beta-Binomial posterior 도입).

이슈 [#460](https://github.com/hyewon3938/slack-ai-agents/issues/460) · ADR-0024 실행 마무리 (신규 ADR 없음).

### 22. 본인 1명 패턴 발견 시스템 — Phase 8 (잔여 정리 + 마스터 close)

Phase 8 정체성 진화: 당초 "인사이트 카드 UI + 마스터 close"였으나 카드 UI는 Phase 5(가설 카드 일반화) / 6(LLM 매트릭 승인 카드) / 7(시드 영향력 섹션 + Bayesian 병기)에서 모두 흡수됨. 남은 작업은 **이전 phase가 미룬 정리 + 마스터 close 문서화 + follow-up 일괄 등록**. PR은 cleanup(8a) → close docs(8b) 2분할 (close docs가 cleanup 사실을 포함해야 정합).

#### Phase 8a (이슈 [#462](https://github.com/hyewon3938/slack-ai-agents/issues/462), 본 phase) — 코드 cleanup

##### A. `pattern_catalog` deprecated 카운터 컬럼 DROP

Phase 4가 매트릭 카운터를 `pattern_metrics`로 이전한 뒤 `pattern_catalog`의 4개 컬럼이 deprecated 잔존. 코드 전수 조사에서 직접 참조 없음을 확인 (`pattern-seed-fast-path.ts`의 `hit_count`/`miss_count` 변수는 `pattern_summary` view 별칭).

**마이그레이션 075 (전반부)** — `db/migrations/075_pattern_cleanup.sql`:

```sql
ALTER TABLE pattern_catalog
  DROP COLUMN IF EXISTS hit_count,
  DROP COLUMN IF EXISTS miss_count,
  DROP COLUMN IF EXISTS inconclusive_count,
  DROP COLUMN IF EXISTS last_matched_at;
```

시드 단위 합계는 Phase 4 이후 이미 `pattern_summary` view에서 derive (ADR-0023).

##### B. `matchAllSeedsForDay` per-seed try/catch 격리 + 에러 DB 기록

Phase 3 회고에서 식별된 위험: `matchAllSeedsForDay` 내 for 루프가 `evaluateTrigger`를 try/catch 없이 호출 → 한 시드 SQL 오류가 그날 cron 전체를 fail시킬 수 있음. Phase 4 follow-up [#456](https://github.com/hyewon3938/slack-ai-agents/issues/456) (`threshold sleep_minutes` hotfix)에서 실제 노출.

격리 + 에러 DB 기록 두 축:

- **격리**: 각 시드별 try/catch로 감싸 한 시드 실패가 다른 시드에 전파되지 않게. 기존 metric 단위 try/catch는 trigger 통과 후 일부 metric만 fail하는 케이스 보호 → 보존
- **DB 기록**: `pattern_matches.verify_status`에 `'error'` enum 추가 + `error_message JSONB` 컬럼 추가. trigger SQL 실패 시 row를 남겨 멱등성(같은 cron 재실행 시 자동 회복) + 후속 디버깅 자료 보장

**마이그레이션 075 (후반부)**:

```sql
ALTER TABLE pattern_matches
  ADD COLUMN IF NOT EXISTS error_message JSONB;

ALTER TABLE pattern_matches
  DROP CONSTRAINT IF EXISTS pattern_matches_verify_status_check;

ALTER TABLE pattern_matches
  ADD CONSTRAINT pattern_matches_verify_status_check
    CHECK (verify_status IN ('pending','hit','miss','inconclusive','no_metric','error'));
```

`verify_status` enum은 4종 검증 결과(`hit`/`miss`/`inconclusive`/`pending`) + 1종 데이터 부재(`no_metric`) + 1종 시스템 오류(`error`)로 정합 (#434 헌장 ⑤ "임의값 박지 않기"에 부합).

##### 코드 변경 — `src/shared/pattern-match.ts`

- `SeedMatchResult` interface에 `triggerError: string | null` 필드 추가
- `matchAllSeedsForDay` for 루프 outer try/catch로 `evaluateTrigger` 격리 — 실패 시 `triggerActivated: false`, `triggerError: error.message`로 push
- `recordDailyMatches`에서 `triggerError` truthy → `verify_status='error'`, `error_message=JSONB({reason})`로 INSERT. ON CONFLICT 업데이트에 `error_message` 포함 → 다음날 같은 시드가 정상이면 자동 NULL 회복 (멱등)
- `verifyDailyMatches`는 `WHERE verify_status='pending'`만 잡으므로 `'error'` row는 자연 SKIP — 카운터 갱신 영향 0 (no_metric과 동일 처리)

#### Phase 8b (이슈 [#464](https://github.com/hyewon3938/slack-ai-agents/issues/464)) — 마스터 close docs + follow-up 이슈 일괄 등록

코드 변경 없음. docs (README/project-history/design-notebook/features/domains) + GitHub Issues follow-up 등록. 마스터 #434 **close 2026-05-29**.

- design-notebook 마무리 회고 섹션(8 phase 총평 + 헌장 작동 + 포기·핸드오프 + 후속 마스터 후보) + 부록 E(운영 1\~3개월 후 도입 검토 5 카테고리)
- features.md 마스터 라인 갱신(Phase 8a/8b close), project-history.md 마일스톤 추가, README.md W12 행 추가
- follow-up 이슈 카테고리별 5\~6건 묶음 등록: 통계 도구(SPRT/CPD/dispersion) / Phase 6 LLM 매트릭 routine 운영 회고 / Phase 7 Bayesian + 시드 영향력 운영 회고 / Phase 2.5 운 레벨 분포 분석 회고 / 잔소리 일원화 / 기타 미해결 잔여(카테고리 가중치 자동 튜닝 · 에러 row retention 등)

설계 결정 배경: [design-notebook personal-pattern-discovery](../design-notebook/personal-pattern-discovery.md) Phase 8 섹션 + 마무리 회고

### 23. 일일 종합 인사이트 (마스터 A — Phase A3, #475)

매일 아침 사주 일운 + 학습된 개인 패턴을 신뢰도 강도별로 종합해 인사이트 채널에 단일 메시지로 발송. 개인화 주입 지점을 weekly-fortune **생성**에서 매일 **발송** 시점으로 이동 (상세 [ADR-0031](../adr/0031-daily-insight-synthesis.md)).

**routine**: `~/.claude/scheduled-tasks/daily-insight/SKILL.md` (Claude 앱 routine, repo 외부). 매일 08:00 KST, Opus, 인사이트 채널. DB Proxy API로 접근 (ADR-0027).

**3층 종합 구조**:

| 레이어 | 소스 | 표현 강도 |
|--------|------|----------|
| 베이스 — 오늘 사주 일운 | `fortune_analyses` (weekly-fortune 생성물 오늘치) | 만세력 교과서 해석 |
| 검증 — 인과 단언 | 오늘 발현 시드 ∩ `saju_influence_summary` verified/accumulating | "너는 X일 때 실제로 Y하더라" |
| 현황 — 배경 맥락 | 오늘 발현 시드 중 미검증(recent) | "오늘 이런 기운·신호 활성" — **인과 주장 금지** |

**데이터 수집** (메트릭/카운트만, diary 원문 입력 금지):
- 오늘 일운: `fortune_analyses WHERE period='daily' AND date=CURRENT_DATE`
- 오늘 발현 시드: `pattern_matches (date=CURRENT_DATE, trigger_activated=true)` JOIN `pattern_catalog` + `saju_influence_summary`(tier 판정). 사주 시드(stem/branch/ganji/relation/sibiunsung/element_density/cumulative_pillar_count)와 `life_signal`을 레이어로 분리 표시
- `life_themes` active

**멱등**: `daily_insight_log (user_id, date) UNIQUE` (마이그레이션 076). `INSERT ... ON CONFLICT DO NOTHING RETURNING` — 비면 "이미 발송, 종료".

**파이프라인 순서**: 매칭(`dailySajuMatching`) **07:00** → 종합 **08:00**. 매칭 선행으로 그날 발현 시드를 종합이 읽음 (구 09:00에서 당김, 마이그레이션 076). 매칭 cron은 누락일 자동 백필 포함 — `daily-pattern-matching.ts`의 "마지막 매칭일+1~오늘" 루프 (14일 상한).

**종료 조건**: ① 오늘 일운 미생성(weekly-fortune 누락) → "사주 일운 미생성, 종료" ② 이미 발송(멱등) → 종료.

**헌장 준수**: ① diary 원문 미입력 (view description·시드명·카운트만) / ④ tier별 강도 차등. view·매칭에 **있는 시드만** 사용 — 새 패턴 생성 금지 (할루시네이션 차단).

**구 insightMorningTask 폐기**: 아침 일운 포맷 알림(Node.js cron, LLM 없음)은 이 routine으로 이관. `SLOT_TASKS`·DB 슬롯(`insightMorning` active=false)에서 제거 (ADR-0027 — LLM 비동기는 routine으로).

### 24. 매트릭 중심 패턴 검증 — Phase 1 (스키마 + 신호 전역화, #479)

시드 종속 `pattern_metrics`를 **전역 신호 정의(`signal_defs`)** + **(시드 × 신호) 검증 단위(`pattern_links`)** 로 분리. (시드 × 신호) 쌍 자체가 검증 대상 가설이며 별도 가설 엔티티는 폐기 (상세 [ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md), 통계 스택 [ADR-0032](../adr/0032-metric-first-verification-statistics.md)).

**데이터 모델** (마이그레이션 077):

| 테이블 | 역할 | 핵심 컬럼 |
|--------|------|----------|
| `signal_defs` | 전역 신호 정의 (시드 무관) | `kind`(sql\|tag), `sql_body`·`direction`·`value_type`·`threshold`·`domain`·`window_days`(sql), `tag_name`(tag), `source`(seed\|llm), `status`(active\|pending\|rejected) |
| `pattern_links` | (시드 × 신호) = 가설 + 누적 검증상태 | `seed_id`×`signal_id` UNIQUE, `source`(manual\|discovery\|llm), `status`(active\|pending\|weak\|confirmed\|rejected\|archived), `hit/miss/inconclusive_count`, `posterior_*`, 검증결과(`test_type`·`effect`·`p_value`·`q_value`·`e_value`·`test_detail`·`confound`) |

- **신호 종류**: `kind=sql`(객관 SQL 측정, 1차) — 기존 매트릭 SQL + off-day 대조 판정(`direction`). `kind=tag`(일기 메타 22태그, 보조) — 그날 태그 존재 여부를 binary로 평가. 객관 SQL이 1차, 주관 태그가 보조 (ADR-0033 §5, 확증편향 방어).
- **검증결과 컬럼**(`e_value`·`test_detail`·`confound` 등)은 P1에서 **선언만** — 로직은 P2(주간 엔진)/P3(통계 증강). 헌장 ④ "후속 미루지 않기"에 따라 컬럼은 미리 둠.

**이관 매핑** (077, 데이터 독립 검증 DO 블록이 DROP 전 대조 — 불일치 시 전체 롤백):

| 원천 (`pattern_metrics` 84) | → signal_defs (71) | → pattern_links (84, counters 1:1) |
|------|------|------|
| 비-diary 매트릭 49 | sql 신호 49 (1:1, `_legacy_metric_id` 추적) | sql 링크 49 |
| diary 매트릭 35 | tag 신호 22 (`tag='X'` SQL 추출 → distinct dedup) | tag 링크 35 (추출 tag JOIN) |

- `value_type`: `flag_present` → `binary`, 나머지 → `continuous`.
- `source`: `llm_autonomous` → `llm`(signal)·`llm`(link), 그 외 → `seed`(signal)·`manual`(link).
- pending 매트릭(LLM 미승인, 5건 = sql 3 + diary 2) → 링크 `status='pending'`(매칭 제외). 매칭 게이트 = `link.status='active' AND signal.status='active'`.
- 카운터 합(hit/miss/inconclusive) 이관 전후 보존.

**평가 흐름** (`pattern-match.ts`): `loadActiveSeeds`가 `pattern_links × signal_defs`(둘 다 active) 조회 → `evaluateMetric`이 `kind`로 분기(sql=SQL+baseline/임계, tag=`diary_meta_tags` 존재 여부). 일별 cron(`daily-pattern-matching.ts`, 07:00)은 매칭 + `pattern_matches` 기록(raw trigger-log) + #life 한 줄 잔소리.

**P1 경계 — 무탈 우선**:

| 대상 | 처리 | 이유 |
|------|------|------|
| `pattern_matches` | **유지** (archive·transient는 P2) | daily-insight #insight가 `saju_influence_summary` recent tier(최근 7일 trigger, 96/97행)로 의존 (ADR-0031). 지속 검증을 대체할 P2 주간 엔진이 생긴 뒤 transient 전환이 정합적 |
| 일별 verify(카운터 확정) | **제거** | 카운터는 링크에 누적(이관 완료) → P2 주간 엔진이 raw에서 윈도우 결정론 재계산 |
| confirmed 가설 일일 라인 | **제거** (`pickConfirmedHypothesisLines`) | `pattern_hypotheses`/`pattern_stats` DROP. P2가 `pattern_links` confirmed로 복원 |
| `weekly-hypothesis-review` | **중단** (플래그) | 가설×통계 테이블 DROP — P2 주간 검증 엔진으로 재구축 |
| `pillar-level-distribution-review` | **유지** | `pattern_matches`(유지)·`pattern_catalog`만 읽어 무탈 |
| 매트릭 승인/가설 등록 인터랙션 | **중단** (플래그) | 승인 게이트가 `pattern_links` 기반으로 P5 재설계 |

**뷰 재정의** (077): `pattern_summary`(컬럼 계약 보존, `pattern_links` 집계로 derive — weekly-report·fast-path 호환), `saju_influence_summary`(verified tier=가설×통계 제거, 0행이었음 → accumulating·recent 2층, recent는 `pattern_matches` 유지로 daily-insight 무탈).

**폐기**: `pattern_hypotheses`·`pattern_stats`(0행)·`pattern_metrics`(이관 완료) DROP.

**헌장 준수**: ① 정량 매트릭 1차·태그 보조 (kind 분기) / ② off-day 대조 (신호 전역 측정) / ④ 후속 미루지 않기 (검증결과 컬럼 미리 선언). **다음 phase**: P2 주간 검증 엔진(window 재계산 + Fisher/BH-FDR + status 전이 + `pattern_matches` archive/transient 전환).

> 계획서 `.claude/plans/479-p1-schema.md`, 서사 [design-notebook](../design-notebook/metric-first-verification.md) Phase 1 섹션.

## 파일 구조

```
src/agents/insight/
├── index.ts                       # 에이전트 생성, fast path 매칭, LLM 에이전트 루프
├── prompt.ts                      # 시스템 프롬프트 빌더 (DB 데이터 실시간 로드)
├── actions.ts                     # 인터랙티브 버튼 핸들러 (가설 등록·매트릭 승인/거절은 #477 P1 비활성, P2/P5 재설계)
├── blocks.ts                      # Slack Block Kit 메시지 빌더
├── diary-fast-path.ts             # 일기 저장 + 자연스러운 응답
├── saju-seed-fast-path.ts         # 사주 시드 보기/끄기/켜기 (Phase 3)
├── hypothesis-discovery.ts        # Phase 4 자동 패턴 발견 (setup/recurring)
├── hypothesis-cards.ts            # Phase 4 카드 빌더 + 액션 payload
└── metric-approval-cards.ts       # Phase 6 LLM 매트릭 후보 카드 + 승인/거절 payload

src/shared/
├── pattern-match.ts               # 매칭 엔진 (evaluateTrigger + evaluateMetric kind=sql|tag). #477 P1: pattern_links × signal_defs 기반
├── saju-mappings.ts               # 십성 알고리즘 계산 (LLM 프롬프트용)
├── insight-thresholds.ts          # Phase 1/3 인사이트·시드 임계치 단일 관리 (Phase 4 임계치는 pattern-hypothesis.ts 상수)
├── insights.ts                    # Phase 1 SQL 결정론 11종 (confirmed 가설 라인은 #477 P1에서 제거, P2 복원)
└── pattern-hypothesis.ts          # Fisher + BH-FDR + lifecycle (#477 P1: 주간 엔진 P2 재구축까지 미사용)

src/cron/
├── daily-pattern-matching.ts              # 07:00 사주 일일 매칭 + 갭 자동 백필 (#477 P1: verify·가설 라인 제거, raw 기록 유지)
├── diary-meta-extract.ts                  # 일기 → enum 태그 추출 cron (Phase 3, Opus)
├── weekly-hypothesis-review.ts            # 월 08:00 주간 가설 리포트 (#477 P1: P2 주간 엔진까지 비활성)
└── pillar-level-distribution-review.ts    # 월 09:15 운 레벨 분포 분석 (Phase 2.5, #477 P1 유지)

scripts/
├── saju-hypothesis-backtest.ts    # Phase 4 임계치 튜닝 CLI
└── generate-saju-seeds.ts         # Phase 3 사주 시드 생성기 (pattern_catalog/metrics 어휘, Phase 1 rename 반영)

db/migrations/  (마스터 #434 Phase 1 — 2026-05-27)
├── 063_pattern_rename.sql                       # 5 테이블 + FK 2종 + 인덱스 6종 rename
├── 064_pattern_trigger_target_type_and_kind.sql # CHECK 확장 + pattern_kind 컬럼
├── 065_pattern_metrics_extension.sql            # 13 컬럼 + 부분 인덱스
├── 066_pattern_metric_backfill.sql              # description placeholder + 카운터 이전 + Bayesian α/β/p 초기화
├── 067_pattern_summary_view.sql                 # seed-level 집계 view 신설
└── 068_saju_influence_summary_rebuild.sql       # view body 재정의 (이름·컬럼 contract 보존)

db/migrations/  (마스터 #434 Phase 2 — 2026-05-28)
├── 069_pattern_matches_no_metric.sql            # matched NULL 허용 + verify_status='no_metric'
└── 070_saju_seed_pool.sql                       # 사주 시드 풀셋 161개 INSERT

db/migrations/  (마스터 #434 Phase 2.5 — 2026-05-28)
└── 071_pattern_signals_pillar_level.sql         # pillar_level 컬럼 + cumulative_pillar_count trigger
                                                 # + expense_category_present 메트릭 + 14 신규 시드
                                                 # + pillarLevelDistributionReview 슬롯

db/migrations/  (마스터 #434 Phase 6 — 2026-05-29)
└── 073_pattern_metrics_rejected_at.sql          # rejected_at TIMESTAMPTZ (ADR-0030 거절 재제안 입력)

db/migrations/  (마스터 #434 Phase 7 — 2026-05-29)
└── 074_pattern_stats_posterior.sql              # posterior_alpha/beta/p (가설 단위 Beta-Binomial, ADR-0024 실행)

db/migrations/  (마스터 #434 Phase 8a — 2026-05-29)
└── 075_pattern_cleanup.sql                      # catalog deprecated 카운터 DROP + pattern_matches.error_message + verify_status='error' enum

db/migrations/  (마스터 A Phase A3 — 2026-06-03)
└── 076_daily_insight.sql                        # daily_insight_log + 매칭 07:00 + insightMorning 비활성

~/.claude/scheduled-tasks/  (Claude 앱 routines, repo 외부)
├── monthly-metric-suggest/SKILL.md              # Phase 6 매월 1일 09:30 LLM 매트릭 후보 제안
└── daily-insight/SKILL.md                       # 일일 종합 인사이트 매일 08:00 (마스터 A A3, #475)
```
