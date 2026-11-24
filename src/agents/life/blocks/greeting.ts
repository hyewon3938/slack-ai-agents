/**
 * 아침 인사 블록.
 */

import type { KnownBlock } from '@slack/types';

// ─── 아침/밤 메시지 (LLM 생성 텍스트 기반) ─────────────

/** 아침 인사 블록 (LLM 생성 텍스트) */
export const buildMorningGreetingBlocks = (greetingText: string): KnownBlock[] => [
  { type: 'section', text: { type: 'mrkdwn', text: greetingText } },
];
