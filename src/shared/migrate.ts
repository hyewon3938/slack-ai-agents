import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { query } from './db.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../db/migrations');

/** 마이그레이션 추적 테이블 생성 */
const ensureMigrationsTable = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

/** 적용 완료된 마이그레이션 목록 조회 */
const getAppliedMigrations = async (): Promise<Set<string>> => {
  const result = await query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  return new Set(result.rows.map((r) => r.filename));
};

/** 미적용 마이그레이션을 순서대로 실행 */
export const runMigrations = async (): Promise<void> => {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of sqlFiles) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`[Migrate] 적용 중: ${file}`);
    await query(sql);
    await query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    count++;
  }

  if (count > 0) {
    console.log(`[Migrate] ${count}개 마이그레이션 적용 완료`);
  } else {
    console.log('[Migrate] 적용할 마이그레이션 없음');
  }
};
