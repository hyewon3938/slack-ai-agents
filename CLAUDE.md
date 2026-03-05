# slack-ai-agents

Slack을 인터페이스로, Notion을 데이터 저장소로 사용하는 AI 에이전트 시스템.
자연어 → AI(LLM + MCP) → Notion 조작 → Slack 응답.

## 아키텍처

```
[Slack] → [Node.js 서버] → [LLM + MCP 도구] → [Notion]
                         → [Cron] → [Notion SDK 조회] → [Slack 알림]
```

## 기술 스택

- Runtime: Node.js + TypeScript (strict)
- Slack: @slack/bolt (Socket Mode)
- LLM: Groq API → 추후 Claude 교체 가능 (추상화 레이어)
- Notion: MCP (AI 자율 조작) + @notionhq/client (Cron 조회용)
- MCP: @modelcontextprotocol/sdk
- Cron: node-cron
- Test: vitest

## 프로젝트 구조

```
src/
├── app.ts                    # 서버 진입점
├── router.ts                 # 채널별 에이전트 라우팅
├── agents/{name}/            # 에이전트별 디렉토리
│   ├── index.ts              # 메인 로직
│   ├── prompt.ts             # 시스템 프롬프트
│   └── tools.ts              # MCP 도구 설정
├── shared/
│   ├── llm.ts                # LLM 추상화 (Groq/Claude 교체 가능)
│   ├── mcp-client.ts         # MCP 클라이언트
│   ├── notion.ts             # Notion SDK (Cron용)
│   └── slack.ts              # Slack 유틸리티
└── cron/                     # 정기 알림
```

## 에이전트 목록

| 에이전트 | 채널 | 우선순위 |
|---------|------|---------|
| schedule (일정) | #schedule | 1순위 |
| fortune (사주/일기) | #fortune | 2순위 |
| diet (식단) | #diet | 3순위 |

## 일정 에이전트 Notion DB 스키마

- 제목 (title): 할일 내용
- 날짜 (date): 예정일
- 상태 (select): todo / in-progress / done / cancelled
- 우선순위 (select): high / medium / low
- 메모 (rich_text): 부가 설명

## 핵심 설계 원칙

- **LLM 추상화**: `LLMClient` 인터페이스로 Provider 교체 가능하게
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
