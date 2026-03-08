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

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-05 | 프로젝트 시작, Phase 0~1 완료 (초기 세팅, Slack/LLM/MCP 연결) |
| 2026-03-06 | Phase 2~4 완료 (일정/크론/루틴 에이전트, Docker 배포) |
| 2026-03-07 | Phase 5 속도 최적화, 의도 분류 진화, 안정성 개선 |
| 2026-03-08 | 카테고리 그룹핑 + v1 아키텍처 회고 + v2 설계 결정 |
