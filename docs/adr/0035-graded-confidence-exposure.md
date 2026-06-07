# 0035. 등급별 노출 정책 — 검증됨 / 검증중 / 오늘발현 3-tier

- Status: Accepted
- Date: 2026-06-05
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#483](https://github.com/hyewon3938/slack-ai-agents/issues/483), [ADR-0034](0034-evalue-construction-replay-test-martingale.md) (e-value 게이트), [ADR-0031](0031-daily-insight-synthesis.md) (daily-insight 소비), [ADR-0020](0020-fortune-system-responsibility-split-via-view.md) (`saju_influence_summary` 3층 view)
- Tags: insight, ux, architecture

## Context

P3가 e-value 게이트([ADR-0034](0034-evalue-construction-replay-test-martingale.md))로 "확정(verified)"을 통계적으로 안전하게 만들면서, 검증 결과를 사용자(daily-insight #insight)에게 *어떻게* 노출할지 정해야 한다.

긴장 — **너무 엄격하면**(verified만 노출) 데이터 \~90일 + 느린 e-value 누적 동안 사실상 침묵("몇 달째 아무것도 안 뜸"). **너무 느슨하면** 미검증 경향을 확정처럼 노출 → 확증편향(시스템 존재 이유 위반). 사용자 요구: "확실히 이런 패턴이야 단언은 위험하지만, '요새 이런 경향, 검증중'까지는 알려달라."

추가로 — 현행 `saju_influence_summary.accumulating` tier(발현일 pass율 55%↑)는 **off-day 대조를 안 한다**(발현일 pass율 `a/(a+b)`만 보고 비발현일 `c·d` 미사용). [metric-first 헌장 ②](../design-notebook/metric-first-verification.md)가 경고한 "원래 자주 그럼(기분탓)"을 노출할 수 있는, 지금 켜져 있는 약점.

## Decision

신뢰도를 **3개 tier로 등급화**해 노출한다. 핵심 원칙: **엄격한 게이트는 "검증됨" 주장에만 걸고, 가시성은 별도의 느슨·hedged tier가 나른다.** 단일 임계를 "중간"에 두는 게 아니라 — *라벨이 다른 두 층*.

| tier | 라벨 | 게이트 | 의미 |
|---|---|---|---|
| **verified** | "검증됨" | `e_value ≥ 20` (ADR-0034) | 우연이라 보기 어려움. 느린 금딱지. (여전히 "연관"이지 인과 아님) |
| **emerging** | "요새 이런 경향 — 검증중" | off-day 효과 leaning(`effect ≥ 1.3`) + 튜닝 가능 최소 표본 + e-value 진행 표시 | hedged. 가시성 담당. naive `accumulating`을 **대체** |
| **recent** | "오늘 이 시드 켜짐" | 최근 7일 발현 | 당일 맥락 (기존 유지) |

- **emerging이 accumulating을 대체**: off-day 효과(`rateActive/rateOff`)를 게이트로 쓰므로 헌장 ② 약점을 동시에 수정.
- **e-value 진행 표시**: emerging은 `e=4.2 / 20 (지난주 3.1 → 이번주 4.2)`처럼 누적도를 같이 보여줘, 반복 노출이 오히려 "아직 멀었다"를 상기시킴 → peeking 심리 방어. (주간 스냅샷이 데이터 소스)
- **emerging 바 = 튜닝 노브**(헌장 5 "임의값 박지 않기"): verified 바(`e≥20`)는 원칙값이라 고정, emerging 바는 첫 몇 달 실데이터로 조정. 엄격/느슨을 분리해 따로 돌린다 — 두 층 설계의 이점.

## Alternatives considered

### A. binary — verified만 노출 (emerging 없음)

- 장점: 단순. 거짓 노출 0.
- 단점: \~90일 + 느린 e-value 누적 동안 사실상 침묵. 사용자가 "아무것도 안 뜸"으로 체감.
- 기각: 느린 수율을 침묵으로 만들어 사용자 요구(경향은 알려달라) 위반.

### B. 단일 임계를 "중간"으로 (예: `q ≤ 0.1`이면 노출)

- 장점: 뭔가 뜸.
- 단점: 중간 확신을 확신처럼 노출(라벨 미분리) → 확증편향. 다이얼 하나를 medium에 두는 최악수.
- 기각: 시스템 존재 이유(자기기만 차단)와 정면 충돌.

### C. (선택) 3-tier 등급 노출 (검증됨 / 검증중 / 오늘발현)

- 장점: 침묵 안 함 + 거짓말 안 함(라벨이 신뢰도를 운반). 엄격/느슨 분리 튜닝. accumulating off-day 약점 동시 수정.
- 단점: tier 경계·라벨 카피 설계 필요. emerging 바 calibration 필요(튜닝 노브로 흡수).

## Consequences

### 장점

- 사용자 "단언은 위험, 경향은 알려줘" 요구 충족. **느린 verified 수율이 침묵을 뜻하지 않게** 됨.
- naive accumulating(off-day 누락) → emerging(off-day 효과) 교체로 헌장 ② 정합 회복.
- e-value 진행바가 emerging을 "확정 주장"이 아닌 "쌓이는 중"으로 정직하게 프레이밍 → 가시성과 정직 동시 달성.

### 단점 / 제약

- `saju_influence_summary` view 재정의(2층 → 3층) + daily-insight 소비·카드 카피 변경. daily-insight SKILL(repo 밖 로컬 routine) 동기화 필요(P2 선례 — 배포 직후 적용).
- emerging 바 초기값은 추정 → 실데이터 calibration 전까지 잠정.

### 후속 작업

- [ ] view에 `verified`(status='confirmed') + `emerging` tier 추가, naive `accumulating` 제거
- [ ] emerging 시작 임계 제안 + `insight-thresholds.ts` 외부화
- [ ] daily-insight 소비/카드 3-tier 라벨 반영, SKILL 동기화(배포 직후)
- [ ] 첫 몇 달 운영 후 emerging 바 calibration 재검토

---

**참고 자료**

- [design-notebook Phase 3](../design-notebook/metric-first-verification.md) — 중간 tier 도입 서사
- [ADR-0034](0034-evalue-construction-replay-test-martingale.md) — verified 게이트(e-value)
