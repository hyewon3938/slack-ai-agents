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

표시 포맷: 공유 헬퍼 `src/shared/fortune-format.ts`의 `formatFortuneText` — `summary` *볼드* + `analysis` 본문 + `advice` _기울임_ 결합. insightMorningTask(아침 일운 푸시)도 동일 헬퍼 사용.

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
- 주간 자동 분석(weekly-saju-review)으로 감지, 사용자 수동 관리 가능
- pattern_type: sipsin(십신) / ganji(특정 글자) / relation(합/형/충) / sibiunsung(십이운성)
- **분석 도메인**: 일기, 수면, 지출, 일정, 루틴 (cross-domain 통합 분석, 28일 롤링 윈도우)
- **evidence 표준 형식**: `{date, domain, summary, fortune_element, ...domain_specific}` — 도메인 추가(식사·운동 등) 시 마이그레이션 없이 확장 가능. 상세는 [ADR 0011](../adr/0011-saju-patterns-cross-domain.md) 참조
- 같은 trigger_element가 여러 도메인에 발현하면 분리하지 않고 같은 row의 evidence에 누적
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
- `saju_signal_catalog` — 시드 정의 (name / sipsin / trigger_type / trigger_target / active / hit_count / miss_count / inconclusive_count / source='seed'|'llm_promoted')
- `saju_signal_metrics` — 시드 1:N 메트릭 (metric_key / direction / threshold / sql_template)
- `saju_daily_matches` — 일일 매칭 결과 (signal_id / date / trigger_activated / matched / metric_values JSONB / verify_status='pending'|'hit'|'miss'|'inconclusive')
- `diary_meta_tags` — 일기 LLM enum 태그 (date / tag / source='llm')

#### Polymorphic Trigger 6종

시드의 발현 조건은 다음 6가지 중 하나로 정의 (`saju_signal_catalog.trigger_type`):

| trigger_type | 의미 | 예시 |
|--------------|------|------|
| stem | 일운 천간이 특정 글자 | `갑` 들어오면 발현 |
| branch | 일운 지지가 특정 글자 | `오` 들어오면 발현 |
| ganji | 일운 60갑자가 특정 조합 | `갑오` 들어오면 발현 |
| element_density | 사주 8글자 + 일운 2글자 중 특정 오행 ≥ N개 | 토 5개 이상이면 발현 |
| sibiunsung | 일간 기준 일운 지지의 12운성 | `사지` 들어오면 발현 |
| relation | 본명 지지와 일운 지지의 관계 | `진술충` 발현 |

#### 메트릭 5방향

시드 trigger 활성 일에 metric을 평가, baseline과 비교 (`saju_signal_metrics.direction`):

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
   - 메트릭 조건 충족 → `hit`, `signal_catalog.hit_count++`
   - 메트릭 조건 미충족 → `miss`, `signal_catalog.miss_count++`
   - 메트릭 SQL 데이터 부족 (null/0건) → `inconclusive`, `signal_catalog.inconclusive_count++`
2. **오늘 활성 시드 평가** — 6가지 trigger 평가 → `saju_daily_matches` UPSERT (`verify_status='pending'`)
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
[09:00 cron] ──→ [evaluateTrigger 6종] ──→ saju_daily_matches (verify_status=pending)
                                              ↓
                                       [매칭된 시드 → #life 한 줄]
                                              ↓ (다음날)
                                       [메트릭 SQL 실행] ──→ hit/miss/inconclusive
                                              ↓
                                       [signal_catalog 카운터 증가]
                                              ↓ (주간)
                                       [약한 시드 알림 → #insight]
```

#### Phase 5 확장 가능성

동일 polymorphic trigger 구조로 월운/세운/대운 확장 가능. `period` 컬럼 + `period_scope` 시드 컬럼 추가만으로 구조적 확장. 단 검증 사이클이 길어 통계 누적 속도 차이 큼 (월운 \~2년, 세운 \~28년). 상세: [#408](https://github.com/hyewon3938/slack-ai-agents/issues/408).

설계 배경 및 대안 비교는 [ADR-0017](../adr/0017-saju-ganji-master-normalization.md) 참조.

### 11. 프로액티브 인사이트 v2 — Phase 4 (가설-검증 정량 파이프라인)

> TODO(`/build`): 구현 후 본문 채우기. Phase 4 산출물 요약:
> - **데이터 모델**: `saju_hypotheses` (가설 정의) + `saju_stats` (주간 통계 시계열) 테이블 + migration 058/059
> - **enum 확장**: `diary_meta_tags` 16 → 22 (wealth_awareness / self_observation / social_activity / physical_activity / task_completion / clumsy_overflow 추가, self_observation 정의 명확화)
> - **통계 알고리즘**: Fisher's exact test + rate ratio + BH-FDR (`src/shared/saju-hypothesis.ts`)
> - **자동 패턴 발견**: 1차 셋업(수동 1회) + 운영(주간 cron) 단일 인프라
> - **가설 lifecycle**: active → confirmed (n≥30 + q<0.05) / rejected (n≥30 + rate→1) / archived (수동)
> - **Block Kit 카드**: 후보 카드 (등록/폐기 버튼) + 액션 핸들러
> - **주간 cron**: `weekly-hypothesis-review` 월요일 08:00 KST (신규 슬롯, 기존 weeklyReport와 분리)
> - **일일 통합**: confirmed 가설 → Phase 1 결정론 11패턴 확장 슬롯으로 자동 합류 (11패턴 코드 무수정)
> - **LLM 사용**: enum 추출 1회만 (Sonnet → Opus 이관, [#409](https://github.com/hyewon3938/slack-ai-agents/issues/409))
> - **회고 / 운영 메트릭 / 임계치 튜닝 노트**

설계 배경 및 대안 비교는 [ADR-0019](../adr/0019-saju-hypothesis-verification-pipeline.md) 참조.

## 파일 구조

```
src/agents/insight/
├── index.ts                  # 에이전트 생성, fast path 매칭, LLM 에이전트 루프
├── prompt.ts                 # 시스템 프롬프트 빌더 (DB 데이터 실시간 로드)
├── actions.ts                # 인터랙티브 버튼 핸들러
├── blocks.ts                 # Slack Block Kit 메시지 빌더
├── diary-fast-path.ts        # 일기 저장 + 자연스러운 응답
└── saju-seed-fast-path.ts    # 사주 시드 보기/끄기/켜기 (Phase 3)

src/shared/
├── saju-match.ts             # Phase 3 매칭 엔진 (evaluateTrigger 6종 + evaluateMetric)
├── saju-mappings.ts          # 십성 알고리즘 계산 (LLM 프롬프트용)
├── insight-thresholds.ts     # 인사이트·시드 임계치 단일 관리
└── insights.ts               # Phase 1 SQL 결정론 11종

src/cron/
├── daily-saju-matching.ts    # 09:00 사주 일일 매칭 (Phase 3)
└── diary-meta-extract.ts     # 일기 → enum 태그 추출 cron (Phase 3)
```
