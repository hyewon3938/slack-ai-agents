import { queryFixedCosts, ensureFixedCostExpenses } from './fixed-cost-ensure';

// 고정비 조회·자동기록은 순환 import(queries → facade → queries) 방지를 위해 별도 모듈로 이동.
// 기존 import 경로 호환을 위해 여기서 재수출한다.
export { queryFixedCosts, ensureFixedCostExpenses };

// 도메인별 쿼리는 queries/ 아래 파일로 나뉘어 있다.
// 기존 import 경로 호환을 위해 여기서 전부 재수출한다.
export * from './queries/expenses';
export * from './queries/month-summary';
export * from './queries/fixed-costs';
export * from './queries/assets';
export * from './queries/planned';
export * from './queries/daily-log';
