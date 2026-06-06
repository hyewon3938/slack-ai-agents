import { describe, it, expect } from 'vitest';
import { validateSignalSql, SIGNAL_TABLE_WHITELIST, SIGNAL_ROW_CAP } from '../signal-sql-guard.js';

describe('validateSignalSql — 게이트 #1 정적 검증 (ADR-0040)', () => {
  describe('통과 케이스 (null 반환)', () => {
    it('화이트리스트 테이블 + user_id=$1 + 단일 SELECT', () => {
      expect(
        validateSignalSql('SELECT count(*) FROM schedules WHERE user_id = $1 AND date = $2'),
      ).toBeNull();
    });

    it('WITH(CTE)로 시작하는 읽기 쿼리 — CTE 이름은 화이트리스트 면제', () => {
      const sql =
        'WITH rc AS (SELECT date FROM routine_records WHERE user_id = $1) ' +
        'SELECT count(*) FROM rc WHERE date = $2';
      expect(validateSignalSql(sql)).toBeNull();
    });

    it('EXTRACT(EPOCH FROM ...) 내부 FROM은 테이블 오탐 아님', () => {
      const sql =
        'SELECT EXTRACT(EPOCH FROM min(s.end_time - s.start_time)) ' +
        'FROM sleep_records s WHERE s.user_id = $1 AND s.date = $2';
      expect(validateSignalSql(sql)).toBeNull();
    });

    it('expenses JOIN categories (둘 다 화이트리스트)', () => {
      const sql =
        'SELECT count(*) FROM expenses e JOIN categories c ON c.id = e.category_id ' +
        'WHERE e.user_id = $1 AND e.date = $2';
      expect(validateSignalSql(sql)).toBeNull();
    });
  });

  describe('차단 케이스 (사유 문자열 반환)', () => {
    it('빈 SQL', () => {
      expect(validateSignalSql('')).toMatch(/비어/);
      expect(validateSignalSql('   ')).toMatch(/비어/);
    });

    it('길이 초과', () => {
      const long = 'SELECT 1 FROM schedules WHERE user_id = $1 AND ' + 'a'.repeat(2100);
      expect(validateSignalSql(long)).toMatch(/너무 길어/);
    });

    it('stacked statements (세미콜론 분리)', () => {
      expect(
        validateSignalSql('SELECT 1 FROM schedules WHERE user_id = $1; DROP TABLE users'),
      ).toMatch(/여러 SQL|단일/);
    });

    it('SELECT/WITH 외 첫 키워드 (INSERT/UPDATE/DELETE)', () => {
      expect(validateSignalSql('INSERT INTO schedules VALUES (1)')).toMatch(/SELECT\/WITH|읽기/);
      expect(validateSignalSql('UPDATE schedules SET x=1 WHERE user_id = $1')).not.toBeNull();
      expect(validateSignalSql('DELETE FROM schedules WHERE user_id = $1')).not.toBeNull();
    });

    it('블록 패턴 — DDL', () => {
      expect(validateSignalSql('SELECT 1; DROP TABLE x')).not.toBeNull();
      expect(
        validateSignalSql('WITH x AS (SELECT 1) SELECT * FROM x WHERE 1=1 OR true; ALTER TABLE t'),
      ).not.toBeNull();
    });

    it('블록 패턴 — 위험 함수 (pg_sleep, COPY, dblink, set_config)', () => {
      expect(validateSignalSql('SELECT pg_sleep(10)')).toMatch(/금지/);
      expect(validateSignalSql('COPY t FROM PROGRAM ' + "'x'")).not.toBeNull();
      expect(validateSignalSql('SELECT dblink(' + "'x', 'y'" + ')')).toMatch(/금지/);
      expect(validateSignalSql('SELECT set_config(' + "'a','b',true" + ')')).toMatch(/금지/);
    });

    it('information_schema / pg_catalog 탐색 차단', () => {
      expect(validateSignalSql('SELECT count(*) FROM information_schema.tables')).toMatch(/금지/);
      expect(validateSignalSql('SELECT count(*) FROM pg_catalog.pg_tables')).toMatch(/금지/);
    });

    it('DML이 CTE/본문에 숨어도 차단', () => {
      expect(
        validateSignalSql(
          'WITH x AS (DELETE FROM schedules WHERE user_id = $1 RETURNING 1) SELECT 1',
        ),
      ).not.toBeNull();
    });

    it('$3+ 플레이스홀더 차단 ($1/$2만)', () => {
      expect(
        validateSignalSql('SELECT 1 FROM schedules WHERE user_id = $1 AND date = $2 AND x = $3'),
      ).toMatch(/플레이스홀더/);
    });

    it('비화이트리스트 테이블 — 재정 (assets/incomes)', () => {
      expect(validateSignalSql('SELECT sum(value) FROM assets WHERE user_id = $1')).toMatch(
        /화이트리스트 밖/,
      );
      expect(validateSignalSql('SELECT sum(amount) FROM incomes WHERE user_id = $1')).toMatch(
        /화이트리스트 밖/,
      );
    });

    it('비화이트리스트 테이블 — 시스템/메타 (signal_defs/users/custom_instructions)', () => {
      expect(
        validateSignalSql(
          "SELECT count(*) FROM signal_defs WHERE user_id = $1 AND status='active'",
        ),
      ).toMatch(/화이트리스트 밖/);
      expect(validateSignalSql('SELECT count(*) FROM users WHERE user_id = $1')).toMatch(
        /화이트리스트 밖/,
      );
      expect(
        validateSignalSql('SELECT count(*) FROM custom_instructions WHERE user_id = $1'),
      ).toMatch(/화이트리스트 밖/);
    });

    it('원국 원문 diary_entries 차단 (헌장 ① — 메타 태그만 허용)', () => {
      expect(validateSignalSql('SELECT count(*) FROM diary_entries WHERE user_id = $1')).toMatch(
        /화이트리스트 밖/,
      );
    });

    it('user_id 미필터 / 타값', () => {
      expect(validateSignalSql('SELECT count(*) FROM schedules WHERE date = $2')).toMatch(
        /user_id = \$1/,
      );
      expect(validateSignalSql('SELECT count(*) FROM schedules WHERE user_id = 2')).toMatch(
        /user_id = \$1/,
      );
    });
  });

  describe('상수 sanity', () => {
    it('SIGNAL_ROW_CAP은 작은 양수', () => {
      expect(SIGNAL_ROW_CAP).toBeGreaterThan(0);
      expect(SIGNAL_ROW_CAP).toBeLessThanOrEqual(10);
    });

    it('화이트리스트는 재정·시스템 테이블을 포함하지 않는다', () => {
      for (const t of [
        'assets',
        'incomes',
        'signal_defs',
        'pattern_links',
        'users',
        'diary_entries',
      ]) {
        expect(SIGNAL_TABLE_WHITELIST.has(t)).toBe(false);
      }
    });

    it('화이트리스트는 5개 신호 도메인의 행동 테이블을 포함한다', () => {
      for (const t of [
        'schedules',
        'routine_records',
        'sleep_records',
        'expenses',
        'diary_meta_tags',
      ]) {
        expect(SIGNAL_TABLE_WHITELIST.has(t)).toBe(true);
      }
    });
  });
});
