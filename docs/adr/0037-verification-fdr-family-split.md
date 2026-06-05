# 0037. 검정 FDR 가족 분리 — 강도 feature 시드를 자체 가족으로

- Status: Accepted
- Date: 2026-06-05
- Related: [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), [#485](https://github.com/hyewon3938/slack-ai-agents/issues/485), [ADR-0032](0032-metric-first-verification-statistics.md) (§2 BH-FDR + 발견/확정 q 분리), [ADR-0033](0033-metric-as-hypothesis-and-saju-feature-substrate.md)
- Tags: insight, statistics

## Context

P4a(#485)가 강도 밴드 시드 \~18개(일간 3 + 오행 5×3)를 한 번에 추가한다. 검증 엔진(`verifyUserLinks`)은 active 링크 전부의 p를 모아 BH-FDR을 일괄 적용한다. BH-FDR은 유한 p를 내는 시드만 분모 m에 넣는데(발현일 0 또는 off-day 0인 빈 시드만 NaN 제외), **밴드 시드는 자주 발현해 첫 주부터 유한 p → m을 키운다.** m이 커지면 `(k/m)·q` 임계가 모든 시드에 빡빡해져 — [ADR-0035](0035-graded-confidence-exposure.md)·P3가 "첫 confirm 후보"로 지목한 빠른 `life_signal` 시드(주말·월말)의 확정이 늦어진다. 즉 사주 강도 탐색이 무관한 빠른 트랙에 세금을 매긴다.

## Decision

검정 BH-FDR을 **사전 등록된 시드 가족별로 분리** 적용한다. P4a는 **강도 feature 시드를 자체 가족(`saju_strength`)** 으로 두고, 기존 풀(`life_signal`·기존 사주 트리거·태그 링크)은 종전대로 한 가족(`baseline`)을 유지한다. 가족 키는 `trigger_target_type`/`pattern_kind`에서 파생한다(스키마 변경 없음).

- BH-FDR을 가족 단위로 각각 돌린다 → 한 가족에 시드를 추가해도 다른 가족의 검정 임계 불변.
- 가족 내부는 여전히 함께 보정(같은 batch의 다중검정 비용은 정당히 지불).
- [ADR-0032](0032-metric-first-verification-statistics.md) §2가 이미 "발견/확정 트랙 q 분리"로 FDR 트랙 분할을 허용 — 가족 분리는 같은 메커니즘의 다른 축(사전 등록 batch).

## Alternatives considered

### A. 한 가족 (현행 — 전부 일괄 BH-FDR)

- 장점: 가장 단순·보수적. 전역 FDR 통제(가장 엄격).
- 단점: 강도 18개 추가가 빠른 `life_signal` 확정을 \~2배 빡빡하게. "미리 다 켜두기"(헌장 ④)의 비용이 무관 트랙에 전가.
- 기각: 사용자 의도(강도 탐색이 빠른 트랙을 안 늦추게) 위반.

### B. (선택) 가족 분리 (`saju_strength` | `baseline`)

- 장점: 강도 시드를 다 켜도 빠른 트랙 보호. 사전 등록 batch = 가족이라 통계적으로 방어 가능. 스키마 변경 없음(파생 키).
- 단점: 가족별 통제라 전역 FDR보다 살짝 느슨(가족 늘수록 가족당 거짓발견 여지↑). 가족 경계를 사전 고정해야(사후 조정은 부정).

### C. 3가족 이상 (강도 / 기존 사주 / life_signal 각각)

- 장점: batch별 가장 정밀.
- 단점: 가족 많을수록 전역 통제 약화 + 관리 복잡. P4a 의도(강도 격리)엔 2가족이면 충분.
- 기각(현재): 2가족으로 시작, 필요 시 후속 분할.

## Consequences

### 장점

- 헌장 ④("미리 다 구현, 자동 활성")를 빠른 트랙 비용 0으로 실현.
- 가족 = 사전 등록 batch라 다중검정 회계가 정직하게 유지.

### 단점 / 제약

- 가족 경계는 사전 고정(코드에 박힌 파생 규칙). 가족 추가는 의식적 결정 + 기록.
- 전역 대비 약간 느슨 — n=1 "연관 not 인과" 맥락에서 수용.

### 후속 작업

- [ ] `verifyUserLinks`: 링크를 가족 키로 그룹핑 → 가족별 `bhFdr`.
- [ ] 가족 파생 규칙(`trigger_target_type` → family) 명시 + 테스트.
- [ ] 가족 추가 시 ADR 갱신 규칙.

---

**참고 자료**

- [ADR-0032](0032-metric-first-verification-statistics.md) §2 (BH-FDR + 발견/확정 q 분리)
