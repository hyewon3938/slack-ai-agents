/**
 * #insight 채널 크론 공통 유저 루프.
 *
 * life/user-loop.ts의 forEachUser와 채널 규칙이 다르다 — 이쪽은 매핑의 insight 채널이 NULL이면
 * DM이 아니라 폴백 채널(INSIGHT_CHANNEL_ID ?? config.channelId)로 보내고, 매핑 0건일 때도 같은 폴백을 쓴다.
 * 로그 문구와 매핑 0건 분기의 오류 처리는 호출부마다 달라 옵션으로 받는다.
 */

import {
  DEFAULT_USER_ID,
  queryAllUserMappings,
  type UserMapping,
} from '../shared/user-resolver.js';
import type { LifeCronConfig } from './life/types.js';

export interface InsightUserLoopOptions {
  /** 로그 접두어 — 대괄호 없이 (예: 'Verification' → `[Verification] ...`). */
  logPrefix: string;
  /** 유저별 실패 로그의 동작 표현. 기본 '처리 실패'. */
  userFailureLabel?: string;
  /**
   * 매핑 0건(DEFAULT_USER_ID 1회 실행) 분기의 오류 처리.
   * - 'isolate': 잡아서 `[접두어] 폴백 실행 실패: ...`로 로그만 남긴다
   * - 'propagate': 잡지 않고 호출자에게 그대로 올린다
   */
  fallbackErrors: 'isolate' | 'propagate';
}

export type InsightUserHandler = (userId: number, channelId: string) => Promise<void>;

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * 이미 조회한 매핑으로 유저 루프를 돈다 — 매핑 조회와 루프 사이에 다른 준비 작업이 끼는 호출부용.
 * - 매핑 0건: 폴백 채널이 있으면 DEFAULT_USER_ID로 1회 실행
 * - 매핑 존재: 조회 순서대로 순차 실행, 채널이 없는 유저는 건너뛰고 유저별 오류는 격리
 */
export const forEachInsightMapping = async (
  mappings: UserMapping[],
  config: LifeCronConfig,
  options: InsightUserLoopOptions,
  handler: InsightUserHandler,
): Promise<void> => {
  const { logPrefix, userFailureLabel = '처리 실패', fallbackErrors } = options;
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  if (mappings.length === 0) {
    if (!insightFallback) return;
    if (fallbackErrors === 'propagate') {
      await handler(DEFAULT_USER_ID, insightFallback);
      return;
    }
    try {
      await handler(DEFAULT_USER_ID, insightFallback);
    } catch (err) {
      console.error(`[${logPrefix}] 폴백 실행 실패: ${errorMessage(err)}`);
    }
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await handler(mapping.userId, channelId);
    } catch (err) {
      console.error(
        `[${logPrefix}] user=${mapping.userId} ${userFailureLabel}: ${errorMessage(err)}`,
      );
    }
  }
};

/** 매핑을 조회한 뒤 forEachInsightMapping을 돈다. 매핑 조회 실패는 호출자에게 올라간다. */
export const forEachInsightUser = async (
  config: LifeCronConfig,
  options: InsightUserLoopOptions,
  handler: InsightUserHandler,
): Promise<void> => {
  const mappings = await queryAllUserMappings();
  await forEachInsightMapping(mappings, config, options, handler);
};
