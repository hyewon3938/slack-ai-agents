# 0028. 사주 시드 운 레벨 차원 도입 + 풀셋 임계치 철학 + 임의값 배제

- Status: Accepted
- Date: 2026-05-28
- Related: #445, 마스터 #434 Phase 2.5
- Tags: data, insight, architecture, process

## Context

마스터 #434 Phase 2(풀세트 시드 카탈로그)를 PR #438로 머지한 직후, Phase 2의 시드들이 다음 한계를 가짐이 드러났다:

1. **운 레벨 무차원**: 같은 십성 기운이라도 일운에 들어올 때와 월운·세운·대운에 들어올 때 체감이 다를 수 있는데, Phase 2 시드는 일운 발현 한 종류만 다룬다.
2. **천간 vs 지지 동등 가정**: 같은 십성도 천간(드러난 기운)과 지지(저변 기운)로 들어올 때 체감이 다를 가능성이 있으나 Phase 2는 별도 비교 시드가 없다.
3. **누적 효과 무차원**: 한 오행이 5개 운 레벨(원국+대운+세운+월운+일운) 중 여러 곳에 동시에 출현할 때 체감이 강해진다는 임상 단서가 있으나 평가 메커니즘이 없다. `element_density` trigger는 원국 비중 single-shot.
4. **임의 임계치·가중치 박지 않음 원칙 충돌**: 누적 효과를 표현하려면 "오행 N개 이상 누적" 같은 임계치가 필요한데, 이 값을 미리 임의로 정하면 v2 헌장 ④(신뢰 비용 분리 — 결정론은 명시 임계치, 자율은 4안전장치) 정신을 위반한다.
5. **지출 카테고리 미연결**: 사주 → 일기 enum 메트릭은 있으나, 사주 → 지출 카테고리 발생 여부 검증 경로가 없다. 화 오행 과다 → `의료/건강` 카테고리 지출 발생 같은 cross-domain 가설을 검증할 길이 닫혀 있음.

이 다섯 한계를 풀려면 한 번에 3개의 설계 결정을 묶어야 한다. 분리 ADR로 쪼개면 결정 사이의 종속성(예: 운 레벨을 도입했더니 누적 카운트가 필요해졌고, 누적 카운트를 도입하려면 임계치가 필요해져서 풀셋 철학 확장이 필요해짐)이 사라진다.

## Decision

**다음 3개 결정을 하나의 ADR로 묶는다.**

### (a) 운 레벨 차원 도입 — `pattern_signals.pillar_level` 컬럼

모든 사주 trigger seed에 `pillar_level VARCHAR(20)` 컬럼을 부여한다. enum: `'wonguk' | 'daeun' | 'seun' | 'wolun' | 'ilun' | 'cumulative'`.

- `'ilun'`: 일운 발현 (Phase 2 시드 161개 기본값 — 마이그레이션 071에서 backfill)
- `'wolun'`, `'seun'`, `'daeun'`: 각 변동 운 레벨 발현
- `'wonguk'`: 원국 발현 (사용자 사주 상수)
- `'cumulative'`: 5개 운 레벨 누적 발현 카운트 trigger (아래 (b)와 결합)

평가 로직(`saju-match.ts:evaluateTrigger`)은 `pillar_level`에 따라 `ctx.daily_pillar` / `ctx.monthly_pillar` / `ctx.yearly_pillar` / `ctx.major_pillar` / `ctx.natal_pillar` 중 어디서 매칭할지 분기한다.

### (b) 풀셋 임계치 철학 — `cumulative_pillar_count` trigger

5개 운 레벨에 같은 오행 또는 같은 십성이 몇 번 출현하는지 카운트하는 새 trigger type을 도입한다. `trigger_aux`에 `{ element?: '목'|'화'|'토'|'금'|'수', sipsin?: 정관|..., count_min: N }` 저장.

**임의 임계치 박지 않는다.** N=1, 2, 3, 4, 5를 **모두 별도 시드로 등록**한다. 어느 N이 본인에게 의미가 있는지는 hit rate 데이터가 결정한다.

