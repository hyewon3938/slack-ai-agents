/**
 * 업타임 dead-man's-switch heartbeat (인프라 레벨).
 *
 * 봇 프로세스가 5분마다 자기 헬스와 웹 헬스를 확인하고, 정상이면 healthchecks.io로
 * ping을 송신한다. 외부 dead-man's-switch가 이 ping이 끊기는 것(=봇/VM 다운)을 관측해
 * 알림을 낸다. GitHub Actions schedule의 실효 주기가 수 시간까지 벌어질 수 있어, 정확한
 * 5분 주기를 보장하는 프로세스 내부 송신으로 감지 지연을 좁힌다.
 *
 * - DB(notification_settings) 기반 Life Cron 슬롯이 아니다 — 인프라 레벨 상주 태스크.
 * - 세 env(HC_PING_URL_BOT / HC_PING_URL_WEB / WEB_HEALTH_URL)는 전부 선택적.
 *   미설정이면 부팅 로그 한 줄 남기고 완전 no-op (healthchecks.io 가입 전 배포돼도 안전).
 * - 모든 fetch에 타임아웃 + try-catch. heartbeat는 어떤 경우에도 봇을 죽이지 않는다.
 *   ping 전송 실패는 로그만 (재시도 루프 없음 — healthchecks.io grace가 흡수).
 * - 자원 경합으로 느려진 사이클은 죽음이 아니라 저하다. 저하는 알리지 않고 장부에
 *   적어 다음 정상 ping에 동봉한다 (#621, heartbeat-degraded.ts).
 */

import cron from 'node-cron';
import { query } from '../shared/db.js';
import {
  buildDegradedReport,
  dropDegradedCycles,
  recordDegradedCycle,
} from './heartbeat-degraded.js';

/** heartbeat cron 주기 (5분) */
const HEARTBEAT_CRON = '*/5 * * * *';

/**
 * 외부 요청 타임아웃 (ms).
 *
 * 자원 경합 구간에서 응답이 느려지는 것은 "죽음"이 아니라 "저하"다. 짧은 타임아웃은
 * 저하를 죽음으로 오판해 ping을 소실시키고, dead-man은 그 침묵을 다운으로 읽는다
 * (2026-08-19 오탐). heartbeat 주기(5분)에 비하면 30초는 충분히 짧다.
 */
const FETCH_TIMEOUT_MS = 30_000;

/** 웹 헬스 body 검증 — uptime-check.yml과 동일 의미론 ("ok": true 포함) */
const WEB_OK_PATTERN = /"ok"\s*:\s*true/;

export interface HeartbeatConfig {
  /** 봇 self-health용 healthchecks.io ping URL (미설정 시 봇 핑 스킵) */
  botPingUrl: string;
  /** 웹 health용 healthchecks.io ping URL (미설정 시 웹 핑 스킵) */
  webPingUrl: string;
  /** 웹 헬스 엔드포인트 URL (미설정 시 웹 체크 스킵) */
  webHealthUrl: string;
}

/** CONFIG 없이 env에서 직접 읽는다 (전부 선택적 — requireEnv 사용 금지) */
export const loadHeartbeatConfig = (): HeartbeatConfig => ({
  botPingUrl: process.env['HC_PING_URL_BOT'] ?? '',
  webPingUrl: process.env['HC_PING_URL_WEB'] ?? '',
  webHealthUrl: process.env['WEB_HEALTH_URL'] ?? '',
});

/**
 * 봇 self-health 판정 — db-proxy.ts GET /health와 동일 의미론(DB SELECT 1).
 * 성공 시 true, 실패 시 false. 예외를 밖으로 던지지 않는다.
 */
