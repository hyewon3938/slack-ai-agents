import type { LLMToolDefinition } from '../../shared/llm.js';
import { getMCPTools } from '../../shared/mcp-client.js';

const SCHEDULE_TOOL_NAMES = new Set([
  'API-post-search',          // 일정 검색 (빈 쿼리로 전체 조회 가능)
  'API-post-page',            // 새 일정 생성
  'API-patch-page',           // 일정 수정 (상태, 날짜 등)
  'API-retrieve-a-page',      // 일정 상세 조회
  'API-patch-block-children', // 페이지 내부에 블록(내용) 추가
  'API-get-block-children',   // 페이지 내부 블록(내용) 조회
]);

export const getScheduleTools = (): LLMToolDefinition[] => {
  return getMCPTools().filter((tool) => SCHEDULE_TOOL_NAMES.has(tool.name));
};
