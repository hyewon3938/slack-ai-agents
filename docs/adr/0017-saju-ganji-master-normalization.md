# 0017. 사주 60갑자 마스터 정규화 + 카탈로그 기반 일일 매칭

- Status: Accepted
- Date: 2026-05-17
- Related: [#391](https://github.com/hyewon3938/slack-ai-agents/issues/391), 마스터 [#393](https://github.com/hyewon3938/slack-ai-agents/issues/393)
- Tags: data, architecture

## Context

마스터 #393 (프로액티브 인사이트 v2) Phase 3 진입. 초기 design-notebook은 Phase 3를 "사주 매핑 — 십성/오행을 임계치 가중치로"로 정의했으나, Phase 3 인터뷰에서 다음이 드러남:

1. **사용자의 사주 임상 가설은 글자 단위로 매우 구체적**: 천간 갑(편재) → 일정 폭증, 지지 사(편관) + 사술원진 → 짜증/건강, 천간 계(상관) → 배달/루틴↓/일정 미루기, 천간 기(정인) → 낮잠/휴식, 토 과다(오행 밀도) → 무기력/수면↑, 사지묘지(12운성) → 컨디션↓ 등 13개 가설.
2. **"임계치 가중치" 접근은 가설별 다양성을 흡수하지 못함**: 트리거 타입이 천간 글자, 지지 글자, 글자+관계(원진·충), 오행 밀도, 12운성 등 폴리모픽. 단일 가중치 함수로 표현 불가.
3. **마스터 #393 헌장(가설 → DB 보존 → 사후 검증, outcome-based 정확도 측정)을 사주 영역에도 적용하려면 시드 catalog + 일일 매칭 결과 보존 + 검증 사이클이 필요**.
4. **반복적 사주 자료 참조 비용**: 일간×십성, 일간×12운성, 지지 간 관계는 사주 전통 표로 고정 — 마스터 정규화하지 않으면 모든 시드/메트릭이 자체 JSONB spec에 같은 정보를 중복 인코딩.

제약:
- v2 헌장: ① LLM 텍스트 의존 최소화 ② 결정론↔자율 분리 ③ 가설-검증 outcome 사이클 ④ 신뢰 비용 분리 — 모두 유지해야 함
- 1인 환경: 마스터 데이터 정확성 검증·시드 운영 모두 사용자 단독 부담

## Decision

**60갑자 마스터 데이터를 정규화 테이블로 보존하고, 사주 시드 카탈로그가 이 마스터를 참조하는 구조**.

### 마스터 테이블 (정적 데이터, ~466행)

```sql
stems_master       (10행): 천간. id, name, element, yinyang
branches_master    (12행): 지지. id, name, element, yinyang
ganji_master       (60행): 60갑자. id, stem_id FK, branch_id FK
sipsin_lookup      (220행): 일간 기준 십성. day_master_stem_id, target_id, target_type, sipsin
sibiunsung_lookup  (120행): 일간 기준 12운성. day_master_stem_id, branch_id, state
branch_relations   (~36행): 지지 관계. branch_a_id, branch_b_id, relation_type
                                ('육합'|'삼합'|'방합'|'충'|'형'|'파'|'해'|'원진')
stem_relations     (~10행): 천간 관계. stem_a_id, stem_b_id, relation_type ('합'|'극')
```

### 시드 카탈로그 (가변 데이터)

```sql
saju_signal_catalog:
  id, user_id, name, sipsin, description,
  trigger_target_type ('stem'|'branch'|'ganji'|'element_density'|'sibiunsung'|'relation'),
  trigger_target_id INTEGER,   -- 마스터 FK (target_type에 따라 다른 테이블)
  trigger_aux JSONB,           -- with_natal, min_count 등 추가 조건만
  active BOOLEAN,
  source ('seed'|'llm_promoted'),
  hit_count, miss_count, inconclusive_count,
  created_at TIMESTAMPTZ

saju_signal_metrics:           -- 1:N (한 시드가 여러 도메인 메트릭 가질 수 있음)
  id, signal_id FK, metric_name,
  expected_metric_sql TEXT,
  expected_direction ('above_avg'|'below_avg'|'above_abs'|'below_abs'|'flag_present'),
  expected_threshold NUMERIC,
  domain ('schedule'|'routine'|'sleep'|'expense'|'diary_meta'|'audit')

saju_daily_matches:            -- 일일 매칭 결과 보존
  id, user_id, date, signal_id FK,
  trigger_activated BOOLEAN,
  metric_values JSONB,
  matched BOOLEAN, verify_status ('pending'|'hit'|'miss'|'inconclusive'),
  created_at, UNIQUE(user_id, date, signal_id)
```

### Outcome 통계 부착 위치

시드 단위(`saju_signal_catalog.hit_count` 등)에만 보존. 글자/일주별 종합 통계는 view로 도출:

```sql
CREATE VIEW saju_outcome_by_stem AS
SELECT sm.name AS stem,
       SUM(sc.hit_count) AS total_hit,
       SUM(sc.miss_count) AS total_miss,
       ...
FROM stems_master sm
JOIN saju_signal_catalog sc ON sc.trigger_target_type='stem' AND sc.trigger_target_id=sm.id
GROUP BY sm.name;
```

### LLM 자율 발견 (Phase 2 패턴 재활용)

LLM이 catalog 외 사주 가설(예: "지지 신 + 자수 합 → 집중력 향상")을 제안하면 Phase 2의 `llm_insights` 테이블 또는 별도 `saju_llm_hypotheses`에 보존 → 검증 → hit 임계 도달 시 `saju_signal_catalog`로 promote(`source='llm_promoted'`).

### 채널 정책

- **일일 매칭** (cron, 매일 09시): #life 채널 잔소리 끝 한 줄 ("오늘 일운 갑목 — 일정 생성 평소 대비 가능성")
- **주간 outcome 리포트** (월 09:30 주간 리포트와 통합): #insight 채널 — 시드별 hit rate + 약한 시드 알림
- **약한 시드 처리**: 누적 30일 후 hit rate < 임계치 시 주간 리포트에 표시, 사용자가 `사주 시드 끄기 #N` 명령어로 active 토글

## Alternatives considered

### A. 임계치 가중치만 (원래 design-notebook 안)

- 장점: 구조 단순, 기존 인사이트 임계치 외부화(Phase 1)와 일관
- 단점: 사용자 임상 가설의 폴리모픽 구조(글자/관계/오행/12운성) 흡수 불가. 단일 함수로 표현되지 않는 가설은 버려져야 함
- 기각: Phase 3 인터뷰에서 13개 임상 가설의 트리거 다양성 확인됨

### B. catalog만, 마스터 정규화 없음

- 장점: 마이그레이션 부담 작음. 시드 spec JSONB에 글자/십성/관계 정보 직접 인코딩
- 단점: ① 모든 시드에 사주 전통 표 정보 중복 ② "갑목 시드들 종합 hit rate" 같은 그룹 분석이 JSONB 키 LIKE 쿼리에 의존 ③ 마스터 자료 오류 시 모든 시드 spec 수정 필요
- 기각: 시드 수가 13개 → N개로 늘면 중복 비용 폭증. Phase 4 Hybrid Pipeline 정량 검증이 글자 단위 그룹 통계에 의존

### C. 60갑자 마스터 + catalog (선택)

- 장점: ① 정규화 원칙 ② 글자/일주/십성 단위 그룹 통계 view로 자연스러움 ③ 시드 추가 비용 ↓ (마스터 lookup만 하면 됨) ④ 기존 saju_profiles·saju_patterns·fortune_analyses와 데이터 모델 정합 ⑤ Phase 4 정량 검증 토대 확보
- 단점: 마스터 데이터 시드 SQL 작성·정확성 검증 부담 (~466행, Claude 초안 + 사용자 검증)

### D. LLM 자율로만 (catalog 없음)

- 장점: 사용자 임상 가설을 LLM에 자율 검증 위임 → 휴먼 코딩 부담 ↓
- 단점: ① v2 헌장 ② "결정론적 catalog ↔ LLM 자율" 분리와 충돌 ③ 사용자 임상 가설은 이미 명확하므로 자율 발견 영역이 아님 ④ 첫 6주 데이터 없이 LLM 자율 시작 시 발견 품질 측정 불가
- 기각: 사용자 임상 가설은 결정론 catalog 영역, LLM 자율은 catalog 외 발견(out-of-catalog) 영역으로 역할 분리가 헌장 부합

## Consequences

### 장점

- 사용자가 임상적으로 관찰한 사주 가설을 정량 데이터로 검증 가능 (가장 큰 동기)
- 십성/관계/오행 차원의 그룹 통계가 정규화 view로 자연스럽게 도출
- Phase 4 사주×라이프 Hybrid Pipeline 정량 검증의 토대
- Phase 2 outcome 패턴 재활용으로 검증 사이클 일관성 유지
- 마스터 #393 헌장 4개 모두 부합 (catalog는 결정론, LLM은 catalog 외 자율, outcome 검증, 시드별 신뢰 비용 분리)

### 단점 / 제약

- 마스터 데이터(~466행) 정확성 책임이 사용자 + Claude 초안에 집중. 사주 전통 표 오류가 모든 분석에 전파
- 시드 16개 동시 운영 — 일일 매칭 결과 보존 = `saju_daily_matches` 일 16행 누적. 90일 = ~1440행, 1년 = ~5840행 (DB 부담은 작음)
- catalog → master FK 관계로 마스터 삭제·rename 시 RESTRICT 보호 필요 (FK ON DELETE RESTRICT)
- 시드 등록·약화·은퇴는 사용자 능동 결정 — 주간 리포트가 결정 부담을 줄여야 함

### 후속 작업

- [ ] 마스터 테이블 schema + seed (Claude 초안 + 사용자 검증)
- [ ] saju_signal_catalog/metrics/daily_matches schema
- [ ] 16개 시드 등록 (시드 SQL은 plan에 명시, 관성 N6~N8 + S2 메트릭 확장 포함)
- [ ] 인프라: `diary_meta_tags`, `schedule_changes` audit, `routine_templates.category`
- [ ] 일기 메타 플래그 추출 cron (LLM, 일기 텍스트 → 플래그만 출력, 원문 보존 X)
- [ ] 일정 PATCH hook에서 `schedule_changes` INSERT
- [ ] 일일 매칭 cron + verify 사이클
- [ ] 주간 리포트에 시드 outcome 섹션 추가 + 약한 시드 알림
- [ ] 사용자 명령어: `사주 시드 끄기 #N`, `사주 시드 보기` fast path

---

**참고 자료**

- 마스터 #393 헌장: 메모리 `project_insight_v2_core_principles.md`
- [ADR-0014](0014-insight-engine-unification.md) — Phase 1 결정 (SQL 결정론 11패턴)
- [ADR-0016](0016-llm-autonomous-slot-outcome-verification.md) — Phase 2 결정 (LLM 자율 + outcome 검증)
- [ADR-0011](0011-saju-patterns-cross-domain.md) — saju_patterns 도입
- [ADR-0012](0012-fortune-personalization.md) — 운세 개인화
