# 0031. 일일 종합 인사이트 — 개인화 주입 지점을 생성에서 발송으로 이동

- Status: Accepted
- Date: 2026-06-03
- Related: #475, 마스터 #421 (A3), 데이터 소스 #393/#434
- Tags: data, insight, llm, architecture

## Context

ADR-0020이 사주 풀이 시스템과 v2 매칭 학습 시스템의 책임을 분리하고, 학습 결과를 노출하는 `saju_influence_summary` view(verified/accumulating/recent 3-tier)를 깔았다. 첫 소비자는 주간 회고(`weekly-saju-review-v2`)였다.

그러나 **매일 발송되는 일운에는 학습 결과가 전혀 주입되지 않았다**:

- `weekly-fortune` routine(일요일 밤)은 만세력으로 미래 7일 일운을 생성해 `fortune_analyses`에 저장하는데, freeze된 구 `saju_patterns`만 참조하고 view는 읽지 않는다.
- 매일 아침 발송(`insightMorningTask`, Node.js cron 08:00)은 `fortune_analyses` 오늘치를 `formatFortuneText`로 **포맷만** 한다. LLM도, 학습 주입도 없다.
- 결과적으로 #393/#434가 매일 누적하는 매칭·검증 데이터(view)가 사용자에게 닿는 일일 경로가 없었다.

원래 A3 계획은 "weekly-fortune이 생성 시점에 view를 주입"이었으나 두 구조적 한계가 있었다:

1. **7일 스냅샷 지연** — 주1회 생성이라 그 주 안에 매트릭이 승인되거나 시드가 격상돼도 다음 일요일까지 반영 안 됨.
2. **life_signal의 시간성** — 라이프 신호(수면·루틴·지출 등 행동 기반 시드)는 "오늘 기준" 누적 데이터로 평가된다. 미래 7일치를 미리 생성할 수 없다.

추가로 현황 데이터 확인 결과(2026-06-02): view의 `verified` tier는 **0개**, `accumulating` 1개, `recent` 65개. 오늘 발현 시드와 verified/accumulating의 교집합은 **0**. 즉 "검증된 인과"만으로는 당분간 메시지가 빈손이 된다.

## Decision

**개인화 주입 지점을 생성(weekly-fortune)에서 발송(매일 아침)으로 이동한다.**

매일 08:00 KST에 도는 **일일 종합 인사이트 routine**(`daily-insight`, Claude 앱 routine, Opus)을 신설한다. 이 routine은 오늘 사주 일운과 오늘 발현 시드를 신뢰도 tier별로 종합해 인사이트 채널에 단일 메시지로 발송한다.

**3층 종합 구조:**

1. **베이스 — 오늘 사주 일운**: `weekly-fortune`이 미리 생성한 `fortune_analyses` 오늘치(만세력 기반 교과서 해석)
2. **검증 레이어 — 인과 단언**: 오늘 발현 시드 중 `verified`/`accumulating`. "너는 X일 때 실제로 Y하더라" (지금 거의 0, 검증 누적되며 성장)
3. **현황 레이어 — 배경 맥락**: 오늘 발현 시드 중 미검증(`recent`). "오늘 이런 기운·신호가 활성" — **인과 주장 금지, 발현 사실만**

**역할 분담:**

- `weekly-fortune`은 미래 7일 사주 예보 생성으로 **불변** (/일운 조회 + daily-insight의 베이스 재료).
- `insightMorningTask`(cron, 포맷만)는 routine으로 이관, Node.js 코드·SLOT_TASKS·DB 슬롯에서 제거 (ADR-0027 — LLM 비동기 작업은 routine으로 통일).
- 매칭 cron(`dailySajuMatching`)을 09:00 → **07:00**으로 당겨 08:00 종합이 그날 발현 시드를 읽도록 선행. `daily_insight_log` 테이블로 발송 멱등 보장.

**헌장 준수 (마스터 #393/#434):**

- 헌장 ① (텍스트 의존 최소화): LLM 입력에 diary 원문 금지. view `description`·시드명·카운트·메트릭만.
- 헌장 ④ (신뢰 비용 분리): tier별 해석 강도 차등 (verified=단언 / accumulating=경향 / recent=현황).
- 기각안 "풀이 LLM이 새 가설 생성" 준수: view/매칭에 **있는 시드만** 사용, 새 패턴 생성 금지 (할루시네이션 차단).
- 사주 시드(`stem`/`branch`/`ganji`/`relation`/`sibiunsung`/`element_density`/`cumulative_pillar_count`)와 `life_signal`을 레이어로 분리 표시.

## Alternatives considered

### A. weekly-fortune이 생성 시점에 view 주입 (원래 A3 계획)

- 장점: 새 routine 불필요, 기존 생성 경로 재사용
- 단점: 7일 스냅샷 지연, 사주 시드만 가능(life_signal 미래 생성 불가)
- 기각 이유: 매일 발송으로 흡수하면 지연·시간성 문제가 동시에 사라짐

### B. 구 `saju_patterns` 26개를 신 시스템(pattern_catalog)으로 이관 후 활용

- 장점: 기존 풀이 자산 재활용
- 단점: 큰 마이그레이션 작업 + 통계 검증이 약한 데이터
- 기각 이유: 범위 과대. A3 후속(별도 트랙)으로 분리

### C. recent 제외, 검증된 시드만 종합

- 장점: 인과 신뢰도 최고, 할루시네이션 위험 최소
- 단점: 현재 verified∩발현 = 0이라 메시지가 사실상 빈손
- 기각 이유: 운영 초기 빈약함. 현황 레이어를 인과 주장 없이 포함하면 신선함 확보 + 검증 누적 시 자동으로 격상

### D. 매일 발송 시점 종합 + 3층(베이스/검증/현황) + recent 현황 포함 (선택)

- 장점: 매일 신선, 사주+라이프 통합, weekly-fortune 불변, 검증 누적 시 시드가 recent→accumulating→verified 자동 격상
- 단점: 매일 Opus 1회, insightMorning 이관에 따른 봇 코드·DB 변경, 매칭 선행 의존

## Consequences

### 장점

- 학습이 **매일** 발송에 반영 — 매트릭 승인·시드 격상이 다음날 바로 닿음 (7일 스냅샷 지연 제거)
- 사주 + 라이프 신호 통합 — life_signal의 "오늘 기준" 시간성을 발송 시점 평가로 자연 해소
- `weekly-fortune`은 미래 예보로 불변 — 책임 경계 유지
- view의 tier 승급(recent→accumulating→verified)이 메시지 강도에 자동 반영 — 별도 작업 없이 품질 성장
- ADR-0027 routine 통일 원칙과 일관

### 단점 / 제약

- 매일 Opus routine 1회 (구독 비용)
- `insightMorningTask` 이관으로 봇 코드·DB 설정 동시 변경 (마이그레이션 076)
- 매칭 선행 의존 — 매칭 cron이 죽으면 그날 발현 데이터 누락. 갭 자동 백필로 완화하나 당일 07:00 실패 시 08:00 종합은 전날까지 데이터만 반영
- routine SKILL.md는 repo 외부 — 변경 이력은 ADR·도메인 문서로만 추적

### 후속 작업

- [ ] 구 `saju_patterns` 정리 (weekly-fortune 관점 5) — A3 후속
- [ ] 월·세·대운 종합 확장 (#408 이후) — 일운 종합을 템플릿으로
- [ ] 검증 시드 누적 후 인과 레이어 품질 점검 (운영 1\~3개월)
