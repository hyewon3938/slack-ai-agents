import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildReminderMessage, formatDateShort } from '../schedule-reminder.js';
import type { ScheduleItem } from '../../shared/notion.js';

// 랜덤을 고정해서 테스트 결과를 예측 가능하게
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

const makeItem = (overrides: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: 'test-id',
  title: '테스트 일정',
  date: { start: '2026-03-07', end: null },
  status: 'todo',
  category: [],
  hasStarIcon: false,
  ...overrides,
});

describe('formatDateShort', () => {
  it('YYYY-MM-DD를 M/D(요일) 형식으로 변환한다', () => {
    expect(formatDateShort('2026-03-07')).toBe('3/7(토)');
    expect(formatDateShort('2026-03-09')).toBe('3/9(월)');
    expect(formatDateShort('2026-12-25')).toBe('12/25(금)');
  });
});

describe('buildReminderMessage', () => {
  const today = '2026-03-07';
  const todayFormatted = '3/7(토)';

  describe('일정 없을 때', () => {
    it('일반 시간대: 일정 없음 메시지', () => {
      const msg = buildReminderMessage([], today, todayFormatted, false, ['약속']);
      expect(msg).toContain(todayFormatted);
      expect(msg).toContain('일정');
    });

    it('밤 시간대: 마무리 일정 없음 메시지', () => {
      const msg = buildReminderMessage([], today, todayFormatted, true, ['약속']);
      expect(msg).toContain('푹 쉬어');
    });
  });

  describe('일반 시간대 (isNight=false)', () => {
    it('인사 + 일정 리스트를 포함한다', () => {
      const items = [makeItem({ title: '블로그 작성' })];
      const msg = buildReminderMessage(items, today, todayFormatted, false, ['약속']);

      expect(msg).toContain(todayFormatted);
      expect(msg).toContain('블로그 작성');
    });

    it('약속은 카테고리 헤더 아래에 시간과 함께 표시한다', () => {
      const items = [
        makeItem({
          title: '친구 만남',
          category: ['약속'],
          status: null,
          date: { start: '2026-03-07T19:00:00+09:00', end: null },
        }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, false, ['약속']);

      expect(msg).toContain('*[약속]*');
      expect(msg).toContain('친구 만남 19:00');
      // [약속] 서픽스는 카테고리 헤더로 대체됨
      expect(msg).not.toContain('19:00 [약속]');
    });

    it('done은 취소선, in-progress는 ► 표시', () => {
      const items = [
        makeItem({ title: '완료 작업', status: 'done' }),
        makeItem({ title: '진행중 작업', status: 'in-progress' }),
        makeItem({ title: '할일 작업', status: 'todo' }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, false, ['약속']);

      expect(msg).toContain('~완료 작업~');
      expect(msg).toContain('► 진행중 작업');
      expect(msg).toContain('할일 작업');
    });

    it('중요 일정은 ★ 표시', () => {
      const items = [makeItem({ title: '중요한 일', hasStarIcon: true })];
      const msg = buildReminderMessage(items, today, todayFormatted, false, ['약속']);

      expect(msg).toContain('중요한 일 ★');
    });

    it('기간 일정은 날짜 범위를 표시한다', () => {
      const items = [
        makeItem({
          title: '인스타 포스팅',
          date: { start: '2026-03-05', end: '2026-03-10' },
        }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, false, ['약속']);

      expect(msg).toContain('인스타 포스팅 3/5(목)~3/10(화)');
    });

    it('카테고리별로 그룹핑 후 상태 순서로 정렬한다', () => {
      const items = [
        makeItem({ title: 'C-todo', status: 'todo', category: ['개인'] }),
        makeItem({ title: 'A-약속', category: ['약속'], status: null }),
        makeItem({ title: 'B-done', status: 'done', category: ['개인'] }),
        makeItem({ title: 'D-진행중', status: 'in-progress', category: ['개인'] }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, false, ['약속', '개인']);

      // 카테고리 헤더 포함
      expect(msg).toContain('*[약속]*');
      expect(msg).toContain('*[개인]*');

      // 약속 그룹이 개인 그룹보다 먼저
      const appointmentIdx = msg.indexOf('*[약속]*');
      const personalIdx = msg.indexOf('*[개인]*');
      expect(appointmentIdx).toBeLessThan(personalIdx);

      // 개인 그룹 내 상태 순서: done → in-progress → todo
      const doneIdx = msg.indexOf('B-done');
      const progressIdx = msg.indexOf('D-진행중');
      const todoIdx = msg.indexOf('C-todo');
      expect(doneIdx).toBeLessThan(progressIdx);
      expect(progressIdx).toBeLessThan(todoIdx);
    });

    it('남은 일정 있으면 상황에 맞는 코멘트를 붙인다', () => {
      // Math.random = 0 → 0 < 0.4 이므로 코멘트 추가됨
      const items = [makeItem({ title: '할일', status: 'todo' })];
      const msg = buildReminderMessage(items, today, todayFormatted, false, ['약속']);

      expect(msg).toContain('해야 할 일이 남아있네');
    });
  });

  describe('밤 마무리 (isNight=true)', () => {
    it('전부 완료면 칭찬 메시지', () => {
      const items = [
        makeItem({ title: '작업1', status: 'done' }),
        makeItem({ title: '작업2', status: 'done' }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, true, ['약속']);

      expect(msg).toContain('완료했네');
      expect(msg).toContain('고생했어');
      expect(msg).toContain('~작업1~');
    });

    it('미완료 있으면 상황에 맞는 메시지', () => {
      const items = [
        makeItem({ title: '완료', status: 'done' }),
        makeItem({ title: '미완료', status: 'todo' }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, true, ['약속']);

      expect(msg).toContain('할 일이 남았네');
      expect(msg).toContain('미완료');
    });

    it('약속은 미완료 판단에서 제외', () => {
      const items = [
        makeItem({ title: '완료', status: 'done' }),
        makeItem({ title: '약속', category: ['약속'], status: null }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, true, ['약속']);

      expect(msg).toContain('고생했어');
    });

    it('기간 일정: 마지막 날 아니면 미완료에서 제외', () => {
      const items = [
        makeItem({ title: '완료', status: 'done' }),
        makeItem({
          title: '기간 일정',
          status: 'in-progress',
          date: { start: '2026-03-05', end: '2026-03-10' },
        }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, true, ['약속']);

      expect(msg).toContain('고생했어');
    });

    it('기간 일정: 마지막 날인데 미완료면 카운트', () => {
      const items = [
        makeItem({
          title: '마감일 일정',
          status: 'todo',
          date: { start: '2026-03-05', end: '2026-03-07' },
        }),
      ];
      const msg = buildReminderMessage(items, today, todayFormatted, true, ['약속']);

      expect(msg).toContain('할 일이 남았네');
    });
  });
});
