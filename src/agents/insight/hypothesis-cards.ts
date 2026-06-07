/**
 * 검증 Block Kit 카드 빌더 — #477 P2/P3 (주간 검증 리포트) + P5a 발굴 승인 카드(ADR-0039).
 *
 * - 주간 검증 리포트: 시드 영향력 top 5 + off-day 검증 현황(verified / emerging / reject)
 * - 발굴 승인 카드: 여집합 발굴 후보(pending 링크)를 맥락 풍부 카드로 → [추적 시작]/[패스].
 *   사람은 노출·큐레이션만 게이트, 믿음(진짜인지)은 끝까지 e-value 트랙(ADR-0039 §3).
 */

import type { KnownBlock } from '@slack/types';
import type { LinkVerification } from '../../shared/pattern-verification.js';
import type { ConfoundData } from '../../shared/confound.js';
import type { DiscoveryCandidate } from './hypothesis-discovery.js';
import { INSIGHT_THRESHOLDS } from '../../shared/insight-thresholds.js';
import { credibleInterval } from '../../shared/bayesian-posterior.js';

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

/** 비율 → 정수 퍼센트 (자연어 본문용). "20%" */
const pct = (v: number): string => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

/** 효과크기 → "4.0배". 비유한 → "—" */
const mult = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(1)}배` : '—');

const formatPValue = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '—');

const formatPosterior = (v: number): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—';

/**
 * off-day 대조 자연어: 발현=분수(작은 표본을 정직하게 드러냄), 평소=비율(큰 baseline 표본 왜곡 없이).
 * effect 산출 불가(off일 0)면 배수 절(節) 생략.
 */
const offDayPhrase = (nActive: number, hit: number, rateOff: number, effect: number): string =>
  Number.isFinite(effect)
    ? `${nActive}일 중 ${hit}일 (평소 ${pct(rateOff)} → ${mult(effect)} 자주)`
    : `${nActive}일 중 ${hit}일 (평소 ${pct(rateOff)})`;

/** 확신도 보조 절: "확신도 78% [62%–89%]" — CI는 credibleInterval 재사용(표시 파생, 검증 로직 무관). */
const confidencePhrase = (alpha: number, beta: number, p: number): string => {
  const ci = credibleInterval(alpha, beta);
  const lo = formatPosterior(ci.lower);
  const hi = formatPosterior(ci.upper);
  return `확신도 ${formatPosterior(p)} [${lo}–${hi}]`;
};

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
  const stat = `${c.seedName} 켜진 날 *${c.signalName}* — ${offDayPhrase(c.nActive, c.hit, c.rateOff, c.effect)}`;
  const seedDesc = c.seedDescription?.trim() || c.seedName;
  const signalDesc = c.signalDescription?.trim() || c.signalName;
  const why =
    `_${seedDesc} → ${signalDesc}. ${c.seedName} 켜진 날 ${c.signalName}가 평소보다 자주 떠서 후보로 올렸어. ` +
    `아직 연관일 뿐 — 추적 시작하면 주간 엔진이 몇 주 검정해서 진짜인지 가려._`;
  const sub = `_발굴 근거 q ${formatPValue(c.qValue)} (느슨한 발견 기준 통과). 연관이지 인과 아님._`;
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${header}\n${stat}\n${why}\n${sub}` },
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
  '_본인 패턴일 가능성: 50%=우연, 80%↑=강함 · 괄호는 추정 범위(좁을수록 정확)_';

