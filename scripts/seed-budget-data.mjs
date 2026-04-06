/**
 * 초기 예산 데이터 시딩 스크립트
 * - 월 고정비 (fixed_costs)
 * - 자산/자금 현황 (assets)
 * - 초기 예산 (budgets)
 *
 * 실행 전: 아래 FIXED_COSTS, ASSETS, INITIAL_BUDGET 값을 실제 값으로 채워넣고 실행.
 * 실행:
 *   node scripts/seed-budget-data.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}

const USER_ID = 1;

/**
 * 월 고정비 목록.
 * amount: 기본 금액(원), is_variable: 매달 변동 여부
 * 실행 전 실제 금액으로 수정할 것.
 */
const FIXED_COSTS = [
  // 주거
  { name: '주담대 이자', amount: 0, category: '주거', is_variable: true, day_of_month: 25, memo: '변동금리, 매달 확인 필요' },
  { name: '관리비', amount: 0, category: '주거', is_variable: true, day_of_month: null, memo: '매달 다름, 직접 입력 필요' },
  // 보험/세금
  { name: '건강보험', amount: 0, category: '보험', is_variable: false, day_of_month: null, memo: null },
  // 통신
  { name: '폰 통신비', amount: 0, category: '통신', is_variable: false, day_of_month: null, memo: null },
  { name: '인터넷', amount: 0, category: '통신', is_variable: false, day_of_month: null, memo: null },
  // 구독
  { name: '클로드 구독', amount: 0, category: '구독', is_variable: true, day_of_month: null, memo: '요금제에 따라 변동' },
  { name: '클로드 API', amount: 0, category: '구독', is_variable: true, day_of_month: null, memo: '사용량에 따라 변동' },
  { name: '유튜브 프리미엄', amount: 0, category: '구독', is_variable: false, day_of_month: null, memo: null },
  { name: '쿠팡 구독', amount: 0, category: '구독', is_variable: false, day_of_month: null, memo: null },
];

/**
 * 자산/자금 현황.
 * balance: 현재 잔액, available_amount: 실제 사용 가능 금액
 * 실행 전 실제 금액으로 수정할 것.
 */
const ASSETS = [
  {
    name: '마이너스 통장',
    balance: 0,
    type: 'credit',
    available_amount: 0,
    is_emergency: false,
    memo: '실제 한도와 최소 유보금액 확인 후 입력',
  },
  {
    name: '차용금',
    balance: 0,
    type: 'loan',
    available_amount: 0,
    is_emergency: false,
    memo: null,
  },
  {
    name: '주식',
    balance: 0,
    type: 'investment',
    available_amount: 0,
    is_emergency: true,
    memo: '최후의 보루. 가급적 매도하지 않음.',
  },
];

/**
 * 초기 예산.
 * total_budget: 월 가변 지출 예산 (고정비 제외), daily_budget: 일일 목표
 * 실행 전 실제 값으로 수정할 것.
 */
const INITIAL_BUDGET = {
  year_month: new Date().toISOString().slice(0, 7),
  total_budget: 0,
  daily_budget: 0,
  notes: '실행 전 금액 설정 필요',
};

async function seed() {
  const useSSL = DATABASE_URL.includes('sslmode=require');
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ...(useSSL && { ssl: { rejectUnauthorized: false } }),
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 고정비 시딩 (중복 방지: 이미 있으면 스킵)
    const existingFC = await client.query(
      `SELECT COUNT(*) as cnt FROM fixed_costs WHERE user_id = $1`,
      [USER_ID],
    );
    if (parseInt(existingFC.rows[0].cnt, 10) > 0) {
      console.log('고정비 데이터가 이미 존재합니다. 스킵.');
    } else {
      for (const fc of FIXED_COSTS) {
        await client.query(
          `INSERT INTO fixed_costs (user_id, name, amount, category, is_variable, day_of_month, memo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [USER_ID, fc.name, fc.amount, fc.category, fc.is_variable, fc.day_of_month, fc.memo],
        );
      }
      console.log(`고정비 ${FIXED_COSTS.length}개 시딩 완료`);
    }

    // 자산 시딩 (중복 방지)
    const existingAssets = await client.query(
      `SELECT COUNT(*) as cnt FROM assets WHERE user_id = $1`,
      [USER_ID],
    );
    if (parseInt(existingAssets.rows[0].cnt, 10) > 0) {
      console.log('자산 데이터가 이미 존재합니다. 스킵.');
    } else {
      for (const asset of ASSETS) {
        await client.query(
          `INSERT INTO assets (user_id, name, balance, type, available_amount, is_emergency, memo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [USER_ID, asset.name, asset.balance, asset.type, asset.available_amount, asset.is_emergency, asset.memo],
        );
      }
      console.log(`자산 ${ASSETS.length}개 시딩 완료`);
    }

    // 초기 예산 시딩
    await client.query(
      `INSERT INTO budgets (user_id, year_month, total_budget, daily_budget, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, year_month) DO NOTHING`,
      [USER_ID, INITIAL_BUDGET.year_month, INITIAL_BUDGET.total_budget, INITIAL_BUDGET.daily_budget, INITIAL_BUDGET.notes],
    );
    console.log(`예산 시딩 완료: ${INITIAL_BUDGET.year_month}`);

    await client.query('COMMIT');
    console.log('\n시딩 완료. 에이전트 또는 웹 대시보드에서 실제 값으로 수정하세요.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('시딩 실패:', err);
  process.exit(1);
});
