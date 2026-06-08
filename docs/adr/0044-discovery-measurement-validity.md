# 0044. 발굴·검증 측정 타당성 — 데이터-존재 윈도우 + 연속신호 효과크기 랭킹

- Status: Accepted
- Date: 2026-06-08
- Related: [#504](https://github.com/hyewon3938/slack-ai-agents/issues/504), [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477) (계승·교정), [ADR-0032](0032-metric-first-verification-statistics.md) §4 (연속신호 이진화 금지·효과크기), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (off-day 2×2 substrate), [ADR-0034](0034-evalue-construction-replay-test-martingale.md) (e-value 확정 게이트), [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md) (발굴 surface + 승인 게이트)
- Tags: insight, statistics, architecture

## Context

#477 첫 주간 발굴(2026-06-08 06:00)이 surface한 5개 후보가 전부 "루틴 streak × 수면/일정" 류였고 effect 150\~184배로 상위를 독식, 사주 후보를 밀어냈다. 진단 결과 측정 아티팩트였다:

- 발굴 윈도우는 `windowCapDays=365` 고정인데, 운영 초기라 실제 데이터는 그보다 짧은 구간에만 존재. 연속신호 SQL이 `COALESCE(SUM(...),0)`이라 데이터 없는 날을 "0(=낮음)"으로 채워, 비발현일 pass율(rateOff)이 0에 수렴 → `effect = rateActive / rateOff`가 폭증. 실질은 "데이터 있는 최근 구간 vs 텅 빈 과거"를 대조한 **시간 교란**.
- 통계 안전장치(Fisher·block-perm·BH-FDR·e-value)는 **"우연이냐"만 검정**한다. 체계적 측정 아티팩트는 우연이 아니라 매일 일관돼 모든 검정을 통과한다(GIGO). 안전장치는 측정 타당성을 보지 않는다.
- 발굴이 연속신호를 이진화한 rate ratio로 랭킹하는 것은 **[ADR-0032](0032-metric-first-verification-statistics.md) §4("연속신호 이진화 금지, 분포를 Mann-Whitney + 효과크기로 비교")와 어긋난다.** 검증 엔진(`verifyUserLinks`)은 MW/Hodges-Lehmann을 계산하나, 발굴(`discoverCandidates`)은 raw를 버리고 이진 2×2 effect만 쓴다.
- 부수: 동일 정의(이름+SQL) 신호가 `signal_defs`에 중복 row로 존재 → 동일 후보 카드가 2장씩 surface.

## Decision

### 1. 측정 윈도우 = 데이터-존재 구간 (per-pair overlap)

고정 `windowCapDays` 대신, (시드 × 신호) 쌍의 **데이터 존재 구간** `[max(seedDataStart, signalDataStart), today]`로 윈도우를 한정한다.

- `signalDataStart` = 신호 `domain` → 소스 테이블의 사용자 `MIN(date)` (schedule→schedules, sleep→sleep_records, routine→routine_records, expense→expenses, diary_meta→diary_meta_tags). tag 신호는 해당 태그 첫 등장일.
- `seedDataStart` = life_signal 시드는 트리거 소스 테이블 `MIN(date)`, 달력 기반 saju 시드는 제약 없음(= 전체 온보딩).
- 온보딩 이전 빈 날은 2×2에서 제외한다. 단 **활성 구간 내 "기록 없음"은 의미를 유지** — 신호별로 0의 의미가 다름(`schedule_count=0`은 진짜 0, `sleep=0`은 사실상 결측). 윈도우 한정이 결측-as-0 교란을 제거하되 유효 0은 보존.
- 검증·발굴 공통 프리미티브(`pattern-verification.ts`)에 적용 → 양쪽 다 정직한 측정. `windowCapDays`는 상한 안전장치로만 잔존.

### 2. 발굴 연속신호 랭킹 = 효과크기 (ADR-0032 §4 정렬)

발굴의 후보 스크리닝·랭킹에서 **연속신호는 이진화 rate ratio 대신 효과크기**(Hodges-Lehmann 중앙값 차 / Mann-Whitney)를 쓴다. `stats.ts`의 `mannWhitneyU`·`hodgesLehmann` 재사용(새 통계 코어 0). 이진신호(tag·flag)는 기존 2×2 연관 지표 유지.

- **e-value 확정 게이트는 불변** — 확정 트랙은 ADR-0033 substrate(이진 2×2) + ADR-0034 e-value를 그대로 유지한다. 본 결정은 *발굴 surface 랭킹*에 한정(노출·큐레이션 층, ADR-0039 §2 발견 q 트랙). 연속신호도 승인 후엔 동일 e-value 트랙으로 확정.
- top-N 정렬 키를 신호 타입별로: 연속 = 효과크기, 이진 = rate ratio. 단일 비교를 위해 표준화 점수로 통일(스케일 상이).

### 3. 중복 신호 정규화

동일 `(user_id, name, kind, sql_body, direction, value_type)` `signal_defs`를 1개 canonical(최소 id 또는 `source='seed'`)로 통합, `pattern_links`를 canonical로 repoint(`UNIQUE(seed_id, signal_id)` 충돌 시 병합), 잉여 row 비활성. 생성 경로에 idempotency 가드(name+sql 기준)로 재발 차단.

## Alternatives considered

- **고정 365 유지 + 결측을 null로 전면 제외** — 활성 구간 내 유효 0(예: 일정 0개)까지 버려 정보 손실. 기각 — 윈도우 한정이 빈 과거만 정확히 제거하고 유효 0은 보존.
- **전역 온보딩 마지노선만 (per-pair 아님)** — 단순하나 신호별 시작일 차이(일정·루틴·수면 상이)를 무시해 늦게 시작한 신호 초입에 잔여 교란. per-pair overlap이 더 정확.
- **rate ratio 유지 + 분모 하한 캡만** — 폭증은 막으나 §4 정보손실 36% 잔존. 기각 — §4 정렬이 정도(正道).
- **연속신호 확정 트랙까지 전면 비이진화(e-value 대체)** — ADR-0034 e-value 게이트를 연속용 anytime-valid로 재설계해야 함. 과함 — 발굴 랭킹 교정만으로 아티팩트·§4 갭 해소. 확정 트랙 비이진화는 별도 트랙으로 보류.

## Consequences

- 검증 결과가 1회 re-baseline됨 — 교정된 윈도우로 e-value·effect 재계산(결정론 리플레이라 매주 SET 갱신으로 자연 수렴). 과거 아티팩트 인플레가 제거된다. confirmed sticky 링크 영향 점검 필요.
- 발굴이 정직한 후보를 surface → 사주·생활 후보가 효과크기 기준 공정 경쟁. 헌장 ②(off-day 대조 정확도) · ADR-0032 §4 정합 회복.
- 중복 카드 제거 → 휴먼 큐레이션 게이트(ADR-0039 §3) 신호 개선.
- 후속(Phase 2 카드 라벨 · Phase 3 재추천)은 본 측정 교정 위에 얹는다 — 망가진 측정 위 UX는 무의미("측정 먼저" 원칙).
- ADR-0032·0039를 **교정**(supersede 아님): §4의 발굴 적용을 명문화하고 윈도우 노브를 재정의. 헌장 4개는 불변.
