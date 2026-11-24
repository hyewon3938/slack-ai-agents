import { describe, it, expect } from 'vitest';
import {
  validateSelectQuery,
  validateModifyQuery,
  validateUserIdFilter,
} from '../../../shared/sql-tools/validation.js';
import {
  buildAnalysisSection,
  buildDataRulesSection,
  buildScheduleInsertSection,
  buildScheduleQuerySection,
  buildSleepModifySection,
} from '../prompt-sections.js';

/**
 * 프롬프트의 SQL 예시가 query_db·modify_db 검증을 통과하는지 고정한다.
 * 프롬프트에서 뽑을 수 있는 예시는 프롬프트 문자열에서 직접 뽑고,
 * 규칙만 안내하는 형태는 완성된 SQL로 적어 넣는다.
 */

const USER_ID = 7;
const DAY = "'2026-11-25'";

const checkQuery = (sql: string): string | null =>
  validateSelectQuery(sql) ?? validateUserIdFilter(sql, USER_ID);

const checkModify = (sql: string): string | null =>
  validateModifyQuery(sql) ?? validateUserIdFilter(sql, USER_ID);

/** 섹션에서 정규식 첫 그룹을 뽑는다. 없으면 프롬프트가 바뀐 것이므로 실패 */
const pick = (section: string, pattern: RegExp): string => {
  const found = pattern.exec(section)?.[1];
  if (found === undefined) throw new Error(`프롬프트에서 예시를 찾지 못함: ${pattern}`);
  return found;
};

/** 분석 가이드의 번호 붙은 SQL 블록들. $1·$2는 날짜 리터럴로 채운다 */
const analysisQueries = (): string[] => {
  const section = buildAnalysisSection(USER_ID);
  const blocks = [...section.matchAll(/^\d\. .+:\n([\s\S]+?)\n\n/gm)].map((m) => m[1] ?? '');
  return blocks.map((sql) => sql.replace(/\$1/g, "'2026-11-01'").replace(/\$2/g, "'2026-11-25'"));
};

/** 일정 조회 3대 규칙을 합친 완성 쿼리 */
const scheduleQuery = (): string => {
  const section = buildScheduleQuerySection(USER_ID);
  const where = pick(section, /^(WHERE s\.user_id .+)$/m).replace(/'날짜'/g, DAY);
  const fromAndOrder = pick(section, /^(FROM schedules s\n[\s\S]+?s\.title)$/m);
  const [from, order] = fromAndOrder.split(/\n(?=ORDER BY)/);
  return `SELECT s.*, EXTRACT(DOW FROM s.date) AS dow ${from} ${where} ${order}`;
};

describe('프롬프트 SQL 예시 — 프롬프트에서 뽑은 문장', () => {
  it('분석 가이드 크로스 분석 SQL 3개', () => {
    const queries = analysisQueries();
    expect(queries).toHaveLength(3);
    for (const sql of queries) expect(checkQuery(sql)).toBeNull();
  });

  it('일정 조회 JOIN + 정렬', () => {
    expect(checkQuery(scheduleQuery())).toBeNull();
  });

  it('카테고리 id를 조회해 일정 INSERT', () => {
    const sql = pick(buildScheduleInsertSection(USER_ID), /(INSERT INTO schedules \(user_id[\s\S]+?LIMIT 1;)/);
    expect(checkModify(sql.replace(/'날짜'/g, DAY))).toBeNull();
  });

  it('수면 레코드 UPDATE·태그 추가·중간 기상 INSERT', () => {
    const section = buildSleepModifySection(USER_ID);
    const update = pick(section, /예: (UPDATE sleep_records SET wake_time.+)$/m);
    const tags = pick(section, /기존에 추가: (UPDATE sleep_records SET tags.+ANY\(tags\)\))/);
    const event = pick(section, /예: (INSERT INTO sleep_events.+)$/m);
    expect(checkModify(update)).toBeNull();
    expect(checkModify(tags.replace('원본ID', '3'))).toBeNull();
    expect(checkModify(event.replace("'오늘'", DAY))).toBeNull();
  });

  it('루틴명 매칭으로 루틴 메모 UPDATE', () => {
    const where = pick(buildDataRulesSection(USER_ID), /루틴명 매칭: (WHERE .+)$/m);
    const sql = `UPDATE routine_records SET memo = '새 메모' ${where.replace('%키워드%', '%코세척%')} AND date = ${DAY}`;
    expect(checkModify(sql)).toBeNull();
  });
});

