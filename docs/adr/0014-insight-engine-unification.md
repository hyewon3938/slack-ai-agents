# 0014. 프로액티브 인사이트 엔진 통합 — 매일·주간 단일 엔진 + 임계치 외부화

- Status: Accepted
- Date: 2026-05-13
- Related: #389 (Phase 1), #393 (마스터)
- Tags: data, insight, process

## Context

기존 `src/shared/insights.ts`의 5개 SQL 패턴(streak / sleepTrend / slotGap / weekComparison / overdueAlert)은:
- 함수 내부에 임계치가 하드코딩되어 있어 한눈에 비교·튜닝 불가
- 단일 도메인 한정이라 cross-domain 시그널 부재
- timing이 morning/night 2종이라 주간 회고에 활용 불가
- 호출 자체가 한때 제거된 상태(주석으로 복원 가능 표시) — 패턴 엔진이 실제로 작동하지 않고 있었음

그리고 별도 동선으로 돌아가던 `weekly-report.ts`는 집계 위주(평균/best/worst/카테고리 분포)였고, 사용자가 거의 읽지 않는다고 명시. 시그널이 noise에 묻혀 잔소리꾼 친구 톤이 살지 않음.

Phase 1 (#389) 진입 시 SQL 패턴을 6개 추가하기로 결정했고, 이 시점에 인사이트 엔진 전체를 통합·재정렬할 필요가 생겼다. 추가로 마스터 #393 v2 철학은 "LLM 텍스트 해석 의존도 최소화 + 결정론적 잔소리 + 사주 가설-검증"이라, 임계치 튜닝(Phase 4)과 도메인 매핑(Phase 4)을 위해서 임계치가 한 곳에 모여있어야 한다.

## Decision

세 가지 결정을 한 묶음으로 채택한다.

### 1. 매일 잔소리 + 주간 리포트를 단일 패턴 엔진 위에서 동작

- `Insight` 타입에 `timing: 'morning' | 'night' | 'weekly'` 추가
- 패턴 함수(`detect*`)가 timing 매개변수를 받거나, 결과의 timing 필드로 분류
- 매일 잔소리 = `pickMorningNudges` / `pickNightNudges`
- 주간 리포트 = `pickWeeklyInsights` + 집계 데이터를 함께 노출
- 기존 weekly-report.ts의 집계 SQL은 유지(LLM 총평 컨텍스트로 활용), 다만 Block Kit 표시는 압축

### 2. 임계치 단일 외부 파일

`src/shared/insight-thresholds.ts`에 `INSIGHT_THRESHOLDS`로 전체 임계치 export.

```typescript
export const INSIGHT_THRESHOLDS = {
  streak: { ... },
  sleepTrend: { ... },
  // ...
  pickByTiming: { minPriority: 5, maxItems: 3 },
} as const;
```

각 detect 함수는 함수 진입부에서 `INSIGHT_THRESHOLDS.<type>`을 구조 분해하여 사용.

### 3. 매일 동적 노출 (priority threshold + 도메인 dedupe + cap)

기존 `pickByTiming`은 priority 최상위 1개만 반환. 신규 로직:

```
1. 모든 detect* 실행 → 후보 수집
2. priority ≥ 5 필터
3. priority 내림차순 정렬
4. 같은 domain(routine/sleep/schedule) 중복 시 priority 최상위 1개만
5. 최대 3개 cap
6. 0개면 메시지 발송 안 함 (no-news is good news)
```

표시는 단순 텍스트 줄바꿈 (Block Kit은 주간 리포트만 사용).

### 4. 주간 리포트 시간 이동 + 구조 재구성

- 일요일 23:00 → 월요일 09:00 (지난주 회고 시점이 더 자연스러움 + 일요일 23:00은 아직 안 끝난 시점)
- 월요일 매일 morning 인사이트는 스킵 (주간 리포트가 대체)
- Block Kit 구조: 인사이트 → 한눈에 보기 → 총평. 이모지 X.

## Alternatives considered

### A. 매일/주간 따로 두기 (현행 유지)

- 장점: 변경 폭 최소
- 단점:
  - 매일 잔소리가 작동하지 않는 상태(호출 주석 처리)
  - 임계치 산재 상태 유지 — Phase 4 튜닝 시 부담
  - 주간 리포트가 안 읽힘 문제 미해결
- 기각 이유: Phase 1 패턴 추가 시점에 손대지 않으면 동일 코드 흩어진 채 부채 누적.

### B. 매일/주간 모두 같은 엔진 + 매일도 Block Kit

- 장점: UI 일관성
- 단점:
  - 매일 잔소리가 카드형이 되면 잔소리꾼 친구 톤(짧고 가벼움)과 어긋남
  - "신호 적은 날도 풀 카드 발송" → 무게감 과잉
- 기각 이유: 잔소리는 짧을수록 좋다는 프로젝트 톤 원칙(CLAUDE.md "잔소리는 짧게 한 문장")과 충돌.

### C. 임계치 외부화 미수행, 새 패턴만 추가

- 장점: 변경 폭 작음
- 단점: 11개 패턴(기존 5 + 신규 6) 임계치가 11개 함수에 흩어짐. Phase 4 튜닝 부담 폭증.
- 기각 이유: 패턴 수가 늘어나는 시점이 외부화 적기. 미루면 부채 커짐.

### D. 본 결정 — 통합 + 외부화 + 재구성 (선택)

- 장점: 11개 패턴이 같은 구조 위에서 동작, 임계치 한 곳, 매일/주간 일관된 메시지 톤, 주간 리포트 시그널 명확화
- 단점:
  - 변경 폭 큼 (1 PR에 cron/insights/weekly-report/thresholds 모두 포함)
  - 단일 PR이라 리뷰 부담

## Consequences

### 장점

- **임계치 단일 튜닝 지점**: Phase 4 사주 매핑 시 카테고리/패턴별 임계치를 한 파일에서 조정 가능
- **잔소리 톤 회복**: 매일은 짧은 텍스트(0\~3개), 주간은 카드형 — 시그널·노이즈 분리
- **단일 패턴 엔진**: 신규 패턴 추가 시 timing 필드만 결정하면 매일/주간 자동 분류
- **잔잔한 날 = 침묵**: 패턴 0개면 매일 메시지 skip — 잔소리 피로도 ↓
- **주간 리포트 가독성**: 인사이트가 최상단, 집계는 1\~2줄 요약
- **이모지 미포함**: 사용자 선호 반영 (CLAUDE.md "이모지/존댓말 금지" 강화)

### 단점 / 제약

- Insight 인터페이스에 `domain` 필드 추가 — 기존 detect\* 함수 5개 모두 갱신 필요
- weekly-report.ts의 기존 Block Kit이 재작성됨 — 기존 best/worst day 등의 정보는 LLM 총평 컨텍스트로만 활용
- 동적 노출 정책상 priority 4 이하 패턴(sleepTrend↑ 등)이 매일 노출 안 됨 — 명시적 의도로 sleep 패턴은 priority 8/4 분기 유지

### 후속 작업

- [ ] 1주 운영 후 `INSIGHT_THRESHOLDS.pickByTiming.minPriority` 튜닝 (메시지 빈도 관찰)
- [ ] Phase 2 (#390) LLM 자율 슬롯 도입 시 `Insight.domain`을 'cross-domain'으로 확장 검토
- [ ] Phase 4 (#392) categories 메타데이터 확장 시 categorySkew의 카테고리별 가중치 추가
- [ ] `notification_settings.weeklyReport` 시간 변경 마이그레이션 운영 DB 적용 — 사용자가 직접 실행 (보안 크리티컬 작업 원칙)
