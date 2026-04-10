# 프로젝트 히스토리

개인 라이프 데이터 AI 에이전트 시스템의 개발 과정과 설계 변화를 기록하는 문서.

---

## 2026-04-10: 배포 파이프라인 최적화 (#227, PR #228/#229/#230)

GitHub Actions에서 Docker 이미지를 빌드해 GHCR에 푸시하고, 배포 대상 서버는 이미지를
pull 하여 재기동하는 구조로 전환. 서버에서 수행하던 yarn install/build를 제거해
VM 리소스 경쟁 해소 + 의존성 변경 시 최악 케이스(4\~10분, 간헐적 타임아웃 실패) 제거.
BuildKit GHA 캐시와 Dockerfile cache mount 조합으로 warm build 최적화. docker-compose
app 서비스는 `image:` 필드 기반으로 재구성.

**실측:** 이전 Deploy via SSH 스텝은 48\~471초 범위(중앙값 61초, 평균 109초)로 편차가
컸고 타임아웃 실패도 간헐 발생. 이후 총 파이프라인은 cold cache 180초, warm cache **81초**로
안정화(PR #231 측정). 중앙값은 기존 수준이지만 **편차 13배 → 2배 내, 최악 케이스 제거**가
핵심 성과.

### 삽질 기록
- **PR #229**: BuildKit cache mount 경로에서 `yarn cache clean` 호출 시 rmdir EBUSY 발생 → 제거
- **PR #230**: 빌드 이미지 대상 플랫폼과 배포 서버 런타임 불일치로 실행 포맷 에러 발생 → 러너·플랫폼 옵션을 배포 환경에 맞춰 수정. 교훈: 외부 런타임과 엮인 파이프라인 설계 시 대상 환경의 실제 플랫폼을 설계 전 현장 검증.

### 후속 개선 (PR #233, #234)
- **이미지 누적 자동 정리**: build-image 잡에 `actions/delete-package-versions@v5` 추가(최근 10개 유지, `latest` 제외). VM 측 `deploy.sh`는 앱 이미지 최신 2개만 보존하여 디스크 사용량 바운드 + 즉시 롤백 여유분 확보.
- **크리덴셜 로테이션 가이드**: `docs/credentials-internal.md`(gitignored)에 만료일·갱신 절차 기록. GitHub 자동 알림 + 개인 캘린더 이중화 방침 수립.
- **보안 아키텍처 점검**: DB Proxy API 호스트 포트 바인딩을 `0.0.0.0:3100` → `127.0.0.1:3100`으로 전환. 외부 트래픽이 호스트 Caddy의 TLS 종료를 반드시 거치도록 defense-in-depth 강화. README의 인프라 클레임(테스트 수, 서비스 구성, 사용자 격리 범위 등)과 실제 코드·구성 간 정합성 재점검 및 보정.

자세한 분석: [docs/pipeline-optimization.md](pipeline-optimization.md)

---

## 2026-04-09: 수입 전체 기간 분배 옵션 (#204, PR #205)

수입(환불 등)이 이번 달 예산만 높이지 않고 목표 기간 전체에 균등 분배하는 옵션 추가.

- `expenses.distribute_to_budget` 컬럼: 수입별 "이번 달 / 전체 분배" 선택
- 분배 수입은 `currentMonthIncome` 집계에서 제외 → `budgetBase`에 유지되어 `dailyFree` 계산 시 전체 기간에 자동 분산
- 수입 등록/수정 폼에 토글 UI 추가 (기존 수입은 `DEFAULT false`로 동작 유지)
- 일별 예산 현황 누적 세이브/런웨이 영향 일수에 툴팁 설명 추가

---

## 2026-04-09: 일별 예산 현황 로그 (#202, PR #203)

매일 자정 전 예산 스냅샷을 저장하고, 관리탭에서 일별 세이브/초과 현황을 확인하는 기능.

- DB: `daily_budget_logs` 테이블 (일별 예산/지출/세이브 스냅샷, UPSERT)
- Vercel cron: 매일 23:50 KST에 `queryRunway` 결과 스냅샷 저장
- 관리탭 서브탭 "일별 현황" 추가 (지출 | 일별 현황 | 카테고리)
- 누적 세이브/초과량 + 런웨이 영향 일수 표시
- 과거 대금기간도 조회 가능 (스냅샷 기반 고정값)

---

## 2026-04-09: 예산 계산 리팩토링 + 단위 테스트 (#200, PR #201)

`queries.ts`에서 `calcBudgetPreview`와 `queryRunway`가 공유하던 \~115줄의 중복 계산 로직을 순수 함수로 추출했다. TDD로 개발: 테스트 먼저 작성 → 공통 함수 추출 → 테스트 통과 확인.

- `budget-calc.ts` 신규: 빌링 유틸 4개(addBillingMonths, getCurrentBillingMonth, getBillingRange, calcCycleDays) + `calculateBudgetAllocation` 순수 함수
- `budget-calc.test.ts` 신규: 28개 단위 테스트 (빌링 유틸 + 예산 배분 핵심 케이스)
- `queries.ts` -155줄: 중복 locked 루프 제거, 공통 함수 호출로 대체
- 동작 변경 없는 리팩토링 — API 응답값 동일 유지

---

## 2026-04-07: 결제수단 선택 + 카드 할부 입력 (#179, PR #180)

지출 입력 폼에 결제수단 선택 및 카드 할부 기능을 추가했다.

- 지출 폼에 카드/현금 토글 UI 추가
- 카드 선택 시 할부 개월 수(일시불/2\~12개월) 입력 가능
- 할부 선택 시 "월 N원 × N개월" 실시간 미리보기
- API에서 총액을 월별 분할하여 N건의 할부 지출 자동 생성 (미래 날짜 포함)
- 끝전 보정 적용 (마지막 회차에서 나머지 흡수)

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

**날짜:** 2026-03-07 \~ 03-08
**Issues:** #20\~#23 | **PRs:** #24\~#30

### 5-1. 에이전트 공통 인프라 (#20, PR #24)
- agent-loop.ts 공통화 (schedule/routine 공유)
- personality.ts 캐릭터 프롬프트 분리
- 에러 복구: transient retry, rate limit 파싱

### 5-2. 조회 속도 개선 (#21)
- SDK 직접 조회 빠른 경로 (detectSimpleQuery): LLM 3회 → 0회, 7\~11초 → \~1초
- 변경 후 자동 목록 표시 (post-mutation enrichment): LLM 재조회 제거

### 5-3. 의도 분류 시스템의 진화 (#22)

3단계에 걸쳐 근본적으로 변화:

**Phase A — LLM 분류:** 모든 메시지를 LLM에 "잡담? 액션?" 질문. 느리고(2\~3초) 부정확.

**Phase B — 하이브리드 키워드 분류:** ACTION_KEYWORDS + CASUAL_OVERRIDES 4-case 분류. 95% 즉시 판단. 하지만 "완료하고 잘거야" 사건(다짐을 액션으로 오분류해 모든 일정을 완료 처리)으로 한계 노출. 새 표현마다 키워드 추가하는 끝없는 땜질.

**Phase C — 분류 제거:** 키워드 분류 자체를 삭제. 빠른 경로(체크, 오늘 일정 등) 외 모든 메시지를 LLM 에이전트 루프로 통합. LLM이 도구를 쓸지 말지 스스로 판단. casual-chat.ts + 테스트 \~500줄 삭제.

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
| **프롬프트** | 150줄+ 규칙 | DB 스키마 + 최소 규칙 (\~30줄) |
| **인터페이스** | Slack 채널별 (#schedule, #routine) | Slack 단일 채널 (#life) + 알림 채널 (#daily) |
| **비용** | \~$3/월 (Gemini Flash) | \~$15\~25/월 (Claude Sonnet) |

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

도구 3\~4개로 v1의 Notion MCP 6개보다 적지만, SQL의 유연성으로 할 수 있는 것은 비교 불가.

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
**PRs:** #48\~#50

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
- `/init-project` (범용): 인터뷰 → 프로젝트 분석 → 컨벤션, 브랜치 전략, 라벨 체계, CLAUDE.md 전부 자동 생성 (11단계)
- `/start-feature` (프로젝트): 인터뷰 → 이슈 → 브랜치 → 설계(⛔ 보안 + TDD 분류) → 구현 → 코드 리뷰 → 테스트 → PR (8단계)
- `/review-code` (프로젝트): ⛔ 보안 감사(최우선) + 코드 리뷰 + 컨벤션 점검 + 컨벤션 자동 진화 제안 (7단계)
- `/review-me` (범용): 개발 성향/AI 협업 패턴/강점/개선점 분석

**Scheduled Tasks → node-cron 통합 시도 → 다시 Scheduled Task로 회귀 (Issue #77, #91)**
- 처음: Claude Code Scheduled Tasks 2개 (daily-dev-review, daily-work-summary)
- 1차 전환: node-cron 통합 시도 → 로컬 DB ↔ 운영 DB 불일치로 파이프라인 끊김
- 최종: Scheduled Task `nightly-dev-report` 1개로 통합 (Opus 분석 + Slack 예약 메시지)
  - 밤 22시 실행 → 다음 날 09:25 작업 요약 / 09:30 개발 성향 Slack 예약 전송
  - 서버 dev-cron.ts 전체 삭제 (251줄), dev_analyses 테이블 DROP
  - 교훈: 로컬 Scheduled Task ↔ 원격 서버 DB 간 데이터 공유는 구조적 문제. Slack 예약 메시지로 우회.

**~~GitHub Actions (2개 워크플로우)~~ → 삭제됨**
- ~~PR 코드 리뷰: PR 열릴 때 자동 AI 리뷰 + 컨벤션 괴리 감지~~
- ~~머지 후 리팩토링: 머지 시 리팩토링 필요성 분석 → 자동 이슈 생성~~
- 존재하지 않는 `anthropics/anthropic-ai-action` 참조로 처음부터 미작동.
- `/review-code` 스킬로 로컬 리뷰 + 리팩토링 후 PR하는 방식이 1인+AI 워크플로우에 더 적합하여 삭제.

**MCP 서버 (2개)**
- PostgreSQL: 개발 중 DB 직접 조회/분석
- Slack: 채널 메시지 읽기/쓰기

### 설계 결정

1. **범용 vs 프로젝트 분리**: init-project, review-me, Hook(prettier+민감정보)은 범용(\~/.claude/). 나머지는 프로젝트 종속.
2. **스킬 간 파일 기반 연결**: init-project가 생성한 컨벤션/라벨 규칙을 start-feature/review-code가 참조.
3. **컨벤션 자동 진화**: 코드 리뷰 시 실제 코드 패턴과 컨벤션 괴리 감지 → 업데이트 제안.
4. **리팩토링 안전장치**: 자동 코드 수정이 아닌 이슈 생성 → 사람 승인 후 작업.

---

## API 비용 최적화 전략

**날짜:** 2026-03-09

### 배경

v2에서 LLM을 Claude Sonnet으로 교체하면서 API 비용이 Gemini Flash 대비 크게 증가.
테스트 기간 동안 $5/일 소비 확인. 실사용 기준 월 $25\~30 추정.
향후 도메인 확장(일기/지출/명리학/크로스분석) 시 월 $45+ 예상.
비용 구조를 근본적으로 개선하지 않으면 도메인 추가할수록 비용이 선형 증가하는 문제.

### 비용 분석

| 구분 | 상세 |
|------|------|
| 모델 | Claude Sonnet — input $3/1M, output $15/1M |
| 시스템 프롬프트 | \~2,500 토큰 (매 요청마다 전송) |
| 요청당 평균 | input \~8K, output \~1.5K (도구 2\~3라운드) |
| 크론 LLM 사용 | 7개 중 2개만 (아침 인사 + 밤 마무리) |
| 대화 히스토리 | 10쌍 슬라이딩 윈도우 |

### 최적화 전략 (3-tier)

**Tier 1: 하이브리드 모델 (즉시 적용)**
- 크론 메시지 생성(아침/밤) → Gemini Flash로 분리
- 사용자 대화는 Claude Sonnet 유지 (품질 필수)
- 월 $2\~3 절약, 구현 난이도 낮음

**Tier 2: 시스템 프롬프트 최적화 (즉시 적용)**
- DB 스키마 축약 (타입/디폴트 생략, 컬럼명 중심)
- 예시 압축
- 커스텀 지시사항 상한선 (MAX 20개, 초과 시 auto 비활성화)
- 향후 도메인 확장 대비 프롬프트 모듈 분리 구조 설계

**Tier 3: 프리컴퓨팅 + 요약 캐싱 (도메인 확장 시)**
- 크론으로 일/주 단위 요약을 `daily_summaries` 테이블에 저장
- 크로스 분석 → 원본 데이터 대신 요약 테이블 조회
- 도구 루프 3\~5회 → 1\~2회로 감소
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

## 생활 맥락 인식 잔소리 시스템

**날짜:** 2026-03-09
**Issues:** #60 | **PRs:** #61

### 배경

잔소리꾼 컨셉에 충실하려면 매 대화에서 사용자의 현재 생활 상태를 파악하고 있어야 함.
수면 부족, 루틴 미달성, 일정 과다 등을 인지하고 자연스럽게 코멘트하는 기능이 필요.
API 비용 최적화 전략의 Tier 3(프리컴퓨팅)의 전 단계로, 실시간 SQL 집계 방식으로 구현.

### 설계 — 방식 B: 프롬프트 사전 로딩

3가지 접근법 비교 후 결정:
- A: LLM에게 매번 조회 지시 → 비용 높고 일관성 없음 (탈락)
- **B: SQL 사전 집계 → 시스템 프롬프트 주입 (채택)** → 추가 LLM 라운드 0, \~150토큰, \~$0.50/월
- C: daily_summaries 테이블 캐싱 → 도메인 확장 시로 유보

### 구현 내용

**`src/shared/life-context.ts`** — 생활 맥락 빌더
- `buildLifeContext(timing)` — 타이밍별(morning/night/conversation) 맥락 생성
- 수면: 어젯밤 시간, 7일 평균, 자정 이후 취침 패턴, 낮잠
- 루틴: 오늘/어제 달성률, 7일 평균
- 일정: 오늘/내일 건수, 미완료, 밀린 일정, 백로그
- 타이밍별 edge case 처리 (morning → 어제 루틴, 낮잠 생략 등)

**시스템 프롬프트 확장**
- 잔소리 가이드 섹션: 칭찬/걱정/격려/제안 규칙
- 데이터 없는 항목은 언급하지 않는 규칙

**크론 알림 연동**
- 아침/밤 알림에 생활 맥락 주입

### 코드 리뷰 + 리팩토링

구현 후 `/review-code` 스킬로 자체 코드 리뷰 수행:
- 🔴 dead code 발견: 미사용 `latePattern` 쿼리 (매 대화마다 불필요한 DB 쿼리 1회)
- 🟡 `querySleepContext` 80줄 → 4개 서브 함수로 분리
- 🟡 날짜 중복 계산 → `DateParams` 인터페이스로 파라미터화
- 308줄 → 265줄 (14% 감소)

같은 브랜치에서 리팩토링까지 완료 후 PR → 머지.

### 설계 결정 근거

1. **잔소리 빈도**: 매 대화마다 적극적으로 (과하면 나중에 프롬프트 조절)
2. **비용**: 150토큰 추가로 LLM 추가 호출 없이 맥락 제공
3. **Tier 3 연계**: 향후 도메인 확장 시 `daily_summaries` 캐싱으로 전환 가능
4. **워크플로우**: 기능 개발 → 코드 리뷰 → 리팩토링 → PR (같은 브랜치에서 완결)

---

## 루틴 메모 + 완료 시점 기록

**날짜:** 2026-03-10
**Issues:** #65

### 배경

루틴에 개인 코멘트를 남기고 싶은 니즈. 일정에는 메모 기능이 있지만 루틴에는 없었음.
또한 완료 버튼 클릭 시점이 기록되지 않아 "아침 루틴을 밤에 완료" 같은 패턴 분석 불가.

### 구현

- 마이그레이션 010: `memo TEXT`, `completed_at TIMESTAMPTZ` 컬럼 추가
- 완료 버튼 클릭 시 `completed_at = NOW()` 저장
- 자연어 메모: LLM이 SQL UPDATE로 처리 ("어제 코세척에 메모 추가해줘")
- 루틴 체크리스트에 메모 표시 (일정과 동일 패턴)

### 설계 결정

1. **자연어 기반**: 별도 UI 없이 대화로 메모 추가 — 프롬프트 규칙만 추가
2. **누적 append**: 수면 메모와 동일 패턴. 기존 메모에 줄바꿈 추가
3. **completed_at**: 향후 루틴 이행 시간대 패턴 분석용 데이터 축적

---

## 웹 대시보드 — 일정 캘린더

**날짜:** 2026-03-10
**Issues:** #73

### 배경

Slack 자연어 인터페이스는 일상 기록에는 편리하지만, 주간/월간 단위 일정 확인, 데이터 정리, 대량 조작에는 비효율적. 매번 LLM을 호출하면 비용도 증가. 노션 캘린더뷰를 대체할 모바일 친화적인 웹 대시보드가 필요.

### 기술 스택 선정

| 항목 | 선택 | 이유 |
|------|------|------|
| Framework | Next.js 15 (App Router) | SSR + API Routes 통합, React Server Components |
| CSS | Tailwind CSS v4 | 유틸리티 기반, 반응형 쉬움 |
| DB | pg (기존과 동일) | Next.js API Routes에서 직접 PostgreSQL 연결 |
| Auth | iron-session | 암호화 쿠키 세션 (아래 비교 참조) |
| 날짜 | date-fns | Tree-shakeable, 주/월 계산 편리 |
| 배포 | Docker (기존 VM) | docker-compose에 web 서비스 추가 |

의도적으로 제외: Zustand/Redux(Server Components + URL state 충분), React Query(Server Components 직접 DB 조회), Form 라이브러리(필드 5\~6개, native form 충분).

### 인증 라이브러리 비교 — 왜 iron-session인가

개인 프로젝트 단일 비밀번호 인증에 맞는 라이브러리를 비교 검토.

| 라이브러리 | 방식 | 장점 | 단점 |
|-----------|------|------|------|
| **iron-session** (채택) | @hapi/iron 암호화 쿠키 | 외부 저장소 불필요, 10줄 설정, Next.js App Router 지원 | 쿠키 크기 제한 (4KB) |
| jose (JWT) | JWT 토큰 쿠키 저장 | 표준 토큰 형식, 낮은 수준 제어 | 쿠키 핸들링 직접 구현 필요, 다중 서비스용이라 과함 |
| NextAuth (Auth.js) | OAuth/Credentials/JWT/DB | 다중 사용자 + 다중 Provider 지원 | 1인용 비밀번호에 프레임워크 전체 도입은 오버엔지니어링 |
| lucia-auth | DB 세션 기반 | 유저 관리(가입/로그인) 내장 | DB 세션 테이블 필요, 단일 비밀번호엔 과함 |
| 직접 구현 (crypto) | Node.js crypto + 쿠키 | 가장 가벼움 | 보안 코드 직접 작성 리스크 |

**선정 이유:**
1. `{ authenticated: true }` 하나만 저장하면 되는 규모에 딱 맞음
2. Redis/DB 세션 테이블 불필요 — 쿠키 하나로 완결
3. `@hapi/iron` 검증된 암호화 (Walmart Labs 출신, 수년간 운영 검증)
4. Next.js App Router middleware, Server Components, API Routes 전부 지원
5. 설정 10줄 + `getIronSession()` 호출만으로 세션 관리

### 아키텍처 설계

```
web/ (Next.js 앱, 별도 package.json)
├── src/
│   ├── app/           # App Router 페이지 + API Routes
│   ├── components/    # 캘린더, 일정, 백로그, UI 컴포넌트
│   └── lib/           # DB, 쿼리, 인증, KST 유틸
├── Dockerfile         # standalone 빌드
└── docker-compose.yml # web 서비스 추가
```

- **Slack 봇과 독립**: 같은 DB를 공유하되, 별도 Docker 컨테이너로 배포
- **타입 복제**: ScheduleRow 등 \~30줄 인터페이스를 web/src/lib/types.ts에 별도 정의 (모노레포 도구는 오버엔지니어링)
- **categories 테이블 신설**: schedules.category는 자유 텍스트 유지, categories 테이블은 색상/순서 메타데이터 관리

### DB 스키마 변경

```sql
-- 011_categories.sql
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT 'gray',      -- Tailwind 색상 키
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 구현 범위 (Phase 1)

1. 월간/주간/일간 캘린더 뷰 (모바일 반응형)
2. 일정 CRUD (생성/수정/삭제/상태변경)
3. 카테고리 CRUD (추가/수정/삭제, 색상 지정)
4. 백로그 관리 (날짜 미지정 → 날짜 지정으로 일정화)
5. 카테고리/상태 필터
6. PWA 매니페스트 (모바일 홈 화면 설치)
7. Docker 통합

### Phase 2: 인터랙션 강화 (2026-03-11)

Phase 1 기본 구현 후 실사용 피드백 기반으로 UX를 대폭 개선.

**드래그 앤 드롭 (@dnd-kit)**
- 일정 카드 드래그로 날짜 이동 (월간/주간뷰)
- 다일 일정 기간 조절: 좌/우 리사이즈 핸들 분리 (`resize-left`, `resize-right`)
- 시작일까지 드래그 시 단일 일정으로 자동 변환 (`end_date → null`)
- 다일 일정 이동 시 기간 유지 (duration 계산하여 양쪽 날짜 shift)
- 주 경계 넘는 일정의 리사이즈 핸들 조건부 표시 (`startsBeforeWeek`/`endsAfterWeek`)

**주간뷰 스패닝 바 → 카드 스타일 통일**
- WeekSpanBar를 ScheduleCard 풀 모드와 동일 구조로 재작성
- 체크박스, 상태 배지, 카테고리 배지 포함
- DroppableDay ID 충돌 버그 해결 (모바일/데스크탑 동일 ID로 @dnd-kit 충돌)

**일정 정렬 시스템**
- 상태순 정렬: 진행중 → 할일 → 완료 → 취소
- SQL 레벨 + 클라이언트 레벨 이중 적용 (`compareByStatus` 유틸리티)
- 모든 뷰(월/주/일/DayDetailPanel)에 일관 적용

**모바일 최적화**
- 주간뷰 모바일 레이아웃: 날짜 옆 카드 배치, 건수 표시 개선
- `viewport-fit: cover` + `safe-area-inset-bottom` (Safari 홈 바 대응)
- `min-h-dvh` (동적 뷰포트 높이), FAB/하단탭 safe area 패딩

**기타 UI 개선**
- 데스크탑 캘린더 뷰포트 높이 채우기 (flex chain)
- HSL 색상 피커에 카테고리 태그 미리보기 추가
- DayDetailPanel 전체 높이 + 하단 테두리
- 로그인 세션 버그 수정 (SESSION_SECRET 한글 14자 → hex 64자)

---

## 보안 체계 강화

**날짜:** 2026-03-11

### 배경

웹 대시보드 배포 과정에서 다수의 보안 이슈를 경험 (HTTP 쿠키 문제, 포트 노출, 환경변수 누락 등).
Public 저장소에 개인 라이프 데이터를 다루는 프로젝트 특성상, 코드 구조가 공개된 상태에서도 안전한 설계가 필수.
매 코드 변경마다 보안을 자동으로 점검하는 다층 방어 체계를 구축.

### 구현 — 4곳 다층 보안 지시사항

| 위치 | 역할 | 트리거 시점 |
|------|------|------------|
| **CLAUDE.md** | 최상위 보안 규칙 (CRITICAL) | 모든 작업 시 자동 로드 |
| **conventions.md** | 보안 체크리스트 (시크릿/API/인프라/의존성) | 코드 작성·리뷰 시 기준 |
| **review-code** | 2단계 보안 감사 (최우선, 6→7단계 확장) | `/review-code` 실행 시 |
| **start-feature** | 설계 시 보안 영향도 분석 + 커밋 전 점검 | `/start-feature` 실행 시 |

### 점검 항목

**인프라/배포**: 노출 포트, 환경변수 전달, 인증/세션 설정, HTTPS, CORS/보안 헤더, DB 접근
**API/웹**: 라우트 인증, 입력 검증, SQL 인젝션 방지, 에러 응답 내부 정보 노출
**시크릿**: 코드/커밋 민감정보 유입, .env.example 동기화, docker-compose 환경변수
**의존성**: 패키지 취약점 확인 (yarn audit)

### 핵심 규칙

- 보안 이슈는 무조건 🔴 (필수 수정) — "나중에 고치자" 불가
- 새 API 엔드포인트 추가 시 인증 없는 상태로 커밋 금지
- 의심스러운 보안 설정 발견 시 작업 중단 → 사용자 알림

---

## 웹 대시보드 배포 + 보안 수정

**날짜:** 2026-03-11

### 배포 인프라

- Docker multi-stage build (Next.js standalone output)
- docker-compose에 web 서비스 추가 (포트 3000)
- Oracle Cloud VCN Security List + iptables 포트 개방

### 배포 중 발견·수정한 보안 이슈

| 이슈 | 원인 | 수정 |
|------|------|------|
| 로그인 세션 튕김 | `Secure` 쿠키가 HTTP에서 전송 안 됨 | `COOKIE_SECURE` 환경변수로 분리 |
| SESSION_SECRET 미전달 | docker-compose.yml에 env 누락 | `${SESSION_SECRET}` 추가 |
| Docker COPY 실패 | `web/public/` 빈 디렉토리 git 미추적 | `.gitkeep` 추가 |

### HTTPS 미적용 (현재 상태)

- IP 직접 접속이라 Let's Encrypt 인증서 발급 불가 (도메인 필요)
- 도메인 확보 후 Caddy/Nginx + Let's Encrypt 자동 HTTPS 적용 예정
- 현재 `COOKIE_SECURE=false`로 HTTP 운영 중

---

## HTTPS 도메인 배포 — Caddy 리버스 프록시

**날짜:** 2026-03-11
**Issues:** #81

### 배경

웹 대시보드가 IP:3000으로 HTTP 직접 노출되어 운영 중.
비밀번호/세션 쿠키가 평문 전송되는 보안 취약점. 도메인 + HTTPS 적용 필수.

### 리버스 프록시 비교 — 왜 Caddy인가

3가지 방식을 비교 검토:

| 항목 | Caddy | Nginx + Certbot | Nginx + Cloudflare |
|------|-------|-----------------|--------------------|
| **HTTPS 설정** | 자동 (도메인만 지정) | 수동 (certbot + cron 갱신 + reload) | Cloudflare에서 처리 |
| **인증서 갱신** | 자동 (내장) | certbot cron 별도 설정 | 자동 (Cloudflare) |
| **설정 복잡도** | 3\~10줄 | 30\~50줄 | nginx + Cloudflare 대시보드 |
| **Docker 통합** | 이미지 1개 | nginx + certbot 2개 | nginx + DNS 이전 |
| **HTTP/3** | 기본 지원 | 별도 컴파일 필요 | Cloudflare에서 지원 |
| **적합한 규모** | 소\~중규모, 개인 프로젝트 | 대규모, 세밀한 제어 | CDN 필요한 프로젝트 |

**선정 이유:**
1. HTTPS 인증서 자동 발급/갱신 — certbot cron 관리 불필요
2. 설정 3줄이면 끝 — nginx 30줄+ 대비 압도적으로 간단
3. Docker 이미지 하나 — nginx + certbot 조합 대비 단순
4. HTTP/3 기본 지원
5. 개인 프로젝트에 nginx의 세밀한 제어는 불필요

### 아키텍처 변경

```
변경 전:  외부 → :3000 (HTTP) → web 컨테이너
변경 후:  외부 → :443 (HTTPS) → Caddy → web:3000 (내부)
                 :80 → 301 → :443
```

### 보안 개선

- HTTP → HTTPS 전환 (Let's Encrypt 자동 인증서)
- 보안 헤더 추가 (HSTS, X-Frame-Options, X-Content-Type-Options)
- 포트 3000 외부 노출 제거 (Caddy 경유만 허용)
- `COOKIE_SECURE=true` 전환 가능
- 도메인명은 환경변수로 관리 (퍼블릭 레포 보안)

---

## 웹 대시보드 컨벤션 정립 + 확장성 리팩토링

**날짜:** 2026-03-11
**Issues:** #87

### 배경

웹 대시보드에 루틴, 수면, 식단, 명리학, 일기 등 다수의 도메인이 추가될 예정.
현재 일정 중심의 평면적 디렉토리 구조(`components/calendar/`, `components/schedule/`)에서
도메인별 feature 폴더 구조로 전환하여 확장성 확보.

### 디렉토리 구조 변경

```
변경 전:  components/{calendar,schedule}/ + hooks/ + lib/queries.ts
변경 후:  features/schedule/{components,hooks,lib}/
```

- **새 도메인 추가 = `features/` 안에 폴더 하나 생성** (기존 코드 수정 최소)
- 도메인 전용 컴포넌트, 훅, 유틸, 타입이 한 폴더에 자기 완결적으로 존재
- 공통 UI(modal, bottom-sheet, filter-bar)는 `components/`에 유지
- 공통 유틸(db, auth, kst)은 `lib/`에 유지

### 컴포넌트 분리

- `month-view.tsx` (324줄) → `month-view.tsx` (265줄) + `day-detail-panel.tsx` (68줄)

### 컨벤션 확장 (conventions.md)

- 디렉토리 구조 규칙
- 데이터 페칭 패턴 (도메인 훅 캡슐화)
- API 라우트 패턴 (도메인별 동일 구조)
- 타입 분리 규칙 (도메인 전용 vs 공통)

---

## 수면 기록 date 판단 오류 수정

**날짜:** 2026-03-12
**Issues:** #89

### 배경

아침에 "어제 저녁 7시에 자고 아침 8시 30분에 일어났어"라고 수면 기록하면 LLM이 date=어제(취침일)로 설정하는 버그.
date 필드는 기상일이므로 date=오늘이 정답. 이로 인해 앱 홈에 수면 미표시 + 아침 크론이 불필요한 수면 기록 알림 발송.

### 원인 분석

프롬프트의 "어제 잤어" 해석 규칙이 새벽 취침(02:00, 00:00, 23:00)만 예시로 있고,
저녁 취침(19:00) 패턴이 없었음. 또한 "어제"가 수면 대화에서 두 가지 의미로 쓰이는데 구분 규칙이 없었음.

### 해결 — "어제"의 두 가지 의미 구분 규칙

| 패턴 | "어제" 의미 | date |
|------|-----------|------|
| "어제 \~시에 잤어" (수면 행위) | 취침 시점 | 오늘(기상일) |
| "어제 수면 기록 해줘" (데이터) | 날짜 자체 | 어제 |

### 설계 결정

1. **프롬프트만 수정**: DB/코드 변경 없이 프롬프트 규칙 개선으로 해결. 스키마 변경(TIMESTAMPTZ)은 현 규모에 오버엔지니어링.
2. **7가지 시나리오 검증**: 자정 전/새벽/저녁 취침, 뒤늦은 기록, 전날 기록 추가, 특정 날짜 기록, 낮잠 — 모두 커버.
3. **대화 맥락 유지**: "어제 수면 기록 빠져있나?" → "기록해줘" 멀티턴에서 chat history(10쌍)가 날짜 맥락 유지.

---

## v3 아키텍처 전환 — Vercel + Neon

**날짜:** 2026-03-12
**Issues:** #94

### 배경

v2 인프라는 Oracle Cloud ARM VM에서 4개 Docker 서비스(app, db, web, caddy)를 운영.
웹 대시보드 빌드에 4분+, 전체 배포에 8\~9분 소요. ARM VM 스펙 한계.
Vercel + Neon으로 전환하면 배포 자동화 + 빌드 최적화 + 인프라 단순화를 동시에 달성.

### v2 → v3 핵심 변경

| 항목 | v2 | v3 |
|------|----|----|
| **웹 대시보드** | Docker (ARM VM, 4분+ 빌드) | Vercel (자동 배포, CDN, \~1분) |
| **데이터베이스** | PostgreSQL Docker (VM 내부) | Neon (managed PostgreSQL, serverless) |
| **Slack 봇** | Docker (VM) | Docker (VM) — 변경 없음 |
| **리버스 프록시** | Caddy (Docker) | 불필요 (Vercel HTTPS 기본) |
| **Docker 서비스** | 4개 (app, db, web, caddy) | 1개 (app) |
| **배포 시간** | 8\~9분 | 봇 30초 + 웹 자동 |

### v3 아키텍처

```
[Slack] ──메시지──→ [Oracle VM: Node.js 서버 (Docker)]
                        │
                        ▼
                  [Claude Sonnet API]
                   (tool use 내장)
                        │
                   ┌────┴────┐
                   ▼         ▼
              [Neon DB]    [외부 API]
              (managed     (명리학: Gemini)
               PostgreSQL)
                   ↑
              [Vercel]
              (Next.js 웹 대시보드)
```

### DB 연결 전략

- **Vercel (웹)**: Neon pooled endpoint (`-pooler.neon.tech`) — 서버리스 함수별 커넥션 풀링
- **Oracle VM (봇)**: Neon direct endpoint — 장기 실행 프로세스, 안정적 TCP

### 제거 대상

- `web/Dockerfile` — Vercel 빌드로 대체
- `Caddyfile` — Vercel HTTPS로 대체
- docker-compose: `db`, `web`, `caddy` 서비스 및 관련 volumes
- 환경변수: `DOMAIN` (Vercel 도메인 사용)

### 보안 개선

- Neon: SSL 기본 적용
- Vercel: HTTPS + 보안 헤더 자동
- VM: HTTP 포트(80, 443) 더 이상 불필요 → 공격 표면 감소
- DB: 외부 포트 노출 없음 (Neon 관리형)

### 설계 결정

1. **`pg` 모듈 유지**: `@neondatabase/serverless` 대신 기존 `pg` 유지. Node.js runtime에서 충분하며 코드 변경 최소화.
2. **standalone 빌드 제거**: Vercel은 자체 빌드 시스템 사용. `output: 'standalone'`과 `web/Dockerfile` 불필요.
3. **Neon 무료 티어**: 0.5 GiB storage, 190h compute/월 — 현재 개인 프로젝트 규모에 충분.

---

## 프로액티브 인사이트 시스템

**날짜:** 2026-03-12
**Issues:** #105

### 배경

프로젝트의 최대 강점은 LLM이 DB 전체에 자유 접근 가능한 구조인데, 현재는 사용자가 먼저 물어봐야만 인사이트를 받을 수 있는 구조. 데이터가 쌓여도 사용자가 질문하지 않으면 활용되지 않음.

### 생성 방식 — 하이브리드

| 채널 | 방식 | 이유 |
|------|------|------|
| 매일 넛지 (아침/밤) | Pure SQL + 코드 템플릿 | 비용 0, 빠르고 예측 가능 |
| 주간 리포트 (일요일) | SQL 집계 + Gemini Flash | 자연어 총평 필요, 주 1회라 비용 미미 |
| 자연어 요청 | Claude Sonnet (기존) | 프롬프트 가이드만 추가 |

### 구현 — 4개 커밋

**커밋 1: 인사이트 감지 엔진 (TDD)**
- `src/shared/insights.ts` — 5가지 패턴 감지 (streak, sleepTrend, slotGap, weekComparison, overdueAlert)
- 우선순위 기반 넛지 선택 (타이밍 필터 → 정렬 → 최상위 1개)
- 28개 단위 테스트 (TDD: 테스트 먼저 → 구현)

**커밋 2: 크론 넛지 연동**
- morningTask/nightTask에 `pickMorningNudge`/`pickNightNudge` 호출 추가
- 넛지 없으면 기존 동작 유지 (null → 스킵)

**커밋 3: 주간 리포트 (부분 TDD)**
- `src/cron/weekly-report.ts` — 수면/루틴/일정/상관관계 4섹션 SQL 집계 + Gemini Flash 총평
- 일요일만 실행 (`getKSTDayOfWeek() !== 0` early return)
- 12개 집계 로직 테스트 (부분 TDD: 집계 테스트 먼저, Block Kit 코드 먼저)

**커밋 4: 자연어 분석 가이드**
- 시스템 프롬프트에 분석 키워드 감지 + 크로스 분석 SQL 3패턴 + 해석 규칙 추가

### 개발 방법론 — 하이브리드 TDD

| 커밋 | 방식 | 이유 |
|------|------|------|
| 커밋 1 (인사이트 엔진) | **TDD** — 테스트 먼저 | 감지 임계값, 우선순위 정렬이 핵심. 순수 로직이라 TDD에 최적 |
| 커밋 2 (크론 연동) | 코드 먼저 | 기존 크론에 호출 추가. 통합 성격 |
| 커밋 3 (주간 리포트) | **부분 TDD** — 집계 테스트 먼저 | SQL 집계 정확성 중요, Block Kit은 시각적 확인이 효율적 |
| 커밋 4 (프롬프트) | 테스트 없음 | 프롬프트 텍스트 추가만 |

### 코드 리뷰 결과

- 🔴 순환 import (blocks.ts ↔ weekly-report.ts) → buildWeeklyReportBlocks를 weekly-report.ts로 이동하여 해소
- 🔴 중복 함수 (fmtDur + formatDuration) → 하나로 통합
- 🟡 파일 크기 (blocks.ts 740줄, weekly-report.ts 382줄) → 별도 리팩토링 이슈로 분리

---

## 웹 대시보드 멀티유저 개편

**날짜:** 2026-03-13
**Issues:** #114

### 배경

지인에게 대시보드 일정관리 기능을 공유하기 위해 멀티유저 지원 필요.
현재 단일 비밀번호 + user_id 없는 DB 구조를 카카오 OAuth + 유저별 데이터 격리로 개편.

### 설계 결정

1. **카카오 OAuth**: 소셜 로그인으로 가입 편의성 확보. NextAuth는 단일 provider에 과함 → iron-session + 직접 OAuth
2. **개인앱 우선**: 비즈앱 전환 없이 kakao_id + nickname만 필수 수집. 이메일/성별 등은 nullable 컬럼으로 대비
3. **가입 10명 제한**: Neon 무료 티어(0.5GiB) + Vercel 무료 함수 호출 고려. 코드 상수로 제한
4. **Phase 분리**: Phase 1(웹 멀티유저) → Phase 2(Slack 봇 멀티유저). 봇은 임시로 user_id=1 하드코딩
5. **데이터 격리**: user_id FK + API 레벨 WHERE 필터링. DB RLS는 Phase 2에서 검토
6. **세션 30일 유지**: 로그아웃하지 않는 한 재로그인 불필요

### 구현 범위 (Phase 1)

- users 테이블 + slack_user_mappings 테이블 신설
- 전 테이블 user_id FK 추가 + UNIQUE 제약 변경 + 기존 데이터 마이그레이션
- 카카오 OAuth 로그인 (인가 → 콜백 → 세션)
- 웹 API/쿼리/캐시 전부 userId 기반 전환
- 기존 비밀번호 로그인 제거

---

## #insight 채널 — 명리학 일운 분석 + 일기/고민 기록

**날짜:** 2026-03-14
**Issues:** #116

### 배경

삶의 데이터를 AI로 분석하는 프로젝트의 핵심 확장. 명리학(사주) 기반 일운 분석과 일기/고민 기록을 하나의 Slack 채널(#insight)에서 통합 관리. 장기적으로 일기 데이터가 일운 분석의 정확도를 높이는 피드백 루프 구축이 목표.

### 설계 결정

1. **채널 통합**: 일운 분석 + 일기 + 고민을 #insight 하나에서 관리. 명리학 일운이 삶의 기록과 자연스럽게 연결되도록.
2. **Opus 주간 batch**: 비용 최적화. 7일치 일운을 주 1회 Opus로 분석, DB에 저장. 초기에는 Scheduled Task(Max Plan) 활용 → 서버 크론 전환 예정.
3. **자평명리 + 적천수 + 현대 해석**: 일간 중심 십신 분석(자평) + 격국/체용(적천수) + 현대 사회 맥락. 원국의 격국/용신은 초기 Opus 분석 후 DB에 확정 저장.
4. **일기 저장: LLM 정리 방식**: Sonnet이 대화 중 일기/고민/감정/이벤트를 감지 → 정리해서 diary\_entries에 저장. 명령은 저장 안 함.
5. **패턴 반영: 월간 회고**: 일기 데이터가 일운 분석에 즉시 반영되지 않음. 월 1회 Opus가 패턴 분석 → life\_themes에 저장 → 유의미한 패턴만 다음 분석에 반영.
6. **만세력 데이터**: LLM 계산 대신 외부 데이터 사전 제공 (정확도 보장).

### 구현 범위

- Phase 1: 명리학 일운 분석 (saju\_profiles + fortune\_analyses + Scheduled Task + 크론 알림)
- Phase 2: 일기/고민 기록 (diary\_entries + life\_themes + insight 에이전트)
- Phase 3 (향후): 월간 회고, 일기→일운 패턴 반영, 서버 크론 전환

---

## 사주 패턴 분석 시스템 — 일기↔일운 상관 패턴 감지/반영

**날짜:** 2026-03-14
**Issues:** #120

### 배경

insight 채널의 핵심 목표: 일기 데이터와 일운 분석을 비교하여, 내 사주에서 유의미한 구조적 반응 패턴을 감지하고 다음 일운 분석에 반영하는 피드백 루프. life\_themes(상황적 맥락)와 구분되는 사주 고유 패턴을 별도 테이블로 관리.

### 설계 결정

1. **life\_themes와 분리**: life\_themes = 상황적 맥락(이직 준비 등), saju\_patterns = 사주 구조적 반응(편재 올 때 일을 벌임 등). 용도와 수명 주기가 다르므로 별도 테이블.
2. **월 1회 Opus batch**: 주간 일운 batch와 별도로, 월 1회 Opus가 지난달 일기+일운을 비교 분석. 1주 데이터로는 패턴 판단이 어렵고, 분기는 갱신이 느려서 월간이 적절.
3. **2회 반복 활성화**: 1회 감지는 우연일 수 있으므로 저장만 하고 비활성 상태. 2회 이상 반복 시 활성화하여 일운 분석에 반영.
4. **3개월 비활성화**: 활성 후에도 3개월간 미출현 시 비활성화. 패턴이 사라질 수도 있으므로.
5. **프롬프트 주입 방식**: 주간 일운 분석(weekly-fortune) 시 활성 패턴을 프롬프트에 주입. Opus가 해당 날의 간지와 패턴 trigger를 대조하여 자연스럽게 해석에 반영.
6. **패턴 요소 범위**: 오행 수준이 아닌, 십신/특정 글자/합형충/십이운성 수준의 디테일. 원국의 격국/용신/기신을 고려한 맥락적 분석.

### 구현 범위

- `saju_patterns` 테이블 (마이그레이션 021)
- Scheduled Task: `monthly-saju-review` (매월 1일 22:00, 패턴 감지/업데이트)
- `weekly-fortune` Task 수정: 활성 패턴 조회 + 분석 프롬프트 주입
- insight 에이전트 프롬프트: 패턴 로딩 + 조회/관리 규칙

---

## 대시보드 UX 개선 — 카테고리 태그, 주간뷰 여백, 메모, 액션 메뉴

**날짜:** 2026-03-14
**Issues:** #126 | **PRs:** #127

### 배경

실사용 피드백 기반 UX 개선 4건. 카테고리 선택이 `<select>` 드롭다운이라 한눈에 파악 불가, 주간뷰 기간일정 없는 날에도 불필요한 빈 공간, 메모 입력칸 너무 좁음, 기간일정 액션 메뉴가 카드 밖에서 잘림.

### 구현

1. **카테고리 태그 버튼**: `<select>` → 색상 배경 태그 버튼 (8개까지, 초과분 select). outline으로 선택 표시.
2. **주간뷰 요일별 스페이서**: `laneCountPerDay` 이진 로직 — 기간일정이 지나는 열만 전체 laneCount 높이, 없는 열은 0. 단일 일정 컨테이너 z-[20]로 span bar 위에 표시.
3. **메모 높이 통일**: 읽기전용 모드 제거, 항상 textarea(rows=5, md:min-h-180px). 모달 max-h-[90vh] + 스크롤.
4. **액션 메뉴 수정**: WeekSpanBar overflow-hidden → overflow-visible.

### 설계 결정

1. **이진 스페이서**: 처음에는 요일별 정확한 레인 수를 계산했으나, 같은 주 내 날짜들의 높이가 불일치하여 이벤트가 "공중 부양"하는 문제 발생. 이진 방식(있으면 전체, 없으면 0)이 시각적으로 자연스럽고 사용자 피드백에도 부합.
2. **z-index 계층**: span bar(z-10) < 단일 일정 컨테이너(z-20) < ActionMenu dropdown(z-50). CSS stacking context 문제를 컨테이너 레벨에서 해결.
3. **outline vs ring**: Tailwind ring은 CSS 변수 기반이라 inline style과 호환 불가. outline + outlineOffset으로 대체.

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-05 | 프로젝트 시작, Phase 0\~1 완료 (초기 세팅, Slack/LLM/MCP 연결) |
| 2026-03-06 | Phase 2\~4 완료 (일정/크론/루틴 에이전트, Docker 배포) |
| 2026-03-07 | Phase 5 속도 최적화, 의도 분류 진화, 안정성 개선 |
| 2026-03-08 | 카테고리 그룹핑 + v1 아키텍처 회고 + v2 설계 결정 |
| 2026-03-08 | v2 인프라 개선 (KST 수정, App Home, 프롬프트 강화) |
| 2026-03-08 | 스마트 메모리 시스템 설계 (오픈클로 연구 기반, Issue #51) |
| 2026-03-09 | AI 개발 워크플로우 자동화 (Hooks, Skills, Scheduled Tasks, GitHub Actions, MCP) |
| 2026-03-09 | API 비용 최적화 전략 수립 (하이브리드 모델 + 프롬프트 최적화 + 프리컴퓨팅 설계) |
| 2026-03-09 | 생활 맥락 인식 잔소리 시스템 (SQL 사전 집계 → 프롬프트 주입, Issue #60, PR #61) |
| 2026-03-10 | 루틴 메모 + 완료 시점 기록 (자연어 메모, completed_at 축적, Issue #65) |
| 2026-03-10 | 백로그/내일일정 fast path 추가 (LLM 없이 Block Kit 즉시 응답, Issue #68, PR #69) |
| 2026-03-10 | 웹 대시보드 Phase 1 — 캘린더 뷰, 일정/카테고리 CRUD, 백로그, PWA (Issue #73) |
| 2026-03-11 | 웹 대시보드 Phase 2 — DnD, 상태 정렬, 모바일 safe area, 로그인 버그 수정 (Issue #73) |
| 2026-03-11 | 웹 대시보드 배포 (Docker + Oracle Cloud VM, 포트 3000) + 배포 보안 이슈 수정 |
| 2026-03-11 | 보안 체계 강화 — CLAUDE.md/conventions/스킬 4곳 다층 보안 지시사항 구축 |
| 2026-03-11 | Scheduled Tasks → node-cron 통합 (GitHub API + LLM + Slack, Issue #77) |
| 2026-03-11 | HTTPS 도메인 배포 — Caddy 리버스 프록시 + 서브도메인 (Issue #81) |
| 2026-03-11 | 웹 대시보드 컨벤션 정립 + 확장성 리팩토링 — features/ 도메인 폴더 구조 전환 (Issue #87) |
| 2026-03-12 | 수면 기록 date 판단 오류 수정 — "어제"의 두 가지 의미 구분 규칙 추가 (Issue #89) |
| 2026-03-12 | **v3 아키텍처 전환** — Vercel + Neon(→이후 VM PG로 마이그레이션), Docker 4→1 서비스, 배포 자동화 (Issue #94) |
| 2026-03-12 | Next.js 캐싱 적용 — unstable_cache + revalidateTag (Issue #99) |
| 2026-03-12 | 핵심 로직 테스트 커버리지 추가 — 166개 테스트 (Issue #101) |
| 2026-03-12 | CI/CD Slack 알림 — GitHub Actions 배포 결과 자동 전송 (Issue #97) |
| 2026-03-12 | 대시보드 UX 개선 — 색상 프리셋 파스텔 전환, 카테고리 정렬, Optimistic UI, 스켈레톤 (Issue #103, PR #104) |
| 2026-03-13 | 대시보드 UX 개선 — 중요 일정 토글, 정렬 우선순위 개선, iOS Safari 수정 (Issue #110, PR #111) |
| 2026-03-13 | 카테고리 유형 시스템 — 할일(task) vs 일정(event) 분리, 체크박스/상태 조건부 렌더링 (Issue #112, PR #113) |
| 2026-03-13 | **멀티유저 개편 시작** — 카카오 OAuth + 유저별 데이터 격리 설계 (Issue #114) |
| 2026-03-14 | **#insight 채널 설계** — 명리학 일운 분석(Opus 주간 batch) + 일기/고민 기록 통합 (Issue #116) |
| 2026-03-14 | **사주 패턴 분석 시스템** — 일기↔일운 상관 패턴 감지, 월간 Opus batch, 일운에 패턴 반영 (Issue #120) |
| 2026-03-14 | **만세력 계산 유틸리티** — LLM 계산 오류 해결, 일주/월주/년주/십성/십이운성/합충을 코드로 정확 계산, 범용 설계(개인 데이터 미포함) (Issue #122) |
| 2026-03-14 | **크론 메시지 전면 개선** — Gemini→Sonnet 전환, 연속 취침 패턴 버그 수정, 일기/테마/운세 데이터 통합, 아침/밤 프롬프트 분리(시제 가이드), insights 넛지 제거 (Issue #124, PR #125) |
| 2026-03-14 | **대시보드 UX 개선** — 카테고리 태그 버튼, 주간뷰 요일별 스페이서, 메모 높이 통일, 액션 메뉴 overflow 수정 (Issue #126, PR #127) |
| 2026-03-14 | **Slack 일정 표시 전면 수정** — 메모 제거(웹 대시보드로 이관), event 타입 📅 분리(상단 배치, 중요/삭제만), 약속 하드코딩→category\_type 일반화, LLM 달성률에서 event 제외 (Issue #132, PR #133) |
| 2026-03-15 | **Insight 에이전트 명리학 오류 방지** — Sonnet 프롬프트에 오행/십성/편정 기초 지식 보강, fortune\_analyses 참조 기반 응답 규칙 추가 |
| 2026-03-15 | **Opus 일운/월운 분석 품질 개선** — 지장간 데이터 + 암합 탐지 코드 추가, 내일 일운 fast path, SKILL.md에 명리학 기초 참조 테이블/절기 강조/편인정인 구분/합충형해 전체 표시/월운 사전생성/자가점검 추가 (Issue #134) |
| 2026-03-15 | **루틴 created\_at 기준 달성률 분기 처리** — 신규 루틴이 주간 리포트에서 0% 표시되는 문제 수정. best/worst는 주 시작일 이전 루틴만, 집계는 생성일 이후만 카운트 (Issue #138, PR #139) |
| 2026-03-22 | **하위 카테고리(서브카테고리) 기능** — categories.parent\_id 자기 참조 FK, schedules.subcategory 컬럼 추가, 카테고리 관리 아코디언 UI, 일정 폼 하위 선택 UX, 카드 뱃지 표시, 필터 상위만 (Issue #146, PR #147) |
| 2026-04-03 | **루틴 관리 대시보드** — 웹 대시보드에 `/routines` 페이지 추가. 루틴 CRUD + 일별 체크리스트 + 달성률 시각화(주간 바차트 + 월간 히트맵). 루틴 일시정지/비활성화 기능. SVG 직접 구현(외부 차트 라이브러리 미사용) (Issue #150, PR #151) |
| 2026-04-06 | **DB 마이그레이션: Neon → VM PostgreSQL** — Neon 무료 한도 초과로 DB 전면 차단 발생. Oracle VM에 PostgreSQL Docker 컨테이너로 마이그레이션. Vercel/봇 모두 VM DB 직접 연결로 전환 |
| 2026-04-07 | **대시보드 디자인 시스템 구축** — TopTabs/PillTabs/Button/Input/Select/Card/Skeleton 공통 컴포넌트 7개 추출. 일정·루틴·지출 3개 도메인 통일 적용. 스켈레톤 로딩 UX 개선(border 밀착 문제), blue-500→blue-600 primary 색상 통일. ViewToggle 컴포넌트 삭제(TopTabs로 대체) (Issue #175, PR #176) |
| 2026-04-10 | **SQL 도구 user_id 동적 격리** — \`user_id = 1\` 하드코딩을 제거하고 Slack 진입점·크론·에이전트 루프 전 경로를 userId 파라미터화. \`user-resolver\`로 \`slack_user_mappings\` 기반 해석, 미등록 시 DEFAULT_USER_ID 폴백 + warn 로그. 진입점 4곳 폴백 정책 통일 (Issue #236, PR #237) |
