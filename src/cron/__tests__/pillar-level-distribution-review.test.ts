import { describe, it, expect } from 'vitest';
import {
  buildMessage,
  type PillarRow,
  type CumulativeRow,
} from '../pillar-level-distribution-review.js';

// ── buildMessage: 분포 압축 ─────────────────────────────

describe('buildMessage', () => {
  it('양쪽 모두 빈 결과면 null (발송 스킵)', () => {
    expect(buildMessage([], [])).toBeNull();
  });

  it('pillar 분포만 있어도 메시지 생성', () => {
    const rows: PillarRow[] = [
      { pillar_level: 'ilun', matches: '120', hits: '24', hit_rate_pct: '20.0' },
      { pillar_level: 'wolun', matches: '80', hits: '8', hit_rate_pct: '10.0' },
    ];
    const out = buildMessage(rows, []);
    expect(out).toContain('운 레벨 분포');
    expect(out).toContain('ilun: 120건, hit 20.0%');
    expect(out).toContain('wolun: 80건, hit 10.0%');
    expect(out).not.toContain('누적 카운트');
  });

  it('누적 분포만 있어도 메시지 생성', () => {
    const cum: CumulativeRow[] = [
      { count_min: 2, element: '화', sipsin: null, matches: '14', hits: '7' },
      { count_min: 3, element: null, sipsin: '편재', matches: '5', hits: '1' },
    ];
    const out = buildMessage([], cum);
    expect(out).toContain('운 레벨 분포'); // 헤더는 항상 노출 (빈 분포라도)
    expect(out).toContain('누적 카운트 분포');
    expect(out).toContain('화 오행 N=2: 14건');
    expect(out).toContain('편재 N=3: 5건');
  });

  it('hit_rate_pct가 null이면 "-" 표시', () => {
    const rows: PillarRow[] = [
      { pillar_level: 'wonguk', matches: '0', hits: '0', hit_rate_pct: null },
    ];
    const out = buildMessage(rows, []);
    expect(out).toContain('wonguk: 0건, hit -%');
  });

  it('pillar_level이 null이면 (unknown) 표시', () => {
    const rows: PillarRow[] = [
      { pillar_level: null, matches: '3', hits: '1', hit_rate_pct: '33.3' },
    ];
    const out = buildMessage(rows, []);
    expect(out).toContain('(unknown)');
  });

  it('count_min이 null인 누적 행도 안전하게 출력', () => {
    const cum: CumulativeRow[] = [
      { count_min: null, element: '화', sipsin: null, matches: '2', hits: '0' },
    ];
    const out = buildMessage([], cum);
    expect(out).toContain('N=?');
  });

  it('양쪽 분포 모두 있으면 두 섹션 모두 포함', () => {
    const rows: PillarRow[] = [
      { pillar_level: 'ilun', matches: '50', hits: '5', hit_rate_pct: '10.0' },
    ];
    const cum: CumulativeRow[] = [
      { count_min: 1, element: '화', sipsin: null, matches: '20', hits: '6' },
    ];
    const out = buildMessage(rows, cum);
    expect(out).toContain('운 레벨 분포');
    expect(out).toContain('누적 카운트 분포');
    expect(out).toContain('ilun');
    expect(out).toContain('화 오행 N=1');
  });
});
