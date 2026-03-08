// 수동 접속 테스트: npx tsx db/test-connection.ts
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'],
  });

  try {
    const result = await pool.query<{ now: Date; db: string }>(
      'SELECT NOW() AS now, current_database() AS db',
    );
    console.log('Connection successful!');
    console.log('Time:', result.rows[0].now);
    console.log('Database:', result.rows[0].db);

    const tables = await pool.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log(
      'Tables:',
      tables.rows.map((r) => r.tablename),
    );
  } catch (err) {
    console.error('Connection failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

void main();