export const buildSeedInfluenceSection = (rows: SeedInfluenceRow[]): KnownBlock[] => {
  if (rows.length === 0) return [];
  const lines = rows.map((r) => {
    const kindLabel = KIND_LABEL[r.patternKind];
    const desc = (r.description ?? '').slice(0, 40);
    const verifyCount = r.totalHits + r.totalMisses;
    return (
      `• ${kindLabel} *${r.signalName}* (검증 ${verifyCount}개)` +
      (desc ? ` — ${desc}` : '') +
      ` — 본인 패턴일 가능성 ${formatPosterior(r.posteriorP)} ` +
      `(추정 ${formatPosterior(r.ciLower)}–${formatPosterior(r.ciUpper)})`
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

/** verified(검증됨) 한 줄 — 결론 위주(자연어 본문) + 이탤릭 보조 줄(확정 증거·우연 가능성·확신도). */
const verifiedLine = (l: LinkVerification): string =>
  `• ✅ ${KIND_LABEL[l.patternKind]} ${l.seedName} 켜진 날 *${l.signalName}* — ` +
  `${offDayPhrase(l.nActive, l.a, l.rateOff, l.effect)}. 검증됨\n` +
  `_확정 증거 e ${l.eValue.toFixed(1)} (20 넘어 확정) · 우연 가능성 q ${formatPValue(l.qValue)} · ` +
  `${confidencePhrase(l.posteriorAlpha, l.posteriorBeta, l.posteriorP)}_`;

/** emerging(검증중) 한 줄 — 진행도 강조(자연어 본문) + 이탤릭 보조 줄(확정까지 진행바·추세·우연·확신도). */
const emergingLine = (l: LinkVerification, prevE: number | undefined): string => {
  const bar = evalueBar(l.eValue, V.evalueThreshold);
  const cur = l.eValue;
  let trend = '';
  if (prevE !== undefined && Number.isFinite(prevE)) {
    if (cur > prevE) trend = ` (지난주 ${prevE.toFixed(1)} → 오르는 중)`;
    else if (cur < prevE) trend = ` (지난주 ${prevE.toFixed(1)} → 주춤)`;
    else trend = ` (지난주 ${prevE.toFixed(1)} → 그대로)`;
  }
  return (
    `• 🌱 ${KIND_LABEL[l.patternKind]} ${l.seedName} 켜진 날 *${l.signalName}* — ` +
    `${offDayPhrase(l.nActive, l.a, l.rateOff, l.effect)}. 검증중\n` +
    `_확정까지 ${bar} ${cur.toFixed(1)}/${V.evalueThreshold}${trend} · ` +
    `우연 가능성 q ${formatPValue(l.qValue)} · ` +
    `${confidencePhrase(l.posteriorAlpha, l.posteriorBeta, l.posteriorP)}_`
  );
};

const rejectLine = (l: LinkVerification): string =>
  `• ✗ ${KIND_LABEL[l.patternKind]} ${l.seedName} × ${l.signalName} — ` +
  `켜진 날이나 아닌 날이나 비슷 (${mult(l.effect)}). 기각`;

/**
 * 교란 caveat 한 줄(있으면) — P6 marginal 플래그(ADR-0041) → P7 다변량 조정(ADR-0042).
 * - adjusted 있음(게이트 통과·조정함): verdict별(explained_away 어부지리 / attenuated 약화 / survives 유지).
 * - adjusted 없음(게이트 미달): P6 marginal 공존 의심.
 * 조정 교란 이름은 suspected(seedName 보유)에서 seedId로 join. verified/emerging 라인에만 덧붙임.
 */
const confoundCaveat = (l: LinkVerification, confoundByLink: Map<number, ConfoundData>): string => {
  const data = confoundByLink.get(l.linkId);
  if (!data) return '';
  const { suspected, adjusted } = data;

  if (adjusted && adjusted.length > 0) {
    const nameById = new Map(suspected.map((s) => [s.seedId, s.seedName]));
    const uniq = [
      ...new Set(adjusted.map((a) => nameById.get(a.seedId) ?? `시드#${a.seedId}`)),
    ].join(', ');
    switch (adjusted[0]?.verdict) {
      case 'explained_away':
        return `\n  ⚠️ ${uniq} 시드가 같이 켜지는 날이 많아서, 그거 빼고 보면 효과 사라짐 (어부지리 의심)`;
      case 'attenuated':
        return `\n  ⚠️ ${uniq} 같이 켜지는 영향 빼면 효과 약해짐`;
      default:
        return `\n  · ${uniq} 같이 켜져도 효과 유지`;
    }
  }

  if (suspected.length === 0) return '';
  return `\n  ⚠️ ${suspected.map((s) => s.seedName).join(', ')}가 자주 같이 켜져서 영향 섞였을 수 있음`;
};

const TIER_LEGEND =
  '_✅ 검증됨 = 증거 충분해 확정(우연 아님, 단 연관이지 인과 아님) · ' +
  '🌱 검증중 = 경향은 보이나 확정 전(확정까지 진행도 표시) · ' +
  '✗ 기각 = 켜진 날이나 아닌 날이나 비슷 · ' +
  '⚠️ 교란 = 같이 켜지는 다른 시드 영향 의심_';

/**
 * 주간 검증 리포트 — 시드 영향력 + 3-tier 검증 현황(검증됨/검증중/기각).
 * 검증중(emerging)은 e-value 진행바로 "쌓이는 중"을 정직하게 프레이밍(ADR-0035). discovery는 P5.
 */
export const buildVerificationBlocks = (
  weekStart: string,
  links: LinkVerification[],
  seedInfluence: SeedInfluenceRow[],
  prevEValues: Map<number, number> = new Map(),
  confoundByLink: Map<number, ConfoundData> = new Map(),
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
        text: '_아직 검증할 가설이 없어 — 데이터가 더 쌓이면 자동으로 검증 시작해._',
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
      text: `*이번 주 패턴 검증 (가설 ${links.length}개)*\n${summaryParts.join(' · ')}`,
    },
  });

  if (verified.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: verified.map((l) => verifiedLine(l) + confoundCaveat(l, confoundByLink)).join('\n'),
      },
    });
  }

  if (emerging.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: emerging
          .map(
            (l) => emergingLine(l, prevEValues.get(l.linkId)) + confoundCaveat(l, confoundByLink),
          )
          .join('\n'),
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
