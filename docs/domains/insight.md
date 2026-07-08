# 명리학 인사이트 (Insight)

> **처음 보는 사람을 위한 설명서**: [docs/explainers/insight-v2.md](../explainers/insight-v2.md) (사주 부록: [insight-v2-saju.md](../explainers/insight-v2-saju.md))

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
-- > 2026-07-05 은퇴: 봇 프롬프트에서 미사용. 테이블·데이터는 이력으로 존치.
-- > 역할은 profile_summary 실측 패턴 + pattern_links 검증축이 대체.
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

### 4. 사주 패턴 (saju_patterns) — 🗑️ 봇 프롬프트 미사용 (2026-07-05)
> 갱신 routine(구 `weekly-saju-review`)은 2026-05-26 비활성화. 봇 시스템 프롬프트(`buildInsightSystemPrompt`)에서도 2026-07-05 참조 제거 — 테이블·누적 row는 이력으로 존치, 새 조회 경로 없음. 역할은 `saju_profiles.profile_summary`(실측 패턴 포함) + 검증 시드 파이프라인(`pattern_links`)이 대체.

- pattern_type: sipsin(십신) / ganji(특정 글자) / relation(합/형/충) / sibiunsung(십이운성)
- **분석 도메인**: 일기, 수면, 지출, 일정, 루틴 (cross-domain 통합 분석, 28일 롤링 윈도우)
- **evidence 표준 형식**: `{date, domain, summary, fortune_element, ...domain_specific}` — 도메인 추가(식사·운동 등) 시 마이그레이션 없이 확장 가능. 상세는 [ADR 0011](../adr/0011-saju-patterns-cross-domain.md) 참조
- 같은 trigger_element가 여러 도메인에 발현하면 분리하지 않고 같은 row의 evidence에 누적
- 감지 횟수 추적 (detection_count), 신뢰도 평가 (confidence)
- 비활성화 시 `active = false`, `deactivated_at = NOW()`
- **일일 종합 인사이트(§23)는 `saju_patterns`를 쓰지 않는다** — `saju_influence_summary` view(#477 P3: verified/emerging/recent 3-tier, ### 26)를 사용.

### 5. 시스템 프롬프트 구성
`buildInsightSystemPrompt()`가 실시간으로 아래 데이터를 로드하여 프롬프트에 주입:
- 활성 life_themes (현재 삶의 맥락)
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

> `overdueAlert`의 밀린 일정 수는 `src/shared/life-queries.ts`의 `countOverdueTasks`(task 타입만, event 제외)를 단일 소스로 계산 — #life 아침 잔소리·일정 맥락과 동일 정의. 상세는 [schedule.md](schedule.md) "밀린 일정" 참조.

#### 동적 노출

- 매일 morning(09:05) / night(23:55): priority ≥5인 패턴 최대 3개, 같은 도메인은 priority 최상위 1개만
- 주간 리포트(월요일 09:00): weekly 패턴 전체 (cap 없음, Block Kit으로 표시)
- 0건이면 매일 메시지 발송 안 함 (no-news is good news). 주간 리포트는 "잔잔했어" 한 줄 발송.

#### 임계치

모든 임계치는 `src/shared/insight-thresholds.ts`의 `INSIGHT_THRESHOLDS`에서 단일 관리. Phase 4 사주 매핑 단계에서 튜닝 가능.

상세 배경 및 대안 비교는 [ADR 0014](../adr/0014-insight-engine-unification.md) 참조.

### 9. 프로액티브 인사이트 v2 — Phase 2 (LLM 자율 슬롯) — 🗑️ 은퇴 (2026-06-07)

> **은퇴됨.** #393 v2 "LLM 자율 발견 슬롯"은 생애 0건 산출(`llm_insights` 빈 테이블)로 사실상 휴면이었고, #477 헌장(정량 통계 1차 + LLM 의존 최소화)으로 발견 역할이 통계 기반 §29(P5a 발굴) + §30(P5b LLM 신호 제안)으로 이관되며 폐기. cron 슬롯 3개·`llm_insights` 테이블(마이그레이션 084 DROP)·코드(`llm-insight*`)·`LLM발견` fast path 전부 제거. [ADR-0016](../adr/0016-llm-autonomous-slot-outcome-verification.md)(Superseded) → [ADR-0043](../adr/0043-retire-v2-llm-autonomous-discovery.md). 아래는 역사 기록.

Phase 1(결정론적 SQL 11종)에 더해 **주간/월간 한정 LLM 자율 발견 슬롯**을 운영했다. LLM이 사용자 데이터 요약 컨텍스트를 보고 "신호 → 가설 → 검증 SQL"을 스스로 작성하면, N일 뒤 cron이 SQL을 실행해 outcome(hit/miss/inconclusive)을 채점한다. 텍스트(일기/사주)는 컨텍스트에서 배제 — 정량 데이터만 사용.

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

**마스터 테이블** (마이그레이션 049\~050, \~466 rows):
- `stems_master` — 천간 10개 (오행·음양·한자)
- `branches_master` — 지지 12개 (오행·음양·계절·동물)
- `ganji_master` — 60갑자 (FK to stems/branches)
- `sipsin_lookup` — 십성 매핑 220 (10 천간 일간 × 22 대상 글자)
- `sibiunsung_lookup` — 십이운성 120 (10 천간 일간 × 12 지지)
- `branch_relations` — 지지 관계 \~46 (육합/삼합/방합/충/형/파/해/원진)
- `stem_relations` — 천간 관계

**운영 테이블** (마이그레이션 051\~053):
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

> ⚠️ **#477 P1(### 24)에서 supersede**: `pattern_hypotheses`·`pattern_stats` DROP, `weeklyHypothesisReview`·confirmed 가설 라인 중단. 아래는 P1 이전 서사 — 현재 검증 단위는 (시드×신호) `pattern_links`(### 24), 주간 검증 엔진은 P2 재구축.
>
> **현행 로직 정정(아래 임계 표·lifecycle의 "최근 4주 평균 q"·"4주 연속" 서술은 폐기됨)**: 현재 검증은 **전 기간 누적 2×2**를 off-day 대조로 **매주 처음부터 재계산**(SET 리플레이, ### 25)한다. 4주 평균/연속 창은 쓰지 않는다. 확정 게이트는 누적 e-value `e ≥ 20`(### 26·[ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md)), 종결은 `reject`(무연관 밴드)·`direction_mismatch`(역방향, effect ≤ 0.77, ### 41)를 판정 즉시 `rejected`로 종결한다(4주 대기 없음).

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

> **이후 교체됨 (#477 → #542)**: `buildCandidateCard`·`buildWeeklyReviewBlocks`는 #477에서 은퇴. #477 카드 빌더(`buildVerificationBlocks`·`buildSeedInfluenceSection`)도 **#542(ADR-0052)에서 발송 은퇴**(검증 현황은 routine 통합 카드로 이관, ### 40). 현재 `hypothesis-cards.ts`에 남은 빌더는 `buildDiscoveryCandidateCard`(발굴 승인, action_id `discovery_approve`/`discovery_dismiss`)와 `buildRebaselineNotice`(재기준선 공지)뿐. 아래는 Phase 4 시점 기록.

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

> ⚠️ **이후 재정의됨 — 아래 서술은 Phase A2 시점 기록**: #477 P1(### 24)이 2층(accumulating·recent)으로, **#477 P3(### 26)이 3층(verified/emerging/recent)으로 재정의**. 현재 운영 tier 정의는 ### 26 기준. verified=status confirmed(e≥20), emerging=off-day effect leaning(naive accumulating 대체), recent=발현.

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

> ⚠️ **#477 P1(### 24)에서 supersede**: `pattern_metrics`는 `signal_defs`+`pattern_links`로 분리·DROP, `pattern_summary` view는 링크 기반 재정의. 아래 스키마는 P1 이전 — 현재는 ### 24.

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

> ⚠️ *아래는 마스터 A(068) 시점 기록. 이후 #477 P1(2층)·**P3**(3층 verified/emerging/recent, ### 26)으로 재정의 — 현재 tier 정의는 ### 26 기준.*

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
- `diary_meta_tags` enum 26종 — 마스터 #393 Phase 4 + migration 102 (그대로)
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

#### `pillar-level-distribution-review` cron (월요일 09:15 KST) — 은퇴됨 (#508)

> ⚠️ **은퇴 (#508, ADR-0046)**: 누적 카운트 시드가 강도 밴드(ADR-0036)로 위임·archive되면서 이 분포 리뷰는 소비 대상을 잃어 cron·코드·테스트 전부 제거됐다. 아래는 역사적 기록(Phase 2.5). 현행 위생은 [§36 포화 양방향 가드](#36-신호시드-측정-정밀화-508-adr-0046) 참조.

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
| ~~09:15 (월요일만)~~ | ~~`pillarLevelDistributionReview`~~ | 은퇴됨(#508) — 누적 시드 강도 밴드 위임으로 분포 리뷰 무의미 | — |

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

> **Superseded by [### 30](#30-매트릭-중심-패턴-검증--phase-5b-llm-신호-제안--검증실행-격리-491)** (#477 P5b, ADR-0040). 본 절은 master #434 당시 `pattern_metrics`(077에서 DROP) 모델 기준의 역사적 서사 — `monthly-metric-suggest`·ADR-0025/0030은 `signal_defs(source='llm')` 모델 + 2단 방어로 재정의됨. 아래 내용은 그 시점 기록으로만 읽을 것.

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

> **이후 교체됨 (#477 → #542)**: 아래 `buildCandidateCard` 카드는 #477에서 `buildVerificationBlocks`로 교체됐고, 그 `buildVerificationBlocks`도 #542(ADR-0052)에서 발송 은퇴 — 검증 현황은 routine 통합 카드가 단독 발송(### 40). 아래는 과거 기록.

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
| 검증 — 인과 단언 | 오늘 발현 시드 ∩ `saju_influence_summary` verified(검증됨, e≥20) | "너는 X일 때 실제로 Y하더라" |
| 경향 — hedged | 오늘 발현 시드 ∩ emerging(검증중, #477 P3) | "요새 X일에 Y 경향, 검증중" — 단언 금지 |
| 현황 — 배경 맥락 | 오늘 발현 시드 중 미검증(recent) | "오늘 이런 기운·신호 활성" — **인과 주장 금지** |

**데이터 수집** (메트릭/카운트만, diary 원문 입력 금지):
- 오늘 일운: `fortune_analyses WHERE period='daily' AND date=CURRENT_DATE`
- 오늘 발현 시드: `seed_daily_activations (date=오늘(KST), trigger_activated=true)` JOIN `pattern_catalog` + `saju_influence_summary`(tier 판정). 사주 시드(stem/branch/ganji/relation/sibiunsung/element_density)와 `life_signal`을 레이어로 분리 표시
- `life_themes` active

**멱등**: `daily_insight_log (user_id, date) UNIQUE` (마이그레이션 076). `INSERT ... ON CONFLICT DO NOTHING RETURNING` — 비면 "이미 발송, 종료".

**파이프라인 순서**: 매칭(`dailySajuMatching`) **07:00** → 종합 **08:00**. 매칭 선행으로 그날 발현 시드를 종합이 읽음 (구 09:00에서 당김, 마이그레이션 076). 매칭 cron은 그날 발현 시드를 `seed_daily_activations`에 transient 기록만 한다(Slack 발송·검증 없음). 검증은 주간 엔진(`weekly-verification`, 월 06:00)이 raw 재계산 — #477 P2에서 일별 백필·#life 한 줄 제거.

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

- **신호 종류**: `kind=sql`(객관 SQL 측정, 1차) — 기존 매트릭 SQL + off-day 대조 판정(`direction`). `kind=tag`(일기 메타 26태그, 보조) — 그날 태그 존재 여부를 binary로 평가. 객관 SQL이 1차, 주관 태그가 보조 (ADR-0033 §5, 확증편향 방어).
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

### 25. 매트릭 중심 패턴 검증 — Phase 2 (주간 검증 엔진 + 일별 활성 로그 전환, #481)

P1이 만든 (시드 × 신호) `pattern_links`를 **off-day 대조**로 검증하는 **주간 엔진**을 세우고, 일별 `pattern_matches`를 검증 책임에서 떼어내 **핸드오프 로그**로 전환. 검증 진실은 `pattern_links` 단일 (상세 [ADR-0032](../adr/0032-metric-first-verification-statistics.md)·[ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md)).

**off-day 대조 (헌장 ②)**: 발현일(트리거 fire) vs 비발현일에서 신호 pass율을 2×2로 비교. "본인 패턴"과 "그냥 base rate가 높은 신호(기분탓)"를 분리하는 게 핵심. `발현일 pass율 / 비발현일 pass율`(rate ratio)이 효과크기.

**일별 테이블 전환** (마이그레이션 078):

| 변경 | 내용 |
|------|------|
| rename | `pattern_matches` → `seed_daily_activations` (의존 view `saju_influence_summary`는 OID 추적으로 자동 추종) |
| 검증 컬럼 DROP | `metric_values`·`verify_status`·`error_message` (검증은 주간 엔진이 raw 재계산 → 일별 컬럼은 죽은 코드) |
| 남김 | `date`·`pattern_id`(시드)·`trigger_activated`·`matched`, `UNIQUE(user_id,date,pattern_id)` 멱등 |
| 의미 | "오늘 발현 시드" 일별 핸드오프 로그(검증 진실 아님). daily-insight(#insight 08:03)·recent tier·pillar-level이 소비 |

> 컬럼명 `pattern_id`는 `seed_id`로 안 바꿈 — daily-insight SKILL·pillar-level 쿼리 churn 최소화. 테이블 이름만 정직하게.

**off-day 검증 엔진** (`pattern-verification.ts`, 순수 계산 + 읽기):

- **P1 신호 전역화의 payoff**: 신호가 전역(`signal_defs`)이라 **신호별 일자 시리즈를 신호당 1회**, **시드별 활성 시리즈를 시드당 1회** 계산하고, 링크는 그 위 조인 + 2×2 → O(신호 + 시드)로 환원(옛 per-link 재계산 대비).
- **신호 시리즈**(`computeSignalSeries`): `kind=tag`는 그날 태그 존재 여부(binary). `kind=sql`은 일자별 `runMetricSql` raw 값 → `direction`으로 이진화. `above_avg/below_avg`는 in-memory rolling baseline(직전 `window_days`일, 워밍업 미충족·측정불가는 null=2×2 제외). `above_abs/below_abs/flag_present`는 절대 임계.
- **시드 활성 시리즈**(`computeSeedActivationSeries`): 일자별 `getDailyContext`(캐시) → `evaluateTrigger`. 사주 트리거는 TS 계산이라 SQL view로 재현 불가 — 그래서 매칭 핸드오프 테이블이 구조상 필요(Option A 경계).
- **링크별**: `buildContingency`(발현×pass 2×2 + 측정불가 발현일=inconclusive) → `verifyContingency`(Fisher's exact + rate ratio + Beta-Binomial posterior). BH-FDR은 전 링크 p 모아 일괄.
- **윈도우**: `[today - 365, today]` 전체 이력 재계산 + SET 시맨틱(첫 run이 frozen 이관 카운터를 raw 진실로 덮어씀). 비용: 신호당 \~366회 `runMetricSql`(주간 백그라운드 job, 사용자 대기 없음).

**주간 cron** (`weekly-verification.ts`, `weekly-hypothesis-review.ts` 대체): 월요일 **06:00 KST**(마이그레이션 079 — 08:00→06:00, daily-insight 08:03과 `pattern_links` 읽기 레이스 제거). `verifyUserLinks` → 링크별 `pattern_links` UPDATE(counters SET + `p_value`·`q_value`·`effect`·`test_type='fisher_2x2'`·`posterior_*`·`test_detail` JSONB + status) → 검증 현황 카드 → #insight. per-link try/catch 격리(#434 Phase 8a).

**status 전이 정책 (provisional, 보수적)** — ⚠️ *#477 P3(### 26)에서 해제: confirm은 e≥20에서 `confirmed` 실제 승격(verified tier), pattern_summary가 confirmed 포함하도록 보정. 아래는 P2 시점 기록*: `pattern_summary`/`saju_influence_summary.accumulating`이 `status='active'` 링크만 집계 → 'active' 외 status는 daily-insight 노출에서 사라진다. 따라서:

| verdict | DB status | 이유 |
|---------|-----------|------|
| reject (충분한 데이터 + effect≈1) | → `rejected` | 반증된 패턴 — 노출에서 제거가 정당 |
| confirm (q≤0.05 + effect≥1.3) | `active` 유지 | **provisional** — 주간 q는 optional stopping. 진짜 게이트는 P3 e-value(ADR-0032 §3). 승격 시 view에서 사라지므로 카드에만 표기 |
| insufficient/inconclusive | `active` 유지 | 데이터 부족·판정 보류 |
| pending/archived | 미변경 | 승인 게이트(P5)·수동 |

**소비자 재배선**:

| 대상 | 변경 |
|------|------|
| `pillar-level-distribution-review` | 테이블 rename, `verify_status != 'no_metric'` → `matched IS NOT NULL`, `created_at`→`date` |
| daily-insight SKILL 2-2 | `FROM pattern_matches` → `seed_daily_activations` (배포 직후 적용 — 로컬 routine이라 repo 밖) |
| `loadSeedInfluence`(주간 cron) | DROP된 `pattern_metrics` α/β 참조 → `pattern_links`(active) 복구 |
| 일별 cron / `recordDailyMatches` | 슬림 write(trigger_activated·matched만), `compactMatchedLine`·#life 발송·백필 제거 |

**통계 경계 (P2 vs P3)**:

| 항목 | P2 | P3 |
|------|----|----|
| 이진 신호 연관 | Fisher's exact 2×2 (off-day) | + block permutation |
| 연속 신호 | baseline 이진화 후 2×2 (ADR-0032 §3) | Mann-Whitney + 효과크기(raw) |
| 누적 확신도 | Beta-Binomial posterior | + 누적 e-value(진짜 게이트) + null 시뮬 |
| status 전이 | reject만 DB, confirm은 provisional(카드) | e-value 게이트로 verified 승격·노출 복원 |

연속 신호는 `direction` 기준 binary pass로 2×2(P2). graded 레벨 시드는 독립 binary 검정(완전 graded = P4).

**헌장 준수**: ② off-day 대조(신호 전역 측정) / ③ 통계 = ADR-0032 P2 범위 / ④ provisional confirm은 e-value 게이트(P3)까지 사용자 미노출. **새 ADR 없음**(0032·0033 커버).

**다음 phase 연결**: P3(e-value null-시뮬 빌드 게이트 + verified tier 복원 + 연속 신호 Mann-Whitney + 주간 스냅샷 재생성), discovery·승인 게이트 = P5.

> 계획서 `.claude/plans/481-p2-weekly-verification.md`, 서사 [design-notebook](../design-notebook/metric-first-verification.md) Phase 2 섹션.

### 26. 매트릭 중심 패턴 검증 — Phase 3 (통계 엔진 보강: e-value 게이트 + 등급별 노출, #483)

P2(주간 off-day 검증 엔진)에 ADR-0032 통계 풀스택을 얹는다. 핵심: **확정의 안전성**(e-value)과 **느린 수율을 침묵으로 만들지 않는 노출**(3-tier)을 동시에.

#### e-value 확정 게이트 ([ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md))

매주 들여다보는 구조(optional stopping)에서 q를 반복 보는 건 거짓양성을 부풀린다. 누적 **e-value**(test martingale)는 anytime-valid라 언제 멈춰 봐도 `P(sup_t e_t ≥ 1/α) ≤ α`(Ville). 판정 `e ≥ 20`(α=0.05).

- **구성**(`stats.ts` `evalueTestMartingale`): 매 발현일에 "귀무 기준율 r 대비 pass율 상승"에 예측가능 베팅. r = 직전까지 **전체 일** running pass율(풀링 → Jensen 편향 억제), φ = active-day running pass율. 희석 대안 φ'=r+λ(φ−r), λ=0.5, one-sided(φ>r일 때만). off-day는 r만 갱신.
- **결정론 리플레이**: prequential 추정이라 매주 전체 윈도우를 처음부터 재계산해도 prefix factor 동일 → sup 단조 증가. SET(전체 재계산) 아키텍처와 정합(ADR-0033 §2 긴장 해소). confirmed는 sticky(`verifyUserLinks`가 active만 재검증).
- **빌드 게이트**(`stats.test.ts`): 무관 데이터 null 시뮬(p×activeProb 그리드 + AR(1) ρ=0.8 자기상관 케이스, 각 1500 trial)에서 거짓 확정율 ≤ α 실측. **통과 못 하면 머지 금지.** 자기상관에도 강건(ρ=0.8에서 \~0.026).

#### 3-tier 등급 노출 ([ADR-0035](../adr/0035-graded-confidence-exposure.md))

엄격한 게이트는 "검증됨" 주장에만, 가시성은 별도 hedged tier가 나른다. `saju_influence_summary` 재정의(마이그레이션 080):

| tier | 게이트 | metric_value | 노출 |
|------|--------|-------------|------|
| **verified** "검증됨" | `status='confirmed'` (e≥20) | posterior_p | 인과 단언 가능(단 연관, 인과 아님) |
| **emerging** "검증중" | active + `effect≥1.3` + 발현일≥15 | 발현일 pass율 | hedged(효과·표본·확신 노출). naive accumulating **대체** |
| **recent** "오늘 발현" | 최근 7일 발현 | match_count | 현황만 |

- **emerging이 핵심 수정**: 옛 accumulating은 발현일 pass율 55%↑만 봐서 off-day 대조를 안 했다(헌장 ② "기분탓" 노출 위험). emerging은 off-day 효과(`effect = 발현/비발현 rate ratio`)로 게이트 → 헌장 ② 정합 회복.
- **카드 표현(#537 가독성 개선)**: 주간 카드(🌱/✅) 항목은 핵심 2줄 — 첫 줄 `패턴 → *신호*`(검증됨은 ` · 확정`), 둘째 줄 `평소보다 N배 (발현/표본일) · 확신 X%` + 교란 caveat(inline). e-value 진행바·우연확률(q)·추정범위(CI)·주간추세는 카드 표시에서 제외(DB·`link_weekly_stats`엔 보존). emerging "검증중" 라벨 + 효과크기 노출이 "아직 확정 전"을 전달해 peeking 방어 의도는 유지. (이력: 진행바 `확정까지 X/20`는 ADR-0035 도입 → #537에서 가독성 위해 카드에서 제외, 확정 게이트 `e/20`은 불변.)
- 소비: daily-insight(#insight)가 view tier로 분기(`emerging` 라벨 동기화는 배포 직후 SKILL — repo 밖). 주간 카드는 ✅검증됨/🌱검증중/✗기각.

#### 통계 스택 꼬리

- **block permutation**(`blockPermutationP`): active 라벨을 블록(7일) 단위 셔플 → 자기상관 보정 p. **이 p를 BH-FDR 입력으로** 승격(Fisher p는 `test_detail` 참고용). 연속 발현 streak가 만드는 거짓 유의 차단.
- **연속 신호 Mann-Whitney + Hodges-Lehmann**(`mannWhitneyU`): 보고용 효과크기(`test_detail`). 게이트는 이진 유지(ADR-0033).
- **empirical-Bayes 수축**(`empiricalBetaPrior`): 전 링크 발현일 pass율 method-of-moments 공통 prior(농도 CAP 50) → posterior 수축. 링크 적으면 약함(헌장 ④ 자동 활성).
- **발견/확정 q 분리**: `confirmQ=0.05` 활성, `discoverQ=0.15`는 P5 자율 발견까지 휴면(선언만).

#### 데이터 모델

- `pattern_links`: `e_value` 채움(077 선언만 → P3 populate). `status='confirmed'` 실제 승격(`statusForVerdict` e≥20).
- `link_weekly_stats` 신규(080): 링크당 주 1행 스냅샷(e_value·2×2·posterior·p/q/effect, `UNIQUE(link_id, week_start)` 멱등) — 마틴게일 trail·emerging 추세 데이터·주간대비(카드 표시엔 미사용 #537, 감사·데이터용 보존).
- view: `saju_influence_summary` 3-tier 재정의 + `e_value` 컬럼 추가(컬럼 계약 앞 11개 보존). `pattern_summary`·시드 영향력 합산에 `confirmed` 포함(verified 시드가 영향력 top에서 사라지는 P2 트랩 방지).
- 임계 외부화(`insight-thresholds.ts`): `evalueAlpha`·`evalueThreshold`·`emergingMinEffect/Active`·`discoverQ`·`blockLen`·`blockPermIters`. emerging 바는 ADR-0035 튜닝 노브(첫 몇 달 calibration). view의 1.3/15 하드코딩은 TS 상수와 동기화(변경 시 migration).

#### 흐름 (주간 검증 엔진, 월 06:00)

```
verifyUserLinks(active 링크) → 링크별:
  raw 윈도우 재계산 → 2×2(Fisher) + block-perm p + e-value(일자 시퀀스) + 연속 MW
  → EB 공통 prior로 posterior 수축 → block-perm p로 BH-FDR(q)
  → classifyVerdict(q·effect) + e≥20 → statusForVerdict
persist: pattern_links SET + link_weekly_stats UPSERT
카드: 시드 영향력 top5 + 3-tier(검증됨/검증중/기각) → #insight
```

#### 빌드 결과 (설계 대비 정련)

- **자기상관 robustness 회귀 가드 추가**(설계 미계획): 현실 데이터는 pass가 streak를 갖는다. AR(1) ρ=0.8에서도 e-value 거짓 확정율 ≤ α임을 빌드 중 진단 → 영구 테스트로 박음. 풀링 기준율이 핵심.
- **pattern_summary `confirmed` 포함**(P2 보수화 후속): confirm 승격이 시드를 active 집계에서 빼 노출에서 사라지는 트랩을 verified tier에 그대로 두면 안 됨 → 080에서 join을 `IN ('active','confirmed')`로.
- **마이그레이션 080 prod 스키마 사전 대조**: 로컬 PG 부재 → 읽기전용 introspection으로 컬럼/CHECK 검증 후 작성(배포 시 트랜잭션 롤백 안전).

### 27. 매트릭 중심 패턴 검증 — Phase 4a (결정론 사주 강도 feature 엔진, #485)

결정론 사주 계산(`saju-calendar.ts`) 위에 **오행/일간의 실효 강도**를 graded feature로 올려, 상대 분위수 밴드로 잘라 기존 off-day 검증 엔진(P2·P3)에 태운다. **새 통계 코어 없음** — graded·비단조(inverted-U)는 밴드별 독립 binary 시드로 실현([ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md) §4 "레벨별 main effect, 상호작용 항 불요").

**실효강도 모델** (`saju-strength.ts`, 전부 파라미터 — `saju-strength-params.ts`):

```
strength(X) = Σ글자[ ±contrib · 위치가중 · 월령배수 ] + 통근보너스(X)
  부호:  비겁·인성(생조) → +saengjo  /  식상·재·관(극설) → −geukseol
  위치:  천간 W_STEM / 지지본기 W_BRANCH_MAIN / 지장간 중기 W_JANGGAN_MID / 여기 W_JANGGAN_YEOGI
  월령(간결판): 원국 월지 본기 오행과 같은 글자 ×W_WOLLYEONG (득령)
  통근(게이트): X가 천간 투출 + 지장간 뿌리 동시 보유 시 +W_TONGGEUN (이진)
```

- 부호는 글자 오행과 대상 X의 상생상극 관계로 결정(비겁·인성만 +). 운 풀셋(원국 4 + 대운·세운·월운·일운)에서 계산 → 일운이 매일 바뀌어 강도가 매일 변동.
- **병행 산출**: `computeAbsoluteStrengthState`(절대 신강/중화/신약 — 생조 비율, **검정 비사용**, 맥락·미래용), `computeElementRatios`(노출·covariate용, 별도 시드 없음 — 강도에 흡수).
- 명리학 정밀도는 간결판 선택(월령=월지 본기, 분일 사령 무시 / 통근=지장간 뿌리 이진). 정밀 분일 사령은 calibration 노브로 유보([ADR-0036](../adr/0036-relative-quantile-strength-bands.md) 회고).

**상대 분위수 밴드** ([ADR-0036](../adr/0036-relative-quantile-strength-bands.md), `quantile.ts`): 윈도우 강도값을 tertile 3등분 → 약/적정/강. 일별 cron은 윈도우가 없어 분위수를 못 내므로 **컷을 주간 산출 → 저장 → 일별 적용**(value-vs-cut 규칙 공통, rank 금지). 결정론 정합 — 같은 윈도우 → 같은 분위수 → 같은 밴드(SET 리플레이·e-value 불변, [ADR-0034](../adr/0034-evalue-confirmation-gate.md)).

**데이터 모델** (마이그레이션 081):

| 객체 | 내용 |
|------|------|
| `trigger_target_type='strength_band'` | aux `{target, band}` — target ∈ {day_master, 목, 화, 토, 금, 수}, band ∈ {low, mid, high} |
| `strength_band_cutpoints` | (user_id, target) UNIQUE — low_cut·high_cut·n_samples. 주간 UPSERT → 일별 판정 |
| 18 강도 시드 | 일간 + 5오행 × 3밴드. 전부 즉시 활성 로그 누적 |
| 큐레이트 스타터 링크 13 | 일간 약/강 × 행동신호 + 화 강 × 건강(071 선례) + 목 강 × 지출(재성 앵커). 전부 양의 연관 |

**trigger 평가 경로** (`pattern-verification.ts`):

| 경로 | 동작 |
|------|------|
| 주간 엔진 (`computeSeedActivationSeries`) | strength_band 2-pass: pass1 target 강도 시리즈(18 시드가 6 target 공유·캐시) → pass2 tertile 컷 → 각 날 밴드 매핑 → seed.band 일치. 2×2/통계 코어 불변 |
| 일별 cron (`evaluateTrigger`) | 저장 컷(`strength_band_cutpoints`) 로드 → 오늘 강도 → 밴드 판정. 컷 없으면(첫 주간 실행 전) false(정직) |
| 컷 저장 (`weekly-verification`) | `computeStrengthCutpoints`(읽기전용) → `strength_band_cutpoints` UPSERT. 검증과 독립(실패해도 검증 진행) |

**FDR 가족 분리** ([ADR-0037](../adr/0037-verification-fdr-family-split.md)): `verifyUserLinks`가 BH-FDR을 `bhFdrByFamily`로 가족별 적용 — 강도 밴드(`saju_strength`)와 baseline 격리. 자주 발현하는 밴드(유한 p)가 baseline 가족 m을 키워 `life_signal` 확정을 늦추는 것을 차단. EB 공통 prior는 전 링크 유지(가족 무관).

**P5 연결**: 오행 밴드 다수(토·금·수 전체, 목/화 약·적정)는 링크 없이 활성만 누적 → **P5 discovery를 시드×태그에서 시드×sql신호까지 확장**해야 데이터 기반으로 채워진다(P4a는 큐레이트 앵커만, 십성 전체 손박기 회피 — discovery가 off-day 대조로 발견하는 게 헌장 ② 정신).

### 28. 매트릭 중심 패턴 검증 — Phase 4b (결정론 사주 관계·합화 변환 feature 엔진, #487)

P4(결정론 사주 feature 엔진)의 후반. P4a(강도)에 이은 **관계·변환 패밀리**. P4a와 동일하게 **새 통계 코어 0** — 전부 결정론 boolean/밴드 시드로 기존 off-day 엔진(P2·P3)에 태운다([ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md) §4). 정본 [ADR-0038](../adr/0038-saju-relation-hwa-feature-depth.md).

**합화(合化) 변환 pass** ([saju-hwa.ts](../../src/shared/saju-hwa.ts), 순수 함수):

- 합(천간합/육합/삼합)이 化신 통근 조건을 만족하면 구성 글자의 오행을 化 오행으로 치환한다. 합화오행은 TS 상수(`CHEONGAN_HAP`/`JIJI_YUKHAP`/`JIJI_SAMHAP`, [saju-calendar.ts](../../src/shared/saju-calendar.ts))에 이미 있어 **DB 데이터 추가 0**.
- `detectHwaTransforms(pillarSet, params)` → `{transforms, stemOverride, branchOverride}`(Pillar 참조 → 化 오행 맵). `saju-strength`가 글자 tally 전에 1회 적용 → **강도·밴드·절대상태·효과적 십성이 전부 변환 글자 기준 일관 계산**.
- 변환 granularity(v1): 천간합 → 두 천간 element, 지지합 → 지지 본기 element. 지장간 중기/여기는 불변. `computeElementRatios`(composition covariate)는 의도적으로 raw 유지.
- 결정론(순수 함수) → SET 리플레이·e-value 불변([ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md)).

**합충 해소 깊이 = v1a** ([saju-strength-params.ts](../../src/shared/saju-strength-params.ts) `SAJU_HWA_PARAMS`):

| 노브 | 기본 | 의미 |
|------|------|------|
| `HWA_REQUIRE_ROOT` | true | 化신 통근 게이트 — 化 오행이 활성 지지(본기/지장간)에 뿌리내려야 성립 |
| `HWA_CHUNGGAEHAP` | true | 충개합 — 합 멤버 지지가 다른 활성 지지와 충이면 합 무효(동적 운이 정적 합을 깸) |
| `HWA_DAYMASTER_TRANSFORM` | false | 일간 천간 변질 허용 — v1 보수적 불변(학파 의존) |
| `HWA_TAMHAP_MANGCHUNG`·`HWA_JAENGHAP`·`HWA_HYUNGPA_BREAK`·`HWA_DISTANCE` | false | 깊은 상호작용 — 헌장 ④ 미리 선언, 활성은 데이터 게이트/후속 |

**효과적 십성 시드** (`hwa_sipsung` trigger, [pattern-match.ts](../../src/shared/pattern-match.ts)):

- 합화 변환 후 化 오행의 일간 대비 5그룹 십성(비겁/식상/재성/관성/인성, polarity 무관)을 검정 시드로. `elementToSipsinGroup(일간오행, 化오행)`.
- `evaluateTrigger` case `hwa_sipsung`: 오늘 풀셋의 합화 변환 → 化 오행 십성 → `aux.sipsin` 일치 시 발현. 합화 성립일에만 fire(sparse, 정직). 윈도우 비의존 → 2-pass 불요(`computeSeedActivationSeries` 기본 per-day 경로).
- 082가 5 시드 생성(`pool_합화십성_*`).

**관계 확장** (귀문 + 대표 암합):

- 070 자동생성 관계 풀(합충형해파+원진 72시드) 재사용. 082는 **귀문 6쌍 + 대표 암합 4쌍**(인축·묘신·사유·오해 = 정기-정기 천간합)만 `branch_relations`에 추가 + relation_type CHECK 확장 + 070 LOOP 패턴 auto-gen 시드(evidence-only). 사술은 원진+귀문 동시(사용자 임상 정합, 마이그레이션 055).
- 원국에 없는 쌍은 휴면(헌장 ④). 관계 큐레이트 링크는 **두지 않음** — 사술귀문은 기존 S2 사술원진과 발현 동일(중복), 나머지는 P5 sql-discovery가 off-day로 발견(헌장 ②, mass-wiring 회피).

**FDR 가족 `saju_relation`** ([ADR-0037](../adr/0037-verification-fdr-family-split.md) 연장, 2→3가족):

- `familyOf`: `strength_band → saju_strength` / `relation`·`hwa_sipsung → saju_relation` / 그 외 → `baseline`. `bhFdrByFamily` families 3개.
- 자동 생성 관계 batch(070 + 귀문/암합)가 빠른 `life_signal` 트랙 확정을 늦추지 않게 격리. 합화 반영 강도 시드는 `saju_strength` 유지(시드 수 불변, 값만 정밀화).

**검증/해석 분리** ([ADR-0038](../adr/0038-saju-relation-hwa-feature-depth.md) §3): off-day 통계 검증은 v1a 결정론 facts로 얕게. 깊은 명리 해석(학파 의존 상호작용)은 narrative LLM(weekly-fortune)이 facts를 grounding으로 hedged 추론 — 결정론 deep 해석 엔진은 만들지 않음(헌장 ①). narrative raw facts 주입은 별도 follow-up(P4b 범위 외).

**데이터 모델** (마이그레이션 082): relation_type CHECK(+귀문·암합) + trigger_target_type CHECK(+hwa_sipsung) + 귀문 6/암합 4 쌍 + auto-gen 관계 시드 + 효과적 십성 5 시드 + 효과적 십성 × 객관 신호 10 큐레이트 링크(generic 십성→행동, 양의 연관) + RAISE 검증(silent fail 방지).

### 29. 매트릭 중심 패턴 검증 — Phase 5a (패턴 발굴 엔진 + 승인 게이트, #489)

P4a·P4b가 evidence-only로 남긴 결정론 feature 시드(강도 밴드·관계·효과적 십성)를 데이터 기반으로 검증 트랙에 연결. 정본 [ADR-0039](../adr/0039-pattern-discovery-surface-and-approval-gate.md). **스키마 변경 0**(P1이 `source='discovery'`·`status='pending'` 선언 완료), 새 통계 코어 0(검증 프리미티브 재사용).

**문제**: 주간 검증 엔진(`verifyUserLinks`)은 `status='active'` 링크만 검정한다. 큐레이트 링크 없이 활성 로그만 누적하는 evidence-only 시드(오행 밴드 토·금·수 전체+목/화 약·적정, 070 자동생성 관계, 효과적 십성)는 영영 검증 안 됨. P4a·P4b가 명시적으로 P5로 위임.

**발굴 스캐너** ([hypothesis-discovery.ts](../../src/agents/insight/hypothesis-discovery.ts) `discoverCandidates`):

- 범위 = **링크 없는 (active 시드 × active 신호) 여집합**. 기존 링크(어떤 status로도)는 제외(rejected 재부상·중복 차단).
- 신호는 **sql(객관 1차) + tag(주관 보조) 둘 다** — evidence-only 강도 밴드는 sql 신호로만 잡힌다(Phase 표 "시드×태그"를 sql까지 확장).
- 검증 프리미티브 재사용: `computeSeedActivationSeries`(시드당 1회, strength_band 2-pass 포함)·`computeSignalSeries`(신호당 1회) → `buildContingency` 2×2 → `verifyContingency`(Fisher) → `blockPermutationP`(자기상관 보정) → `bhFdrByFamily`(가족별 발견 BH-FDR). 신호·시드 시리즈를 1회씩만 계산(P1 전역화 payoff).
- 파이프: Fisher 사전선별(n≥`discoveryMinActive`·effect≥`discoveryMinEffect`·fisherP≤`discoveryMaxFisherP`) → 통과만 block-perm(Monte Carlo 비용 차단) → 발견 q≤`discoverQ` → effect 내림차순 top-`discoveryTopN`(드롭 시 로그, 무음 캡 금지).

**2층 통제** (다중검정·연구자 자유도, [ADR-0039](../adr/0039-pattern-discovery-surface-and-approval-gate.md) §2):

| 층 | 트랙 | 임계 | 역할 |
|----|------|------|------|
| surface | 발견 q | `discoverQ`≈0.15 (느슨) | 후보만 *띄움* |
| belief | 확정 e-value | `confirmQ`≤0.05 + e≥20 (엄격) | 진짜인지 *판정* |

- 발견 후보 집합에 자체 BH-FDR, **FDR 가족 분리**(`familyOf` 재사용 — 강도 발굴이 baseline 발굴을 과세 안 함). 확정 트랙(`verifyUserLinks`)과 별도 풀.
- 거짓 발견의 비용 = 승인 카드 1장이지 거짓 믿음이 아니다. 사전 고정 규칙(off-day 대조·신호 direction 고정)이라 사후 노브 없음(헌장 ②).

**pending 링크 선INSERT** (`insertPendingDiscoveryLink`): surface 후보를 `pattern_links`에 `source='discovery'`·`status='pending'`로 INSERT(`ON CONFLICT (seed_id, signal_id) DO NOTHING` — 여집합이 보장하나 방어). 발굴 스냅샷(rate_active·rate_off·effect·fisher_p·block_p·discover_q·family)을 `test_detail` JSONB에 동봉(카드·감사). posterior는 provisional(EB 없이 hit/miss) — 승인 후 첫 주간 검증이 EB prior로 SET 덮어씀.

**승인 카드** (맥락 풍부, [hypothesis-cards.ts](../../src/agents/insight/hypothesis-cards.ts) `buildDiscoveryCandidateCard`): 헤더 `[사주/생활] {시드} × {신호} — 새 패턴 후보` + off-day 통계(발현일 vs 평소 pass율·effect·n) + 시드/신호 의미 평어(description 조합, 없으면 이름 폴백) + caveat("아직 후보야 … 연관이지 인과 아님") + `[추적 시작]`(primary)/`[패스]`. payload = `{linkId}`.

**승인 액션** ([actions.ts](../../src/agents/insight/actions.ts)):

| 버튼 | 전이 | 의미 |
|------|------|------|
| 추적 시작 | `pending → active` | 다음 주간 검증부터 off-day 대조 대상 |
| 패스 | `pending → archived` | 사용자 "추적 안 함" (통계 `rejected`와 구분 — 둘 다 여집합 제외) |

- `approveDiscoveryLink`/`dismissDiscoveryLink`(`WHERE id=$1 AND user_id=$2 AND status='pending'` 가드) 테스트 가능 코어. (P5a 시점엔 LLM 매트릭 승인 `METRIC_*`이 suspended였고, P5b [### 30](#30-매트릭-중심-패턴-검증--phase-5b-llm-신호-제안--검증실행-격리-491)에서 `signal_defs(source='llm')` 모델로 재구현됨.)
- **노출 vs 믿음 분리**: 사람은 *진실*을 판정하지 않는다 — 게이트하는 건 노출·큐레이션("추적할 가치 있나"), 믿음("진짜인가")은 끝까지 e-value 트랙. 게이트 없이 느슨한 q 발견을 자동 활성하면 미검증 연관이 emerging tier로 조기 노출되므로, 사람 게이트가 그 노출만 막는다.
- **카드 갱신 — 클릭 후 표시**: 승인/패스 모두 제안 본문 블록은 보존하고 `actions`(버튼) 블록만 제거한 뒤 처리 결과 안내 context를 덧붙인다(`resolveActionCard`, [slack.ts](../../src/shared/slack.ts)). 버튼 클릭 후에도 어떤 제안이었는지 카드에 남게 — DB 전이는 불변, 표시만 변경(#535). P5b LLM 신호 카드도 같은 헬퍼 재사용.

**주간 cron 통합** ([weekly-verification.ts](../../src/cron/weekly-verification.ts) `surfaceDiscoveries`): 검증·persist·카드 발송 후 발굴 단계(검증과 독립 try-catch 격리 — 발굴 실패가 검증 결과를 막지 않게). 월요일 06:00 KST만 실행(`weeklyVerificationTask` 가드 상속).

**발굴 노브** ([insight-thresholds.ts](../../src/shared/insight-thresholds.ts) `patternVerification`): `discoverQ`(0.15)·`discoveryMinActive`(12)·`discoveryMinEffect`(1.3)·`discoveryMaxFisherP`(0.1)·`discoveryTopN`(5). 헌장 ⑤ 튜닝 노브 — calibration.

**P5b 의존**: LLM 신호 제안(열린 SQL 생성)은 같은 승인 게이트(맥락 카드 + pending→active)를 재사용. 발굴(P5a)은 *기존 신호*를 off-day로 잇고, LLM(P5b)은 *새 신호*를 생성한다(둘 다 사람 게이트, 통계가 심판).

### 30. 매트릭 중심 패턴 검증 — Phase 5b (LLM 신호 제안 + 검증·실행 격리, #491)

LLM이 새 측정 신호(`signal_defs`, `kind='sql'`, `source='llm'`)를 월간 자율 제안 → 사람 승인 게이트(P5a 재사용) → active 후 P5a 발굴이 시드와 연결 → off-day 통계가 판정. 정본 [ADR-0040](../adr/0040-llm-signal-sql-validation-and-execution-isolation.md). **이 마스터 최대 보안 표면**(LLM-생성 SQL이 prod DB에서 무인 반복 실행)이라 검증·실행 격리가 1급 설계 항목. **마이그레이션 0**(077이 `source`/`status` 선언 완료), 새 통계 코어 0.

**2단 방어 — untrusted LLM SQL** ([ADR-0040](../adr/0040-llm-signal-sql-validation-and-execution-isolation.md)): 친화적 LLM이 생성했어도 prod DB에서 무인 실행되는 SQL은 untrusted 입력으로 다룬다. 두 지점에서 독립 통과해야 실행:

| 게이트 | 위치 | 방어 |
|--------|------|------|
| #1 정적 검증 | 승인 시 (`approveLlmSignal`) + 실행 직전 (`runLlmSignalSql`) | `validateSignalSql` — 단일 SELECT/WITH·`$1/$2`만·`user_id=$1` 강제·테이블 화이트리스트·DDL/DML/위험함수 차단·길이 상한 |
| #2 실행 격리 | 실행 시 (`runLlmSignalSql`만) | `queryReadOnly` — `SET TRANSACTION READ ONLY`(쓰기를 PG가 거부=검증 우회 백스톱) + row cap + 항상 ROLLBACK |

- 게이트 #1이 1차 방어, 게이트 #2는 정적 검증을 우회한 쓰기 시도를 PG 레벨에서 막는 백스톱. **앱 레벨 read-only TX** 채택(전용 DB 역할 대비 인프라 변경 0 — follow-up).
- **`source='llm'`만 격리** — seed 신호 71개는 기존 신뢰 경로(`runMetricSql`) 무변경. `runnerForSource(source)`가 `evaluateMetric`(일별 매칭)·`computeSignalSeries`(주간 검증+발굴) 두 실행 경로에서 분기.

**검증 게이트** ([signal-sql-guard.ts](../../src/shared/signal-sql-guard.ts) `validateSignalSql`, 통과 시 null·실패 시 한글 사유): self-contained(보안 경계를 한 파일에서 감사, 외부 리팩토링이 조용히 약화 못 하게). 빠른 실패 순서 — 길이 → 단일문 → SELECT/WITH → 블록패턴(`db-proxy.ts BLOCKED_PATTERNS` 정렬 + DML 전수 + `information_schema`/`pg_catalog`) → 플레이스홀더(`$1`/`$2`만) → 테이블 화이트리스트 → `user_id=$1` 스코프.

- **테이블 화이트리스트(deny-by-default, `SIGNAL_TABLE_WHITELIST`)**: prod introspection으로 확정한 5개 신호 도메인의 행동 데이터 테이블 10개(`schedules`·`schedule_changes`·`routine_templates`·`routine_records`·`routine_inactive_periods`·`sleep_records`·`sleep_events`·`expenses`·`categories`·`diary_meta_tags`). 의도적 제외 — 재정(`assets`·`incomes`·`budget_*`·`fixed_cost*`, 도메인 밖+민감) / 시스템·메타(`signal_defs`·`pattern_links`·`users`·`custom_instructions`, 자기승인·변조·교차유저 차단) / 사주 내부·마스터 / `diary_entries`(원문, 헌장 ① — 일기는 메타 태그로만).
- **오탐 방지(빌드 정련)**: 순진한 `FROM/JOIN` 추출은 `EXTRACT(EPOCH FROM …)` 내부 `FROM`과 CTE 이름을 테이블로 오인(prod 시드 신호에서 `min`·`rc` 오탐 실측). → `EXTRACT(…)` 제거 후 추출 + CTE 이름(`WITH x AS (…)`)은 화이트리스트 면제.

**`source` 스레딩**: `SignalDef.source`·`SajuMetric.source`(`'seed'|'llm'`) 추가 → 두 loader(`verifyUserLinks`·`loadActiveSeeds`·`loadActiveSignals`) SELECT에 `source` + `computeSignalSeries`/`evaluateMetric`가 `source==='llm'`이면 격리 실행기로 분기. 단일 숫자 추출은 `extractFirstNumber` 공통 헬퍼.

**승인 카드/액션** (P5a 게이트 재사용):

| 요소 | 구현 |
|------|------|
| 카드 ([llm-signal-cards.ts](../../src/agents/insight/llm-signal-cards.ts) `buildLlmSignalCard`) | `[신호 제안] {name}` + 측정 의도(자연어) + `측정: {domain}·{valueType}/{direction}` + **검토용 SQL을 context 블록에 노출**(투명성) + caveat("승인=측정 시작이지 인과 아님") + `[측정 시작]`/`[반려]`. payload=`{signalId}` |
| 승인 ([actions.ts](../../src/agents/insight/actions.ts) `approveLlmSignal`) | SELECT `sql_body` → **게이트 #1 재검증**(저장된 SQL도 불신) → 통과 시에만 `status='active'`. `WHERE id=$1 AND user_id=$2 AND status='pending' AND source='llm'` 가드 |
| 반려 (`rejectLlmSignal`) | `pending → rejected`. 동일 가드. 재제안 시 LLM이 차이 명시 의무 |

- 옛 `metric-approval-cards.ts`(폐기 `pattern_metrics` era) 삭제·교체, `METRIC_INTERACTION_SUSPENDED_P5B` 플래그 해제.

**미승인 = inert**: `status='pending'` 신호는 매칭(`loadActiveSeeds`)·검증(`verifyUserLinks`)·발굴(`loadActiveSignals`) 모두 `status='active'`만 SELECT → **승인 전까지 SQL이 한 번도 실행되지 않음**(077 status 게이트). 나쁜 `sql_body`가 등록돼도 무해 — 사람이 승인해야(게이트 #1 통과 시) 비로소 실행 대상.

**P5a vs P5b 경계** (겹침 없음): 발굴(P5a) = *기존 신호*를 시드와 off-day로 연결(가설 발견) / LLM(P5b) = *새 신호*를 생성(측정 정의). 둘 다 같은 승인 게이트(pending→active) + 통계가 심판(헌장 ①). LLM은 생성만, 판정은 통계.

**월간 routine** (`monthly-signal-suggest`, 로컬 SKILL·repo 외): 매월 09:30 KST Opus([ADR-0027](../adr/0027-llm-async-work-as-claude-app-routines.md)). 입력 풀 = 라이프 메트릭 표(카운트·평균만, **금액 제외**) + 시드 description + 기존 active/rejected 신호(중복·재제안 관리). 텍스트 원문 0(헌장 v2 ①). 생성 계약 = 단일 SELECT·`user_id=$1`·화이트리스트 테이블·`value_type`/`direction` 지정. idempotency = 최초 액션에서 `signal_suggest_runs` 원자적 클레임(`INSERT ... ON CONFLICT (user_id, month_start) DO NOTHING RETURNING` → 빈 결과면 후보 생성·발송 전에 즉시 종료). 재실행·스케줄러 중복 fire 어떤 원인이든 하나만 승리 — 마이그 [094](../../db/migrations/094_signal_suggest_runs.sql), 선택 근거·weekly(062) 대비 최초-클레임 이유는 [ADR-0053](../adr/0053-signal-suggest-idempotency.md). cap 월 5. 등록 INSERT는 DB proxy `validateProxySQL` 통과, 임베드 `sql_body`는 게이트 #1/#2가 심판.

**기각 이력 신호 재생성 가드** (#557): 동일 측정 정의가 기각→재등장→기각 루프를 돌며 승인 카드 피로 + 통계 가족 m-인플레이션을 만드는 것을 차단. 신호 자동 생성 직전 동일 정의를 판정하는 공통 헬퍼 `findEquivalentSignal`([signal-defs.ts](../../src/shared/signal-defs.ts)) 신설.

- **매치 키**: `(name, direction, kind, threshold, tag_name)` + sql 신호는 `sql_body` 포함. NULL은 `IS NOT DISTINCT FROM`. `user_id` 격리 + `excludeId`(자기 제외).
- **재사용 규칙**: active/pending 동일 정의 → 재사용(재생성 안 함) / **rejected만 있는 동일 정의 → 스킵**(기각 유지) / 없으면 생성 허용.
- **`ensureMirrorSignalDef`(#555) 일원화**: 자체 기각-스킵 로직을 이 헬퍼로 통합.
- **`approveLlmSignal` 최종 방어선**: 승격 직전에 `findEquivalentSignal` 가드 추가 — 다른 active/pending 동일 정의(중복)거나 rejected 동일 정의(재활성화)면 활성화 거부. routine(repo 밖) INSERT에 대한 봇 최종 방어.
- **마이그 [099](../../db/migrations/099_signal_defs_pending_identity.sql)**: 085의 active-only 부분 unique 인덱스를 active/pending으로 확장(방어적 — 기존 중복 잔존 시 NOTICE만 내고 인덱스 생성 스킵, 롤백 없음).

### 31. 매트릭 중심 패턴 검증 — Phase 6 (교란 플래그: 공동발현 시드 marginal 탐지, #493)

off-day 검증(P2)은 단일 시드의 **marginal 연관**만 본다 — 같은 날 공존하는 제3변수(요일·주말·월위치·계절 = 달력 주기, 또는 다른 사주 시드)가 시드와 신호 둘 다를 끌면 가짜 연관(교란·"어부지리")이 생긴다. P6는 claimable (시드 S × 신호 X) 링크마다 공동발현 교란 시드 Z를 탐지해 `pattern_links.confound`에 기록하고 주간 카드에 노출한다. 정본 [ADR-0041](../adr/0041-confound-cofiring-flag.md). **새 통계 코어 0, 마이그레이션 0**(077 `confound` 컬럼 재사용) — P4a/P4b/P5a 패턴 5연속.

**feature 환원 노선** (vs 새 통계 검정): 교란변수가 **이미 18개 `life_signal` 결정론 시드**([072](../../db/migrations/072_life_signal_seed_pool.sql): 요일 7 + 주말/평일 2 + 월위치 3 + 계절 4 + 공휴일 2)라 활성 시리즈를 가진다 → 플래그가 **기존 시드 활성 시리즈 + 기존 2×2(`buildContingency`/`verifyContingency`) 재사용**으로 환원된다([ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md) "운 레벨 → feature 환원"이 달력 변수엔 #434 P3에서 이미 적용됨). partial correlation 같은 새 회귀 검정은 기각.

**교란 알고리즘 (marginal 2조건)** ([confound.ts](../../src/shared/confound.ts) `flagConfoundersForLink`): 링크(S × X)에 대해 후보 Z(≠ S)가 **둘 다** 만족하면 "교란 의심"으로 수집(overlap 내림차순 → `topN` cap):

| 조건 | 식 | 의미 |
|------|------|------|
| (a) 공동발현 | `P(Z active \| S active) ≥ minOverlap` **AND** `nCofire ≥ minCofireDays` | S 켜질 때 Z도 대체로 켜짐(노이즈 바닥) |
| (b) Z↔X 연관 | `(Z active vs off) × (X pass/fail)` 2×2의 `rate ratio ≥ minEffectZX` | Z 자체가 신호와 연관돼야 교란원 |

(a)만으론 신호와 무관한 겹침 시드까지 다 잡혀 노이즈 폭발 → **(b) 필수**. 후보 Z = **달력 18 + 모든 active 사주 시드**(달력만이 아니라 사주끼리의 어부지리도 포착, [ADR-0032](../adr/0032-metric-first-verification-statistics.md) §6 "다중 트리거 공존").

**`confound` JSONB** ([077](../../db/migrations/077_signal_defs_and_links.sql) 선언, P6 채움):

```json
{ "scannedAt": "2026-06-08",
  "suspected": [{ "seedId": 0, "seedName": "주말", "overlap": 0.0, "effectZX": 0.0, "nCofire": 0 }] }
```

`scannedAt`을 항상 기록해 "점검했으나 깨끗(suspected=[])"과 "미점검"을 구분한다.

**annotate-only(정직 플래그)**: 플래그는 `confound`에 SET + 주간 카드 verified/emerging 라인에 `⚠️ 교란 의심: {Z} 공존` 한 줄(reject는 연관 자체가 약해 생략). **verdict·status·e-value·tier는 건드리지 않는다** — 확정을 죽이지 않고 "어부지리일 수 있다"를 정직하게 알릴 뿐. 강등·추정치 조정은 P7.

**always-on(데이터 게이트 아님)**: 플래그는 싸고(캐시된 시리즈 위 overlap + 2×2) marginal이라 데이터 적어도 valid → 매주 무조건 실행. `nCofire`를 기록해 **P7 다변량 분리가 `nCofire ≥ 임계(\~30일)`에서 자동 활성**(헌장 ④)되게 한다.

**흐름** (주간 엔진 [weekly-verification.ts](../../src/cron/weekly-verification.ts) `processUser`, `verifyUserLinks` 후·카드 전):

```
flagConfounds(userId, today)                          # confound.ts 로더
  → claimable 링크 로드 (status IN active|confirmed, JOIN active 신호·시드)
  → 후보 = 모든 active 시드 (loadActiveSeeds)
  → 시드 활성 시리즈 시드당 1회 (computeSeedActivationSeries, strength_band 2-pass 캐시)
  → 링크 등장 신호 시리즈 신호당 1회 (computeSignalSeries)
  → 링크별 flagConfoundersForLink → ConfoundResult[]
persistConfound (per-link 격리, UPDATE confound) → confoundByLink 맵
buildVerificationBlocks(…, confoundByLink)            # 카드 caveat
```

- **claimable = `status IN ('active','confirmed')`**: confirmed는 sticky라 `verifyUserLinks`(active만) results에 없음 → 교란 패스가 독립 로드. 카드 노출은 active만, DB 기록은 둘 다(P7 다변량 분리가 confirmed 링크도 읽음).
- **시리즈 self-contained**: P5a 발굴과 동형으로 자체 계산·격리 — `verifyUserLinks` 코어 무변경(blast radius 최소). 발굴과의 시리즈 공유(`computeActiveSeriesBundle` 추출)는 follow-up 최적화. 검증/발굴/교란 3단계는 독립 try-catch로 격리(한 단계 실패가 나머지를 막지 않음).

**P6 vs P7 경계**: P6 = marginal 플래그(노출, always-on). P7 = 다변량 분리(층화/elastic-net로 Z 통제 후 S 독립 기여 추정 = *조정*, 데이터 게이트 `nCofire ≥ \~30`, dormant 빌드). marginal 겹침만으로 임의 강등하면 진짜 패턴 살해 위험 → 조정은 데이터가 충분할 때만. daily-insight verified tier 교란 caveat는 P7로(`saju_influence_summary` 뷰가 P7에서 조정 추정치로 재정의되므로 거기 묶음).

**노브** ([insight-thresholds.ts](../../src/shared/insight-thresholds.ts) `confound`, 헌장 ⑤): `minOverlap`(0.6)·`minCofireDays`(10)·`minEffectZX`(1.3, `patternVerification.minRateRatio` 승계)·`topN`(3). calibration 노브 — 첫 몇 주 튜닝.

### 32. 매트릭 중심 패턴 검증 — Phase 7 (교란 다변량 분리: Mantel-Haenszel 층화 + 데이터 게이트, #495)

P6는 marginal 교란을 **플래그**하고 각 (링크 × 교란 Z)의 공동발현일 수 `nCofire`를 기록만 했다(annotate-only). P7은 공동발현이 충분히 쌓인 쌍만 **Mantel-Haenszel 층화**로 조정 추정치를 산출해 어부지리(가짜 연관)를 노출에서 실제로 걷어낸다. **마스터 #477 마지막 phase**. 정본 [ADR-0042](../adr/0042-confound-multivariate-stratification.md). **새 통계 코어 = MH 풀링 함수 하나, 마이그레이션 083(뷰 재정의 only)** — feature 환원(P4a\~P6 "새 통계 코어 \~0") 연속.

**방법 = Mantel-Haenszel 층화** (vs [ADR-0032](../adr/0032-metric-first-verification-statistics.md) §6 지명 elastic-net): 시드 S·신호 X·교란 Z가 전부 결정론 binary + 교란 2\~3개 캡 + n=1 희소 → 층화가 교과서적·가볍다(층별 2×2 = P6 프리미티브 재사용). elastic-net은 새 통계 코어(페널티 GLM 솔버)·log-odds 이질 척도·λ 불안정 → **교란이 층화 한계(joint strata 폭발) 넘는 다수일 때**를 위한 후속 노브(기본 off, [ADR-0042](../adr/0042-confound-multivariate-stratification.md) §1).

**MH 조정 알고리즘** ([confound.ts](../../src/shared/confound.ts) `adjustConfounders` + [stats.ts](../../src/shared/stats.ts) `mantelHaenszelRR`), 링크(S × X)마다:

1. **게이트 통과 교란** = P6 `suspected` 중 `nCofire ≥ adjustMinCofire`(30). 0개면 조정 스킵(dormant — `confound.adjusted` 미기록, 뷰 무변화).
2. **층 구성** (joint, cap 3): 게이트 통과 Z들의 값 조합으로 윈도우 일자 분할(1개 → 2층, k개 → 최대 2^k층). 층 k에서 `buildContingency(actS\|층k, sigX)` → 2×2.
3. **viability 게이트**: 각 층 `n_k ≥ minStratumCell`(5) **AND** S발현·S비발현 양쪽 존재. 한 층이라도 미달이면 joint 포기 → **fallback: 가장 강한 단일 Z**(`overlap × effectZX` 최대)로 2층 MH. 그래도 미달이면 조정 불가(suspected만 유지).
4. **MH 조정 rate ratio** (Greenland-Robins): `RR_MH = Σ_k [aₖ·(cₖ+dₖ)/nₖ] / Σ_k [cₖ·(aₖ+bₖ)/nₖ]`. 분모 합 0 → NaN(조정 불가). 순수 함수 → 주간 SET 리플레이 불변.
5. **verdict** (`adjEffect = RR_MH` vs marginal):

   | 조건 | verdict | 노출 |
   |------|---------|------|
   | `adjEffect < explainAwayMaxEffect`(1.3) | `explained_away` | verified **강등** + caveat |
   | `explainAwayMaxEffect ≤ adjEffect < marginal·attenuatedMaxRatio`(0.8) | `attenuated` | 유지 + 약화 caveat |
   | 그 외 | `survives` | 유지(통제해도 살아남음) |

**`confound` JSONB 확장** (P6 형태에 추가, 게이트 통과 시만):

```json
{ "scannedAt": "…", "suspected": [ … ],
  "adjusted": [{ "seedId": 0, "adjEffect": 1.0, "nCofire": 40, "verdict": "explained_away" }],
  "explainedAway": true }
```

`adjusted`는 게이트 통과 교란별 MH 결과(joint면 기여 Z마다 같은 `adjEffect`/`verdict` 공유, fallback이면 단일). `explainedAway`는 뷰 verified 가드가 읽는 플래그.

**노출 레이어 soft-demote** ([083](../../db/migrations/083_confound_adjustment_exposure.sql) `saju_influence_summary` 재정의, [ADR-0042](../adr/0042-confound-multivariate-stratification.md) §3):

- **verified 가드**: confirmed 링크 JOIN에 `(l.confound->>'explainedAway') IS DISTINCT FROM 'true'` 추가 → 시드는 **explained_away 아닌 confirmed 링크가 ≥1개일 때만** verified. 모든 confirmed 링크가 explained_away면 verified에서 빠짐 → recent(최근 발현 시) tier로 강등.
- **`confound_note` 컬럼**(말미 append): 각 행에 그 시드의 explained_away 링크가 통제한 교란 `seedName` 집계(`adjusted` seedId → catalog 이름 join, 없으면 NULL). daily-insight caveat 입력. 컬럼 계약(앞 12개) 보존.
- **e-value·status 불변**: e-value는 순서 있는 데이터의 순수 함수(결정론 리플레이, [ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md))이고 marginal 진실의 기록 → 조정은 *노출*에만 작용(마틴게일 불변성 보존). P6=노출(marginal 정직), P7=조정(노출에 반영).

**dormant (데이터 게이트, 헌장 ④)**: 현 데이터 대부분 `nCofire < 30` → 조정 0건 → `confound.adjusted` 미기록 → 뷰 explained_away 가드 매칭 0 → **배포 시 동작 변화 0**. 공동발현 30일 누적 시 다음 주간 run이 자동 조정.

**흐름** (주간 엔진 [weekly-verification.ts](../../src/cron/weekly-verification.ts) `processUser`, P6 플래그 패스에 fold — 시리즈 in-hand 재사용):

```
flagConfounds(userId, today)                          # confound.ts (P6 + P7 통합)
  → 링크별 flagConfoundersForLink → suspected (P6 marginal)
  → adjustConfounders(actS, sigX, suspected, candById) (P7 — 게이트 통과 시만)
       gate(nCofire≥30) → joint 층화(viability) ?? 단일 Z fallback → mantelHaenszelRR → verdict
  → ConfoundData{ suspected, adjusted?, explainedAway? }
persistConfound (UPDATE confound JSONB, per-link 격리) → confoundByLink 맵
buildVerificationBlocks(…, confoundByLink)            # 카드 caveat (verdict별)
saju_influence_summary 뷰 (verified 가드 + confound_note) → daily-insight 소비
```

**P6 vs P7 경계**: P6 = marginal 플래그(노출, always-on). P7 = 다변량 분리(MH 층화로 Z 통제 후 S 독립 기여 = *조정*, 데이터 게이트 dormant). marginal 겹침만으로 임의 강등하면 진짜 패턴 살해 위험 → 조정은 데이터 충분할 때만, 강등도 노출 레이어에서만(status·e-value 불변).

**노브** ([insight-thresholds.ts](../../src/shared/insight-thresholds.ts) `confound`, 헌장 ⑤): P6(`minOverlap`·`minCofireDays`·`minEffectZX`·`topN`) + P7 `adjustMinCofire`(30, flag floor 10보다 높게)·`explainAwayMaxEffect`(1.3, `minRateRatio` 승계)·`attenuatedMaxRatio`(0.8)·`minStratumCell`(5)·`elasticNetEnabled`(false, 후속). 첫 몇 주 calibration. 뷰의 explained_away 가드는 JSONB 플래그라 SQL 하드코딩 없음(노브는 TS 조정 단계에만).

**데이터-존재 윈도우 클립** (#556, [ADR-0044](../adr/0044-discovery-measurement-validity.md) 연장): P6의 overlap·`nCofire`·Z×X 2×2와 P7의 층화·marginal 계산이 검증 엔진과 **같은 데이터-존재 윈도우**를 쓰도록 클립한다. 기록 시작 이전의 빈 과거가 비발현·실패일로 세어지던 입력 편향을 P7 조정이 데이터 게이트를 통과하기 전에 정렬. `flagConfounds`가 `computeUserDataStarts`를 1회 산출 → 신호별·시드별 데이터 시작일 합성, 신호 시리즈도 자기 도메인 시작일 기준으로 계산(baseline 오염 차단). 링크(S×X) 기본 클립 = `max(시드 S 시작, 신호 X 시작)`, Z가 끼는 계산은 후보 Z의 시드 시작일도 `max` 합성. **판정 로직·임계치는 불변 — 입력 창만 교정.** (은퇴 크론 슬롯 비활성화는 같은 PR 마이그 097.)

### 33. 발굴 엔진 측정 타당성 + 카드 UX — Phase 1 (측정 타당성, #504)

첫 주간 발굴이 띄운 후보가 전부 "루틴 streak × 수면" 같은 허수였고, effect가 150\~180배로 사주 후보를 밀어냈다. 원인은 우연 검정이 아니라 **측정 타당성** — 통계 안전장치(Fisher/BH-FDR/e-value)는 "우연이냐"만 보지 "측정이 맞냐"는 못 본다(GIGO). 상세 판단은 [ADR-0044](../adr/0044-discovery-measurement-validity.md) · [discovery-refinement.md](../design-notebook/discovery-refinement.md).

#### 1) 데이터-존재 윈도우 (아티팩트 근본 원인)

윈도우가 365일 고정인데 도메인별 실제 데이터는 더 짧다. 수면 신호 SQL이 `COALESCE(SUM,0)`이라 **기록 없는 빈 과거를 "0분 수면=발현 안 함(fail)"으로** 세 → 비발현일 pass율(rateOff)이 0으로 깔리고 `effect = rateActive/rateOff`가 폭발. 순수 시간 교란(데이터 있는 최근 vs 텅 빈 과거).

- **per-pair 데이터-존재 구간**: 윈도우 = `[max(시드 시작일, 신호 시작일), today]`. 그 시드와 그 신호가 **둘 다 데이터를 가진 구간**만 2×2·day 시퀀스에 넣는다.
  - 신호 시작일 = 도메인 테이블 `MIN(date)` ([pattern-verification.ts](../../src/shared/pattern-verification.ts) `DOMAIN_TABLE`: schedule→schedules, sleep→sleep_records, routine→routine_records, expense→expenses, diary_meta→diary_meta_tags, audit→schedule_changes). audit만 `date` 컬럼이 없어 `MIN(DATE(changed_at))` 특례로 산출(§42, #572).
  - 시드 시작일 = saju는 글로벌 floor(매일 일운 존재), life_signal은 의존 도메인 시작(threshold/behavior_baseline→해당 테이블, 캘린더류→floor).
  - **단일 글로벌 floor로는 부족** — 한 도메인이 다른 도메인보다 먼저 시작하면(예: 지출 기록이 일정보다 이름) floor가 늦게 시작한 신호를 과거로 늘려 같은 아티팩트를 재생산. per-signal 클립이 필수.
- **빈 과거는 결측, 활성 기간 내 0은 보존**: 신호 시작일 이전 raw를 `null`로 처리([computeSignalSeries](../../src/shared/pattern-verification.ts) `dataStart`) → 2×2 제외 + rolling baseline 오염 차단 + 그 날 SQL 실행 생략. 활성 기간 내 "기록 없음(유효 0)"은 의미로 살린다.
- 검증([verifyUserLinks](../../src/shared/pattern-verification.ts))·발굴([discoverCandidates](../../src/agents/insight/hypothesis-discovery.ts)) **둘 다 동일 클립** 경유 → 양쪽 정직. `windowCapDays`(365)는 상한 안전장치로 격하(평소 데이터-존재 구간이 더 좁아 binding 안 됨).

#### 2) 발굴 연속신호 효과크기 랭킹 (§4 준수)

ADR-0032 §4 = "연속 신호는 이진화하지 말고 Mann-Whitney + 효과크기로". 검증 엔진은 지키는데 발굴은 raw를 버리고 이진화 rate ratio로 top-N을 잘라 위반하고 있었다.

- **연속 신호**: raw 보존 → `splitRawByActivation` → `mannWhitneyU`. 효과크기 = Hodges-Lehmann(위치이동, 카드 raw 단위) + rank-biserial(scale-free `[-1,1]`)을 방향 하한(`discoveryMinEffectR`=0.2)으로.
- **이진 신호**: 기존대로 rate ratio(`discoveryMinEffect`=1.3) + Fisher.
- **혼합 정렬**: 두 타입을 **표준화 z**로 통일(연속=방향 MW z, 이진=2-proportion z). z는 SNR이라 표본 작은 0-분모 아티팩트가 폭증 못 함 — 윈도우 교정과 함께 허수 독식을 이중 차단. block-perm q 게이트(이진 substrate)는 공통 유지 → e-value 확정 트랙 불변.
- 카드 표시 자연어화는 Phase 2. 이 PR은 측정만 — `DiscoveryCandidate`에 `valueType`·`effectSize`(HL)·`mwP`·`sortZ` + `test_detail` 동봉, 연속은 `test_type='mann_whitney'`.

#### 3) 중복 `signal_defs` 정규화 (마이그 085)

077이 `pattern_metrics`(시드별 행)를 1:1 이관하며 동일 측정 신호가 시드 수만큼 중복 생성(전역화 미완) → 같은 카드 2장+ + 여집합 cross-product 부풀림.

- 전체 시맨틱 키 `(user_id, name, kind, sql_body, value_type, direction, threshold, domain, window_days)` 일치만 "같은 신호" → canonical(active 우선, 그다음 MIN id)로 [085](../../db/migrations/085_dedup_signal_defs.sql). `schedule_count_today` above/below처럼 방향만 다른 건 보존.
- `pattern_links` repoint(`UNIQUE(seed_id,signal_id)` 충돌·중복은 삭제, canonical 우선) → 잉여 신호 `status='rejected'`(FK·이력 보존) → active sql 부분 unique 인덱스로 재발 차단(tag는 077 인덱스가 이미 보장).
- **prod dry-run 검증**: active sql 신호 46 → canonical 22(잉여 25 rejected, 12개 중복군), 정규화 후 active 중복군 0.

#### 영향·리스크

- 검증 e-value **1회 re-baseline** — 클립으로 day 시퀀스가 바뀌나 결정론이라 매주 수렴. confirmed 링크는 sticky(active만 재검증)라 영향 없음.
- 교란 조정([confound.ts](../../src/shared/confound.ts), P7)은 같은 클립 미적용 — dormant(annotate-only, verdict 불변)라 라이브 영향 없음. 활성화 전 적용 필요(코드 TODO 마커).

### 34. 발굴 엔진 측정 타당성 + 카드 UX — Phase 2 (카드 가독성, #504)

Phase 1이 측정을 고친 뒤 다음 병목은 가독성이었다. 프로액티브 인사이트 카드(발굴 후보·주간 검증·시드 영향력·아침 일운)가 전부 내부 식별자를 날것으로 노출했다 — 시드·신호명이 변수명(`S1_갑목_편재_천간`·`sleep_night_minutes`)이고, 신호 description은 **잘못된 provenance**("N8\_… 시드의 X 평가" — 신호는 P1에서 전역화됐는데 옛 시드 종속 시절 자동생성 문구가 잔존). 사람이 [추적 시작]/[패스]로 노출을 게이트하려면(마스터 원칙 #2: 가독성 = 큐레이션 게이트) 후보가 무슨 뜻인지 읽혀야 하는데, 식별자 노출이 게이트를 무력화한다. 결정 = 런타임 코드 번역, DB·통계·view 불변([ADR-0045](../adr/0045-card-label-layer.md)). verdict·tier·임계치 일절 불변 — 표현 문자열만(#502 카피 PR 연장).

#### 1) 라벨 모듈 + 비대칭 (시드 strip / 신호 룰)

순수 함수 [insight-labels.ts](../../src/shared/insight-labels.ts)(`seedLabel`·`signalLabel`)가 카드 조립 지점에서 라벨 문자열을 생성. 시드와 신호는 description 신뢰도가 정반대라 생성 규칙이 비대칭이다:

- **시드 = description tail-strip.** 시드 description은 hand-authored라 접두가 곧 활성조건. 첫 `→`/`—` 앞만 취한다("일운 천간 갑목(편재) → 일정/지출 폭증" → "일운 천간 갑목(편재)", "갑술 60갑자일 — … 콤보 — 본인 일지 비화" → "갑술 60갑자일"). 십성 주석 "(편재)"은 보존(`(`는 구분자에서 제외), 예측절·내부 참조(ADR)·가설 꼬리표는 자동 탈락. 6종 trigger 구조 파싱 불필요.
- **신호 = name+domain+direction 룰.** 신호 description은 깨진 provenance라 못 쓰고 metadata로 생성. 측정 명사는 `SIGNAL_MEASURE` 맵(한글접미 `expense_배달음식`→"배달음식 지출"), 방향은 룰(above_avg→"평소보다 많음", 율·시각은 높음/낮음·늦음/이름), 합성·모호 4개는 `SIGNAL_LABEL_OVERRIDES`("세금 관련 일정" 등), tag 신호는 diary 26태그 한글맵, llm 신호는 자작 description.

#### 2) 4개 표면 — hard / soft

| 표면 | 빌더 | 방식 |
|------|------|------|
| 주간 검증 (verified/emerging/reject) | [hypothesis-cards.ts](../../src/agents/insight/hypothesis-cards.ts) | 코드 룰 (hard) |
| 발굴 후보 카드 | hypothesis-cards.ts | 코드 룰 (hard) |
| 시드 영향력 top | hypothesis-cards.ts | 코드 룰 (hard) |
| 아침 일운 카드 | 외부 SKILL `daily-insight` | 프롬프트 손질 (soft) |

- 코드 표면 3개: 라벨을 **로드 지점**에서 계산해 DTO에 문자열로 실어 운반(카드 빌더는 변수명·raw 필드 모름). [discoverCandidates](../../src/agents/insight/hypothesis-discovery.ts)→`DiscoveryCandidate`, [verifyUserLinks](../../src/shared/pattern-verification.ts)→`LinkVerification`, [loadSeedInfluence](../../src/cron/weekly-verification.ts)→`SeedInfluenceRow`에 `seedLabel`/`signalLabel` 동봉.
- **교란 caveat**(verified/emerging 라인에 붙는 ⚠️)도 교란 시드명(변수명)을 노출하던 누락 — 카드 레이어에 `seedLabelById` 맵을 주입해 해소([confound.ts](../../src/shared/confound.ts)·JSONB 불변, Option B). weekly-verification이 active 시드 전체로 맵을 빌드해 `buildVerificationBlocks`에 전달.
- 아침 카드는 외부 SKILL이 SQL view(`saju_influence_summary`)를 소비해 LLM으로 작문 → TS 룰 도달 불가. 프롬프트에 "변수명·식별자 출력 금지 + description 자연어화" hard rule 주입(soft, 배포 후 적용). view·DB 불변.

#### 3) 불변식 — raw 변수명 노출 0

미매핑 신호(미래 LLM 신호 등)도 도메인 명사 fallback(`DOMAIN_NOUN`+한글접미 보존)으로 끝내 raw 변수명이 사용자에게 노출되지 않는다. prod 전수 재현(active 신호 44 + 전 시드 타입 대표)에서 누출 0건 확인.

#### 영향·리스크

- DB·통계·view 불변 → 리스크 낮음. 라벨이 틀리면 코드 한 줄 고쳐 배포(컬럼 값 수정보다 추적 쉬움).
- 아침 카드 라벨은 LLM 작문 경로라 같은 시드 문구가 표면별로 미세하게 다를 수 있음 — 수용(둘 다 readable이면 충분). 완벽한 cross-surface 일관성은 보류한 B안(DB label 컬럼)의 몫.
- 신호 description의 깨진 provenance는 카드가 더는 읽지 않아 dormant(DB 잔존·미사용) — 별도 정리 불요.

### 35. 발굴 엔진 측정 타당성 + 카드 UX — Phase 3 (후보 재추천, #504 / #512, ADR-0047)

발굴([ADR-0039](../adr/0039-pattern-discovery-surface-and-approval-gate.md))은 월요일 06:00 주간 검증 직후 1회만 후보를 surface한다. 사용자가 그 묶음을 전부 [패스]하면 — 여집합에 다음 best 쌍이 남아있어도 — 다음 주 월요일까지 새 후보가 안 뜬다. evidence-only 시드가 검증 트랙에 닿는 속도가 주1회 묶음에 묶이는 게 병목이었다. **데일리 반응형 cadence**를 추가해 묶음 전부 패스 시 다음 best 묶음을 띄운다. 통계·verdict·tier·승인 게이트·카드 빌더·DB 스키마 전부 불변 — 발굴 *재실행 시점*만 늘림([ADR-0047](../adr/0047-discovery-recommendation-cadence.md)).

핵심 통찰: `discoverCandidates`의 여집합은 `pattern_links`에 (어떤 status로도) 없는 쌍만 본다. 한 번 surface된 쌍은 pending·archived·active 어디로든 여집합에서 빠진다 → **발굴 재실행만으로 다음 best가 공짜**(커서·페이징 없음).

#### 1) 전용 데일리 슬롯 + 공유 함수

- **슬롯** `discoveryRecommend`(`notification_settings`, 07:30 KST, 마이그 `087`) → `SLOT_TASKS` 등록. **Life Cron 7→8**(#508이 8→7로 줄인 직후 실기능 1개 추가라 churn 아님). 매칭 cron(07:00, "발송 없음" 단일 책임)과 데이터 의존 없어 합류 대신 독립 슬롯 — 시각·on/off 별도 튜닝.
- **공유 함수** `recommendDiscoveries(app, userId, channelId, today)` — weekly-verification의 private `surfaceDiscoveries`를 [discovery-recommend.ts](../../src/cron/discovery-recommend.ts)로 추출(함수 레벨 DRY). 월요일 검증 후 발굴과 데일리 재추천이 같은 surface 본문 공용, 동작 불변.

#### 2) 예측 게이트 (싼 COUNT → 무거운 재실행)

데일리 틱은 유저별로 싼 COUNT 1방을 먼저 던지고, 통과할 때만 무거운 `discoverCandidates` 풀스캔을 돈다.

- **이번주 묶음** = `pattern_links WHERE source='discovery' AND created_at >= 이번주_월요일 00:00 KST`. 경계는 `thisWeekMondayISO(today)` 헬퍼([kst.ts](../../src/shared/kst.ts)) — 기존 `previousMondayISO`(전주, 카드 라벨용)와 구분.
- **발사 술어** `decideReRecommend(total, archived, cap)` = `total>0 && archived===total && total<cap`(순수 코어, 단위 테스트). `archived===total` 단일 조건이 "무응답 보류"(pending 남음 → `archived<total`)와 "일부 승인 정지"(active 있음 → `archived<total`)를 동시에 배제 — 전부 패스됐을 때만 다음 묶음.

| 이번주 발굴 묶음 | total/archived | 발사 |
|------|------|------|
| 없음 (자연 소진) | 0/0 | ✗ |
| 전부 패스, cap 미만 | 5/5 | ✓ 다음 best |
| 일부 미응답 (pending) | 5/4 | ✗ 보류 |
| 전부 무응답 | 5/0 | ✗ 보류 |
| 일부 추적 시작 (active) | 5/3 | ✗ 그 주 정지 |
| cap 도달 | 20/20 | ✗ 백스톱 |

#### 3) 정지 — 자연 소진 1차 + cap 백스톱

- **1차**: 여집합 소진 → `discoverCandidates` 빈 배열 → 조용히 멈춤(추가 카드 0).
- **2차**: `weeklyDiscoveryCap=20`([insight-thresholds.ts](../../src/shared/insight-thresholds.ts)) — 느슨한 `discoverQ=0.15`에서 한계 후보가 매일 올라오는 병적 케이스의 카드 피로 백스톱. 값은 튜닝 노브(헌장 ⑤).
- 매주 `created_at` 스코프 자동 리셋(다음 월요일 묶음은 새 주로 카운트), archived 영구 제외.
- **이중 surface 없음**: 월요일도 데일리 틱이 돌지만 06:00 묶음이 pending이라 `archived===total` false → 무발사.

#### 데이터 모델 — 파생(무테이블)

새 테이블 0. 라운드·상한 상태를 전부 `pattern_links`의 `created_at`+`status`에서 파생(ADR-0045 A안 정신: 파생 가능하면 DB 미변경). 추가는 노브 1개(`weeklyDiscoveryCap`) + 경계 헬퍼 1개(`thisWeekMondayISO`)뿐. 라운드 카운터 테이블(`discovery_rounds`)·자동 활성(게이트 없이 다음 묶음 추적)은 기각 — 후자는 ADR-0039 노출·믿음 분리 위반.

#### 회고

기존 설계의 속성(여집합 자동제외)을 읽어 새 기능을 페이징·커서 없이 얻은 게 핵심 — 재추천 = 발굴 재실행 한 줄. 상태도 파생으로 환원해 DB·통계·카드 0 증분(노브 1 + 헬퍼 1). `archived===total` 단일 술어가 보류·정지·발사 3분기를 한 번에 표현하는 게 설계의 압축점. 싼 예측 게이트가 무거운 풀스캔을 데일리로 돌려도 비용을 게이팅 — n=1·예측 통과 시에만 스캔이라 ADR-0039의 풀스캔 단점을 현재 수용.

### 36. 신호·시드 측정 정밀화 (#508, ADR-0046)

#477·#504 운영 데이터에서 드러난 신호·시드 측정의 거칠음 4종 교정. 통계 스택·verdict·tier·임계치는 불변 — *무엇을* 측정하는지(신호 정의)와 *어떤* 시드를 살려두는지(시드 위생)만 손댄다. 마이그레이션 `086_signal_seed_precision.sql`(①② 단일 암묵 트랜잭션 + 섹션별 검증 DO 블록).

#### ① 일정 날짜 변경 방향 분리

`audit_date_changed`(방향무관 `COUNT`, `above_avg`)는 미룸(`after_value > before_value`)·당김(`after_value < before_value`)을 한 신호로 합산해 반대 의미를 상쇄했다(off-day 대조 무의미). 은퇴(`status='rejected'` + 링크 archive)하고 방향 신호 2개를 신설:

| 신호 | 조건 | 의미 |
|------|------|------|
| `audit_date_postponed` | `(after_value->>'date')::date > (before_value->>'date')::date` | 일정을 더 뒤로 미룸 |
| `audit_date_advanced` | `… < …` | 일정을 앞으로 당김 |

`kind='sql'`, `value_type='continuous'`, `direction='above_abs'`, `threshold=1`, `domain='audit'`, `source='seed'`(LLM 가드 비대상). 링크 없이 시작 → P5a 발굴이 자연 재페어링. 카드 라벨 `일정 미룸`/`일정 당김`(`SIGNAL_LABEL_OVERRIDES`). prod 분포: 미룸 134 / 당김 11(합산이 미룸에 오염돼 있었음).

#### ② 누적 카운트 시드 은퇴 → 강도 밴드 위임

고정 임계 누적 시드(`pool_화_오행_누적_N1`\~`N5`, `pool_편재_누적_N1`\~`N5`, 10개)는 baseline 포화 시 off-day 0 → 검정 불가로 죽는다(본인 화는 운에 늘 깔려 N1\~N3 매일 발현). 동일 개념을 강도 밴드(ADR-0036)가 상대 분위수·주간 재계산으로 포화 없이 더 정밀히 측정 → archive(`active=false`, `archived_reason='delegated_to_strength_band'` + 링크 archive). 위임처: 화→`pool_강도_화`, 재성(본인 양목)→`pool_강도_목`. `cumulative_pillar_count` 트리거 코드·타입(`computeCumulativePillarCount`·`evaluateCumulativePillarCount`·`CumulativeCount`·`PillarLevel`의 `cumulative`)은 #514에서 데드코드 제거(활성 시드 0이라 무영향) — DB CHECK·마이그레이션은 보존(불변, archived 시드 재진입 여지). 분포 리뷰 cron(`pillarLevelDistributionReview`, 월 09:15) 제거 → **Life Cron 슬롯 8→7**.

`pattern_catalog.archived_reason TEXT` 컬럼 신설 — archive 사유 구분(③ 부활 스코프):

| 값 | 의미 | 부활 |
|----|------|------|
| `saturation` | ③ 포화 자동 archive | 대상 (탈포화 시) |
| `delegated_to_strength_band` | ② 누적 위임 | 제외 (영구 대체) |
| `NULL` | 활성 또는 수동 archive | 제외 |

#### ③ 포화 시드 양방향 가드 (`seed-saturation.ts`)

주간 검증 엔진(`weekly-verification.ts` `processUser`)이 링크 검증·스냅샷 이후·발굴 surface 전에 양방향 sweep:

- **archive**: 활성 시드의 트리거 활성률(일별 핸드오프 로그 `seed_daily_activations.trigger_activated` 집계) ≥ `saturationRate`(0.95) & 윈도우 ≥ `saturationMinDays`(30일) → `active=false`, `archived_reason='saturation'` + 링크 archive.
- **부활(revive)**: `archived_reason='saturation'` 시드를 현재 윈도우로 `computeSeedActivationSeries` 재계산(트리거 결정론 — 비활성이어도 시리즈 산출) → 탈포화(활성률 < `saturationRate`)면 `active=true`, `archived_reason=NULL` 복귀. `'saturation'` 스코프라 ②의 위임분·수동 archive는 부활 제외.

판정은 `matched`(연결 매트릭 통과, evidence-only 시드는 null)가 아니라 **`trigger_activated`**(트리거 자체 발현) — off-day 대조의 활성/비활성 축과 일치. 순수 술어 `isSaturated`/`isDesaturated`(rate, nDays)는 `minDays` 이상에서 상호배타. 강도 밴드는 상대 분위수라 \~33%씩 갈려 절대 포화 불가 → archive 대상에 안 걸림. 주간 카드 말미 `buildHygieneNotice`: `🧹 포화 시드 N개 정리` / `🌱 부활 N개`(라벨은 `seedLabel()` 통과, 변수명 노출 0).

#### ④ 발굴 동어반복(자기상관) 필터

`discoverCandidates` 여집합 스캔에서 **행동 시드 source 도메인 == 신호 도메인**인 쌍(예: `life_behavior_spotty`[루틴 누락] × `routine_completion_rate`[루틴 완료율])을 사전선별·FDR 전에 skip(풀 비오염) + 드롭 수 로그. 같은 행동을 두 번 잰 자기상관이라 통계가 유의해도 무의미. 행동 시드 도메인 매핑은 `insights.ts`의 `BEHAVIOR_SIGNAL_DOMAIN`(`Record<InsightType, InsightDomain>` — 각 detect 함수의 `domain` 필드가 진실, `slotGap`·`weekComparison`은 `routine_records` 집계라 routine). 캘린더 life_signal(`weekday`/`month_position` 등)·사주 시드는 행동 도메인이 없어 자동 면제(정상 cross-domain 후보 보존).

#### 회고

거친 측정 채널(고정 임계 누적)을 이미 존재하는 정밀 채널(상대 분위수 강도 밴드)로 은퇴·위임한 게 핵심 — 신규 통계 코어 0. 측정 불가능성(off-day 0)을 큐레이션 판단(ADR-0039 사람 게이트)과 분리해 자동·양방향 위생으로 환원: 사람은 "믿을지"만, 기계는 "검정 가능한지"를 판정. 설계 중 사용자가 archive-only의 빈틈(1년 뒤 탈포화 시드 영구 사장)을 지적 → 부활 대칭 추가. 빌드 중 `BEHAVIOR_DOMAIN`(데이터-존재 윈도우, #504)이 `slotGap`/`weekComparison`을 schedule로 매핑하는 오기를 발견(④는 `insights.ts` 진실 사용, #504 맵 교정은 후속).

### 37. 세운·대운 확장 + 검증 엔진 교정 — Phase 1 (개인화 가중치 집계, #523, ADR-0049)

링크 단위 증거(검증된·검증중 pattern_links)를 사주 축으로 모아 "이 사람은 어떤 십성·오행에 어떻게 반응하는가"의 개인화 프로필을 만든다(#408 5-B 구체화). Phase 2(기간 해석)·Phase 3(예측 장부)가 기간 pillar(월운/세운/대운)에 조인할 원료. 측정 교정(Phase 0)된 confirmed+active 링크만 입력.

#### 데이터 모델 (migration 088)

`saju_response_profile` — **파생 테이블**(진실 아님, pattern_links에서 재생성 가능). 주간 검증 엔진(`weekly-verification.ts` `processUser` 말미, 격리)이 user당 full-replace(트랜잭션).

| 컬럼 | 의미 |
|------|------|
| `axis_level` | `char_stem`(천간글자)·`char_branch`(지지글자)·`sipsung`(십성)·`group`(십성그룹)·`element_band`(오행 강밴드) |
| `axis_key` | 갑/자(글자)·비견(십성)·비겁(그룹)·목(오행) |
| `element` | 오행 별칭(char/group/element_band) — sipsung은 NULL |
| `domain` | 신호 도메인(셀 분할 축) |
| `tier` | `verified`(confirmed 포함) / `emerging`(nActive·효과 게이트) |
| `alpha`/`beta` | Σ posterior(롤업 합산) |
| `shrunk_effect` | shrunk(posterior_p/rate_off)의 nActive 가중평균 — winner's curse 차단(D3) |
| `n_links`/`n_active_days` | 기여 링크 수 / Σ 발현일 |
| `stability` | 전·후반 효과 부호 일치(표시용, 비게이트) |
| `source_link_ids` | provenance |

UNIQUE(user_id, axis_level, axis_key, domain).

#### 이중계산 구조적 차단 (D4) — `response-profile.ts`

- **원천 기여 = 링크당 정확히 1 source 셀**: stem→천간글자, branch→지지글자(단일만), hwa_sipsung→십성그룹 직접, strength_band 강×오행→element_band. relation·sibiunsung·element_density·life_signal·일간/약/적정 밴드는 비편입(v1).
- **결정론 롤업**: 글자 셀이 자기 십성(`getSipsung`/`getJijiSipsung`)·그룹으로 α/β·nActive 합산해 올라감. 그룹 셀 = (십성 롤업) + (hwa 직접).
- **천간/지지 글자 분리**: 한글 동음이의(천간 辛 vs 지지 申='신')가 다른 십성으로 가므로 `char_stem`/`char_branch` 별도 축(병합 금지). 오행은 그룹 셀 별칭(일간 고정 시 동형 → 별도 레벨 없음).
- **읽기 = 단일 레벨 resolution**(`resolveHierarchyCell`/`resolveElementBandCell`, Phase 2·3 공용): 글자 셀이 게이트 통과(verified 또는 nActive≥15)면 정지, 미달이면 십성→그룹 fallback. **두 레벨을 절대 합산하지 않음.**

#### 효과·교란 (D3)

효과는 raw rate ratio가 아니라 `shrunk = posterior_p / rate_off`(영속값). explained_away 교란 링크는 제외, attenuated는 `min(shrunk, 조정 RR)`. 셀 효과는 링크 shrunk의 nActive 가중평균.

#### DoD

주간 run 후 `SELECT axis_level, count(*), sum(n_links) FROM saju_response_profile GROUP BY 1;` — char 레벨 sum(n_links) = stem+branch 편입 링크 수 일치, provenance spot check. Phase 0 직후 confirmed 0 → 당분간 셀은 거의 emerging.

### 38. 세운·대운 확장 + 검증 엔진 교정 — Phase 2 (기간 해석 엔진 + 주기 리포트 + fast path, #529, ADR-0050)

일운 집계 레이어(§37 `saju_response_profile`)를 월운·세운·대운 **해석**으로 잇는다. 핵심은 "검증할 수 없는 층에서 검증된 척하지 않으면서 출력은 끊지 않는" 인식 지위의 아키텍처다.

**검증가능성 사다리** (헌법, [ADR-0050](../adr/0050-verifiability-ladder-and-forecast-ledger.md)) — 단위가 커질수록 표본이 기하급수로 줄어 통계 확정이 불가능해진다. 각 층의 지위를 다르게 두고 출력에 라벨로 동반:

| 층 | 단위 | 지위 |
|---|---|---|
| 일운 | 일 | 실증 (off-day 2×2 + e-value + 가족 BH) |
| 월운 | 절기월 | 축적-실증 (누적 기술통계 + 예측 장부) |
| 세운 | 입춘년 | 장부 한정 약실증 (평생 n=1\~2) |
| 대운 | 10년 | 비실증 추론 (검증 불가 명시) |

**전이 가설**(일 단위 반응이 상위 단위에 같은 방향으로 보존)은 **미검증 가정** — 모든 상위 출력에 hedge 라벨 동반(통계 주장 금지).

**데이터 모델** — `period_interpretations`(마이그 089):

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `period_type` | `TEXT CHECK IN (wolun/seun/daeun)` | 기간 종류 |
| `period_start` / `period_end` | `DATE` | 절기월 시작/끝 · 입춘일/다음입춘 전날 · 대운 전환일/NULL |
| `pillar` | `TEXT` | 기간 간지 한글 2자 |
| `structured` | `JSONB` | `{measuredCells, textbookCells, descriptiveStats}` |
| `narrative` | `TEXT` | LLM 서사 (생성 시점 동결, fast path는 이걸 렌더) |

UNIQUE(user_id, period_type, period_start) — cron 재실행 중복 차단 + fast path 최신행 조회 커버. `fortune_analyses`(외부 weekly-fortune routine 소유, 교과서 레이어)와 **소유권 분리**.

**트리거 슬롯** — `periodFortune`(마이그 090, 08:20, Life Cron 8→9개). 데일리 게이트(`period-fortune.ts` `decidePeriodTriggers`)는 **독립 3검사**(else-if 아님):

| 검사 | 조건 | 산출 |
|------|------|------|
| 절기 전환 | `isJeolgiTransitionDay(today)` | 월운 (pillar = `getMonthPillar`, range = `getJeolgiMonthRange`) |
| 입춘 | `today === getIpchunDate(year)` | 세운 (pillar = `getYearPillar`) |
| 대운 전환 | 어제 대운 ≠ 오늘 대운 | 대운 (pillar = `getDaeunPillar(today)`) |

**입춘은 인월 전환이자 새해 시작 → 월운+세운이 같은 날 동시 발사**(독립 검사라 둘 다 잡힘). 전환 없는 평일은 no-op. 대운 "정보 없어" 안내는 cron이 아니라 조회(fast path) 책임(만 나이 단조 → cron 대운 pillar는 항상 유효).

**해석 흐름**(`period-interpretation.ts`):

```
derivePeriodContext(natal, pillar, type)   ← 결정론: 기간 pillar → 십성·오행·합충
  → buildInterpretationPayload(...)        ← resolveHierarchyCell/resolveElementBandCell 조인
        measuredCells   : profileIndex(§37) 출신 (불변식)
        textbookCells   : 측정 안 된 십성·합충의 교과서 일반론 (미검증 라벨)
        descriptiveStats: 누적 기술통계 inline SQL (수면/루틴/일기)
  → composeNarrative(llm, ...)             ← 측정/교과서 분리 발화 + 전이 hedge (cron 생성 시점만)
  → renderInterpretationBlocks(record)     ← 결정론, cron·fast path 공용
```

`descriptiveStats`: wolun = 과거 동일 월지 절기월들 누적(`getJeolgiMonthRange` walk, 백스톱 5구간), seun/daeun = 기간 시작\~오늘. 지출 금액은 집계 제외(수면 avg·루틴 완료율·일기 수만). **measuredCells=0도 항상 발송**(D8 출력 연속성) — 빈 카드 대신 "측정된 반응 아직 없어" 명시 + 교과서 + 누적 기록으로 채우는 일급 경로.

**조회 명령**(`insight/index.ts`):

| 명령 | 경로 | 동작 |
|------|------|------|
| `월운` / `세운` / `대운` (정확 일치) | period_interpretations | 최신 행 결정론 렌더 (LLM 미호출), 행 없으면 안내 |
| `월운 보여줘` · `이번 달 월운` 등 (접미·접두형) | fortune_analyses | 기존 교과서 레이어 (하위 호환) |

⚠️ **평가 순서 의존**: 기존 `MONTHLY_FORTUNE_RE` 등이 맨말 "월운"도 매칭하므로, 정확일치(`^월운$`)를 **반드시 먼저** 평가해야 갈래가 갈린다.

**절기 테이블 연장**(`saju-calendar.ts`) — `JEOLGI_TABLE` 2029\~2033 추가. 미연장 시 2029-01-01부터 `getYearPillar`/`getMonthPillar`(→ 일일 매칭 포함) 전체 throw였던 시한폭탄 해소. 데이터는 NASA DE441 기반 절기 시각을 **KST 환산**(UTC+8→+9, 23시 이후는 익일) 후 날짜 추출, Wikipedia UTC 표 + 기존 2028행 재대조로 교차검증. 폭탄은 사라지지 않고 **2034-01로 이동**(테이블 구동 본질) — 갱신 절차는 ADR-0050. 신규 export: `getIpchunDate`(승격) · `getJeolgiMonthRange` · `isJeolgiTransitionDay`.

> 예측 장부(`period_forecasts`, 마이그 091)는 Phase 3 — ADR-0050에 스키마 설계만, 코드는 후속. 구현 회고: [design-notebook period-extension §Phase 2](../design-notebook/period-extension.md#phase-2--기간-해석-엔진--주기-리포트--fast-path-진행-529).

### 39. 세운·대운 확장 + 검증 엔진 교정 — Phase 3 (예측 장부 `period_forecasts`, #531, ADR-0050)

월운·세운 해석을 **사전등록 → 사후 채점** 장부로 잇는다. 검증 불가 층(세운은 평생 표본 1\~2회, 대운은 수명초과)에 확증편향 차단 규율을 코드로 심는 게 목적. 절기/입춘 시간 게이트만으로 무인 생성·채점되는 **자기검증 메커니즘** — "메커니즘을 완성해두면 시간이 흐르며 스스로 검증된다".

**데이터 모델** (마이그 091, `period_forecasts`) — 신호당 1행(정규화):

| 컬럼 | 의미 |
|------|------|
| `period_type` | `wolun` \| `seun` (대운 비편입 — CHECK 제약) |
| `period_start` / `period_end` | 절기월/입춘년 구간. `period_end`가 채점 시점 |
| `signal_id` | 근거 셀의 대표 신호(no_call이면 NULL) |
| `status` | `open`(예측) → `scored`/`unmeasurable`, 또는 `no_call`(예측 안 함) |
| `predicted_direction` | `up`/`down` — 셀 shrunkEffect 부호 |
| `baseline_rate` | **생성 시점 동결**(대표 링크 `rate_off`). 채점이 재계산 안 함 |
| `source_cell` JSONB | 근거 셀 provenance(via·axis·tier·shrunk·nActive·signalId) / no_call이면 사유 |
| `measured_rate`/`measured_delta`/`direction_hit` | 채점 산출(미채점이면 NULL) |

제약: `UNIQUE(user_id, period_type, period_start, signal_id)` + `no_call` partial unique(기간당 1행) + `open` 부분 인덱스(채점 대상 추출 가속). **Brier 등 확률점수 금지** — 표본 없는 층에서 확률은 과대주장이라 방향 적중 + 실측 delta만 기록.

**스키마 reconcile**: ADR-0050 §3 예시 SQL은 `forecasts`/`outcome` JSONB 배열(period당 1행)이었으나, 실제 구현은 신호당 1행으로 **정규화**. 사유 — 채점 대상 추출(`WHERE status='open' AND period_end<=today`)·dedup·멱등 INSERT가 SQL로 직접 표현된다. ADR의 네 규율(top-3·no_call 사전등록·baseline 동결·방향적중+실측delta·Brier 금지)과 wolun+seun 한정은 불변(ADR에 erratum 주석).

**예측 단위 = 도메인 셀 → 대표 신호**(§5-A): measuredCells는 도메인 레벨(롤업), 예측 행은 신호 레벨. 한 셀의 `sourceLinkIds` 중 발현일(nActive) 최대 링크의 signal을 대표로 채택(타이=min signal_id). baseline은 그 링크의 `rate_off`(발현-부재 비율) 동결 — 전이 가설의 올바른 null(기간 = feature 켜진 연장 구간 → 그 pass율이 발현-부재 baseline을 넘는가). signal_id 충돌은 dedup(상위 셀 유지).

**자기검증 메커니즘** (5요소 — 수동 트리거 0):

| 요소 | 코드 실현 |
|------|----------|
| 시간 구동 | 생성·채점 모두 `periodFortune`(08:20) `decidePeriodTriggers` 절기/입춘 게이트에서만 발화. 별도 스크립트 없음 |
| 멱등 | 생성: `(user,type,start)` 행 존재 시 재생성 안 함(첫 등록만 유효 = baseline 동결 무결성). 채점: `status='open'` 가드 → 재채점 0 |
| 자가 회수 | 채점은 `period_end <= today`(== 아님) — 전환일 cron 1회 실패해도 다음 전환이 밀린 open 자동 회수 |
| 동결 = 봉인 | `baseline_rate`는 등록 시 캡처, 채점이 절대 재계산 안 함(확증편향 차단의 구조적 코드화). 테스트로 불변식 고정 |
| 결과 노출 | 채점 결과는 다음 기간 카드(cron) + fast path `월운`/`세운` 둘 다 같은 행을 읽음 — 수동 조회 없이 누적 |

유일 수동 지점은 절기 테이블 갱신(2034 만료)이나, `decidePeriodTriggers`가 try/catch라 만료 후엔 "틀린 장부"가 아니라 "빈 장부"로 degrade. **reaper·decay 모니터는 일부러 미추가**(D2/D7) — 메커니즘은 순수 이벤트(전환) 구동.

**통합점**: `period-forecast.ts`(신규 — `generateForecasts`/`scoreForecasts`/`loadLedger`) + `period-fortune.ts` `generateAndPost`(wolun/seun에서 ①채점 → ③생성 → ④카드 장부 섹션, 장부 실패는 격리) + `period-interpretation.ts` `renderInterpretationBlocks(record, ledger?)`(`MeasuredCell`에 `sourceLinkIds` 추가) + `insight/index.ts` fast path `loadLedger` 동봉 + `pattern-verification.ts` `loadSignalDefsByIds` named export 추출(SignalDef 단일 진실).

**채점**: `computeSignalSeries` 재사용 → 기간 한정 집계(period 일자만, lead-in `baselineLeadInDays`는 above_avg 워밍업 전용). 측정가능일 < `minMeasurableDays`(10) → `unmeasurable`(강제판정 금지). `direction_hit`은 방향 일치(동률=미적중). 노브: `periodForecast { topK:3, minMeasurableDays:10, baselineLeadInDays:28 }`.

**카드 표시**: baseline 원수치는 비노출(개인 pass율 = 생활 패턴), delta `±%p` 부호·tier만(§9 보안). 지난 채점(적중/빗나감/측정불가) + 이번 예측(↑/↓·근거 tier) + no_call("예측 안 함" 명시 — D8 침묵 금지).

**DoD**: 마이그 091 prod 적용(테이블 + 2 인덱스), 전환일 검증(직전 기간 open 0건 + 새 기간 open ≤3 또는 no_call 1), fast path LLM 미호출. 첫 실측 = 2026-07-07 소서(첫 예측 등록), 첫 채점 = 그다음 절기(≈8월 입추). 이로써 마스터 #523 사다리 4층(일운 실증 → 월운 축적실증 → 세운 장부약실증 → 대운 비실증) 완결. 회고: [design-notebook period-extension §Phase 3](../design-notebook/period-extension.md).

## 파일 구조

```
src/agents/insight/
├── index.ts                       # 에이전트 생성, fast path 매칭, LLM 에이전트 루프
├── prompt.ts                      # 시스템 프롬프트 빌더 (DB 데이터 실시간 로드)
├── actions.ts                     # 인터랙티브 버튼 핸들러 (#477 P5a 발굴 승인/패스 + P5b LLM 신호 승인/반려, ADR-0040)
├── blocks.ts                      # Slack Block Kit 메시지 빌더
├── diary-fast-path.ts             # 일기 저장 + 자연스러운 응답
├── saju-seed-fast-path.ts         # 사주 시드 보기/끄기/켜기 (Phase 3)
├── hypothesis-discovery.ts        # #477 P5a 발굴 엔진 (여집합 off-day 스캔 → discoverCandidates + insertPendingDiscoveryLink)
├── hypothesis-cards.ts            # #477 P2/P3 주간 검증 카드 (3-tier ✅검증됨/🌱검증중/✗기각) + P5a 발굴 승인 카드(buildDiscoveryCandidateCard)
└── llm-signal-cards.ts            # #477 P5b LLM 신호 제안 승인 카드 (buildLlmSignalCard + 승인/반려 payload, 옛 metric-approval-cards 대체)

src/shared/
├── signal-sql-guard.ts            # #477 P5b LLM SQL 게이트 #1 정적 검증 (validateSignalSql + 테이블 화이트리스트, ADR-0040)
├── pattern-match.ts               # 매칭 엔진 (evaluateTrigger + evaluateMetric kind=sql|tag). #477 P1: pattern_links × signal_defs 기반 + P4b hwa_sipsung trigger + P5b runLlmSignalSql(게이트 #2)
├── pattern-verification.ts        # #477 P2/P3 off-day 검증 엔진 (2×2 + block-perm + e-value + 연속 MW → EB posterior → verdict/status) + P4a 강도-밴드 2-pass + P4b FDR 3가족(saju_relation)
├── confound.ts                    # #477 P6 교란 플래그(marginal 탐지, ADR-0041) + P7 다변량 분리(MH 층화 조정 → confound.adjusted/explainedAway → 노출 soft-demote, ADR-0042)
├── response-profile.ts            # #523 P1 개인화 가중치 집계(글자→십성→그룹 단일레벨 롤업 + element_band, 이중계산 차단 + shrunk 효과, resolveCell Phase 2·3 공용, ADR-0049)
├── period-interpretation.ts       # #523 P2 기간 해석 엔진(derive→payload→narrative→render, 측정/교과서 분리, measured=0 일급 경로) + period_interpretations DB 헬퍼 + P3 장부 섹션 렌더(renderInterpretationBlocks ledger 인자), ADR-0050
├── period-forecast.ts             # #523 P3 예측 장부(generateForecasts/scoreForecasts/loadLedger) — 사전등록→사후채점, baseline 동결·방향적중+delta(Brier 금지)·대표신호 해소, 절기 시간게이트 무인 자기검증, ADR-0050
├── saju-calendar.ts               # 만세력 — 절기 테이블 2024~2033(#523 P2 연장) + getDayPillar/getMonthPillar/getYearPillar + getJeolgiMonthRange·isJeolgiTransitionDay·getIpchunDate + 십성·합충 유틸
├── saju-strength.ts               # #477 P4a 실효강도 엔진 (생조−극설 + 월령 + 통근, 절대 신강/신약, 오행 비율) + P4b 합화 변환 반영
├── saju-strength-params.ts        # #477 P4a 명리학 파라미터 (위치가중·월령·통근·분위수) + P4b 합화 노브(통근·충개합·일간합·깊은 노브 off)
├── saju-hwa.ts                    # #477 P4b 합화 변환 탐지(천간합/육합/삼합 + 통근 게이트 + 충개합 v1a) + 효과적 십성 그룹
├── quantile.ts                    # #477 P4a tertile 컷 + 밴드 분류 (주간 산출 → 일별 적용 공통 규칙)
├── stats.ts                       # 순수 통계 (Fisher·BH-FDR + #477 P3: e-value 마틴게일·block permutation·Mann-Whitney·Hodges-Lehmann + P7: Mantel-Haenszel 층화 RR)
├── bayesian-posterior.ts          # Beta-Binomial posterior + #477 P3 empirical-Bayes 공통 prior(MoM, 농도 CAP)
├── saju-mappings.ts               # 십성 알고리즘 계산 (LLM 프롬프트용)
├── insight-thresholds.ts          # 인사이트·시드·검증(patternVerification: P2 q + P3 e-value α·emerging 바·discoverQ·blockLen) 임계 단일 관리
└── insights.ts                    # Phase 1 SQL 결정론 11종 (confirmed 가설 라인은 verified tier=P3까지 미노출)

src/cron/
├── daily-pattern-matching.ts              # 07:00 사주 일일 매칭 → seed_daily_activations transient 기록 (#477 P2: 검증·백필·발송 제거)
├── diary-meta-extract.ts                  # 일기 → enum 태그 추출 cron (Phase 3, Opus)
├── weekly-verification.ts                 # 월 06:00 주간 off-day 검증 엔진 (#477 P2/P3: e-value persist + 주간 스냅샷 + 3-tier 카드, P5a 발굴, P6 교란 플래그)
├── period-fortune.ts                      # 08:20 주기 운세 게이트 (#523 P2: 절기/입춘/대운 독립 3검사 → 월운/세운/대운 카드, 입춘 double-trigger, 평일 no-op)
└── pillar-level-distribution-review.ts    # 월 09:15 운 레벨 분포 분석 (Phase 2.5, #477 P2 seed_daily_activations 재배선)

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

db/migrations/  (마스터 #477 매트릭 중심 패턴 검증 — 2026-06)
├── 077_signal_defs_and_links.sql               # P1 신호 전역화: signal_defs + pattern_links, 매트릭→링크 이관, pattern_metrics/hypotheses/stats DROP, view 재정의
├── 078_seed_daily_activations.sql              # P2 pattern_matches → seed_daily_activations rename + 검증 컬럼 DROP
├── 079_weekly_verification_slot.sql            # P2 주간 검증 slot rename(weeklyVerification) + 06:00 월요일
├── 080_graded_exposure_and_weekly_stats.sql    # P3 3-tier view(verified/emerging/recent) + link_weekly_stats 스냅샷 + pattern_summary confirmed 포함
├── 081_strength_band_seeds.sql                 # P4a strength_band CHECK + strength_band_cutpoints + 18 강도 시드 + 13 큐레이트 링크
└── 082_relation_hwa_seeds.sql                  # P4b relation_type CHECK(귀문·암합) + hwa_sipsung CHECK + 귀문6/암합4 쌍 + auto-gen 관계 시드 + 효과적 십성 5시드 + 10 큐레이트 링크

~/.claude/scheduled-tasks/  (Claude 앱 routines, repo 외부)
├── monthly-signal-suggest/SKILL.md              # #477 P5b 매월 09:30 LLM 신호 제안 (signal_defs source='llm' pending, 옛 monthly-metric-suggest 재정의)
├── daily-insight/SKILL.md                       # 일일 종합 인사이트 매일 08:00 (마스터 A A3, #475)
└── weekly-saju-review-v2/SKILL.md               # #542 주간 인사이트 통합 카드 단독 발송 월 08:04 (회고+메트릭+패턴 학습, 봇 검증 카드 은퇴)
```

### 40. 주간 인사이트 단일 카드 통합 (#542, ADR-0052)

매주 월요일 #insight에 따로 오던 두 카드(봇 06:00 패턴 검증 리포트 + routine 08:04 주간 사주 리뷰)를 **routine 단독 통합 카드 한 장**으로 합쳤다. 만드는 주체는 분리 유지 — 검증 통계 계산은 봇(결정론 엔진), 회고+표시는 routine(LLM).

**통합 카드 구조** (`weekly-saju-review-v2` routine 발송):

1. 회고 prose 4\~6줄 (사주 관점 + 라이프 메트릭 뒷받침, diary 원문 금지)
2. `📊 이번 주` — 수면·루틴·일정·태그 한 줄 메트릭
3. `🔬 패턴 학습` — 검증중/검증됨/기각/모으는 중 카운트 + 검증중·검증됨 항목(효과크기 내림차순)
   - 항목 1줄: `{시드라벨} → {신호라벨} · 평소보다 {effect}배 ({hit}/{발현일}일){ ⚠️}`

**봇 검증 카드 발송 은퇴** (`weekly-verification.ts`):

- 제거: `buildVerificationBlocks`·`buildSeedInfluenceSection`·`buildHygieneNotice` 발송 경로 + `loadSeedInfluence`. `hypothesis-cards.ts`에서 검증 카드 빌더 일체 삭제 — **발굴 후보 카드·재기준선 공지만 잔존**.
- 유지: 검증 엔진 전부 — `verifyUserLinks`·status 전이·`persistLinkVerification`·`link_weekly_stats` 스냅샷·포화 가드·교란 플래그·발굴 추천·`saju_response_profile` 집계. 카드 생성만 사라지고 DB write는 그대로.
- 포화 가드(archive/revive) 사용자 노출이 사라져 로그로 강등(통합 카드 노출은 후속).

**출력 연속성** (침묵 금지) — 신규 슬롯 `weeklyReviewFallback` (월 10:00, 마이그 093):

- routine이 발송하면 `saju_weekly_reviews`에 row가 남는다 → 10:00에 없으면(미발송) "클로드 앱 routines에서 수동 실행해줘" **알림만** 발송. 봇이 반쪽 카드를 대신 만들지 않음(ADR-0052 Alt B 기각).
- **week_start 주의**: fallback은 `오늘(이번 주 월요일)`로 조회 — SKILL idempotency row 키와 일치. 봇 검증 엔진의 `previousMondayISO`(지난주 월요일)와 다름.

**idempotency 발송 성공 기준 보강**: routine이 발송 *전* INSERT하던 것을 → SELECT 체크(있으면 종료) + **발송 성공 후 INSERT**로 변경. 미발송 주는 항상 수동 재실행 가능.

**posterior(`확신 N%`) 노출 제거**: 발현일 적중률(Beta-Binomial 사후평균)을 "확신"으로 오독시키고 표본(`hit/발현일`)과 중복 → 카드에서 뺌. 시드 영향력 top 섹션도 통합 카드 미포함.

**라벨 단축** (`insight-labels.ts` 코드 + routine 표기 규칙 일관):

| 종류 | 전 | 후 |
|------|----|----|
| 일간 강도 | 일간 기운 약한 날(신약) | `신약한 날` / `신강한 날` / `일간 균형인 날` |
| 천간·지지 | 일운 천간 임수(식신) | `임수(식신)` (접두 제거) |
| 오행 강도 | 화 기운 강한 날 | (유지) |
| 신호 방향 | 밤잠 평소보다 많음 | `밤잠 많음` (above/below "평소보다" 제거) |

발굴 후보 카드(봇 06:00 별도 유지)에도 일괄 적용 — 전 카드 라벨 일관.

**검증 현황 쿼리** = `pattern_links` 직접 집계(누적): 검증됨=`confirmed`, 검증중=`active`+effect≥1.3+발현일≥15(봇 `isEmerging`과 동일 게이트), 기각=`rejected`, 모으는 중=나머지 `active`.

관련 마이그레이션: `093_weekly_review_fallback_slot.sql`.

### 41. 역방향 링크 종결 규칙 + 반대 방향 가설 재제안 (#555)

주간 검증 엔진 `classifyVerdict`의 판정 사각지대 해소. confirm(effect ≥ 1.3)도 무연관 밴드(0.95\~1.05)도 못 걸리던 **명확한 역방향 링크**(effect ≤ 0.77 & 발현일 충분)를 `direction_mismatch`로 종결하고, 버려지는 정보를 반대 방향 신호 정의로 살려 발굴 엔진이 다음 주 스캔에서 (시드 × 거울신호) 쌍을 자연히 집어 올리게 한다. **마이그레이션 없음**(새 status·통계 코어 0).

**`direction_mismatch` 판정** ([pattern-verification.ts](../../src/shared/pattern-verification.ts) `classifyVerdict`):

- `verdict` 타입에 `direction_mismatch` 추가. 분기 순서상 **무연관 밴드(reject)보다 먼저** 검사: `effect ≤ directionMismatchMaxEffect`(0.77) & 발현일 `≥ minActiveDays`(30)이면 `direction_mismatch`. 그 다음에 `rejectRatioLow(0.95) ≤ effect ≤ rejectRatioHigh(1.05)` → `reject`.
- `statusForVerdict`: `reject`와 `direction_mismatch` **둘 다 DB status `rejected`** — 기존 종결과 동일 lifecycle로 통합. 사유 구분은 `test_detail.verdict`에만 분리(status enum 불변).
- 임계는 [insight-thresholds.ts](../../src/shared/insight-thresholds.ts): `directionMismatchMaxEffect`·`minActiveDays`.

**거울 신호 정의 보장** (`ensureMirrorSignalDef`):

- `above_avg ↔ below_avg`(baseline-상대 방향)만 대상. 반대 방향 신호 **정의**가 이미 있으면 no-op. 기각 이력만 있으면 스킵(#557 `findEquivalentSignal` 위임).
- **링크는 만들지 않는다** — 정의만 확보. 실제 (시드 × 거울신호) 가설 수립은 발굴 엔진(P5a)이 다음 주간 스캔에서 off-day 대조로 판단([ADR-0039](../adr/0039-pattern-discovery-surface-and-approval-gate.md) 2층 분리 유지: 사람·발굴은 노출만, 믿음은 통계).
- 호출: [weekly-verification.ts](../../src/cron/weekly-verification.ts) 종결 훅에서 `verdict === 'direction_mismatch' && nextStatus === 'rejected'`일 때. per-link try/catch 격리 + 관측 로그.

### 42. 일정 날짜 변경 신호 측정 정밀화 2차 — 순변위·기록 경로 단일화 (#572, ADR-0054)

1차(#508, §33 계보)가 미룸/당김 방향을 분리한 뒤에도 운영 데이터에서 측정 아티팩트 4종이 남았다 — ⓐ 하루 안에 미뤘다 되돌린 왕복(순변위 0)이 양쪽 다 발화, ⓑ 생성 직후 오기입 교정이 미룸/당김으로 집계, ⓒ 웹만 기록하고 Slack 버튼·에이전트 SQL 경로 누락, ⓓ CASCADE 이력 소급 소멸 + 존재-윈도우 어긋남. 통계 스택·verdict·tier·임계치 불변 — 1차와 동일하게 *무엇을* 측정하는지만 교정. 마이그레이션 [100](../../db/migrations/100_audit_net_displacement.sql).

**순변위(일정 × 하루) 신호 SQL 3종 재정의** ([100](../../db/migrations/100_audit_net_displacement.sql) ④):

그날 그 일정의 첫 `before_value` 날짜와 마지막 `after_value` 날짜를 비교해 순변위 방향만 센다(`GROUP BY schedule_id, KST day`). 방향 신호 2개는 유지하되 반대 방향이 상쇄되는 왕복 쌍만 양측에서 제외 — 방향무관 합산([ADR-0046](../adr/0046-signal-seed-precision.md) 기각안)으로의 회귀가 아니라 §1 강화.

| 신호 | 순변위 정의 | 은퇴 전 |
|------|-----------|--------|
| `audit_date_postponed` | (일정×하루) 첫 before < 마지막 after인 일정 수 | 이벤트 단위 `after>before` COUNT |
| `audit_date_advanced` | 동일 구조, 첫 before > 마지막 after | 이벤트 단위 `after<before` COUNT |
| `audit_postponed_done` | 순미룸 일수 ≥ 2인 일정을 완료한 날 | raw 변경 횟수 `n≥2`(방향 무시) |

- **왕복 상쇄**: 여러 번 나눠 미뤄도 하루 1회로 정규화. 크로스데이 왕복(오늘 미루고 내일 되돌림)은 각 날의 실제 행동이라 각각 집계 — "미룬 날" 의미와 하루 경계가 정합.
- **생성 30분 유예**: 세 신호 모두 `changed_at > schedule_created_at + INTERVAL '30 minutes'` 필터. 경계값은 052 전례 재사용(새 임의값 없음, #434 헌장 ⑤). 30분 이내 변경은 날짜 오기입 교정으로 간주.
- `above_abs` threshold=1 이진화·`domain='audit'`·`source='seed'`는 1차와 동일. NULL date(백로그) 변경은 `before_value->>'date' IS NOT NULL` 필터로 제외.

**기록 트리거 2종 — 전 경로 단일 계기** ([100](../../db/migrations/100_audit_net_displacement.sql) ③·③-b):

- `record_schedule_date_change` (`AFTER UPDATE OF date ... WHEN (OLD.date IS DISTINCT FROM NEW.date AND NEW.user_id IS NOT NULL)`) — 웹 PATCH·Slack 버튼·에이전트 `modify_db`·수동 psql까지 날짜 변경 전 경로가 단일 계기로 수렴. 027 `updated_at` 트리거의 두 번째 적용(같은 패턴). 웹 앱 수동 기록(`recordScheduleChanges`)은 제거 — 자세한 관계는 [schedule.md](schedule.md) audit 섹션.
- `record_schedule_deletion` (`AFTER DELETE`) — `change_type='deleted'` tombstone 행 기록. `before_value`에 삭제 시점 `{date, status, category_id}`만(원문 비저장, v2 헌장 ①). 순변위 신호는 `change_type='date_changed'` 필터라 tombstone 무영향.

**audit 로그화 + 생성시각 스냅샷** ([100](../../db/migrations/100_audit_net_displacement.sql) ①·②): `schedule_changes.schedule_id` FK 제거 → append-only 로그. 일정을 지워도 변경 이력이 `schedule_id` 그대로 남는다(무결성은 writer가 트리거뿐이라 유지). `schedule_created_at` 컬럼을 트리거가 기록 시점에 스냅샷 → 30분 유예 판정이 `schedules` JOIN 없이 자립(삭제 후에도 유효). 인터뷰 초안 `ON DELETE SET NULL`은 기각([ADR-0054](../adr/0054-audit-net-displacement-and-trigger-writer.md) G) — 삭제 시 그 일정의 모든 audit 행이 NULL 한 그룹으로 뭉개져 (일정×하루) 그룹핑·코호트 추적이 붕괴.

**존재-윈도우 교정** ([pattern-verification.ts](../../src/shared/pattern-verification.ts) `DOMAIN_TABLE`·`computeUserDataStarts`): audit 매핑을 `schedules`(2026-03-05) → `schedule_changes` 기준으로. audit만 `date` 컬럼이 없어 `MIN(DATE(changed_at AT TIME ZONE 'Asia/Seoul'))` 특례로 첫 기록일(2026-05-18)을 산출 — 기록 계기 도입 이전(전체 윈도우의 약 60%)이 "변경 없음" 날로 발굴 2×2에 새는 것을 차단. 글로벌 floor(`DATA_TABLES`)는 불변 — audit 계기는 라이프 데이터 시작이 아니라 floor 산출 뒤에 `byTable`에 얹는다.

**구 신호 처분**: 구 3개 `status='rejected'` 은퇴 + 링크 archive → 같은 이름으로 신설([086](../../db/migrations/086_signal_seed_precision.sql) 전례). 측정 체계가 바뀐 시계열을 한 e-value 과정에 섞지 않는다. 은퇴를 신설보다 먼저 실행 — 085/099 부분 유니크 인덱스가 active/pending만 잡으므로 그래야 신설이 인덱스에 안 걸린다. prod 확인 결과 audit 신호에 confirmed 링크 0(최대 e=6.4)이라 [ADR-0048](../adr/0048-enrollment-clip-and-rebaseline.md) D2 re-baseline 의무는 미발생. 이름 재사용은 `SIGNAL_LABEL_OVERRIDES`([insight-labels.ts](../../src/shared/insight-labels.ts))·테스트가 name 키라 무수정.

**prod 정량 근거** (2026-07-04 측정): 전체 이벤트 186건 / 당김 발화일 13→10(왕복 아티팩트 23%) / 미룸 36→36 / 생성 30분 내 3건 / `audit_postponed_done` 자격 36개 중 4개(11%) 방향무시 인플레 / audit 계기 시작 2026-05-18 vs 구 윈도우 시작 2026-03-05.

**`schedule_fate` view — 생성일 코호트 추적 기반** ([100](../../db/migrations/100_audit_net_displacement.sql) ⑥, #574 선행): 살아있는 일정(schedules) + 삭제 일정(tombstone) 합집합으로 생성일(KST `cohort_date`)·카테고리·순미룸 일수·최종 상태를 한 곳에 낸다. 한 번도 안 옮긴 채 완료된 일정도 코호트의 "잘 해결된" 쪽으로 포함(생존 편향 방지). 코호트 신호 정의·성숙 기간·e-value 정합은 [#574](https://github.com/hyewon3938/slack-ai-agents/issues/574)에서 설계 — 그 전에도 view로 ad-hoc·주간 리뷰 소비 가능. 삭제 이벤트는 소급 불가라 캡처 계층만 본 건에 포함(배포일부터 축적).

### 43. 신호 의미론 일괄 교정 (#573, ADR-0056)

#572(§42)가 후속으로 분리한 "타 도메인 신호 의미론 점검 6건"의 실행체. prod 실측(2026-07-04)으로 6건을 갈라 **3건 교정 / 3건 무변경**으로 처분했다. 핵심 발견은 **좀비 신호** — `schedule_영화`·`schedule_이직`의 `sql_body`가 `schedules.category`(TEXT 컬럼)를 참조하는데 [#394](../adr/0013-schedule-category-fk-migration.md)(2026-05-13)가 그 컬럼을 DROP하고 `category_id` FK로 교체 → 두 신호가 7주째 존재하지 않는 컬럼 참조로 죽어 있었다(링크 hit 0/miss 0). 통계 스택·verdict·tier·임계치 불변 — *무엇을* 측정하는지만 교정. 마이그레이션 [101](../../db/migrations/101_signal_semantics.sql). 상세 판단은 [ADR-0056](../adr/0056-signal-semantics-batch-correction.md) · [signal-seed-precision.md](../design-notebook/signal-seed-precision.md) 3차.

**6항목 처분 표** (각: 실측 근거 → 처분):

| # | 신호/사안 | 실측 근거 | 처분 |
|---|-----------|-----------|------|
| 1 | `schedule_영화`·`schedule_이직` | `category` 컬럼 드롭으로 7주째 실행 불능(hit 0/miss 0). done 비율 영화 7/7=100%·이직 39/41=95% | **교정**: `category_id` JOIN + `status='done'` 재정의 = "실제 처리한 날" |
| 2 | 완료율×미룸 기계 결합 | 완료율+audit 신호가 같은 시드에 공존하는 쌍 0개 | **무변경**(문서화만) |
| 3 | 수면 결측=0시 기상 | 수면 실측 결측 0건(117/117 매일 기록) | **무변경** — 결측 인프라 #574 편입 |
| 4 | `expense_total` 고정비 발화 | "총 지출"이 할부·구독·통신·공과금 합산 — 할부 행만 168/912(18%) | **교정**: `expense_discretionary` 개명 = 자유지출만 |
| 5 | `schedule_count_today` 동명 2행 | id 11 above_avg×life_dow_월 / id 12 below_avg×life_holiday = 의도된 반대 가설 | **무변경**(문서화만) |
| 6 | 루틴 미기록일=완료율 0 | 루틴 실측 결측 0건(120/120 매일 기록) | **무변경** — 결측 인프라 #574 편입 |

(추가로 `schedule_tax_keyword`는 title 기반이라 동작 정상, 생애 발화 0일 — 대기 상태.)

**영화·이직 = 좀비 부활 + done 재정의** ([101](../../db/migrations/101_signal_semantics.sql) ②): 깨진 `category='영화'`를 `categories.name='영화'` category_id JOIN으로 재작성 + `status='done'` 필터 추가. 의미를 "달력에 있던 날"에서 "그 일정을 실제로 처리한 날"로 명시적으로 좁힌다. `above_abs` threshold=1·`domain='schedule'`·`source='seed'`는 구 정의 유지.

**자유지출 개명 재정의** ([101](../../db/migrations/101_signal_semantics.sql) ②): `expense_total` → `expense_discretionary`(신명 = 계보 단절). 할부 제외(`COALESCE(is_installment,false)=false`) + 고정비/통과비용 카테고리 제외.

- **제외 목록**: `구독·구독료·통신·통신비·공과금·보험·주거·세금·리커밋 택배`. **deny-list 방식이라 새 카테고리는 기본 포함** — 재량 지출이 다양하게 늘 수 있어 "포함 열거"보다 "제외할 고정지출 열거"가 유지보수 부담이 낮다.
- **'리커밋 사업' 유지 / '리커밋 택배' 제외**: 사업 투자 결정은 본인 재량 행동(편재 유관)이라 포함, 택배는 주문량 비례 통과 비용(본인 행동 아님)이라 제외(사용자 통찰).
- `COALESCE(SUM(amount),0)` 유지 — 지출 0원인 날은 유효 0([ADR-0044](../adr/0044-discovery-measurement-validity.md)). `direction='above_avg'`·`domain='expense'`는 구 정의 유지. 개명이라 `expense_total`의 e-value 시계열은 승계 안 함.

**결측 인프라 #574 편입 설계 스케치**: 3·6항의 근본 원인(수면·루틴 결측일이 "0"으로 강제 변환)은 실측 결측 0건이라 지금 손대도 동작 변화 0 → #574로 미룬다. 상류 변경 스케치 — ⓐ `extractFirstNumber`([pattern-match.ts](../../src/shared/pattern-match.ts) 첫 행 첫 컬럼을 number로 좁히며 NULL을 0으로 강제하는 지점) null→0 강제 해제 + ⓑ `runMetricSql`/`MetricRunner`([pattern-match.ts](../../src/shared/pattern-match.ts)) 타입을 `number | null` 반환으로 확장 + ⓒ 대상 신호 SQL의 `COALESCE` 제거 + ⓓ 도메인 화이트리스트 opt-in(결측을 결측으로 흘릴 도메인만). **하류는 이미 완비** — [computeSignalSeries](../../src/shared/pattern-verification.ts) raw null 처리·[binarizeSqlSeries](../../src/shared/pattern-verification.ts)·`buildContingency` inconclusive가 [ADR-0044](../adr/0044-discovery-measurement-validity.md)에서 갖춰짐. #574는 상류만 열면 결측이 2×2에서 자연 제외된다.

**링크 처분**: 구 3신호 살아있는 링크(active/pending/weak/confirmed)는 전부 archive만. 재연결은 발굴 엔진(P5a) 다음 주간 스캔에 위임([086](../../db/migrations/086_signal_seed_precision.sql)/[100](../../db/migrations/100_audit_net_displacement.sql) 전례) — 마이그레이션에서 링크 수동 재생성 안 함. prod 확인 결과 구 3신호 confirmed 링크 0 → [ADR-0048](../adr/0048-enrollment-clip-and-rebaseline.md) re-baseline 의무 미발생. 은퇴를 신설보다 먼저 실행 — 085/099 부분 유니크 인덱스가 active/pending만 잡으므로.

**신설 SQL 실행 스모크** ([101](../../db/migrations/101_signal_semantics.sql) ③): 좀비의 근본 원인이 sql_body의 컬럼 참조가 실제 스키마와 어긋난 것이므로, 검증 DO 블록이 각 신설 sql_body를 `user_id=1`·오늘 날짜로 `EXECUTE`해 "에러 없이 숫자 반환"을 증명한다. category_id JOIN·expenses 컬럼 참조가 현행 스키마와 맞음을 마이그레이션 시점에 봉인 — 좀비 재발의 구조적 차단.

> **스키마 드리프트 재발 방지 규칙**: `signal_defs.sql_body`는 catalog(DB) 문자열이라 TypeScript 타입 체크·코드 리뷰의 사각지대다. **컬럼 rename/drop 마이그레이션 시 `signal_defs.sql_body` grep 의무.** 점검 쿼리: `SELECT name, sql_body FROM signal_defs WHERE sql_body ILIKE '%<드롭할 컬럼>%';` — 걸리면 신호 SQL을 새 스키마로 재작성 + 실행 스모크(101 ③ 패턴)로 정합 증명.

### 44. 일운 콜 장부 (fortune_calls, #582, ADR-0057)

일운·이벤트성 예측을 반증 가능한 콜(claim + criterion)로 명시 등록하고 주간 경로에서 판정하는 경량 장부. `period_forecasts`(절기 기간 × 신호 pass율, 무인 통계 채점 — §39)와 역할 분리: 서술형 콜은 신호 시계열로 환원되지 않아 명시 기준 + 정성 판정으로 채점한다. 확률 점수(Brier 등) 금지는 091과 동일 철학. 결정 근거는 [ADR-0057](../adr/0057-fortune-calls-ledger.md).

**스키마** (마이그 [103](../../db/migrations/103_fortune_calls.sql)): `scope_start/scope_end`(판정 구간), `claim`, `criterion`, `source('weekly'|'report'|'manual')`, `status('open'|'hit'|'partial'|'miss'|'unmeasurable')`, `verdict_note`, `scored_at`. 무결성: scope 순서 CHECK + "open이면 scored_at NULL, 판정되면 NOT NULL" CHECK. 부분 인덱스 `(user_id, scope_end) WHERE status='open'`.

**운영 경로** (봇 코드 관여 없음 — DB 프록시 경유 routine, repo 밖):

- 등록: `weekly-fortune` routine이 일요일 밤 주간 일운 생성 시 다음 주 콜 2\~3개 등록(남발 상한). `source='report'`는 심층 분석 예측 세트의 수동 시드.
- 채점: 같은 routine이 실행 시점에 `scope_end`가 지난 open 콜을 criterion 기준으로 판정(diary·일정 실측 대조).
- 표시: `weekly-saju-review-v2` 월요 통합 카드가 지난주 판정 결과를 읽기 전용 2\~3줄로 표시.
- routine 계약이 바뀌면 이 섹션을 갱신한다.

### 45. 월간 신호 제안 누락 fallback 슬롯 (#466, ADR-0058)

`monthly-signal-suggest`(월 1일 09:30 KST, repo 밖 Claude 앱 routine, §30·ADR-0040)가 그 달 실패하거나 앱이 안 켜져 아예 안 돌면 신호 제안이 조용히 누락된다. 봇 사이드에 `signal_suggest_runs`를 읽는 코드가 전무해 누락돼도 아무도 몰랐다. `weeklyReviewFallback`(§40, ADR-0052)과 대칭 구조의 봇 fallback 슬롯으로 해소.

- **슬롯**: `signalSuggestFallback` — `notification_settings`에 daily 등록(마이그 104, 11:00), `signalSuggestFallbackTask`(`src/cron/signal-suggest-fallback.ts`) 내부에서 `getKSTDayOfMonth() !== 2` early return으로 **매월 2일만** 실행.
- **감지**: `signal_suggest_runs`의 그 달 row 존재를 `SELECT EXISTS`로 확인. `month_start`는 SQL 안에서 `DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::date`로 계산 → routine 클레임 키(ADR-0053)와 동일.
- **동작**: row 없으면 `#insight`에 "수동 실행해줘" 알림만 발송. 봇이 제안을 대신 생성·발송하지 않는다(LLM 신호 생성은 봇 능력 밖, ADR-0052 Alt B 기각 계승).

**감지 의미론 차이 (weekly와 반대)** — 이게 핵심 제약이다:

| | `saju_weekly_reviews`(§40) | `signal_suggest_runs`(§45) |
|---|---|---|
| row 기록 시점 | 발송 성공 후 | 최초 액션 클레임(발송 전, ADR-0053) |
| row 없음 의미 | 미발송 | 그 달 routine이 **아예 안 돎** |

즉 signal-suggest의 row는 발송 성공을 뜻하지 않는다. 그래서 **row 없음 = 미실행만 확실 감지**하고, burned month(클레임 직후 크래시로 row는 있는데 발송 0건)와 후보 0건 정상 종료는 row 의미론상 구분 불가 → 감지 대상 아님(스코프 한계, ADR-0053의 burned month 수용과 정합).

- **2일 가드 근거**: 1일 정상 실행이면 2일엔 이미 row → no-op. 1일에 밀려 늦게 실행돼도 2일 체크 전 row가 생기면 헛알림 억제. `#574` 게이트 task(매월 2일)와도 리듬 일치.
- **후속**: burned month 실측 여부는 #466 회고 본체(8월 2회차 실행 후)에서 판단 → 재발 시 ADR-0058 대안 A(발송완료 마킹) 재검토.

## 부록 — e-value 게이트 설계 노트 (S-f)

> [ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md) 본문은 불변(Accepted). 이 부록은 운영·후속 판단을 위한 **경계 조건 메모**로, ADR 결정을 바꾸지 않는다.

### null 시뮬 게이트가 커버하는 것 / 안 하는 것

e-value 빌드 게이트([stats.test.ts](../../src/shared/__tests__/stats.test.ts))는 무관 데이터 null 시뮬(p×activeProb 그리드 + **AR(1) ρ=0.8 자기상관** 케이스, 각 1500 trial)에서 거짓 확정율 `≤ α`(0.05)를 실측한다. AR(1) 케이스는 "pass가 streak를 갖는다"는 현실(1차 자기상관)에 대한 robustness — 통과 확인(문서 §26 기준 ρ=0.8에서 \~0.026).

- **커버**: 1차(AR(1)) 자기상관. 풀링 기준율 r이 편향을 억제하는 게 핵심.
- **미커버(구조적으로 탈상관됨)**: **요일 주기 구조**(주 7일 반복 패턴)는 AR(1) 시뮬이 직접 재현하지 않는다. 다만 사주 트리거는 천간 10일·지지 12일 주기로 발현하고, 두 주기 모두 7과 **서로소**(coprime)라 요일 격자와 구조적으로 정렬되지 않는다 — 발현일이 특정 요일에 고이지 않으므로 요일 주기가 만드는 가짜 상관이 구조적으로 탈상관된다. 즉 미커버지만 트리거의 산술 구조가 위험을 상쇄한다(논거 명문화, 후속 관측 대상).

### windowCapDays(365) 도달 시점 예고

검증 윈도우는 데이터-존재 구간이 1차이고 `windowCapDays = 365`([insight-thresholds.ts](../../src/shared/insight-thresholds.ts), #504 [ADR-0044](../adr/0044-discovery-measurement-validity.md))가 상한 백스톱이다. 데이터가 누적돼 이력이 365일을 넘기기 시작하면(대략 2027 중반) 윈도우 **시작이 앞으로 밀린다**. 그러면 e-value 시퀀스의 prefix가 잘려 **sup 단조·리플레이 불변** 전제([ADR-0034](../adr/0034-evalue-construction-replay-test-martingale.md): 매주 전체 윈도우를 처음부터 리플레이 → 동일 마틴게일)가 약화된다(윈도우가 이동하면 "처음부터"의 기준점이 바뀜).

- **판단 필요 시점**: 도달 전. 선택지 = ① 고정 앵커(윈도우 시작을 데이터 개시일에 고정 — cap을 사실상 무제한) vs ② cap 유지하되 confirmed의 sticky 처리를 앵커 이동에 견디게 재정의.
- **처리**: 별도 후속 이슈로 다룰 것(현재는 도달 전이라 무영향, 여기 기록만).
