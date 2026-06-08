-- 085: 중복 신호 정규화 (#504 Phase 1, ADR-0044)
-- 배경: 077이 pattern_metrics(시드별 행)를 signal_defs로 1:1 이관하며 동일 측정 신호가 시드 수만큼
--   중복 생성됨(예: sleep_total_minutes 2벌, schedule_completion_rate 5벌, expense_의료건강 5벌).
--   전역 신호 globalization이 불완전 → 발굴이 같은 측정을 여러 후보로 surface(동일 카드 2장+) +
--   여집합 cross-product를 부풀려 허수 후보가 top-N 잠식.
-- 변경: ① 전체 시맨틱 키로 중복 그룹 → canonical(active 우선, 그다음 MIN id) ② pattern_links repoint
--   (충돌·중복은 삭제, canonical 우선) ③ 잉여 신호 status='rejected' ④ active sql 신호 부분 unique 인덱스.
-- 키: (user_id, name, kind, sql_body, value_type, direction, threshold, domain, window_days) 전체 일치만
--   "같은 신호"로 본다(방향만 다른 schedule_count_today above/below는 보존). NULL은 PARTITION BY에서 동일군.
-- 안전: 멱등(재실행 시 rejected 제외 → signal_dedup 빈 집합 → 무변화). 검증은 raw 재계산이라
--   삭제된 충돌 링크의 카운터 손실은 다음 주간 엔진에서 self-heal. tag 신호는 077 uq_signal_defs_tag가 보장.

-- ① 중복 그룹 → canonical 매핑 (active 우선, 그다음 MIN id). 비-canonical만 적재.
CREATE TEMP TABLE signal_dedup ON COMMIT DROP AS
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY user_id, name, kind, sql_body, value_type, direction, threshold, domain, window_days
           ORDER BY (status = 'active') DESC, id ASC
         ) AS canonical_id
    FROM signal_defs
   WHERE kind = 'sql' AND status <> 'rejected'
)
SELECT id, canonical_id FROM ranked WHERE id <> canonical_id;

-- ② 링크 repoint (UNIQUE(seed_id, signal_id) 위반 없이):
--    A. canonical 링크가 이미 있는 dup 링크 삭제(canonical 우선).
DELETE FROM pattern_links pl
 USING signal_dedup d
 WHERE pl.signal_id = d.id
   AND EXISTS (
     SELECT 1 FROM pattern_links c
      WHERE c.seed_id = pl.seed_id AND c.signal_id = d.canonical_id
   );

--    B. 같은 (seed, canonical)로 모일 dup 링크가 여럿이면 최소 id 1개만 남기고 삭제.
DELETE FROM pattern_links pl
 USING (
   SELECT p.id,
          row_number() OVER (PARTITION BY p.seed_id, d.canonical_id ORDER BY p.id) AS rn
     FROM pattern_links p
     JOIN signal_dedup d ON d.id = p.signal_id
 ) ranked
 WHERE pl.id = ranked.id AND ranked.rn > 1;

--    C. 남은 dup 링크(각 (seed, canonical)당 1개, canonical 링크 없음)를 canonical로 이전.
UPDATE pattern_links pl
   SET signal_id = d.canonical_id, updated_at = NOW()
  FROM signal_dedup d
 WHERE pl.signal_id = d.id;

-- ③ 잉여 신호 비활성화 (삭제 대신 rejected — FK·이력 보존, active 인덱스에서 빠짐).
UPDATE signal_defs SET status = 'rejected'
 WHERE id IN (SELECT id FROM signal_dedup);

-- ④ 재발 차단 — active sql 신호 부분 unique 인덱스 (tag는 077 uq_signal_defs_tag가 이미 보장).
--    NULL 컬럼은 COALESCE 센티널로 distinct 방지(연속 above_avg threshold NULL 등). 센티널(-1·'')은
--    실제 값과 충돌 불가(count/minute ≥ 0, domain은 CHECK enum). pending/rejected는 인덱스 비대상.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_defs_sql_active
  ON signal_defs (
    user_id, name, sql_body, value_type, direction,
    COALESCE(threshold, '-1'::numeric), COALESCE(domain, ''), COALESCE(window_days, -1)
  )
  WHERE kind = 'sql' AND status = 'active';

-- ⑤ 정합 검증 (RAISE 시 파일 트랜잭션 롤백)
DO $$
DECLARE
  rejected_cnt INT;
  dup_active INT;
  orphan_links INT;
BEGIN
  SELECT count(*) INTO rejected_cnt FROM signal_dedup;

  -- active sql 신호에 동일 시맨틱 키 중복이 0이어야 함
  SELECT COALESCE(sum(cnt - 1), 0) INTO dup_active FROM (
    SELECT count(*) AS cnt FROM signal_defs
     WHERE kind = 'sql' AND status = 'active'
     GROUP BY user_id, name, sql_body, value_type, direction,
              COALESCE(threshold, '-1'::numeric), COALESCE(domain, ''), COALESCE(window_days, -1)
    HAVING count(*) > 1
  ) g;
  IF dup_active <> 0 THEN
    RAISE EXCEPTION '[085] active sql 신호 중복 % 건 잔존', dup_active;
  END IF;

  -- rejected(잉여)를 가리키는 active 링크가 없어야 함
  SELECT count(*) INTO orphan_links
    FROM pattern_links pl JOIN signal_defs s ON s.id = pl.signal_id
   WHERE s.status = 'rejected' AND pl.status = 'active';
  IF orphan_links <> 0 THEN
    RAISE EXCEPTION '[085] rejected 신호를 가리키는 active 링크 % 건', orphan_links;
  END IF;

  RAISE NOTICE '[085] 중복 신호 정규화 완료 — 잉여 % 신호 rejected, active 중복 0', rejected_cnt;
END $$;
