// 수동 마이그레이션: npx tsx db/migrate.ts
import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/shared/db.js';
import { runMigrations } from '../src/shared/migrate.js';

const main = async (): Promise<void> => {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    console.error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  await connectDB(dbUrl);
  await runMigrations();
  await disconnectDB();
  console.log('Done.');
};

void main();
