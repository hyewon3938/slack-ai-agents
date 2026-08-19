import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 업타임 heartbeat 판정 로직 단위 테스트 (#577).
// 검증 축:
//  ① 봇 헬스 pass(SELECT 1 성공) → base ping URL / fail → base + '/fail'
//  ② 웹 헬스 200 + body "ok":true → base ping URL / 그 외(비200·body 불일치·타임아웃) → '/fail'
//  ③ env 미설정 → 해당 대상 완전 no-op (fetch 미호출)
//  ④ ping 전송 실패는 삼켜서 heartbeat가 예외를 밖으로 던지지 않음
//  ⑤ 저하 사이클(느려짐)은 알림이 아니라 장부에 기록되고 상한을 지킴 (#621)
//  ⑥ 장부는 정상 ping에 POST body로 동봉되고, 전송 성공분만 비워짐 (실패 시 이월)

const mockQuery = vi.fn();

vi.mock('../../shared/db.js', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
}));

const { checkBotHealth, checkWebHealth, sendPing, runHeartbeatOnce, loadHeartbeatConfig } =
  await import('../uptime-heartbeat.js');

const okResponse = (body: string): Response =>
  ({ ok: true, status: 200, text: () => Promise.resolve(body) }) as unknown as Response;

const statusResponse = (status: number, body = ''): Response =>
  ({ ok: status < 400, status, text: () => Promise.resolve(body) }) as unknown as Response;

describe('checkBotHealth — db-proxy /health 동일 의미론(SELECT 1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DB SELECT 1 성공 → true', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    expect(await checkBotHealth()).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
  });

  it('DB 오류 → false (예외를 밖으로 던지지 않음)', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));
    expect(await checkBotHealth()).toBe(false);
  });
});

describe('checkWebHealth — uptime-check.yml 동일 의미론(200 + "ok":true)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('200 + body {"ok":true} → true', async () => {
    fetchMock.mockResolvedValue(okResponse('{"ok":true}'));
    expect(await checkWebHealth('https://web.example/api/health')).toBe(true);
  });

  it('200 + 공백 포함 "ok" : true → true (정규식 유연 매칭)', async () => {
    fetchMock.mockResolvedValue(okResponse('{ "ok" : true }'));
    expect(await checkWebHealth('https://web.example/api/health')).toBe(true);
  });

  it('200 + body {"ok":false} → false', async () => {
    fetchMock.mockResolvedValue(okResponse('{"ok":false}'));
    expect(await checkWebHealth('https://web.example/api/health')).toBe(false);
  });

  it('503 (body는 ok:true여도) → false — 상태코드 우선', async () => {
    fetchMock.mockResolvedValue(statusResponse(503, '{"ok":true}'));
    expect(await checkWebHealth('https://web.example/api/health')).toBe(false);
  });

  it('fetch 예외(타임아웃 등) → false (밖으로 던지지 않음)', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted'));
    expect(await checkWebHealth('https://web.example/api/health')).toBe(false);
  });
});

describe('sendPing — healthy → base URL / unhealthy → /fail', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('healthy=true → base URL로 GET', async () => {
    fetchMock.mockResolvedValue(statusResponse(200));
    await sendPing('https://hc-ping.example/uuid', true, '봇');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hc-ping.example/uuid');
    expect(init.method).toBe('GET');
  });

  it('healthy=false → base + "/fail"로 GET', async () => {
    fetchMock.mockResolvedValue(statusResponse(200));
    await sendPing('https://hc-ping.example/uuid', false, '봇');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://hc-ping.example/uuid/fail');
  });

  it('ping 전송 실패 → 예외를 삼키고 false 반환 (throw 안 함)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(sendPing('https://hc-ping.example/uuid', true, '봇')).resolves.toBe(false);
  });
});

