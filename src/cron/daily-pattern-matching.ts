/**
 * Phase 3+4 — 매일 07시 패턴 일일 매칭 cron (08:00 일일 종합 인사이트 선행, #475).
 * ADR-0017 + ADR-0026(pattern_* rename) + ADR-0031(매칭 선행) 참조.
 *
 * 흐름:
 *   0) 마지막 매칭일~오늘 갭 자동 백필 (봇 다운 복귀 시 누락일 복구, 기록만)
 *   1) 어제 pending 매칭 verify_status 확정 (hit/miss/inconclusive)
 *   2) 오늘 활성 시드 평가 → pattern_matches UPSERT
 *   3) matched=true 시드를 #life 잔소리 끝 한 줄로 압축 전송
 */

import type { App } from '@slack/bolt';
import {
  matchAllSeedsForDay,
  recordDailyMatches,
  verifyDailyMatches,
  compactMatchedLine,
  getDailyContext,
} from '../shared/pattern-match.js';
import { postToChannel } from '../shared/slack.js';
import { getEffectiveTodayISO, addDays } from '../shared/kst.js';
import { query } from '../shared/db.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import { pickConfirmedHypothesisLines } from '../shared/insights.js';
import type { LifeCronConfig } from './life-cron.js';

/** 봇 장기 다운/최초 실행 시 백필 폭주를 막는 상한 (일). 초과분은 가장 최근 구간만 백필 + 로그. */
const MAX_BACKFILL_DAYS = 14;

export interface DailyPatternMatchingResult {
  date: string;
  triggeredCount: number;
  matchedCount: number;
  line: string | null;
  hypothesisLines: string[];
}

/**
 * 매칭 평가만 수행 (Slack 전송 X). 테스트/디버깅용.
 */
export const runDailyPatternMatchingDryRun = async (
  userId: number,
  date: string,
): Promise<DailyPatternMatchingResult> => {
  const ctx = await getDailyContext(userId, date);
  if (!ctx) {
    return { date, triggeredCount: 0, matchedCount: 0, line: null, hypothesisLines: [] };
  }

  const results = await matchAllSeedsForDay(userId, date);
  await recordDailyMatches(userId, date, results);

  const triggeredCount = results.filter((r) => r.triggerActivated).length;
  const matchedCount = results.filter((r) => r.matched).length;
  const line = await compactMatchedLine(ctx, results);
  const hypothesisLines = await pickConfirmedHypothesisLines(userId, date);

  return { date, triggeredCount, matchedCount, line, hypothesisLines };
};

/**
 * 한 유저 매칭 처리 (Slack 전송 포함).
 */
export const dailyPatternMatchingForUser = async (
  app: App,
  userId: number,
  channelId: string,
  date: string,
): Promise<void> => {
  try {
    await verifyDailyMatches(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Pattern Match] verify 실패 user=${userId}: ${msg}`);
  }

  let result: DailyPatternMatchingResult;
  try {
    result = await runDailyPatternMatchingDryRun(userId, date);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Pattern Match] 매칭 실패 user=${userId}: ${msg}`);
    return;
  }

  console.warn(
    `[Pattern Match] user=${userId} date=${date} triggered=${result.triggeredCount} matched=${result.matchedCount}`,
  );

  if (result.line) {
    try {
      await postToChannel(app.client, channelId, result.line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Pattern Match] Slack 전송 실패 user=${userId}: ${msg}`);
    }
  }

  if (result.hypothesisLines.length > 0) {
    try {
      await postToChannel(app.client, channelId, result.hypothesisLines.join('\n'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Pattern Match] 가설 라인 전송 실패 user=${userId}: ${msg}`);
    }
  }
};

/**
 * 마지막 매칭일+1 ~ 어제까지 누락된 날짜 목록 (오늘 제외).
 * 봇 다운 등으로 매칭이 빠진 날을 자동 복구하기 위함 — cron이 "오늘만" 매칭하면
 * 봇이 멈춘 날은 영구 누락된다. recordDailyMatches가 UPSERT 멱등이라 재실행 안전.
 * 갭이 MAX_BACKFILL_DAYS를 초과하면 가장 최근 구간만 백필하고 truncation을 로그로 남긴다.
 */
const findBackfillDays = async (userId: number, today: string): Promise<string[]> => {
  const result = await query<{ last_date: string | null }>(
    `SELECT MAX(date)::text AS last_date FROM pattern_matches WHERE user_id = $1`,
    [userId],
  );
  const lastDate = result.rows[0]?.last_date;
  if (!lastDate) return []; // 매칭 이력 없음(최초 실행) → 백필 없이 오늘분만 정규 처리

  const rawStart = addDays(lastDate, 1);
  const earliest = addDays(today, -MAX_BACKFILL_DAYS);
  // ISO 날짜 문자열(YYYY-MM-DD)은 사전식 비교가 곧 시간순 비교
  const truncated = rawStart < earliest;
  let cursor = truncated ? earliest : rawStart;

  const days: string[] = [];
  while (cursor < today) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  if (truncated) {
    console.warn(
      `[Pattern Match] 갭이 ${MAX_BACKFILL_DAYS}일 초과 user=${userId}: ${rawStart}~${addDays(earliest, -1)} 스킵, 최근 ${days.length}일만 백필`,
    );
  }
  return days;
};

/**
 * 누락된 과거 날짜 백필(매칭 기록만, Slack 전송 X) 후 오늘분 정규 처리(verify + match + 전송).
 * 백필분은 다음 verifyDailyMatches(date <= 어제 전체 처리)가 자동으로 hit/miss 확정한다.
 */
const backfillAndMatchForUser = async (
  app: App,
  userId: number,
  channelId: string,
  today: string,
): Promise<void> => {
  const backfillDays = await findBackfillDays(userId, today);
  for (const day of backfillDays) {
    try {
      const r = await runDailyPatternMatchingDryRun(userId, day);
      console.warn(
        `[Pattern Match] 갭 백필 user=${userId} date=${day} triggered=${r.triggeredCount} matched=${r.matchedCount}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Pattern Match] 갭 백필 실패 user=${userId} date=${day}: ${msg}`);
    }
  }
  await dailyPatternMatchingForUser(app, userId, channelId, today);
};

/**
 * 패턴 일일 매칭 cron 본체. SLOT_TASKS에서 호출.
 * #life 채널로 전송 (life channel mapping 사용).
 * 누락일 자동 백필 포함 (봇 다운 복귀 시 갭 메움).
 */
export const dailyPatternMatchingTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getEffectiveTodayISO();
  const mappings = await queryAllUserMappings();

  if (mappings.length === 0) {
    if (!config.channelId) return;
    await backfillAndMatchForUser(app, DEFAULT_USER_ID, config.channelId, today);
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.lifeChannelId ?? mapping.slackUserId;
    if (!channelId) continue;
    await backfillAndMatchForUser(app, mapping.userId, channelId, today);
  }
};
