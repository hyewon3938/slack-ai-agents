/** Slack Web API 클라이언트 — 웹에서 알림용 메시지 전송 */

const SLACK_API = 'https://slack.com/api/chat.postMessage';

interface PostMessageOptions {
  channel: string;
  text: string;
  blocks?: unknown[];
}

/**
 * Slack 채널에 메시지 전송. 실패해도 throw 하지 않음 (fire-and-forget).
 * SLACK_BOT_TOKEN 미설정 시 아무 동작 안 함.
 */
export const postSlackMessage = async (options: PostMessageOptions): Promise<void> => {
  const token = process.env['SLACK_BOT_TOKEN'];
  if (!token) {
    console.warn('[slack] SLACK_BOT_TOKEN 미설정 — 알림 건너뜀');
    return;
  }

  try {
    const res = await fetch(SLACK_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      console.error(`[slack] HTTP ${res.status}: ${res.statusText}`);
      return;
    }

    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error(`[slack] API 오류: ${data.error ?? 'unknown'}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[slack] 요청 실패: ${message}`);
  }
};

/** 신규 가입자 알림 */
export const notifyNewSignup = async (params: {
  nickname: string | null;
  email: string | null;
  totalUsers: number;
  maxUsers: number;
}): Promise<void> => {
  const channel = process.env['SIGNUP_NOTIFY_CHANNEL_ID'];
  if (!channel) {
    console.warn('[slack] SIGNUP_NOTIFY_CHANNEL_ID 미설정 — 알림 건너뜀');
    return;
  }

  const nickname = params.nickname ?? '(닉네임 없음)';
  const email = params.email ?? '(이메일 비공개)';
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  await postSlackMessage({
    channel,
    text: `신규 가입자 알림 — ${nickname}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🚨 새 가입자 발생', emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*닉네임*\n${nickname}` },
          { type: 'mrkdwn', text: `*이메일*\n${email}` },
          { type: 'mrkdwn', text: `*가입 시각*\n${now}` },
          { type: 'mrkdwn', text: `*총 유저*\n${params.totalUsers} / ${params.maxUsers}` },
        ],
      },
    ],
  });
};
