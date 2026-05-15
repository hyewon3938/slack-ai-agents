# 프로액티브 인사이트 v2

> 마스터 이슈: [#393](https://github.com/hyewon3938/slack-ai-agents/issues/393)
> 시작: 2026-05-10
> 상태: 진행 중

## 개요

기존 SQL 기반 패턴 5개로 운영되던 프로액티브 인사이트를, **결정론적 잔소리 엔진**(SQL 패턴)과 **LLM 자율 발견**(주간 1회) + **사주 가설-검증**(개인 원국 기반 매핑)으로 재설계하는 마스터.

핵심 철학:
- **LLM 텍스트 해석 의존도 최소화** — 매일 잔소리는 SQL 패턴 결정론적으로
- **LLM은 발견 슬롯에서만 자율** — 주간 1회, 가설 제기 → DB 보존 → 사후 검증
- **사주 가설-검증** — 개인 원국의 십성/오행 매핑을 패턴 임계치 조정에 활용

## 전체 Phase 흐름

- [x] **Phase 1**: 패턴 통합 · 임계치 외부화 · 주간 리포트 재구성 ([#389](https://github.com/hyewon3938/slack-ai-agents/issues/389), 2026-05-14 머지)
- [ ] **Phase 2**: LLM 자율 슬롯 + 측정 ([#390](https://github.com/hyewon3938/slack-ai-agents/issues/390), 진행 중)
- [ ] **Phase 3**: 사주 매핑 — 십성/오행을 임계치 가중치로 ([#391](https://github.com/hyewon3938/slack-ai-agents/issues/391))
- [ ] **Phase 4**: 사주 매핑 — 카테고리/패턴별 임계치 외부화 확장 ([#392](https://github.com/hyewon3938/slack-ai-agents/issues/392))

---

## Phase 1: 패턴 통합 · 임계치 외부화 · 주간 리포트 재구성 (2026-05-14)

- 이슈: [#389](https://github.com/hyewon3938/slack-ai-agents/issues/389)
- 관련 ADR: [ADR-0014](../adr/0014-insight-engine-unification.md)
- 관련 PR: [#396](https://github.com/hyewon3938/slack-ai-agents/pull/396)
- 상태: 머지 완료

### 결정 요약

5개 SQL 패턴(streak / sleepTrend / slotGap / weekComparison / overdueAlert) → 11개로 확장. 임계치 11개 함수 산재 상태 → `src/shared/insight-thresholds.ts` 단일 파일로 외부화. 매일 잔소리 + 주간 리포트가 같은 패턴 엔진 위에서 동작하도록 `Insight.timing: 'morning' | 'night' | 'weekly'` 도입. 주간 리포트는 일요일 23시 → 월요일 09시 + Block Kit 재구성.

### 의사결정 분기점

> Phase 1 backfill — ADR-0014의 Alternatives 정리분 기반.

- **매일 잔소리 + 주간 리포트 통합 여부**:
  - A. 따로 두기 (현행 유지) — 변경 폭 작지만 매일 잔소리가 작동 중단 상태로 계속됨
  - B. 통합 + 매일도 Block Kit — UI 일관성 좋지만 카드형은 잔소리꾼 톤(짧고 가벼움)과 충돌
  - C. 통합 + 매일은 텍스트, 주간만 Block Kit (선택) — 잔소리는 짧을수록 좋다는 원칙 + 시그널·노이즈 분리
- **임계치 외부화 시점**:
  - A. 미루고 신규 패턴만 추가 — 11개 함수에 임계치 산재. Phase 4 사주 매핑 시 튜닝 부담 폭증
  - B. 이번에 같이 외부화 (선택) — 패턴 수가 늘어나는 시점이 외부화 적기
- **주간 리포트 시간**:
  - 일요일 23시 유지 vs 월요일 09시 이동 → **월요일 09시 선택**. 일요일 23시는 아직 지난주가 안 끝난 시점 + 회고 시점이 더 자연스러움
- **매일 동적 노출 정책**:
  - 기존 `pickByTiming`은 priority 최상위 1개만 → 신규: priority ≥ 5 + 도메인 dedupe + 최대 3개 cap + 0개면 발송 안 함
  - **잔잔한 날 = 침묵** 원칙. 잔소리 피로도 ↓

### 포기한 안 / 미룬 항목

- **카테고리별 가중치 (categorySkew 등)**: Phase 4로 미룸. 카테고리 메타데이터 확장이 선행되어야 함.
- **LLM 자율 분석**: Phase 2로 분리. Phase 1은 결정론적 잔소리에 집중.
- **`Insight.domain`을 'cross-domain'으로 확장**: Phase 2 LLM 자율 슬롯 도입 시 함께 검토.

### 미해결·가설

- **priority 최소치 5가 적정한가**: 운영 1주 후 메시지 빈도 보고 조정 가능 (ADR-0014 후속 작업)
- **sleep 패턴 priority 8/4 분기**: sleepTrend↑는 priority 4로 두어 매일 노출 안 되게 함. 명시적 의도지만 사용자 반응 미관측.

### 회고

- 매일 cron 연결 복원이 한참 후에야 이루어진 게 가장 큰 발견. 패턴 코드는 있었지만 호출이 주석 처리된 상태로 오래 방치되어 실제로는 잔소리가 안 가고 있었음. 통합 작업이 아니었으면 이 부재를 더 늦게 발견했을 가능성.
- 임계치 외부화 후 한 파일에서 임계치 11개를 비교하니 sleepTrend의 7시간 컷오프, weekComparison의 ±5%p 등 직관적으로 "이게 너무 빡빡한가?" 싶은 부분이 즉시 보임. Phase 4 튜닝 도구로 잘 작동할 듯.

---

## Phase 2: LLM 자율 슬롯 + 측정 (진행 중)

- 이슈: [#390](https://github.com/hyewon3938/slack-ai-agents/issues/390)
- 상태: 설계 인터뷰 완료, 계획서 작성 대기

### 결정 요약

> 본 Phase 설계 완료 후 채움.

### 의사결정 분기점

> Phase 2 설계 인터뷰에서 추출 — 계획서 작성 시 통합.

### 포기한 안 / 미룬 항목

### 미해결·가설

### 회고

> Phase 2 머지 후 채움.
