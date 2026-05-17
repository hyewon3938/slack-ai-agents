/**
 * 일기 → 메타 태그 LLM 추출 cron.
 * ADR-0017 / v2 헌장: 일기 원문은 저장하지 않고 enum 플래그만 보존.
 *
 * 흐름:
 *   1) 오늘 diary_entries 로드
 *   2) LLM에게 고정 enum 16개 중 해당되는 태그만 JSON 배열로 요청
 *   3) 결과 파싱 → enum 화이트리스트 필터 → diary_meta_tags UPSERT
 */

import type { App } from '@slack/bolt';
import type { LLMClient, LLMMessage } from '../shared/llm.js';
import { query } from '../shared/db.js';
import { getEffectiveTodayISO } from '../shared/kst.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import type { LifeCronConfig } from './life-cron.js';

/** 허용된 16개 enum (migration 053과 동기화 필수) */
export const DIARY_META_TAGS = [
  'irritation',
  'health_complaint',
  'low_energy',
  'mood_down',
  'confidence_high',
  'analytical_mode',
  'deep_thought',
  'rest',
  'peaceful',
  'mood_high',
  'cooking',
  'creating',
  'talkative',
  'nostalgia',
  'anxiety',
  'past_memory',
] as const;

export type DiaryMetaTag = (typeof DIARY_META_TAGS)[number];

const TAG_SET = new Set<string>(DIARY_META_TAGS);

const SYSTEM_PROMPT = `너는 일기 텍스트에서 정해진 enum 태그만 추출하는 분류기.

허용된 태그 (이 16개 외엔 절대 출력 금지):
- irritation: 짜증/화남/예민
- health_complaint: 몸 아픔/통증/컨디션 난조 호소
- low_energy: 무기력/피곤/늘어짐
- mood_down: 우울/기분 가라앉음
- confidence_high: 자신감 충만/주도성
- analytical_mode: 분석/사고/계획 모드
- deep_thought: 깊은 사색/철학적 사고
- rest: 휴식/이완
- peaceful: 평온/만족
- mood_high: 기분 좋음/들뜸
- cooking: 요리/만들기(음식)
- creating: 창작/만들기(콘텐츠·작품)
- talkative: 대화 많이 함/말 많아짐
- nostalgia: 향수/추억 떠올림
- anxiety: 불안/걱정
- past_memory: 과거 회상

출력 규칙:
- 출력은 오로지 JSON 배열만. 예: ["irritation","low_energy"]
- 해당 없으면 빈 배열 [].
- 추론·확장 금지. 위 16개 외 태그를 만들지 마.
- 설명·주석·코드블록 마커 출력 금지.`;

const buildContext = (content: string): string =>
  `일기:\n${content}\n\n위 일기에서 해당되는 태그만 JSON 배열로 출력해.`;

/** LLM 응답 파싱 — 허용 enum만 추출, 잘못된 형식이면 빈 배열 */
export const parseTagResponse = (raw: string | null): DiaryMetaTag[] => {
  if (!raw) return [];
  const trimmed = raw.trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  const candidate = trimmed.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DiaryMetaTag[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    if (TAG_SET.has(item) && !out.includes(item as DiaryMetaTag)) {
      out.push(item as DiaryMetaTag);
    }
  }
  return out;
};

/** LLM 호출 → 태그 추출 (테스트용 분리) */
export const extractDiaryTags = async (
  llmClient: LLMClient,
  diaryContent: string,
): Promise<DiaryMetaTag[]> => {
  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext(diaryContent) },
  ];
  const response = await llmClient.chat(messages);
  return parseTagResponse(response.text);
};

/** diary_meta_tags 저장 (UPSERT — 중복 무시) */
const persistTags = async (userId: number, date: string, tags: DiaryMetaTag[]): Promise<number> => {
  if (tags.length === 0) return 0;
  let inserted = 0;
  for (const tag of tags) {
    const result = await query(
      `INSERT INTO diary_meta_tags (user_id, date, tag, source)
       VALUES ($1, $2, $3, 'llm')
       ON CONFLICT (user_id, date, tag) DO NOTHING`,
      [userId, date, tag],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
};

export interface DiaryMetaExtractResult {
  userId: number;
  date: string;
  tags: DiaryMetaTag[];
  inserted: number;
}

/**
 * 한 유저에 대해 일기 → 태그 추출 + 저장. 일기 없으면 null.
 */
export const extractAndPersistForUser = async (
  llmClient: LLMClient,
  userId: number,
  date: string,
): Promise<DiaryMetaExtractResult | null> => {
  const diaryResult = await query<{ content: string }>(
    `SELECT content FROM diary_entries WHERE user_id = $1 AND date = $2 LIMIT 1`,
    [userId, date],
  );
  const diary = diaryResult.rows[0];
  if (!diary || !diary.content.trim()) return null;

  const tags = await extractDiaryTags(llmClient, diary.content);
  const inserted = await persistTags(userId, date, tags);
  return { userId, date, tags, inserted };
};

/**
 * 일기 메타 추출 cron 본체. notification_settings의 diaryMetaExtract 슬롯에서 호출.
 * Slack 전송 X — 백그라운드 데이터 적재만.
 */
export const diaryMetaExtractTask = async (_app: App, config: LifeCronConfig): Promise<void> => {
  const today = getEffectiveTodayISO();
  const mappings = await queryAllUserMappings();
  const userIds = mappings.length > 0 ? mappings.map((m) => m.userId) : [DEFAULT_USER_ID];

  for (const userId of userIds) {
    try {
      const result = await extractAndPersistForUser(config.llmClient, userId, today);
      if (!result) {
        console.warn(`[Diary Meta] 일기 없음 user=${userId} date=${today}`);
        continue;
      }
      console.warn(
        `[Diary Meta] user=${userId} date=${today} tags=${result.tags.join(',') || '(none)'} inserted=${result.inserted}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Diary Meta] 추출 실패 user=${userId}: ${msg}`);
    }
  }
};
