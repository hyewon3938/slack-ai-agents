import type { LLMClient } from '../../shared/llm.js';

export interface LifeCronConfig {
  channelId: string;
  llmClient: LLMClient;
}
