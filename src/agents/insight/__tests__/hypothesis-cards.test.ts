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
import type {
  ConfoundData,
  SuspectedConfounder,
  AdjustedConfounder,
  ConfoundVerdict,
} from '../../../shared/confound.js';

const makeLink = (overrides: Partial<LinkVerification> = {}): LinkVerification => ({
  linkId: 1,
  seedId: 10,
  signalId: 20,
  seedName: 'S1_갑목_편재_천간',
  seedLabel: '일운 천간 갑목(편재)',
  patternKind: 'saju',
  signalName: 'sleep_night_minutes',
  signalLabel: '밤잠 평소보다 많음',
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
  windowStart: '2026-03-10',
  family: 'baseline',
  stability: true,
  verdict: 'confirm',
  nextStatus: 'active',
  ...overrides,
});

const makeSeedInfluence = (
  patternKind: 'saju' | 'life_signal',
  label: string,
): SeedInfluenceRow => ({
  patternId: 1,
  patternKind,
  signalName: label,
  description: '설명',
  seedLabel: label,
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
    expect(texts.some((t) => t.includes('아직 검증할 가설이 없어'))).toBe(true);
  });
});

describe('buildVerificationBlocks — verified (검증됨)', () => {
  it('confirmed 링크는 ✅ 확정 + 핵심 2줄(효과·표본·확신) — 변수명·진행바·q·CI 미노출', () => {
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ nextStatus: 'confirmed' })],
      [],
    );
    // 요약 줄에도 ✅가 들어가므로 본문 고유 키워드(평소보다)로 항목 섹션을 집는다.
    const t = sectionTexts(blocks).find((x) => x.includes('평소보다'));
    expect(t).toBeDefined();
    expect(t).toContain('✅');
    expect(t).toContain('[사주]');
    expect(t).toContain('밤잠 평소보다 많음'); // signalLabel
    expect(t).toContain('일운 천간 갑목(편재)'); // seedLabel
    expect(t).not.toContain('sleep_night_minutes'); // 변수명 미노출 (#504)
    expect(t).not.toContain('S1_갑목_편재_천간');
    expect(t).toContain('확정'); // tier 결론
    expect(t).toContain('평소보다 4.0배'); // 효과크기
    expect(t).toContain('(20/25일)'); // 표본 = 발현 분수(작은 표본 정직하게)
    expect(t).toContain('확신 78%'); // 확신도(단일값)
    // 압축으로 제거된 요소
    expect(t).not.toContain('확정 증거'); // e-value 보조 줄 제거
    expect(t).not.toContain('░'); // 진행바 제거
    expect(t).not.toContain('우연 가능성'); // q값 제거
    expect(t).not.toContain('%]'); // 추정범위(CI) 제거 ([사주] 라벨의 '['와 구분)
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
    expect(ctxTexts.some((t) => t.includes('검증됨') && t.includes('인과 아님'))).toBe(true);
  });
});

describe('buildVerificationBlocks — emerging (검증중)', () => {
  it('active + effect leaning + n충분 → 🌱 + 핵심 2줄(효과·표본·확신), 진행바·추세 없음', () => {
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ nextStatus: 'active', eValue: 7 })],
      [],
    );
    const t = sectionTexts(blocks).find((x) => x.includes('평소보다'));
    expect(t).toBeDefined();
    expect(t).toContain('🌱');
    expect(t).toContain('평소보다 4.0배');
    expect(t).toContain('(20/25일)');
    expect(t).toContain('확신 78%');
    // 압축으로 제거된 요소
    expect(t).not.toContain('확정까지'); // 진행바 라벨 제거
    expect(t).not.toContain('░'); // 진행바 제거
    expect(t).not.toContain('/20'); // e-value 분모 제거
    expect(t).not.toContain('지난주'); // 주간추세 제거
  });

  it('effect 약하면(emerging 미달) 항목 안 뜸 — 판정 보류로 카운트', () => {
    const blocks = buildVerificationBlocks(
      '2026-06-01',
      [makeLink({ nextStatus: 'active', effect: 1.0, verdict: 'inconclusive' })],
      [],
    );
    // 요약 줄 이모지와 구분 위해 항목 본문 키워드(평소보다)로 검사
    expect(sectionTexts(blocks).some((x) => x.includes('평소보다'))).toBe(false);
    const summary = sectionTexts(blocks).find((t) => t.includes('패턴 검증'));
    expect(summary).toContain('나머지 1');
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
        signalName: 'expense_total',
        signalLabel: '총 지출 평소보다 많음',
      }), // reject
    ];
    const texts = sectionTexts(buildVerificationBlocks('2026-06-01', links, []));
    const summary = texts.find((t) => t.includes('패턴 검증'));
    expect(summary).toContain('가설 3개');
    expect(summary).toContain('검증됨 1');
    expect(summary).toContain('검증중 1');
    expect(summary).toContain('기각 1');
    // 요약 줄에도 ✗가 들어가므로 reject 본문 고유 키워드(차이 없음)로 집는다.
    const rejectText = texts.find((t) => t.includes('차이 없음'));
    expect(rejectText).toContain('총 지출 평소보다 많음');
    expect(rejectText).not.toContain('expense_total');
  });
});

