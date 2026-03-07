import type { Client as NotionClient } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import { toUUID, queryDatabase } from './notion.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface SleepRecord {
  id: string;
  date: string;           // YYYY-MM-DD ("밤의 날짜")
  bedtime: string;        // HH:MM
  wakeTime: string;       // HH:MM
  durationMinutes: number;
  memo: string;
}

export interface SleepStats {
  count: number;
  avgDurationMinutes: number;
  avgBedtimeMinutes: number;   // 자정 기준 분 (overnight 보정 포함)
  avgWakeTimeMinutes: number;  // 자정 기준 분
}

interface ParsedTimes {
  bedtime: string;
  wakeTime: string;
}

// ─── 순수 함수: 시간 파싱 ─────────────────────────────────────────────

/** 한글 숫자 → 아라비아 숫자 변환 맵 */
const KOREAN_NUM_MAP: Record<string, string> = {
  '열두': '12', '열한': '11', '열': '10',
  '한': '1', '두': '2', '세': '3', '네': '4', '다섯': '5',
  '여섯': '6', '일곱': '7', '여덟': '8', '아홉': '9',
};

/** "두시" → "2시", "아홉시 반" → "9시 반", "열한시" → "11시" */
export const convertKoreanNumbers = (text: string): string => {
  let result = text;
  // 긴 키워드 먼저 치환 (열두 > 열한 > 열 > 한/두/...)
  for (const [kor, num] of Object.entries(KOREAN_NUM_MAP)) {
    result = result.replaceAll(`${kor}시`, `${num}시`);
  }
  return result;
};

/** 시간 표현에서 시/분 추출: "10시", "10시 반", "10시 30분" */
const parseTimeToken = (token: string): { hour: number; minute: number } | null => {
  // "N시 N분" or "N시 반" or "N시"
  const match = token.match(/(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|반)?/);
  if (!match) return null;

  const hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : (token.includes('반') ? 30 : 0);

  return { hour, minute };
};

/** 취침 컨텍스트 시각 결정 (AM/PM 추론) */
const resolveBedtimeHour = (hour: number, prefix: string): number => {
  // 명시적 키워드
  if (/오전|아침/.test(prefix)) return hour === 12 ? 0 : hour;
  if (/오후|저녁|밤/.test(prefix)) return hour === 12 ? 12 : hour + 12;
  if (/새벽/.test(prefix)) return hour;  // 새벽 1~5시 그대로

  // 암묵적: 취침 컨텍스트에서 시간 추론
  if (hour >= 1 && hour <= 5) return hour;         // 새벽 1~5시
  if (hour >= 6 && hour <= 11) return hour + 12;   // 저녁 18~23시
  if (hour === 12) return 0;                        // 자정
  return hour; // 13~23은 그대로
};

/** 기상 컨텍스트 시각 결정 (AM/PM 추론) */
const resolveWakeTimeHour = (hour: number, prefix: string): number => {
  if (/오후|저녁/.test(prefix)) return hour === 12 ? 12 : hour + 12;
  if (/오전|아침/.test(prefix)) return hour === 12 ? 0 : hour;

  // 암묵적: 기상 컨텍스트에서 4~12시는 오전
  if (hour >= 4 && hour <= 12) return hour;
  return hour;
};

