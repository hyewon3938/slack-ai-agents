/**
 * 가설 Block Kit 카드 빌더 — ADR-0019 Phase 4 + Phase 7 Bayesian 병기.
 *
 * - 후보 카드 (discovery → 승인/반려 액션)
 * - 주간 리뷰 묶음 (시드 영향력 top 5 + active 가설 stat 변화 + 신규 후보)
 */

import type { KnownBlock } from '@slack/types';
import type { CandidateHypothesis } from './hypothesis-discovery.js';
import type { Hypothesis, HypothesisStat, TriggerSpec } from '../../shared/pattern-hypothesis.js';

export const HYPOTHESIS_REGISTER_ACTION_ID = 'hypothesis_register';
export const HYPOTHESIS_DISMISS_ACTION_ID = 'hypothesis_dismiss';

const KIND_LABEL: Record<'saju' | 'life_signal', string> = {
  saju: '[사주]',
  life_signal: '[생활]',
};

const CANDIDATE_CAP_PER_KIND = 5;

/** Slack action value 직렬화 — JSON 한도(2000자) 안전 */
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

const arrow = (latest: number, prev: number | null): string => {
  if (prev === null || !Number.isFinite(prev) || !Number.isFinite(latest)) return '─';
  if (latest > prev * 1.1) return '▲';
  if (latest < prev * 0.9) return '▼';
  return '─';
};

const formatPercent = (v: number): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';

const formatRatio = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : '—');

const formatPValue = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '—');

const formatPosterior = (v: number): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—';

/** 단일 후보 카드 — 승인/반려 버튼 포함 */
export const buildCandidateCard = (cand: CandidateHypothesis): KnownBlock[] => {
  const payload = encodeActionPayload({
    triggerSpec: cand.triggerSpec,
    enumTarget: cand.enumTarget,
  });
  const kindLabel = KIND_LABEL[cand.patternKind];
  const header = `${kindLabel} *${cand.signalName}* → \`${cand.enumTarget}\``;
  const freqLine =
    `발현일 n=${cand.nTriggerDays} · trigger ${formatPercent(cand.rateTrigger)} ` +
    `vs baseline ${formatPercent(cand.rateBaseline)} ` +
    `· ratio ${formatRatio(cand.rateRatio)}x`;
  const bayesLine =
    `p=${formatPValue(cand.rawP)} q=${formatPValue(cand.fdrQ)} · ` +
    `사후 ${formatPosterior(cand.posteriorP)} ` +
    `[${formatPosterior(cand.ciLower)}, ${formatPosterior(cand.ciUpper)}]`;

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${header}\n${freqLine}\n${bayesLine}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '가설 승인' },
          style: 'primary',
          action_id: HYPOTHESIS_REGISTER_ACTION_ID,
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '가설 반려' },
          action_id: HYPOTHESIS_DISMISS_ACTION_ID,
          value: payload,
        },
      ],
    },
  ];
};

export interface ActiveHypothesisRow {
  hypothesis: Hypothesis;
  signalName: string;
  patternKind: 'saju' | 'life_signal';
  latest: HypothesisStat;
  prev: HypothesisStat | null;
}

/** 시드 영향력 섹션 — 주간 리뷰 상단. credible interval lower bound 정렬. */
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

/** 주간 리뷰 묶음 — 시드 영향력 + active 가설 표 + 신규 후보 카드 */
export const buildWeeklyReviewBlocks = (
  active: ActiveHypothesisRow[],
  candidates: CandidateHypothesis[],
  weekStart: string,
  seedInfluence: SeedInfluenceRow[],
): KnownBlock[] => {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `가설 주간 리포트 (${weekStart} ~)` },
    },
  ];

  blocks.push(...buildSeedInfluenceSection(seedInfluence));

  if (active.length === 0) {
    const noActiveText =
      candidates.length === 0
        ? '_active 가설 없음 — 신규 후보도 아직 없어. 데이터 더 쌓이면 자동으로 떠올거야._'
        : '_active 가설 없음 — 아래 후보에서 골라 승인해._';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: noActiveText },
    });
  } else {
    const lines = active.map((row) => {
      const prev = row.prev;
      const trigArrow = arrow(row.latest.rateTrigger, prev?.rateTrigger ?? null);
      const qArrow = arrow(row.latest.fdrQ, prev?.fdrQ ?? null);
      const kindLabel = KIND_LABEL[row.patternKind];
      const head =
        `• ${kindLabel} *${row.signalName}* → \`${row.hypothesis.enumTarget}\` — ` +
        `n=${row.latest.nTriggerDays} ` +
        `trig ${formatPercent(row.latest.rateTrigger)} ${trigArrow} ` +
        `ratio ${formatRatio(row.latest.rateRatio)}x ` +
        `q=${formatPValue(row.latest.fdrQ)} ${qArrow}`;
      const post =
        `   사후 ${formatPosterior(row.latest.posteriorP)} ` +
        `[${formatPosterior(row.latest.ciLower)}, ${formatPosterior(row.latest.ciUpper)}]`;
      return `${head}\n${post}`;
    });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*active 가설 (${active.length}건)*\n${lines.join('\n')}` },
    });
  }

  const sajuCands = candidates
    .filter((c) => c.patternKind === 'saju')
    .slice(0, CANDIDATE_CAP_PER_KIND);
  const lifeCands = candidates
    .filter((c) => c.patternKind === 'life_signal')
    .slice(0, CANDIDATE_CAP_PER_KIND);

  if (sajuCands.length + lifeCands.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*신규 후보 (사주 ${sajuCands.length} / 생활 ${lifeCands.length})* — 승인할 거 골라`,
      },
    });
    for (const cand of sajuCands) blocks.push(...buildCandidateCard(cand));
    for (const cand of lifeCands) blocks.push(...buildCandidateCard(cand));
  }

  return blocks;
};
