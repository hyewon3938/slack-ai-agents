import { describe, it, expect } from 'vitest';
import { computeDragResult, formatRangeLabel, isSameRange } from '../date-move';

// ─── computeDragResult: 이동 ────────────────────────────

describe('computeDragResult — move', () => {
  it('단일 일정은 시작일만 옮긴다', () => {
    expect(computeDragResult('move', { date: '2026-10-01', end_date: null }, '2026-10-05')).toEqual(
      {
        date: '2026-10-05',
        end_date: null,
      },
    );
  });

  it('기간 일정은 기간을 유지한 채 시작일과 종료일을 함께 옮긴다', () => {
    expect(
      computeDragResult('move', { date: '2026-09-27', end_date: '2026-10-19' }, '2026-10-18'),
    ).toEqual({ date: '2026-10-18', end_date: '2026-11-09' });
  });

  it('앞으로 옮겨도 기간을 유지한다', () => {
    expect(
      computeDragResult('move', { date: '2026-10-18', end_date: '2026-11-09' }, '2026-09-27'),
    ).toEqual({ date: '2026-09-27', end_date: '2026-10-19' });
  });

  it('월말을 넘겨도 날짜를 정확히 계산한다', () => {
    expect(
      computeDragResult('move', { date: '2026-01-30', end_date: '2026-02-02' }, '2026-02-27'),
    ).toEqual({ date: '2026-02-27', end_date: '2026-03-02' });
  });

  it('같은 날에 놓으면 null', () => {
    expect(
      computeDragResult('move', { date: '2026-10-01', end_date: null }, '2026-10-01'),
    ).toBeNull();
  });

  it('종료일이 시작일보다 앞선 잘못된 범위는 단일 일정으로 다룬다', () => {
    expect(
      computeDragResult('move', { date: '2026-10-05', end_date: '2026-10-01' }, '2026-10-10'),
    ).toEqual({ date: '2026-10-10', end_date: null });
  });

  it('날짜가 없는 일정은 null', () => {
    expect(computeDragResult('move', { date: null, end_date: null }, '2026-10-01')).toBeNull();
  });
});

// ─── computeDragResult: 오른쪽 핸들 ─────────────────────

describe('computeDragResult — resize-right', () => {
  it('종료일을 늘린다', () => {
    expect(
      computeDragResult('resize-right', { date: '2026-10-01', end_date: null }, '2026-10-03'),
    ).toEqual({ date: '2026-10-01', end_date: '2026-10-03' });
  });

  it('시작일 이하로 당기면 단일 일정이 된다', () => {
    expect(
      computeDragResult(
        'resize-right',
        { date: '2026-10-05', end_date: '2026-10-08' },
        '2026-10-03',
      ),
    ).toEqual({ date: '2026-10-05', end_date: null });
  });

  it('단일 일정을 그 자리에 놓으면 null', () => {
    expect(
      computeDragResult('resize-right', { date: '2026-10-05', end_date: null }, '2026-10-05'),
    ).toBeNull();
  });
});

// ─── computeDragResult: 왼쪽 핸들 ───────────────────────

describe('computeDragResult — resize-left', () => {
  it('기간 일정의 시작일을 앞당긴다', () => {
    expect(
      computeDragResult(
        'resize-left',
        { date: '2026-10-05', end_date: '2026-10-08' },
        '2026-10-02',
      ),
    ).toEqual({ date: '2026-10-02', end_date: '2026-10-08' });
  });

  it('단일 일정을 앞으로 끌면 원래 날짜까지 기간이 된다', () => {
    expect(
      computeDragResult('resize-left', { date: '2026-10-05', end_date: null }, '2026-10-03'),
    ).toEqual({ date: '2026-10-03', end_date: '2026-10-05' });
  });

  it('종료일 이후로 밀면 종료일에 단일 일정으로 남는다', () => {
    expect(
      computeDragResult(
        'resize-left',
        { date: '2026-10-05', end_date: '2026-10-08' },
        '2026-10-10',
      ),
    ).toEqual({ date: '2026-10-08', end_date: null });
  });

  it('단일 일정을 뒤로 끌어도 범위가 뒤집히지 않는다', () => {
    expect(
      computeDragResult('resize-left', { date: '2026-10-05', end_date: null }, '2026-10-07'),
    ).toBeNull();
  });
});

// ─── isSameRange ────────────────────────────────────────

describe('isSameRange', () => {
  it('시작일과 종료일이 모두 같으면 true', () => {
    expect(
      isSameRange({ date: '2026-10-01', end_date: null }, { date: '2026-10-01', end_date: null }),
    ).toBe(true);
  });

  it('종료일이 다르면 false', () => {
    expect(
      isSameRange(
        { date: '2026-10-01', end_date: null },
        { date: '2026-10-01', end_date: '2026-10-02' },
      ),
    ).toBe(false);
  });
});

// ─── formatRangeLabel ───────────────────────────────────

describe('formatRangeLabel', () => {
  it('단일 일정은 날짜 하나', () => {
    expect(formatRangeLabel({ date: '2026-09-27', end_date: null })).toBe('9/27');
  });

  it('기간 일정은 시작~종료', () => {
    expect(formatRangeLabel({ date: '2026-09-27', end_date: '2026-10-19' })).toBe('9/27~10/19');
  });

  it('날짜가 없으면 백로그', () => {
    expect(formatRangeLabel({ date: null, end_date: null })).toBe('백로그');
  });
});
