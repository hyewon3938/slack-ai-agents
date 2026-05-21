import { query, queryOne } from '@/lib/db';
import { getCurrentBillingMonth } from '../billing/cycle';
import { applyAssetDeduction, applyAssetIncrease } from './assets-repo';

export async function readTargetMonth(userId: number): Promise<string | null> {
  const result = await query<{ target_date: string | null }>(
    'SELECT target_date FROM budget_settings WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.target_date ?? null;
}

export async function upsertTargetDate(userId: number, targetDate: string | null): Promise<void> {
  await query(
    `INSERT INTO budget_settings (user_id, target_date, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET target_date = EXCLUDED.target_date, updated_at = NOW()`,
    [userId, targetDate],
  );
}

// ─── 할부 토글 사후 변경 보정 (ADR 0018) ──────────────────

export interface InstallmentToggleAdjustment {
  groupId: string;
  /** 자산 변화량. 양수=추가 차감, 음수=환원 */
  deltaAmount: number;
}

/**
 * `distribute_to_runway` 토글 변경 시 그룹 전체 자산 보정 계산.
 *
 * 대상: 같은 installment_group의 아직 정산 안 된 미래 회차 (installment_num >= 2 AND billing_month > 현재).
 * 그 중 billing_month > target_date 인 회차의 amount 합 = boundarySum.
 *
 * - 토글이 ON(true) → OFF(false): boundarySum 만큼 환원 (이미 차감했던 회차를 자산에서 빼지 않도록)
 * - 토글이 OFF(false) → ON(true): boundarySum 만큼 추가 차감 (예전에 안 빠졌던 회차 분만큼 빼야 함)
 *
 * target_date가 null이면 모든 미래 회차가 boundary 밖 → ON↔OFF가 전체 미래 회차 합에 영향.
 * exclude_from_budget=true 또는 type='income' 인 그룹은 INSERT 시 자산 변동이 없었으므로 보정 대상 X.
 */
export async function computeInstallmentToggleAdjustment(
  userId: number,
  installmentGroup: string,
  newValue: boolean,
): Promise<InstallmentToggleAdjustment | null> {
  const currentBillingMonth = getCurrentBillingMonth(new Date());
  const targetDate = await readTargetMonth(userId);

  // 그룹의 미래 회차 + 그룹 메타데이터 (exclude_from_budget / type) 확인
  const meta = await queryOne<{
    exclude_from_budget: boolean;
    type: string;
  }>(
    `SELECT COALESCE(exclude_from_budget, false) AS exclude_from_budget,
            COALESCE(type, 'expense') AS type
     FROM expenses
     WHERE user_id = $1 AND installment_group = $2
     LIMIT 1`,
    [userId, installmentGroup],
  );
  if (!meta) return null;
  if (meta.type !== 'expense' || meta.exclude_from_budget) {
    // 자산 변동이 INSERT에서 이미 없었으므로 보정 불필요
    return { groupId: installmentGroup, deltaAmount: 0 };
  }

  const { rows } = await query<{ amount: number; billing_month: string }>(
    `SELECT amount, billing_month
     FROM expenses
     WHERE user_id = $1
       AND installment_group = $2
       AND is_installment = true
       AND installment_num >= 2
       AND billing_month > $3`,
    [userId, installmentGroup, currentBillingMonth],
  );

  // boundary 밖 = billing_month > target_date (target 없으면 모두 밖)
  const boundarySum = rows.reduce((sum, r) => {
    const beyondTarget = targetDate === null || r.billing_month > targetDate;
    return beyondTarget ? sum + r.amount : sum;
  }, 0);

  if (boundarySum === 0) return { groupId: installmentGroup, deltaAmount: 0 };

  // newValue=true (ON): 예전에 안 빠지던 boundary 밖 회차를 차감 → +
  // newValue=false (OFF): 예전에 빠지던 boundary 밖 회차를 환원 → -
  const deltaAmount = newValue ? boundarySum : -boundarySum;
  return { groupId: installmentGroup, deltaAmount };
}

/** computeInstallmentToggleAdjustment 결과를 받아 실제 자산 변동을 수행 */
export async function applyInstallmentToggleAdjustment(
  userId: number,
  adjustment: InstallmentToggleAdjustment,
): Promise<void> {
  if (adjustment.deltaAmount > 0) {
    await applyAssetDeduction(userId, adjustment.deltaAmount);
  } else if (adjustment.deltaAmount < 0) {
    await applyAssetIncrease(userId, -adjustment.deltaAmount);
  }
}
