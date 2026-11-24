import type { App } from '@slack/bolt';
import { query } from '../../shared/db.js';
import { postToChannel } from '../../shared/slack.js';
import { getTodayISO, getKSTDayOfWeek } from '../../shared/kst.js';
import type { LifeCronConfig } from './types.js';
import { forEachUser } from './user-loop.js';
import { CYCLE_END_DAY } from './budget-backfill.js';

// ─── 목표 기간 만료 임박 알림 (#554) ────────────────────

/** 만료 임박 경고를 시작하는 남은 일수 (6주). */
export const TARGET_EXPIRY_WARN_DAYS = 42;

/** 두 날짜(YYYY-MM-DD) 사이의 일수 (to − from). */
const diffDaysISO = (from: string, to: string): number => {
  const msPerDay = 86_400_000;
  const fromMs = new Date(`${from}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${to}T00:00:00+09:00`).getTime();
  return Math.round((toMs - fromMs) / msPerDay);
};

/**
 * 목표 기간(target_date 'YYYY-MM')의 만료일 = 그 달 결제 주기의 마지막 날.
 * getBillingMonthForDate와 같은 주기 규칙(전월 16일 ~ 당월 15일) → 만료일 = target_date 그 달 15일.
 * (예: target '2026-08' → 만료일 '2026-08-15')
 */
export const getTargetExpiryDate = (targetDate: string): string =>
  `${targetDate}-${String(CYCLE_END_DAY).padStart(2, '0')}`;

/**
 * 목표 기간 만료 임박/경과 안내 문구 생성 (순수 함수).
 * - target_date 없음 → null (안내 없음)
 * - 남은 일수 > 42(6주) → null (아직 여유)
 * - 0 < 남은 일수 ≤ 42 → 임박 안내
 * - 남은 일수 ≤ 0 (만료일 당일 포함 이후) → 정지 안내
 * 금액·재정 상황 언급 없이 기간·일수만 사용.
 */
export const buildTargetExpiryWarning = (
  targetDate: string | null,
  today: string,
): string | null => {
  if (!targetDate) return null;

  const expiry = getTargetExpiryDate(targetDate);
  const remaining = diffDaysISO(today, expiry);

  if (remaining > TARGET_EXPIRY_WARN_DAYS) return null;

  if (remaining > 0) {
    return `예산 목표 기간(${targetDate})이 ${remaining}일 뒤에 끝나. 끝나면 예산 계산이 멈추니까 대시보드 설정에서 연장해두자.`;
  }

  return '예산 목표 기간이 지났어. 연장 전까지 예산 계산이 멈춰 있어 — 설정에서 target 늘려줘.';
};

/**
 * 월요일에만 목표 기간 만료 임박/경과를 채널로 안내 (주 1회 중복 방지, 별도 상태 저장 불필요).
 * 채널: 매핑에 money 전용 채널이 없으므로 life 채널(없으면 DM)로 폴백.
 * 아침 알림 본체에 영향 없도록 morningTask에서 try/catch로 격리 호출.
 */
export const warnTargetExpiryIfNear = async (app: App, config: LifeCronConfig): Promise<void> => {
  // 월요일(1)에만 실행 → 주 1회.
  if (getKSTDayOfWeek() !== 1) return;

  const today = getTodayISO();

  await forEachUser(config, 'life', '목표 기간 만료 알림', async (userId, channelId) => {
    const result = await query<{ target_date: string | null }>(
      'SELECT target_date FROM budget_settings WHERE user_id = $1',
      [userId],
    );
    const targetDate = result.rows[0]?.target_date ?? null;

    const message = buildTargetExpiryWarning(targetDate, today);
    if (!message) return;

    await postToChannel(app.client, channelId, message);
    console.warn(`[Life Cron] 목표 기간 만료 알림 전송 (유저=${userId})`);
  });
};
