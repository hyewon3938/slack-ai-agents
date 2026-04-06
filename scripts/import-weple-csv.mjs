/**
 * 위플 가계부 CSV → expenses 테이블 마이그레이션 스크립트
 *
 * 실행:
 *   node scripts/import-weple-csv.mjs <csv_path>
 *
 * 전제조건:
 *   - DATABASE_URL 환경변수 설정
 *   - 030_budget_expenses 마이그레이션 적용 완료
 *   - users 테이블에 user_id=1 존재
 *
 * CSV 형식 (UTF-16LE):
 *   사용자, 거래일, 수입/지출, 금액, 분류, 하위 분류, 내역, 지불, 카드, 메모
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');

const CSV_PATH = process.argv[2];
if (!CSV_PATH) {
  console.error('사용법: node scripts/import-weple-csv.mjs <csv_path>');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}

const USER_ID = 1;

/** CSV (UTF-16LE) → UTF-8 파싱 */
function parseWepleCSV(filePath) {
  const buf = readFileSync(filePath);
  // UTF-16LE BOM (FF FE) 처리
  const text = buf.toString('utf16le').replace(/^\uFEFF/, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const rows = [];
  for (const line of lines.slice(1)) {
    // CSV 파싱: 쉼표+공백 구분
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 8) continue;

    const [, dateStr, type, amountStr, category, , description, paymentMethod] = cols;
    if (!dateStr || !type || type === '수입/지출') continue;

    // 수입은 스킵 (리커밋 매출은 별도 관리)
    if (type === '수입') continue;
    if (type !== '지출') continue;

    const amount = parseInt(amountStr.replace(/,/g, ''), 10);
    if (isNaN(amount) || amount <= 0) continue;

    const date = dateStr.trim();

    // 할부 패턴 파싱: "내역(N/M)" → installment_num=N, installment_total=M
    const installmentMatch = description ? description.match(/^(.*?)\((\d+)\/(\d+)\)\s*$/) : null;
    const isInstallment = installmentMatch !== null;
    const installmentNum = installmentMatch ? parseInt(installmentMatch[2], 10) : null;
    const installmentTotal = installmentMatch ? parseInt(installmentMatch[3], 10) : null;
    const cleanDesc = installmentMatch ? installmentMatch[1].trim() : (description?.trim() || null);
    // 할부 그룹 키: 내역(N/M) 제거한 텍스트 + 금액 * total (원금 추정)
    const installmentGroup = isInstallment
      ? `${cleanDesc || category}_${amount * (installmentTotal ?? 1)}`
      : null;

    // '카드 환불 예정' 카테고리 처리
    const finalCategory = (category === '카드 환불 예정') ? '환불' : (category || '기타');

    rows.push({
      date,
      amount,
      category: finalCategory,
      description: cleanDesc,
      payment_method: paymentMethod || '카드',
      is_installment: isInstallment,
      installment_num: installmentNum,
      installment_total: installmentTotal,
      installment_group: installmentGroup,
      source: 'import',
    });
  }
  return rows;
}

async function importExpenses(rows) {
  const useSSL = DATABASE_URL.includes('sslmode=require');
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ...(useSSL && { ssl: { rejectUnauthorized: false } }),
  });

  const client = await pool.connect();
  try {
    // 기존 import 데이터 중복 방지 확인
    const existing = await client.query(
      `SELECT COUNT(*) as cnt FROM expenses WHERE user_id = $1 AND source = 'import'`,
      [USER_ID],
    );
    const existingCount = parseInt(existing.rows[0].cnt, 10);
    if (existingCount > 0) {
      console.log(`이미 import된 데이터 ${existingCount}건이 있습니다.`);
      const answer = process.env.FORCE_REIMPORT === 'true';
      if (!answer) {
        console.log('재실행하려면 FORCE_REIMPORT=true 환경변수를 설정하세요.');
        return;
      }
      await client.query(`DELETE FROM expenses WHERE user_id = $1 AND source = 'import'`, [USER_ID]);
      console.log('기존 import 데이터 삭제 완료.');
    }

    await client.query('BEGIN');

    let inserted = 0;
    for (const row of rows) {
      await client.query(
        `INSERT INTO expenses (
          user_id, date, amount, category, description, payment_method,
          is_installment, installment_num, installment_total, installment_group, source
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          USER_ID,
          row.date,
          row.amount,
          row.category,
          row.description,
          row.payment_method,
          row.is_installment,
          row.installment_num,
          row.installment_total,
          row.installment_group,
          row.source,
        ],
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`완료: ${inserted}건 임포트됨`);

    // 요약 출력
    const summary = await client.query(
      `SELECT
        TO_CHAR(date, 'YYYY-MM') as month,
        COUNT(*) as cnt,
        SUM(amount) as total
       FROM expenses
       WHERE user_id = $1 AND source = 'import'
       GROUP BY 1 ORDER BY 1`,
      [USER_ID],
    );
    console.log('\n월별 요약:');
    for (const r of summary.rows) {
      console.log(`  ${r.month}: ${r.cnt}건, ${Number(r.total).toLocaleString()}원`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

const rows = parseWepleCSV(CSV_PATH);
console.log(`파싱 완료: 총 ${rows.length}건 (할부: ${rows.filter((r) => r.is_installment).length}건)`);

importExpenses(rows).catch((err) => {
  console.error('임포트 실패:', err);
  process.exit(1);
});
