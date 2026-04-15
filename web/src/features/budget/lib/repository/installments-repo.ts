import { query } from '@/lib/db';
import type { InstallmentInput } from '../types-v2';

export async function readActiveInstallments(
  userId: number,
  currentBillingFrom: string,
): Promise<InstallmentInput[]> {
  const result = await query<{
    group: string;
    monthly_amount: number;
    remaining_count: number;
    is_new: boolean;
  }>(
    `SELECT
       installment_group AS group,
       MAX(amount)::int AS monthly_amount,
       COUNT(*) FILTER (WHERE date >= $2::date)::int AS remaining_count,
       (MIN(date) FILTER (WHERE installment_num = 1) >= $2::date) AS is_new
     FROM expenses
     WHERE user_id = $1
       AND is_installment = true
       AND installment_group IS NOT NULL
     GROUP BY installment_group
     HAVING COUNT(*) FILTER (WHERE date >= $2::date) > 0`,
    [userId, currentBillingFrom],
  );

  return result.rows.map((r) => ({
    monthlyAmount: r.monthly_amount,
    remainingCount: r.remaining_count,
    isNew: r.is_new,
  }));
}
