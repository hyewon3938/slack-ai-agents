import { query } from '@/lib/db';
import type { InstallmentInput } from '../types-v2';

export async function readActiveInstallments(
  userId: number,
  currentBillingMonth: string,
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
       COUNT(*) FILTER (WHERE billing_month >= $2)::int AS remaining_count,
       (MIN(billing_month) FILTER (WHERE installment_num = 1) >= $2) AS is_new
     FROM expenses
     WHERE user_id = $1
       AND is_installment = true
       AND installment_group IS NOT NULL
     GROUP BY installment_group
     HAVING COUNT(*) FILTER (WHERE billing_month >= $2) > 0`,
    [userId, currentBillingMonth],
  );

  return result.rows.map((r) => ({
    monthlyAmount: r.monthly_amount,
    remainingCount: r.remaining_count,
    isNew: r.is_new,
  }));
}
