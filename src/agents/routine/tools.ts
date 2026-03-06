import type { LLMToolDefinition } from '../../shared/llm.js';
import { getMCPTools } from '../../shared/mcp-client.js';

const ROUTINE_TOOL_NAMES = new Set([
  'API-post-search',          // 루틴 검색 (템플릿/기록 조회)
  'API-post-page',            // 새 루틴 템플릿 생성
  'API-patch-page',           // 루틴 수정 (활성/비활성, 시간대 변경 등)
  'API-retrieve-a-page',      // 루틴 상세 조회
  'API-patch-block-children', // 페이지 내부 블록 추가
  'API-get-block-children',   // 페이지 내부 블록 조회
]);

export const getRoutineTools = async (): Promise<LLMToolDefinition[]> => {
  const tools = await getMCPTools();
  return tools.filter((tool) => ROUTINE_TOOL_NAMES.has(tool.name));
};
