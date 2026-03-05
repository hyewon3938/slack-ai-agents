import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { LLMToolDefinition } from './llm.js';

interface MCPClientState {
  client: Client;
  transport: StdioClientTransport;
  tools: LLMToolDefinition[];
}

let state: MCPClientState | null = null;

export const connectMCP = async (notionApiKey: string): Promise<void> => {
  if (state) {
    console.warn('[MCP] 이미 연결되어 있습니다');
    return;
  }

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: {
      ...process.env as Record<string, string>,
      OPENAPI_MCP_HEADERS: JSON.stringify({
        Authorization: `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
      }),
    },
  });

  const client = new Client(
    { name: 'slack-ai-agents', version: '1.0.0' },
  );

  await client.connect(transport);

  const toolsResult = await client.listTools();
  const tools: LLMToolDefinition[] = toolsResult.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }));

  state = { client, transport, tools };

  // eslint-disable-next-line no-console
  console.log(
    '[MCP] Notion MCP 서버 연결 완료. 사용 가능한 도구:',
    tools.map((t) => t.name),
  );
};

export const getMCPTools = (): LLMToolDefinition[] => {
  if (!state) {
    throw new Error('[MCP] 연결되지 않음. connectMCP()를 먼저 호출하세요.');
  }
  return state.tools;
};

export const callMCPTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<string> => {
  if (!state) {
    throw new Error('[MCP] 연결되지 않음. connectMCP()를 먼저 호출하세요.');
  }

  const result = await state.client.callTool({ name, arguments: args });

  const textContent = (result.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');

  return textContent;
};

export const disconnectMCP = async (): Promise<void> => {
  if (!state) return;
  await state.transport.close();
  state = null;
  // eslint-disable-next-line no-console
  console.log('[MCP] Notion MCP 서버 연결 해제');
};
