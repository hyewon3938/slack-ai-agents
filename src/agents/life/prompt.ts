import { query } from '../../shared/db.js';
import { getTodayString, getWeekReference } from '../../shared/kst.js';
import { buildLifeContext } from '../../shared/life/context-build.js';
import {
  buildIntroSection,
  NAG_GUIDE_SECTION,
  CONVERSATION_SECTION,
  DB_SCHEMA_SECTION,
  buildUserIdFilterSection,
  SCHEDULE_QUERY_SECTION,
  buildScheduleInsertSection,
  SCHEDULE_FORMAT_SECTION,
  buildScheduleRulesSection,
  SLEEP_RECORD_SECTION,
  buildSleepModifySection,
  REMINDER_SECTION,
  DATA_RULES_SECTION,
  CUSTOM_INSTRUCTION_SECTION,
  ANALYSIS_SECTION,
} from './prompt-sections.js';

/** 커스텀 지시사항 상한. 초과 시 오래된 auto부터 비활성화 */
const MAX_CUSTOM_INSTRUCTIONS = 20;

/** DB에서 커스텀 지시사항 조회 (카테고리별 그룹화, active만, 상한 적용) */
const loadCustomInstructions = async (userId: number): Promise<string> => {
  try {
    // 상한 초과 시 오래된 auto 지시사항 비활성화
    const countResult = await query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM custom_instructions WHERE active = true AND user_id = $1`,
      [userId],
    );
    const total = Number(countResult.rows[0]?.cnt ?? 0);
    if (total > MAX_CUSTOM_INSTRUCTIONS) {
      const excess = total - MAX_CUSTOM_INSTRUCTIONS;
      await query(
        `UPDATE custom_instructions SET active = false
         WHERE id IN (
           SELECT id FROM custom_instructions
           WHERE active = true AND source = 'auto' AND user_id = $1
           ORDER BY created_at ASC LIMIT $2
         )`,
        [userId, excess],
      );
    }

    const result = await query<{ instruction: string; category: string }>(
      `SELECT instruction, category FROM custom_instructions
       WHERE active = true AND user_id = $1 ORDER BY category, created_at`,
      [userId],
    );
    if (result.rows.length === 0) return '';

    const grouped = new Map<string, string[]>();
    for (const row of result.rows) {
      const list = grouped.get(row.category) ?? [];
      list.push(row.instruction);
      grouped.set(row.category, list);
    }

    let lines = '';
    for (const [cat, instructions] of grouped) {
      lines += `\n[${cat}]\n`;
      lines += instructions.map((i) => `- ${i}`).join('\n');
    }
    return `\n\n## 사용자 지시사항${lines}`;
  } catch {
    return '';
  }
};

/** v2 통합 에이전트 시스템 프롬프트 */
export const buildLifeSystemPrompt = async (channelId: string, userId: number): Promise<string> => {
  const today = getTodayString();
  void channelId; // 향후 채널별 설정 확장용
  const [customInstructions, lifeContext] = await Promise.all([
    loadCustomInstructions(userId),
    buildLifeContext('conversation', userId),
  ]);

  const weekRef = getWeekReference();

  const sections = [
    buildIntroSection(today, weekRef, lifeContext),
    NAG_GUIDE_SECTION,
    CONVERSATION_SECTION,
    DB_SCHEMA_SECTION,
    buildUserIdFilterSection(userId),
    SCHEDULE_QUERY_SECTION,
    buildScheduleInsertSection(userId),
    SCHEDULE_FORMAT_SECTION,
    buildScheduleRulesSection(userId),
    SLEEP_RECORD_SECTION,
    buildSleepModifySection(userId),
    REMINDER_SECTION,
    DATA_RULES_SECTION,
    CUSTOM_INSTRUCTION_SECTION,
    ANALYSIS_SECTION,
  ];

  return `${sections.join('\n\n')}${customInstructions}`;
};
