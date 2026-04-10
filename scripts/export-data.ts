/**
 * 로컬 DB → SQL dump 생성 스크립트.
 * Usage: node --import tsx scripts/export-data.ts > /tmp/data-dump.sql
 */
import pg from 'pg';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  console.error('DATABASE_URL 환경변수 필요');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

const TABLES = [
  'routine_templates',
  'schedules',
  'routine_records',
  'sleep_records',
  'custom_instructions',
  'notification_settings',
  'reminders',
];

/** DATE 컬럼은 로컬 타임존 기준으로 YYYY-MM-DD 출력 (KST→UTC 날짜 밀림 방지) */
function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** DATE vs TIMESTAMPTZ 구분: 시·분·초가 모두 0이면 DATE로 판단 */
function isDateOnly(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) {
    return isDateOnly(val) ? `'${formatLocalDate(val)}'` : `'${val.toISOString()}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  const lines: string[] = [];

  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]);

    // notification_settings는 시드 데이터 충돌 방지
    if (table === 'notification_settings') {
      lines.push(`DELETE FROM ${table};`);
    }

    for (const row of rows) {
      const values = columns.map((col) => escapeValue(row[col]));
      lines.push(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;`,
      );
    }

    // 시퀀스 리셋
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1));`,
    );
    lines.push('');
  }

  console.log(lines.join('\n'));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
