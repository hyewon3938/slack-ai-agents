import type { App } from '@slack/bolt';
import { queryTodayRecords } from '../../shared/life/queries-routine.js';
import { queryTodaySchedules } from '../../shared/life/queries-schedule.js';
import { postToChannel } from '../../shared/slack.js';
import { getTodayISO, getYesterdayISO, getKSTDayOfWeek } from '../../shared/kst.js';
import { queryAllUserMappings } from '../../shared/user-resolver.js';
import {
  buildScheduleText,
  buildNightScheduleText,
  buildYesterdayIncompleteText,
} from '../../agents/life/blocks/schedule-text.js';
import { pickMorningNudges, pickNightNudges } from '../../shared/insights/pick.js';
import { buildLifeContext } from '../../shared/life/context-build.js';
import { publishHomeView } from '../../agents/life/home.js';
import type { LifeCronConfig } from './types.js';
import { forEachUser } from './user-loop.js';
import { NIGHT_SYSTEM_PROMPT, generateCronMessage } from './cron-message.js';
import { calcRoutineStats, createTodayRecords } from './routine-records.js';
import { backfillYesterdayBudgetLogIfMissing } from './budget-backfill.js';
import { warnTargetExpiryIfNear } from './target-expiry.js';

// ─── 크론 태스크 ────────────────────────────────────────

/** 아침: 어제 루틴 최종 달성률 + 루틴 기록 생성 + 오늘 일정 (LLM 없음) */
export const morningTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();

  // Vercel cron 누락 방어: 어제자 일별 예산 로그 자동 백필
  try {
    await backfillYesterdayBudgetLogIfMissing(app);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Cron] 일별 예산 로그 백필 체크 실패:', msg);
  }

  // 목표 기간 만료 임박 알림 (월요일만, 주 1회) — 실패해도 아침 알림 본체에 영향 없게 격리
  try {
    await warnTargetExpiryIfNear(app, config);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Cron] 목표 기간 만료 알림 체크 실패:', msg);
  }

  await forEachUser(config, 'life', '아침 알림', async (userId, channelId) => {
    // 1. 어제 루틴 최종 달성률
    const yesterdayRecords = await queryTodayRecords(yesterday, userId);
    if (yesterdayRecords.length > 0) {
      const stats = calcRoutineStats(yesterdayRecords);
      const slotText = Object.entries(stats.slotBreakdown)
        .map(([s, d]) => `${s} ${d.completed}/${d.total}`)
        .join(', ');
      const line =
        stats.completed === stats.total
          ? `어제 루틴 전부 완료! ${stats.rate}% (${stats.completed}/${stats.total}) — ${slotText}`
          : `어제 루틴 최종 ${stats.rate}% (${stats.completed}/${stats.total}) — ${slotText}`;
      await postToChannel(app.client, channelId, line);
    }

    // 1-2. 어제 못 끝낸 일정 요약 (end_date가 오늘 이후인 진행 중 기간 일정은 제외)
    const yesterdaySchedules = await queryTodaySchedules(yesterday, userId);
    const yesterdayIncompleteText = buildYesterdayIncompleteText(
      yesterdaySchedules,
      yesterday,
      today,
    );
    if (yesterdayIncompleteText) {
      await postToChannel(app.client, channelId, yesterdayIncompleteText);
    }

    // 1-3. 프로액티브 인사이트 (priority ≥5인 패턴 0~3개)
    // 월요일은 09:00 주간 리포트가 별도 발송 → 중복 방지
    if (getKSTDayOfWeek() !== 1) {
      const insights = await pickMorningNudges(today, userId);
      if (insights.length > 0) {
        const text = insights.map((i) => i.message).join('\n');
        await postToChannel(app.client, channelId, text);
      }
    }

    // 2. 오늘 루틴 기록 생성
    const created = await createTodayRecords(today, userId);

    // 3. 오늘 일정 텍스트
    const schedules = await queryTodaySchedules(today, userId);
    if (schedules.length > 0) {
      const scheduleText = buildScheduleText(schedules, today);
      await postToChannel(app.client, channelId, scheduleText);
    }

    console.warn(`[Life Cron] 아침 알림 완료 (유저=${userId}, 기록 ${created}개 생성)`);
  });

  // 앱홈 갱신 — 모든 등록 유저의 Slack user ID 순회
  const mappings = await queryAllUserMappings();
  for (const mapping of mappings) {
    try {
      await publishHomeView(app.client, mapping.slackUserId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] 앱홈 갱신 실패 (${mapping.slackUserId}): ${msg}`);
    }
  }
};

/** 밤: 일정 리뷰 + 루틴 달성률 요약 + LLM 마무리 */
export const nightTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();

  await forEachUser(config, 'life', '밤 요약', async (userId, channelId) => {
    const records = await queryTodayRecords(today, userId);
    if (records.length === 0) return;

    const stats = calcRoutineStats(records);
    const lifeContext = await buildLifeContext('night', userId);
    const slotText = Object.entries(stats.slotBreakdown)
      .map(([s, d]) => `${s} ${d.rate}%`)
      .join(', ');

    // 미완료 일정 컨텍스트 (nightReview 통합)
    const schedules = await queryTodaySchedules(today, userId);
    const nightScheduleText = buildNightScheduleText(schedules, today);
    const scheduleContext = nightScheduleText ? `\n일정 현황: ${nightScheduleText}` : '';

    const context = `밤 마무리 메시지 생성해줘.\n오늘 루틴 현황 (23:55 기준, 자정 넘어서 마무리할 수 있음): ${stats.rate}% (${stats.completed}/${stats.total})\n시간대별: ${slotText}${scheduleContext}${lifeContext}`;

    const fallback =
      stats.completed === stats.total
        ? '오늘 루틴 다 했어! 수고했어, 푹 쉬어.'
        : `오늘 루틴 현재까지 ${stats.completed}/${stats.total} 완료. 아직 할 수 있으니까 천천히!`;

    const summary = await generateCronMessage(
      config.llmClient,
      NIGHT_SYSTEM_PROMPT,
      context,
      fallback,
    );

    try {
      const summaryText = summary || fallback;
      await postToChannel(app.client, channelId, summaryText);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] 밤 마무리 메시지 전송 실패 (유저=${userId}): ${msg}`);
    }

    // 프로액티브 인사이트 (priority ≥5인 패턴 0~3개)
    const insights = await pickNightNudges(today, userId);
    if (insights.length > 0) {
      const text = insights.map((i) => i.message).join('\n');
      await postToChannel(app.client, channelId, text);
    }

    console.warn(`[Life Cron] 밤 요약 전송 완료 (유저=${userId})`);
  });
};
