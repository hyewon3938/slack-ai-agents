/**
 * 가설 Block Kit 카드 빌더 — ADR-0019 Phase 4.
 *
 * - 후보 카드 (discovery → 등록/패스 액션)
 * - 주간 리뷰 묶음 (active 가설 stat 변화 + 신규 후보)
 */

import type { KnownBlock } from '@slack/types';
import type { CandidateHypothesis } from './hypothesis-discovery.js';
import type { Hypothesis, HypothesisStat, TriggerSpec } from '../../shared/saju-hypothesis.js';

export const HYPOTHESIS_REGISTER_ACTION_ID = 'hypothesis_register';
export const HYPOTHESIS_DISMISS_ACTION_ID = 'hypothesis_dismiss';

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

/** 단일 후보 카드 — 등록/패스 버튼 포함 */
export const buildCandidateCard = (cand: CandidateHypothesis): KnownBlock[] => {
  const payload = encodeActionPayload({
    triggerSpec: cand.triggerSpec,
    enumTarget: cand.enumTarget,
  });
  const header = `*${cand.signalName}* → \`${cand.enumTarget}\``;
  const detail =
    `발현일 n=${cand.nTriggerDays} · trigger ${formatPercent(cand.rateTrigger)} ` +
    `vs baseline ${formatPercent(cand.rateBaseline)} ` +
    `· ratio ${formatRatio(cand.rateRatio)}x ` +
    `· p=${formatPValue(cand.rawP)} q=${formatPValue(cand.fdrQ)}`;

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${header}\n${detail}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '가설 등록' },
          style: 'primary',
          action_id: HYPOTHESIS_REGISTER_ACTION_ID,
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '이번엔 패스' },
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
  latest: HypothesisStat;
  prev: HypothesisStat | null;
}

/** 주간 리뷰 묶음 — active 가설 표 + 신규 후보 카드 */
export const buildWeeklyReviewBlocks = (
  active: ActiveHypothesisRow[],
  candidates: CandidateHypothesis[],
  weekStart: string,
): KnownBlock[] => {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `가설 주간 리포트 (${weekStart} ~)` },
    },
  ];

  if (active.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_active 가설 없음 — 아래 후보에서 골라 등록해._' },
    });
  } else {
    const lines = active.map((row) => {
      const prev = row.prev;
      const trigArrow = arrow(row.latest.rateTrigger, prev?.rateTrigger ?? null);
      const qArrow = arrow(row.latest.fdrQ, prev?.fdrQ ?? null);
      return (
        `• *${row.signalName}* → \`${row.hypothesis.enumTarget}\` — ` +
        `n=${row.latest.nTriggerDays} ` +
        `trig ${formatPercent(row.latest.rateTrigger)} ${trigArrow} ` +
        `ratio ${formatRatio(row.latest.rateRatio)}x ` +
        `q=${formatPValue(row.latest.fdrQ)} ${qArrow}`
      );
    });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*active 가설 (${active.length}건)*\n${lines.join('\n')}` },
    });
  }

  if (candidates.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*신규 후보 (${candidates.length}건)* — 등록할 거 골라`,
      },
    });
    for (const cand of candidates.slice(0, 5)) {
      blocks.push(...buildCandidateCard(cand));
    }
  }

  return blocks;
};
