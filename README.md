# Slack AI Agent — 개인 라이프 데이터 에이전트

> 자연어로 쌓은 일상 데이터를 AI가 자유롭게 분석하고, 알아서 인사이트를 건네는 나만의 에이전트.

![자연어 대화로 일정 등록 + 잔소리](docs/images/01-conversation.png)

## 목차

- [왜 만들었나](#왜-만들었나)
- [기술적 하이라이트](#기술적-하이라이트)
- [어떻게 동작하나](#어떻게-동작하나)
- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [설계 노트](#설계-노트)
- [AI 협업 시스템](#ai-협업-시스템--claude-code-전체-기능-활용)
- [메타인지 — Developer Profile](#메타인지--developer-profile)
- [개발 히스토리](#개발-히스토리)
- [프로젝트 구조](#프로젝트-구조)
- [실행 방법](#실행-방법)
- [관련 문서](#관련-문서)

---

<br>

## 왜 만들었나

사업을 하면서 해야 할 일이 쏟아졌다. 머릿속에 떠오르는 일정을 카카오톡 나와의 채팅에 적어두고, 시간을 잡아 노션에 하나하나 정리하곤 했는데 — 그 정리 작업 자체가 또 하나의 일이 되었다. 기록이 누락되거나 애매해서 놓치는 일이 생겼다.

**"말만 하면 알아서 기록해주는 게 있으면 좋겠다."**

그래서 자연어로 편하게 말하면 DB에 바로 저장해주는 일정 관리를 먼저 만들었다. 쓰다 보니 매일 반복하는 일들은 루틴으로 빼서 따로 관리하면 좋겠다는 생각이 들었고, 매일 수면 기록을 적는 것도 사실 루틴 중 하나였는데 이것도 함께 저장하면 좋을 것 같아서 수면 기록을 추가했다.

그러다 깨달은 건 — **데이터가 쌓이기 시작하면 진짜 가치는 기록이 아니라 인사이트에 있다는 것**이었다. 나는 주기적으로 일상을 돌아보고 개선하려는 습관이 있었는데, 이 모든 데이터가 한 DB에 있으니 AI가 자유롭게 크로스 분석해서 패턴을 찾아줄 수 있었다. "잠을 잘 잔 날 루틴 달성률이 높은지", "어떤 요일에 일정이 몰리는지" — 내가 물어보면 AI가 SQL로 직접 분석하고, 물어보지 않아도 시스템이 알아서 패턴을 감지해 인사이트를 건넨다.

**일정 기록 도구에서 시작해, 데이터가 쌓일수록 인사이트가 풍부해지는 AI 에이전트로 진화했다.**

---

<br>

## 기술적 하이라이트

> LLM을 프로덕션에 적용하면서 마주한 비용, 정확도, 아키텍처 문제를 실제로 풀어간 과정이다.

- **LLM Agent Loop** — LLM이 SQL 도구 호출·분석·반복을 자율 판단. 테이블만 추가하면 새 도메인 즉시 분석.
- **LLM + Pure SQL 2-tier 비용 최적화** — Claude Sonnet(대화/크론/주간 리포트) + Pure SQL(넛지). LLM 호출이 불필요한 패턴은 SQL로 직접 처리.
- **아키텍처 3회 전환** — 운영 중 한계 인식 → 코어 교체. [전체 의사결정 과정](docs/project-history.md) 문서화.
- **프롬프트 엔지니어링** — LLM 반복 실수 분석→규칙화. 의도 분류 3단계 진화→최종 삭제.
- **Claude Code 풀스택 활용** — Hooks(3) + Skills(4) + MCP(2) + Scheduled Tasks로 개발 파이프라인 자동화.
- **UX 중심 의사결정** — 직접 사용하며 개선. 속도 불만→fast path, 체크리스트 밀림→App Home 도입.
- **1인 풀스택** — Slack 에이전트 + Next.js 대시보드(DnD, PWA) + Docker/VM + Vercel + Neon.
- **개인 프로젝트에 팀 수준 품질 관리** — 245개 테스트(인사이트 엔진 TDD), GitHub Actions CI/CD, Public 저장소 4곳 보안 방어.

---

<br>

## 어떻게 동작하나

<p align="center">
  <img src="docs/images/architecture.svg" alt="아키텍처" width="100%" />
</p>

핵심은 **LLM이 DB 전체에 자유 접근**할 수 있는 구조다. Claude Sonnet이 SQL을 직접 작성·분석·반복 실행하며(Agent Loop), 도구를 쓸지, 몇 번 호출할지 모두 자율 판단한다. 테이블만 추가하면 별도 코드 없이 크로스 분석이 가능하다.

### 아키텍처 전환 — v1 → v2 → v3

운영하면서 한계에 부딪힐 때마다, 임시방편이 아닌 코어를 교체하는 방식으로 전환했다.

| | v1 | v2 | v3 |
|---|---|---|---|
| **데이터** | Notion (JOIN 불가) | PostgreSQL (SQL 크로스 분석) | Neon managed (동일) |
| **모델** | Gemini Flash (추론 약함) | Claude Sonnet (추론형) | 동일 |
| **에이전트** | 채널별 분리 | 통합 (LLM 자율 판단) | 동일 |
| **인프라** | Docker 1개 | Docker 4개 (app+db+web+caddy) | 역할 분리: VM(봇) + Vercel(웹) + Neon(DB) |
| **배포** | — | docker compose (8\~9분) | yarn deploy (2분) + GitHub push |

- **v1→v2**: Notion은 테이블 간 JOIN이 안 돼서 크로스 분석이 불가능. 코어(데이터층 + 모델 + 에이전트 구조)를 통째로 교체.
- **v2→v3**: 웹 대시보드 추가로 Docker 서비스가 4개로 팽창. DB와 웹을 managed 서비스(Neon, Vercel)로 분리해 VM은 봇만 담당.

---

<br>

## 주요 기능

### Slack 에이전트 — 자연어로 모든 생활 데이터 관리

일정·루틴·수면을 자연어 대화만으로 기록·조회·수정. 하루 4회 크론 알림 + 프로액티브 인사이트(넛지) + 생활 맥락 기반 잔소리. 스마트 메모리로 사용자 선호를 자동 학습.

<p>
  <img src="docs/images/01-conversation.png" width="49%" />
  <img src="docs/images/03-routine-checklist.png" width="49%" />
</p>

### 프로액티브 인사이트 — 물어보지 않아도 패턴을 감지

5가지 SQL 패턴 감지(streak, sleepTrend, slotGap, weekComparison, overdueAlert) → 우선순위 기반 1개 선택 → 아침/밤 알림에 자동 삽입. LLM 호출 없이 Pure SQL로 동작. 주간 리포트와 자연어 분석은 Claude Sonnet이 담당.

### 웹 대시보드 — LLM 비용 절감과 UX 편의성을 하나의 설계로 해결

Slack 대화(LLM 호출) 없이 일정·루틴을 직접 관리할 수 있는 UI를 별도 제공해, API 비용 절감과 사용자 편의성을 동시에 확보했다. 캘린더·백로그·카테고리 뷰로 시각화하고, 드래그 앤 드롭(@dnd-kit)으로 일정 이동·리사이즈, 반응형 UI + PWA 지원.

<p>
  <img src="docs/images/m-calendar.jpg" width="24%" />
  <img src="docs/images/m-daily.jpg" width="24%" />
  <img src="docs/images/desktop-calendar.png" width="49%" />
</p>

### App Home — Slack 내 대시보드

오늘의 일정 + 루틴 + 수면 요약을 Slack App Home 탭에 영구 표시.

<p>
  <img src="docs/images/01-app-home.PNG" width="49%" />
  <img src="docs/images/app-home-dashboard.jpg" width="49%" />
</p>

---

<br>

## 기술 스택

| 영역       | 기술                                                             |
| ---------- | ---------------------------------------------------------------- |
| AI/LLM     | Claude Sonnet (Tool Use) — 대화, 크론 메시지, 주간 리포트 |
| AI 개발    | Claude Code (Hooks, Custom Skills, MCP, Scheduled Tasks)         |
| Backend    | Node.js + TypeScript (strict)                                    |
| Frontend   | Next.js 16 (App Router) + Tailwind CSS v4 + @dnd-kit             |
| Messaging  | Slack Bolt (Socket Mode)                                         |
| Database   | Neon (managed PostgreSQL)                                        |
| Auth       | iron-session (암호화 쿠키 세션)                                  |
| Scheduling | node-cron (timezone: Asia/Seoul)                                 |
| Bot Infra  | Docker + Oracle Cloud Free Tier ARM VM                           |
| Web Infra  | Vercel (자동 배포, HTTPS 내장)                                   |
| CI/CD      | GitHub Actions + Vercel + yarn deploy                            |
| Security   | 다층 보안 체계 (CLAUDE.md + 체크리스트 + Hooks + Skills)         |
| Test       | vitest (245개 테스트)                                            |

---

<br>

## 설계 노트

### 프롬프트 엔지니어링 — LLM 실수를 관찰하고 규칙으로 방지

LLM이 SQL을 직접 작성하다 보면 같은 유형의 실수를 반복한다. 이를 운영하면서 관찰하고, 패턴으로 분류한 뒤 프롬프트 규칙으로 구조화해 사전에 차단하는 접근을 취했다. 날짜/요일 추론 오류, 기간 일정 조회 누락 등 실수 유형별로 SQL 패턴을 강제하거나 참조 데이터를 시스템 프롬프트에 주입하는 방식이다.

### 의도 분류 시스템의 진화 — 가정 자체를 의심한 과정

1. **LLM 분류** — "잡담? 액션?" 매번 LLM에 질문. 느리고 부정확.
2. **키워드 분류** — 95% 즉시 판단. 하지만 "완료하고 잘거야"를 액션으로 오분류 → 모든 일정 완료 처리 사건 발생.
3. **분류 제거** — 분류 단계 자체를 삭제. LLM에게 도구 사용 여부를 직접 판단하게 위임. \~500줄 삭제.

> **교훈**: "분류"라는 별도 단계가 필요하다는 가정 자체가 틀렸다.

---

<br>

## AI 협업 시스템 — Claude Code 전체 기능 활용

AI를 도구이자 협업 개발자로 인식하고, GitHub Issues·PR 단위로 AI 작업을 리뷰·검증하는 프로세스를 운영한다. 설계 판단과 품질 기준은 사람이 결정하고, Claude Code의 Hooks, Custom Skills, MCP, Scheduled Tasks를 조합해 개발 프로세스 자체를 AI 파이프라인으로 구축했다.

### Hooks (3개) — 자동 품질 게이트

| 시점         | 동작                                          |
| ------------ | --------------------------------------------- |
| 파일 수정 후 | prettier + eslint --fix 자동 실행             |
| 커밋 전      | yarn lint + tsc 타입 체크                     |
| 커밋 전      | 민감정보 유출 스캔 (scripts/check-secrets.sh) |

### Custom Skills (4개) — 워크플로우 자동화

| 스킬             | 용도                                                    |
| ---------------- | ------------------------------------------------------- |
| `/init-project`  | 프로젝트 첫 세팅 (컨벤션, 브랜치 전략, CLAUDE.md 생성)  |
| `/start-feature` | 이슈 → 브랜치 → 설계 → 구현 → 코드 리뷰 → PR 전체 흐름 |
| `/review-code`   | 보안 감사(최우선) + 코드 리뷰 + 컨벤션 점검 (7단계)     |
| `/review-me`     | 개발 성향·의사결정 패턴 분석                             |

### 다층 보안 — Public 저장소 + 개인 데이터

CLAUDE.md(최상위 규칙) → conventions.md(체크리스트) → Hook(커밋 전 스캔) → Skill(리뷰 시 감사) — 4곳 방어. 보안 이슈는 🔴 즉시 수정.

### Scheduled Task + MCP

- **개발 리포트**: 매일 22:00 자동 git 분석 → developer-profile.md 업데이트 → Slack 예약 전송
- **MCP 연동**: PostgreSQL(운영 DB 조회) + Slack(에이전트 응답 품질 점검)

---

<br>

## 메타인지 — Developer Profile

이 프로젝트에서는 `docs/developer-profile.md`를 만들어 AI가 나의 개발 성향을 분석하고 기록하도록 했다. 코드를 짜는 것뿐 아니라, **내 작업 방식을 관찰하고 개선하고 싶었다.**

AI가 관찰한 주요 패턴:

- **실용적 미니멀리스트**: 과도한 설계를 경계하되 확장 가능한 구조를 놓치지 않음. "1단계만 먼저 적용하자"는 접근.
- **비교 기반 학습**: 유사 프로젝트를 연구하고, 원리를 이해한 뒤 자기 규모에 맞게 축소 적용.
- **엣지 케이스 선제 인식**: 구현 전에 실패 시나리오를 먼저 질문. 이 습관이 soft-delete + source 이중 구조 같은 핵심 설계를 이끌어냄.
- **위임과 검증의 균형**: 탐색은 AI에 적극 위임, 설계 결정은 함께 논의, 최종 판단은 직접.

---

<br>

## 개발 히스토리

v1 설계 → 운영 → 한계 인식 → v2 전환 → 웹 대시보드 → v3 인프라 분리 → 프로액티브 인사이트까지 진행했다.

| 날짜      | 내용                                                                     |
| --------- | ------------------------------------------------------------------------ |
| 03-05     | TypeScript + ESM, Slack Bolt, LLM 추상화, MCP 클라이언트                 |
| 03-06     | 일정 에이전트, 크론 알림, 루틴 에이전트, Docker 배포                     |
| 03-07     | SDK 직접 조회(7\~11초→\~1초), 의도 분류 진화, 대화 히스토리              |
| 03-08     | **v2 전환** — PostgreSQL, KST 수정, App Home, 스마트 메모리              |
| 03-09     | Hooks/Skills, 비용 최적화, 생활 맥락 잔소리, 개발 크론                   |
| 03-10\~11 | Next.js 캘린더, DnD, 백로그, 카테고리, PWA, 다층 보안 체계, HTTPS 배포   |
| 03-12     | **v3 전환**(Vercel+Neon), UX 개선, CI/CD, **프로액티브 인사이트 시스템** |

> 상세 기록: [docs/project-history.md](docs/project-history.md)

---

<br>

## 프로젝트 구조

```
src/                              # Slack 에이전트 (Oracle VM + Docker)
├── app.ts                        # 서버 진입점
├── router.ts                     # 채널별 에이전트 라우팅
├── agents/
│   └── life/                     # 통합 라이프 에이전트
│       ├── index.ts              # 에이전트 생성 (SQL 도구 기반)
│       ├── prompt.ts             # 시스템 프롬프트 (DB 스키마 + 분석 가이드)
│       ├── actions.ts            # 인터랙티브 버튼 핸들러
│       └── blocks.ts             # Slack Block Kit 메시지 빌더
├── cron/
│   ├── life-cron.ts              # 통합 크론 알림 (아침/점심/저녁/밤 + 한줄 인사이트)
│   └── weekly-report.ts          # 주간 리포트 (SQL 집계 + Claude Sonnet 총평)
└── shared/
    ├── config.ts                 # 환경변수 검증 + 설정
    ├── llm.ts                    # LLM 추상화 (Anthropic)
    ├── agent-loop.ts             # 에이전트 루프 (LLM ↔ 도구 반복)
    ├── db.ts                     # Neon PostgreSQL 연결 + 쿼리
    ├── sql-tools.ts              # SQL 도구 정의 (query_db, modify_db, get_schema)
    ├── insights.ts               # 프로액티브 인사이트 감지 엔진
    ├── life-context.ts           # 생활 맥락 빌더 (잔소리 시스템)
    ├── life-queries.ts           # 크론용 SQL 조회 헬퍼
    ├── chat-history.ts           # 대화 히스토리 (10쌍 슬라이딩 윈도우)
    ├── kst.ts                    # KST 타임존 유틸리티
    ├── personality.ts            # 캐릭터 프롬프트 정의
    └── slack.ts                  # Slack API 유틸리티

web/                              # 웹 대시보드 (Vercel 자동 배포)
├── src/app/
│   ├── schedules/                # 캘린더 (월간/주간/일간)
│   ├── backlog/                  # 백로그 관리
│   ├── categories/               # 카테고리 관리
│   ├── login/                    # 인증
│   └── api/                      # API Routes (Neon DB 직접 연결)
└── src/components/               # 공용 UI 컴포넌트
```

---

<br>

## 실행 방법

```bash
# Slack 봇 (백엔드)
yarn install
cp .env.example .env        # Slack, Anthropic, Neon DB 등 API 키 설정
yarn dev                    # 개발 모드
yarn build && yarn start    # 빌드 & 실행
yarn deploy                 # Oracle VM 배포

# 웹 대시보드
cd web
yarn install
cp .env.example .env.local  # Neon DB URL, 대시보드 비밀번호 설정
yarn dev                    # localhost:3000
# 프로덕션은 Vercel 자동 배포 (GitHub push → 빌드 → 배포)
```

---

<br>

## 관련 문서

| 문서                                                   | 내용                                |
| ------------------------------------------------------ | ----------------------------------- |
| [docs/project-history.md](docs/project-history.md)     | 설계 변화와 의사결정 과정 상세 기록 |
| [docs/conventions.md](docs/conventions.md)             | 코드 컨벤션 & 보안 체크리스트       |
| [docs/developer-profile.md](docs/developer-profile.md) | AI가 분석한 개발자 성향 프로필      |
