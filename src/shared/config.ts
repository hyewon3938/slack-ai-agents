import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
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
  notion: {
    apiKey: requireEnv('NOTION_API_KEY'),
    scheduleDbId: requireEnv('NOTION_SCHEDULE_DB_ID'),
    routineDbId: requireEnv('NOTION_ROUTINE_DB_ID'),
    sleepDbId: optionalEnv('NOTION_SLEEP_DB_ID', ''),
  },
  channels: {
    schedule: requireEnv('SCHEDULE_CHANNEL_ID'),
    routine: requireEnv('ROUTINE_CHANNEL_ID'),
  },
  cron: {
    morning: optionalEnv('CRON_MORNING', '0 9 * * *'),
    lunch: optionalEnv('CRON_LUNCH', '0 13 * * *'),
    evening: optionalEnv('CRON_EVENING', '0 18 * * *'),
    night: optionalEnv('CRON_NIGHT', '0 23 * * *'),
  },
  db: {
    url: requireEnv('DATABASE_URL'),
  },
  routineCron: {
    morning: optionalEnv('CRON_ROUTINE_MORNING', '0 9 * * *'),
    lunch: optionalEnv('CRON_ROUTINE_LUNCH', '0 13 * * *'),
    evening: optionalEnv('CRON_ROUTINE_EVENING', '0 18 * * *'),
    night: optionalEnv('CRON_ROUTINE_NIGHT', '0 22 * * *'),
  },
} as const;
