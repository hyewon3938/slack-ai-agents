# 0042. 교란 다변량 분리 — Mantel-Haenszel 층화 + 데이터 게이트 + 노출 레이어 soft-demote

- Status: Accepted
- Date: 2026-06-06
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#495](https://github.com/hyewon3938/slack-ai-agents/issues/495), [ADR-0032](0032-metric-first-verification-statistics.md) (§6 교란 데이터 게이트 — 다변량 방법 지명 정련), [ADR-0041](0041-confound-cofiring-flag.md) (P6 marginal 플래그 + nCofire 기록), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md) (feature 환원), [ADR-0034](0034-evalue-construction-replay-test-martingale.md) (e-value 결정론 리플레이), [ADR-0035](0035-graded-confidence-exposure.md) (3-tier 노출), [ADR-0037](0037-verification-fdr-family-split.md) (FDR 가족)
- Tags: insight, statistics, architecture

## Context

off-day 검증(P2)은 단일 시드의 **marginal 연관**만 본다. [ADR-0041](0041-confound-cofiring-flag.md)(P6)은 같은 날 공존하는 제3변수 Z(달력 주기 또는 다른 사주 시드)가 시드 S와 신호 X 둘 다를 끌면 생기는 가짜 연관(교란·"어부지리")을 **marginal 플래그**로 노출하고, 각 (링크 × 교란 Z)의 공동발현일 수 `nCofire`를 "P7 데이터 게이트 입력"으로 기록해뒀다(annotate-only — verdict·status·e-value·tier 불변).

