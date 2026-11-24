/** 기간 해석 — Slack 블록 결정론 렌더(cron·fast path 공용). */

import type { KnownBlock } from '@slack/types';
import type {
  PeriodInterpretationRecord,
  ForecastSourceCell,
  NoCallReason,
  LedgerCardData,
} from './types.js';
import {
  DOMAIN_LABEL,
  PERIOD_LABEL,
  LADDER_STATUS,
  TRANSFER_HEDGE,
} from './interpretation-labels.js';

// ─── D. renderInterpretationBlocks (결정론 렌더 — cron·fast path 공용) ──

const rangeText = (start: string, end: string | null): string =>
  end ? `${start} ~ ${end}` : `${start} ~`;

const section = (text: string): KnownBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});

// ─── 장부 섹션(Phase 3) — ledger는 caller(cron/fast path)가 주입. 데이터는 period-forecast.ts. ──

const TIER_LABEL_SHORT: Record<string, string> = {
  verified: '검증됨',
  emerging: '탐색적·검증중',
};
const DIR_ARROW: Record<string, string> = { up: '↑', down: '↓' };

/** delta → 부호 강조 %p. 원 pass율(baseline/measured)은 비노출 — §9 보안(delta 부호·크기만). */
const fmtDelta = (delta: number | null): string => {
  if (delta === null) return '';
  const pp = Math.round(delta * 100);
  const sign = pp > 0 ? '+' : pp < 0 ? '-' : '±';
  return ` _(실측 *${sign}${Math.abs(pp)}%p*)_`;
};

const cellLabel = (cell: ForecastSourceCell): string =>
  `${DOMAIN_LABEL[cell.domain] ?? cell.domain} — *${cell.axisKey}*`;

/**
 * 예측 장부 섹션 — 지난 기간 채점 결과 + 이번 기간 예측. baseline 원수치 비노출(delta·tier만, §9).
 * no_call도 '예측 안 함' 명시(D8 — 침묵 금지). scored 비면(첫 기간) 생략, forecasts는 generate가 항상 ≥1 보장.
 */
const renderLedgerBlocks = (ledger: LedgerCardData): KnownBlock[] => {
  const blocks: KnownBlock[] = [];

  if (ledger.scored.length > 0) {
    const lines = ledger.scored.map((s) => {
      const dir = s.predictedDirection ? DIR_ARROW[s.predictedDirection] : '';
      if (s.status === 'unmeasurable') {
        return `• ${cellLabel(s.sourceCell)} 측정불가 _(예측 ${dir}, 데이터 부족)_`;
      }
      const hit = s.directionHit ? '적중' : '빗나감';
      return `• ${cellLabel(s.sourceCell)} *${hit}* _(예측 ${dir})_${fmtDelta(s.measuredDelta)}`;
    });
    blocks.push(section(`*지난 기간 장부 결과*\n${lines.join('\n')}`));
  }

  const openLines: string[] = [];
  const noCallLines: string[] = [];
  for (const f of ledger.forecasts) {
    if (f.status === 'no_call' || 'reason' in f.sourceCell) {
      noCallLines.push(`예측 안 함 — ${(f.sourceCell as NoCallReason).reason}`);
      continue;
    }
    const cell = f.sourceCell as ForecastSourceCell;
    const dir = f.predictedDirection ? DIR_ARROW[f.predictedDirection] : '';
    const tier = TIER_LABEL_SHORT[cell.tier] ?? cell.tier;
    openLines.push(`• ${cellLabel(cell)} ${dir} _(근거: ${tier})_`);
  }
  const body =
    openLines.length > 0 ? openLines.join('\n') : noCallLines.map((l) => `• ${l}`).join('\n');
  blocks.push(section(`*이번 기간 예측* _(다음 전환 때 채점)_\n${body}`));

  return blocks;
};

/**
 * 저장된 해석 → Block Kit 카드(결정론). cron·fast path 공용.
 * measuredCells=0 케이스도 일급 경로(D8) — 빈 카드 금지, 교과서+누적기록으로 채운다.
 * ledger(Phase 3): 있으면 사다리 footer 앞에 예측 장부 섹션 삽입(wolun/seun만 주입, daeun은 undefined).
 */
export const renderInterpretationBlocks = (
  record: PeriodInterpretationRecord,
  ledger?: LedgerCardData,
): KnownBlock[] => {
  const { payload, periodType } = record;
  const blocks: KnownBlock[] = [];

  blocks.push(
    section(
      `*${PERIOD_LABEL[periodType]}* — *${record.pillar}* _(${rangeText(record.periodStart, record.periodEnd)})_`,
    ),
  );

  // 측정된 반응 (D8: 0이어도 명시)
  if (payload.measuredCells.length > 0) {
    const lines = payload.measuredCells.map((m) => {
      const tierLabel = m.tier === 'verified' ? '검증됨' : '탐색적·검증중';
      return `• ${DOMAIN_LABEL[m.domain] ?? m.domain} — *${m.axisKey}* 반응 _(${tierLabel}, ${m.nActiveDays}일)_`;
    });
    blocks.push(section(`*측정된 너의 반응*\n${lines.join('\n')}`));
  } else {
    blocks.push(section('*측정된 너의 반응* — 아직 없어. 아래는 교과서 일반론과 누적 기록이야.'));
  }

  // 교과서 일반론 (미검증 라벨)
  if (payload.textbookCells.length > 0) {
    const lines = payload.textbookCells.map((t) => `• ${t.label}: ${t.gloss}`);
    blocks.push(section(`*교과서 일반론* _(아직 네 데이터로는 검증 안 됨)_\n${lines.join('\n')}`));
  }

  // 누적 기술통계
  const d = payload.descriptiveStats;
  const statLines: string[] = [];
  if (d.sleep) statLines.push(`• 평균 수면 ${d.sleep.avgDuration}분 (${d.sleep.recordCount}일)`);
  if (d.routine) statLines.push(`• 루틴 완료율 ${d.routine.rate}% (${d.routine.total}건)`);
  if (d.diary) statLines.push(`• 일기 ${d.diary.count}건`);
  const statBody = statLines.length > 0 ? statLines.join('\n') : '• 비교할 기록이 거의 없어';
  blocks.push(section(`*누적 기록* _(${d.scope})_\n${statBody}`));

  // 서사 (LLM 동결)
  if (record.narrative.trim().length > 0) blocks.push(section(record.narrative));

  // 예측 장부 섹션 (Phase 3) — wolun/seun에만 주입됨
  if (ledger) blocks.push(...renderLedgerBlocks(ledger));

  // 사다리 지위 + 전이 가설 (context)
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `※ ${LADDER_STATUS[periodType]}.` },
      { type: 'mrkdwn', text: `※ ${TRANSFER_HEDGE}.` },
    ],
  });

  return blocks;
};