/** 시/분 → "HH:MM" 포맷 */
const toHHMM = (hour: number, minute: number): string => {
  const h = hour % 24;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

/**
 * 자연어에서 취침/기상 시각 추출.
 * "어제 12시에 자서 7시에 일어났어" → { bedtime: "00:00", wakeTime: "07:00" }
 * 파싱 실패 시 null 반환 (LLM 폴백).
 */
export const parseSleepTimes = (text: string): ParsedTimes | null => {
  // 한글 숫자 → 아라비아 숫자 전처리 ("두시" → "2시")
  const normalized = convertKoreanNumbers(text);

  // 취침 패턴: (prefix) N시 (N분|반)? ... (잤|자서|잠들|취침|잠)
  const bedtimePattern = /(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2}\s*시\s*(?:\d{1,2}\s*분|반)?)\s*(?:에|쯤|경|부터|즈음)?\s*(?:잤|자서|자고|잠들|잠\s*들|취침|잠)/;
  // 기상 패턴: (prefix) N시 (N분|반)? ... (일어나|일어났|기상|깼|깸|눈떴)
  const wakePattern = /(오전|오후|아침|저녁|새벽)?\s*(\d{1,2}\s*시\s*(?:\d{1,2}\s*분|반)?)\s*(?:에|쯤|경)?\s*(?:일어나|일어났|기상|깼|깸|눈\s*떴|눈떴|일어남)/;

  const bedMatch = normalized.match(bedtimePattern);
  const wakeMatch = normalized.match(wakePattern);

  if (!bedMatch || !wakeMatch) return null;

  const bedPrefix = bedMatch[1] ?? '';
  const bedParsed = parseTimeToken(bedMatch[2]);
  if (!bedParsed) return null;

  const wakePrefix = wakeMatch[1] ?? '';
  const wakeParsed = parseTimeToken(wakeMatch[2]);
  if (!wakeParsed) return null;

  const bedHour = resolveBedtimeHour(bedParsed.hour, bedPrefix);
  const wakeHour = resolveWakeTimeHour(wakeParsed.hour, wakePrefix);

  return {
    bedtime: toHHMM(bedHour, bedParsed.minute),
    wakeTime: toHHMM(wakeHour, wakeParsed.minute),
  };
};

// ─── 순수 함수: 계산/포맷 ────────────────────────────────────────────

/** 수면 시간 계산 (분). overnight 자동 처리. */
export const calculateSleepMinutes = (bedtime: string, wakeTime: string): number => {
  const [bH, bM] = bedtime.split(':').map(Number);
  const [wH, wM] = wakeTime.split(':').map(Number);

  const bedMin = bH * 60 + bM;
  const wakeMin = wH * 60 + wM;

  // 기상 < 취침이면 다음 날 (overnight)
  return wakeMin >= bedMin ? wakeMin - bedMin : (24 * 60 - bedMin) + wakeMin;
};

/** 분 → "7시간 30분" 포맷 */
export const formatSleepDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
};

