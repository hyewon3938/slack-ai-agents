import { randomBytes } from 'crypto';
import { query, queryOne } from './db.js';

const TOKEN_BYTES = 8; // 16 hex chars
const TTL_MINUTES = 5;

export interface PendingModifyRow {
  id: number;
  token: string;
  user_id: number;
  sql_text: string;
  dry_run_row_count: number;
  slack_channel: string | null;
  slack_thread_ts: string | null;
  created_at: string;
  expires_at: string;
  executed_at: string | null;
  canceled_at: string | null;
}

const generateToken = (): string => randomBytes(TOKEN_BYTES).toString('hex');

/** 새 pending_modify 생성 후 token 반환 */
export const createPendingModify = async (params: {
  userId: number;
  sqlText: string;
  rowCount: number;
  slackChannel?: string;
  slackThreadTs?: string;
}): Promise<string> => {
  const token = generateToken();
  await query(
    `INSERT INTO pending_modify
       (token, user_id, sql_text, dry_run_row_count,
        slack_channel, slack_thread_ts, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '${TTL_MINUTES} minutes')`,
    [
      token,
      params.userId,
      params.sqlText,
      params.rowCount,
      params.slackChannel ?? null,
      params.slackThreadTs ?? null,
    ],
  );
  return token;
};

/** token + user_id로 활성 pending 조회. 다른 유저의 token 접근 차단. */
export const findActivePending = async (
  token: string,
  userId: number,
): Promise<PendingModifyRow | null> =>
  queryOne<PendingModifyRow>(
    `SELECT * FROM pending_modify
     WHERE token = $1
       AND user_id = $2
       AND executed_at IS NULL
       AND canceled_at IS NULL
       AND expires_at > NOW()`,
    [token, userId],
  );

/** 실행 완료 마킹 */
export const markExecuted = async (id: number): Promise<void> => {
  await query(`UPDATE pending_modify SET executed_at = NOW() WHERE id = $1`, [id]);
};

/** 취소 마킹 */
export const markCanceled = async (id: number): Promise<void> => {
  await query(`UPDATE pending_modify SET canceled_at = NOW() WHERE id = $1`, [id]);
};
