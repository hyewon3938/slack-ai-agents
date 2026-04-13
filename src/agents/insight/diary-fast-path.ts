/**
 * Insight 에이전트 — 일기 fast path.
 * LLM 없이 직접 DB에 저장하고 랜덤 확인 문구를 반환.
 * 밤 크론에서 하루 일기를 한 번에 LLM으로 리뷰하는 구조로 전환.
 */

import { query } from '../../shared/db.js';
import { getTodayISO } from '../../shared/kst.js';

/** 응답 전 자연스러운 딜레이 (1~2초 랜덤) */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const naturalDelay = (): Promise<void> => sleep(1000 + Math.random() * 1000);

// ─── 확인 문구 (랜덤 + 최근 5개 중복 방지) ──────────────

const DIARY_CONFIRMATIONS = [
  '적어뒀어. 오늘 밤에 같이 돌아보자.',
  '오늘 일기에 추가해뒀어. 더 생각나는 거 있으면 편하게 말해.',
  '잘 들었어. 기록해둘게, 나중에 밤에 정리하자.',
  '일기장에 남겨뒀어. 오늘 하루 어떤 날이었는지 밤에 같이 얘기하자.',
  '알겠어, 꼼꼼히 적어둘게. 더 하고 싶은 말 있으면 언제든.',
  '기억해둘게. 밤에 오늘 하루 돌아볼 때 같이 보자.',
  '써뒀어. 오늘 기분이 어떤지도 나중에 얘기해줘.',
  '마음에 담아뒀어. 밤에 천천히 같이 정리하자.',
  '기록해뒀어. 하루가 끝나고 다시 읽어보면 또 다를 거야.',
  '남겨뒀어. 오늘 하루 수고하고 있어.',
  '오늘 일기에 하나 더 추가했어. 편하게 계속 남겨줘.',
  '듣고 있어. 적어둘게, 밤에 같이 돌아보자.',
  '챙겨뒀어. 나중에 오늘 일기 모아서 같이 보자.',
  '적어둔다. 생각나는 대로 더 남겨도 돼.',
  '알았어, 기록 완료. 밤에 오늘 하루 정리할 때 같이 보자.',
  '잘 들었어. 이런 거 남겨두면 나중에 보면 좋더라.',
  '기록했어. 오늘 하루도 잘 보내고 있네.',
  '수첩에 적었어. 밤에 오늘 일기 같이 읽어보자.',
  '메모해뒀어. 더 떠오르면 편하게 말해줘.',
  '남겨둘게. 오늘 밤에 이 이야기 다시 꺼내자.',
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
