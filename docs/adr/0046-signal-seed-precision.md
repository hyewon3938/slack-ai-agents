# 0046. 신호·시드 측정 정밀화 — 방향 분리 + 누적→강도밴드 위임 + 포화 양방향 가드 + 동어반복 필터

- Status: Accepted
- Date: 2026-06-08
- Related: [#508](https://github.com/hyewon3938/slack-ai-agents/issues/508), [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477)(헌장), [#504](https://github.com/hyewon3938/slack-ai-agents/issues/504)(측정 타당성 선행), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md)(off-day 2×2 substrate), [ADR-0036](0036-relative-quantile-strength-bands.md)(강도=상대 분위수 밴드), [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md)(노출·큐레이션[사람] vs 믿음[통계]), [ADR-0044](0044-discovery-measurement-validity.md)(측정 윈도우·효과크기)
- Tags: insight, statistics, architecture

## Context

#477·#504 운영 데이터에서 신호·시드 측정의 거칠음 4종이 드러났다. 전부 **off-day 대조(발현일 vs 비발현일)의 정확도**(#477 헌장 ②)나 **휴먼 큐레이션 게이트의 신호 품질**(#504 원칙 ②, ADR-0039)을 훼손한다.

1. **날짜 변경 신호가 방향무관**. `audit_date_changed` = `COUNT(*) WHERE change_type='date_changed'` — 미룸(NEW>OLD, 부정 뉘앙스)과 당김(NEW<OLD, 조율 뉘앙스)을 한 신호로 합산해 반대 의미를 상쇄. writer(웹)가 `before_value/after_value`에 날짜를 다 기록하므로 방향 산출은 이미 가능한데 안 쓴다.

2. **누적 카운트 시드가 고정 임계라 포화 시 죽는다**. `cumulative_pillar_count` 시드(화 오행·편재 십성 × N=1..5, 고정 `count_min`)는 본인 사주에서 화가 운(運)에 늘 깔려 매일 3레벨↑(N1~N3 측정 11/11) → **off-day 0 → 영영 확정 불가**. 같은 "오늘 화 기운이 평소보다 강한가"를 [ADR-0036](0036-relative-quantile-strength-bands.md) 강도 밴드(`pool_강도_화`)가 **상대 분위수 + 주간 자동 재계산 + 가중치**로 포화 없이 더 정교하게 측정한다(강도 밴드는 ~33%씩 갈려 절대 포화 불가 → 세운 변동도 자동 적응). 누적은 강도 밴드의 미성숙 프록시.

3. **포화 시드를 잡는 상시 가드가 없고, 탈포화 시드를 되살릴 길도 없다**. 활성률≈100% 시드는 측정상 죽었지만(off-day≈0) active로 남아 카드·발굴을 오염시킨다. 반대로, 한 해 포화였던 시드가 다음 해 세운 변동으로 변별력을 되찾을 수 있는데(절대 임계 시드 한정), 한 번 끄면 측정이 멈춰 자동 복귀가 불가능하다.

4. **발굴이 동어반복(자기상관) 후보를 surface**. 행동 시드가 자기 source 도메인의 신호와 짝지어지면(예: `life_behavior_spotty`[루틴 누락 패턴] × `routine_completion_rate`[루틴 완료율]) 같은 행동을 두 번 잰 것이라 통계는 유의해도 무의미하다. 실데이터 발굴 top 5 중 2개가 이 류였다. 사람이 [패스]로 거르지만, 구조적으로 자명한 자기상관은 surface 전에 거를 수 있다.

## Decision

### 1. 날짜 변경 방향 분리 (방향무관 은퇴 + 방향 신호 2개 신설)

`audit_date_changed`를 은퇴(`status='rejected'` + 링크 archive)하고 `signal_defs`에 방향 신호 2개를 시드(`source='seed'`)한다:

- `audit_date_postponed` (미룸) — `change_type='date_changed' AND (after_value->>'date')::date > (before_value->>'date')::date`
- `audit_date_advanced` (당김) — 동일 조건에 `<`

`kind='sql'`, `value_type='continuous'`, `direction='above_abs'`, `threshold=1`, `domain='audit'`. 시드 신호라 LLM 가드(`signal-sql-guard`, ADR-0040) 비대상. 신규 신호는 링크 없이 시작 → P5a 발굴이 자연 재페어링.

### 2. 누적 카운트 시드 은퇴 → 강도 밴드 위임

화 오행·편재 누적 시드 10개(`pool_화_오행_누적_N1`~`N5`, `pool_편재_누적_N1`~`N5`)를 archive(`active=false`, `archived_reason='delegated_to_strength_band'` + 링크 `status='archived'`). 동일 개념은 기존 강도 밴드가 흡수: 화→`pool_강도_화`, 편재(본인 사주 양목)→`pool_강도_목`("재성(목) 발현 강한 날"). 양목/음목 granularity는 포기(새 통계 코어 최소화, ADR-0033 — 임상 필요 시 별도 후속). 부수: 누적 분포만 소비하던 `pillar-level-distribution-review` cron(월 09:15) 은퇴, `cumulative_pillar_count` 트리거 코드 휴면(CHECK 미변경).

### 3. 포화 시드 양방향 가드 (자동 archive ⟷ 자동 부활)

주간 검증 엔진(`weekly-verification.ts` `processUser`)에 양방향 sweep 추가:

- **archive**: 활성 시드의 데이터-존재 윈도우([ADR-0044](0044-discovery-measurement-validity.md)) 내 활성률 ≥ `saturationRate`(0.95) & 윈도우 ≥ `saturationMinDays`(30) → `active=false`, `archived_reason='saturation'` + 링크 `status='archived'` + 로그 + 카드 알림.
- **부활(revive)**: `active=false AND archived_reason='saturation'` 시드를 현재 윈도우로 **재계산**(트리거 결정론이라 비활성이어도 활성 시리즈 산출 가능) → 활성률 < `saturationRate` & 윈도우 ≥ `saturationMinDays`(탈포화)면 `active=true`, `archived_reason=NULL` 복귀 + 카드 알림. 발굴이 자연 재페어링.
- `archived_reason='saturation'` 스코프가 핵심: ②의 누적 시드(`delegated_to_strength_band`)나 수동 archive는 부활 대상 아님(강도 밴드가 영구 대체).

**ADR-0039(큐레이션=사람)와의 관계**: 포화/탈포화는 "말 되는 후보냐"는 큐레이션 판단이 아니라 **off-day가 검정을 가능케 하느냐**는 사실이므로 자동화가 정당하다. "자동으로 끄면 자동으로 켜기도 한다"는 대칭. 소표본 오판은 `saturationMinDays` 가드 + `active`/`archived_reason` 가역으로 차단.

### 4. 동어반복(자기상관) 후보 자동 필터 (발굴 surface)

`discoverCandidates`의 여집합 스캔에서 **행동 시드의 source 도메인 == 신호 도메인**인 쌍을 제외(`linked.has` 옆에서 skip + 로그). 같은 행동을 두 번 재는 자기상관이라 자명하게 무의미.

- 행동 시드(`life_behavior_*`) → source 도메인(routine/schedule/sleep) 매핑은 `insights.ts` 감지 로직 기준(#506 라벨과 동일 출처). 캘린더 life_signal(`life_dow_*`·`life_weekend`·`life_month_*`)·사주 시드는 행동 도메인이 없어 **자동 면제** — "월요일 × 루틴 완료율" 같은 정상 교차후보는 그대로 surface.
- 발굴은 **cross-domain 발견이 목적**(사주↔행동, 행동 도메인 A↔B). same-domain 자기상관은 그 목적의 반대라 surface 전 제외가 정합. 사전선별 전에 skip하므로 FDR 풀도 오염 안 됨.

## Alternatives considered

- **(1') 방향무관 유지 + 방향 신호 추가** — 무효 측정(반대 의미 합산)을 남길 이유 없음. 기각.
- **(2a/2b/2c)** 누적 전부 상대 밴드 전환 / 편재만 십성 강도밴드 신설 / 변별 N만 활성 — 각각 0~5 정수 분위수 거침·새 통계 코어·근본 적응 아님으로 기각. 강도 밴드 위임이 신규 코드 0으로 동일 효과.
- **(3') archive-only (부활 없음)** — 단순하나 1년 뒤 탈포화 시드를 영구 사장. 기각 — 자동 archive면 자동 부활이 대칭이고, `archived_reason='saturation'` 스코프로 누적·수동 archive는 부활에서 배제해 안전.
- **(3'') 사람 확인 게이트(flag→archive)** — 검정 가능성은 판단 아닌 사실이라 자동이 맞고, 가드+가역으로 안전. 자동 채택.
- **(4a) 도메인-일치 드롭** vs **(4b) 상관계수 임계 드롭** — 4b(시드 활성 시리즈 vs 신호 시리즈 상관 > 임계)는 도메인-무관이나, 실데이터의 동어반복(루틴 듬성 × 루틴 완료율)이 활성률 60% vs 26%로 phi≈1이 아니어서 임계로 안 잡힘(개념적 자기상관이지 통계적 동일이 아님). 4a 채택 — 구조적으로 "같은 도메인 두 번 잼"을 정확히 겨냥. 행동 시드만 매핑하면 캘린더·사주는 자연 면제. granularity 과제(수면 리듬 시드 × 수면 시간 신호 같은 같은-도메인 다른-facet 쌍 과필터)는 follow-up에서 construct 수준으로 정밀화 여지.

## Consequences

- 날짜 변경이 미룸/당김으로 분리돼 반대 방향 가설을 따로 검정(방향무관 이력 소멸 — 무효 측정이라 무손실).
- 누적 시드 10개 archive — `/build` prod 확인 결과 화 누적 링크 10개는 건강 신호(`health_complaint`·`expense_의료건강`)로 향하고 두 신호 모두 비누적 active 시드에 추가 링크 보유(고아 신호 0). 위임처 `pool_강도_화_강`(active 링크 3)·`pool_강도_목_강`(active 링크 2) 생존 확인. 편재 누적 5개는 링크 0(깨끗한 archive). 강도 밴드 단독 담당 → 측정 채널 단일화 + 세운 변동 자동 적응.
- 포화 가드가 양방향 상시 작동 — baseline 이동으로 죽는 시드를 자동 청소하고, 되살아나는 시드를 자동 복귀. 본인 1명 시스템의 자가 위생·자가 복원.
- 발굴 surface가 cross-domain 후보에 집중 — 동어반복 노이즈가 top-N 슬롯을 안 먹어 휴먼 큐레이션 게이트(ADR-0039 §3) 신호 개선. `discoveryTopN` 5칸이 의미 있는 후보로 채워짐.
- `cumulative_pillar_count` 트리거 코드·`pillar-level-distribution-review` cron 정리(후자 제거, 전자 휴면) → 봇 Life Cron 슬롯 8→7. `pattern_catalog`에 `archived_reason` 컬럼 추가.
- ADR-0036·0039·0044를 **확장**(supersede 아님): 0036 강도 밴드를 누적의 정식 후계로, 0039 사람-큐레이션에 "검정 가능성 자동 위생(양방향)"·"자기상관 자동 필터" 예외를 추가, 0044 데이터-존재 윈도우를 포화/부활 판정 입력으로 재사용. #477 헌장 4개는 불변.
