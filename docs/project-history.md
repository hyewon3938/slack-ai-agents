# 프로젝트 히스토리

개인 라이프 데이터 AI 에이전트 시스템의 개발 과정과 설계 변화를 기록하는 문서.

---

## Phase 0: 프로젝트 초기 세팅

**날짜:** 2026-03-05
**Issues:** #1

프로젝트 구조 생성, TypeScript + ESM 설정, 코드 컨벤션 정의.

- Runtime: Node.js + TypeScript (strict mode)
- 패키지 매니저: yarn
- ESM (type: module) — import에 .js 확장자 필요
- 코드 컨벤션: `docs/conventions.md`에 정리

---

## Phase 1: 기반 인프라 구축

**날짜:** 2026-03-05
**Issues:** #2, #3, #4 | **PRs:** #11, #12, #13

### Slack Bolt 연결 (#2, PR #11)
- @slack/bolt (Socket Mode) 기반 앱 초기화
- 채널별 에이전트 라우팅 구조 설계

### LLM 추상화 레이어 (#3, PR #12)
- `LLMClient` 인터페이스 정의 (Provider 교체 가능)
- 초기 구현: Groq (llama-3.3-70b-versatile)
- 이후 Gemini, Claude Provider 추가

### MCP 클라이언트 (#4, PR #13)
- @modelcontextprotocol/sdk 기반 Notion MCP 서버 연결
- stdio transport로 npx @notionhq/notion-mcp-server 실행
- 도구 목록 캐싱 + 자동 재연결

---

## Phase 2: 일정 관리 에이전트

**날짜:** 2026-03-06
**Issues:** #5 | **PRs:** #14, #15

Notion DB를 백엔드로 사용하는 일정(할일) 관리 에이전트.

- 자연어 → LLM + MCP 도구 → Notion CRUD
- 시스템 프롬프트: 잔소리꾼 친구 캐릭터, DB 스키마 명시
- Notion DB 스키마: Name, Date, 상태(todo/in-progress/done/cancelled), 메모, 카테고리

---

## Phase 3: Cron 알림 시스템

**날짜:** 2026-03-06
**Issues:** #6 | **PRs:** #16

하루 4회(09:00, 13:00, 18:00, 22:00) 일정 알림.

- node-cron (timezone: Asia/Seoul)
- Notion SDK 직접 조회 → 포매팅 → Slack 전송
- LLM 기반 인사/잔소리 생성 (아침, 밤)

---

## Phase 4: 루틴 에이전트 + 채널 라우팅

**날짜:** 2026-03-06
**Issues:** #7, #19 | **PRs:** #24

데일리 루틴 체크리스트 관리 에이전트.

- 채널별 에이전트 라우팅: #schedule → 일정, #routine → 루틴
- 루틴 DB 스키마: 템플릿(Date=null) + 일별 기록(Date=날짜)
- 반복 주기: 매일/격일/3일마다/주1회
- Slack Block Kit 체크리스트 UI + interactive 버튼
- 크론: 아침에 기록 자동 생성 + 시간대별 체크리스트 알림

---

## Phase 5: 속도 최적화 + 안정성 개선

**날짜:** 2026-03-07 ~ 03-08
**Issues:** #20~#23 | **PRs:** #24~#30

### 5-1. 에이전트 공통 인프라 (#20, PR #24)
- agent-loop.ts 공통화 (schedule/routine 공유)
- personality.ts 캐릭터 프롬프트 분리
- 에러 복구: transient retry, rate limit 파싱

### 5-2. 조회 속도 개선 (#21)
- SDK 직접 조회 빠른 경로 (detectSimpleQuery): LLM 3회 → 0회, 7~11초 → ~1초
- 변경 후 자동 목록 표시 (post-mutation enrichment): LLM 재조회 제거

### 5-3. 의도 분류 시스템의 진화 (#22)

3단계에 걸쳐 근본적으로 변화:

**Phase A — LLM 분류:** 모든 메시지를 LLM에 "잡담? 액션?" 질문. 느리고(2~3초) 부정확.

**Phase B — 하이브리드 키워드 분류:** ACTION_KEYWORDS + CASUAL_OVERRIDES 4-case 분류. 95% 즉시 판단. 하지만 "완료하고 잘거야" 사건(다짐을 액션으로 오분류해 모든 일정을 완료 처리)으로 한계 노출. 새 표현마다 키워드 추가하는 끝없는 땜질.

**Phase C — 분류 제거:** 키워드 분류 자체를 삭제. 빠른 경로(체크, 오늘 일정 등) 외 모든 메시지를 LLM 에이전트 루프로 통합. LLM이 도구를 쓸지 말지 스스로 판단. casual-chat.ts + 테스트 ~500줄 삭제.

