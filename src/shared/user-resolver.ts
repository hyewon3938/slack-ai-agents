import { query } from './db.js';

/**
 * 크론/주간 리포트 등 Slack 인터랙션 컨텍스트가 없는 곳에서 사용하는 기본 userId.
 * 현재는 봇을 사용하는 오너 계정(users.id = 1) 한 명만 크론 알림을 받는다.
 * 멀티 유저가 Slack 봇을 쓰려면 크론 경로도 유저별 루프로 확장해야 한다.
 */
export const DEFAULT_USER_ID = 1;

/**
 * Slack user ID → DB userId 해석.
 * slack_user_mappings 테이블에서 매핑을 조회하며, 미등록 사용자는 null 반환.
 *
 * 실제 users 테이블은 카카오 OAuth 기반(#016 migration)이고,
 * Slack ID와의 연결은 slack_user_mappings를 경유한다.
 */
export const resolveUserId = async (slackUserId: string): Promise<number | null> => {
  const result = await query<{ user_id: number }>(
    'SELECT user_id FROM slack_user_mappings WHERE slack_user_id = $1 LIMIT 1',
    [slackUserId],
  );
  return result.rows[0]?.user_id ?? null;
};
