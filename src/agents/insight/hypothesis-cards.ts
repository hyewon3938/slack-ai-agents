/**
 * 검증 Block Kit 카드 빌더 — #477 P2/P3 (주간 검증 리포트) + P5a 발굴 승인 카드(ADR-0039).
 *
 * - 주간 검증 리포트: 시드 영향력 top 5 + off-day 검증 현황(verified / emerging / reject)
 * - 발굴 승인 카드: 여집합 발굴 후보(pending 링크)를 맥락 풍부 카드로 → [추적 시작]/[패스].
 *   사람은 노출·큐레이션만 게이트, 믿음(진짜인지)은 끝까지 e-value 트랙(ADR-0039 §3).
 */

import type { KnownBlock } from '@slack/types';
import type { LinkVerification } from '../../shared/pattern-verification.js';
import type { DiscoveryCandidate } from './hypothesis-discovery.js';
import { INSIGHT_THRESHOLDS } from '../../shared/insight-thresholds.js';

const KIND_LABEL: Record<'saju' | 'life_signal', string> = {
  saju: '[사주]',
  life_signal: '[생활]',
};

// ─── P5a 발굴 승인 카드 (ADR-0039 §3) ────────────────────

export const DISCOVERY_APPROVE_ACTION_ID = 'discovery_approve';
export const DISCOVERY_DISMISS_ACTION_ID = 'discovery_dismiss';

/** Slack action value 직렬화 — pending 링크 id만 실어 승인/패스 시 status 전이. */
export interface DiscoveryCardPayload {
  linkId: number;
}

export const encodeDiscoveryPayload = (payload: DiscoveryCardPayload): string =>
  JSON.stringify(payload);

export const decodeDiscoveryPayload = (raw: string): DiscoveryCardPayload | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.linkId !== 'number' || !Number.isFinite(obj.linkId)) return null;
    return { linkId: obj.linkId };
  } catch {
    return null;
  }
};

const formatPercent = (v: number): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';

const formatRatio = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(2)}x` : '—');

const formatPValue = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '—');

const formatPosterior = (v: number): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—';

// ─── P5a 발굴 후보 카드 빌더 ──────────────────────────────

/** 발굴 후보(pending 링크) 카드 입력 = 후보 + 선INSERT된 링크 id. */
export type DiscoveryCardInput = DiscoveryCandidate & { linkId: number };

/**
 * 발굴 후보 맥락 풍부 카드 — 왜 이 후보인지(off-day 통계 + 평어) + "승인=추적, 통계가 심판" 프레이밍.
 * 사람은 추적 가치(노출·큐레이션)만 게이트. 진짜인지는 주간 e-value 트랙이 몇 주에 걸쳐 가린다.
 */
export const buildDiscoveryCandidateCard = (c: DiscoveryCardInput): KnownBlock[] => {
  const payload = encodeDiscoveryPayload({ linkId: c.linkId });
  const header = `${KIND_LABEL[c.patternKind]} *${c.seedName}* × *${c.signalName}* — 새 패턴 후보`;
  const stat =
    `이 시드 켜진 날 *${c.signalName}* 발현 ${formatPercent(c.rateActive)} ` +
    `vs 평소 ${formatPercent(c.rateOff)} (effect ${formatRatio(c.effect)}, n=${c.nActive}일)`;
  const seedDesc = c.seedDescription?.trim() || c.seedName;
  const signalDesc = c.signalDescription?.trim() || c.signalName;
  const meaning =
    `_${seedDesc} → ${signalDesc} 경향이 데이터에서 보임 — ` +
    `off-day 대조에서 연관 잡힘 (발견 q=${formatPValue(c.qValue)})_`;
  const caveat =
    '_아직 후보야. 추적 시작하면 주간 엔진이 몇 주 검정해서 진짜인지 가린다. 연관이지 인과 아님._';
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${header}\n${stat}\n${meaning}\n${caveat}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '추적 시작' },
          style: 'primary',
          action_id: DISCOVERY_APPROVE_ACTION_ID,
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '패스' },
          action_id: DISCOVERY_DISMISS_ACTION_ID,
          value: payload,
        },
      ],
    },
  ];
};

// ─── 시드 영향력 섹션 (주간 리포트 상단) ─────────────────

/** 시드 영향력 — credible interval lower bound 정렬. */
export interface SeedInfluenceRow {
  patternId: number;
  patternKind: 'saju' | 'life_signal';
  signalName: string;
  description: string | null;
  totalHits: number;
  totalMisses: number;
  posteriorP: number;
  ciLower: number;
  ciUpper: number;
}

const POSTERIOR_LEGEND =
  '_사후 = 본인 패턴일 확률 추정 (50%=우연, 80%↑=강함) · [] = 95% 신뢰 구간 (좁을수록 정확)_';

export const buildSeedInfluenceSection = (rows: SeedInfluenceRow[]): KnownBlock[] => {
  if (rows.length === 0) return [];
  const lines = rows.map((r) => {
    const kindLabel = KIND_LABEL[r.patternKind];
    const desc = (r.description ?? '').slice(0, 40);
    const verifyCount = r.totalHits + r.totalMisses;
    return (
      `• ${kindLabel} *${r.signalName}* (검증 ${verifyCount}개)` +
      (desc ? ` — ${desc}` : '') +
      ` — 사후 ${formatPosterior(r.posteriorP)} ` +
      `[${formatPosterior(r.ciLower)}, ${formatPosterior(r.ciUpper)}]`
    );
  });
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*이번 주 영향력 시드 top ${rows.length}*\n${lines.join('\n')}`,
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: POSTERIOR_LEGEND }],
    },
    { type: 'divider' },
  ];
};

