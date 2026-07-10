-- 107: 수면 신호 확장 + 세그먼트 교정 + sleep_events 사용자 스코프 승격 (#593, 마스터 #588 Phase 2)
-- 배경: Phase 1(105, ADR-0059)이 분할 수면 세그먼트 의미론 + sleep_events.user_id(nullable 백필) +
--   sleep_records.tags를 도입했다. Phase 2는 통계/데이터 레이어 마무리:
--   ① sleep_events.user_id NOT NULL 승격 — 봇 프롬프트가 이번 Phase부터 user_id를 기록 → 스코프 확정.
--   ② sleep_wake_hour 교정(MIN→MAX) — 분할 수면에서 MIN(wake_time)은 중간 세그먼트의 이른 기상을 집어
--      "최종 기상"을 왜곡한다. MAX로 최종 기상을 집는다(방향·타입·도메인 불변, 측정 대상만 교정 — 100/101 전례).
--   ③ 수면 신호 2건 신설 — sleep_midwake_count(중간기상 횟수)·sleep_onset_late_minutes(취침 지각 분).
-- 신호 테이블 = signal_defs (077이 pattern_metrics를 이관·globalize, 085 dedup 후 active sql 신호는
--   부분 유니크 인덱스 uq_signal_defs_sql_active로 전역 1개 보장). 시드 신호는 source='seed'라
--   signal-sql-guard(LLM 전용)·승인 게이트 비대상 — active 즉시 다음 월요일 P5a 발굴이 (시드×신호) 후보
--   여집합에 자동 편입(086·101·106 전례). 추가 배선(pattern_links·seed_pool) 불필요.
-- 안전: 파일 전체가 단일 암묵 트랜잭션(migrate.ts) — 검증 DO 블록 RAISE 시 전체 롤백. 재실행 idempotent
--   (backfill=NULL만 / ALTER SET NOT NULL 멱등 / UPDATE 동일값 재설정 / INSERT ON CONFLICT DO NOTHING).
--   106은 진행 중인 다른 브랜치(#590)가 선점 — 번호 갭 무해(러너는 파일명 순 미적용분만 실행).

-- ═══ ① sleep_events.user_id NOT NULL 승격 ═══════════════════
-- 105가 백필했으나 그 이후 user_id 없이 삽입된 잔여 행 방어(멱등 — NULL 없으면 no-op).
UPDATE sleep_events SET user_id = (SELECT MIN(id) FROM users) WHERE user_id IS NULL;
ALTER TABLE sleep_events ALTER COLUMN user_id SET NOT NULL;

-- ═══ ② sleep_wake_hour 교정 — MIN→MAX(최종 기상) ═══════════
-- signal_defs.sql_body만 교체(direction above_avg·value_type·threshold·domain 불변). 085 dedup 후 active
-- 1행 보장 → 유니크 인덱스 충돌 없음. 미시드 환경은 0행 매칭(무해). 동일값 재설정이라 멱등.
UPDATE signal_defs
   SET sql_body = $sql$SELECT COALESCE(EXTRACT(HOUR FROM MAX(wake_time::time)),0) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='night'$sql$
 WHERE user_id = 1 AND name = 'sleep_wake_hour' AND kind = 'sql' AND status = 'active';

-- ═══ ③ 수면 신호 2건 신설 (086/101/106 signal_defs INSERT 포맷) ═══
-- sleep_midwake_count: 밤중 깬 횟수 = 그날 sleep_events 수. COUNT라 결측=0(유효 관측). 늘수록 나쁨→above_avg.
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'sleep_midwake_count', 'sql',
  $sql$SELECT COUNT(*) FROM sleep_events WHERE user_id=$1 AND date=$2$sql$,
  'continuous', 'above_avg', NULL, 'sleep',
  '밤중 깬 횟수 — 수면 세그먼트 사이 중간 기상(sleep_events 수)', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- sleep_onset_late_minutes: 첫 밤 세그먼트 onset의 자정 기준 지각 분(20:00 이후 취침은 -1440 래핑 →
--   자정 후 취침은 양수, 자정 전 취침은 음수). 늦을수록 큼(above_avg). COALESCE(...,0)로 결측=0.
--   value_type=continuous — count 성격이어도 CHECK가 binary|continuous만 허용(count 위반).
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'sleep_onset_late_minutes', 'sql',
  $sql$SELECT COALESCE(MIN(CASE WHEN bedtime::time >= '20:00' THEN EXTRACT(EPOCH FROM bedtime::time)/60 - 1440 ELSE EXTRACT(EPOCH FROM bedtime::time)/60 END),0) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='night' AND bedtime IS NOT NULL$sql$,
  'continuous', 'above_avg', NULL, 'sleep',
  '취침 지각 분 — 자정 기준 첫 세그먼트 onset 지각(늦을수록 큼)', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- ═══ ④ 자기검증 — 교정 정합 + 신설 카운트 + SQL 실행 스모크(101 §③ 패턴) ═══
-- 신설 2 + 교정 1 신호의 sql_body를 user_id=1·오늘로 EXECUTE해 스키마-SQL 정합을 런타임 봉인
-- (좀비 신호 재발 차단 #573). COALESCE/COUNT라 정상 시 NULL 불가 → NULL이면 즉시 RAISE.
DO $$
DECLARE
  new_active INT;
  smoke_val NUMERIC;
  rec RECORD;
  today TEXT := to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD');
BEGIN
  -- 교정 누락 방어: active sleep_wake_hour가 아직 MIN(wake_time)이면 교정 미적용 → 실패.
  -- 미시드 환경은 active 0행이라 EXISTS false(무해).
  IF EXISTS (SELECT 1 FROM signal_defs
              WHERE user_id = 1 AND name = 'sleep_wake_hour' AND status = 'active'
                AND sql_body LIKE '%MIN(wake_time%') THEN
    RAISE EXCEPTION '[107④] sleep_wake_hour 교정 누락 — 아직 MIN(wake_time) 정의 잔존';
  END IF;

  -- 신설 2신호 active.
  SELECT count(*) INTO new_active FROM signal_defs
   WHERE user_id = 1 AND status = 'active'
     AND name IN ('sleep_midwake_count', 'sleep_onset_late_minutes');
  IF new_active <> 2 THEN
    RAISE EXCEPTION '[107④] 신설 2신호 active 수 이상 — % (기대 2)', new_active;
  END IF;

  -- SQL 실행 스모크: 교정·신설 3신호(active인 것만) sql_body를 $1=1·$2=오늘로 EXECUTE.
  -- (pattern-match.ts runMetricSql 치환 규칙 — $1→'1', $2→'YYYY-MM-DD' 리터럴.)
  FOR rec IN
    SELECT name, sql_body FROM signal_defs
     WHERE user_id = 1 AND status = 'active'
       AND name IN ('sleep_wake_hour', 'sleep_midwake_count', 'sleep_onset_late_minutes')
  LOOP
    EXECUTE replace(replace(rec.sql_body, '$1', '1'), '$2', quote_literal(today)) INTO smoke_val;
    IF smoke_val IS NULL THEN
      RAISE EXCEPTION '[107④] SQL 스모크 실패 — % 가 NULL 반환(숫자 기대)', rec.name;
    END IF;
    RAISE NOTICE '[107④] 스모크 OK — % → % (오늘 %)', rec.name, smoke_val, today;
  END LOOP;

  RAISE NOTICE '[107④] 자기검증 완료 — 신설 2 active / sleep_wake_hour MAX 교정 / SQL 실행 스모크 통과';
END $$;

-- ═══ ⑤ sleep_events NOT NULL 정합 검증 ═════════════════════
DO $$
DECLARE
  nullable TEXT;
BEGIN
  SELECT is_nullable INTO nullable FROM information_schema.columns
   WHERE table_name = 'sleep_events' AND column_name = 'user_id';
  IF nullable <> 'NO' THEN
    RAISE EXCEPTION '[107⑤] sleep_events.user_id NOT NULL 승격 실패 — is_nullable=%', nullable;
  END IF;
  RAISE NOTICE '[107⑤] sleep_events.user_id NOT NULL 승격 확인';
END $$;
