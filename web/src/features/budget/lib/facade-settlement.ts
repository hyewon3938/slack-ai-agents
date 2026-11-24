import { getBillingRange, getCurrentBillingMonth, addBillingMonths } from './billing/cycle';
import { buildSettlementSnapshot } from './settlement/settle';
import { ensureFixedCostExpenses } from './fixed-cost-ensure';
import { getMonthlyAllocation } from './facade-allocation';

import {
  readDistributableAssetBalance,
  readFundsAsOf,
  advanceFundsAsOf,
  applyAssetDeduction,
  applyAssetIncrease,
} from './repository/assets-repo';
import { readIncomeTotal, readReflectedIncome } from './repository/incomes-repo';
import {
  readFlexibleSpent,
  readExcludedSpent,
  readTotalCycleSpent,
  readReflectedOutflow,
} from './repository/expenses-repo';
import { readLatestSnapshot, saveSnapshotIfAbsent } from './snapshot/monthly-snapshot-repo';

import type { SettlementSnapshot } from './types-v2';

/** catch-up 정산 상한 — 크론 장기 미실행 시에도 한 번에 최대 이 개수까지만 소급 (폭주 방지) */
const MAX_CATCHUP_MONTHS = 3;

/**
 * 정산이 필요한(=아직 스냅샷이 없는) 종료된 결제주기 목록을 오래된 순으로 반환.
 *
 * - `current`(진행 중 주기)는 아직 안 끝났으므로 제외.
 * - 최신 스냅샷이 있으면 그 다음 달부터 `current` 직전까지를 후보로 삼되, 오래된 순 최대 3개월만 (cap).
 * - 스냅샷이 하나도 없으면 직전 종료 주기 1개만 (초회 대량 소급 방지 — 기존 동작 보존).
 */
export async function listUnsettledMonths(userId: number, now: Date): Promise<string[]> {
  const current = getCurrentBillingMonth(now);
  const lastEnded = addBillingMonths(current, -1); // current 직전 = 마지막으로 끝난 주기

  const latest = (await readLatestSnapshot(userId))?.year_month;

  // 스냅샷 전무 → 직전 1개만
  if (!latest) return [lastEnded];

  // 이미 최신까지(또는 그 이상) 정산됨 → 없음
  if (latest >= lastEnded) return [];

  // (latest, lastEnded] 구간을 오래된 순으로 수집
  const months: string[] = [];
  let cursor = addBillingMonths(latest, 1);
  while (cursor <= lastEnded) {
    months.push(cursor);
    cursor = addBillingMonths(cursor, 1);
  }

  // cap: 오래된 순 최대 MAX_CATCHUP_MONTHS 개 — 매일 실행되는 크론이 순서대로 따라잡는 자기치유 cap.
  // (최신 우선으로 자르면 정산 후 latest가 잘린 옛 주기를 건너뛰어 영구 탈락 — 히스토리에 구멍)
  return months.slice(0, MAX_CATCHUP_MONTHS);
}

