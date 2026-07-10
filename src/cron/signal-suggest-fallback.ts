/**
 * 월간 신호 제안 누락 fallback 알림 cron — 매월 2일 11:00 KST (#466, ADR-0058) — 출력 연속성 보장.
 *
 * routine(monthly-signal-suggest, 월 1일 09:30, repo 밖 SKILL, #477 P5b/ADR-0040)이 그 달 실행되면
 * 최초 액션에서 signal_suggest_runs에 (user_id, month_start=그 달 1일) 클레임 row가 남는다(ADR-0053).
 * 2일에 그 row가 없으면(=그 달 routine이 아예 안 돎) "수동 실행해줘" 알림만 발송 —
 * 봇이 제안을 대신 만들지 않는다(LLM 신호 생성은 봇 능력 밖, ADR-0052 Alt B 기각 계승).
 *
 * 주의: 이 row는 "최초 클레임"이라 발송 성공을 뜻하지 않는다(weekly의 발송-후 기록과 반대 의미론).
 * 그래서 row 없음 = 그 달 미실행만 확실 감지. burned month(클레임 후 크래시)·후보 0건 정상 종료는
 * 감지 대상이 아니다(row 의미론상 테이블만으로 구분 불가 — ADR-0058 스코프 한계, ADR-0053과 정합).
 *
 * 2일 가드: 1일 정상 실행이면 2일엔 이미 row → no-op. 1일에 앱이 꺼졌다 늦게 밀려 실행돼도
 * 2일 체크 전 row가 생기면 no-op(헛알림 억제). 2일까지 row 없어야 진짜 누락으로 판정.
 */

import type { App } from '@slack/bolt';
import { query } from '../shared/db.js';
import { getKSTDayOfMonth } from '../shared/kst.js';
import { postToChannel } from '../shared/slack.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import type { LifeCronConfig } from './life-cron.js';

export const signalSuggestFallbackTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  if (getKSTDayOfMonth() !== 2) return; // 매월 2일만 (매일 등록, 내부 가드)
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  const notifyIfMissing = async (userId: number, channelId: string): Promise<void> => {
    const res = await query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM signal_suggest_runs
         WHERE user_id = $1
           AND month_start = DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::date
       ) AS exists`,
      [userId],
    );
    if (res.rows[0]?.exists) return; // 이번 달 실행됨 — no-op
    await postToChannel(
      app.client,
      channelId,
      '🔔 이번 달 신호 제안이 아직 안 왔어. 클로드 앱 routines에서 monthly-signal-suggest 수동 실행해줘.',
    );
    console.warn(`[SignalSuggestFallback] user=${userId} 미실행 — 수동 실행 알림 전송`);
  };

  const mappings = await queryAllUserMappings();
  if (mappings.length === 0) {
    if (!insightFallback) return;
    try {
      await notifyIfMissing(DEFAULT_USER_ID, insightFallback);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SignalSuggestFallback] 폴백 실행 실패: ${msg}`);
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
      console.error(`[SignalSuggestFallback] user=${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};