[ADR-0032](0032-metric-first-verification-statistics.md) §6은 교란 *조정*(추정치 보정)을 데이터 게이트 자동 활성으로 위임했다 — "두 시드 공동발현 횟수가 임계(예: 30일) 넘으면 자동으로 다변량 점검 on, 그 전엔 플래그만. 다변량은 **확정 후보 한정 + 트리거 2\~3개 한정 + elastic net**(ridge 소표본 불안정, full MLE 과적합)." 본 ADR은 그 **조정 절반(Phase 7, 마스터 #477 마지막 phase)** 을 확정한다.

§6은 다변량 방법으로 elastic-net을 지명했지만, 이는 *회귀 패밀리 내부* 비교(elastic-net이 ridge·full MLE보다 소표본에 안정)였고 **층화(Mantel-Haenszel)는 References에만 있었다**. [ADR-0041](0041-confound-cofiring-flag.md) 후속작업은 이미 "층화/elastic-net"로 둘 다 열어뒀다. 본 시스템의 실제 데이터 형태에서 방법을 다시 골랐다:

- 시드 S·신호 X·교란 후보 Z가 **전부 결정론 binary** (off-day 2×2가 이진화, 교란 후보는 18 달력 `life_signal` + 사주 시드의 boolean 활성 시리즈).
- §6이 교란을 "트리거 2\~3개 한정"으로 캡.
- n=1 \~90일 → 공동발현 데이터 희소.

binary 노출·결과를 소수 범주형 교란으로 조정하는 것은 **Mantel-Haenszel 층화의 교과서적 용례**다.

## Decision

교란 다변량 분리를 **Mantel-Haenszel 층화로 dormant 빌드**하고(elastic-net은 후속 노브), 데이터 게이트로 자동 활성하며, 조정 결과를 **노출 레이어에서만** 반영해 통계 확정 상태의 결정론을 보존한다.

### 1. 방법 = Mantel-Haenszel 층화 (1차), elastic-net = 후속 노브

교란 후보 Z로 층(Z-on / Z-off)을 나눠 각 층에서 (시드 S × 신호 X) 2×2를 재계산하고 MH로 풀링해 **조정 rate ratio**를 얻는다. 기존 `buildContingency`를 층별 날짜 부분집합에 두 번 호출 + MH 풀링 공식 하나가 전부 — **새 통계 코어는 풀링 함수 하나**(P4a\~P6 "새 통계 코어 0" 연속 이후, 마스터가 끝까지 미뤄둔 *유일한* 다변량 조각이자 가장 가벼운 형태).

MH를 §6 지명 elastic-net보다 1차로 두는 근거:

- **재사용·환원**: 층별 2×2 = P6가 쓰는 그 프리미티브. elastic-net은 페널티 GLM 솔버(좌표하강 + λ 선택)를 순수 TS로 신설 = 진짜 새 코어, ADR-0032 "무거운 외부 패키지 지양" 제약과 긴장.
- **스케일 정합**: MH 조정치는 rate ratio라 시스템이 이미 쓰는 척도(`minRateRatio`=1.3, 카드·뷰 문구)와 직접 비교 가능. elastic-net 계수는 log-odds = 이질 척도.
- **데이터 적합**: binary×binary×교란 2\~3개 + 소표본엔 층화가 회귀보다 자연·강건. λ 교차검증은 n=1에서 불안정.

elastic-net은 **교란이 층화 한계(joint strata 폭발)를 넘는 다수일 때**를 위한 후속 노브로 기록(기본 off). 깊이는 rewrite가 아니라 노브 + SET 리플레이로 미래 비용(헌장 ④·⑤).

### 2. 데이터 게이트 = nCofire ≥ 30 (노브, 헌장 ④)

(링크 × 교란 Z)의 공동발현일 `nCofire ≥ confoundAdjustMinCofire`(초기 30, [ADR-0032](0032-metric-first-verification-statistics.md) §6 "예: 30일" + [ADR-0041](0041-confound-cofiring-flag.md) "\~30")인 쌍만 조정한다. P6 flag floor(`minCofireDays`=10)보다 높게 — 층별로 갈라도 추정이 서는 데이터를 확보. 미달이면 조정하지 않고 P6 marginal 플래그를 유지(dormant). 현재 데이터에선 거의 모든 링크가 미달이라 **배포 시 동작 변화 0**, 공동발현이 쌓이면 자동 on. 각 층의 불일치(discordant) 셀 최소 데이터는 빌드 calibration.

### 3. 노출 레이어 soft-demote (e-value·status 불변)

조정 결과를 `pattern_links.confound` JSONB에 첨부한다 — 게이트 통과 교란별 `{seedId, nCofire, adjEffect}` + 링크 verdict(`survives` / `attenuated` / `explained_away`). 조정 후 효과가 confirm floor 밑으로 떨어지면(`explained_away`) **`saju_influence_summary` verified tier에서 강등** + caveat 노출.

단 **e-value·status는 건드리지 않는다.** e-value는 순서 있는 데이터의 순수 함수(결정론 리플레이, [ADR-0034](0034-evalue-construction-replay-test-martingale.md))이고 그게 marginal 진실의 기록이다. 조정은 *노출*(사용자에게 도달하는 것)에만 작용하므로 마틴게일 불변성이 깨지지 않는다. P6=노출(marginal 정직), P7=조정(노출에 반영). [ADR-0041](0041-confound-cofiring-flag.md) §C가 "강등은 추정치 판단이라 P7 다변량 분리 결과로 해야 정직"이라 한 것의 실현이되, 강등 지점을 status가 아닌 노출 레이어로 둬 결정론을 보존.

시드 단위 집계 귀결: 한 시드의 confirmed 링크가 **모두** `explained_away`면 verified에서 강등, 하나라도 살아남으면 verified 유지(보수적). `confound_note` 컬럼으로 caveat 텍스트를 뷰가 노출 → daily-insight 소비.

### 4. always-compute-when-gated + NULL-safe 뷰

조정은 매 주간 run마다 게이트 통과 쌍만 계산(P6 플래그 패스에 fold — 시리즈 이미 in-hand). 미게이트·미조정 링크는 `confound.adjusted` 없음 → 뷰가 NULL-safe로 오늘과 동일하게 동작. 마이그레이션은 뷰 재정의 only(새 테이블 0 — 조정치는 기존 `confound` JSONB에 산다).

### 5. 노브 외부화 (헌장 ⑤)

`insight-thresholds.confound`에 `adjustMinCofire`(30) + `explainAwayMaxEffect`(조정 후 이 값 미만이면 explained_away, 초기 `minRateRatio`=1.3 승계) 추가. calibration 노브(첫 몇 주 튜닝). elastic-net 활성 플래그는 기본 off 노브.

## Alternatives considered

### A. elastic-net 페널티 로지스틱 1차 (ADR-0032 §6 문자 그대로)

- 장점: 교란 다수를 한 번에 조정, §6 지명.
- 기각(1차로는): 페널티 GLM 솔버 = 새 통계 코어, log-odds 이질 척도, n=1 λ 선택 불안정. binary×교란 2\~3개엔 MH가 더 가볍고 강건. **후속 노브로 보존**(층화 한계 초과 시).

### B. status·e-value 직접 강등

- 장점: 더 강한 보수성, 단일 진실.
- 기각: e-value는 결정론 리플레이([ADR-0034](0034-evalue-construction-replay-test-martingale.md))라 외부 조정 주입 시 매주 SET 재계산 불변성이 깨진다. 노출 레이어 분리가 결정론 보존.

### C. caveat-only (조정치 첨부, 강등 안 함)

- 장점: 진짜 패턴 살해 위험 0.
- 기각: P6 annotate-only와 차이가 거의 없어 P7의 존재 의의가 옅어진다. [ADR-0041](0041-confound-cofiring-flag.md) §C가 강등을 P7 조정 결과의 일로 명시.

### D. 새 confound 전용 회귀 검정 (조건부 로지스틱)

- 기각: §6 "다변량은 elastic net" + 본 ADR MH 1차로 충분. n=1 회귀 부담.

## Consequences

### 장점

- MH가 P6의 2×2 프리미티브를 층별 재사용 → 새 통계 코어는 풀링 함수 하나(마스터 최후 다변량 조각, 최소 형태).
- 조정치가 rate-ratio 척도라 카드·뷰·임계와 직접 정합.
- 데이터 게이트 dormant → 배포 시 동작 변화 0, 공동발현 누적 시 자동 활성(헌장 ④).
- e-value 결정론 보존 — 노출만 조정.

### 단점 / 제약

- MH는 교란 소수(2\~3 binary)에 한정 — 초과 시 joint strata 폭발 → elastic-net 후속 노브 필요.
- n=1 희소라 게이트(30)는 단기엔 거의 미충족(예상된 dormant, 빈손 아닌 "데이터 부족" 정직).
- 교란 다수일 때 joint vs sequential 층화는 calibration 선택(빌드).

### 후속 작업

- [ ] elastic-net 노브 활성 조건(교란 수 > 층화 한계) + 차원축소 — 데이터·교란 누적 후.
- [ ] joint/sequential 층화 calibration, 층별 최소 셀 임계 튜닝.
- [ ] 교란 조정 정책·임계 변경 시 본 ADR 갱신.

---

**참고 자료**

- [ADR-0032](0032-metric-first-verification-statistics.md) §6 (교란 데이터 게이트), References의 Mantel-Haenszel(교란 통제와 한계)·elastic-net(소표본 penalized 회귀)
- [ADR-0041](0041-confound-cofiring-flag.md) (P6 marginal 플래그 + nCofire 데이터 게이트 입력)
