/**
 * 일기 → 메타 태그 LLM 추출 cron.
 * ADR-0017 / v2 헌장: 일기 원문은 저장하지 않고 enum 플래그만 보존.
 * ADR-0019 Phase 4: enum 16 → 22 확장 + Opus 분류기로 이관 (#409).
 *
 * 흐름:
 *   1) 오늘 diary_entries 로드
 *   2) LLM(Opus)에게 고정 enum 22개 중 해당되는 태그만 JSON 배열로 요청
 *   3) 결과 파싱 → enum 화이트리스트 필터 → diary_meta_tags UPSERT
 */

import type { App } from '@slack/bolt';
import { createDiaryMetaLLMClient, type LLMClient, type LLMMessage } from '../shared/llm.js';
import { query } from '../shared/db.js';
import { getYesterdayISO } from '../shared/kst.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import type { LifeCronConfig } from './life-cron.js';

/** 허용된 22개 enum (migration 053 + 059와 동기화 필수) */
export const DIARY_META_TAGS = [
  // 기존 16 (migration 053)
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
  // 신규 6 (migration 059 — Phase 4 가설 검증용)
  'wealth_awareness',
  'self_observation',
  'social_activity',
  'physical_activity',
  'task_completion',
  'clumsy_overflow',
] as const;

export type DiaryMetaTag = (typeof DIARY_META_TAGS)[number];

const TAG_SET = new Set<string>(DIARY_META_TAGS);

const SYSTEM_PROMPT = `너는 일기 텍스트에서 정해진 enum 태그만 추출하는 분류기.

허용된 태그 (이 22개 외엔 절대 출력 금지):
- irritation: 짜증/화남/예민
- health_complaint: 몸 아픔/통증/컨디션 난조 호소
- low_energy: 무기력/피곤/늘어짐
- mood_down: 우울/기분 가라앉음
- confidence_high: 자신감 충만/주도성
- analytical_mode: 분석/사고/계획 모드 (일반)
- deep_thought: 깊은 사색/철학적 사고 (일반)
- rest: 휴식/이완
- peaceful: 평온/만족
- mood_high: 기분 좋음/들뜸
- cooking: 요리/만들기(음식)
- creating: 창작/만들기(콘텐츠·작품)
- talkative: 대화 많이 함/말 많아짐
- nostalgia: 향수/추억 떠올림
- anxiety: 불안/걱정
- past_memory: 과거 회상
- wealth_awareness: 돈 관련 인식·결정·기회 (예: 채용 제안, 알바, 지출 결정, 자산 변동 의식)
- self_observation: 본인 사주·신살·일진·운을 직접 언급 (예: "을경합 작동", "편재 떴다", "오늘 일진 느낌")
  ※ analytical_mode(일반 분석)·deep_thought(철학적 사색)와 구분 — 사주 패턴을 명시적으로 언급한 경우만
- social_activity: 가족·친구·지인 만남 또는 통화
- physical_activity: 운동·산책·외출·이동 (단순 외출도 포함)
- task_completion: 업무·과제 처리/완료 (구체적 일을 마쳤다는 언급)
- clumsy_overflow: 실수·물건 떨어뜨림·놓침·잊음

출력 규칙:
- 출력은 오로지 JSON 배열만. 예: ["irritation","low_energy"]
- 해당 없으면 빈 배열 [].
- 추론·확장 금지. 위 22개 외 태그를 만들지 마.
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
 *
 * 익일 05:30에 실행되어 어제 일기를 추출 (자정 넘긴 일기·누락 방지 — migration 054).
 * Opus client 사용 — 분류기 정밀도가 가설 검증 품질에 직결 (ADR-0019).
 */
export const diaryMetaExtractTask = async (_app: App, _config: LifeCronConfig): Promise<void> => {
  const targetDate = getYesterdayISO();
  const mappings = await queryAllUserMappings();
  const userIds = mappings.length > 0 ? mappings.map((m) => m.userId) : [DEFAULT_USER_ID];
  const opusClient = await createDiaryMetaLLMClient();

  for (const userId of userIds) {
    try {
      const result = await extractAndPersistForUser(opusClient, userId, targetDate);
      if (!result) {
        console.warn(`[Diary Meta] 일기 없음 user=${userId} date=${targetDate}`);
        continue;
      }
      console.warn(
        `[Diary Meta] user=${userId} date=${targetDate} tags=${result.tags.join(',') || '(none)'} inserted=${result.inserted}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Diary Meta] 추출 실패 user=${userId}: ${msg}`);
    }
  }
};
