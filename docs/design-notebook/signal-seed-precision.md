# 신호·시드 측정 정밀화 (마스터 #508)

> [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477)(매트릭 중심 패턴 검증) · [#504](https://github.com/hyewon3938/slack-ai-agents/issues/504)(발굴 측정 타당성)의 후속. 운영 데이터에서 드러난 신호·시드 측정의 거칠음 3종을 한 PR로 교정한다. [ADR-0046](../adr/0046-signal-seed-precision.md).

## 핵심 원칙

이 마스터는 **#477 헌장 4개 + #504 "측정 타당성 우선"(GIGO) 위에서** 진행한다(헌장 본문은 복제하지 않음 — `project_477_metric_first_verification` 메모리 + [metric-first-verification.md](metric-first-verification.md) / [discovery-refinement.md](discovery-refinement.md) 참조). 본 마스터가 추가로 박는 원칙:

1. **신호·시드는 off-day 대조가 성립하도록 측정돼야 한다 (헌장 ② 강화).** 발현일 vs 비발현일 대조가 검정의 핵심인데, ⓐ 반대 의미를 한 신호로 합산하거나 ⓑ 늘 켜져 off-day가 없으면 대조 자체가 무의미해진다. "정직한 통계" 이전에 "대조 가능한 측정"이 선행조건.
2. **중복 측정 채널은 더 정교한 쪽으로 단일화한다.** 같은 현상(화 기운 강도)을 거친 프록시(누적 카운트)와 정밀 측정(강도 밴드)이 동시에 재면, 정밀한 쪽에 위임하고 거친 쪽은 은퇴. 새 통계 코어는 만들지 않는다([ADR-0033](../adr/0033-metric-as-hypothesis-and-saju-feature-substrate.md)).
3. **검정 불가는 판단이 아니라 사실 — 자동 위생 대상.** off-day≈0이라 수학적으로 검정이 불가능한 시드는 큐레이션 판단([ADR-0039](../adr/0039-pattern-discovery-surface-and-approval-gate.md) 사람 게이트)이 아니라 위생 작업이므로 자동 정리한다. 단 소표본 오판은 최소 윈도우 가드로 막는다.

## 작업 — ①②③④ (한 이슈 = 한 PR, 커밋 분리)

### ① 일정 날짜 변경 방향 분리

`audit_date_changed`(방향무관 `COUNT`)는 미룸(NEW>OLD)·당김(NEW<OLD)을 합산해 반대 가설을 상쇄한다. writer(웹)가 `before_value/after_value`에 날짜를 다 기록하므로 방향 신호 2개(`audit_date_postponed`·`audit_date_advanced`, binary `above_abs` 1, domain=audit)로 분리하고 방향무관은 은퇴. 시드 신호라 LLM SQL 가드 비대상.

### ② 누적 카운트 시드 → 강도 밴드 위임

고정 임계 누적 시드(화·편재 N1~N5, 10개)는 baseline 포화 시 off-day 0 → 죽는다. 본인 화는 운에 늘 깔려 N1~N3이 매일 발현(측정 11/11). 동일 개념을 [ADR-0036](../adr/0036-relative-quantile-strength-bands.md) 강도 밴드가 상대 분위수·주간 재계산·가중치로 더 정밀히 측정 → 누적 10개 archive, `pool_강도_화`·`pool_강도_목`("재성 발현")에 위임. 누적 전용 분포 리뷰 cron 은퇴, 트리거 코드는 휴면.

### ③ 포화 시드 양방향 가드 (archive ⟷ 부활)

주간 엔진이 데이터-존재 윈도우 활성률 ≥0.95 & 윈도우 ≥30일 시드를 자동 archive(`archived_reason='saturation'`, 가역) + 카드 알림. **대칭으로**, 포화-archive된 시드를 매주 현재 윈도우로 재계산(트리거 결정론)해 탈포화되면 자동 부활. ②의 누적(`delegated_to_strength_band`)·수동 archive는 부활 제외. 절대 임계 시드가 세운 변동으로 죽었다 살아나는 걸 손 안 대고 따라감.

### ④ 동어반복(자기상관) 후보 자동 필터

발굴이 **행동 시드 source 도메인 == 신호 도메인**인 쌍(예: 루틴 누락 시드 × 루틴 완료율)을 surface 전 제외. 같은 행동 두 번 잰 자기상관이라 자명하게 무의미. 캘린더 life_signal·사주 시드는 행동 도메인 없어 자동 면제(정상 교차후보 보존). 발굴은 cross-domain 발견이 목적이라 same-domain 제외가 정합.

## 의사결정 분기점

- **누적 시드 처리 (은퇴-위임 / 전부 밴드 전환 / 편재만 십성밴드 / 변별 N만 활성)**: 은퇴-위임 채택. 강도 밴드가 이미 같은 일을 연속값으로 더 정밀히·적응형으로 하고 있어 "고정 N→상대 분포"라는 사용자 요구를 *신규 코드 0*으로 충족. 편재/정재 granularity 손실이 유일한 비용인데, `pool_강도_목`이 이미 "재성"으로 라벨돼 손실이 작음.
- **날짜 방향 깊이 (2방향 / 방향+임박도 맥락 / 미룸만)**: 2방향 채택. n=1이라 날짜 변경 자체가 드물어, 임박도(오늘→미래 vs 미래→미래)까지 4분할하면 신호당 표본이 희박. 2방향이 신호/노이즈 균형점. 임박도는 2방향이 거칠면 후속.
- **포화 처리 (자동 archive / 사람 확인 flag)**: 자동 채택. 검정 불가는 사실이라 사람 게이트가 불필요하고, 최소 윈도우 가드 + 가역으로 소표본 위험을 덮음. ADR-0039 사람-큐레이션에 "검정 불가 자동 위생" 예외를 명문화.
- **포화 부활 (archive-only / 양방향)**: 양방향 채택. 사용자가 "늘 켜진 시드가 1년 뒤 탈포화되면 다시 발굴되나?"를 지적 → archive-only는 죽은 시드를 영구 사장하는 빈틈. "자동으로 끄면 자동으로 켜기"가 대칭이고, `archived_reason='saturation'` 스코프로 누적(강도밴드 영구 대체)·수동 archive는 부활 제외해 안전. (단 강도 밴드는 상대 분위수라 애초에 포화 불가 → 누적 위임분은 이 문제에서 자유.)
- **동어반복 필터 (도메인-일치 드롭 / 상관계수 임계)**: 도메인-일치 채택. 상관 임계(4b)는 도메인-무관이라 매력적이나, 실데이터 자기상관(루틴 듬성 × 루틴 완료율)이 활성률 60% vs 26%로 phi≈1이 아니라 임계로 안 잡힘(개념적 자기상관 ≠ 통계적 동일). 도메인-일치가 "같은 행동 두 번 잼"을 구조적으로 정확히 겨냥. 행동 시드만 매핑하면 캘린더·사주 시드는 자연 면제.

## 포기 / 미룬

- **편재 십성 강도 밴드 신설** — 보류. 양목/음목(편재/정재) 분리가 임상적으로 중요하다고 판명되면 그때 substrate 확장. 지금은 `pool_강도_목`으로 충분.
- **임박도 맥락 신호(오늘→미래 vs 미래→미래)** — 보류. 2방향 운영 후 재평가.
- **`cumulative_pillar_count` 데드코드·트리거 타입 제거** — 휴면 유지. CHECK 제약 건드리는 cleanup은 별도.
- **동어반복 필터 construct 수준 정밀화** — v1은 도메인 단위 드롭. 같은-도메인 다른-facet 쌍(수면 리듬 시드 × 수면 시간 신호)을 과필터할 수 있어, 과필터가 실제 관측되면 construct 수준(파생 metric 일치)으로 정밀화. 지금은 도메인 단위로 충분.

## 기술적 의의

n=1 자동 통계 시스템에서 "더 정교한 측정 채널이 이미 있으면 거친 채널은 은퇴가 정답"이라는 단일화 판단을, 신규 코드 없이 기존 substrate(강도 밴드) 재사용으로 수행. 측정 불가능성(off-day 0)을 큐레이션 판단과 분리해 자동 위생으로 환원 — 사람 게이트는 "믿을지"에만 쓰고 "검정 가능한지"는 기계가 판정.

## 결과 / 회고

PR [#509](https://github.com/hyewon3938/slack-ai-agents/pull/509)로 ①②③④ 한 PR(커밋 분리) + 도메인 문서 마감. 마이그레이션 `086`. 전체 797 테스트 통과, prod dry-run(BEGIN/ROLLBACK)으로 ①②(2신호 신설·10시드 위임) 검증.

**빌드 중 교정 2건**:

1. **포화 판정 축을 `matched` → `trigger_activated`로 교정.** 계획 초안은 `seed_daily_activations.matched`로 활성률을 집계하려 했으나, `recordDailyMatches`를 읽어보니 `matched`는 연결 매트릭 통과 여부(evidence-only 시드는 `null`)였다. 포화는 *트리거가 늘 켜지는가*의 문제 → off-day 대조의 활성 축인 `trigger_activated`가 정확. `matched` 기준이었으면 대다수 시드(evidence-only)를 놓쳤을 것.
2. **`BEHAVIOR_DOMAIN`(#504 데이터-존재 윈도우)의 `slotGap`/`weekComparison` → schedule 오기 발견.** 실제 `insights.ts` detect 함수는 `routine_records` 완료율을 재고 `domain: 'routine'`을 선언. ④는 `insights.ts` 진실(`BEHAVIOR_SIGNAL_DOMAIN`)을 source로 써서 정확. #504 데이터-존재 맵 교정은 본 PR 범위 밖 → 후속.

**운영 핸드오프**: 배포 후 첫 월요일 06:00 주간 엔진이 포화 sweep 첫 실행. ② 위임으로 발굴 후보가 재편되므로 배포 전 발굴 후보 승인 보류 → 배포 후 재발굴이 정합. ③ 부활은 saturation-archive 시드가 생겨야 작동(초기 거의 0건, forward guard).

**후속(미룬 것)**: 편재 십성 강도 밴드 신설 / 임박도 맥락 신호 / `cumulative_pillar_count` 데드코드 cleanup / 동어반복 construct 수준 정밀화 / `BEHAVIOR_DOMAIN`(#504) slotGap·weekComparison 도메인 교정.
