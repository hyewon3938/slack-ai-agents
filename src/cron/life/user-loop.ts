import {
  DEFAULT_USER_ID,
  queryAllUserMappings,
  type UserMapping,
} from '../../shared/user-resolver.js';
import type { LifeCronConfig } from './types.js';

// ─── 멀티유저 루프 헬퍼 ─────────────────────────────────

/**
 * 크론 전송 채널 결정:
 * 1) 매핑의 전용 채널(life/insight) → 사용
 * 2) NULL이면 slackUserId 반환 → Slack이 자동으로 해당 유저와의 DM으로 전송
 */
const resolveCronChannel = (mapping: UserMapping, type: 'life' | 'insight'): string => {
  const channel = type === 'life' ? mapping.lifeChannelId : mapping.insightChannelId;
  return channel ?? mapping.slackUserId;
};

/**
 * 크론 태스크 공통 유저 루프 헬퍼.
 * - 매핑이 비어있으면 DEFAULT_USER_ID + config.channelId로 1회 실행 (하위 호환)
 * - 매핑 존재 시 각 유저별로 handler 호출, 유저별 에러는 격리
 */
export const forEachUser = async (
  config: LifeCronConfig,
  type: 'life' | 'insight',
  label: string,
  handler: (userId: number, channelId: string) => Promise<void>,
): Promise<void> => {
  const mappings = await queryAllUserMappings();

  if (mappings.length === 0) {
    const fallbackChannel =
      type === 'life' ? config.channelId : (process.env['INSIGHT_CHANNEL_ID'] ?? '');
    if (!fallbackChannel) return;
    try {
      await handler(DEFAULT_USER_ID, fallbackChannel);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] ${label} 폴백 실행 실패: ${msg}`);
    }
    return;
  }

  for (const mapping of mappings) {
    const channelId = resolveCronChannel(mapping, type);
    if (!channelId) continue;
    try {
      await handler(mapping.userId, channelId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] ${label} 유저 ${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};
