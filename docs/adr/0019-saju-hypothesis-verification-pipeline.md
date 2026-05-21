# 0019. 프로액티브 인사이트 v2 Phase 4 — 가설-검증 정량 파이프라인

- Status: Accepted
- Date: 2026-05-21
- Related: [#392](https://github.com/hyewon3938/slack-ai-agents/issues/392), [#393](https://github.com/hyewon3938/slack-ai-agents/issues/393) (마스터), [#408](https://github.com/hyewon3938/slack-ai-agents/issues/408) (Phase 5 분리), [#409](https://github.com/hyewon3938/slack-ai-agents/issues/409) (Opus 이관)
- Tags: data, llm, statistics

## Context

Phase 3 ([ADR-0017](0017-saju-ganji-master-normalization.md))에서 60갑자 마스터 정규화 + 시드 catalog + 일일 매칭 + outcome 검증 구조를 구축했다. 사용자가 임상적으로 관찰한 16개 사주 가설을 시드로 등록 → 일일 매칭으로 hit/miss 누적 → 약한 시드 자동 식별까지 작동한다. 그러나 다음 단계 — **"이 시드들 중 어떤 게 진짜 통계적으로 유의한가? 또 시드로 등록 안 된 새 가설은 어떻게 발견하나?"** — 가 미정의 상태였다.

원래 마스터 #393 Phase 4 정의(이슈 #392)는 "사주 × 라이프 Hybrid Pipeline 정량 검증"으로 정성 분석 위주의 weekly-saju-review 재설계를 목표로 했으나, Phase 3 진행 중 시드 작성 책임이 Phase 3로 이동하면서 Phase 4의 scope가 **시드 outcome 데이터의 통계 검정 + LLM 자율 후보 발견 + 가설 운영 사이클 정립**으로 재정의 필요해졌다.

추가 제약:
- **Phase 5 (월운·세운·대운 시기 단위 확장, [#408](https://github.com/hyewon3938/slack-ai-agents/issues/408))은 별도 마일스톤** — 이전에 #392 본문이 시기 단위 확장도 포함했으나 Phase 4 인터뷰에서 분리 결정
- **1인 환경 + 60일 누적 데이터의 통계적 한계** — 일부 시드는 60일에 0\~3회 발현. 정식 검증은 불가, 1차 탐색 + 가설 등록이 현실적 목표
- **v2 헌장 cross-check 통과 필요** — LLM 텍스트 의존 최소화, 결정론 ↔ LLM 자율 분리, outcome-based 검증, 신뢰 비용 분리

## Decision

**가설-검증 정량 파이프라인** 도입:

### 인프라

```sql
-- 가설 정의 (사용자가 자동 발견 후보 중 선택해 등록)
CREATE TABLE saju_hypotheses (
  id              SERIAL PRIMARY KEY,
  trigger_spec    JSONB NOT NULL,        -- 시드 catalog 참조 또는 신규 조합
  enum_target     TEXT NOT NULL,         -- diary_meta_tags.tag
  status          TEXT NOT NULL DEFAULT 'active',  -- active | confirmed | rejected | archived
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  notes           TEXT                    -- 사용자 임상 설명
);

-- 주간 검증 결과 누적 (시계열)
CREATE TABLE saju_stats (
  id              SERIAL PRIMARY KEY,
  hypothesis_id   INTEGER NOT NULL REFERENCES saju_hypotheses(id),
  week_start      DATE NOT NULL,
  n_trigger_days  INTEGER NOT NULL,
  n_total_days    INTEGER NOT NULL,
  rate_trigger    NUMERIC(6,4) NOT NULL,
  rate_baseline   NUMERIC(6,4) NOT NULL,
  rate_ratio      NUMERIC(8,4) NOT NULL,
  raw_p           NUMERIC(10,8) NOT NULL,
  fdr_q           NUMERIC(10,8) NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hypothesis_id, week_start)
);
```

### 통계 알고리즘

- **검정**: Fisher's exact test (소표본 + 이진 outcome에 robust, t-test는 부적합)
- **효과 크기**: rate ratio = (trigger 발현일의 enum 빈도) / (비발현일의 enum 빈도)
- **최소 샘플**: trigger 발현 ≥ 5일 (n<5는 "샘플 부족"으로 skip, 강제 검정 X)
- **유의 필터** (1차 탐색용): raw p<0.1 AND BH-FDR q<0.2
- **다중 비교 보정**: BH-FDR — 시드 × enum 수백 조합 동시 검정 시 false positive 통제

### 운영 사이클

1. **자동 패턴 발견** (시드 등록 후보 발굴, 트리거 모드 2종):
   - **1차 셋업 모드**: 사용자가 수동 1회 실행 → 시드 전체 × 누적 enum × 과거 데이터 → 유의 후보 N개 → 사용자가 골라 가설 등록 (Phase 4 도입 시점)
   - **운영 모드**: 주간 cron 자동 → 새 enum/누적 데이터 변동분 → 후보 발견 → Slack Block Kit 카드로 사용자에게 제안
   - 같은 인프라 (Fisher's exact + FDR), 트리거만 다름

2. **가설 lifecycle**:
   - `active` → `confirmed`: n_trigger_days ≥ 30 AND fdr_q < 0.05 안정적
   - `active` → `rejected`: n_trigger_days ≥ 30 AND rate_ratio → 1 수렴 (효과 없음 확정)
   - `active` → `archived`: 사용자 수동 폐기

3. **주간 검증 cron** — 월요일 08:00 KST, 전주 데이터 기준:
   - active 가설 전체에 대해 saju_stats INSERT
   - 상태 자동 전이 (confirmed/rejected)
   - `#insight` 채널에 Block Kit 리포트 (가설별 현재 통계 + 직전 주 대비 변화)
   - 신규 자동 발견 후보도 같은 리포트에 첨부

4. **confirmed 가설 → 일일 잔소리 통합**: Phase 1 결정론 SQL 11패턴에 **확장 슬롯**으로 자동 합류. 매일 09:00 cron이 11패턴 + active confirmed 가설 모두 평가 → trigger 발현일이면 잔소리 후보로 추가. 기존 11패턴 코드 무수정.

5. **신규 cron `weeklyHypothesisReview` 추가**: notification_settings에 슬롯 신규 등록. 기존 `weeklyReport` (Phase 1 결정론 SQL 주간 리포트)는 분리 유지 — 목적이 다름. ADR-0011 등 과거 문서에 언급된 `weekly-saju-review` cron은 v2 이전에 폐기된 routine이라 재설계 대상 아님.

### LLM 사용 범위

- **유지**: diary → diary_meta_tags enum 추출 (현 Sonnet, [#409](https://github.com/hyewon3938/slack-ai-agents/issues/409)에서 Opus 이관)
- **신규**: 자동 패턴 발견에서 LLM 사용 X (Fisher's exact + FDR로 결정론 검정). 가설 카드 짧은 자연어 설명 정도만 Sonnet 사용 가능

### enum 확장 (16 → 22)

기존 16개 + 6개 신규 (Phase 4 도입 시 migration):
- `wealth_awareness` — 돈 관련 인식·결정·기회 (사주 재성 매핑 직결)
- `self_observation` — 본인 사주 패턴·신살·일진을 직접 언급 (가설 검증 골드 시그널)
- `social_activity` — 가족·친구·지인 만남/통화 (비겁/관성 매핑)
- `physical_activity` — 운동·산책·외출 (역마 매핑)
- `task_completion` — 업무·과제 처리/완료 (식상/관성 매핑)
- `clumsy_overflow` — 실수·물건 떨어뜨림·놓침 (충/공망 매핑)

`self_observation`은 `analytical_mode`·`deep_thought`와 겹치지 않도록 "본인 사주·신살·일진 직접 언급"으로 정의 좁힘. SYSTEM_PROMPT에 예시 1\~2개 명시.

## Alternatives considered

### A. 최소 샘플 3일 + p<0.05 만 사용

- 장점: 가설 발견 폭 ↑, 운영 1\~2개월 만에도 confirmed 발생 가능
- 단점: n=3는 Fisher's exact 검출력 거의 0 — false positive 폭증. 다중 비교 무시하면 60일×시드 100개×enum 22개 = 2,200 조합 중 100여 개가 우연히 유의로 잡힘
- 기각 이유: 1차 탐색이라도 노이즈만 양산. 신뢰 비용 분리 원칙 위배

### B. t-test 또는 Cohen's d 사용

- 장점: 학계 친숙도 높음, 효과 크기 표준 지표
- 단점: t-test는 연속 변수·정규분포 전제 — diary_meta_tags는 이진(있음/없음)이라 부적합. Cohen's d는 효과 크기만 있고 유의 검정 안 함
- 기각 이유: 데이터 형식 불일치. Fisher's exact가 작은 샘플 + 이진 outcome에 가장 robust

### C. 가설 검증 주기를 매일

- 장점: 즉각 피드백
- 단점: 매일 1일 추가 = 통계 거의 안 바뀜. 가설 5\~10개 × 매일 = 사용자 인지 과부하
- 기각 이유: 주간 호흡이 적절. 일일은 잔소리로 별도 채널 (confirmed 통합 슬롯)

### D. confirmed 가설을 결정론 11패턴과 분리 운영

- 장점: 가설 영역 깔끔. 11패턴 코드 변경 0
- 단점: 어렵게 검증한 가설을 일상에 못 씀. confirmed 의미 약화
- 기각 이유: 확장 슬롯 패턴으로 통합해도 11패턴 코드 무수정 가능 — 분리 이점 사라짐

### E. 웹 대시보드에서 가설 그래프 제공

- 장점: 시계열 시각화 직관적
- 단점: Phase 4 작업량 ↑. Slack Block Kit으로 충분히 운영 가능
- 기각 이유: Phase 4 범위에서 보류. 운영 후 필요해지면 별도 phase

### F. 시기 단위 확장(월운·세운·대운)을 Phase 4에 포함

- 장점: 사주 매칭 인프라 한번에 확장
- 단점: 통계 사이클 길이 차이로 검증 메커니즘 자체가 다름 (월운 \~2년, 세운 \~28년). 가설 검증 인프라와 작업 성격이 다름
- 기각 이유: Phase 5([#408](https://github.com/hyewon3938/slack-ai-agents/issues/408))로 분리. Phase 4는 가설 검증 인프라에 집중

### G. (선택) Fisher's exact + BH-FDR + n≥5 + p<0.1 / q<0.2 (Decision 섹션 참조)

- 장점: 1차 탐색에 적절한 보수성, 다중 비교 자동 보정, 1인 환경 소표본 robust
- 단점: 60일 데이터로는 confirmed까지 1\~5년 걸림 — 단기 만족 약함

## Consequences

### 장점

- **시드 outcome 데이터의 통계적 의미가 정량 측정 가능** — 임상 직관 → 가설 → 통계 검정 사이클 완성
- **자동 발견 + 가설 등록의 단일 인프라** — 1차 셋업과 운영이 같은 알고리즘. 코드 재사용
- **결정론 ↔ LLM 자율 헌장 준수** — 잔소리=SQL, enum 추출=LLM, 통계 검정=결정론. LLM 텍스트 의존 없음
- **confirmed 가설의 일상 통합** — 어렵게 검증한 가설이 매일 09:00 잔소리에 자연 반영
- **운영 흐름 정렬** — Phase 1 `weeklyReport` (SQL 결정론)와 Phase 4 `weeklyHypothesisReview` (가설 통계) 분리 운영. 목적·발송 시각(월요일 09:00 vs 08:00)·채널 모두 명확히 구분

### 단점 / 제약

- **confirmed까지 시간 오래 걸림** — n≥30 + q<0.05는 자주 발현 시드도 1년, 희귀 시드는 3\~5년. 단기 성취감 약함
- **자료 누적 의존** — 1\~2년 후에야 진짜 가설 운영 사이클이 정상 작동. 초기에는 candidates만 누적
- **enum 22개 분류기 부담** — Opus 이관([#409](https://github.com/hyewon3938/slack-ai-agents/issues/409))으로 완화하지만, enum 정의 명확화 + spot check 필요
- **다중 비교 통제의 한계** — BH-FDR도 조합 수 수천이면 q < 0.2 라도 false positive 가능. 사용자 직접 카드 보고 판단 단계 유지

### 후속 작업

- [ ] migration 058: `saju_hypotheses` + `saju_stats` 테이블 생성
- [ ] migration 059: `diary_meta_tags` enum 6개 추가 (DIARY_META_TAGS 배열 동기화)
- [ ] [#409](https://github.com/hyewon3938/slack-ai-agents/issues/409) diary-meta-extract Opus 이관 (Phase 4 작업 1)
- [ ] `src/shared/saju-hypothesis.ts` — Fisher's exact + BH-FDR 계산
- [ ] `src/agents/insight/hypothesis-discovery.ts` — 자동 패턴 발견 (수동 트리거 + 주간 cron 공용)
- [ ] `src/agents/insight/hypothesis-cards.ts` — Block Kit 카드 빌더 (등록/폐기 버튼 + 액션 핸들러)
- [ ] `src/cron/weekly-hypothesis-review.ts` — 월요일 08:00 신규 cron
- [ ] notification_settings: `weeklyHypothesisReview` 슬롯 신규 등록 (Phase 1 `weeklyReport`과 분리)
- [ ] `src/shared/insights.ts` 확장 슬롯 — confirmed 가설 자동 합류 로직
- [ ] 1차 셋업 명령어 또는 admin script — 60일 데이터 백테스팅 1회 실행
- [ ] 운영 후 임계치 튜닝 — n<5 skip이 너무 빡빡한지, q<0.2 노이즈 적당한지 (Phase 4.5 후속)

---

**참고 자료**

- Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate. *Journal of the Royal Statistical Society, Series B, 57(1)*, 289–300.
- Fisher's exact test — 소표본 + 이진 outcome 표준 검정
- [ADR-0014](0014-insight-engine-unification.md) — Phase 1 SQL 패턴 통합
- [ADR-0016](0016-llm-autonomous-slot-outcome-verification.md) — Phase 2 LLM 자율 슬롯 outcome 검증
- [ADR-0017](0017-saju-ganji-master-normalization.md) — Phase 3 60갑자 마스터 정규화
