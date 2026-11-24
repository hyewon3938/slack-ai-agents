/**
 * 수면 요약 블록.
 */

import type { KnownBlock } from '@slack/types';
import type { SleepRecordRow, SleepEventRow } from '../../../shared/life/queries-sleep.js';
import { formatDuration } from '../../../shared/kst.js';

// ─── 수면 블록 ──────────────────────────────────────────

/** 낮잠 라벨 판별: bedtime < 12:00이면 아침잠 (밤잠 연장) */
const napLabel = (bedtime: string | null): string =>
  bedtime != null && bedtime < '12:00' ? '아침잠' : '낮잠';

/** 수면 요약 Block Kit (밤잠 + 아침잠/낮잠 + 메모 + 중간 기상 + 총합) */
export const buildSleepBlocks = (
  records: SleepRecordRow[],
  events?: SleepEventRow[],
): KnownBlock[] => {
  if (records.length === 0) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: '*수면*\n기록 없음' } }];
  }

  const lines = records.map((r) => {
    const label = r.sleep_type === 'night' ? '밤잠' : napLabel(r.bedtime);
    if (r.bedtime == null || r.wake_time == null || r.duration_minutes == null) {
      return `${label}  (시간 미기록)`;
    }
    const duration = formatDuration(r.duration_minutes);
    return `${label}  ${r.bedtime} → ${r.wake_time} (${duration})`;
  });

  // 총 수면시간 (2건 이상일 때만)
  const totalMinutes = records.reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0);
  if (records.length > 1 && totalMinutes > 0) {
    lines.push(`*총 ${formatDuration(totalMinutes)}*`);
  }

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*수면*\n${lines.join('\n')}` },
    },
  ];

  // 수면 메모 (context)
  const memos = records.map((r) => r.memo).filter((m): m is string => m != null);
  if (memos.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: memos.join('\n') }],
    });
  }

  // 중간 기상 이벤트
  if (events && events.length > 0) {
    const eventTexts = events.map((e) => (e.memo ? `${e.event_time} ${e.memo}` : e.event_time));
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `중간 기상: ${eventTexts.join(', ')}` }],
    });
  }

  return blocks;
};
