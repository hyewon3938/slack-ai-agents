/**
 * LLM 자율 매트릭 후보 Block Kit 카드 빌더 — ADR-0025, ADR-0030.
 *
 * monthly-metric-suggest routine이 LLM 후보를 INSERT(`status='pending'`) 후
 * 후보별 1메시지 발송. 사용자가 [승인]/[거절] 버튼 클릭 → actions.ts 처리.
 */

import type { KnownBlock } from '@slack/types';

export const METRIC_APPROVE_ACTION_ID = 'metric_approve';
export const METRIC_REJECT_ACTION_ID = 'metric_reject';

const KIND_LABEL: Record<'saju' | 'life_signal', string> = {
  saju: '[사주]',
  life_signal: '[생활]',
};

export interface MetricApprovalPayload {
  metricId: number;
}

export const encodeMetricActionPayload = (payload: MetricApprovalPayload): string =>
  JSON.stringify(payload);

export const decodeMetricActionPayload = (raw: string): MetricApprovalPayload | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.metricId !== 'number' || !Number.isFinite(obj.metricId)) return null;
    return { metricId: obj.metricId };
  } catch {
    return null;
  }
};

export interface MetricCandidateCardInput {
  metricId: number;
  seedName: string;
  patternKind: 'saju' | 'life_signal';
  description: string;
  windowDays: number;
  /** LLM이 명시한 hit/miss 분류 기준 자연어 (예: "수면 ≤ 7시간이면 hit") */
  evaluationRule: string;
  /** evidence 누적 카운트 (참고용 표시) */
  evidenceCount: number;
  /** 재제안 시 LLM이 명시한 이전 거절 사유 대비 차이점. 신규 제안이면 null */
  rejectionDiff: string | null;
}

export const buildMetricCandidateCard = (input: MetricCandidateCardInput): KnownBlock[] => {
  const payload = encodeMetricActionPayload({ metricId: input.metricId });
  const kindLabel = KIND_LABEL[input.patternKind];
  const header = `${kindLabel} *${input.seedName}* — 매트릭 제안`;
  const detailLines = [
    `_${input.description}_`,
    `평가 기준: ${input.evaluationRule}`,
    `window: 최근 ${input.windowDays}일 · evidence 누적 ${input.evidenceCount}일`,
  ];
  if (input.rejectionDiff) {
    detailLines.push(`재제안 사유: ${input.rejectionDiff}`);
  }
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${header}\n${detailLines.join('\n')}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '승인' },
          style: 'primary',
          action_id: METRIC_APPROVE_ACTION_ID,
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '거절' },
          action_id: METRIC_REJECT_ACTION_ID,
          value: payload,
        },
      ],
    },
  ];
};

/** 후보 0건일 때 발사 메시지 */
export const buildNoSuggestionMessage = (yyyymm: string): KnownBlock[] => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `_${yyyymm} 매트릭 제안 없음. 다음 달 누적 데이터로 재시도._`,
    },
  },
];
