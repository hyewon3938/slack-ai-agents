# 0022. target-type 일반화 — 사주 6종 + life_signal 통합 (단일 카탈로그)

- Status: Superseded by [ADR-0026](0026-pattern-prefix-rename.md)
- Date: 2026-05-27
- Related: [#434](https://github.com/hyewon3938/slack-ai-agents/issues/434)
- Tags: data, insight, architecture

> **Note (2026-05-27)**: 본 ADR의 *target_type 일반화 결정 자체*는 ADR-0026이 유지·계승한다. 그러나 *테이블명 잔존 결정 (대안 C `signal_catalog` rename 기각)*은 ADR-0026이 폐기하고 `pattern_*` 전면 rename으로 전환했다. 본문은 immutable 원칙 따라 그대로 보존하되, 본문의 `ALTER TYPE target_type` SQL은 실제 스키마(TEXT CHECK constraint)와 불일치하므로 Phase 1 plan에서 정확한 마이그레이션 어휘로 정정한다.

## Context

마스터 #393 (v2) Phase 3에서 `saju_signal_catalog` 테이블을 만들고 사주 60갑자 매핑을 위한 target_type 6종(`stem`, `branch`, `ganji`, `element_density`, `sibiunsung`, `relation`)을 정의했다 (ADR-0017).

마스터 #434는 이를 **본인 1명 패턴 발견 시스템**으로 일반화한다. 사주 갑자 외에도 라이프 통념(요일·주말·월말·계절 등)을 동일한 가설-검증 파이프라인에서 다루기로 한다.

문제:

- 라이프 통념을 어디에 둘 것인가 — 사주 시드 카탈로그와 같은 테이블? 별도 테이블?
- 매칭·매트릭·가설·검증 코드가 사주 한정인 상태인데 두 종류의 시드를 어떻게 처리할 것인가
- 테이블명 `saju_signal_catalog`은 역사적 명칭. rename할 가치가 있는가

## Decision

`saju_signal_catalog` 테이블의 `target_type` enum에 **`life_signal`** 1종을 추가한다. 별도 테이블을 만들지 않는다. 테이블명은 유지 (역사적 명칭).

세부 구조:

```sql
-- migration: 063_signal_catalog_generalization.sql (예정)
ALTER TYPE target_type ADD VALUE IF NOT EXISTS 'life_signal';

ALTER TABLE saju_signal_catalog
  ADD COLUMN seed_kind TEXT NOT NULL DEFAULT 'saju'
    CHECK (seed_kind IN ('saju', 'life_signal'));
```

이후 매칭·매트릭·가설·검증 코드는 `target_type`만 보고 분기하면 됨 (사주 6종은 사주 도메인, `life_signal`은 라이프 도메인).

## Alternatives considered

### A. 별도 `life_signal_catalog` 테이블 신설

- 장점: 테이블명이 의미적으로 정확. 사주와 라이프 통념의 출처 분리가 스키마 레벨에서 강제됨
- 단점: 매칭·매트릭·가설·검증 4개 시스템의 코드가 모두 두 테이블 분기 처리 필요. 동일 통계 파이프라인이 분리되면 유지보수 부담 ↑
- 기각 이유: 가설-검증 파이프라인이 동일하므로 분리할 의미 X. 통계 처리는 출처를 가리지 않는다

### B. catalog를 `signal_catalog`로 rename

- 장점: 가장 의미적. 테이블명이 마스터 정체성과 일치
- 단점: v2 운영 중 마이그레이션 + view/외부 API 일괄 변경. PR #422의 `saju_influence_summary` 등 의존 entity도 같이 rename 필요
- 기각 이유: 변경 폭이 너무 크고 의미적 이득은 작음. 테이블명은 코드만 봐서 의미 파악이 어렵지 않다 (도메인 문서에서 명시)

### C. `target_type` enum 확장 + `seed_kind` 컬럼 추가 (선택)

- 장점: 마이그레이션 비용 최소. 매칭·매트릭·가설·검증 코드 재사용
- 단점: 테이블명에 `saju` 잔존 (역사적 부채)

→ **C 선택**. 통계 파이프라인 통일 + 확장 비용 최소가 핵심. 테이블명 부채는 마스터 회고에 명시.

## Consequences

### 장점

- 매칭 cron(`daily-saju-matching.ts`), `hypothesis-discovery.ts`, weekly 가설 리뷰가 단일 분기로 사주 + life_signal 모두 처리
- view (`saju_signal_summary`) 한 개로 두 종류 시드의 hit/miss 통계 expose
- 향후 새로운 시드 종류(예: 날씨, 생리 주기 등) 추가 시 `seed_kind`만 추가하면 됨

### 단점 / 제약

- 테이블명 `saju_signal_catalog`이 의미적으로 부정확 — `life_signal`도 들어 있음. 도메인 문서에서 명시 (코드 자체로는 직관 부족)
- 사주와 life_signal의 출처 차이가 스키마로 강제되지 않음 — `seed_kind` CHECK constraint로 보강

### 후속 작업

- [ ] Phase 1 migration에 `target_type` enum 확장 + `seed_kind` 컬럼 추가
- [ ] Phase 3에서 `life_signal` 시드 14\~20개 작성 (요일 7 + 주말/평일 2 + 월말/월초 2 + 계절 4 + 기타)
- [ ] 도메인 문서(`docs/domains/insight.md`)에 테이블명의 역사적 부채 명시

---

**참고 자료**

- [ADR-0017](0017-saju-ganji-master-normalization.md) — saju_signal_catalog 원본 설계
- [ADR-0020](0020-fortune-system-responsibility-split-via-view.md) — view 인터페이스 패턴
