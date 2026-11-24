import type { Insight } from '../../shared/insights/types.js';
import { formatDateShort, formatDuration } from '../../shared/kst.js';
import type { KnownBlock } from '@slack/types';
import type { SajuOutcomeData, WeeklyReportData } from './types.js';

// ─── Block Kit 빌드 ─────────────────────────────────────

/** 주간 리포트 Block Kit 빌드: 인사이트 우선 → 한눈에 보기 → 총평. */
export const buildWeeklyReportBlocks = (
  data: WeeklyReportData,
  insights: Insight[],
  summary: string,
): KnownBlock[] => {
  const { sleep, routine, schedule, weekStart, weekEnd } = data;
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `지난주 리포트 (${formatDateShort(weekStart)} ~ ${formatDateShort(weekEnd)})`,
      emoji: false,
    },
  });

  // ── 인사이트 ──
  blocks.push({ type: 'divider' });
  if (insights.length > 0) {
    const lines = ['*이번 주 인사이트*', ...insights.map((i) => `• ${i.message}`)];
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '이번 주는 특별한 패턴 없이 잔잔했어' },
    });
  }

  // ── 한눈에 보기 (집계 압축) ──
  blocks.push({ type: 'divider' });
  const glance: string[] = ['*한눈에 보기*'];
  if (sleep.recordCount >= 2) {
    glance.push(`수면 평균 ${formatDuration(sleep.avgDuration)} (${sleep.recordCount}일 기록)`);
  }
  if (routine.thisWeekTotal >= 2) {
    const lastPart = routine.lastWeekRate != null ? ` (지난주 ${routine.lastWeekRate}%)` : '';
    glance.push(`루틴 달성률 ${routine.thisWeekRate}%${lastPart}`);
  }
  if (schedule.completedCount + schedule.incompleteCount >= 2) {
    glance.push(`일정 완료 ${schedule.completedCount}건 / 미완료 ${schedule.incompleteCount}건`);
  }
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: glance.join('\n') } });

  // ── 사주 시드 outcome ──
  const sajuLines = buildSajuOutcomeLines(data.saju);
  if (sajuLines) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: sajuLines } });
  }

  // ── 총평 ──
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*총평*\n${summary}` } });

  return blocks;
};

/** 사주 시드 outcome 블록 텍스트 — 누적 hit/miss + 약화 후보. */
const buildSajuOutcomeLines = (saju: SajuOutcomeData): string | null => {
  const active = saju.seeds.filter((s) => s.hit + s.miss > 0);
  if (active.length === 0) return null;

  const lines = ['*사주 시드 outcome*'];
  // 누적 많은 순으로 상위 5개만 표시 (이미 정렬됨)
  for (const s of active.slice(0, 5)) {
    const total = s.hit + s.miss;
    const rate = s.hitRate !== null ? `${Math.round(s.hitRate * 100)}%` : '-';
    const label = s.description ?? s.name;
    lines.push(`• ${label} — hit ${s.hit}/${total} (${rate})`);
  }

  if (saju.weakCandidates.length > 0) {
    const names = saju.weakCandidates.map((s) => s.name).join(', ');
    lines.push(`\n약화 후보: ${names} — \`사주 시드 끄기\` 명령어로 비활성화 가능`);
  }

  return lines.join('\n');
};
