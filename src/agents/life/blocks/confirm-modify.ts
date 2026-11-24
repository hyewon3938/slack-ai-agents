/**
 * 대량 변경 확인 카드 블록.
 */

import type { KnownBlock } from '@slack/types';
import type { AffectedRow } from '../../../shared/pending-display.js';
import { formatAffectedRows } from '../../../shared/pending-display.js';
import {
  CONFIRM_MODIFY_EXECUTE_ACTION_ID,
  CONFIRM_MODIFY_CANCEL_ACTION_ID,
  CONFIRM_ROW_LIMIT,
} from './constants.js';

// ─── 대량 변경 확인 카드 ────────────────────────────────

/**
 * modify_db 확인 카드. SQL 대신 영향받을 row 이름 리스트를 보여준다.
 * - 최대 20개까지 노출, 초과 시 "외 N개 더"
 * - DELETE/UPDATE별로 "삭제"/"변경" 어휘 분기
 */
export const buildConfirmModifyCard = (params: {
  token: string;
  tableName: string | null;
  rows: AffectedRow[];
  rowCount: number;
  operation: 'DELETE' | 'UPDATE';
}): { text: string; blocks: KnownBlock[] } => {
  const actionLabel = params.operation === 'DELETE' ? '삭제' : '변경';
  const headerText = `*⚠️ 확인 필요* — 이 *${params.rowCount}개*가 ${actionLabel}될 예정이야. 진짜 실행할까?`;

  const blocks: KnownBlock[] = [{ type: 'section', text: { type: 'mrkdwn', text: headerText } }];

  const groups = params.tableName
    ? formatAffectedRows(params.tableName, params.rows.slice(0, CONFIRM_ROW_LIMIT))
    : [{ header: null, items: [] }];

  for (const group of groups) {
    const lines: string[] = [];
    if (group.header) lines.push(`*[${group.header}]*`);
    for (const item of group.items) lines.push(`• ${item}`);
    if (lines.length === 0) continue;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    });
  }

  if (params.rowCount > CONFIRM_ROW_LIMIT) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_외 ${params.rowCount - CONFIRM_ROW_LIMIT}개 더_` }],
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '실행', emoji: true },
        action_id: CONFIRM_MODIFY_EXECUTE_ACTION_ID,
        value: params.token,
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '취소', emoji: true },
        action_id: CONFIRM_MODIFY_CANCEL_ACTION_ID,
        value: params.token,
        style: 'danger',
      },
    ],
  });

  return {
    text: `${params.rowCount}개 행이 ${actionLabel}될 예정이야. 확인해줘.`,
    blocks,
  };
};
