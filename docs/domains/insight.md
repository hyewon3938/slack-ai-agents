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
- 누적된 패턴은 시스템 프롬프트 조회에 계속 사용. 갱신 routine(구 `weekly-saju-review`)은 2026-05-26 비활성화 (마스터 #421 A1 신 routine 검증 후 archive 예정)
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

Phase 3까지는 11종 결정론 패턴 + 60갑자 일일 매칭으로 "기록"만 했다. Phase 4는 그 위에 통계적으로 검증된 가설만 잔소리로 노출하는 자동 파이프라인을 얹는다. 사람 직관(혹은 LLM 추측)이 아니라 누적 데이터의 효과량 + p-value로 active/confirmed/rejected를 판정.

#### 데이터 모델 (migration 058)

| 테이블 | 역할 | 키 컬럼 |
|--------|------|---------|
| `saju_hypotheses` | 가설 정의 + 현재 상태 | `trigger_spec` JSONB, `enum_target`, `status`, `source` |
| `saju_stats` | 주간 통계 시계열 (`UNIQUE(hypothesis_id, week_start)`) | `n_trigger_days`, `n_total_days`, `rate_trigger`, `rate_baseline`, `rate_ratio`, `raw_p`, `fdr_q` |

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
- `hypothesis_register`: `INSERT INTO saju_hypotheses (status=active, source=auto_discovered)`
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

`pickConfirmedHypothesisLines`는 `saju_hypotheses` confirmed × 오늘 `saju_daily_matches.trigger_activated = true` JOIN. Phase 1 11패턴 코드는 **무수정** — confirmed 가설이 11패턴 옆에 자동 합류하는 것은 별도 함수로 분리해 dedupe 로직과 격리.

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

- **Phase 5-A** 월운 매칭: saju_daily_matches → period 컬럼 추가, saju_signal_catalog → period_scope 컬럼 추가, 월운 매칭 cron(매월 1일), 월 단위 baseline 윈도우 별도 설계
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

### 15. 본인 1명 패턴 발견 시스템 — Phase 2 (사주 시드 풀 셋)

> TODO(`/build`): 구현 후 본문 채우기. Phase 3에서 작성된 사주 시드 카탈로그 풀(전체) 검토 + 누락 보완 (s1 일부만 작성된 상태에서 풀 셋으로). 누락 시드 식별 방법, 추가 시드 목록, 매트릭 description 작성. `pattern_catalog`·`pattern_metrics` 어휘 기준.

### 16. 본인 1명 패턴 발견 시스템 — Phase 3 (life_signal 시드 풀 셋)

> TODO(`/build`): 구현 후 본문 채우기. `life_signal` 시드 1차 셋(14\~20개 — 요일 7 + 주말 1 + 평일 1 + 월말 1 + 월초 1 + 계절 4 + 기타). 각 시드의 매트릭(SQL + window_days + description). 결정론 매트릭으로 작성 (`pattern_metrics.source = 'deterministic'`).

### 17. 본인 1명 패턴 발견 시스템 — Phase 4 (매칭 cron + view 정비)

> TODO(`/build`): 구현 후 본문 채우기. 매칭 cron이 `trigger_target_type='life_signal'`도 처리하도록 확장 (필요 시 파일명 변경 검토 — `daily-saju-matching` → `daily-pattern-matching`). `pattern_summary` view 본문 작성 + 사용 예시. 매칭 시 `pattern_metrics`의 hit/miss/inconclusive UPDATE 로직 (catalog 카운트는 backfill 후 미사용).

### 18. 본인 1명 패턴 발견 시스템 — Phase 5 (가설 발견·검증 업데이트)

> TODO(`/build`): 구현 후 본문 채우기. `hypothesis-discovery`가 `life_signal` trigger 포함하도록 일반화. weekly 가설 리뷰 카드 본문에 `pattern_kind` 표시. 검증 매트릭 수 증가에 따른 BH-FDR 그룹 정의.

### 19. 본인 1명 패턴 발견 시스템 — Phase 6 (LLM 자율 매트릭 + 승인 게이트)

> TODO(`/build`): 구현 후 본문 채우기. 월간 LLM 슬롯이 매트릭 후보 생성, 월 cap 5개. Slack `/insight metric-approve` 명령어 + Block Kit 승인 카드 (`metric-approval-cards.ts`). 승인 시 `pattern_metrics.status = 'active'` 전환. 거절 시 `'rejected'`.

### 20. 본인 1명 패턴 발견 시스템 — Phase 7 (Bayesian update)

> TODO(`/build`): 구현 후 본문 채우기. `src/shared/bayesian-posterior.ts` 헬퍼(\~100줄), Beta-Binomial 사후 갱신, `pattern_metrics.posterior_p` UPDATE. 가설 카드에 frequentist p값 + Bayesian posterior 병기. beta inverse CDF 라이브러리 선택.

### 21. 본인 1명 패턴 발견 시스템 — Phase 8 (인사이트 카드 UI + 마스터 close)

> TODO(`/build`): 구현 후 본문 채우기. `#insight` 채널 패턴 발견 카드 (Block Kit). `life_signal` 패턴(요일 효과 등)도 같은 카드에서 출력. 마스터 회고 + 운영 1\~3개월 후 follow-up 이슈 7건 일괄 등록 (SPRT, Change Point Detection, informed prior, 카테고리 가중치 자동 튜닝, 가설 자동 제거, 매트릭 자동 비활성화, 웹 대시보드 승인 페이지).

설계 결정 배경: [design-notebook personal-pattern-discovery](../design-notebook/personal-pattern-discovery.md)

## 파일 구조

```
src/agents/insight/
├── index.ts                       # 에이전트 생성, fast path 매칭, LLM 에이전트 루프
├── prompt.ts                      # 시스템 프롬프트 빌더 (DB 데이터 실시간 로드)
├── actions.ts                     # 인터랙티브 버튼 핸들러 (+ Phase 4 가설 등록/폐기)
├── blocks.ts                      # Slack Block Kit 메시지 빌더
├── diary-fast-path.ts             # 일기 저장 + 자연스러운 응답
├── saju-seed-fast-path.ts         # 사주 시드 보기/끄기/켜기 (Phase 3)
├── hypothesis-discovery.ts        # Phase 4 자동 패턴 발견 (setup/recurring)
└── hypothesis-cards.ts            # Phase 4 카드 빌더 + 액션 payload

src/shared/
├── saju-match.ts                  # Phase 3 매칭 엔진 (evaluateTrigger 6종 + evaluateMetric)
├── saju-mappings.ts               # 십성 알고리즘 계산 (LLM 프롬프트용)
├── insight-thresholds.ts          # Phase 1/3 인사이트·시드 임계치 단일 관리 (Phase 4 임계치는 saju-hypothesis.ts 상수)
├── insights.ts                    # Phase 1 SQL 결정론 11종 + Phase 4 confirmed 가설 라인
└── saju-hypothesis.ts             # Phase 4 통계 (Fisher + BH-FDR + lifecycle)

src/cron/
├── daily-saju-matching.ts         # 09:00 사주 일일 매칭 + confirmed 가설 슬롯 (Phase 3/4)
├── diary-meta-extract.ts          # 일기 → enum 태그 추출 cron (Phase 3, Opus)
└── weekly-hypothesis-review.ts    # 월 08:00 주간 가설 리포트 (Phase 4)

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
```
