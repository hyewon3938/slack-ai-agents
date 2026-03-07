# slack-ai-agents

Slack을 인터페이스로, Notion을 데이터 저장소로 사용하는 AI 에이전트 시스템.
자연어 → AI(LLM + MCP) → Notion 조작 → Slack 응답.

## 아키텍처

```
[Slack] → [Node.js 서버] → [LLM + MCP 도구] → [Notion]
                         → [Cron] → [Notion SDK 조회] → [LLM 메시지 생성] → [Slack 알림]
```

## 기술 스택

- Runtime: Node.js + TypeScript (strict)
- Slack: @slack/bolt (Socket Mode)
- LLM: Gemini (기본, gemini-3-flash-preview) — Groq, Claude 교체 가능 (LLMClient 추상화)
- Notion: MCP (AI 자율 조작) + @notionhq/client (Cron 조회용)
- MCP: @modelcontextprotocol/sdk (stdio transport → @notionhq/notion-mcp-server)
- Cron: node-cron (timezone: Asia/Seoul)
- Test: vitest

## 프로젝트 구조

```
src/
├── app.ts                    # 서버 진입점
├── router.ts                 # 채널별 에이전트 라우팅
├── agents/
│   ├── schedule/             # 일정 관리 에이전트
│   │   ├── index.ts          # 에이전트 루프 (MCP 기반 LLM)
│   │   ├── prompt.ts         # 시스템 프롬프트
│   │   └── tools.ts          # MCP 도구 필터링
│   └── routine/              # 루틴 관리 에이전트
│       ├── index.ts          # 에이전트 루프 + "루틴" 키워드 빠른 경로
│       ├── prompt.ts         # 시스템 프롬프트
│       ├── tools.ts          # MCP 도구 필터링
│       ├── actions.ts        # 인터랙티브 버튼 핸들러 (완료 처리)
│       ├── blocks.ts         # Slack Block Kit 메시지 빌더
│       └── greeting.ts       # LLM 기반 인사/잔소리 생성 (크론 알림용)
├── cron/
│   ├── index.ts              # 일정 알림 크론 (1일 4회)
│   ├── routine-cron.ts       # 루틴 자동 생성 + 알림 (1일 4회)
│   └── schedule-reminder.ts  # 일정 포매팅 로직
└── shared/
    ├── config.ts             # 환경변수 검증 + 설정
    ├── llm.ts                # LLM 추상화 (Gemini/Groq/Claude)
    ├── mcp-client.ts         # MCP 클라이언트 (Notion MCP 서버)
    ├── notion.ts             # Notion SDK (일정 조회용)
    ├── routine-notion.ts     # Notion SDK (루틴 조회/생성/빈도 판별)
    └── slack.ts              # Slack API 유틸리티
```

## 에이전트 목록

| 에이전트 | 채널 | 설명 |
|---------|------|------|
| schedule (일정) | #schedule | 할일/일정 CRUD, 자연어 → Notion |
| routine (루틴) | #routine | 일일 루틴 관리, 체크리스트 UI |

## 에이전트 말투 — 잔소리꾼 친구

- 반말, 이모지/존댓말 금지
- 걱정 많고 잔소리 좀 하지만 진심으로 챙겨주는 친구 톤
- 어미: ~자, ~써, ~해, ~어 (훈장님처럼 ~거라 금지)
- 잔소리는 짧게 한 문장

## 일정 에이전트 Notion DB 스키마

- Name (title): 할일 내용
- Date (date): start/end 지원 (기간 일정 가능)
- 상태 (select): todo / in-progress / done / cancelled
- 메모 (rich_text): 부가 설명
- 카테고리 (multi_select): 분류

## 루틴 에이전트 Notion DB 스키마

- Name (title): 루틴 이름
- Date (date): null=템플릿, 날짜=일별 기록
- 완료 (checkbox): 완료 여부
- 시간대 (select): 아침 / 점심 / 저녁 / 밤
- 반복 (select): 매일 / 격일 / 3일마다 / 주1회
- 활성 (checkbox): 템플릿 활성 여부

## 크론 알림

| 시간 | 일정 | 루틴 |
|------|------|------|
| 09:00 | 오늘 일정 | 기록 생성 + 아침 체크리스트 + 어제 완료율 (LLM 인사) |
| 13:00 | 리마인더 | 미완료 아침 + 점심 체크리스트 |
| 18:00 | 리마인더 | 미완료 아침/점심 + 저녁 체크리스트 |
| 22:00 | 밤 리마인더 | 전체 요약 + 마무리 잔소리 (LLM 생성) |

## 핵심 설계 원칙

- **LLM 추상화**: `LLMClient` 인터페이스로 Provider 교체 가능 (현재 Gemini)
- **MCP 활용**: AI가 도구를 자율 선택 — 모든 케이스를 하드코딩하지 않음
- **환경변수 기반 설정**: 채널 ID, DB ID, API 키 등 모두 .env로 관리
- **오버엔지니어링 경계**: 현재 필요한 것만 구현하되, 교체/추가가 쉬운 인터페이스 유지
- **확장성**: 새 에이전트 추가 시 agents/{name}/ 디렉토리 + 라우터 등록만으로 가능

## 보안 규칙

- API 키/개인정보 → .env (gitignore 필수)
- .env.example에는 키 이름만
- 시스템 프롬프트에 개인정보 하드코딩 금지
- Public 저장소 — 커밋 히스토리 민감정보 주의

## 코드 컨벤션 (요약)

- 파일명: kebab-case / 변수·함수: camelCase / 타입·클래스: PascalCase / 상수: UPPER_SNAKE_CASE
- named export 사용 (default export 지양)
- any 금지 → unknown + 타입 가드
- 외부 API 경계에서만 try-catch
- 커밋: Conventional Commits (feat:, fix:, refactor:, test:, chore:)
- 상세 컨벤션 → docs/conventions.md 참조

## 개발 진행 관리

- GitHub Issues에 Phase별 개발 계획 정리 (#1~#10)
- 브랜치: feature/xxx, fix/xxx → main PR
- PR 단위: Issue 1개 = PR 1개

## Claude 작업 규칙

- 커밋이 3~5개 쌓이거나, 주제가 바뀌는 시점에 "여기서 커밋 끊자", "새 브랜치 파자", "PR 만들자" 등을 먼저 제안할 것
- 하나의 브랜치에서 서로 다른 기능이 섞이기 시작하면 PR 머지 → 새 브랜치 전환을 권유할 것
