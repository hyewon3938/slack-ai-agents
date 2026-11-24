import type { App } from '@slack/bolt';
import { query } from '../../shared/db.js';
import { postToChannel } from '../../shared/slack.js';
import { getEffectiveTodayISO } from '../../shared/kst.js';
import type { LifeCronConfig } from './types.js';
import { forEachUser } from './user-loop.js';
import { INSIGHT_NIGHT_SYSTEM_PROMPT, generateCronMessage } from './cron-message.js';

// ─── Insight 크론 태스크 ─────────────────────────────────
// (아침 일운 알림 insightMorningTask는 daily-insight routine으로 이관 — ADR-0031)

/** 밤 일기 리뷰 → insight 채널.
 * 오늘 일기가 있으면 LLM 1회로 하루 코멘트, 없으면 간단 리마인더 전송. */
export const insightNightTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getEffectiveTodayISO();

  await forEachUser(config, 'insight', '일기 리뷰', async (userId, channelId) => {
    const diaryResult = await query<{ content: string }>(
      `SELECT content FROM diary_entries WHERE user_id = $1 AND date = $2 LIMIT 1`,
      [userId, today],
    );

    const diary = diaryResult.rows[0];

    if (!diary) {
      await postToChannel(
        app.client,
        channelId,
        '오늘 하루는 어땠어? 간단하게라도 일기를 남겨보자.',
      );
      console.warn(`[Life Cron] 일기 없음 — 리마인더 전송 (유저=${userId})`);
      return;
    }

    // 일운 요약 조회 (사주 연결용)
    const fortuneResult = await query<{ summary: string | null; advice: string | null }>(
      `SELECT summary, advice FROM fortune_analyses
       WHERE user_id = $1 AND date = $2 AND period = 'daily'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, today],
    );
    const fortune = fortuneResult.rows[0];
    const fortuneContext = fortune?.summary ? `\n오늘 일운 요약: ${fortune.summary}` : '';

    const context = `오늘 일기:\n${diary.content}${fortuneContext}`;

    const comment = await generateCronMessage(
      config.llmClient,
      INSIGHT_NIGHT_SYSTEM_PROMPT,
      context,
      '오늘도 수고했어. 내일도 좋은 하루 보내자.',
    );

    const diaryBlock = `*오늘의 일기*\n${diary.content}`;
    const message = `${diaryBlock}\n\n---\n\n${comment}`;

    await postToChannel(app.client, channelId, message);
    console.warn(`[Life Cron] 일기 리뷰 전송 완료 (유저=${userId})`);
  });
};
