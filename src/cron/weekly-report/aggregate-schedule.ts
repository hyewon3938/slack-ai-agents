import { query } from '../../shared/db.js';
import { DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import type { WeeklyScheduleData } from './types.js';

// ─── 집계: 일정 ─────────────────────────────────────────

interface ScheduleSummaryRow {
  completed_count: number;
  incomplete_count: number;
  cancelled_count: number;
}

interface CategoryRow {
  category: string;
  count: number;
}

interface OverdueRow {
  overdue_count: number;
}

export const aggregateWeeklySchedule = async (
  weekStart: string,
  weekEnd: string,
  userId: number = DEFAULT_USER_ID,
): Promise<WeeklyScheduleData> => {
  const empty: WeeklyScheduleData = {
    completedCount: 0,
    incompleteCount: 0,
    cancelledCount: 0,
    categories: [],
    overdueCount: 0,
  };

  try {
    // 카테고리 type은 schedule이 직접 가리키는 c.type, 없으면 부모 p.type에서 가져옴
    const summaryResult = await query<ScheduleSummaryRow>(
      `SELECT
        COUNT(*) FILTER (WHERE s.status = 'done')::int AS completed_count,
        COUNT(*) FILTER (WHERE s.status IN ('todo', 'in-progress'))::int AS incomplete_count,
        COUNT(*) FILTER (WHERE s.status = 'cancelled')::int AS cancelled_count
      FROM schedules s
      LEFT JOIN categories c ON c.id = s.category_id
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE s.date BETWEEN $1 AND $2
        AND COALESCE(c.type, p.type, 'task') = 'task'
        AND s.user_id = $3`,
      [weekStart, weekEnd, userId],
    );

    const summary = summaryResult.rows[0] ?? empty;

    // 그룹화는 항상 최상위 카테고리 이름 기준
    const catResult = await query<CategoryRow>(
      `SELECT COALESCE(p.name, c.name, '미분류') AS category, COUNT(*)::int AS count
      FROM schedules s
      LEFT JOIN categories c ON c.id = s.category_id
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE s.date BETWEEN $1 AND $2
        AND COALESCE(c.type, p.type, 'task') = 'task'
        AND s.user_id = $3
      GROUP BY COALESCE(p.name, c.name)
      ORDER BY count DESC`,
      [weekStart, weekEnd, userId],
    );

    const overdueResult = await query<OverdueRow>(
      `SELECT COUNT(*)::int AS overdue_count
      FROM schedules s
      LEFT JOIN categories c ON c.id = s.category_id
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE s.status = 'todo' AND s.date < $1 AND s.date IS NOT NULL
        AND COALESCE(c.type, p.type, 'task') = 'task'
        AND s.user_id = $2`,
      [weekEnd, userId],
    );

    return {
      completedCount: summary.completed_count ?? 0,
      incompleteCount: summary.incomplete_count ?? 0,
      cancelledCount: summary.cancelled_count ?? 0,
      categories: catResult.rows.map((r) => ({ category: r.category, count: r.count })),
      overdueCount: overdueResult.rows[0]?.overdue_count ?? 0,
    };
  } catch {
    return empty;
  }
};
