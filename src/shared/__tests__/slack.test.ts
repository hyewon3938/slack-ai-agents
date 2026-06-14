import { describe, it, expect } from 'vitest';
import type { KnownBlock } from '@slack/types';
import { resolveActionCard } from '../slack.js';

describe('resolveActionCard — actions 블록만 제거 + 안내 context append', () => {
  const sampleCard: KnownBlock[] = [
    { type: 'section', text: { type: 'mrkdwn', text: '제안 본문' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '```SELECT 1```' }] },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '측정 시작' }, action_id: 'a' },
        { type: 'button', text: { type: 'plain_text', text: '반려' }, action_id: 'b' },
      ],
    },
  ];

  it('actions 블록은 제거하고 본문(section·기존 context)은 그대로 보존한다', () => {
    const out = resolveActionCard(sampleCard, '✅ 측정 시작함');
    expect(out.some((b) => b.type === 'actions')).toBe(false);
    expect(out[0]).toEqual(sampleCard[0]); // section 보존
    expect(out[1]).toEqual(sampleCard[1]); // 기존 context 보존
  });

  it('안내 문구를 카드 맨 끝 context 블록으로 추가한다', () => {
    const out = resolveActionCard(sampleCard, '✅ 측정 시작함');
    expect(out[out.length - 1]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '✅ 측정 시작함' }],
    });
    // 본문 2 + 안내 1 = 3 (actions 1개 제거)
    expect(out).toHaveLength(3);
  });

  it('빈 blocks 입력이면 안내 context 한 줄만 반환한다 (폴백 경로)', () => {
    expect(resolveActionCard([], '패스함 — 추적 안 함.')).toEqual([
      { type: 'context', elements: [{ type: 'mrkdwn', text: '패스함 — 추적 안 함.' }] },
    ]);
  });

  it('원본 blocks 배열을 변형하지 않는다 (순수 함수)', () => {
    resolveActionCard(sampleCard, '안내');
    expect(sampleCard).toHaveLength(3);
    expect(sampleCard[2]?.type).toBe('actions');
  });
});
