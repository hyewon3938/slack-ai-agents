import type { App } from '@slack/bolt';
import { query } from '../../shared/db.js';
import { getKSTDayOfWeek, getTodayISO } from '../../shared/kst.js';
import { postToChannel } from '../../shared/slack.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../../shared/user-resolver.js';
import type { LifeCronConfig } from '../life/types.js';
import { previousMondayISO } from './week-start.js';
import { processUser } from './process-user.js';

/**
 * 본체 — life-cron SLOT_TASKS에서 호출. 매일 등록되지만 월요일만 실행(weeklyReport 패턴).
 */
export const weeklyVerificationTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  if (getKSTDayOfWeek() !== 1) return;
  const today = getTodayISO();
  const weekStart = previousMondayISO(today);
  const mappings = await queryAllUserMappings();
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  if (mappings.length === 0) {
    if (!insightFallback) return;
    await processUser(app, DEFAULT_USER_ID, insightFallback, weekStart, today);
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await processUser(app, mapping.userId, channelId, weekStart, today);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Verification] user=${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};

/**
 * 주간 리뷰 누락 fallback 알림 (#542 ADR-0052, 월 10:00) — 출력 연속성 보장.
 * routine(weekly-saju-review-v2, 월 08:04)이 통합 카드를 발송하면 saju_weekly_reviews에
 * (user_id, week_start=이번주 월요일) row가 남는다. 10:00에 그 row가 없으면(=미발송) "수동 실행해줘"
 * 알림만 #insight에 발송 — 봇이 카드를 대신 만들지 않는다(반쪽 카드 방지, ADR-0052 Alt B 기각).
 *
 * week_start는 SKILL과 동일하게 "오늘(이번 주 월요일)"을 쓴다 — weekly-verification의
 * previousMondayISO(지난주 월요일)와 다름에 주의(SKILL idempotency row 키와 일치해야 조회됨).
 */
export const weeklyReviewFallbackTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  if (getKSTDayOfWeek() !== 1) return; // 월요일만 (매일 등록, 내부 가드)
  const today = getTodayISO(); // 이번 주 월요일 = SKILL의 week_start
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  const notifyIfMissing = async (userId: number, channelId: string): Promise<void> => {
    const res = await query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM saju_weekly_reviews WHERE user_id = $1 AND week_start = $2
       ) AS exists`,
      [userId, today],
    );
    if (res.rows[0]?.exists) return; // 이미 발송됨 — no-op
    await postToChannel(
      app.client,
      channelId,
      '🔔 이번 주 주간 인사이트가 아직 안 왔어. 클로드 앱 routines에서 weekly-saju-review-v2 수동 실행해줘.',
    );
    console.warn(`[WeeklyReviewFallback] user=${userId} 미발송 — 수동 실행 알림 전송`);
  };

  const mappings = await queryAllUserMappings();
  if (mappings.length === 0) {
    if (!insightFallback) return;
    try {
      await notifyIfMissing(DEFAULT_USER_ID, insightFallback);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WeeklyReviewFallback] 폴백 실행 실패: ${msg}`);
    }
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await notifyIfMissing(mapping.userId, channelId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WeeklyReviewFallback] user=${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};
