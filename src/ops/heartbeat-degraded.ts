/**
 * heartbeat 저하 사이클 장부 (#621).
 *
 * 자원 경합 구간에서 헬스 확인이 "느려지는 것"은 죽음이 아니라 저하다.
 * dead-man's-switch는 ping의 유무만 보므로 저하를 표현할 수 없다 — 그래서 저하는
 * 알림 대신 기록으로 남기고, 다음 정상 ping에 동봉해 뒤늦게라도 도착하게 한다.
 *
 * - 알림을 내지 않는다 (알림 무감각 방지 → 진짜 다운 알림의 신뢰도 보존, ADR-0063)
 * - 인메모리 장부. 재시작으로 소실돼도 기능 손실이 아니다 (진단 보조이지 판정 근거가 아님)
 * - 전송에 성공한 만큼만 비운다 → 침묵 구간을 건너뛴 이력도 살아남는다
 */

/** 이 값을 넘는 헬스 확인 = 저하로 간주 (ms) */
const DEGRADED_THRESHOLD_MS = 3_000;

/** 장부 보관 상한 (heartbeat 5분 주기 × 12 = 최대 1시간치) */
const DEGRADED_HISTORY_MAX = 12;

export interface DegradedCycle {
  /** 사이클 시각 (ISO) */
  at: string;
  /** 봇 self-health 소요 (ms). null = 미측정(해당 대상 비활성) */
  botCheckMs: number | null;
  /** 웹 health 소요 (ms). null = 미측정(해당 대상 비활성) */
  webCheckMs: number | null;
}

const history: DegradedCycle[] = [];

const isDegraded = (ms: number | null): boolean => ms !== null && ms > DEGRADED_THRESHOLD_MS;

const formatMs = (ms: number | null): string => (ms === null ? 'n/a' : `${ms}ms`);

/**
 * 한 사이클의 소요시간을 판정해 저하면 장부에 적는다.
 * 임계 미만이면 아무것도 하지 않는다. 예외를 밖으로 던지지 않는다.
 */
export const recordDegradedCycle = (botCheckMs: number | null, webCheckMs: number | null): void => {
  if (!isDegraded(botCheckMs) && !isDegraded(webCheckMs)) return;

  history.push({ at: new Date().toISOString(), botCheckMs, webCheckMs });
  if (history.length > DEGRADED_HISTORY_MAX) {
    history.splice(0, history.length - DEGRADED_HISTORY_MAX);
  }

  console.warn(
    `[Heartbeat] 저하 사이클 기록 (알림 없음): bot=${formatMs(botCheckMs)} web=${formatMs(webCheckMs)}`,
  );
};

/**
 * 장부를 ping body용 텍스트로 만든다. 비어 있으면 null.
 * count는 "이 body가 담은 항목 수" — 전송 성공 후 그만큼만 비우는 데 쓴다
 * (전송 중 새로 쌓인 항목을 같이 날리지 않기 위함).
 */
export const buildDegradedReport = (): { body: string; count: number } | null => {
  if (history.length === 0) return null;

  const lines = history.map(
    (c) => `${c.at} bot=${formatMs(c.botCheckMs)} web=${formatMs(c.webCheckMs)}`,
  );
  return {
    body: [`degraded ${history.length} cycle(s) since last successful ping`, ...lines].join('\n'),
    count: history.length,
  };
};

/** 앞에서부터 count개를 비운다 (전송에 성공한 분량만 폐기) */
export const dropDegradedCycles = (count: number): void => {
  if (count > 0) history.splice(0, count);
};

/** 현재 장부 사본 (진단·테스트용 읽기 전용 뷰) */
export const getDegradedHistory = (): readonly DegradedCycle[] => [...history];
