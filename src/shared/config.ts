import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const LLM_PROVIDERS = ['groq', 'anthropic', 'gemini'] as const;
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
    provider: requireLLMProvider('LLM_PROVIDER', 'gemini'),
    model: process.env['LLM_MODEL'] ?? '',
    groqApiKey: process.env['GROQ_API_KEY'] ?? '',
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
  },
  channels: {
    life: requireEnv('LIFE_CHANNEL_ID'),
  },
  db: {
    url: requireEnv('DATABASE_URL'),
  },
} as const;
