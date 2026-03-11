# Work Log

## 2026-03-11 (화)

### 작업 요약
- 웹 대시보드 PR #74 최종 완료 및 머지 — 코드 리뷰 반영 (보안 강화, 에러 처리, 컨벤션)
- 드래그 양방향 리사이즈 + 주간뷰 카드 통일 + 모바일/데스크탑 레이아웃 완성
- 로그인 세션 버그 수정 + Docker 빌드 수정 (web/public/.gitkeep)

### 변경 파일
- `web/src/` (다수) — 코드 리뷰 반영: 보안 강화, 에러 처리, 컨벤션 정비 (+266/-88)
- `web/src/components/calendar/dnd-calendar.tsx`, `week-view.tsx` — 드래그 양방향 리사이즈 + 카드 통일 (+423/-176)
- `web/src/app/login/page.tsx`, `web/src/lib/auth.ts` — SESSION_SECRET 길이 + 쿠키 타이밍 버그 수정
- `web/src/app/layout.tsx` 등 — 일정 상태순 정렬 + 주간뷰 배경 + 모바일 safe area
- `docs/conventions.md`, `docs/project-history.md` — 신규 작성 (컨벤션 문서화)
- `web/public/.gitkeep` — Docker COPY 실패 방지
- `src/agents/life/prompt.ts` — 루틴 메모 덮어쓰기 방식으로 수정

### 미완료
- Issues #7~#10 미착수 (fortune, diet, expense 등)
- 웹 대시보드 배포 후 실제 동작 검증

### 다음 할 일
- 웹 대시보드 Oracle Cloud 배포 확인 (`yarn deploy`)
- Issues #7~#10 중 다음 기능 착수 (식단 또는 지출 관리)

## 2026-03-10 (월)

### 작업 요약
- 백로그/내일일정 fast path 추가 — LLM 없이 SQL 직접 조회로 응답 (Block Kit 카드)
- GitHub Actions CI/CD 구축 — PR 체크(테스트/린트) + main 푸시 시 자동 배포
- 수면 기록 프롬프트 강화 — 날짜 오인/임의 생성/자동 관찰 기록 문제 해결
- lint 에러 수정 — non-null assertion, console.log 정리
- 생활 맥락 인식 잔소리 시스템 구현 + LLM 비용 최적화 + AI 개발 워크플로우 자동화
- README 포트폴리오 리뉴얼 — 스크린샷, 개발자 프로필 공개

### 변경 파일
- `src/agents/life/index.ts` — 백로그/내일일정 fast path 정규식 매칭 (+45줄)
- `src/agents/life/blocks.ts` — 백로그/내일일정 Block Kit 카드 빌더 (+44줄)
- `src/shared/life-queries.ts` — 백로그/내일일정 SQL 조회 함수 추가
- `src/agents/life/actions.ts` — 버튼 핸들러 fast path 연동
- `.github/workflows/ci.yml` — 신규: PR 체크 워크플로우 (테스트/린트)
- `.github/workflows/deploy.yml` — 신규: main 자동 배포 워크플로우
- `src/agents/life/prompt.ts` — 수면 기록 날짜 오인 방지 규칙 강화
- `src/shared/life-context.ts` — 신규: 생활 맥락 분석 + 잔소리 생성 (305줄)
- `src/shared/llm.ts` — 하이브리드 모델 지원 추가
- `src/cron/life-cron.ts` — 생활 맥락 기반 잔소리 통합 + lint 수정
- `db/migrations/010_routine_memo_completed_at.sql` — 루틴 메모/완료시각 컬럼
- `docs/developer-profile.md` — 신규: 개발자 프로필 공개
- `README.md` — 포트폴리오용 대규모 리뉴얼 + 스크린샷 추가

### 미완료
- Issues #7~#10 미착수 (fortune, diet 등)
- CI/CD 배포 자동화 실제 동작 검증

### 다음 할 일
- Issues #7~#10 중 다음 기능 착수 (식단 또는 지출 관리)
- fast path 패턴 추가 확장 (자주 쓰는 조회 커버리지 넓히기)
