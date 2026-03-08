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
  channels: {
    life: requireEnv('LIFE_CHANNEL_ID'),
  },
  db: {
    url: requireEnv('DATABASE_URL'),
  },
  lifeCron: {
    sleepCheck: optionalEnv('LIFE_CRON_SLEEP_CHECK', '50 8 * * *'),
    morningSchedule: optionalEnv('LIFE_CRON_MORNING_SCHEDULE', '0 9 * * *'),
    morning: optionalEnv('LIFE_CRON_MORNING', '5 9 * * *'),
    lunch: optionalEnv('LIFE_CRON_LUNCH', '0 13 * * *'),
    evening: optionalEnv('LIFE_CRON_EVENING', '0 18 * * *'),
    night: optionalEnv('LIFE_CRON_NIGHT', '0 22 * * *'),
    nightReview: optionalEnv('LIFE_CRON_NIGHT_REVIEW', '0 23 * * *'),
  },
} as const;