이는 Phase 2의 풀셋 시드 철학("어떤 갑자가 본인에게 의미 있는지 모르므로 60갑자 풀셋 전체를 시드로 등록")을 **임계치 차원으로 확장**한 것이다. 동일 정신: "선험적으로 정할 수 없는 값은 풀셋으로 모두 등록 후 데이터가 추출하게."

신규 시드 14개:
- 편재 9개: (a) 일운·월운 천간 편재(2) + (b) 일운·월운 지지 편재(2) + (c) 천간 편재 누적 N=1..5 풀셋(5)
- 화 오행 5개: 누적 N=1..5 풀셋(5)

천간 vs 지지 비교는 `pillar_level='ilun'/'wolun'` × `trigger_target_type='stem'/'branch'` 조합으로 자연스럽게 충돌 없이 매칭된다.

### (c) 임의 가중치 배제 — 자동 분포 분석 cron으로 데이터 추출 자동화

"운 레벨별 가중치"는 **임의로 박지 않는다**. 대신 매주 월요일 09:15 KST에 `pillar-level-distribution-review` cron이 돈다:

```sql
-- 운 레벨별 시드 hit rate 분포 + 누적 카운트 N별 hit rate 분포
SELECT pillar_level, COUNT(*) FILTER (WHERE matched=true) * 1.0 / NULLIF(COUNT(*), 0) AS hit_rate
FROM pattern_catalog c
JOIN pattern_matches m USING (signal_id)
WHERE m.created_at >= NOW() - INTERVAL '90 days'
GROUP BY pillar_level;
```

결과는 결정론 SQL 한 줄 메시지로 `#insight` 채널 발송 ([ADR-0027](0027-llm-async-routine-unification.md) 분류: 결정론 SQL → Node.js cron). LLM 해석 없음.

데이터가 60\~90일 누적된 시점에 **임계치 학습**과 **운 레벨 가중치 적용**을 별도 후속 phase(번호 TBD)로 진행한다. 자동화 cron 자체가 "지금 임계치 학습할 만한가" 시점을 사용자에게 노출하므로 별도 follow-up 이슈가 필요 없다.

## Alternatives considered

### A. 운 레벨 차원 분리 ADR (3개 ADR로 쪼개기)

- 장점: 각 결정의 독립성 명시
- 단점: 결정 사이 종속성이 사라져 6개월 뒤 "왜 이런 시드 구조?"를 추적하려면 3개 ADR을 모두 읽어야 함
- 기각 이유: 3개 결정이 **하나의 일관된 설계 정신(임의값 박지 않기 + 풀셋으로 데이터가 결정하게)**에서 나온 것임. 분리하면 정신이 흩어진다.

### B. 운 레벨을 `trigger_aux`에 묻기

- 장점: 스키마 변경 없이 JSONB 한 줄로 표현 가능
- 단점: (1) 인덱스 못 침, (2) `WHERE pillar_level='ilun'` 분포 쿼리가 무거워짐, (3) Phase 2 시드 backfill이 까다로움
- 기각 이유: `pillar_level`은 **모든 사주 시드가 갖는 1차 차원**. JSONB가 아니라 컬럼이 맞다.

### C. 누적 카운트를 `element_density` 확장으로 처리

- 장점: 새 trigger type 안 만들어도 됨
- 단점: (1) `element_density`는 원국 비중 single-shot. 누적은 5개 운 레벨 합산. 의미가 다름. (2) 십성 누적은 `element_density`로 표현 불가
- 기각 이유: 새 trigger type `cumulative_pillar_count`가 자연스러움. 누적은 첫 1급 개념이지 부산물이 아님.

### D. 임의 가중치 박기 (예: 일운 1.0, 월운 0.5, 세운 0.3, 대운 0.1)

- 장점: 즉시 작동
- 단점: v2 헌장 ④ 위반. 사용자 본인 데이터 누적 없이 "어디서 들은 값" 박는 게 본 마스터 #434 정신(본인 1명 통계, n=1)과 정면 충돌
- 기각 이유: 직접 거절됨 — "미리 임의의 값을 넣어두는 건 좀 별로임" (2026-05-28 인터뷰)

### E. 풀셋 임계치 (선택한 안)

