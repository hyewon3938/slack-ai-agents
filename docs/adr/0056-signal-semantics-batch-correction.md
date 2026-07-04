# 0056. 신호 의미론 일괄 교정 — 좀비 부활 + done 재정의 + 자유지출 개명

- Status: Accepted
- Date: 2026-07-04
- Related: #573, ADR-0054(#572에서 후속 분리)
- Tags: insight, data, statistics, process

## Context

#572([ADR-0054](0054-audit-net-displacement-and-trigger-writer.md))가 audit 신호 순변위 측정을 교정하면서, "타 도메인 신호 의미론 점검 6건"을 각각 가설 의미 결정이 필요하다는 이유로 후속 이슈(#573)로 분리했다. prod 실측(2026-07-04)으로 6건을 점검한 결과:

1. **좀비 신호 발견 (schema drift).** `schedule_영화`·`schedule_이직`의 `sql_body`가 `schedules.category`(TEXT 컬럼)를 참조하는데, #394(2026-05-13)가 그 컬럼을 DROP하고 `category_id` FK로 교체했다. 두 신호는 7주째 "존재하지 않는 컬럼 참조"로 실행 시 죽어 있었다(링크 hit 0/miss 0). 신호 정의가 catalog(DB)에 영속되므로 코드 리뷰·타입 체크로 안 잡히고, 컬럼 rename/drop 마이그레이션이 `signal_defs.sql_body`를 조용히 깨뜨린 **클래스 사고**다.

2. **`expense_total`의 측정 범위 부정확.** "총 지출"은 할부 회차·구독·통신·공과금 같은 고정지출을 다 합산한다. 사주 재성/편재 발현이 재량 소비 행동과 연관되는지를 재려면 본인이 그날 결정한 자유지출만 봐야 하는데, 고정비가 섞여 신호가 둔해진다. (실측: 할부 행만 168/912 = 18%.)

3. **나머지 4건은 실측상 무변경.** 완료율×미룸 기계 결합(공존 쌍 0), `schedule_count_today` 동명 2행(의도된 반대 가설), 수면 결측=0시 기상(실측 결측 0건, 117/117 매일 기록), 루틴 미기록일=완료율 0(실측 결측 0건, 120/120 매일 기록), `schedule_tax_keyword`(title 기반 정상, 생애 발화 0). — 지금 손대면 실이익 없이 baseline만 흔든다.

prod 확인 결과 구 3신호(영화·이직·expense_total)에 confirmed 링크 0 → [ADR-0048](0048-enrollment-clip-and-rebaseline.md) D2 re-baseline 의무는 미발생.

## Decision

네 가지를 결정한다. 통계 스택·verdict·tier·임계치는 불변 — [ADR-0054](0054-audit-net-displacement-and-trigger-writer.md)·[ADR-0046](0046-signal-seed-precision.md)과 동일하게 *무엇을* 측정하는지(신호 정의)만 교정한다.

### 1. 영화·이직 = 좀비 부활 + `status='done'` 재정의

깨진 `category='영화'`를 `categories.name='영화'` **category_id JOIN**으로 재작성하고, `status='done'` 필터를 추가한다. 의미를 "그 일정이 달력에 있던 날"에서 **"그 일정을 실제로 처리한 날"**로 명시적으로 좁힌다. 실측 done 비율(영화 7/7일=100%, 이직 39/41일=95%)이 done 필터로 인한 손실이 무시 가능함을 뒷받침한다.

```sql
-- schedule_영화 (schedule_이직 동일 구조, name='이직')
SELECT COUNT(*) FROM schedules s JOIN categories c ON c.id = s.category_id
 WHERE s.user_id=$1 AND s.date=$2 AND c.name='영화' AND s.status='done'
```

### 2. `expense_total` → `expense_discretionary` 개명 재정의

자유지출만 측정한다. 할부 제외(`COALESCE(is_installment,false)=false`) + 고정비/통과비용 카테고리 제외.

```sql
SELECT COALESCE(SUM(amount),0) FROM expenses
 WHERE user_id=$1 AND date=$2 AND COALESCE(is_installment,false)=false
   AND category NOT IN ('구독','구독료','통신','통신비','공과금','보험','주거','세금','리커밋 택배')
```

- **제외 목록 정책 = 제외-목록(deny-list) 방식.** 새 카테고리는 기본 포함된다. 재량 지출은 다양하게 늘어날 수 있으므로 "포함할 것을 열거"보다 "제외할 고정지출을 열거"가 유지보수 부담이 낮다.
- **'리커밋 사업'은 유지, '리커밋 택배'는 제외.** 사업 투자 결정은 본인 재량 행동(편재 유관)이라 신호에 포함하는 게 맞고, 택배는 주문량에 비례하는 통과 비용(본인 행동 아님)이라 제외한다(사용자 통찰).
- `COALESCE(SUM(amount),0)` 유지 — 지출 0원인 날은 유효 0([ADR-0044](0044-discovery-measurement-validity.md)).
- **신명(new name) = 계보 단절.** `expense_total`의 e-value 시계열은 승계하지 않는다(개명이 곧 새 신호). 측정 범위가 바뀐 시계열을 한 anytime-valid 과정에 섞으면 보장이 훼손된다.

### 3. 결측 전파 인프라는 #574에 편입 (지금 안 함)

수면·루틴 결측일이 "0"으로 강제 변환되는 문제(3항·6항의 근본 원인)는 실측 결측이 0건이라 지금 손댈 실이익이 없다. 결측 전파 인프라(실행기 NULL 보존 + COALESCE 제거)를 #574 설계에 넘긴다. 설계 스케치는 도메인 문서(§43)에 남긴다.

### 4. 링크 처분 = archive만, 재연결은 발굴 엔진에 위임

