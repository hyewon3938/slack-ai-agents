/**
 * SQL 도구 실행기: post-modify 훅 · 확인 카드 전송 · 감사 로그 · 실행.
 */

import type { DryRunResult } from '../db.js';
import { queryWithClient, queryWithRowLimit, dryRunAffectedRows } from '../db.js';
import { extractTargetTable } from '../pending-display.js';
import { createPendingModify } from '../pending-modify.js';
import { getSchemaInfo } from './schema.js';
import {
  extractFirstKeyword,
  validateSelectQuery,
  validateModifyQuery,
  validateUserIdFilter,
  validateCustomInstruction,
} from './validation.js';

// ---- 상수 ----

const SQL_TIMEOUT_MS = 10_000;
const MAX_MODIFY_ROWS = 50; // 한 번에 변경 가능한 최대 행 수

// ---- Post-modify 훅 ----

export type PostModifyHook = (sql: string) => void | Promise<void>;

let postModifyHook: PostModifyHook | null = null;

/** modify_db 실행 후 호출될 훅 등록 */
export const setPostModifyHook = (hook: PostModifyHook): void => {
  postModifyHook = hook;
};

// ---- Confirm card sender ----

export interface SQLToolContext {
  slackUserId?: string;
  slackChannel?: string;
  slackThreadTs?: string;
}

export type ConfirmCardSender = (params: {
  token: string;
  tableName: string | null;
  rows: Record<string, unknown>[];
  rowCount: number;
  operation: 'DELETE' | 'UPDATE';
  context: SQLToolContext & { userId: number };
}) => Promise<void>;

let confirmCardSender: ConfirmCardSender | null = null;

/** 확인 카드 전송 함수 주입. app.ts에서 Slack client 바인딩하여 호출 */
export const setConfirmCardSender = (sender: ConfirmCardSender): void => {
  confirmCardSender = sender;
};

/** 테스트용: sender 해제 */
export const clearConfirmCardSender = (): void => {
  confirmCardSender = null;
};

// ---- 감사 로그 ----

/** SQL 실행 로그 (도구명, SQL 앞부분, 결과 요약) */
const logSQLExecution = (
  tool: string,
  sql: string,
  result: { rowCount?: number | null; error?: string },
): void => {
  const truncatedSQL = sql.length > 200 ? sql.slice(0, 200) + '...' : sql;
  if (result.error) {
    console.warn(`[SQL Audit] BLOCKED ${tool}: ${truncatedSQL} → ${result.error}`);
  } else {
    console.log(`[SQL Audit] ${tool}: ${truncatedSQL} → ${result.rowCount ?? 0} rows`);
  }
};

// ---- SQL 도구 실행기 ----

/**
 * SQL 도구 실행기.
 * agent-loop의 executeToolCall 시그니처: (name, args) => Promise<string>
 * userId: 현재 사용자의 DB user_id (기본값 1)
 * context: Slack 채널/스레드 정보 (modify_db 확인 카드 전송용)
 */
export const executeSQLTool = async (
  name: string,
  args: Record<string, unknown>,
  userId: number = 1,
  context?: SQLToolContext,
): Promise<string> => {
  switch (name) {
    case 'query_db': {
      const sql = args['sql'] as string;
      const error = validateSelectQuery(sql) ?? validateUserIdFilter(sql, userId);
      if (error) {
        logSQLExecution('query_db', sql, { error });
        return JSON.stringify({ error });
      }

      const result = await queryWithClient(sql, SQL_TIMEOUT_MS);
      logSQLExecution('query_db', sql, { rowCount: result.rowCount });
      return JSON.stringify({ rows: result.rows, rowCount: result.rowCount });
    }

    case 'modify_db': {
      const sql = args['sql'] as string;
      const error =
        validateModifyQuery(sql) ??
        validateUserIdFilter(sql, userId) ??
        validateCustomInstruction(sql);
      if (error) {
        logSQLExecution('modify_db', sql, { error });
        return JSON.stringify({ error });
      }

      // DELETE/UPDATE: 영향 row 수가 임계치 이상이면 확인 카드로 전환
      const keyword = extractFirstKeyword(sql);
      if ((keyword === 'DELETE' || keyword === 'UPDATE') && confirmCardSender) {
        const threshold = Number(process.env['MODIFY_CONFIRM_THRESHOLD'] ?? 3);
        let dryRun: DryRunResult;
        try {
          dryRun = await dryRunAffectedRows(sql, SQL_TIMEOUT_MS);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logSQLExecution('modify_db', sql, { error: `dry-run 실패: ${msg}` });
          return JSON.stringify({ error: `쿼리 검증 실패: ${msg}` });
        }

        if (dryRun.rowCount >= threshold) {
          const tableName = extractTargetTable(sql);
          const token = await createPendingModify({
            userId,
            sqlText: sql,
            rowCount: dryRun.rowCount,
            tableName,
            slackChannel: context?.slackChannel,
            slackThreadTs: context?.slackThreadTs,
          });

          try {
            await confirmCardSender({
              token,
              tableName,
              rows: dryRun.rows,
              rowCount: dryRun.rowCount,
              operation: keyword,
              context: { userId, ...context },
            });
          } catch (err: unknown) {
            console.error('[SQL Tools] confirm card 전송 실패:', err);
          }

          logSQLExecution('modify_db', sql, { error: `confirm pending (${dryRun.rowCount} rows)` });
          // __earlyExit 마커: agent-loop가 감지해 LLM 재호출 없이 즉시 종료
          return JSON.stringify({
            __earlyExit: true,
            pending: true,
            rowCount: dryRun.rowCount,
            message: 'Slack 확인 카드를 보냈어. 거기서 실행/취소해줘.',
          });
        }
      }

      // 즉시 실행 경로 (INSERT 전체, 또는 DELETE/UPDATE 중 영향 row < threshold)
      const result = await queryWithRowLimit(sql, SQL_TIMEOUT_MS, MAX_MODIFY_ROWS);
      logSQLExecution('modify_db', sql, { rowCount: result.rowCount });

      // fire-and-forget: 훅 실행 (응답 지연 없음)
      if (postModifyHook) {
        Promise.resolve(postModifyHook(sql)).catch((err: unknown) => {
          console.error('[SQL Tools] post-modify hook 오류:', err);
        });
      }

      return JSON.stringify({ rowCount: result.rowCount, rows: result.rows });
    }

    case 'get_schema': {
      const tableName = args['table_name'] as string | undefined;
      return getSchemaInfo(tableName);
    }

    default:
      return JSON.stringify({ error: `알 수 없는 SQL 도구: ${name}` });
  }
};