- 장점: 풀셋 철학 일관성(Phase 2 정신 확장) + 임의값 배제 + 데이터가 자연스럽게 의미 있는 N 추출
- 단점: 시드 개수가 늘어남(14개). 매칭 cron 부하 약간 증가
- 한계: 시드 개수 증가는 v2 헌장 ②(결정론 ↔ LLM 자율 역할 분리) 정신상 결정론 쪽이 늘어나는 거라 큰 문제 아님.

## Consequences

### 장점

1. **임상 가설 충실히 검증**: 천간 vs 지지, 운 레벨 차원, 누적 효과 — 3가지 임상 단서를 데이터로 검증 가능
2. **임의값 박지 않는 원칙 확장**: 풀셋 철학이 갑자 차원(Phase 2)에서 임계치 차원(Phase 2.5)으로 일반화됨. 다른 마스터에도 적용 가능한 사고 패턴
3. **자동화로 임계치 학습 노출**: 사용자가 별도 follow-up 이슈를 관리할 필요 없음. cron 발송 자체가 "이제 임계치 추출할 만한가" 트리거가 됨
4. **cross-domain 메트릭 경로 확보**: `expense_category_present` 메트릭으로 사주 → 지출 카테고리 가설(예: 화 과다 → 의료/건강 지출) 검증 가능
5. **인덱스로 분포 쿼리 빠름**: `pillar_level`이 컬럼이라 분포 cron이 가볍게 돌아감

### 단점 / 제약

1. **시드 수 증가**: 161개 → 175개 (8.7% 증가). 매칭 cron 평가 비용 약간 증가 (현재 측정 안 함, 운영 1\~3개월 후 회고)
2. **누적 카운트 평가 시점**: `cumulative_pillar_count` trigger 평가에 `cumulative_pillar_count(natal, daeun, seun, wolun, ilun)` 함수 한 번 더 호출. 일일 매칭 cron 1회만 도므로 무시 가능
3. **임의값 결정의 시점 분리**: "데이터로 임계치 추출"이 미래 후속 phase로 미뤄짐. 60\~90일간은 분포만 누적
4. **`pillar_level='cumulative'` semantic**: pillar_level 자체가 "어느 운 레벨에서 평가하는가"인데 cumulative는 5개 모두를 본다 — 약간의 의미 충돌. 그러나 enum 분기상 `cumulative`만 별도 처리로 가독성 유지

### 후속 작업

- [ ] Phase 2.5 마이그레이션 071 작성 (`pillar_level` 컬럼 + Phase 2 161개 backfill = `'ilun'`)
- [ ] `saju-match.ts:evaluateTrigger` — `pillar_level` 분기 + `cumulative_pillar_count` 케이스
- [ ] `saju-calendar.ts` — `computeCumulativePillarCount` 함수 (원국+대운+세운+월운+일운)
- [ ] `pattern_metrics`에 `expense_category_present` enum 추가
- [ ] `pillar-level-distribution-review` cron — Monday 09:15 KST, 결정론 SQL
- [ ] 14개 신규 시드 SQL (편재 9 + 화 오행 5)
- [ ] 운영 60\~90일 후 후속 phase 진입 시점 검토 (cron 메시지가 트리거)

---

**참고 자료**

- [v2 헌장 ④ 신뢰 비용 분리](../../.claude/projects/-Users-ihyewon-slack-ai-agents/memory/project_insight_v2_core_principles.md)
- [#434 자체 헌장 ①·②](../design-notebook/personal-pattern-discovery.md#핵심-원칙--자체-헌장-변경-불가-변경-시-adr)
- [ADR-0017 사주 60갑자 마스터 정규화](0017-saju-ganji-master-normalization.md) — `element_density` / `sibiunsung` trigger 도입
- [ADR-0026 pattern_* prefix rename](0026-pattern-prefix-rename.md) — 본 ADR의 컬럼이 그 위에서 동작
- [ADR-0027 LLM 비동기 작업 routines 통일](0027-llm-async-routine-unification.md) — 본 ADR의 자동 분포 cron은 결정론 SQL이므로 Node.js cron 잔존
