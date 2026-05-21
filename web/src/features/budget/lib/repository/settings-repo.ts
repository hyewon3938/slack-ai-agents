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

// ─── target_date 변경 시 OFF 할부 자산 보정 (ADR 0018) ──────────

/** target_date 변경으로 영향 받는 OFF 할부 그룹 단위 변화 */
export interface TargetDateChangeGroup {
  groupId: string;
  description: string | null;
  /** 자산 변화량. 양수=추가 차감, 음수=환원 */
  deltaAmount: number;
}

export interface TargetDateChangePreview {
  oldTargetDate: string | null;
  newTargetDate: string | null;
  affectedGroups: TargetDateChangeGroup[];
  /** 모든 그룹 deltaAmount 합. 양수=총 추가 차감, 음수=총 환원 */
  totalDelta: number;
}

interface InstallmentRow {
  installment_group: string;
  description: string | null;
  amount: number;
  billing_month: string;
}

/**
 * target_date 변경이 OFF 할부 자산 차감에 미치는 영향 분석 (DB 미변경).
 *
 * 대상: distribute_to_runway=false 인 할부의 "아직 결제주기 시작 안 된" 미래 회차
 *   (installment_num >= 2 AND billing_month > 현재_billing_month).
 *
 * 각 회차의 billing_month가 old / new target 경계를 넘나드는지 판정해 delta 계산:
 * - old: target 이내(차감됨), new: target 밖(무영향) → -amount (환원)
 * - old: target 밖(무영향), new: target 이내(차감됨) → +amount (추가 차감)
 *
 * newTargetDate=null 이면 모든 미래 회차가 "target 밖"으로 → 전부 환원 분석.
 */
export async function analyzeTargetDateChange(
  userId: number,
  newTargetDate: string | null,
): Promise<TargetDateChangePreview> {
  const oldTargetDate = await readTargetMonth(userId);
  if (oldTargetDate === newTargetDate) {
    return { oldTargetDate, newTargetDate, affectedGroups: [], totalDelta: 0 };
  }

  const currentBillingMonth = getCurrentBillingMonth(new Date());

  // OFF 할부의 아직 정산 안 된 미래 회차
  const { rows } = await query<InstallmentRow>(
    `SELECT installment_group, description, amount, billing_month
     FROM expenses
     WHERE user_id = $1
       AND is_installment = true
       AND installment_num >= 2
       AND billing_month > $2
       AND COALESCE(type, 'expense') = 'expense'
       AND COALESCE(exclude_from_budget, false) = false
       AND COALESCE(distribute_to_runway, true) = false
       AND installment_group IS NOT NULL`,
    [userId, currentBillingMonth],
  );

  const groupDeltas = new Map<string, { description: string | null; delta: number }>();

  for (const row of rows) {
    const wasInTarget = oldTargetDate !== null && row.billing_month <= oldTargetDate;
    const willBeInTarget = newTargetDate !== null && row.billing_month <= newTargetDate;
    if (wasInTarget === willBeInTarget) continue;

    // wasInTarget true → willBeInTarget false: 이전엔 차감됐는데 이제 무영향 → 환원
    // wasInTarget false → willBeInTarget true: 이전엔 무영향이었는데 이제 차감 → 추가 차감
    const delta = willBeInTarget ? row.amount : -row.amount;
    const existing = groupDeltas.get(row.installment_group);
    if (existing) {
      existing.delta += delta;
    } else {
      groupDeltas.set(row.installment_group, {
        description: row.description,
        delta,
      });
    }
  }

  const affectedGroups: TargetDateChangeGroup[] = Array.from(groupDeltas.entries())
    .filter(([, info]) => info.delta !== 0)
    .map(([groupId, info]) => ({
      groupId,
      description: info.description,
      deltaAmount: info.delta,
    }));
  const totalDelta = affectedGroups.reduce((s, g) => s + g.deltaAmount, 0);

  return { oldTargetDate, newTargetDate, affectedGroups, totalDelta };
}

/**
 * target_date 변경 확정 — 영향 분석 + 자산 보정 + budget_settings 갱신.
 *
 * 자산 보정은 분석 단계의 totalDelta를 기준으로 양수면 applyAssetDeduction,
 * 음수면 applyAssetIncrease 한 번씩만 호출 (그룹 개별 처리 X — 자산 풀은 공용).
 */
export async function applyTargetDateChange(
  userId: number,
  newTargetDate: string | null,
): Promise<TargetDateChangePreview> {
  const preview = await analyzeTargetDateChange(userId, newTargetDate);

  if (preview.totalDelta > 0) {
    await applyAssetDeduction(userId, preview.totalDelta);
  } else if (preview.totalDelta < 0) {
    await applyAssetIncrease(userId, -preview.totalDelta);
  }

  await upsertTargetDate(userId, newTargetDate);

  return preview;
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
