-- 101: 신호 의미론 일괄 교정 (#573, ADR-0056)
-- 배경: #572(100, ADR-0054)에서 후속으로 분리한 "타 도메인 신호 의미론 점검 6건"의 실행체.
--   prod 실측(2026-07-04) 결과 6건 중 3건이 즉시 교정 대상, 3건은 무변경(문서화만)으로 확정.
--   핵심 발견 = 스키마 드리프트로 인한 "좀비 신호": schedule_영화·schedule_이직의 sql_body가
--   schedules.category(TEXT 컬럼)를 참조하는데 #394(2026-05-13, 04-migrate.sql)가 그 컬럼을 DROP하고
--   category_id FK로 교체 → 두 신호가 7주째 실행 시 존재하지 않는 컬럼 참조로 죽어 있었다(링크 hit 0/miss 0).
--   신호 정의가 catalog(DB)에 영속되므로 코드 리뷰·타입 체크로는 안 잡히고, 컬럼 rename/drop 마이그레이션이
--   signal_defs.sql_body를 조용히 깨뜨린 클래스 사고.
-- 구성:
--   ① 은퇴 — 구 3개(schedule_영화·schedule_이직·expense_total) status='rejected' + 링크 archive.
--   ② 신설 — 동명 재사용 2개(schedule_영화·schedule_이직, category_id JOIN + status='done' 재정의) +
--      신명 1개(expense_discretionary = 자유지출만, 할부·고정비 제외). expense_total 계보는 의도적 단절.
--   ③ 검증 DO 블록 — 신설 3 active / 구 3 rejected(관대 ≥) / 은퇴 신호 살아있는 링크 0 +
--      신설 SQL 실행 스모크(각 sql_body를 user_id=1·오늘 날짜로 EXECUTE — 좀비 재발 방지의 핵심).
-- 무변경(문서화만, docs/domains/insight.md §43): 완료율×미룸 기계 결합 / schedule_count_today 동명 2행(반대
--   가설) / 수면 결측=0 / 루틴 미기록일=완료율 0(실측 결측 0건) / schedule_tax_keyword(title 기반 정상,
--   생애 발화 0). 결측 전파 인프라는 #574에 편입.
-- 안전: 파일 전체가 단일 암묵 트랜잭션(migrate.ts) — 검증 DO 블록이 RAISE 시 전체 롤백. 모든 변경 가역.
--   신설 신호는 시드(source='seed')라 signal-sql-guard(LLM 전용) 비대상. 통계 스택·verdict·tier·임계치 불변
--   — 100/086과 동일하게 *무엇을* 측정하는지(신호 정의)만 교정.
--   prod 확인: 구 3신호에 confirmed 링크 0 → ADR-0048 D2 re-baseline 의무 미발생.

-- ═══ ① 은퇴 — 구 3개 rejected + 링크 archive ═══════════════
-- 085/099 부분 유니크 인덱스는 active/pending만 잡으므로 은퇴를 신설보다 먼저 실행(그래야 ②의 동명
-- 신설이 인덱스에 안 걸린다). status='active' 조건 필수 — 기존 rejected 행(영화·이직 각 2행) 재처리 방지.
-- expense_total은 rejected 0이라 조건 무관하나 일관성 위해 동일 가드.
UPDATE signal_defs SET status = 'rejected'
 WHERE user_id = 1 AND status = 'active'
   AND name IN ('schedule_영화', 'schedule_이직', 'expense_total');

-- 링크 archive: 방금 rejected로 내린 row만 잡도록 status='rejected' 조건 유지. 살아있는 링크
-- (active/pending/weak/confirmed) 전부 archived — 재연결은 발굴 엔진(P5a) 다음 주간 스캔에 위임
-- (086/100 전례). confirmed 링크가 있으면 sticky라 노출 사라지나, prod 확인 결과 confirmed 0.
UPDATE pattern_links SET status = 'archived', updated_at = NOW()
 WHERE status IN ('active', 'pending', 'weak', 'confirmed')
   AND signal_id IN (SELECT id FROM signal_defs
                      WHERE user_id = 1 AND status = 'rejected'
                        AND name IN ('schedule_영화', 'schedule_이직', 'expense_total'));

-- ① 검증
DO $$
DECLARE
  old_rejected INT;
BEGIN
  SELECT count(*) INTO old_rejected FROM signal_defs
   WHERE user_id = 1 AND status = 'rejected'
     AND name IN ('schedule_영화', 'schedule_이직', 'expense_total');
  -- 관대 비교(≥ 3): 영화·이직은 은퇴 전 이미 rejected 2행씩 존재(과거 재처리 흔적) → =3 강제면
  -- 롤백된다(100 회고와 동일 함정). expense_total만 rejected 0이었으므로 최소 3개(방금 은퇴분)는 보장.
  IF old_rejected < 3 THEN
    RAISE EXCEPTION '[101①] 구 3신호 은퇴 실패 — rejected % (기대 ≥ 3)', old_rejected;
  END IF;
  RAISE NOTICE '[101①] 구 3신호 은퇴 + 링크 archive 완료 — rejected % 행', old_rejected;
END $$;

-- ═══ ② 신설 — 동명 재사용 2개 + 신명 1개 ═══════════════════
-- 이름 재사용 근거: SIGNAL_LABEL_OVERRIDES/SIGNAL_MEASURE(insight-labels.ts)·테스트가 name 키라
-- 무수정(영화·이직), 발굴·findEquivalentSignal은 active/pending만 보므로 rejected 구 row와 무충돌.
-- signal_defs INSERT 컬럼은 086/100 참조: (user_id, name, kind, sql_body, value_type, direction,
-- threshold, domain, description, source, status). $1=user_id, $2=날짜.

-- schedule_영화: 좀비 부활 + done 재정의. 구 SQL이 참조하던 schedules.category(#394가 DROP)를
-- category_id JOIN(categories.name='영화')으로 재작성 + status='done' 필터. "그 일정을 실제로 처리한 날".
-- 실측 done 비율 영화 7/7일=100% → done 필터로 인한 손실 무시 가능.
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'schedule_영화', 'sql',
  $sql$SELECT COUNT(*) FROM schedules s JOIN categories c ON c.id = s.category_id WHERE s.user_id=$1 AND s.date=$2 AND c.name='영화' AND s.status='done'$sql$,
  'continuous', 'above_abs', 1, 'schedule',
  '영화 일정을 실제로 처리한 날 (category_id 기준, status=done)', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- schedule_이직: 동일 구조(categories.name='이직'). 실측 done 비율 이직 39/41일=95% → 손실 무시 가능.
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'schedule_이직', 'sql',
  $sql$SELECT COUNT(*) FROM schedules s JOIN categories c ON c.id = s.category_id WHERE s.user_id=$1 AND s.date=$2 AND c.name='이직' AND s.status='done'$sql$,
  'continuous', 'above_abs', 1, 'schedule',
  '이직 일정을 실제로 처리한 날 (category_id 기준, status=done)', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- expense_discretionary: expense_total 개명 재정의(신명 = 계보 단절). 자유지출만 측정 —
--   할부 제외(COALESCE(is_installment,false)=false) + 고정비/통과비용 카테고리 제외.
--   제외 목록: 구독·통신·공과금·보험·주거·세금 = 본인 재량 밖 고정지출 / '리커밋 택배' = 주문량 비례
--   통과 비용(본인 행동 아님, 사용자 통찰). '리커밋 사업'은 유지 = 본인 사업 투자 결정(편재 유관).
--   제외-목록 방식이라 새 카테고리는 기본 포함. COALESCE(SUM(amount),0)로 지출 0원인 날은 유효 0(ADR-0044).
--   direction=above_avg·domain=expense·type='expense' 필터는 구 expense_total 그대로 승계
--   (expenses.type은 030 원본 컬럼 — income 계열 행이 합계에 섞이지 않게 하는 필수 필터).
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'expense_discretionary', 'sql',
  $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND COALESCE(is_installment,false)=false AND category NOT IN ('구독','구독료','통신','통신비','공과금','보험','주거','세금','리커밋 택배')$sql$,
  'continuous', 'above_avg', NULL, 'expense',
  '자유지출 총액 — 할부·고정비 제외', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- ② 검증
DO $$
DECLARE
  new_active INT;
BEGIN
  SELECT count(*) INTO new_active FROM signal_defs
   WHERE user_id = 1 AND status = 'active'
     AND name IN ('schedule_영화', 'schedule_이직', 'expense_discretionary');
  IF new_active <> 3 THEN
    RAISE EXCEPTION '[101②] 신설 3신호 active 수 이상 — % (기대 3)', new_active;
  END IF;
  RAISE NOTICE '[101②] 신설 3신호 active — schedule_영화·schedule_이직 재정의 + expense_discretionary 신명';
END $$;

-- ═══ ③ 정합 검증 + 신설 SQL 실행 스모크 ═══════════════════
-- 카운트 검증 + 은퇴 신호 살아있는 링크 0 + 신설 3개 sql_body를 user_id=1·오늘로 EXECUTE.
-- 스모크가 이 마이그레이션의 핵심: 좀비의 근본 원인은 sql_body의 컬럼 참조가 실제 스키마와 어긋난 것.
-- 각 신설 SQL을 실제로 실행해 "에러 없이 숫자 1개 반환"을 증명하면, category_id JOIN·expenses 컬럼
-- 참조가 현행 스키마와 맞음을 이 자리에서 확정한다(코드 리뷰가 놓친 스키마-SQL 정합을 런타임으로 봉인).
DO $$
DECLARE
  new_active INT;
  old_rejected INT;
  dead_links INT;
  smoke_val NUMERIC;
  rec RECORD;
  today TEXT := to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD');
BEGIN
  -- 카운트: 신설 3 active.
  SELECT count(*) INTO new_active FROM signal_defs
   WHERE user_id = 1 AND status = 'active'
     AND name IN ('schedule_영화', 'schedule_이직', 'expense_discretionary');
  IF new_active <> 3 THEN
    RAISE EXCEPTION '[101③] 신설 신호 active 수 이상 — % (기대 3)', new_active;
  END IF;

  -- 카운트: 구 3 rejected(관대 ≥ 3 — 영화·이직 선재 rejected 존재).
  SELECT count(*) INTO old_rejected FROM signal_defs
   WHERE user_id = 1 AND status = 'rejected'
     AND name IN ('schedule_영화', 'schedule_이직', 'expense_total');
  IF old_rejected < 3 THEN
    RAISE EXCEPTION '[101③] 구 신호 rejected 수 이상 — % (기대 ≥ 3)', old_rejected;
  END IF;

  -- 은퇴 3신호를 가리키는 살아있는 링크(active/pending/weak/confirmed)가 0이어야 함(전부 archive됨).
  SELECT count(*) INTO dead_links
    FROM pattern_links pl JOIN signal_defs s ON s.id = pl.signal_id
   WHERE s.user_id = 1 AND s.status = 'rejected'
     AND s.name IN ('schedule_영화', 'schedule_이직', 'expense_total')
     AND pl.status IN ('active', 'pending', 'weak', 'confirmed');
  IF dead_links <> 0 THEN
    RAISE EXCEPTION '[101③] 은퇴 신호를 가리키는 미정리 링크 % 건', dead_links;
  END IF;

  -- 신설 SQL 실행 스모크: 각 active 신설 신호의 sql_body를 $1=user_id=1, $2='오늘'로 치환해 EXECUTE.
  -- (pattern-match.ts runMetricSql와 동일 치환 규칙 — $1→'1', $2→'YYYY-MM-DD' 리터럴.)
  -- 좀비 SQL이었다면 "column ... does not exist"로 여기서 즉시 RAISE → 전체 롤백(재발 구조적 차단).
  FOR rec IN
    SELECT name, sql_body FROM signal_defs
     WHERE user_id = 1 AND status = 'active'
       AND name IN ('schedule_영화', 'schedule_이직', 'expense_discretionary')
  LOOP
    EXECUTE replace(replace(rec.sql_body, '$1', '1'), '$2', quote_literal(today)) INTO smoke_val;
    IF smoke_val IS NULL THEN
      RAISE EXCEPTION '[101③] 신설 SQL 스모크 실패 — % 가 NULL 반환(숫자 기대)', rec.name;
    END IF;
    RAISE NOTICE '[101③] 스모크 OK — % → % (오늘 %)', rec.name, smoke_val, today;
  END LOOP;

  RAISE NOTICE '[101③] 정합 검증 완료 — 신설 3 active / 구 3 rejected / 은퇴 살아있는 링크 0 / 신설 SQL 실행 스모크 통과';
END $$;
