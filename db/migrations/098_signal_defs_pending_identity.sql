-- 098: 신호 재생성 가드 — active/pending 부분 unique 인덱스 (#557)
-- 배경: 085가 active sql 신호에 부분 unique 인덱스(uq_signal_defs_sql_active)를 걸어 동일 측정
--   신호의 재-active를 막았으나 status='pending'은 인덱스 밖이었다. monthly-signal-suggest routine(repo 밖)이
--   동일 정의를 pending으로 INSERT하면 인덱스에 걸리지 않고 슬쩍 들어와 승인 카드로 노출된다(피로 + m-인플레).
-- 변경: 같은 시맨틱 키의 부분 unique 인덱스를 status IN ('active','pending')으로 확장 신설. 085 인덱스와
--   공존(active만 vs active+pending) — 085는 active 재삽입, 098은 active/pending 간 중복까지 구조적 차단.
-- 키: 085와 동일 (user_id, name, sql_body, value_type, direction, COALESCE(threshold,-1),
--   COALESCE(domain,''), COALESCE(window_days,-1)). NULL은 센티널로 distinct 방지. tag 신호는
--   077 uq_signal_defs_tag(user, tag)가 이미 전역 1개를 보장하므로 sql 신호만 대상.
-- 안전(방어적): prod에 이미 active/pending 동일 정의가 있으면 CREATE UNIQUE INDEX가 실패해 마이그레이션
--   전체가 롤백된다. 사전에 위반을 세어 있으면 NOTICE만 내고 인덱스 생성을 건너뛴다(데이터 dedup은 별도
--   후속 — 링크 FK repoint 위험을 야간 배포에 싣지 않는다). 위반 0이면 인덱스 생성. 멱등(IF NOT EXISTS).

DO $$
DECLARE
  dup_cnt INT;
BEGIN
  -- active/pending sql 신호 중 동일 시맨틱 키가 2벌 이상인 그룹의 잉여 수.
  SELECT COALESCE(sum(cnt - 1), 0) INTO dup_cnt FROM (
    SELECT count(*) AS cnt FROM signal_defs
     WHERE kind = 'sql' AND status IN ('active', 'pending')
     GROUP BY user_id, name, sql_body, value_type, direction,
              COALESCE(threshold, '-1'::numeric), COALESCE(domain, ''), COALESCE(window_days, -1)
    HAVING count(*) > 1
  ) g;

  IF dup_cnt <> 0 THEN
    RAISE NOTICE '[098] active/pending sql 신호 동일 정의 중복 % 건 잔존 → 인덱스 생성 건너뜀(코드 가드로 방어, dedup은 후속)', dup_cnt;
  ELSE
    EXECUTE $ix$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_defs_sql_active_pending
        ON signal_defs (
          user_id, name, sql_body, value_type, direction,
          COALESCE(threshold, '-1'::numeric), COALESCE(domain, ''), COALESCE(window_days, -1)
        )
        WHERE kind = 'sql' AND status IN ('active', 'pending')
    $ix$;
    RAISE NOTICE '[098] active/pending sql 신호 부분 unique 인덱스 생성 완료';
  END IF;
END $$;