describe('buildVerificationBlocks — 교란 caveat (inline, 압축)', () => {
  const susp = (seedId: number): SuspectedConfounder => ({
    seedId,
    seedName: `Z${seedId}`,
    overlap: 0.6,
    effectZX: 1.5,
    nCofire: 12,
  });
  const adj = (verdict: ConfoundVerdict): AdjustedConfounder => ({
    seedId: 99,
    adjEffect: 1.1,
    nCofire: 35,
    verdict,
  });
  // emerging으로 뜨는 링크(effect 4.0·nActive 25·active) — 항목 둘째 줄 끝에 caveat가 붙음
  const cardText = (cf: Map<number, ConfoundData>, kind: 'saju' | 'life_signal' = 'saju') =>
    sectionTexts(
      buildVerificationBlocks(
        '2026-06-01',
        [makeLink({ nextStatus: 'active', patternKind: kind })],
        [],
        cf,
      ),
    ).find((x) => x.includes('평소보다'));

  it('suspected만(조정 게이트 미달) → "다른 기운과 겹침" (시드 이름 미노출)', () => {
    const cf = new Map<number, ConfoundData>([
      [1, { scannedAt: '2026-06-01', suspected: [susp(2), susp(3)] }],
    ]);
    const t = cardText(cf);
    expect(t).toContain('⚠️ 다른 기운과 겹침');
    expect(t).not.toContain('Z2'); // 교란 시드 이름 일반화(노출 0)
  });

  it('explained_away → "겹친 기운 빼면 효과 사라짐"', () => {
    const cf = new Map<number, ConfoundData>([
      [
        1,
        {
          scannedAt: '2026-06-01',
          suspected: [susp(2)],
          adjusted: [adj('explained_away')],
          explainedAway: true,
        },
      ],
    ]);
    expect(cardText(cf)).toContain('⚠️ 겹친 기운 빼면 효과 사라짐');
  });

  it('attenuated → "겹친 기운 빼면 약해짐"', () => {
    const cf = new Map<number, ConfoundData>([
      [1, { scannedAt: '2026-06-01', suspected: [susp(2)], adjusted: [adj('attenuated')] }],
    ]);
    expect(cardText(cf)).toContain('⚠️ 겹친 기운 빼면 약해짐');
  });

  it('survives(조정 후 유지)는 긍정이라 caveat 생략 — ⚠️ 없음', () => {
    const cf = new Map<number, ConfoundData>([
      [1, { scannedAt: '2026-06-01', suspected: [susp(2)], adjusted: [adj('survives')] }],
    ]);
    expect(cardText(cf)).not.toContain('⚠️');
  });

  it('life_signal 시드는 "기운" 대신 "요인"', () => {
    const cf = new Map<number, ConfoundData>([
      [1, { scannedAt: '2026-06-01', suspected: [susp(2)] }],
    ]);
    expect(cardText(cf, 'life_signal')).toContain('⚠️ 다른 요인과 겹침');
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
    seedName: 'S1_갑목_편재_천간',
    seedDescription: '일운 천간 갑목(편재) → 일정/지출 폭증',
    seedLabel: '일운 천간 갑목(편재)',
    patternKind: 'saju',
    signalName: 'expense_total',
    signalDescription: 'N8_병화_편관_천간 시드의 expense_total 평가',
    signalLabel: '총 지출 평소보다 많음',
    signalKind: 'sql',
    valueType: 'binary',
    rateActive: 0.75,
    rateOff: 0.25,
    effect: 3.0,
    effectSize: null,
    mwP: null,
    sortZ: 3.2,
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

  it('헤더 + off-day 통계 + 라벨 + caveat', () => {
    const text = sectionTexts(buildDiscoveryCandidateCard(makeCandidate()))[0] ?? '';
    expect(text).toContain('[사주]');
    expect(text).toContain('일운 천간 갑목(편재)'); // seedLabel
    expect(text).toContain('총 지출 평소보다 많음'); // signalLabel
    expect(text).toContain('새 패턴 후보');
    expect(text).toContain('24일 중 18일'); // 발현 = 분수
    expect(text).toContain('평소 25%'); // 비발현 = 비율
    expect(text).toContain('3.0배');
    expect(text).toContain('인과 아님'); // caveat
    // 변수명·깨진 provenance 미노출 (#504 P2)
    expect(text).not.toContain('S1_갑목_편재_천간');
    expect(text).not.toContain('expense_total');
    expect(text).not.toContain('평가');
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

  it('카드는 description(provenance) 무시하고 라벨만 사용 — 깨진 provenance여도 미노출', () => {
    const text =
      sectionTexts(
        buildDiscoveryCandidateCard(
          makeCandidate({
            seedDescription: 'N8_병화_편관_천간 시드의 schedule_tax_keyword 평가',
            signalDescription: 'N8_병화_편관_천간 시드의 schedule_tax_keyword 평가',
          }),
        ),
      )[0] ?? '';
    expect(text).toContain('일운 천간 갑목(편재)'); // seedLabel
    expect(text).toContain('총 지출 평소보다 많음'); // signalLabel
    expect(text).not.toContain('schedule_tax_keyword');
    expect(text).not.toContain('평가');
  });

  it('seedLabel이 "날"로 끝나면 "켜진 날" 중복 안 붙음 (#504 B)', () => {
    const text =
      sectionTexts(
        buildDiscoveryCandidateCard(makeCandidate({ seedLabel: '루틴 듬성듬성 빠진 날' })),
      )[0] ?? '';
    expect(text).toContain('루틴 듬성듬성 빠진 날 *'); // 라벨 뒤 바로 신호
    expect(text).not.toContain('빠진 날 켜진 날'); // 중복 없음
  });

  it('seedLabel이 "날/일"로 안 끝나면 "켜진 날" 붙음', () => {
    const text =
      sectionTexts(
        buildDiscoveryCandidateCard(makeCandidate({ seedLabel: '일운 천간 갑목(편재)' })),
      )[0] ?? '';
    expect(text).toContain('일운 천간 갑목(편재) 켜진 날');
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