export const checkBotHealth = async (): Promise<boolean> => {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

/**
 * 웹 health 판정 — uptime-check.yml과 동일 의미론(HTTP 200 + body "ok": true).
 * 성공 시 true, 실패/타임아웃 시 false. 예외를 밖으로 던지지 않는다.
 */
export const checkWebHealth = async (webHealthUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(webHealthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status !== 200) return false;
    const body = await response.text();
    return WEB_OK_PATTERN.test(body);
  } catch {
    return false;
  }
};

/**
 * healthchecks.io ping 송신.
 * healthy면 baseUrl로, 아니면 baseUrl + '/fail'로 (즉시 알림).
 * body가 주어지면 POST로 보내 ping 로그에 본문을 남긴다 (저하 이력 동봉).
 * 전송 실패는 로그만 남기고 삼킨다 (재시도 없음). 반환값은 전달 성공 여부.
 */
export const sendPing = async (
  baseUrl: string,
  healthy: boolean,
  label: string,
  body?: string,
): Promise<boolean> => {
  const url = healthy ? baseUrl : `${baseUrl}/fail`;
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[Heartbeat] ${label} ping 전송 실패 (무시): ${msg}`);
    return false;
  }
};

/** 헬스 확인을 소요시간과 함께 실행한다 (저하 판정용 계측) */
const measure = async (
  check: () => Promise<boolean>,
): Promise<{ healthy: boolean; elapsedMs: number }> => {
  const startedAt = Date.now();
  const healthy = await check();
  return { healthy, elapsedMs: Date.now() - startedAt };
};

/**
 * 1회 heartbeat 실행 — 봇/웹 헬스 확인 후 각각 ping 송신.
 * 설정된 항목만 처리한다. 어떤 예외도 밖으로 던지지 않는다 (봇 안정성 보호).
 */
export const runHeartbeatOnce = async (config: HeartbeatConfig): Promise<void> => {
  try {
    const bot = config.botPingUrl ? await measure(checkBotHealth) : null;
    const web =
      config.webPingUrl && config.webHealthUrl
        ? await measure(() => checkWebHealth(config.webHealthUrl))
        : null;

    recordDegradedCycle(bot?.elapsedMs ?? null, web?.elapsedMs ?? null);

    // 저하 이력은 알리지 않고 이번 사이클의 정상 ping에 동봉한다.
    // 전송에 성공한 분량만 장부에서 비우므로, 실패하면 다음 사이클로 이월된다.
    let pending = buildDegradedReport();

    const ping = async (baseUrl: string, healthy: boolean, label: string): Promise<void> => {
      const attached = healthy ? pending : null;
      const delivered = await sendPing(baseUrl, healthy, label, attached?.body);
      if (attached !== null && delivered) {
        dropDegradedCycles(attached.count);
        pending = null;
      }
    };

    if (bot) await ping(config.botPingUrl, bot.healthy, '봇');
    if (web) await ping(config.webPingUrl, web.healthy, '웹');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Heartbeat] 실행 오류 (무시): ${msg}`);
  }
};

/**
 * heartbeat 크론 등록. 부팅 진입점에서 1회 호출.
 * ping URL이 하나도 설정되지 않았으면 no-op (로그 한 줄).
 */
export const startUptimeHeartbeat = (): void => {
  const config = loadHeartbeatConfig();

  const botEnabled = config.botPingUrl.length > 0;
  const webEnabled = config.webPingUrl.length > 0 && config.webHealthUrl.length > 0;

  if (!botEnabled && !webEnabled) {
    console.log('[Heartbeat] HC_PING_URL_BOT/WEB 미설정 — 업타임 heartbeat 비활성화');
    return;
  }

  cron.schedule(
    HEARTBEAT_CRON,
    () => {
      void runHeartbeatOnce(config);
    },
    { timezone: 'Asia/Seoul' },
  );

  const targets: string[] = [];
  if (botEnabled) targets.push('봇');
  if (webEnabled) targets.push('웹');
  console.log(`[Heartbeat] 업타임 heartbeat 시작 (5분 간격): ${targets.join(', ')}`);
};
