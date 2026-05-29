import { describe, it, expect } from 'vitest';
import type { KnownBlock, SectionBlock } from '@slack/types';
import {
  buildCandidateCard,
  buildWeeklyReviewBlocks,
  type ActiveHypothesisRow,
} from '../hypothesis-cards.js';
import type { CandidateHypothesis } from '../hypothesis-discovery.js';
import type { Hypothesis, HypothesisStat } from '../../../shared/pattern-hypothesis.js';

const makeCandidate = (
  signalId: number,
  name: string,
  patternKind: 'saju' | 'life_signal',
): CandidateHypothesis => ({
  triggerSpec: { type: 'seed', signalId },
  signalName: name,
  patternKind,
  enumTarget: 'mood_high',
  nTriggerDays: 8,
  nTotalDays: 28,
  rateTrigger: 0.5,
  rateBaseline: 0.2,
  rateRatio: 2.5,
  rawP: 0.04,
  fdrQ: 0.15,
  posteriorP: 0.5,
  ciLower: 0.21,
  ciUpper: 0.79,
});

const makeStat = (hypothesisId: number): HypothesisStat => ({
  hypothesisId,
  weekStart: '2026-05-25',
  nTriggerDays: 4,
  nTotalDays: 7,
  rateTrigger: 0.5,
  rateBaseline: 0.2,
  rateRatio: 2.5,
  rawP: 0.04,
  fdrQ: 0.15,
  posteriorAlpha: 3,
  posteriorBeta: 3,
  posteriorP: 0.5,
  ciLower: 0.18,
  ciUpper: 0.82,
});

const makeHypothesis = (id: number, signalId: number): Hypothesis => ({
  id,
  userId: 1,
  triggerSpec: { type: 'seed', signalId },
  enumTarget: 'mood_high',
  status: 'active',
  source: 'discovery',
  registeredAt: new Date('2026-05-01T00:00:00Z'),
  confirmedAt: null,
  rejectedAt: null,
  archivedAt: null,
  notes: null,
});

const sectionTexts = (blocks: KnownBlock[]): string[] =>
  blocks
    .filter((b): b is SectionBlock => b.type === 'section')
    .map((b) => {
      const text = b.text;
      if (text && 'text' in text && typeof text.text === 'string') return text.text;
      return '';
    });

describe('buildCandidateCard — patternKind prefix', () => {
  it('saju 시드는 [사주] prefix를 header에 포함', () => {
    const blocks = buildCandidateCard(makeCandidate(1, '갑목일주', 'saju'));
    const texts = sectionTexts(blocks);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts[0]).toMatch(/^\[사주\] \*갑목일주\*/);
  });

  it('life_signal 시드는 [생활] prefix를 header에 포함', () => {
    const blocks = buildCandidateCard(makeCandidate(2, '저녁 운동', 'life_signal'));
    const texts = sectionTexts(blocks);
    expect(texts[0]).toMatch(/^\[생활\] \*저녁 운동\*/);
  });
});

describe('buildWeeklyReviewBlocks — cap per kind', () => {
  it('saju 6 + life_signal 7 → 종류별 5건씩만 노출 (최대 10건)', () => {
    const candidates: CandidateHypothesis[] = [
      ...Array.from({ length: 6 }, (_, i) => makeCandidate(100 + i, `사주${i}`, 'saju')),
      ...Array.from({ length: 7 }, (_, i) => makeCandidate(200 + i, `생활${i}`, 'life_signal')),
    ];
    const blocks = buildWeeklyReviewBlocks([], candidates, '2026-05-25', []);
    const texts = sectionTexts(blocks);

    const sajuCards = texts.filter((t) => /^\[사주\]/.test(t));
    const lifeCards = texts.filter((t) => /^\[생활\]/.test(t));
    expect(sajuCards.length).toBe(5);
    expect(lifeCards.length).toBe(5);
  });

  it('신규 후보 섹션 헤더에 종류별 카운트 표기', () => {
    const candidates: CandidateHypothesis[] = [
      makeCandidate(1, '사주A', 'saju'),
      makeCandidate(2, '사주B', 'saju'),
      makeCandidate(3, '생활A', 'life_signal'),
    ];
    const blocks = buildWeeklyReviewBlocks([], candidates, '2026-05-25', []);
    const headerSection = sectionTexts(blocks).find((t) => /^\*신규 후보/.test(t));
    expect(headerSection).toBeDefined();
    expect(headerSection).toContain('사주 2');
    expect(headerSection).toContain('생활 1');
  });

  it('한쪽이 비어 있어도 header에 0 카운트로 표기', () => {
    const candidates: CandidateHypothesis[] = [
      makeCandidate(1, '사주A', 'saju'),
      makeCandidate(2, '사주B', 'saju'),
    ];
    const blocks = buildWeeklyReviewBlocks([], candidates, '2026-05-25', []);
    const headerSection = sectionTexts(blocks).find((t) => /^\*신규 후보/.test(t));
    expect(headerSection).toContain('사주 2');
    expect(headerSection).toContain('생활 0');
  });

  it('candidates가 0건이면 신규 후보 섹션 자체가 추가되지 않음', () => {
    const blocks = buildWeeklyReviewBlocks([], [], '2026-05-25', []);
    const headerSection = sectionTexts(blocks).find((t) => /^\*신규 후보/.test(t));
    expect(headerSection).toBeUndefined();
  });
});

describe('buildWeeklyReviewBlocks — active 가설 prefix', () => {
  it('active row에도 patternKind 따라 [사주] / [생활] prefix가 붙는다', () => {
    const active: ActiveHypothesisRow[] = [
      {
        hypothesis: makeHypothesis(10, 100),
        signalName: '사주가설',
        patternKind: 'saju',
        latest: makeStat(10),
        prev: null,
      },
      {
        hypothesis: makeHypothesis(11, 101),
        signalName: '생활가설',
        patternKind: 'life_signal',
        latest: makeStat(11),
        prev: null,
      },
    ];
    const blocks = buildWeeklyReviewBlocks(active, [], '2026-05-25', []);
    const activeSection = sectionTexts(blocks).find((t) => t.includes('active 가설'));
    expect(activeSection).toBeDefined();
    expect(activeSection).toMatch(/\[사주\] \*사주가설\*/);
    expect(activeSection).toMatch(/\[생활\] \*생활가설\*/);
  });
});