// ─── off-day 검증 현황 섹션 (P3 3-tier: 검증됨 / 검증중 / 기각) ──

const V = INSIGHT_THRESHOLDS.patternVerification;

/** verified = e≥20 확정 승격(nextStatus='confirmed'). */
export const isVerified = (l: LinkVerification): boolean => l.nextStatus === 'confirmed';

/** emerging = active 유지 + off-day effect leaning + 최소 발현일(검증중). view 술어와 일치. */
export const isEmerging = (l: LinkVerification): boolean =>
  l.nextStatus === 'active' &&
  Number.isFinite(l.effect) &&
  l.effect >= V.emergingMinEffect &&
  l.nActive >= V.emergingMinActive;

/** e-value 진행바 (0 → threshold). */
const evalueBar = (e: number, threshold: number): string => {
  const ratio = Number.isFinite(e) ? Math.max(0, Math.min(1, e / threshold)) : 0;
  const filled = Math.round(ratio * 7);
  return '█'.repeat(filled) + '░'.repeat(7 - filled);
};

/** verified(검증됨) 한 줄 — 통계 확정 + off-day 대조. */
const verifiedLine = (l: LinkVerification): string =>
  `• ✅ ${KIND_LABEL[l.patternKind]} *${l.signalName}* → \`${l.seedName}\` — ` +
  `발현 ${formatPercent(l.rateActive)} vs 비발현 ${formatPercent(l.rateOff)} ` +
  `(effect ${formatRatio(l.effect)}, q=${formatPValue(l.qValue)}, n=${l.nActive}) · ` +
  `e ${l.eValue.toFixed(1)} 검증됨`;

/** emerging(검증중) 한 줄 — hedged + e-value 진행바 + 주간대비 delta. */
const emergingLine = (l: LinkVerification, prevE: number | undefined): string => {
  const bar = evalueBar(l.eValue, V.evalueThreshold);
  const delta =
    prevE !== undefined && Number.isFinite(prevE)
      ? ` (지난주 ${prevE.toFixed(1)} → 이번주 ${l.eValue.toFixed(1)})`
      : '';
  return (
    `• 🌱 ${KIND_LABEL[l.patternKind]} *${l.signalName}* → \`${l.seedName}\` — ` +
    `발현 ${formatPercent(l.rateActive)} vs 비발현 ${formatPercent(l.rateOff)} ` +
    `(effect ${formatRatio(l.effect)}, n=${l.nActive}) · ` +
    `검증중 ${bar} e ${l.eValue.toFixed(1)}/${V.evalueThreshold}${delta}`
  );
};

const rejectLine = (l: LinkVerification): string =>
  `• ✗ ${KIND_LABEL[l.patternKind]} ${l.signalName} × \`${l.seedName}\` — 연관 약함(effect ${formatRatio(l.effect)})`;

const TIER_LEGEND =
  '_✅ 검증됨 = e-value≥20 통계 확정(우연 아님, 단 연관이지 인과는 아님) · 🌱 검증중 = off-day 경향은 보이나 아직 확정 전 · ✗ 기각 = 연관 약함._';

/**
 * 주간 검증 리포트 — 시드 영향력 + 3-tier 검증 현황(검증됨/검증중/기각).
 * 검증중(emerging)은 e-value 진행바로 "쌓이는 중"을 정직하게 프레이밍(ADR-0035). discovery는 P5.
 */
export const buildVerificationBlocks = (
  weekStart: string,
  links: LinkVerification[],
  seedInfluence: SeedInfluenceRow[],
  prevEValues: Map<number, number> = new Map(),
): KnownBlock[] => {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `패턴 검증 주간 리포트 (${weekStart} ~)` },
    },
  ];

  blocks.push(...buildSeedInfluenceSection(seedInfluence));

  if (links.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_검증할 active 링크 없음 — 시드×신호 데이터가 더 쌓이면 자동으로 검증돼._',
      },
    });
    return blocks;
  }

  const verified = links.filter(isVerified);
  const emerging = links.filter(isEmerging);
  const rejects = links.filter((l) => l.verdict === 'reject');
  const others = links.length - verified.length - emerging.length - rejects.length;

  const summaryParts = [
    `검증됨 ${verified.length}`,
    `검증중 ${emerging.length}`,
    `기각 ${rejects.length}`,
  ];
  if (others > 0) summaryParts.push(`판정 보류 ${others}`);
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*이번 주 off-day 검증 (${links.length}개 링크)*\n${summaryParts.join(' · ')}`,
    },
  });

  if (verified.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: verified.map(verifiedLine).join('\n') },
    });
  }

  if (emerging.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: emerging.map((l) => emergingLine(l, prevEValues.get(l.linkId))).join('\n'),
      },
    });
  }

  if (rejects.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: rejects.map(rejectLine).join('\n') },
    });
  }

  if (verified.length > 0 || emerging.length > 0) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: TIER_LEGEND }] });
  }

  return blocks;
};
