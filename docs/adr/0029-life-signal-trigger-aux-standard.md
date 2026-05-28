# 0029. `life_signal` 단일 type 통합 + `trigger_aux.kind` 평가 명세 표준

- Status: Accepted
- Date: 2026-05-28
- Related: [#447](https://github.com/hyewon3938/slack-ai-agents/issues/447), 마스터 [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434) Phase 3
- Tags: data, insight, architecture, schema

## Context

마스터 #434 Phase 3 진입 시점에 `life_signal` 카테고리에 들어갈 시드가 세 갈래로 갈라졌다:

1. **환경 시그널** — 요일 / 주말·평일 / 월말·월초·중순 / 계절 / 공휴일. 캘린더만 보면 평가 가능, 본인 데이터 무관
2. **임계치 풀셋 시드** — 수면 ≤ N시간 (N=5,6,7,8), 루틴 streak ≥ N일 (N=3,5,7,14,30). 본인 시계열 기반. Phase 2.5 풀셋 임계치 정신(ADR-0028) 확장
3. **11종 결정론 패턴 승격** — `insights.ts`의 11개 detect 함수(`detectStreak`·`detectSleepTrend`·`detectSlotGap`·... `detectSpottyPattern`)를 시드로 옮기는 작업. baseline 비교 SQL 포함

세 갈래는 모두 `결정론적 trigger`라는 공통점이 있으나, 평가 방식이 다르다:
- 환경: `EXTRACT(DOW FROM date) = 1` 같은 정적 SQL
- 임계치: `SELECT COUNT(*) FROM sleep_records WHERE sleep_minutes <= 420 AND date = $1`
- 11종: streak 카운트·baseline window 비교 등 동적 SQL

문제:

- `trigger_target_type` 어휘를 어떻게 잡을 것인가 — 단일 통합(`life_signal`) vs 분리(`life_signal` + 새 type)
- 평가 명세 어디에 박을 것인가 — `trigger_aux` JSONB의 표준 스키마 필요
- `evaluateTrigger` 분기를 어떻게 확장할 것인가 — 현재 stem/branch/ganji/element_density/sibiunsung/relation/cumulative_pillar_count switch case

이 결정은 후속 Phase(4 매칭 cron, 5 가설 발견, 6 LLM 매트릭)가 모두 의존한다.

## Decision

**`trigger_target_type = 'life_signal'` 단일 통합 + `trigger_aux.kind` 필드로 평가 명세 분기.**

`life_signal`은 본 마스터에서 "사주가 아닌 결정론 trigger"의 광의 카테고리로 정의한다. 환경·임계치·11종 승격 모두 같은 type에 묶이고, 평가 함수 디스패치는 `trigger_aux.kind`를 키로 한다.

### `trigger_aux.kind` 표준 (Phase 3 도입분)

총 **7 kinds**. 음력(`lunar`) kind는 설계 단계에 포함됐다가 구현 직전 폐기 — 사유는 아래 "폐기 결정" 참조.

| kind | 의미 | trigger_aux 예시 | 평가 방식 |
|------|------|-----------------|----------|
| `weekday` | 특정 요일 발현 | `{kind:'weekday', dow:1}` | `EXTRACT(DOW FROM ctx.date) === dow` (1=월) |
| `weekday_group` | 주말 / 평일 | `{kind:'weekday_group', group:'weekend'}` | dow ∈ {0,6} ↔ {1..5} |
| `month_position` | 월말 / 월초 / 중순 | `{kind:'month_position', position:'end', range_days:3}` | 월 마지막/처음 N일 |
| `season` | 4계절 | `{kind:'season', season:'spring'}` | 3\~5월 ↔ spring 등 |
| `calendar_event` | 공휴일 / 공휴일 다음날 / 자동이체일 | `{kind:'calendar_event', event:'holiday'}` | 한국 공휴일 lookup + day-of-month 매칭 |
| `threshold` | 임계치 풀셋 (sleep·streak 등) | `{kind:'threshold', source:'sleep_minutes', op:'lte', value:420}` | source별 SQL evaluator |
| `behavior_baseline` | 11종 승격 (동적 baseline) | `{kind:'behavior_baseline', signal_name:'streak'}` | `insights.ts` detect 함수를 evaluator로 매핑 |

각 kind는 `src/shared/life-signal-evaluators/<kind>.ts` 모듈 1개로 분리 (디렉토리 신설, 총 7 모듈). 모든 evaluator 함수는 동일 시그니처:

```typescript
type LifeSignalEvaluator = (
  aux: Record<string, unknown>,
  ctx: DailyContext,
  userId: number,
) => Promise<boolean>;
```

`evaluateTrigger`의 `case 'life_signal'` 안에서 `aux.kind`로 evaluator 객체에서 함수 lookup → 호출.

### TypeScript 타입

```typescript
// src/shared/types.ts (또는 saju-match.ts)
export type LifeSignalKind =
  | 'weekday'
  | 'weekday_group'
  | 'month_position'
  | 'season'
  | 'calendar_event'
  | 'threshold'
  | 'behavior_baseline';

export interface LifeSignalAuxBase {
  kind: LifeSignalKind;
}

export interface WeekdayAux extends LifeSignalAuxBase {
  kind: 'weekday';
  dow: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ThresholdAux extends LifeSignalAuxBase {
  kind: 'threshold';
  source: 'sleep_minutes' | 'routine_streak_max' | string;
  op: 'lte' | 'gte' | 'eq';
  value: number;
}

export interface BehaviorBaselineAux extends LifeSignalAuxBase {
  kind: 'behavior_baseline';
  signal_name:
    | 'streak'
    | 'sleepTrend'
    | 'slotGap'
    | 'weekComparison'
    | 'overdueAlert'
    | 'categorySkew'
    | 'drift'
    | 'recovery'
    | 'lapseAlert'
    | 'weeklyRegression'
    | 'spottyPattern';
}

// (7 kind 모두 비슷한 패턴으로 정의)

export type LifeSignalAux =
  | WeekdayAux
  | WeekdayGroupAux
  | MonthPositionAux
  | SeasonAux
  | CalendarEventAux
  | ThresholdAux
  | BehaviorBaselineAux;
```

`trigger_aux`는 DB에 JSONB로 저장되지만, 평가 시점에 zod 같은 런타임 검증 또는 type guard로 정합성 보장.

### `pattern_kind` 컬럼은 그대로

Phase 1 도입된 `pattern_kind ∈ {saju, life_signal}` 컬럼은 **유지**. 이는 시드 출처(사주 도메인 vs 라이프 도메인) 마커이지 평가 분기 키가 아니다. `trigger_target_type = 'life_signal'` 시드는 모두 `pattern_kind = 'life_signal'`.

## Alternatives considered

### A. `life_signal` + `behavior_signal` 두 type 분리

- 장점:
  - 의미적 분리 명확 — 환경 시그널(외부 결정론)과 본인 행동 시그널(시계열 baseline)이 다른 type
  - `behavior_signal` 시드는 baseline window 의존성 명시적
- 단점:
  - CHECK constraint 갱신 + ADR-0022/0026 enum 재확장
  - 평가 로직은 어차피 `trigger_aux.kind` 분기 필요 (type만 둘로 나뉘고 kind 분기는 동일) — 중복 비용
  - 임계치 풀셋(`수면 ≤ 7시간`)이 어느 type에 들어갈지 애매 (외부 데이터지만 본인 시계열)
- 기각 이유: type 분리가 평가 단순화에 기여 안 함. `kind` 분기가 본질적 단위.

### B. 시드별 평가 SQL을 `trigger_aux`에 sql_body 박기

- 장점: 모든 결정론 평가를 SQL로 통일, 시드 추가가 데이터 INSERT만으로 끝남
- 단점:
  - 헌장 ④(신뢰 비용 분리) — 결정론 매트릭은 sql_body로 영속하지만 trigger 평가까지 SQL 박으면 안전장치 부담 ↑ (`SELECT 1 WHERE ...` 형식 강제, 결과 검증 비용)
  - 환경 시그널(요일·계절)은 SQL보다 코드 분기가 더 단순
  - 11종 승격 시 detect 함수의 baseline 비교 SQL이 매우 복잡 — SQL 영속화 어려움
- 기각 이유: SQL 영속화는 매트릭 영역(`pattern_metrics.expected_metric_sql`)에 한정. trigger 평가는 code-first.

### C. `life_signal` 단일 통합 + `trigger_aux.kind` 분기 (선택)

- 장점:
  - 어휘 단순 (`trigger_target_type` enum 확장 1회로 끝남)
  - design-notebook + 마스터 이슈 본문 어휘 일치 — ADR 추가만 필요, 마이그레이션 추가 없음
  - kind 추가 시 evaluator 모듈 1개 추가 + type union 확장만으로 가능 (수평 확장 자연)
  - 환경·임계치·11종 모두 공통 인터페이스(`(aux, ctx, userId) => boolean`)로 매칭 cron에서 균일 처리
- 단점:
  - `life_signal`이 광의 — "사주 아닌 결정론 trigger" 전부 묶임. 추후 의미 분리 필요해지면 마이그레이션 비용
  - `behavior_baseline` kind 평가가 무거움(baseline window SQL) — 매일 매칭 cron 부담 점검 필요
- 채택 이유: 평가 분기의 본질적 단위는 type이 아니라 kind. 단일 type + kind dispatch가 5어휘 모델과 자연.

## Consequences

### 장점

- `trigger_target_type` enum 확장 추가 없음 (Phase 1 도입된 7번째 값 `life_signal` 그대로)
- `case 'life_signal'` 단일 분기에서 `evaluators` 객체로 함수 dispatch — `evaluateTrigger` 본문 깔끔 유지
- 평가 모듈 디렉토리(`src/shared/life-signal-evaluators/`) 신설로 kind별 책임 분리, 테스트 단위 명확
- kind 추가 시 ADR 추가 안 함 (본 ADR이 표준 정의) — Phase 6 LLM 매트릭이 새 kind 제안 시점에 재검토
- 11종 승격이 자연스럽게 `behavior_baseline` kind로 흡수 — 잔소리 시스템(`insights.ts`)은 그대로 두고, 시드는 동일 SQL을 evaluator로 lookup

### 단점 / 제약

- `life_signal` 어휘가 광의 — "환경 시그널만"이라는 자연 어휘 의미보다 넓음. 도메인 문서·design-notebook에 본 ADR로 정의 명시 필요
- `behavior_baseline` evaluator는 11개 detect 함수 SQL의 *복사* 또는 *참조* — `insights.ts`와 시드 평가 두 곳에서 동일 SQL 실행 (일시 공존). Phase 8에서 잔소리 통합 시 SQL source of truth 일원화 필요
- `trigger_aux` JSONB가 type-safe하지 않음 — TypeScript type guard 또는 zod 검증으로 런타임 정합성 유지
- evaluator 디렉토리 신설은 새 구조 — 코드 리뷰 + 도메인 문서 갱신 필수

### 후속 작업

- [x] Phase 3 마이그레이션 072: `life_signal` 시드 INSERT (38개)
- [x] `src/shared/life-signal-evaluators/` 디렉토리 신설 (kind별 모듈 7개)
- [x] `evaluateTrigger`에 `case 'life_signal'` 추가 + `dispatchLifeSignal` switch
- [x] TypeScript type 정의 (`LifeSignalAux` discriminated union)
- [x] `behavior_baseline` evaluator 매핑 — 11개 detect 함수 SQL을 evaluator로 옮기되 `insights.ts`는 *변경 없음* (일시 공존)
- [x] vitest: kind별 evaluator 단위 테스트
- [ ] 매칭 cron 부담 측정 — Phase 2.5 후 시드 175개 + Phase 3 신규 38개 = \~213개. 매일 매칭 5초 한도 점검 (Phase 4)
- [x] 도메인 문서 `insight.md` Section 17 본문 작성

### 폐기 결정 — `lunar` kind (구현 직전)

설계 단계(8 kinds)에 포함됐던 `lunar` kind는 구현 직후 코드 cleanup에서 폐기. 사유:

1. **사주 매칭 정합성 불일치** — 사주 운(運) 단위는 절기(立春·入夏 등) 기준이지 음력 1일/15일 기준이 아니다. `lunar` kind를 `life_signal`(사주가 아닌 결정론 trigger)에 두면 어휘 의미는 맞으나 사주 도메인 컨텍스트에서 혼동 유발
2. **명절/계절 효과는 다른 kind로 충분 커버** —
   - 설/추석 등 명절 후유증 가설은 `calendar_event:holiday_next`로 검증 (한국 공휴일 lookup, 양력)
   - 계절 환절기 효과는 `season:spring|autumn`로 검증 (양력 월 기반)
   - 음력 보름달/초하루 자체가 본인 임상 가설로 명시된 적 없음 (가설 0개)
3. **양력→음력 변환 의존성 제거** — `korean-lunar-calendar` 같은 외부 패키지 또는 정적 매핑 테이블 의존을 1개 더 만들 필요가 없어짐

음력 1/15 단일 효과에 대한 본인 임상 가설이 발견되면, 그때 별도 kind로 재도입 + 변환 인프라 신설. 현 단계 catalog에는 음력 시드 0개로 시작했으므로 폐기에 따른 데이터 손실 없음.

---

**참고 자료**

- [ADR-0022](0022-target-type-generalization.md) (Superseded by 0026) — `life_signal` target_type 일반화 도입
- [ADR-0026](0026-pattern-prefix-rename.md) — `pattern_*` prefix rename
- [ADR-0028](0028-pillar-level-and-threshold-pool.md) — 풀셋 임계치 정신 (수면·streak 임계치 시드에 적용)
- [#434 자체 헌장](../design-notebook/personal-pattern-discovery.md#핵심-원칙--자체-헌장-변경-불가-변경-시-adr) — 5어휘 분리 + target-type 일반화
- [v2 헌장 ②·④](../../.claude/projects/-Users-ihyewon-slack-ai-agents/memory/project_insight_v2_core_principles.md) — 결정론↔자율 분리 + 신뢰 비용 분리
