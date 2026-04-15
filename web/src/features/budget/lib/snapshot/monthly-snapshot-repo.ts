import { query } from '@/lib/db';
import type { SettlementSnapshot } from '../types-v2';

export interface StoredSnapshot extends SettlementSnapshot {
  id: number;
  user_id: number;
  sealed_at: string;
}

export async function readLatestSnapshot(userId: number): Promise<StoredSnapshot | null> {
  const result = await query<StoredSnapshot>(
    `SELECT * FROM monthly_budget_snapshots
     WHERE user_id = $1
     ORDER BY year_month DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function readSnapshotByMonth(
  userId: number,
  yearMonth: string,
): Promise<StoredSnapshot | null> {
  const result = await query<StoredSnapshot>(
    `SELECT * FROM monthly_budget_snapshots
     WHERE user_id = $1 AND year_month = $2`,
    [userId, yearMonth],
  );
  return result.rows[0] ?? null;
}

/** idempotent: UNIQUE(user_id, year_month) 충돌 시 no-op */
export async function saveSnapshotIfAbsent(
  userId: number,
  snapshot: SettlementSnapshot,
): Promise<{ saved: boolean }> {
  const result = await query(
    `INSERT INTO monthly_budget_snapshots (
       user_id, year_month, allocated_budget, fixed_total, installment_total,
       planned_total, flexible_spent, excluded_spent, income_total,
       available_at_start, available_at_end, sealed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (user_id, year_month) DO NOTHING`,
    [
      userId, snapshot.year_month, snapshot.allocated_budget,
      snapshot.fixed_total, snapshot.installment_total, snapshot.planned_total,
      snapshot.flexible_spent, snapshot.excluded_spent, snapshot.income_total,
      snapshot.available_at_start, snapshot.available_at_end,
    ],
  );
  return { saved: (result.rowCount ?? 0) > 0 };
}
