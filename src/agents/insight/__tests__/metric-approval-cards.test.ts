import { describe, it, expect } from 'vitest';
import type { KnownBlock, SectionBlock, ActionsBlock } from '@slack/types';
import {
  buildMetricCandidateCard,
  buildNoSuggestionMessage,
  encodeMetricActionPayload,
  decodeMetricActionPayload,
  METRIC_APPROVE_ACTION_ID,
  METRIC_REJECT_ACTION_ID,
  type MetricCandidateCardInput,
} from '../metric-approval-cards.js';

const makeCardInput = (
  overrides: Partial<MetricCandidateCardInput> = {},
): MetricCandidateCardInput => ({
  metricId: 42,
  seedName: 'pool_갑_천간_일운',
  patternKind: 'saju',
  description: '갑목 일운 → 일정 폭주',
  windowDays: 7,
  evaluationRule: '발현일 다음날 schedule count >= 3이면 hit',
  evidenceCount: 12,
  rejectionDiff: null,
  ...overrides,
});

const sectionTexts = (blocks: KnownBlock[]): string[] =>
  blocks
    .filter((b): b is SectionBlock => b.type === 'section')
    .map((b) => {
      const text = b.text;
      if (text && 'text' in text && typeof text.text === 'string') return text.text;
      return '';
    });

const actionBlocks = (blocks: KnownBlock[]): ActionsBlock[] =>
  blocks.filter((b): b is ActionsBlock => b.type === 'actions');

describe('encodeMetricActionPayload ↔ decodeMetricActionPayload', () => {
  it('정상 payload 라운드트립', () => {
    const raw = encodeMetricActionPayload({ metricId: 123 });
    expect(decodeMetricActionPayload(raw)).toEqual({ metricId: 123 });
  });

  it('잘못된 JSON 은 null 반환', () => {
    expect(decodeMetricActionPayload('not-json')).toBeNull();
  });

  it('metricId가 number가 아니면 null 반환', () => {
    expect(decodeMetricActionPayload(JSON.stringify({ metricId: 'abc' }))).toBeNull();
    expect(decodeMetricActionPayload(JSON.stringify({}))).toBeNull();
  });

  it('NaN/Infinity는 null 반환', () => {
    expect(decodeMetricActionPayload('{"metricId": null}')).toBeNull();
  });
});

describe('buildMetricCandidateCard', () => {
  it('saju 시드는 [사주] prefix를 header에 포함', () => {
    const blocks = buildMetricCandidateCard(makeCardInput({ patternKind: 'saju' }));
    const texts = sectionTexts(blocks);
    expect(texts[0]).toMatch(/^\[사주\] \*pool_갑_천간_일운\* — 매트릭 제안/);
  });

  it('life_signal 시드는 [생활] prefix를 header에 포함', () => {
    const blocks = buildMetricCandidateCard(
      makeCardInput({ patternKind: 'life_signal', seedName: 'sleep_short' }),
    );
    const texts = sectionTexts(blocks);
    expect(texts[0]).toMatch(/^\[생활\] \*sleep_short\* — 매트릭 제안/);
  });

  it('detail에 description / evaluationRule / window / evidenceCount 포함', () => {
    const blocks = buildMetricCandidateCard(makeCardInput());
    const texts = sectionTexts(blocks);
    expect(texts[0]).toContain('갑목 일운 → 일정 폭주');
    expect(texts[0]).toContain('평가 기준: 발현일 다음날 schedule count >= 3이면 hit');
    expect(texts[0]).toContain('window: 최근 7일');
    expect(texts[0]).toContain('evidence 누적 12일');
  });

  it('rejectionDiff null이면 재제안 사유 줄 없음', () => {
    const blocks = buildMetricCandidateCard(makeCardInput({ rejectionDiff: null }));
    const texts = sectionTexts(blocks);
    expect(texts[0]).not.toContain('재제안 사유');
  });

  it('rejectionDiff 있으면 재제안 사유 줄 포함', () => {
    const blocks = buildMetricCandidateCard(
      makeCardInput({ rejectionDiff: 'window 7→14일 확장, evidence 누적 8건 추가' }),
    );
    const texts = sectionTexts(blocks);
    expect(texts[0]).toContain('재제안 사유: window 7→14일 확장');
  });

  it('승인/거절 버튼 action_id 검증', () => {
    const blocks = buildMetricCandidateCard(makeCardInput());
    const actions = actionBlocks(blocks);
    expect(actions.length).toBe(1);
    const buttons = actions[0].elements;
    expect(buttons.length).toBe(2);
    expect(buttons[0]).toMatchObject({
      type: 'button',
      action_id: METRIC_APPROVE_ACTION_ID,
      style: 'primary',
    });
    expect(buttons[1]).toMatchObject({
      type: 'button',
      action_id: METRIC_REJECT_ACTION_ID,
    });
  });

  it('버튼 value에 metricId payload 직렬화 포함', () => {
    const blocks = buildMetricCandidateCard(makeCardInput({ metricId: 999 }));
    const actions = actionBlocks(blocks);
    const button = actions[0].elements[0];
    if (button.type !== 'button') throw new Error('Expected button');
    const decoded = decodeMetricActionPayload(button.value ?? '');
    expect(decoded).toEqual({ metricId: 999 });
  });
});

describe('buildNoSuggestionMessage', () => {
  it('yyyymm 포함된 section 1개 반환', () => {
    const blocks = buildNoSuggestionMessage('2026-07');
    expect(blocks.length).toBe(1);
    const texts = sectionTexts(blocks);
    expect(texts[0]).toContain('2026-07');
    expect(texts[0]).toContain('매트릭 제안 없음');
  });
});
