import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { LLMToolDefinition } from './llm.js';

interface MCPClientState {
  client: Client;
  transport: StdioClientTransport;
  tools: LLMToolDefinition[];
}

let state: MCPClientState | null = null;
let notionApiKeyCache: string | null = null;

const stripNotionVersion = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const props = schema.properties as Record<string, unknown> | undefined;
  if (!props || !('Notion-Version' in props)) return schema;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { 'Notion-Version': _notionVersion, ...restProps } = props;
  const required = (schema.required as string[] | undefined)?.filter(
    (r) => r !== 'Notion-Version',
  );

  return { ...schema, properties: restProps, ...(required ? { required } : {}) };
};

export const connectMCP = async (notionApiKey: string): Promise<void> => {
  if (state) {
    console.warn('[MCP] 이미 연결되어 있습니다');
    return;
  }

  notionApiKeyCache = notionApiKey;

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
    inputSchema: stripNotionVersion(
      tool.inputSchema as Record<string, unknown>,
    ),
  }));

  state = { client, transport, tools };

  // MCP 서버 프로세스가 죽으면 state를 초기화하여 다음 요청 시 자동 재연결
  transport.onclose = (): void => {
    console.warn('[MCP] 연결 끊김 — 다음 요청 시 자동 재연결');
    state = null;
  };
  transport.onerror = (err: Error): void => {
    console.error('[MCP] 전송 오류:', err.message);
    state = null;
  };

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

/** 현재 state를 반환하거나 재연결 후 반환. 실패 시 throw */
const getConnectedState = async (): Promise<MCPClientState> => {
  if (state) return state;
  if (!notionApiKeyCache) {
    throw new Error('[MCP] 연결되지 않음. connectMCP()를 먼저 호출하세요.');
  }
  // eslint-disable-next-line no-console
  console.log('[MCP] 재연결 시도...');
  await connectMCP(notionApiKeyCache);
  if (!state) throw new Error('[MCP] 재연결 실패');
  return state;
};

const extractTextContent = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  return (result.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
};

export const callMCPTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<string> => {
  let conn = await getConnectedState();

  try {
    const result = await conn.client.callTool({ name, arguments: args });
    return extractTextContent(result);
  } catch (error: unknown) {
    // 연결 끊김으로 인한 실패 시 한 번 재연결 후 재시도
    const msg = error instanceof Error ? error.message : String(error);
    if (/closed|EPIPE|ECONNRESET|transport|disconnected/i.test(msg)) {
      console.warn('[MCP] 연결 오류 감지, 재연결 후 재시도:', msg.slice(0, 200));
      state = null;
      conn = await getConnectedState();
      const result = await conn.client.callTool({ name, arguments: args });
      return extractTextContent(result);
    }
    throw error;
  }
};

export const disconnectMCP = async (): Promise<void> => {
  if (!state) return;
  await state.transport.close();
  state = null;
  // eslint-disable-next-line no-console
  console.log('[MCP] Notion MCP 서버 연결 해제');
};
