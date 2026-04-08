import { query, queryOne } from '@/lib/db';
import type {
  RoutineTemplateRow,
  RoutineRecordRow,
  RoutineDayStat,
  RoutinePerStat,
  RoutineInactivePeriod,
  RoutineHeatmapDay,
  RoutineHeatmapData,
} from '@/features/routine/lib/types';

// ─── 템플릿 CRUD ─────────────────────────────────────

/** 모든 템플릿 조회 (삭제된 항목 제외, active 먼저 정렬) */
export async function queryRoutineTemplates(userId: number): Promise<RoutineTemplateRow[]> {
  const { rows } = await query<RoutineTemplateRow>(
    `SELECT id, name, time_slot, frequency, active, start_date::text, created_at::text
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
  data: { name: string; time_slot: string | null; frequency: string | null; start_date?: string },
): Promise<RoutineTemplateRow> {
  const row = data.start_date
    ? await queryOne<RoutineTemplateRow>(
        `INSERT INTO routine_templates (user_id, name, time_slot, frequency, active, start_date)
         VALUES ($1, $2, $3, $4, true, $5)
         RETURNING id, name, time_slot, frequency, active, start_date::text, created_at::text`,
        [userId, data.name, data.time_slot, data.frequency, data.start_date],
      )
    : await queryOne<RoutineTemplateRow>(
        `INSERT INTO routine_templates (user_id, name, time_slot, frequency, active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id, name, time_slot, frequency, active, start_date::text, created_at::text`,
        [userId, data.name, data.time_slot, data.frequency],
      );
  if (!row) throw new Error('createRoutineTemplate: INSERT returned no rows');
  return row;
}

/** 템플릿 수정 */
const TEMPLATE_COLUMNS = new Set(['name', 'time_slot', 'frequency', 'active', 'start_date']);

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
     RETURNING id, name, time_slot, frequency, active, start_date::text, created_at::text`,
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
     WHERE r.date = $1 AND r.user_id = $2 AND t.deleted_at IS NULL
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

function shouldCreateToday(frequency: string | null, lastDate: string | null, today: string, startDate?: string): boolean {
  if (!frequency || frequency === '매일') return true;

  // 간격 빈도(격일, N일마다): start_date 기준 모듈러 연산
  const interval = parseIntervalDays(frequency);
  if (interval && startDate) {
    const gap = daysBetween(startDate, today);
    return gap >= 0 && gap % interval === 0;
  }

  // 주1회: 기존 gap 기반 유지
  if (!lastDate) return true;
  const gap = daysBetween(lastDate, today);
  if (frequency === '주1회') return gap >= 7;

  // 간격 빈도인데 startDate 없는 경우 (폴백)
  if (interval) return gap >= interval;
  return true;
}

/** 오늘 기록 자동 생성 (아직 없는 active 템플릿만) */
export async function ensureTodayRecords(userId: number, date: string): Promise<number> {
  const { rows: templates } = await query<{ id: number; frequency: string | null; start_date: string }>(
    `SELECT id, frequency, start_date::text FROM routine_templates WHERE active = true AND deleted_at IS NULL AND user_id = $1`,
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
    if (!shouldCreateToday(t.frequency, lastDateMap.get(t.id) ?? null, date, t.start_date)) continue;
    await query(
      `INSERT INTO routine_records (user_id, template_id, date, completed) VALUES ($1, $2, $3, false)`,
      [userId, t.id, date],
    );
    created++;
  }
  return created;
}

// ─── 통계 ────────────────────────────────────────────

/** 기간별 달성률 통계 (비활성 기간 제외) */
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
       AND NOT EXISTS (
         SELECT 1 FROM routine_inactive_periods ip
         WHERE ip.template_id = r.template_id
           AND r.date >= ip.start_date
           AND (ip.end_date IS NULL OR r.date <= ip.end_date)
       )
     GROUP BY r.date
     ORDER BY r.date`,
    [userId, from, to],
  );
  return rows;
}

/** 루틴별 달성률 — 비활성 기간 제외, start_date 기준 */
export async function queryRoutinePerStats(
  userId: number,
  from?: string,
  to?: string,
): Promise<RoutinePerStat[]> {
  const hasRange = from && to;
  const toExpr = hasRange ? '$3::date' : 'CURRENT_DATE';

  const { rows } = await query<RoutinePerStat>(
    `SELECT r.template_id,
            t.name,
            t.time_slot,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE r.completed)::int AS completed,
            CASE WHEN COUNT(*) > 0
              THEN ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric / COUNT(*) * 100)::int
              ELSE 0
            END AS rate,
            GREATEST(1, (${toExpr} - t.start_date) + 1
              - COALESCE((
                SELECT SUM(
                  LEAST(COALESCE(ip.end_date, ${toExpr}), ${toExpr})
                  - GREATEST(ip.start_date, t.start_date) + 1
                )
                FROM routine_inactive_periods ip
                WHERE ip.template_id = r.template_id
                  AND GREATEST(ip.start_date, t.start_date) <= LEAST(COALESCE(ip.end_date, ${toExpr}), ${toExpr})
              ), 0))::int AS days_active
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.user_id = $1 AND t.deleted_at IS NULL
       AND r.date >= t.start_date
       AND NOT EXISTS (
         SELECT 1 FROM routine_inactive_periods ip
         WHERE ip.template_id = r.template_id
           AND r.date >= ip.start_date
           AND (ip.end_date IS NULL OR r.date <= ip.end_date)
       )
       ${hasRange ? 'AND r.date BETWEEN $2 AND $3' : 'AND t.active = true'}
     GROUP BY r.template_id, t.name, t.time_slot, t.start_date
     ORDER BY rate DESC, t.name`,
    hasRange ? [userId, from, to] : [userId],
  );
  return rows;
}

// ─── 비활성 기간 CRUD ────────────────────────────────

/** 특정 루틴의 비활성 기간 조회 */
export async function queryInactivePeriods(
  userId: number,
  templateId: number,
): Promise<RoutineInactivePeriod[]> {
  const { rows } = await query<RoutineInactivePeriod>(
    `SELECT id, template_id, start_date::text, end_date::text
     FROM routine_inactive_periods
     WHERE user_id = $1 AND template_id = $2
     ORDER BY start_date DESC`,
    [userId, templateId],
  );
  return rows;
}

/** 비활성 기간 생성 */
export async function createInactivePeriod(
  userId: number,
  templateId: number,
  startDate: string,
  endDate: string | null,
): Promise<RoutineInactivePeriod> {
  const row = await queryOne<RoutineInactivePeriod>(
    `INSERT INTO routine_inactive_periods (user_id, template_id, start_date, end_date)
     VALUES ($1, $2, $3, $4)
     RETURNING id, template_id, start_date::text, end_date::text`,
    [userId, templateId, startDate, endDate],
  );
  if (!row) throw new Error('createInactivePeriod: INSERT returned no rows');
  return row;
}

/** 비활성 기간 수정 */
export async function updateInactivePeriod(
  userId: number,
  periodId: number,
  startDate: string,
  endDate: string | null,
): Promise<RoutineInactivePeriod | null> {
  return queryOne<RoutineInactivePeriod>(
    `UPDATE routine_inactive_periods
     SET start_date = $3, end_date = $4
     WHERE id = $1 AND user_id = $2
     RETURNING id, template_id, start_date::text, end_date::text`,
    [periodId, userId, startDate, endDate],
  );
}

/** 비활성 기간 삭제 */
export async function deleteInactivePeriod(
  userId: number,
  periodId: number,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM routine_inactive_periods WHERE id = $1 AND user_id = $2`,
    [periodId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 열린 비활성 기간 종료 (재개 시) */
export async function closeOpenInactivePeriod(
  userId: number,
  templateId: number,
  endDate: string,
): Promise<void> {
  await query(
    `UPDATE routine_inactive_periods
     SET end_date = $3
     WHERE user_id = $1 AND template_id = $2 AND end_date IS NULL`,
    [userId, templateId, endDate],
  );
}

// ─── 루틴별 히트맵 ───────────────────────────────────

/** 루틴별 월간 히트맵 데이터 (기록 + 비활성 기간 + 시작일) */
export async function queryRoutineHeatmap(
  userId: number,
  templateId: number,
  year: number,
  month: number,
): Promise<RoutineHeatmapData> {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const [recordsResult, periodsResult, templateResult] = await Promise.all([
    query<RoutineHeatmapDay>(
      `SELECT date::text, completed
       FROM routine_records
       WHERE user_id = $1 AND template_id = $2 AND date BETWEEN $3 AND $4
       ORDER BY date`,
      [userId, templateId, from, to],
    ),
    query<RoutineInactivePeriod>(
      `SELECT id, template_id, start_date::text, end_date::text
       FROM routine_inactive_periods
       WHERE user_id = $1 AND template_id = $2
         AND start_date <= $4
         AND (end_date IS NULL OR end_date >= $3)
       ORDER BY start_date`,
      [userId, templateId, from, to],
    ),
    queryOne<{ start_date: string }>(
      `SELECT start_date::text FROM routine_templates WHERE id = $1 AND user_id = $2`,
      [templateId, userId],
    ),
  ]);

  return {
    records: recordsResult.rows,
    inactivePeriods: periodsResult.rows,
    startDate: templateResult?.start_date ?? from,
  };
}

// ─── 백필 ────────────────────────────────────────────

/** 날짜에 일수 더하기 (KST 기준) */
function addDaysISO(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00+09:00');
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 과거 start_date부터 오늘까지 빈도에 맞는 기록을 백필 (최대 30일) */
export async function backfillRecords(
  userId: number,
  templateId: number,
  startDate: string,
  frequency: string | null,
  today: string,
): Promise<number> {
  if (startDate >= today) return 0;

  const maxBackfillDays = 30;
  const totalGap = daysBetween(startDate, today);
  if (totalGap > maxBackfillDays) return 0;

  // 이미 존재하는 기록 확인
  const { rows: existing } = await query<{ date: string }>(
    `SELECT date::text FROM routine_records WHERE user_id = $1 AND template_id = $2 AND date BETWEEN $3 AND $4`,
    [userId, templateId, startDate, today],
  );
  const existingDates = new Set(existing.map((r) => r.date));

  const interval = parseIntervalDays(frequency ?? '');
  let created = 0;

  if (interval) {
    // 간격 빈도: start_date부터 interval 간격으로 생성 (오늘 제외 — ensureTodayRecords가 처리)
    for (let d = 0; d < totalGap; d += interval) {
      const date = addDaysISO(startDate, d);
      if (!existingDates.has(date)) {
        await query(
          `INSERT INTO routine_records (user_id, template_id, date, completed) VALUES ($1, $2, $3, false)`,
          [userId, templateId, date],
        );
        created++;
      }
    }
  } else {
    // 매일/주1회: start_date 기록만 생성
    if (!existingDates.has(startDate)) {
      await query(
        `INSERT INTO routine_records (user_id, template_id, date, completed) VALUES ($1, $2, $3, false)`,
        [userId, templateId, startDate],
      );
      created++;
    }
  }

  return created;
}
