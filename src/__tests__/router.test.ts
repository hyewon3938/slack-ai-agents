import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
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

// ─── 요청 제한 ──────────────────────────────────────────

describe('registerMessageHandler 요청 제한', () => {
  /** 채널에 핸들러를 등록하고 메시지 전송 함수를 돌려준다 (rate limiter는 모듈 단위라 유저 ID를 테스트마다 다르게 쓴다) */
  const setup = (
    channelId: string,
  ): { handler: Mock; say: Mock; send: (user: string, text: string) => Promise<void> } => {
    const handler = vi.fn(async () => {});
    registerAgent(channelId, handler);
    const mockApp = createMockApp();
    registerMessageHandler(mockApp as never);
    const say = vi.fn();
    const send = (user: string, text: string): Promise<void> =>
      mockApp.simulateMessage({ message: { channel: channelId, user, text }, say });
    return { handler, say, send };
  };

  it('같은 유저가 1분에 5번을 넘기면 6번째는 에이전트로 넘기지 않고 안내한다', async () => {
    const { handler, say, send } = setup('C_LIMIT_1');

    for (let i = 0; i < 6; i++) await send('U_LIMIT_1', `메시지 ${i}`);

    expect(handler).toHaveBeenCalledTimes(5);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith('잠깐, 너무 빨라. 1분에 5번까지만 가능해.');
  });

  it('같은 채널이어도 유저가 다르면 따로 센다', async () => {
    const { handler, send } = setup('C_LIMIT_2');
    for (let i = 0; i < 6; i++) await send('U_LIMIT_2A', '안녕');

    await send('U_LIMIT_2B', '안녕');

    expect(handler).toHaveBeenCalledTimes(6);
  });

  it('10,000자를 넘는 메시지는 에이전트로 넘기지 않고 안내한다', async () => {
    const { handler, say, send } = setup('C_LIMIT_3');

    await send('U_LIMIT_3', 'a'.repeat(10_001));

    expect(handler).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith('메시지가 너무 길어. 좀 줄여서 다시 보내줘.');
  });

  it('정확히 10,000자인 메시지는 에이전트로 넘긴다', async () => {
    const { handler, say, send } = setup('C_LIMIT_4');

    await send('U_LIMIT_4', 'a'.repeat(10_000));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(say).not.toHaveBeenCalled();
  });
});
