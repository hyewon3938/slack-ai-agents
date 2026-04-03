import { query, queryOne } from '@/lib/db';
import type { RoutineTemplateRow, RoutineRecordRow, RoutineDayStat } from '@/lib/types';

// ─── 템플릿 CRUD ─────────────────────────────────────

/** 모든 템플릿 조회 (삭제된 항목 제외, active 먼저 정렬) */
export async function queryRoutineTemplates(userId: number): Promise<RoutineTemplateRow[]> {
  const { rows } = await query<RoutineTemplateRow>(
    `SELECT id, name, time_slot, frequency, active, created_at::text
     FROM routine_templates
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY active DESC, time_slot, name`,
    [userId],
  );
  return rows;
}

/** 템플릿 생성 */
export async function createRoutineTemplate(
  userId: number,
  data: { name: string; time_slot: string | null; frequency: string | null },
): Promise<RoutineTemplateRow> {
  const row = await queryOne<RoutineTemplateRow>(
    `INSERT INTO routine_templates (user_id, name, time_slot, frequency, active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, name, time_slot, frequency, active, created_at::text`,
    [userId, data.name, data.time_slot, data.frequency],
  );
  if (!row) throw new Error('createRoutineTemplate: INSERT returned no rows');
  return row;
}

/** 템플릿 수정 */
const TEMPLATE_COLUMNS = new Set(['name', 'time_slot', 'frequency', 'active']);

export async function updateRoutineTemplate(
  userId: number,
  id: number,
  updates: Record<string, unknown>,
): Promise<RoutineTemplateRow | null> {
  const entries = Object.entries(updates).filter(([k]) => TEMPLATE_COLUMNS.has(k));
  if (entries.length === 0) return null;

  const setClauses = entries.map(([k], i) => `${k} = $${i + 3}`);
  const values = entries.map(([, v]) => v);

  return queryOne<RoutineTemplateRow>(
    `UPDATE routine_templates
     SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, time_slot, frequency, active, created_at::text`,
    [id, userId, ...values],
  );
}

/** 템플릿 삭제 (soft delete — UI에서 완전히 숨김, DB에는 보존) */
export async function deleteRoutineTemplate(userId: number, id: number): Promise<boolean> {
  const result = await query(
    `UPDATE routine_templates SET active = false, deleted_at = NOW() WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ─── 기록 ────────────────────────────────────────────

/** 날짜별 기록 조회 (템플릿 JOIN) */
export async function queryRoutineRecords(
  userId: number,
  date: string,
): Promise<RoutineRecordRow[]> {
  const { rows } = await query<RoutineRecordRow>(
    `SELECT r.id, r.template_id, r.date::text, r.completed,
            r.completed_at::text, r.memo,
            t.name, t.time_slot, t.frequency
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.date = $1 AND r.user_id = $2
     ORDER BY t.time_slot, t.name`,
    [date, userId],
  );
  return rows;
}

/** 기록 완료 토글 */
export async function toggleRoutineRecord(
  userId: number,
  id: number,
  completed: boolean,
): Promise<void> {
  await query(
    `UPDATE routine_records
     SET completed = $3, completed_at = ${completed ? 'NOW()' : 'NULL'}
     WHERE id = $1 AND user_id = $2`,
    [id, userId, completed],
  );
}

/** 기록 메모 수정 */
export async function updateRoutineRecordMemo(
  userId: number,
  id: number,
  memo: string | null,
): Promise<void> {
  await query(
    `UPDATE routine_records SET memo = $3 WHERE id = $1 AND user_id = $2`,
    [id, userId, memo],
  );
}

// ─── 빈도 판별 ───────────────────────────────────────

function daysBetween(from: string, to: string): number {
  const msPerDay = 86_400_000;
  return Math.round(
    (new Date(to + 'T00:00:00+09:00').getTime() -
      new Date(from + 'T00:00:00+09:00').getTime()) /
      msPerDay,
  );
}

function parseIntervalDays(frequency: string): number | null {
  if (frequency === '격일') return 2;
  const match = /^(\d+)일마다$/.exec(frequency);
  return match ? Number(match[1]) : null;
}

function shouldCreateToday(frequency: string | null, lastDate: string | null, today: string): boolean {
  if (!frequency || frequency === '매일') return true;
  if (!lastDate) return true;
  const gap = daysBetween(lastDate, today);
  if (frequency === '주1회') return gap >= 7;
  const interval = parseIntervalDays(frequency);
  return interval ? gap >= interval : true;
}

/** 오늘 기록 자동 생성 (아직 없는 active 템플릿만) */
export async function ensureTodayRecords(userId: number, date: string): Promise<number> {
  const { rows: templates } = await query<{ id: number; frequency: string | null }>(
    `SELECT id, frequency FROM routine_templates WHERE active = true AND deleted_at IS NULL AND user_id = $1`,
    [userId],
  );

  const { rows: existing } = await query<{ template_id: number }>(
    `SELECT template_id FROM routine_records WHERE date = $1 AND user_id = $2`,
    [date, userId],
  );
  const existingIds = new Set(existing.map((r) => r.template_id));

  // 가장 최근 기록 날짜 조회 (빈도 판별용)
  const { rows: lastRecords } = await query<{ template_id: number; last_date: string }>(
    `SELECT template_id, MAX(date)::text AS last_date
     FROM routine_records WHERE user_id = $1
     GROUP BY template_id`,
    [userId],
  );
  const lastDateMap = new Map(lastRecords.map((r) => [r.template_id, r.last_date]));

  let created = 0;
  for (const t of templates) {
    if (existingIds.has(t.id)) continue;
    if (!shouldCreateToday(t.frequency, lastDateMap.get(t.id) ?? null, date)) continue;
    await query(
      `INSERT INTO routine_records (user_id, template_id, date, completed) VALUES ($1, $2, $3, false)`,
      [userId, t.id, date],
    );
    created++;
  }
  return created;
}

// ─── 통계 ────────────────────────────────────────────

/** 기간별 달성률 통계 */
export async function queryRoutineStats(
  userId: number,
  from: string,
  to: string,
): Promise<RoutineDayStat[]> {
  const { rows } = await query<RoutineDayStat>(
    `SELECT r.date::text,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE r.completed)::int AS completed,
            CASE WHEN COUNT(*) > 0
              THEN ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric / COUNT(*) * 100)::int
              ELSE 0
            END AS rate
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.user_id = $1 AND r.date BETWEEN $2 AND $3
     GROUP BY r.date
     ORDER BY r.date`,
    [userId, from, to],
  );
  return rows;
}
