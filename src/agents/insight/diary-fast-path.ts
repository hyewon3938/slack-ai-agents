/**
 * Insight 에이전트 — 일기 fast path.
 * LLM 없이 직접 DB에 저장하고 랜덤 확인 문구를 반환.
 * 밤 크론에서 하루 일기를 한 번에 LLM으로 리뷰하는 구조로 전환.
 */

import { query } from '../../shared/db.js';
import { getEffectiveTodayISO, formatDateShort } from '../../shared/kst.js';
import { createDiaryMetaLLMClient } from '../../shared/llm.js';
import { extractAndPersistForUser } from '../../cron/diary-meta-extract.js';

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

// ─── 날짜 접두 (지난 날짜 일기) ──────────────────────────

/** 맨 앞 "M/D" + 공백·줄바꿈 + 본문. 예: "10/21 산책했다" */
const DATED_PREFIX_RE = /^(\d{1,2})\/(\d{1,2})(?:\s+([\s\S]*))?$/;

export type DatedDiaryParse =
  | { kind: 'none' }
  | { kind: 'dated'; date: string; content: string }
  | { kind: 'invalid_date'; token: string }
  | { kind: 'no_content' };

/**
 * M/D를 오늘(포함) 이전의 가장 가까운 날짜로 해석.
 * 올해의 M/D가 오늘보다 뒤면 작년으로 본다 — 미래 날짜는 나올 수 없다.
 * 존재하지 않는 날짜(13/1, 2/30 등)는 null.
 */
export const resolveDiaryDate = (month: number, day: number, todayISO: string): string | null => {
  const [todayYear, todayMonth, todayDay] = todayISO.split('-').map(Number) as [number, number, number];
  const isAfterToday = month > todayMonth || (month === todayMonth && day > todayDay);
  const year = isAfterToday ? todayYear - 1 : todayYear;

  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/**
 * 메시지 맨 앞의 날짜 접두를 해석. 날짜 뒤가 공백·줄바꿈이어야 접두로 인정한다
 * ("10/21에 ~"처럼 붙여 쓴 문장은 오늘 일기).
 * @param todayISO 달력 기준 KST 오늘 — 새벽에 쓴 오늘 날짜도 받기 위해 생활 기준 오늘이 아닌 달력 날짜를 쓴다
 */
export const parseDatedDiary = (text: string, todayISO: string): DatedDiaryParse => {
  const m = DATED_PREFIX_RE.exec(text);
  if (!m) return { kind: 'none' };

  const date = resolveDiaryDate(Number(m[1]), Number(m[2]), todayISO);
  if (!date) return { kind: 'invalid_date', token: `${m[1]}/${m[2]}` };

  const content = (m[3] ?? '').trim();
  if (!content) return { kind: 'no_content' };

  return { kind: 'dated', date, content };
};

/** 날짜 지정 일기 확인 문구. 작년 날짜면 연도를 붙여 오타를 알아챌 수 있게 한다. */
export const formatDatedConfirmation = (date: string, todayISO: string): string => {
  const sameYear = date.slice(0, 4) === todayISO.slice(0, 4);
  const label = sameYear ? formatDateShort(date) : `${date.slice(0, 4)}년 ${formatDateShort(date)}`;
  return `${label} 일기에 적어뒀어.`;
};

/**
 * 지난 날짜 일기의 메타 태그 추출. 추출 cron은 어제 일기만 보므로
 * 그보다 앞선 날짜에 쓴 일기는 여기서 바로 추출한다 (태그 적재는 ON CONFLICT로 멱등).
 * 응답을 막지 않도록 호출부에서 기다리지 않는다.
 */
export const backfillDiaryMetaTags = async (userId: number, date: string): Promise<void> => {
  try {
    const client = await createDiaryMetaLLMClient();
    const result = await extractAndPersistForUser(client, userId, date);
    console.warn(
      `[Diary Meta] 지난 일기 추출 user=${userId} date=${date} tags=${result?.tags.join(',') || '(none)'}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Diary Meta] 지난 일기 추출 실패 user=${userId} date=${date}: ${msg}`);
  }
};

// ─── DB 저장 ─────────────────────────────────────────────

/**
 * 일기 내용을 diary_entries에 저장 (같은 날 기록이 있으면 append).
 * 사용자 원문을 그대로 저장 (LLM 정제 없음). date를 안 주면 생활 기준 오늘.
 */
export const saveDiaryEntry = async (
  userId: number,
  content: string,
  date: string = getEffectiveTodayISO(),
): Promise<void> => {

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
