/**
 * calendar_event evaluator — 한국 공휴일 / 공휴일 다음날 / 자동이체일.
 *
 * - holiday: ctx.date가 공휴일이면 true (korean-holidays.ts 정적 상수)
 * - holiday_next: ctx.date 전날이 공휴일이면 true (명절 후유증 가설)
 * - autopay_day: ctx.date의 day-of-month가 aux.day_of_month와 같으면 true
 *                (사용자 설정 UI는 follow-up — 현 단계는 시드 자체가 catalog에 없음)
 */

import type { CalendarEventAux, DailyContext } from '../pattern-match.js';
import { isKoreanHoliday } from './korean-holidays.js';

export const evaluateCalendarEvent = async (
  aux: CalendarEventAux,
  ctx: DailyContext,
): Promise<boolean> => {
  switch (aux.event) {
    case 'holiday':
      return isKoreanHoliday(ctx.date);
    case 'holiday_next': {
      // ctx.date는 'YYYY-MM-DD' (KST 캘린더). UTC로 -1일 (timezone 무관).
      const [y, m, d] = ctx.date.split('-').map(Number);
      const prev = new Date(Date.UTC(y, m - 1, d));
      prev.setUTCDate(prev.getUTCDate() - 1);
      const yyyy = prev.getUTCFullYear();
      const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(prev.getUTCDate()).padStart(2, '0');
      return isKoreanHoliday(`${yyyy}-${mm}-${dd}`);
    }
    case 'autopay_day': {
      if (typeof aux.day_of_month !== 'number') return false;
      // ctx.date는 'YYYY-MM-DD' — day part 직접 파싱.
      const day = Number(ctx.date.slice(8, 10));
      return day === aux.day_of_month;
    }
  }
};
