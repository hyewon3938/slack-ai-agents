import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import {
  readCategoryLimitsWithUsage,
  readCategoryLimits,
  createCategoryLimit,
  updateCategoryLimit,
  deleteCategoryLimit,
} from '../category-limits-repo';

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

describe('category-limits-repo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('readCategoryLimitsWithUsage', () => {
    it('used_count는 expenses COUNT 결과를 그대로 반환', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          { id: 1, category: '카페', target_count: 5, used_count: 2 },
          { id: 2, category: '배달음식', target_count: 4, used_count: 5 },
        ],
        rowCount: 2,
      } as Any);

      const result = await readCategoryLimitsWithUsage(1, '2026-05');

      expect(result).toEqual([
        { id: 1, category: '카페', target_count: 5, used_count: 2 },
        { id: 2, category: '배달음식', target_count: 4, used_count: 5 },
      ]);
      const sql = vi.mocked(query).mock.calls[0]![0] as string;
      expect(sql).toMatch(/SELECT/i);
      expect(sql).toMatch(/COUNT/i);
      expect(sql).toMatch(/billing_month/);
      expect(sql).toMatch(/is_installment = false OR e\.installment_num = 1/);
      // 예산 미포함(exclude_from_budget=true) 건은 카운트 제외
      expect(sql).toMatch(/COALESCE\(e\.exclude_from_budget, false\) = false/);
      // userId, billingMonth 파라미터 전달 확인
      expect(vi.mocked(query).mock.calls[0]![1]).toEqual([1, '2026-05']);
    });

    it('비어있는 경우 빈 배열 반환', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as Any);
      const result = await readCategoryLimitsWithUsage(1, '2026-05');
      expect(result).toEqual([]);
    });
  });

  describe('readCategoryLimits', () => {
    it('user의 모든 한도 반환', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            user_id: 1,
            category: '카페',
            target_count: 5,
            created_at: '2026-05-14',
            updated_at: '2026-05-14',
          },
        ],
        rowCount: 1,
      } as Any);

      const result = await readCategoryLimits(1);
      expect(result).toHaveLength(1);
      expect(result[0]!.category).toBe('카페');
    });
  });

  describe('createCategoryLimit', () => {
    it('INSERT 후 row 반환', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 1,
        user_id: 1,
        category: '카페',
        target_count: 5,
        created_at: '2026-05-14',
        updated_at: '2026-05-14',
      } as Any);

      const result = await createCategoryLimit(1, { category: '카페', target_count: 5 });

      expect(result.id).toBe(1);
      expect(result.category).toBe('카페');
      expect(result.target_count).toBe(5);
      const sql = vi.mocked(queryOne).mock.calls[0]![0] as string;
      expect(sql).toMatch(/INSERT INTO category_limits/i);
      expect(vi.mocked(queryOne).mock.calls[0]![1]).toEqual([1, '카페', 5]);
    });

    it('INSERT가 row를 반환하지 않으면 throw', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      await expect(createCategoryLimit(1, { category: '카페', target_count: 5 })).rejects.toThrow(
        /INSERT returned no rows/,
      );
    });
  });

  describe('updateCategoryLimit', () => {
    it('target_count 없으면 null (UPDATE 호출 안 됨)', async () => {
      const result = await updateCategoryLimit(1, 1, {});
      expect(result).toBeNull();
      expect(queryOne).not.toHaveBeenCalled();
    });

    it('target_count 있으면 UPDATE 호출 + row 반환', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 1,
        user_id: 1,
        category: '카페',
        target_count: 10,
      } as Any);

      const result = await updateCategoryLimit(1, 1, { target_count: 10 });

      expect(result?.target_count).toBe(10);
      const sql = vi.mocked(queryOne).mock.calls[0]![0] as string;
      expect(sql).toMatch(/UPDATE category_limits/i);
      expect(sql).toMatch(/WHERE id = \$2 AND user_id = \$1/i);
      expect(vi.mocked(queryOne).mock.calls[0]![1]).toEqual([1, 1, 10]);
    });

    it('user_id 불일치 시 null 반환 (RETURNING 없음)', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(null);
      const result = await updateCategoryLimit(99, 1, { target_count: 10 });
      expect(result).toBeNull();
    });
  });

  describe('deleteCategoryLimit', () => {
    it('rowCount > 0이면 true', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as Any);
      const result = await deleteCategoryLimit(1, 1);
      expect(result).toBe(true);
    });

    it('rowCount 0이면 false (user_id 불일치 등)', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as Any);
      const result = await deleteCategoryLimit(1, 999);
      expect(result).toBe(false);
    });

    it('rowCount null이면 false', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: null } as Any);
      const result = await deleteCategoryLimit(1, 1);
      expect(result).toBe(false);
    });
  });
});
