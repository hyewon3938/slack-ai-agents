# 0013. 일정 카테고리 — TEXT 참조 → 단일 FK + parent_id 계층화

- Status: Accepted
- Date: 2026-05-13
- Related: #393 (마스터 — 프로액티브 인사이트 v2), #394 (선행 작업)
- Tags: data, schema, refactor

## Context

`schedules` 테이블은 카테고리를 **이름(TEXT) 참조**로 들고 있었다:

```sql
schedules.category    TEXT  -- categories.name과 매칭
schedules.subcategory TEXT  -- 하위 카테고리 name과 매칭
```

이 구조에는 두 가지 구조적 약점이 있었다.

1. **Rename data loss**
   카테고리 이름을 바꾸면 기존 일정의 `category` 값과 매칭이 끊긴다. 실제로 카테고리 rename 시 일정이 "미분류"로 잡혀버리는 사고가 발생해, `UPDATE schedules SET category = '<새 이름>' WHERE category = '<옛 이름>'` 식의 보정 SQL을 수동으로 돌려야 했다.

2. **인사이트 v2(#393)의 SQL 분석 친화도**
   라이프 패턴을 카테고리 비중·요일 분포·시계열 변화로 보려면, 분석 쿼리가 텍스트 매칭이 아니라 안정적인 ID 키 위에서 돌아야 한다. 또 사용자가 사주 십성 가설(관/식신/상관 등)을 카테고리에 자연스럽게 매핑하고 싶어 했고, 그 매핑 메타데이터를 categories 테이블에 안정적으로 붙이려면 ID 기반이어야 한다.

게다가 카테고리 의미 자체도 분석 친화적으로 정리할 필요가 있었다 — 6개 최상위 카테고리로 재배치 + 각 최상위 하위에 의미별 세분화 자유로운 구조. 카테고리 실명은 라이프 패턴 분석 도메인이라 공개 텍스트에 노출하지 않는다(코드/이슈/PR 추상화).

## Decision

`schedules.category` (TEXT) + `schedules.subcategory` (TEXT) 두 컬럼을 제거하고, **`schedules.category_id INTEGER`** 단일 FK 컬럼으로 대체한다.

```sql
ALTER TABLE schedules
  ADD COLUMN category_id INTEGER
  REFERENCES categories(id) ON DELETE RESTRICT;
```

핵심 구조:

1. **단일 FK + parent_id로 계층 표현**
   `schedules.category_id`는 항상 leaf(최하위) 또는 top(최상위) 카테고리를 직접 가리킨다. 계층은 `categories.parent_id`가 담당한다.

2. **`ON DELETE RESTRICT`**
   카테고리가 일정에 연결돼 있으면 삭제 차단. 사용자 의도 없이 데이터가 강등/유실되는 사고를 방지.

3. **빅뱅 트랜잭션 마이그레이션**
   단일 사용자, 데이터 크기 작음, downtime 무관 → 한 트랜잭션 안에서 ADD COLUMN + backfill + FK 제약 + DROP COLUMN을 모두 처리. 실패 시 ROLLBACK 한 번으로 원복.

4. **3중 안전망**
   - DB 전체 `pg_dump`
   - 내부 백업 테이블 (`schedules_backup_YYYYMMDD`, `categories_backup_YYYYMMDD`)
   - 마이그레이션 자체를 트랜잭션으로 감쌈

백업 테이블은 1주 검증 기간 후 DROP.

5. **JOIN 패턴 표준화**
   카테고리 이름·타입이 필요한 모든 SELECT는 다음 JOIN을 통과한다:

   ```sql
   LEFT JOIN categories c ON c.id = s.category_id
   LEFT JOIN categories p ON p.id = c.parent_id
   ```

   - `c.name` — 직접 매핑된 카테고리 이름 (leaf 또는 top)
   - `COALESCE(c.type, p.type)` — 타입은 leaf 우선, 없으면 parent 상속
   - `COALESCE(p.name, c.name)` — 그룹화 기준은 항상 최상위

## Alternatives considered

### A. TEXT 컬럼 유지 + 이름 동기화 트리거

- 장점: 마이그레이션 불필요. 기존 코드 변경 최소.
- 단점:
  - rename 시점의 일정 row를 일일이 UPDATE하는 트리거는 cross-row 트랜잭션 비용 증가
  - 인사이트 SQL이 여전히 텍스트 비교에 의존 → 분석 친화도 낮음
  - 사용자가 손으로 INSERT한 row의 typo는 트리거가 못 잡음
- 기각 이유: 근본 원인(텍스트 참조)을 해결하지 않고 증상만 가림.

### B. 분리 FK 두 컬럼 (`category_id` + `subcategory_id`)

- 장점:
  - 의미가 명시적: "이 일정은 상위 X의 하위 Y에 속한다"
  - 상위 카테고리 필터링은 `category_id` 하나만 보면 됨
- 단점:
  - **depth 2 고정.** 향후 3-depth가 필요해지면 또 마이그레이션
  - 정합성 검증 코드 필요: `subcategory.parent_id == category_id` 보장이 애플리케이션 책임
  - 두 컬럼 NULL 조합 케이스가 4가지 (둘 다 NULL / 상위만 / 하위만 / 둘 다) — 분석 SQL의 분기 증가
- 기각 이유: depth 고정과 정합성 부담이 단일 FK 대비 분명한 단점.

### C. 단일 FK + parent_id 계층화 ← **선택**

- 장점:
  - 무한 depth 자연 지원
  - 일정-카테고리 관계는 항상 단일 컬럼 1:1
  - 카테고리 테이블에 메타데이터(사주 매핑, 분석 가중치 등)를 자연스럽게 확장 가능
  - 인사이트 SQL이 `category_id` 하나만 보면 되어 단순
- 단점:
  - 이름·타입 표시 위해 self-JOIN 1회 추가 — PK 인덱스라 성능 영향 미미
  - parent_id 순환 참조 가능성 — 카테고리 UI에서 검증 필요 (현재는 depth 2 정책)

## Consequences

### 장점

- **Rename 안전성**: 카테고리 이름이 바뀌어도 ID는 그대로 → 기존 일정 데이터 연결 유지
- **분석 SQL 단순화**: 인사이트 v2 (#393)의 라이프 패턴 분석이 `category_id` 기준으로 일관됨. LLM 텍스트 해석 의존도 ↓
- **메타데이터 확장 자유**: Phase 4(#392)에서 사주 매핑·일운 상관도 등을 categories 테이블에 자연스럽게 추가 가능
- **계층 확장 자유**: 향후 3-depth 이상 필요해져도 스키마 변경 불필요
- **표준 JOIN 패턴**: `LEFT JOIN categories c + LEFT JOIN categories p` 한 가지 패턴으로 통일

### 단점 / 제약

- 카테고리 이름이 필요한 SELECT에 JOIN 2회 항상 추가 (성능 영향은 미미하나 SQL 길이는 늘어남)
- 마이그레이션 1회 실행 비용 (단발성). 그러나 빅뱅 트랜잭션 + 3중 안전망으로 리스크 통제.
- 봇/크론/웹 모든 일정 조회 SQL을 한꺼번에 갱신해야 함 — 단일 PR 변경 폭은 크지만 일관성은 확보

### 후속 작업

- [ ] 1주 검증 후 backup 테이블 (`schedules_backup_*`, `categories_backup_*`) DROP
- [ ] Phase 4(#392) 진입 시 categories 메타데이터 확장 (`saju_mapping` 등) 설계 — ADR 별도 작성
- [ ] 카테고리 UI에서 parent_id 순환 참조 가드 (현재 정책상 depth 2 고정이라 즉시 위험은 없으나, 임의 depth 정책으로 확장 시 필요)
- [ ] 카테고리 실명을 공개 텍스트에 노출하지 않는 추상화 원칙 유지 (코드/이슈/PR/문서)

---

**참고 자료**

- 도메인 문서: [docs/domains/schedule.md](../domains/schedule.md)
- 마이그레이션 SQL: `scripts/migrations/2026-05-13-schedule-category-fk/`
