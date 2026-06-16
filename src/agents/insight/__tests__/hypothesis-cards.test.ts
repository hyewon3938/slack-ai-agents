import { describe, it, expect } from 'vitest';
import type { KnownBlock, SectionBlock, ActionsBlock } from '@slack/types';
import {
  buildDiscoveryCandidateCard,
  encodeDiscoveryPayload,
  decodeDiscoveryPayload,
  DISCOVERY_APPROVE_ACTION_ID,
  DISCOVERY_DISMISS_ACTION_ID,
  type DiscoveryCardInput,
} from '../hypothesis-cards.js';

// 주간 검증 리포트 카드(buildVerificationBlocks·buildSeedInfluenceSection·buildHygieneNotice)는
// #542(ADR-0052)에서 발송 은퇴 — routine 통합 카드가 단독 발송. 관련 테스트도 함께 제거.
// 남은 카드 빌더: 발굴 후보 카드(버튼 인터랙션 때문에 봇 발송 유지)와 재기준선 공지.

const sectionTexts = (blocks: KnownBlock[]): string[] =>
  blocks
    .filter((b): b is SectionBlock => b.type === 'section')
    .map((b) => {
      const text = b.text;
      if (text && 'text' in text && typeof text.text === 'string') return text.text;
      return '';
    });

describe('buildDiscoveryCandidateCard — 발굴 후보 맥락 카드', () => {
  const makeCandidate = (overrides: Partial<DiscoveryCardInput> = {}): DiscoveryCardInput => ({
    linkId: 555,
    seedId: 10,
    signalId: 20,
    seedName: 'S1_갑목_편재_천간',
    seedDescription: '일운 천간 갑목(편재) → 일정/지출 폭증',
    seedLabel: '갑목(편재)',
    patternKind: 'saju',
    signalName: 'expense_total',
    signalDescription: 'N8_병화_편관_천간 시드의 expense_total 평가',
    signalLabel: '총 지출 많음',
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
    expect(text).toContain('갑목(편재)'); // seedLabel (#542 접두 제거)
    expect(text).toContain('총 지출 많음'); // signalLabel (#542 "평소보다" 제거)
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
    expect(text).toContain('갑목(편재)'); // seedLabel
    expect(text).toContain('총 지출 많음'); // signalLabel
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
      sectionTexts(buildDiscoveryCandidateCard(makeCandidate({ seedLabel: '갑목(편재)' })))[0] ??
      '';
    expect(text).toContain('갑목(편재) 켜진 날');
  });

  it('payload encode/decode 왕복 + 방어', () => {
    expect(decodeDiscoveryPayload(encodeDiscoveryPayload({ linkId: 42 }))).toEqual({ linkId: 42 });
    expect(decodeDiscoveryPayload('not json')).toBeNull();
    expect(decodeDiscoveryPayload('{"linkId":"x"}')).toBeNull();
  });
});
