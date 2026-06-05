/**
 * 검증 Block Kit 카드 빌더 — #477 P2 (주간 검증 리포트) + 가설 등록 액션 scaffolding(P5).
 *
 * - 주간 검증 리포트: 시드 영향력 top 5 + off-day 검증 현황(provisional confirm / reject)
 * - 등록/반려 액션 상수 + payload encode/decode는 P5 승인 게이트가 재사용(현재 dormant).
 */

import type { KnownBlock } from '@slack/types';
import type { LinkVerification, Verdict } from '../../shared/pattern-verification.js';
import type { TriggerSpec } from './hypothesis-discovery.js';

export const HYPOTHESIS_REGISTER_ACTION_ID = 'hypothesis_register';
export const HYPOTHESIS_DISMISS_ACTION_ID = 'hypothesis_dismiss';

const KIND_LABEL: Record<'saju' | 'life_signal', string> = {
  saju: '[사주]',
  life_signal: '[생활]',
};

/** Slack action value 직렬화 — JSON 한도(2000자) 안전. P5 등록 버튼 scaffolding(현재 dormant). */
export interface HypothesisActionPayload {
  triggerSpec: TriggerSpec;
  enumTarget: string;
}

export const encodeActionPayload = (payload: HypothesisActionPayload): string =>
  JSON.stringify(payload);

export const decodeActionPayload = (raw: string): HypothesisActionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const ts = obj.triggerSpec;
    const en = obj.enumTarget;
    if (
      !ts ||
      typeof ts !== 'object' ||
      typeof (ts as { type?: unknown }).type !== 'string' ||
      typeof en !== 'string'
    ) {
      return null;
    }
    return parsed as HypothesisActionPayload;
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

// ─── off-day 검증 현황 섹션 ──────────────────────────────

const VERDICT_LABEL: Record<Verdict, string> = {
  confirm: '확정(provisional)',
  reject: '기각',
  inconclusive: '판정 보류',
  insufficient: '데이터 부족',
};

const countByVerdict = (links: LinkVerification[]): Record<Verdict, number> => {
  const counts: Record<Verdict, number> = {
    confirm: 0,
    reject: 0,
    inconclusive: 0,
    insufficient: 0,
  };
  for (const l of links) counts[l.verdict] += 1;
  return counts;
};

/** provisional confirm 한 줄 — off-day 대조 결과 + 사후. */
const confirmLine = (l: LinkVerification): string => {
  const kindLabel = KIND_LABEL[l.patternKind];
  return (
    `• ★ ${kindLabel} *${l.signalName}* → \`${l.seedName}\` — ` +
    `발현 ${formatPercent(l.rateActive)} vs 비발현 ${formatPercent(l.rateOff)} ` +
    `(effect ${formatRatio(l.effect)}, q=${formatPValue(l.qValue)}, n=${l.nActive}) · ` +
    `사후 ${formatPosterior(l.posteriorP)}`
  );
};

const rejectLine = (l: LinkVerification): string =>
  `• ✗ ${KIND_LABEL[l.patternKind]} ${l.signalName} × \`${l.seedName}\` — 연관 약함(effect ${formatRatio(l.effect)})`;

const PROVISIONAL_LEGEND =
  '_★ provisional — 주간 q는 optional stopping이라 통계 확정 게이트(e-value)는 P3. 지금은 경향 모니터링용._';

/**
 * 주간 검증 리포트 — 시드 영향력 + off-day 검증 현황(confirm/reject 목록 + 요약).
 * discovery 후보·주간 delta는 없음(P5/P3). provisional confirm은 노출 단언 아님(카드 모니터링용).
 */
export const buildVerificationBlocks = (
  weekStart: string,
  links: LinkVerification[],
  seedInfluence: SeedInfluenceRow[],
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

  const counts = countByVerdict(links);
  const summary =
    `*이번 주 off-day 검증 (${links.length}개 링크)*\n` +
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([verdict, n]) => `${VERDICT_LABEL[verdict as Verdict]} ${n}`)
      .join(' · ');
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: summary } });

  const confirms = links.filter((l) => l.verdict === 'confirm');
  if (confirms.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: confirms.map(confirmLine).join('\n') },
    });
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: PROVISIONAL_LEGEND }] });
  }

  const rejects = links.filter((l) => l.verdict === 'reject');
  if (rejects.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: rejects.map(rejectLine).join('\n') },
    });
  }

  return blocks;
};
