import { describe, expect, it } from 'vitest';
import { extractCron } from '../cron.js';

describe('extractCron', () => {
  const slotFile = [
    "import { morningTask } from './tasks.js';",
    'export const SLOT_TASKS = {',
    '  morning: morningTask, // 아침 알림',
    '};',
  ].join('\n');
  const files = new Set(['src/cron/life/slot-tasks.ts', 'src/cron/life/tasks.ts']);

  it('node-cron을 import하지 않는 크론 폴더 파일의 슬롯 표도 찾는다', () => {
    const { slots } = extractCron('src/cron/life/slot-tasks.ts', slotFile, files);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      slot: 'morning',
      handler: 'morningTask',
      handlerFile: 'src/cron/life/tasks.ts',
      mapName: 'SLOT_TASKS',
    });
  });

  it('크론 폴더 밖에서 node-cron을 쓰지 않는 파일은 건너뛴다', () => {
    expect(extractCron('src/agents/life/slots.ts', slotFile, files).slots).toEqual([]);
  });
});