/** 분(자정 기준) → "23:30" 포맷. 24시간 이상은 -24h 보정. */
export const formatTimeHHMM = (totalMinutes: number): string => {
  let mins = Math.round(totalMinutes);
  if (mins >= 24 * 60) mins -= 24 * 60;
  if (mins < 0) mins += 24 * 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** HH:MM → 자정 기준 분 변환 */
const timeToMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** 수면 기록 배열 → 평균 통계 계산 */
export const calculateSleepStats = (records: SleepRecord[]): SleepStats | null => {
  if (records.length === 0) return null;

  const count = records.length;

  // 평균 수면시간
  const totalDuration = records.reduce((sum, r) => sum + r.durationMinutes, 0);
  const avgDurationMinutes = Math.round(totalDuration / count);

  // 평균 취침시각 (overnight 보정: 0~5시 = +24h)
  const bedMinutes = records.map((r) => {
    const min = timeToMinutes(r.bedtime);
    return min < 360 ? min + 1440 : min; // 0:00~5:59 → +24h
  });
  const avgBedtimeMinutes = Math.round(
    bedMinutes.reduce((sum, m) => sum + m, 0) / count,
  );

  // 평균 기상시각
  const wakeMinutes = records.map((r) => timeToMinutes(r.wakeTime));
  const avgWakeTimeMinutes = Math.round(
    wakeMinutes.reduce((sum, m) => sum + m, 0) / count,
  );

  return { count, avgDurationMinutes, avgBedtimeMinutes, avgWakeTimeMinutes };
};

// ─── Notion DB 함수 ──────────────────────────────────────────────────

const isPageObject = (
  result: { object: string },
): result is PageObjectResponse => {
  return result.object === 'page' && 'properties' in result;
};

const parseRichText = (page: PageObjectResponse, name: string): string => {
  const prop = page.properties[name];
  if (prop?.type === 'rich_text') {
    return prop.rich_text.map((t) => t.plain_text).join('');
  }
  return '';
};

const parseNumber = (page: PageObjectResponse, name: string): number => {
  const prop = page.properties[name];
  if (prop?.type === 'number' && prop.number !== null) {
    return prop.number;
  }
  return 0;
};

const parseDate = (page: PageObjectResponse): string => {
  const prop = page.properties['Date'];
  if (prop?.type === 'date' && prop.date) {
    return prop.date.start.slice(0, 10);
  }
  return '';
};

const toSleepRecord = (page: PageObjectResponse): SleepRecord => ({
  id: page.id,
  date: parseDate(page),
  bedtime: parseRichText(page, '취침'),
  wakeTime: parseRichText(page, '기상'),
  durationMinutes: parseNumber(page, '수면시간'),
  memo: parseRichText(page, '메모'),
});

/** 단일 날짜 수면 기록 조회 */
export const querySleepRecord = async (
  client: NotionClient,
  dbId: string,
  date: string,
): Promise<SleepRecord | null> => {
  const uuid = toUUID(dbId);
  const response = await queryDatabase(client, uuid, {
    filter: {
      property: 'Date',
      date: { equals: date },
    },
    page_size: 1,
  });

  const page = response.results.find(isPageObject);
  return page ? toSleepRecord(page) : null;
};

/** 날짜 범위 수면 기록 조회 (startDate 이상, endDate 이하) */
export const querySleepRecords = async (
  client: NotionClient,
  dbId: string,
  startDate: string,
  endDate: string,
): Promise<SleepRecord[]> => {
  const uuid = toUUID(dbId);
  const allPages: PageObjectResponse[] = [];
  let startCursor: string | undefined;

  do {
    const response = await queryDatabase(client, uuid, {
      filter: {
        and: [
          { property: 'Date', date: { on_or_after: startDate } },
          { property: 'Date', date: { on_or_before: endDate } },
        ],
      },
      sorts: [{ property: 'Date', direction: 'ascending' }],
      ...(startCursor ? { start_cursor: startCursor } : {}),
    });

    const pages = response.results.filter(isPageObject);
    allPages.push(...pages);
    startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return allPages.map(toSleepRecord);
};

/** 수면 기록 생성 */
export const createSleepRecord = async (
  client: NotionClient,
  dbId: string,
  date: string,
  bedtime: string,
  wakeTime: string,
  durationMinutes: number,
  memo?: string,
): Promise<SleepRecord> => {
  const uuid = toUUID(dbId);

  // 라벨: "3/7 수면" 형태
  const d = new Date(date + 'T00:00:00+09:00');
  const label = `${d.getMonth() + 1}/${d.getDate()} 수면`;

  const page = await client.pages.create({
    parent: { database_id: uuid },
    properties: {
      Name: { title: [{ text: { content: label } }] },
      Date: { date: { start: date } },
      '취침': { rich_text: [{ text: { content: bedtime } }] },
      '기상': { rich_text: [{ text: { content: wakeTime } }] },
      '수면시간': { number: durationMinutes },
      ...(memo ? { '메모': { rich_text: [{ text: { content: memo } }] } } : {}),
    },
  });

  return {
    id: page.id,
    date,
    bedtime,
    wakeTime,
    durationMinutes,
    memo: memo ?? '',
  };
};

/** 기존 수면 기록 업데이트 (upsert용) */
export const updateSleepRecord = async (
  client: NotionClient,
  pageId: string,
  bedtime: string,
  wakeTime: string,
  durationMinutes: number,
): Promise<void> => {
  await client.pages.update({
    page_id: pageId,
    properties: {
      '취침': { rich_text: [{ text: { content: bedtime } }] },
      '기상': { rich_text: [{ text: { content: wakeTime } }] },
      '수면시간': { number: durationMinutes },
    },
  });
};
