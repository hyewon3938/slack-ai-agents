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

export const CONFIG = {
  slack: {
    botToken: requireEnv('SLACK_BOT_TOKEN'),
    signingSecret: requireEnv('SLACK_SIGNING_SECRET'),
    appToken: requireEnv('SLACK_APP_TOKEN'),
  },
  llm: {
    provider: optionalEnv('LLM_PROVIDER', 'gemini') as 'groq' | 'anthropic' | 'gemini',
    groqApiKey: process.env['GROQ_API_KEY'] ?? '',
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
  },
  notion: {
    apiKey: requireEnv('NOTION_API_KEY'),
    scheduleDbId: requireEnv('NOTION_SCHEDULE_DB_ID'),
  },
  channels: {
    schedule: requireEnv('SCHEDULE_CHANNEL_ID'),
  },
  cron: {
    morning: optionalEnv('CRON_MORNING', '0 9 * * *'),
    lunch: optionalEnv('CRON_LUNCH', '0 12 * * *'),
    evening: optionalEnv('CRON_EVENING', '0 18 * * *'),
  },
} as const;
