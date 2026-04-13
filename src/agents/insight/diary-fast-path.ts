/**
 * Insight 에이전트 — 일기 fast path.
 * LLM 없이 직접 DB에 저장하고 랜덤 확인 문구를 반환.
 * 밤 크론에서 하루 일기를 한 번에 LLM으로 리뷰하는 구조로 전환.
 */

import { query } from '../../shared/db.js';
import { getTodayISO } from '../../shared/kst.js';

// ─── 확인 문구 (랜덤 + 최근 5개 중복 방지) ──────────────

const DIARY_CONFIRMATIONS = [
  '적어뒀어.',
  '기록 완료.',
  '남겨뒀어, 오늘 밤에 같이 돌아보자.',
  '오늘 일기에 추가했어.',
  '잘 들었어, 적어둘게.',
  '메모해뒀어.',
  '기억해둘게.',
  '써뒀어. 오늘 밤에 같이 정리하자.',
  '알겠어, 기록해둘게.',
  '마음에 담아뒀어.',
  '적어둔다.',
  '오늘 하루에 하나 더 추가.',
  '일기장에 넣어뒀어.',
  '듣고 있어, 적어둘게.',
  '기록했어. 더 하고 싶은 말 있으면 편하게.',
  '알았어, 남겨둘게.',
  '챙겨뒀어.',
  '수첩에 적었어.',
  '오늘 기록에 추가 완료.',
  '잘 들었어.',
] as const;

const recentIndices: number[] = [];

export const pickDiaryConfirmation = (): string => {
  const available = DIARY_CONFIRMATIONS.map((_, i) => i).filter(
    (i) => !recentIndices.includes(i),
  );
  // 전부 최근에 쓴 경우(문구 수 < 5) 전체에서 선택
  const pool = available.length > 0 ? available : DIARY_CONFIRMATIONS.map((_, i) => i);
  const idx = pool[Math.floor(Math.random() * pool.length)] ?? 0;
  recentIndices.push(idx);
  if (recentIndices.length > 5) recentIndices.shift();
  return DIARY_CONFIRMATIONS[idx] ?? DIARY_CONFIRMATIONS[0];
};

// ─── 명령 패턴 감지 ──────────────────────────────────────

/**
 * LLM 에이전트 루프가 필요한 명령 패턴.
 * 매칭되면 일기 fast path를 건너뛰고 LLM으로 전달.
 */
export const INSIGHT_COMMAND_RE =
  /(?:테마|프로필|패턴|원국|격국|용신|사주|대운|일기\s*(?:보여|읽어|확인|분석|삭제)|분석|해석|설명\s*해|알려\s*줘|뭐야|어떻게\s*(?:봐|생각|돼|되는)|어때|삭제|추가해\s*줘)/;

// ─── DB 저장 ─────────────────────────────────────────────

/**
 * 일기 내용을 diary_entries에 저장 (같은 날 기록이 있으면 append).
 * 사용자 원문을 그대로 저장 (LLM 정제 없음).
 */
export const saveDiaryEntry = async (
  userId: number,
  content: string,
): Promise<void> => {
  const date = getTodayISO();

  const existing = await query<{ id: number }>(
    `SELECT id FROM diary_entries WHERE user_id = $1 AND date = $2 LIMIT 1`,
    [userId, date],
  );

  if (existing.rows.length > 0) {
    await query(
      `UPDATE diary_entries
       SET content = content || E'\\n' || $1, updated_at = NOW()
       WHERE user_id = $2 AND date = $3`,
      [content, userId, date],
    );
  } else {
    await query(
      `INSERT INTO diary_entries (user_id, date, content) VALUES ($1, $2, $3)`,
      [userId, date, content],
    );
  }
};
