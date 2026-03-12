import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAgent, registerMessageHandler } from '../router.js';
import type { AgentHandler } from '../router.js';

// ─── mock App ───────────────────────────────────────────

const createMockApp = () => {
  let messageCallback: (args: Record<string, unknown>) => Promise<void>;
  return {
    message: (cb: (args: Record<string, unknown>) => Promise<void>) => {
      messageCallback = cb;
    },
    /** 등록된 message 핸들러를 직접 호출 */
    simulateMessage: (args: Record<string, unknown>) => messageCallback(args),
  };
};

// ─── registerAgent ──────────────────────────────────────

describe('registerAgent', () => {
  it('채널에 핸들러를 등록한다', () => {
    const handler: AgentHandler = vi.fn(async () => {});
    // registerAgent는 에러 없이 실행되면 성공
    expect(() => registerAgent('C_TEST', handler)).not.toThrow();
  });
});

// ─── registerMessageHandler ─────────────────────────────

describe('registerMessageHandler', () => {
  beforeEach(() => {
    // channelAgentMap은 모듈 레벨 Map이므로 테스트 간 격리를 위해 새 핸들러 등록
  });

  it('등록된 채널의 메시지를 핸들러에 전달한다', async () => {
    const handler: AgentHandler = vi.fn(async () => {});
    const channelId = 'C_ROUTE_1';
    registerAgent(channelId, handler);

    const mockApp = createMockApp();
    registerMessageHandler(mockApp as never);

    const say = vi.fn();
    await mockApp.simulateMessage({
      message: { channel: channelId, text: '안녕' },
      say,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(say).not.toHaveBeenCalled(); // say는 핸들러에 전달만
  });

  it('봇 메시지는 무시한다', async () => {
    const handler: AgentHandler = vi.fn(async () => {});
    const channelId = 'C_ROUTE_2';
    registerAgent(channelId, handler);

    const mockApp = createMockApp();
    registerMessageHandler(mockApp as never);

    await mockApp.simulateMessage({
      message: { channel: channelId, text: '봇 응답', bot_id: 'B123' },
      say: vi.fn(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('subtype이 있는 메시지는 무시한다', async () => {
    const handler: AgentHandler = vi.fn(async () => {});
    const channelId = 'C_ROUTE_3';
    registerAgent(channelId, handler);

    const mockApp = createMockApp();
    registerMessageHandler(mockApp as never);

    await mockApp.simulateMessage({
      message: { channel: channelId, text: '편집됨', subtype: 'message_changed' },
      say: vi.fn(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('등록되지 않은 채널의 메시지는 무시한다', async () => {
    const handler: AgentHandler = vi.fn(async () => {});
    registerAgent('C_ROUTE_4', handler);

    const mockApp = createMockApp();
    registerMessageHandler(mockApp as never);

    await mockApp.simulateMessage({
      message: { channel: 'C_UNKNOWN', text: '안녕' },
      say: vi.fn(),
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