describe('runHeartbeatOnce — 설정된 대상만 처리', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(statusResponse(200, '{"ok":true}'));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('세 값 전부 설정 + 전부 정상 → 봇 base + 웹 base 각각 1회 ping', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ok: 1 }] });
    await runHeartbeatOnce({
      botPingUrl: 'https://hc-ping.example/bot',
      webPingUrl: 'https://hc-ping.example/web',
      webHealthUrl: 'https://web.example/api/health',
    });
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    // 웹 헬스 GET 1회 + 봇 ping + 웹 ping = fetch 3회 (봇 헬스는 DB query라 fetch 아님)
    expect(urls).toContain('https://hc-ping.example/bot');
    expect(urls).toContain('https://hc-ping.example/web');
    expect(urls.some((u) => u.endsWith('/fail'))).toBe(false);
  });

  it('봇 헬스 실패 → 봇 ping은 "/fail"', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    await runHeartbeatOnce({
      botPingUrl: 'https://hc-ping.example/bot',
      webPingUrl: '',
      webHealthUrl: '',
    });
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain('https://hc-ping.example/bot/fail');
  });

  it('env 미설정(빈 문자열) → 완전 no-op (fetch·query 미호출)', async () => {
    await runHeartbeatOnce({ botPingUrl: '', webPingUrl: '', webHealthUrl: '' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('웹 ping URL만 있고 webHealthUrl 없으면 → 웹 스킵 (봇만 처리)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ok: 1 }] });
    await runHeartbeatOnce({
      botPingUrl: 'https://hc-ping.example/bot',
      webPingUrl: 'https://hc-ping.example/web',
      webHealthUrl: '',
    });
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain('https://hc-ping.example/bot');
    expect(urls).not.toContain('https://hc-ping.example/web');
  });
});

describe('loadHeartbeatConfig — env 미설정 시 빈 문자열', () => {
  const saved = {
    bot: process.env['HC_PING_URL_BOT'],
    web: process.env['HC_PING_URL_WEB'],
    health: process.env['WEB_HEALTH_URL'],
  };

  afterEach(() => {
    if (saved.bot === undefined) delete process.env['HC_PING_URL_BOT'];
    else process.env['HC_PING_URL_BOT'] = saved.bot;
    if (saved.web === undefined) delete process.env['HC_PING_URL_WEB'];
    else process.env['HC_PING_URL_WEB'] = saved.web;
    if (saved.health === undefined) delete process.env['WEB_HEALTH_URL'];
    else process.env['WEB_HEALTH_URL'] = saved.health;
  });

  it('미설정이면 세 값 모두 빈 문자열', () => {
    delete process.env['HC_PING_URL_BOT'];
    delete process.env['HC_PING_URL_WEB'];
    delete process.env['WEB_HEALTH_URL'];
    expect(loadHeartbeatConfig()).toEqual({ botPingUrl: '', webPingUrl: '', webHealthUrl: '' });
  });

  it('설정되면 그 값을 읽음', () => {
    process.env['HC_PING_URL_BOT'] = 'https://hc-ping.example/bot';
    process.env['HC_PING_URL_WEB'] = 'https://hc-ping.example/web';
    process.env['WEB_HEALTH_URL'] = 'https://web.example/api/health';
    expect(loadHeartbeatConfig()).toEqual({
      botPingUrl: 'https://hc-ping.example/bot',
      webPingUrl: 'https://hc-ping.example/web',
      webHealthUrl: 'https://web.example/api/health',
    });
  });
});

// ---------------------------------------------------------------------------
// #621 — 저하 사이클 장부 + 회복 ping 동봉
// ---------------------------------------------------------------------------

const { recordDegradedCycle, buildDegradedReport, dropDegradedCycles, getDegradedHistory } =
  await import('../heartbeat-degraded.js');

/** 장부는 모듈 스코프 상태 — 테스트 간 오염을 막기 위해 매번 비운다 */
const resetDegradedHistory = (): void => dropDegradedCycles(getDegradedHistory().length);

describe('저하 장부 — 임계 초과분만 적고 보관 상한을 지킨다', () => {
  beforeEach(() => resetDegradedHistory());
  afterEach(() => resetDegradedHistory());

  it('임계(3초) 미만 사이클 → 기록 안 함', () => {
    recordDegradedCycle(120, 800);
    expect(getDegradedHistory()).toHaveLength(0);
    expect(buildDegradedReport()).toBeNull();
  });

  it('한쪽만 임계 초과해도 기록', () => {
    recordDegradedCycle(120, 8_000);
    expect(getDegradedHistory()).toHaveLength(1);
  });

  it('미측정(null)은 저하로 보지 않고 body에 n/a로 표기', () => {
    recordDegradedCycle(null, null);
    expect(getDegradedHistory()).toHaveLength(0);

    recordDegradedCycle(9_000, null);
    const report = buildDegradedReport();
    expect(report?.count).toBe(1);
    expect(report?.body).toContain('degraded 1 cycle(s)');
    expect(report?.body).toContain('bot=9000ms web=n/a');
  });

  it('보관 상한(12) 초과 → 오래된 것부터 drop', () => {
    for (let i = 1; i <= 15; i += 1) recordDegradedCycle(3_000 + i, null);
    const history = getDegradedHistory();
    expect(history).toHaveLength(12);
    expect(history[0]?.botCheckMs).toBe(3_004);
    expect(history[11]?.botCheckMs).toBe(3_015);
  });

  it('dropDegradedCycles는 앞에서부터 지정 개수만 비운다', () => {
    recordDegradedCycle(4_000, null);
    recordDegradedCycle(5_000, null);
    dropDegradedCycles(1);
    expect(getDegradedHistory()).toHaveLength(1);
    expect(getDegradedHistory()[0]?.botCheckMs).toBe(5_000);
  });

  it('비정상 입력(음수)에도 예외를 던지지 않고 기록하지 않음', () => {
    expect(() => recordDegradedCycle(-1, null)).not.toThrow();
    expect(getDegradedHistory()).toHaveLength(0);
  });
});

describe('runHeartbeatOnce — 저하 이력을 정상 ping에 동봉 (#621)', () => {
  const fetchMock = vi.fn();
  const config = { botPingUrl: 'https://hc-ping.example/bot', webPingUrl: '', webHealthUrl: '' };
  let clock = 0;

  /** 봇 self-health가 elapsedMs만큼 걸리는 상황을 흉내낸다 */
  const botTakes = (elapsedMs: number): void => {
    mockQuery.mockImplementation(() => {
      clock += elapsedMs;
      return Promise.resolve({ rows: [{ ok: 1 }] });
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetDegradedHistory();
    clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(statusResponse(200));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockQuery.mockReset();
    resetDegradedHistory();
  });

  it('임계 미만 사이클 → 장부 비어있고 ping은 GET (정상 경로 무변경)', async () => {
    botTakes(200);
    await runHeartbeatOnce(config);

    expect(getDegradedHistory()).toHaveLength(0);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hc-ping.example/bot');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('임계 초과 사이클 → 정상 ping이 POST + body에 저하 이력 (다운 아님)', async () => {
    botTakes(8_000);
    await runHeartbeatOnce(config);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hc-ping.example/bot');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('degraded 1 cycle(s)');
    expect(String(init.body)).toContain('bot=8000ms');
  });

  it('동봉 전송 성공 → 장부가 비워져 다음 정상 ping은 다시 GET', async () => {
    botTakes(8_000);
    await runHeartbeatOnce(config);
    expect(getDegradedHistory()).toHaveLength(0);

    botTakes(100);
    await runHeartbeatOnce(config);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('GET');
  });

  it('동봉 전송 실패 → 장부 유지, 다음 정상 ping으로 이월', async () => {
    botTakes(8_000);
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await runHeartbeatOnce(config);
    expect(getDegradedHistory()).toHaveLength(1);

    botTakes(100);
    await runHeartbeatOnce(config);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('bot=8000ms');
    expect(getDegradedHistory()).toHaveLength(0);
  });

  it('헬스 실패 사이클 → "/fail"에는 동봉하지 않고 이력을 보존', async () => {
    botTakes(8_000);
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await runHeartbeatOnce(config);
    expect(getDegradedHistory()).toHaveLength(1);

    mockQuery.mockImplementation(() => Promise.reject(new Error('db down')));
    await runHeartbeatOnce(config);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://hc-ping.example/bot/fail');
    expect(init.method).toBe('GET');
    expect(getDegradedHistory()).toHaveLength(1);
  });

  it('저하 + ping 전송 실패에도 예외를 밖으로 던지지 않음', async () => {
    botTakes(9_000);
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(runHeartbeatOnce(config)).resolves.toBeUndefined();
  });
});
