import { describe, it, expect } from 'vitest';
import type { KnownBlock, SectionBlock, ActionsBlock } from '@slack/types';
import {
  buildVerificationBlocks,
  buildSeedInfluenceSection,
  buildDiscoveryCandidateCard,
  encodeDiscoveryPayload,
  decodeDiscoveryPayload,
  DISCOVERY_APPROVE_ACTION_ID,
  DISCOVERY_DISMISS_ACTION_ID,
  type SeedInfluenceRow,
  type DiscoveryCardInput,
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
  fisherP: 0.001,
  qValue: 0.01,
  mannWhitney: null,
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

describe('buildVerificationBlocks — verified (검증됨)', () => {
  it('confirmed 링크는 ✅ + 검증됨 + off-day 대조 노출', () => {
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ nextStatus: 'confirmed' })],
      [],
    );
    const t = sectionTexts(blocks).find((x) => x.includes('✅'));
    expect(t).toBeDefined();
    expect(t).toContain('[사주]');
    expect(t).toContain('수면부족');
    expect(t).toContain('갑목일주');
    expect(t).toContain('검증됨');
    expect(t).toContain('발현 80.0%');
    expect(t).toContain('비발현 20.0%');
  });

  it('verified가 있으면 tier 범례 컨텍스트가 붙는다', () => {
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ nextStatus: 'confirmed' })],
      [],
    );
    const ctxTexts = blocks
      .filter((b) => b.type === 'context')
      .flatMap((b) => ('elements' in b ? b.elements : []))
      .map((e) => ('text' in e && typeof e.text === 'string' ? e.text : ''));
    expect(ctxTexts.some((t) => t.includes('검증됨') && t.includes('인과는 아님'))).toBe(true);
  });
});

describe('buildVerificationBlocks — emerging (검증중)', () => {
  it('active + effect leaning + n충분 → 🌱 + 진행바 + e/20', () => {
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ nextStatus: 'active', eValue: 7 })],
      [],
    );
    const t = sectionTexts(blocks).find((x) => x.includes('🌱'));
    expect(t).toBeDefined();
    expect(t).toContain('검증중');
    expect(t).toContain('e 7.0/20');
  });

  it('prevEValues 있으면 주간대비 delta 표기', () => {
    const prev = new Map<number, number>([[1, 3.1]]);
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ nextStatus: 'active', eValue: 7 })],
      [],
      prev,
    );
    const t = sectionTexts(blocks).find((x) => x.includes('🌱'));
    expect(t).toContain('지난주 3.1 → 이번주 7.0');
  });

  it('effect 약하면(emerging 미달) 🌱 안 뜸', () => {
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ nextStatus: 'active', effect: 1.0, verdict: 'inconclusive' })],
      [],
    );
    expect(sectionTexts(blocks).some((x) => x.includes('🌱'))).toBe(false);
  });
});

describe('buildVerificationBlocks — 요약 + reject', () => {
  it('tier별 카운트 요약 + reject ✗', () => {
    const links: LinkVerification[] = [
      makeLink({ nextStatus: 'confirmed' }), // verified
      makeLink({ nextStatus: 'active', effect: 2.0, nActive: 20, verdict: 'inconclusive' }), // emerging
      makeLink({
        verdict: 'reject',
        nextStatus: 'rejected',
        effect: 1.0,
        signalName: '지출과다',
      }), // reject
    ];
    const texts = sectionTexts(buildVerificationBlocks('2026-06-01', links, []));
    const summary = texts.find((t) => t.includes('off-day 검증'));
    expect(summary).toContain('3개 링크');
    expect(summary).toContain('검증됨 1');
    expect(summary).toContain('검증중 1');
    expect(summary).toContain('기각 1');
    const rejectText = texts.find((t) => t.includes('✗'));
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

describe('buildDiscoveryCandidateCard — 발굴 후보 맥락 카드', () => {
  const makeCandidate = (overrides: Partial<DiscoveryCardInput> = {}): DiscoveryCardInput => ({
    linkId: 555,
    seedId: 10,
    signalId: 20,
    seedName: '갑목일주',
    seedDescription: '일간이 강한 날',
    patternKind: 'saju',
    signalName: '지출과다',
    signalDescription: '하루 지출이 평소보다 많음',
    signalKind: 'sql',
    rateActive: 0.75,
    rateOff: 0.25,
    effect: 3.0,
    nActive: 24,
    hit: 18,
    miss: 6,
    inconclusive: 0,
    fisherP: 0.002,
    blockP: 0.004,
    qValue: 0.03,
    posteriorAlpha: 19,
    posteriorBeta: 7,
    posteriorP: 0.73,
    family: 'saju_strength',
    ...overrides,
  });

  const buttonsOf = (blocks: KnownBlock[]): ActionsBlock['elements'] =>
    blocks.filter((b): b is ActionsBlock => b.type === 'actions').flatMap((b) => b.elements);

  it('헤더 + off-day 통계 + 평어 + caveat', () => {
    const text = sectionTexts(buildDiscoveryCandidateCard(makeCandidate()))[0] ?? '';
    expect(text).toContain('[사주]');
    expect(text).toContain('갑목일주');
    expect(text).toContain('지출과다');
    expect(text).toContain('새 패턴 후보');
    expect(text).toContain('발현 75.0%');
    expect(text).toContain('평소 25.0%');
    expect(text).toContain('effect 3.00x');
    expect(text).toContain('n=24');
    expect(text).toContain('일간이 강한 날'); // seed desc 평어
    expect(text).toContain('하루 지출이 평소보다 많음'); // signal desc 평어
    expect(text).toContain('인과 아님'); // caveat
  });

  it('두 버튼(추적 시작/패스) + linkId payload', () => {
    const buttons = buttonsOf(buildDiscoveryCandidateCard(makeCandidate({ linkId: 777 })));
    expect(buttons).toHaveLength(2);
    const ids = buttons.map((e) => ('action_id' in e ? e.action_id : ''));
    expect(ids).toContain(DISCOVERY_APPROVE_ACTION_ID);
    expect(ids).toContain(DISCOVERY_DISMISS_ACTION_ID);
    const value = buttons
      .map((e) => ('value' in e ? e.value : undefined))
      .find((v): v is string => typeof v === 'string');
    expect(decodeDiscoveryPayload(value ?? '')).toEqual({ linkId: 777 });
  });

  it('description 없으면 이름으로 폴백', () => {
    const text =
      sectionTexts(
        buildDiscoveryCandidateCard(
          makeCandidate({ seedDescription: null, signalDescription: null }),
        ),
      )[0] ?? '';
    expect(text).toContain('갑목일주 → 지출과다');
  });

  it('payload encode/decode 왕복 + 방어', () => {
    expect(decodeDiscoveryPayload(encodeDiscoveryPayload({ linkId: 42 }))).toEqual({ linkId: 42 });
    expect(decodeDiscoveryPayload('not json')).toBeNull();
    expect(decodeDiscoveryPayload('{"linkId":"x"}')).toBeNull();
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
