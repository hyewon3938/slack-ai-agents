import { Client as NotionClient } from '@notionhq/client';

export const createNotionClient = (apiKey: string): NotionClient => {
  return new NotionClient({ auth: apiKey });
};

// Cron 조회용 함수들은 Phase 3에서 추가
