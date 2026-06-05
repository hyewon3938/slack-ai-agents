import { describe, it, expect } from 'vitest';
import type { KnownBlock, SectionBlock } from '@slack/types';
import {
  buildVerificationBlocks,
  buildSeedInfluenceSection,
  type SeedInfluenceRow,
} from '../hypothesis-cards.js';
import type { LinkVerification, Verdict } from '../../../shared/pattern-verification.js';

const makeLink = (overrides: Partial<LinkVerification> = {}): LinkVerification => ({
  linkId: 1,
  seedId: 10,
  signalId: 20,
  seedName: '갑목일주',
  patternKind: 'saju',
  signalName: '수면부족',
  signalKind: 'sql',
  valueType: 'continuous',
  currentStatus: 'active',
  a: 20,
  b: 5,
  c: 5,
  d: 20,
  inconclusive: 0,
  nActive: 25,
  nOff: 25,
  rateActive: 0.8,
  rateOff: 0.2,
  effect: 4.0,
  pValue: 0.001,
  qValue: 0.01,
  posteriorAlpha: 21,
  posteriorBeta: 6,
  posteriorP: 0.78,
  eValue: 30,
  lastMatchedAt: '2026-06-01',
  verdict: 'confirm',
  nextStatus: 'active',
  ...overrides,
});

const makeSeedInfluence = (
  patternKind: 'saju' | 'life_signal',
  signalName: string,
): SeedInfluenceRow => ({
  patternId: 1,
  patternKind,
  signalName,
  description: '설명',
  totalHits: 12,
  totalMisses: 3,
  posteriorP: 0.7,
  ciLower: 0.5,
  ciUpper: 0.85,
});

const sectionTexts = (blocks: KnownBlock[]): string[] =>
  blocks
    .filter((b): b is SectionBlock => b.type === 'section')
    .map((b) => {
      const text = b.text;
      if (text && 'text' in text && typeof text.text === 'string') return text.text;
      return '';
    });

describe('buildVerificationBlocks — 빈 링크', () => {
  it('active 링크 없으면 header + 안내 메시지만', () => {
    const blocks = buildVerificationBlocks('2026-06-01', [], []);
    expect(blocks[0]?.type).toBe('header');
    const texts = sectionTexts(blocks);
    expect(texts.some((t) => t.includes('검증할 active 링크 없음'))).toBe(true);
  });
});

describe('buildVerificationBlocks — provisional confirm', () => {
  it('confirm 링크는 ★ + 시드/신호 + off-day 대조율 노출', () => {
    const blocks = buildVerificationBlocks('2026-06-01', [makeLink()], []);
    const texts = sectionTexts(blocks);
    const confirmText = texts.find((t) => t.includes('★'));
    expect(confirmText).toBeDefined();
    expect(confirmText).toContain('[사주]');
    expect(confirmText).toContain('수면부족');
    expect(confirmText).toContain('갑목일주');
    expect(confirmText).toContain('발현 80.0%');
    expect(confirmText).toContain('비발현 20.0%');
  });

  it('confirm이 있으면 provisional 경고 컨텍스트가 붙는다', () => {
    const blocks = buildVerificationBlocks('2026-06-01', [makeLink()], []);
    const ctxTexts = blocks
      .filter((b) => b.type === 'context')
      .flatMap((b) => ('elements' in b ? b.elements : []))
      .map((e) => ('text' in e && typeof e.text === 'string' ? e.text : ''));
    expect(ctxTexts.some((t) => t.includes('provisional') && t.includes('P3'))).toBe(true);
  });
});

describe('buildVerificationBlocks — verdict 요약 + reject', () => {
  it('verdict별 카운트를 요약 라인에 표기', () => {
    const links: LinkVerification[] = [
      makeLink({ verdict: 'confirm' }),
      makeLink({ verdict: 'reject', effect: 1.0 }),
      makeLink({ verdict: 'insufficient', nActive: 3 }),
      makeLink({ verdict: 'insufficient', nActive: 1 }),
    ];
    const summary = sectionTexts(buildVerificationBlocks('2026-06-01', links, [])).find((t) =>
      t.includes('off-day 검증'),
    );
    expect(summary).toContain('4개 링크');
    expect(summary).toContain('확정(provisional) 1');
    expect(summary).toContain('기각 1');
    expect(summary).toContain('데이터 부족 2');
  });

  it('reject 링크는 ✗로 별도 표기', () => {
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ verdict: 'reject', signalName: '지출과다', effect: 1.0 })],
      [],
    );
    const rejectText = sectionTexts(blocks).find((t) => t.includes('✗'));
    expect(rejectText).toContain('지출과다');
  });
});

describe('buildSeedInfluenceSection — patternKind prefix', () => {
  it('saju/life_signal에 따라 [사주]/[생활] prefix', () => {
    const blocks = buildSeedInfluenceSection([
      makeSeedInfluence('saju', '갑목'),
      makeSeedInfluence('life_signal', '저녁운동'),
    ]);
    const text = sectionTexts(blocks)[0] ?? '';
    expect(text).toContain('[사주] *갑목*');
    expect(text).toContain('[생활] *저녁운동*');
  });

  it('빈 배열이면 블록 없음', () => {
    expect(buildSeedInfluenceSection([])).toEqual([]);
  });
});

// 타입 사용처 — Verdict union이 카드 라벨과 일치하는지 컴파일 타임 확인
const _verdictCheck: Record<Verdict, true> = {
  confirm: true,
  reject: true,
  inconclusive: true,
  insufficient: true,
};
void _verdictCheck;