구 3신호의 살아있는 링크(active/pending/weak/confirmed)는 전부 archive만 한다. 재연결(새 정의의 신호를 시드에 다시 잇는 것)은 발굴 엔진(P5a)의 다음 주간 스캔에 맡긴다 — [086](../../db/migrations/086_signal_seed_precision.sql)/[100](../../db/migrations/100_audit_net_displacement.sql) 전례 그대로. 마이그레이션에서 링크를 수동 재생성하지 않는다.

구현: 마이그레이션 [101](../../db/migrations/101_signal_semantics.sql)(은퇴 먼저 → 신설 나중, 085/099 부분 유니크 인덱스가 active/pending만 잡으므로). 라벨 레이어([insight-labels.ts](../../src/shared/insight-labels.ts)) 현행화 — 영화·이직은 override("… 처리한 날"), expense는 measure 맵 개명("자유지출").

## Alternatives considered

### A. 라벨만 고치고 SQL은 그대로

- 장점: 변경 최소.
- 단점: 좀비 SQL이 계속 죽어 있어 신호가 영영 발화 못 함. 라벨은 "무슨 뜻인지"만 바꾸고 "측정이 되는지"는 못 고친다.
- 기각 이유: 근본 문제(스키마 드리프트)를 안 건드림. 좀비를 살리는 게 이 이슈의 핵심.

### B. `expense_total` 분모를 고정지출 총액으로 나눠 비율화

- 장점: 소비 성향을 상대화.
- 단점: 고정지출이 월 단위라 일별 신호에 분모로 넣기 부적합, 임의 정규화 도입([ADR-0028](0028-pillar-level-and-threshold-pool.md) 임의값 배제 위반).
- 기각 이유: 자유지출 "절대액 above_avg"가 이미 rolling baseline으로 상대화됨 — 별도 분모 불필요.

### C. 결측 전파 인프라를 이번에 같이 구현

- 장점: 3·6항까지 한 번에 완결.
- 단점: `extractFirstNumber`(pattern-match.ts) NULL→0 강제, `MetricRunner` 타입 확장, 신호 SQL COALESCE 제거, 도메인 화이트리스트 opt-in — 하류 결측 처리([ADR-0044](0044-discovery-measurement-validity.md) `computeSignalSeries` raw null·`binarizeSqlSeries`·`buildContingency` inconclusive)는 완비돼 있으나 상류 변경 범위가 넓다.
- 기각 이유: **실측 결측 0건**(수면 117/117, 루틴 120/120)이라 당장 동작 변화가 없다. 넓은 상류 변경을 이익 0인 채로 야간 배포에 싣지 않는다 — #574로 편입해 결측 표본이 실제로 생길 때 설계.

### D. 6개 신호 전량 은퇴 후 재설계

- 장점: 의미론을 백지에서 정리.
- 단점: 4개는 무변경이 정답(실측 근거)이라 은퇴가 과잉. 발굴 재편·baseline 리셋 비용만 커짐.
- 기각 이유: 실측이 "3 교정 / 3 무변경"을 명확히 가름 — 전량 은퇴는 실측을 무시하는 판단.

### E. (선택한 안) 3 교정 + 3 무변경, 개명은 신명, 링크는 발굴 재연결

- 장점: 실측 근거에 정확히 대응. 신규 통계 코드 0. baseline 교란 최소.
- 단점: 발굴 재연결까지 신호가 잠시 링크 없이 뜸(관찰 필요).

## Consequences

### 장점

- 좀비 2신호가 7주 만에 다시 발화 가능 — category_id 스키마와 정합.
- 자유지출 신호가 고정비 잡음 제거로 재성/편재 가설에 더 예민.
- 신규 통계 코드 0, 임계치·verdict·tier 불변 → 리스크 낮음.

### 단점 / 제약

- **발굴 재연결 관찰 필요.** 링크 archive 후 새 정의가 시드에 다시 붙는지는 다음 주간 발굴 스캔에서 확인해야 한다(즉시 노출 안 됨).
- **`expense` 계보 단절은 의도.** `expense_total`의 과거 e-value·hit/miss는 `expense_discretionary`로 승계되지 않는다 — 개명이 새 신호이므로 축적을 처음부터 다시 쌓는다.
- **스키마 드리프트 클래스 위험 상존.** 이번엔 영화·이직만 걸렸지만, 다른 `signal_defs.sql_body`가 미래의 컬럼 변경에 또 깨질 수 있다.

### 후속 작업

- [ ] **컬럼 rename/drop 마이그레이션 시 `signal_defs.sql_body` grep 의무 (재발 방지 규칙).** 도메인 문서 §43·[conventions.md](../conventions.md)에 명문화. 점검 쿼리 예: `SELECT name, sql_body FROM signal_defs WHERE sql_body ILIKE '%<드롭할 컬럼>%';` + 신설 SQL 실행 스모크(101 ③처럼 `EXECUTE`로 정합 증명).
- [ ] 다음 주간 발굴 스캔에서 영화·이직·자유지출 신호의 재연결 여부 확인.
- [ ] 결측 전파 인프라 #574 설계(실행기 NULL 보존 + COALESCE 제거 + 도메인 opt-in).

---

**참고 자료**

- [ADR-0054](0054-audit-net-displacement-and-trigger-writer.md) — 이 이슈를 후속으로 분리한 audit 순변위 교정
- [ADR-0044](0044-discovery-measurement-validity.md) — 데이터-존재 윈도우·유효 0 보존(하류 결측 처리 완비분)
- [ADR-0048](0048-enrollment-clip-and-rebaseline.md) — re-baseline 의무 조건(confirmed 링크)
- 마이그레이션 [101](../../db/migrations/101_signal_semantics.sql)
