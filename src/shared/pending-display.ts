/**
 * modify_db 확인 플로우에서 테이블별로 표시를 담당한다.
 * - formatAffectedRows: 영향받을 row 1건을 "표시용 문자열"로 변환 (확인 카드)
 * - 실행 완료 후 "현재 상태" 블록(loadCurrentStateBlocks)은 pending-current-state.ts
 */

export type AffectedRow = Record<string, unknown>;

export interface DisplayGroup {
  /** 카테고리/그룹 헤더 (없으면 null) */
  header: string | null;
  /** 리스트 항목들 */
  items: string[];
}

/** 영향받을 row들을 테이블에 맞게 그룹핑된 리스트로 변환 */
export const formatAffectedRows = (tableName: string, rows: AffectedRow[]): DisplayGroup[] => {
  switch (tableName) {
    case 'schedules':
      return formatSchedules(rows);
    case 'routine_records':
      return formatRoutineRecords(rows);
    case 'routine_templates':
      return formatRoutineTemplates(rows);
    case 'sleep_records':
      return formatSleepRecords(rows);
    case 'sleep_events':
      return formatSleepEvents(rows);
    case 'reminders':
      return formatReminders(rows);
    case 'notification_settings':
      return formatNotificationSettings(rows);
    case 'custom_instructions':
      return formatCustomInstructions(rows);
    case 'categories':
      return formatCategories(rows);
    default:
      return [{ header: null, items: rows.map((_, i) => `row ${i + 1}`) }];
  }
};

// schedules: 제목 + 중요 표시 (FK 전환 후 RETURNING에 카테고리 이름이 없으므로 평면 리스트)
const formatSchedules = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const title = (r['title'] as string | null) ?? '(제목 없음)';
    const important = r['important'] ? ' ★' : '';
    return `${title}${important}`;
  });
  return [{ header: null, items }];
};

const formatRoutineRecords = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const date = (r['date'] as string | null) ?? '?';
    const tid = r['template_id'] ?? '?';
    const completed = r['completed'] ? ' ✓' : '';
    return `${date} 루틴 #${tid}${completed}`;
  });
  return [{ header: null, items }];
};

const formatRoutineTemplates = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const name = (r['name'] as string | null) ?? '(이름 없음)';
    const slot = (r['time_slot'] as string | null) ?? '';
    return slot ? `${name} (${slot})` : name;
  });
  return [{ header: null, items }];
};

const formatSleepRecords = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const date = (r['date'] as string | null) ?? '?';
    const type = r['sleep_type'] === 'night' ? '밤잠' : '낮잠';
    const bedtime = (r['bedtime'] as string | null) ?? '--';
    const wake = (r['wake_time'] as string | null) ?? '--';
    return `${date} ${type} ${bedtime}~${wake}`;
  });
  return [{ header: null, items }];
};

const formatSleepEvents = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const date = (r['date'] as string | null) ?? '?';
    const time = (r['event_time'] as string | null) ?? '?';
    return `${date} ${time} 중간 기상`;
  });
  return [{ header: null, items }];
};

const formatReminders = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const title = (r['title'] as string | null) ?? '(제목 없음)';
    const time = (r['time_value'] as string | null) ?? '?';
    const freq = (r['frequency'] as string | null) ?? '';
    return freq ? `${title} — ${time} (${freq})` : `${title} — ${time}`;
  });
  return [{ header: null, items }];
};

const formatNotificationSettings = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const label = (r['label'] as string | null) ?? (r['slot_name'] as string | null) ?? '?';
    const time = (r['time_value'] as string | null) ?? '?';
    return `${label} — ${time}`;
  });
  return [{ header: null, items }];
};

const formatCustomInstructions = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const inst = (r['instruction'] as string | null) ?? '';
    const truncated = inst.length > 60 ? inst.slice(0, 60) + '…' : inst;
    const cat = (r['category'] as string | null) ?? '';
    return cat ? `[${cat}] ${truncated}` : truncated;
  });
  return [{ header: null, items }];
};

const formatCategories = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const name = (r['name'] as string | null) ?? '?';
    const type = (r['type'] as string | null) ?? '?';
    return `${name} (${type})`;
  });
  return [{ header: null, items }];
};

/** SQL의 첫 FROM/UPDATE 뒤 테이블명 추출 */
export const extractTargetTable = (sql: string): string | null => {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '');
  const match = /\b(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(stripped);
  return match?.[1]?.toLowerCase() ?? null;
};

/** 영향 row에서 date 컬럼 값들을 중복 없이 추출 (있는 테이블만) */
export const extractAffectedDates = (rows: AffectedRow[]): string[] => {
  const dates = new Set<string>();
  for (const r of rows) {
    const d = r['date'];
    if (typeof d === 'string' && d.length > 0) dates.add(d);
  }
  return [...dates];
};
