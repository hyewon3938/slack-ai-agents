# 0049. 개인화 가중치 집계 레이어 — saju_response_profile

- Status: Accepted
- Date: 2026-06-13
- Related: #523 (마스터), #527, #408 (5-B)
- Tags: insight, statistics, architecture, saju

## Context

검증 엔진(off-day 2×2 + e-value + 가족 BH-FDR)은 (시드 × 신호) = pattern_links 단위로 "이 사주 feature가 발현한 날 이 행동 신호가 달라지는가"를 검정한다. 이 링크 단위 증거를 사주 해석(월운·세운·대운)으로 확장하려면, 흩어진 링크를 **사주 축**으로 모아 "이 사람은 어떤 십성·오행에 어떻게 반응하는가"의 개인화 프로필이 필요하다(#408 5-B 구체화). 단 단순 합산은 세 함정에 빠진다:

- **이중계산**: 글자(천간/지지) 시드와 그 글자가 속한 십성·십성그룹을 따로 세면 같은 증거가 여러 번 가중된다.
- **글자 단위 희소성**: 특정 천간은 \~1/10, 60갑자는 1/60 발현 → 글자 셀만으로는 검정력 확보에 수년. 상위 계층 집계가 통계적으로 필수.
- **승자의 저주(winner's curse)**: 선택된 링크의 raw 효과크기는 체계적 과대 → 가중치 입력이 되는 순간 외삽으로 증폭.

또한 글자 한글 표기에 동음이의가 있다: 천간 辛과 지지 申은 둘 다 한글 "신"이지만 일간 대비 십성이 다르다(정관 vs 편관). 한 셀로 병합하면 안 된다.

## Decision

파생 테이블 `saju_response_profile`(마이그 088)을 두고, 주간 검증 엔진이 confirmed+active 링크를 집계해 **user당 full-replace**한다(트랜잭션). "진실 아님 — pattern_links에서 재생성 가능" COMMENT.

### 축 구조 (이중계산 구조적 차단)

- **계층 축**: 글자 → 십성 → 십성그룹. 글자 레벨은 **천간/지지 분리**(`char_stem`/`char_branch`) — 동음이의 차단, axis_key는 깨끗한 글자 유지.
- **원천 기여 = 링크당 정확히 1 source 셀**: stem→천간글자, branch→지지글자(단일만), hwa_sipsung→십성그룹 직접, strength_band 강×오행→element_band.
- **상위 레벨은 쓰기 시점 결정론 롤업**: 글자 셀이 자기 십성(`getSipsung`/`getJijiSipsung`)·그룹으로 α/β·nActive를 합산해 올라간다. hwa_sipsung은 그룹에 직접 기여 → 그룹 셀 = (십성 롤업) + (hwa 직접).
- **오행은 그룹 셀의 별칭 컬럼**: 일간 고정 시 십성그룹 5 = 오행 5 동형이므로 별도 레벨 저장 안 함(`element` 컬럼).
- **element_band 축(별도)**: 강도밴드 시드 중 **오행 × 강(high) 밴드**만 편입 — 기간 pillar의 오행에 직접 조인. 일간·약·적정 밴드는 비편입(생극 간접추론 배제). relation·sibiunsung·element_density·life_signal은 비편입(v1).

### 읽기 = 단일 레벨 resolution

글자 셀이 게이트 통과(verified 또는 nActive ≥ cellMinActive=15)면 거기서 정지, 미달이면 한 단계 위(십성 → 그룹)로 fallback. **어떤 조회도 두 레벨을 합산하지 않는다.** `resolveHierarchyCell`/`resolveElementBandCell`(Phase 2·3 공용)이 캡슐화. `source_link_ids` provenance 동봉.

### 효과 = shrunk (승자의 저주 차단)

링크 효과는 raw rate ratio가 아니라 `shrunk = posterior_p / rate_off`(둘 다 영속값, 재계산 불요). explained_away 교란 링크는 입력에서 제외, attenuated는 `min(shrunk, 조정 RR)`. 셀 효과는 링크 shrunk의 **nActive 가중평균**. 셀 posterior(α/β)는 합산 — multi-link 셀에서 prior가 누적돼 약간 더 수축되나, n=1·보수적 집계 철학상 안전한 방향.

### tier·stability

confirmed 링크 포함 → verified / nActive·효과 게이트 충족 → emerging / 미달 → 행 생략(무증거 = 행 부재). `stability`(전·후반 효과 부호 일치, 표시용 비게이트)는 셀의 기여 링크가 전부 일치할 때만 true(보수적).

## Alternatives considered

### A. 오행을 별도 레벨로 저장

- 단점: 일간 고정 시 십성그룹과 동형 → 같은 데이터 2벌 + 이중계산 표면. 기각.

### B. 천간/지지 글자를 한 char 레벨로 병합

- 단점: 동음이의(辛/申='신')가 다른 십성으로 가는데 병합하면 롤업이 두 십성으로 동시에 흘러 불변식 깨짐. char_stem/char_branch 분리로 해결.

### C. view·캐시로 집계

- 단점: 십성 매핑·수축·교란 판정이 TS 단일 진실 → SQL view로 옮기면 로직 이원화. 파생 테이블 + 주간 full-replace가 단순·정직(원천은 pattern_links).

### D. 다변량 회귀(elastic net 등)로 가중치 통합 추정

- 단점: 95\~163일 × n=1에 과적합 기계. 링크 단위 증거의 보수적 계층 집계가 옳음. 기각(§7).

## Consequences

### 장점

- 이중계산이 데이터 모델 수준에서 차단(링크당 1 source + 결정론 롤업 + 단일레벨 조회). 불변식 단위 테스트로 고정.
- 글자 희소성을 계층 fallback으로 흡수 → 상위 레벨이 검정력 확보.
- Phase 2(해석)·3(예측 장부)이 `resolveCell` 하나로 기간 pillar를 조인.

### 단점 / 제약

- 파생 테이블이라 측정 로직 변경 시 재생성 필요(주간 run이 자동 충전, full-replace 멱등).
- α/β 합산은 multi-link 셀에서 prior 누적 → 약한 추가 수축(의도된 보수성, 표시 posterior에만 영향 — tier 게이트는 nActive·shrunk 기반이라 무영향).
- element_band가 강 방향만 → 약 방향 작용은 해석 레이어 참고 언급으로만(통계 주장 아님).

### 후속 작업

- [ ] Phase 2: `resolveCell`로 기간 해석 payload 조립(측정 셀 vs 교과서 분리 발화).
- [ ] Phase 3: 예측 장부가 셀 tier·shrunk로 후보 줄세움.
- [ ] relation 링크 confirmed 발생 시 D4 확장 검토(현 비편입).
