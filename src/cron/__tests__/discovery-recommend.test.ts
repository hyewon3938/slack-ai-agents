import { describe, it, expect } from 'vitest';
import { decideReRecommend } from '../discovery-recommend.js';

// ─── decideReRecommend (재추천 발사 결정 순수 코어) ──────
// 발사 조건: total > 0 && archived === total && total < cap
// "이번주 발굴 묶음이 전부 패스(archived)됐고, 백스톱 cap 미만일 때만 다음 묶음".

describe('decideReRecommend', () => {
  it('이번주 묶음 없음(total=0) → 무발사 (자연 소진)', () => {
    expect(decideReRecommend(0, 0, 20)).toBe(false);
  });

  it('전부 패스 + cap 미만(5/5, cap20) → 발사', () => {
    expect(decideReRecommend(5, 5, 20)).toBe(true);
  });

  it('1개 미패스(5/4) → 무발사 (pending 보류 또는 active 정지)', () => {
    expect(decideReRecommend(5, 4, 20)).toBe(false);
  });

  it('전부 무응답(5/0) → 무발사 (아직 검토 안 함)', () => {
    expect(decideReRecommend(5, 0, 20)).toBe(false);
  });

  it('cap 도달(20/20, cap20) → 무발사 (백스톱)', () => {
    expect(decideReRecommend(20, 20, 20)).toBe(false);
  });

  it('cap 직전(19/19, cap20) → 발사', () => {
    expect(decideReRecommend(19, 19, 20)).toBe(true);
  });
});
