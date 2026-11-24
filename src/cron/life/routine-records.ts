import type { RoutineRecordRow } from '../../shared/life-queries.js';
import {
  queryActiveTemplates,
  queryExistingTemplateIds,
  queryLastRecordDate,
  createRecord,
  shouldCreateToday,
} from '../../shared/life-queries.js';
import { DEFAULT_USER_ID } from '../../shared/user-resolver.js';

// ─── 루틴 통계 ───────────────────────────────────────────

interface RoutineStats {
  total: number;
  completed: number;
  rate: number;
  slotBreakdown: Record<string, { total: number; completed: number; rate: number }>;
  weakestSlot: string | null;
}

/**
 * 루틴 달성률 집계. 입력이 이미 주기형만으로 걸러져 있다고 전제한다
 * (queryTodayRecords가 entry_type='scheduled'로 격리) — 자율 기록은 분모가 아니다 (ADR-0061).
 */
export const calcRoutineStats = (records: RoutineRecordRow[]): RoutineStats => {
  const total = records.length;
  const completed = records.filter((r) => r.completed).length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const slots: Record<string, { total: number; completed: number; rate: number }> = {};
  for (const r of records) {
    const slot = slots[r.time_slot] ?? (slots[r.time_slot] = { total: 0, completed: 0, rate: 0 });
    slot.total++;
    if (r.completed) slot.completed++;
  }
  for (const s of Object.values(slots)) {
    s.rate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  }

  let weakestSlot: string | null = null;
  let minRate = 100;
  for (const [slot, stat] of Object.entries(slots)) {
    if (stat.rate < minRate) {
      minRate = stat.rate;
      weakestSlot = slot;
    }
  }
  if (minRate >= 70) weakestSlot = null;

  return { total, completed, rate, slotBreakdown: slots, weakestSlot };
};

// ─── 루틴 기록 생성 ─────────────────────────────────────

/** 활성 템플릿 → 빈도 체크 → 오늘 기록 생성 */
export const createTodayRecords = async (
  today: string,
  userId: number = DEFAULT_USER_ID,
): Promise<number> => {
  const templates = await queryActiveTemplates(userId);
  const existingIds = await queryExistingTemplateIds(today, userId);

  // 자율 루틴은 기대된 발생이 없다 → 미리 만들지 않는다 (ADR-0061)
  const candidates = templates.filter(
    (t) => t.tracking_mode === 'scheduled' && !existingIds.has(t.id),
  );

  let created = 0;
  for (const t of candidates) {
    const shouldCreate =
      t.frequency === '매일'
        ? !t.start_date || today >= t.start_date
        : shouldCreateToday(
            t.frequency,
            await queryLastRecordDate(t.id, userId),
            today,
            t.start_date,
          );

    if (shouldCreate) {
      try {
        await createRecord(t.id, today, userId);
        created++;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Life Cron] 기록 생성 실패 (${t.name}): ${msg}`);
      }
    }
  }

  return created;
};