/** 단일 결제주기 정산 — 고정비 보장 후 스냅샷 저장 + (신규 시) 자산 변동 */
async function settleMonth(
  userId: number,
  targetMonth: string,
): Promise<SettlementSnapshot | null> {
  // 정산 직전 고정비 자동 기록 보장 — 대시보드 조회 부수효과에 의존하지 않고 여기서 확정.
  // (과거 월도 ensureFixedCostExpenses 의 expenseDate<=today 필터로 전부 생성됨)
  await ensureFixedCostExpenses(userId, targetMonth);

  const range = getBillingRange(targetMonth);

  const asOf = await readFundsAsOf(userId);
  const [flex, excluded, income, totalSpent, reflectedOut, reflectedIn] = await Promise.all([
    readFlexibleSpent(userId, targetMonth, range.to),
    readExcludedSpent(userId, targetMonth),
    readIncomeTotal(userId, targetMonth),
    readTotalCycleSpent(userId, targetMonth),
    asOf ? readReflectedOutflow(userId, targetMonth, asOf) : Promise.resolve(0),
    asOf ? readReflectedIncome(userId, targetMonth, asOf) : Promise.resolve(0),
  ]);

  // 기준일까지 이미 통장에 반영된 몫은 빼고 미반영분만 자금에 적용 (#615, ADR 0062).
  // 음수 방어: 기록 수정으로 reflected가 total을 넘는 이례적 경우 0으로 클램프.
  const pendingOut = Math.max(0, totalSpent - reflectedOut);
  const pendingIn = Math.max(0, income - reflectedIn);

  // 정산 대상 월 기준 allocator 재실행 — T12:00:00Z = KST 21:00 (15일 이내)
  const targetEnd = new Date(`${range.to}T12:00:00Z`);
  const alloc = await getMonthlyAllocation(userId, targetEnd);
  const monthlyBudget = alloc.monthlyBudgets.find((m) => m.yearMonth === targetMonth);
  if (!monthlyBudget) {
    console.warn(`[settlement] user ${userId} ${targetMonth}: allocator에 대상 월 없음 → skip`);
    return null;
  }

  const prevSnapshot = await readLatestSnapshot(userId);
  const availableAtStart =
    prevSnapshot?.available_at_end ?? (await readDistributableAssetBalance(userId));
  // depletion 일원화 (#539, ADR 0051): 그 주기 전체 결제분을 자금에서 차감.
  // 장부(available_at_end → 다음 주기 시작값)는 주기 전체 결제분 기준을 유지한다 —
  // 스냅샷은 "그 주기에 얼마가 나갔나"의 기록이지 자금 반영분의 기록이 아니다 (#615).
  // flex/excluded는 snapshot 분해 표시용으로만 별도 기록.
  const availableAtEnd = availableAtStart + income - totalSpent;

  const snapshot = buildSettlementSnapshot({
    yearMonth: targetMonth,
    monthlyBudget,
    actualFlexibleSpent: flex,
    actualExcludedSpent: excluded,
    actualIncome: income,
    availableAtStart,
    availableAtEnd,
  });
  const result = await saveSnapshotIfAbsent(userId, snapshot);

  // snapshot 신규 저장 시에만 자산 변동 (UNIQUE(user, year_month)로 재실행 시 중복 차감 방지).
  // 등록 시점 차감을 폐지했으므로 할부 회차는 결제(이 주기)될 때 비로소 자금에서 빠진다.
  if (result.saved) {
    await applyAssetDeduction(userId, pendingOut);
    await applyAssetIncrease(userId, pendingIn);
    // 정산으로 이 주기 종료일까지의 흐름이 자금에 반영됐다 (뒤로 가지 않게 GREATEST)
    await advanceFundsAsOf(userId, range.to);
  }

  // 금액 로그 금지 — 월·신규저장 여부(불리언)만 기록.
  console.info(`[settlement] user ${userId} ${targetMonth}: saved=${result.saved}`);

  return result.saved ? snapshot : null;
}

/**
 * 월 경계 정산 (Phase 4 cron 진입점).
 *
 * 매일 실행되며, 아직 정산 안 된 종료 주기가 있으면 오래된 순으로 순차 정산한다(catch-up).
 * 크론이 특정 날짜에 실패해도 다음 실행에서 자동 보정되며, `saveSnapshotIfAbsent` 멱등성으로
 * 재실행 시 자산 이중 변동은 발생하지 않는다.
 */
export async function runSettlementIfDue(
  userId: number,
  now: Date,
): Promise<{ settled: boolean; snapshots: SettlementSnapshot[] }> {
  const targetMonths = await listUnsettledMonths(userId, now);
  if (targetMonths.length === 0) {
    return { settled: false, snapshots: [] };
  }

  const catchUp = targetMonths.length > 1;
  console.info(`[settlement] user ${userId}: 대상 ${targetMonths.length}개월 catch-up=${catchUp}`);

  const snapshots: SettlementSnapshot[] = [];
  // 오래된 순 순차 처리 — available_at_start 체인이 직전 스냅샷의 available_at_end 를 참조하므로 순서 중요.
  for (const targetMonth of targetMonths) {
    const snapshot = await settleMonth(userId, targetMonth);
    if (snapshot) snapshots.push(snapshot);
  }

  return { settled: snapshots.length > 0, snapshots };
}
