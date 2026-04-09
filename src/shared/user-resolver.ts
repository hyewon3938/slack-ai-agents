import { query } from './db.js';

/** 크론 등 Slack 컨텍스트가 없는 곳에서 사용하는 기본 userId */
export const DEFAULT_USER_ID = 1;

/**
 * Slack user ID → DB userId 해석.
 * 미등록 사용자는 null 반환.
 */
export const resolveUserId = async (slackUserId: string): Promise<number | null> => {
  const result = await query<{ id: number }>(
    'SELECT id FROM users WHERE slack_user_id = $1',
    [slackUserId],
  );
  return result.rows[0]?.id ?? null;
};
