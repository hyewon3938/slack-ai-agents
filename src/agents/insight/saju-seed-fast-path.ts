/**
 * 사주 시드 토글 fast path.
 * 패턴 (약속된 단일 명령어, 자유언어 추출 금지):
 *   - "사주 시드 보기" → 활성 시드 + hit rate 목록
 *   - "사주 시드 끄기 N" → pattern_id=N active=false
 *   - "사주 시드 켜기 N" → pattern_id=N active=true
 *   - "사주 시드 모두 보기" → 비활성 포함 전체
 */

import type { SayFn } from '@slack/bolt';
import { query } from '../../shared/db.js';
import { sendMessage } from '../../shared/slack.js';

export const SAJU_SEED_LIST_RE = /^사주\s*시드\s*보기[.?!]?$/;
export const SAJU_SEED_LIST_ALL_RE = /^사주\s*시드\s*모두\s*보기[.?!]?$/;
export const SAJU_SEED_OFF_RE = /^사주\s*시드\s*끄기\s*#?(\d+)[.?!]?$/;
export const SAJU_SEED_ON_RE = /^사주\s*시드\s*켜기\s*#?(\d+)[.?!]?$/;

interface SeedRow {
  id: number;
  name: string;
  sipsin: string | null;
  active: boolean;
  hit_count: number;
  miss_count: number;
  inconclusive_count: number;
}

const formatSeedLine = (s: SeedRow): string => {
  const total = s.hit_count + s.miss_count;
  const rate = total > 0 ? `${Math.round((s.hit_count / total) * 100)}%` : '-';
  const sipsinPart = s.sipsin ? ` (${s.sipsin})` : '';
  const status = s.active ? '' : ' [OFF]';
  return `#${s.id} ${s.name}${sipsinPart} — hit ${s.hit_count}/${total} (${rate})${status}`;
};

const listSeeds = async (userId: number, includeInactive: boolean): Promise<string> => {
  const where = includeInactive ? 'user_id = $1' : 'user_id = $1 AND active = true';
  const result = await query<SeedRow>(
    `SELECT id, name, sipsin, active, hit_count, miss_count, inconclusive_count
     FROM pattern_catalog
     WHERE ${where}
     ORDER BY id`,
    [userId],
  );
  if (result.rows.length === 0) {
    return includeInactive ? '등록된 사주 시드가 없어.' : '활성 사주 시드가 없어.';
  }
  const header = includeInactive ? '*사주 시드 (전체)*' : '*사주 시드 (활성)*';
  return [header, ...result.rows.map(formatSeedLine)].join('\n');
};

const togglePattern = async (
  userId: number,
  patternId: number,
  active: boolean,
): Promise<string> => {
  const result = await query<{ id: number; name: string }>(
    `UPDATE pattern_catalog
     SET active = $3
     WHERE user_id = $1 AND id = $2
     RETURNING id, name`,
    [userId, patternId, active],
  );
  const row = result.rows[0];
  if (!row) return `#${patternId} 시드를 찾을 수 없어.`;
  const verb = active ? '켰어' : '껐어';
  return `#${row.id} ${row.name} ${verb}.`;
};

/**
 * 사주 시드 fast path 시도. 매칭 시 응답 전송 후 true 반환.
 */
export const trySajuSeedFastPath = async (
  trimmed: string,
  say: SayFn,
  userId: number,
): Promise<boolean> => {
  try {
    if (SAJU_SEED_LIST_RE.test(trimmed)) {
      await sendMessage(say, await listSeeds(userId, false));
      return true;
    }
    if (SAJU_SEED_LIST_ALL_RE.test(trimmed)) {
      await sendMessage(say, await listSeeds(userId, true));
      return true;
    }
    const offMatch = trimmed.match(SAJU_SEED_OFF_RE);
    if (offMatch) {
      await sendMessage(say, await togglePattern(userId, Number(offMatch[1]), false));
      return true;
    }
    const onMatch = trimmed.match(SAJU_SEED_ON_RE);
    if (onMatch) {
      await sendMessage(say, await togglePattern(userId, Number(onMatch[1]), true));
      return true;
    }
  } catch (error: unknown) {
    console.error('[Insight Agent] 사주 시드 fast path 오류:', error);
    await sendMessage(say, '사주 시드 처리 중 오류가 발생했어.');
    return true;
  }
  return false;
};