**핵심 교훈:** "분류"라는 별도 단계가 필요하다는 가정 자체가 틀렸다. LLM 에이전트는 이미 도구를 쓸지 말지 판단하는 능력이 있다.

> 상세 기록: `docs/intent-classification.md`, `docs/speed-optimization.md`

### 5-4. 쓰기 신뢰성 개선 (#23)
- LLM 도구 미사용 환각 방지 (PR #26)
- 에이전트 안정성 개선 (PR #27)
- Overflow 메뉴: 내일로 미루기, 체크 단축어 (PR #28)

### 추가 개선
- 대화 맥락 유지: ChatHistory 10쌍 슬라이딩 윈도우 (PR #29)
- 지연 ack: 800ms 내 응답 시 "잠깐만" 생략 (PR #30)
- 도구 필터 캐싱: 참조 동등성 기반 O(1) (PR #30)
- 루틴 달성률 분석 기능 (PR #30)
- 일정 카테고리별 그룹핑 표시 (PR #33)

---

## 배포

**날짜:** 2026-03-06
**PR:** #17 (Docker 환경), #18 (반영)

- Oracle Cloud Free Tier ARM VM
- Docker + docker-compose
- SSH 키 기반 접근

---

## v1 아키텍처 회고 — 왜 다시 설계하는가

### v1 아키텍처 (현재)

```
[Slack] → 채널별 라우팅 → [에이전트 (schedule/routine)]
                              ↓
                        [LLM (Gemini Flash)] + [MCP 도구 6개]
                              ↓
                          [Notion DB]
```

### 잘된 점

1. **LLM 추상화**: Provider 교체가 설정 한 줄로 가능 (Groq → Gemini → Claude)
2. **에이전트 루프 패턴**: tool use 기반 자율 판단 구조
3. **의도 분류 제거**: 불필요한 단계를 걷어낸 결정
4. **Slack bolt 연동**: Socket Mode 기반 안정적인 인터페이스
5. **크론 알림**: 하루 4회 리마인더 체계

### 드러난 근본적 한계

#### 1. 모델 성능 병목
Gemini Flash는 속도 최적화 모델. 복잡한 추론, 도구 선택, 자연어 맥락 이해에서 한계가 뚜렷. 답을 틀리거나 요청 방향을 애매하게 잡는 문제가 반복됨.

#### 2. Notion의 데이터 한계
- DB 간 JOIN 불가 → 크로스 도메인 분석 불가능
- 집계 함수 없음 (AVG, SUM, GROUP BY 등)
- API 호출 제한 + 응답 속도 이슈
- MCP 도구가 범용적이라 스키마에 최적화되지 않음

#### 3. 과도한 제약으로 인한 악순환
- 모델이 부정확하니까 fast path로 LLM을 우회 → LLM이 할 수 있는 게 줄어듦
- 150줄+ 시스템 프롬프트로 행동 규칙 강제 → 규칙이 많을수록 LLM이 혼란
- "3D 프린터로 뗀석기를 만드는" 비유: 강력한 도구에 구석기 틀을 제공

#### 4. 채널별 에이전트 분리의 한계
- 일정 에이전트와 루틴 에이전트가 서로의 데이터를 모름
- "루틴을 못 지킨 이유가 일정이 많아서인가?" 같은 크로스 분석 불가
- 최종 목표(삶의 데이터 종합 분석)와 구조적 충돌

#### 5. 도구 빈곤
Notion MCP 6개 도구가 전부. 자율적 에이전트가 되기엔 선택지가 너무 적음.

### 결론
기능을 계속 추가하며 보수하는 것보다, 코어(데이터층 + 모델)를 교체하는 근본적 전환이 필요.

---

## v2 설계 — 개인 라이프 데이터 플랫폼

### 비전

> 일정, 루틴, 수면, 지출, 일기, 명리학 분석 — 삶의 모든 데이터를 한 곳에 쌓고,
> 자연어로 대화하면서 기록하고, 크로스 분석해서 패턴과 인사이트를 뽑아내는 시스템.

### v2 아키텍처

```
[Slack] ──메시지──→ [Node.js 서버]
                        │
                        ▼
                  [Claude Sonnet API]
                   (tool use 내장)
                        │
                   ┌────┴────┐
                   ▼         ▼
              [PostgreSQL]  [외부 API]
              (모든 라이프   (명리학: Gemini,
               데이터 통합)   날씨, 등)
                   │
                   ▼
              [Web Dashboard]
              (데이터 시각화, 향후)
```

### v1 → v2 핵심 변경

| 항목 | v1 | v2 |
|------|----|----|
| **데이터** | Notion (DB별 분리, JOIN 불가) | PostgreSQL (통합 DB, SQL 크로스 분석) |
| **모델** | Gemini Flash (속도형) | Claude Sonnet (추론형, 메인) + Gemini (명리학 전용) |
| **에이전트** | 채널별 분리 (schedule/routine) | 단일 통합 에이전트 (LLM이 도메인 자율 판단) |
| **도구** | MCP → Notion 6개 | Claude API tool use 직접 정의 (SQL 도구) |
| **프롬프트** | 150줄+ 규칙 | DB 스키마 + 최소 규칙 (~30줄) |
| **인터페이스** | Slack 채널별 (#schedule, #routine) | Slack 단일 채널 (#life) + 알림 채널 (#daily) |
| **비용** | ~$3/월 (Gemini Flash) | ~$15~25/월 (Claude Sonnet) |

### DB 스키마

```sql
-- 일정
CREATE TABLE schedules (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  date DATE,
  end_date DATE,
  status TEXT DEFAULT 'todo',  -- todo/in-progress/done/cancelled
  category TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 루틴 템플릿
CREATE TABLE routine_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  time_slot TEXT,        -- 아침/점심/저녁/밤
  frequency TEXT,        -- 매일/격일/3일마다/주1회
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 루틴 일별 기록
CREATE TABLE routine_records (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES routine_templates(id),
  date DATE NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 이후 확장 테이블
-- diary: 일기 (date, content, mood)
-- sleep: 수면 (date, sleep_time, wake_time, quality)
-- expenses: 지출 (date, amount, category, description)
-- fortune: 명리학 기반 분석 (date, content)
```

### 에이전트 도구 설계

MCP 대신 Claude API tool use 직접 정의:

| 도구 | 설명 |
|------|------|
| `query_db` | SELECT 쿼리 실행 (데이터 조회, 분석) |
| `modify_db` | INSERT/UPDATE/DELETE 실행 (데이터 변경) |
| `get_schema` | DB 스키마 확인 (LLM이 테이블 구조 파악) |

도구 3~4개로 v1의 Notion MCP 6개보다 적지만, SQL의 유연성으로 할 수 있는 것은 비교 불가.

### Slack 채널 구조

| 채널 | 용도 |
|------|------|
| #life | 메인. 모든 자연어 대화, 기록, 분석 |
| #daily | 크론 알림 전용 (아침 브리핑, 밤 리뷰) |

### v1에서 재활용하는 것

- Slack bolt 연동 코드
- 크론 구조 (node-cron, 시간대별 알림)
- LLM 추상화 인터페이스 패턴
- 에이전트 루프 패턴 (tool use 기반)
- Docker 배포 환경
- 코드 컨벤션

### 마이그레이션 로드맵

1. PostgreSQL 세팅 + 스키마 설계 (Oracle VM)
2. Claude Sonnet 연동 + SQL 도구 구현
3. 단일 에이전트 구현 (통합 에이전트 루프)
4. Slack 연동 (bolt 재활용)
5. 크론 알림 이식 (Notion SDK → SQL)
6. 기존 Notion 데이터 마이그레이션
7. 대시보드 (향후)

---

## v2 인프라 개선

**날짜:** 2026-03-08
**PRs:** #48~#50

### KST 타임존 수정 + 유틸리티 통합

서버(UTC)에서 `formatDateShort('2026-03-28')`이 토요일을 금요일로 표시하는 버그 발견.
원인: `new Date(dateStr + 'T00:00:00+09:00')` → 자정 KST = 전날 15:00 UTC → `.getDay()`가 전날 요일 반환.

**해결:** `src/shared/kst.ts` 신규 생성. 모든 KST 날짜 유틸리티를 한 곳에 통합.
- noon KST 파싱(`T12:00:00+09:00`) + UTC 메서드(`getUTCDay()`) 사용으로 타임존 무관 정확성 확보
- 3개 파일(prompt.ts, home.ts, life-cron.ts)에 흩어진 중복 함수 제거

### App Home 탭 대시보드 (#50)

루틴 체크리스트가 채널 대화에 밀려 올라가는 UX 문제 해결.
Slack App Home 탭에 오늘의 일정 + 루틴 + 수면 요약을 영구 표시.
버튼 클릭 시 Home 탭도 실시간 갱신.

### 프롬프트 강화

- 요일 SQL 강제 규칙: LLM이 요일을 머릿속으로 계산하지 않도록 `EXTRACT(DOW FROM date)` 강제
- 일정 메모 기능: 마크다운/줄바꿈 보존, Block Kit에 `└ 메모` 표시
- 변경 후 전체 목록 표시 + 백로그 관리 규칙 추가

---

## 스마트 메모리 시스템 (설계)

**날짜:** 2026-03-08
**Issues:** #51

### 배경 — 오픈클로(OpenClaw) 연구

오픈클로의 아키텍처를 분석한 결과, 핵심 차이는 "마법 같은 LLM"이 아니라 **도구의 범위 + 컨텍스트 관리 + 영속 메모리** 시스템에 있었음.

우리 프로젝트의 `custom_instructions`는 이미 영속 메모리의 초기 형태.
하지만 사용자가 "기억해"라고 명시해야만 저장되는 수동 방식 → 자동 감지로 확장.

### 설계 방향

| 기능 | 설명 |
|------|------|
| **카테고리 분류** | 일정/루틴/수면/응답/기타로 지시사항 분류 |
| **자동 감지** | 대화 중 지속적 선호/패턴을 LLM이 자동으로 저장 (source='auto') |
| **저장 시 최적화** | 같은 카테고리 내 중복/모순 지시사항을 통합 → 프롬프트 비대화 방지 |
| **데이터 소실 방지** | soft-delete + source 구분. 사용자 명시 지시는 자동 삭제 안 됨 |

### 핵심 설계 결정

1. **LLM-driven 관리**: 별도 백엔드 없이 기존 SQL 도구로 관리. 프롬프트 규칙이 LLM의 행동을 유도.
2. **source 이중 구조**: `user`(명시적) vs `auto`(자동). user 지시는 보호 등급 높음.
3. **soft-delete**: 모든 삭제는 `active=false`. 실제 DELETE 없음. 복구 항상 가능.
4. **단순 시작**: 벡터 검색, 맥락 기반 선택적 로딩 등 고급 기능은 필요해질 때 추가.

### 오픈클로와의 비교에서 얻은 교훈

> 오픈클로가 "똑똑해 보이는" 이유는 특별한 LLM이 아니라, **시스템 프롬프트 + 도구 정의 + 컨텍스트 주입**의 조합.
> 우리 프로젝트도 같은 원리로 동작하고 있으며, 메모리 시스템 확장으로 자율성을 높일 수 있다.

---

## AI 개발 워크플로우 자동화

**날짜:** 2026-03-09

### 배경

프로젝트가 안정화되면서 "어떻게 개발하는가" 자체를 최적화할 시점이 왔음.
Claude Code의 모든 확장 기능(Skills, Hooks, MCP, Scheduled Tasks, GitHub Actions)을 활용하여
개발 워크플로우 전체를 AI 기반으로 자동화.

### 구현 내용

**Hooks (품질 게이트, 3개)**
- PostToolUse: 파일 수정 후 prettier + eslint --fix 자동 실행
- PreToolUse: 커밋 전 lint + tsc 타입 체크
- PreToolUse: 커밋 전 민감정보 유출 스캔 (scripts/check-secrets.sh)
- 범용/프로젝트 2-tier: prettier+민감정보는 모든 프로젝트에 적용

**커스텀 스킬 (4개)**
- `/init-project` (범용): 프로젝트 첫 세팅 — 컨벤션, 브랜치 전략, 라벨 체계, CLAUDE.md 전부 자동 생성
- `/start-feature` (프로젝트): 이슈 생성 → 브랜치 → 설계 → 히스토리 기록까지 한번에
- `/review-code` (프로젝트): 코드 리뷰 + 컨벤션 점검 + 컨벤션 자동 진화 제안
- `/review-me` (범용): 개발 성향/AI 협업 패턴/강점/개선점 분석

**Scheduled Tasks (예약 작업, 2개)**
- daily-dev-review (매일 새벽 5시): 개발 성향 분석 → developer-profile.md
- daily-work-summary (매일 오전 9시): 전날 작업 팩트 요약 → work-log.md

**GitHub Actions (2개 워크플로우)**
- PR 코드 리뷰: PR 열릴 때 자동 AI 리뷰 + 컨벤션 괴리 감지
- 머지 후 리팩토링: 머지 시 리팩토링 필요성 분석 → 자동 이슈 생성

**MCP 서버 (2개)**
- PostgreSQL: 개발 중 DB 직접 조회/분석
- Slack: 채널 메시지 읽기/쓰기

### 설계 결정

1. **범용 vs 프로젝트 분리**: init-project, review-me, Hook(prettier+민감정보)은 범용(~/.claude/). 나머지는 프로젝트 종속.
2. **스킬 간 파일 기반 연결**: init-project가 생성한 컨벤션/라벨 규칙을 start-feature/review-code가 참조.
3. **컨벤션 자동 진화**: 코드 리뷰 시 실제 코드 패턴과 컨벤션 괴리 감지 → 업데이트 제안.
4. **리팩토링 안전장치**: 자동 코드 수정이 아닌 이슈 생성 → 사람 승인 후 작업.

---

## API 비용 최적화 전략

**날짜:** 2026-03-09

### 배경

v2에서 LLM을 Claude Sonnet으로 교체하면서 API 비용이 Gemini Flash 대비 크게 증가.
테스트 기간 동안 $5/일 소비 확인. 실사용 기준 월 $25~30 추정.
향후 도메인 확장(일기/지출/명리학/크로스분석) 시 월 $45+ 예상.
비용 구조를 근본적으로 개선하지 않으면 도메인 추가할수록 비용이 선형 증가하는 문제.

### 비용 분석

| 구분 | 상세 |
|------|------|
| 모델 | Claude Sonnet — input $3/1M, output $15/1M |
| 시스템 프롬프트 | ~2,500 토큰 (매 요청마다 전송) |
| 요청당 평균 | input ~8K, output ~1.5K (도구 2~3라운드) |
| 크론 LLM 사용 | 7개 중 2개만 (아침 인사 + 밤 마무리) |
| 대화 히스토리 | 10쌍 슬라이딩 윈도우 |

### 최적화 전략 (3-tier)

**Tier 1: 하이브리드 모델 (즉시 적용)**
- 크론 메시지 생성(아침/밤) → Gemini Flash로 분리
- 사용자 대화는 Claude Sonnet 유지 (품질 필수)
- 월 $2~3 절약, 구현 난이도 낮음

**Tier 2: 시스템 프롬프트 최적화 (즉시 적용)**
- DB 스키마 축약 (타입/디폴트 생략, 컬럼명 중심)
- 예시 압축
- 커스텀 지시사항 상한선 (MAX 20개, 초과 시 auto 비활성화)
- 향후 도메인 확장 대비 프롬프트 모듈 분리 구조 설계

**Tier 3: 프리컴퓨팅 + 요약 캐싱 (도메인 확장 시)**
- 크론으로 일/주 단위 요약을 `daily_summaries` 테이블에 저장
- 크로스 분석 → 원본 데이터 대신 요약 테이블 조회
- 도구 루프 3~5회 → 1~2회로 감소
- 도메인 확장(일기/지출) 시 함께 구현

### 설계 결정 근거

1. **응답 캐싱은 후순위**: 같은 질문 반복 빈도 낮음. `postModifyHook`으로 무효화 가능하지만 ROI 낮음.
2. **Gemini Flash는 메인 대화 부적합**: 이미 성능 이슈로 교체한 전력. 복잡한 SQL 규칙 + 포맷 준수에 약함.
3. **프롬프트 모듈 분리가 장기 핵심**: 도메인 6개 이상 시 프롬프트 5,000+ 토큰. 도메인 감지 → 관련 규칙만 로딩하는 구조 필요.
4. **오픈소스(OpenClaw) 비용 전략 참고**: 모델 티어링 + 컨텍스트 최적화 + 프리컴퓨팅이 업계 공통 패턴.

### 구현 계획

- Tier 1+2: 즉시 이슈 생성 → 구현
- Tier 3: 별도 이슈 등록, 도메인 확장(#39) 시 함께 작업

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-05 | 프로젝트 시작, Phase 0~1 완료 (초기 세팅, Slack/LLM/MCP 연결) |
| 2026-03-06 | Phase 2~4 완료 (일정/크론/루틴 에이전트, Docker 배포) |
| 2026-03-07 | Phase 5 속도 최적화, 의도 분류 진화, 안정성 개선 |
| 2026-03-08 | 카테고리 그룹핑 + v1 아키텍처 회고 + v2 설계 결정 |
| 2026-03-08 | v2 인프라 개선 (KST 수정, App Home, 프롬프트 강화) |
| 2026-03-08 | 스마트 메모리 시스템 설계 (오픈클로 연구 기반, Issue #51) |
| 2026-03-09 | AI 개발 워크플로우 자동화 (Hooks, Skills, Scheduled Tasks, GitHub Actions, MCP) |
| 2026-03-09 | API 비용 최적화 전략 수립 (하이브리드 모델 + 프롬프트 최적화 + 프리컴퓨팅 설계) |