describe('프롬프트 SQL 예시 — 안내 규칙을 완성한 조회', () => {
  it.each([
    ['요일 계산', `SELECT *, EXTRACT(DOW FROM date) as dow FROM schedules WHERE user_id = 7 AND date = ${DAY}`],
    [
      '다음 요일 날짜 계산',
      `SELECT (${DAY}::date + n)::text FROM generate_series(1,7) n WHERE EXTRACT(DOW FROM ${DAY}::date + n) = 1 LIMIT 1;`,
    ],
    ['카테고리 id 조회', "SELECT id FROM categories WHERE user_id = 7 AND name = '업무'"],
    ['백로그', 'SELECT * FROM schedules WHERE user_id = 7 AND date IS NULL'],
    ['수면 시간 계산', "SELECT EXTRACT(EPOCH FROM ('07:00'::time - '23:00'::time + INTERVAL '24h')) / 60 % 1440"],
    [
      '수면 INSERT 전 중복 확인',
      `SELECT id FROM sleep_records WHERE user_id = 7 AND date = ${DAY} AND sleep_type = 'night' AND bedtime = '00:30'`,
    ],
    ['중간 기상 조회', `SELECT event_time, memo FROM sleep_events WHERE user_id = 7 AND date = ${DAY}`],
    [
      '루틴 달성률 (시작일 이후)',
      "SELECT COUNT(*) FILTER (WHERE r.completed) FROM routine_records r JOIN routine_templates t ON t.id = r.template_id AND t.user_id = 7 WHERE r.user_id = 7 AND r.date >= t.start_date AND r.entry_type = 'scheduled'",
    ],
    ['리마인더 조회', 'SELECT * FROM reminders WHERE active = true'],
    ['알림 슬롯 조회', 'SELECT * FROM notification_settings ORDER BY id'],
    ['지시사항 조회', 'SELECT * FROM custom_instructions WHERE user_id = 7 AND active = true'],
  ])('%s', (_name, sql) => {
    expect(checkQuery(sql)).toBeNull();
  });
});

describe('프롬프트 SQL 예시 — 안내 규칙을 완성한 변경', () => {
  it.each([
    ['일정 INSERT', `INSERT INTO schedules (user_id, title, date, status) VALUES (7, '제목', ${DAY}, 'todo')`],
    ['일정 메모', "UPDATE schedules SET memo = '메모' WHERE user_id = 7 AND id = 3"],
    ['일정 삭제', 'DELETE FROM schedules WHERE user_id = 7 AND id = 3'],
    [
      '삭제 사유 기록',
      "UPDATE schedule_changes SET delete_reason_category = 'mistake' WHERE user_id = 7 AND schedule_id = 3 AND change_type = 'deleted' AND delete_reason_category IS NULL",
    ],
    ['수면 날짜 이동', "UPDATE sleep_records SET date = '2026-11-24' WHERE user_id = 7 AND id = 3"],
    ['수면 메모 append', "UPDATE sleep_records SET memo = memo || E'\\n' || '새 메모' WHERE user_id = 7 AND id = 3"],
    [
      '수면 메모만 INSERT',
      `INSERT INTO sleep_records (user_id, date, sleep_type, memo) VALUES (7, ${DAY}, 'night', '메모 내용')`,
    ],
    [
      '수면 INSERT + 태그',
      `INSERT INTO sleep_records (user_id, date, bedtime, wake_time, duration_minutes, sleep_type, tags) VALUES (7, ${DAY}, '00:30', '09:00', 510, 'night', ARRAY['악몽'])`,
    ],
    ['리마인더 일회성', `INSERT INTO reminders (title, time_value, date) VALUES ('약', '09:00', ${DAY})`],
    [
      '리마인더 매주',
      "INSERT INTO reminders (title, time_value, frequency, days_of_week) VALUES ('운동', '19:00', '매주', ARRAY[1,3,5])",
    ],
    ['리마인더 취소', 'UPDATE reminders SET active = false WHERE id = 3'],
    ['알림 슬롯 시간 변경', "UPDATE notification_settings SET time_value = '09:10' WHERE slot_name = 'morning'"],
    [
      '루틴 추가',
      "INSERT INTO routine_templates (user_id, name, time_slot, frequency) VALUES (7, '스트레칭', '밤', '매일')",
    ],
    [
      '루틴 오늘 기록 추가',
      `INSERT INTO routine_records (user_id, template_id, date) SELECT 7, id, ${DAY} FROM routine_templates WHERE user_id = 7 AND name = '스트레칭'`,
    ],
    ['루틴 삭제', 'UPDATE routine_templates SET active = false WHERE user_id = 7 AND id = 3'],
    [
      '지시사항 등록',
      "INSERT INTO custom_instructions (user_id, instruction, category, source) VALUES (7, '일정은 짧게 보여줘', '응답', 'user')",
    ],
    ['지시사항 삭제', 'UPDATE custom_instructions SET active = false WHERE user_id = 7 AND id = 3'],
  ])('%s', (_name, sql) => {
    expect(checkModify(sql)).toBeNull();
  });
});
