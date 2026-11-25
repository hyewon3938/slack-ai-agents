import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const LLM_PROVIDERS = ['anthropic'] as const;
type LLMProvider = (typeof LLM_PROVIDERS)[number];

function requireLLMProvider(key: string, defaultValue: LLMProvider): LLMProvider {
  const value = process.env[key] ?? defaultValue;
  if (!(LLM_PROVIDERS as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${key}: "${value}". Must be one of: ${LLM_PROVIDERS.join(', ')}`);
  }
  return value as LLMProvider;
}

export const CONFIG = {
  slack: {
    botToken: requireEnv('SLACK_BOT_TOKEN'),
    signingSecret: requireEnv('SLACK_SIGNING_SECRET'),
    appToken: requireEnv('SLACK_APP_TOKEN'),
  },
  llm: {
    provider: requireLLMProvider('LLM_PROVIDER', 'anthropic'),
    model: process.env['LLM_MODEL'] ?? '',
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  },
  channels: {
    life: requireEnv('LIFE_CHANNEL_ID'),
    project: process.env['PROJECT_CHANNEL_ID'] ?? '',
    insight: process.env['INSIGHT_CHANNEL_ID'] ?? '',
    money: process.env['MONEY_CHANNEL_ID'] ?? '',
  },
  db: {
    url: requireEnv('DATABASE_URL'),
    /** SQL 도구 전용 역할 연결 문자열 (ADR-0067). 도구 풀이 없을 때의 동작은 sqlToolRequired가 정한다 */
    sqlToolUrl: process.env['SQL_TOOL_DATABASE_URL'] ?? '',
    /**
     * 도구 풀 필수 여부 (#665). 운영 이미지는 Dockerfile이 NODE_ENV=production을 넣어 true가 되고,
     * 도구 풀이 없으면 SQL 도구가 실행을 거절한다. 로컬 개발(yarn dev)과 테스트는 false라 기존 풀로 대신한다.
     */
    sqlToolRequired: process.env['NODE_ENV'] === 'production',
  },
  dbProxy: {
    apiKey: process.env['DB_PROXY_API_KEY'] ?? '',
  },
  modifyConfirmThreshold: Number(process.env['MODIFY_CONFIRM_THRESHOLD'] ?? 3),
} as const;
