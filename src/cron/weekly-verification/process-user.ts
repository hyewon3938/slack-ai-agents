import type { App } from '@slack/bolt';
import {
  verifyUserLinks,
  computeStrengthCutpoints,
  ensureMirrorSignalDef,
} from '../../shared/pattern-verification.js';
import { flagConfounds } from '../../shared/confound.js';
import { runSaturationSweep, type SaturationSweepResult } from '../../shared/seed-saturation.js';
import { recommendDiscoveries } from '../discovery-recommend.js';
import {
  persistLinkVerification,
  persistWeeklySnapshot,
  persistStrengthCutpoints,
  persistConfound,
} from './persist-links.js';
import { persistResponseProfile } from './response-profile.js';

export const processUser = async (
  app: App,
  userId: number,
  channelId: string,
  weekStart: string,
  today: string,
): Promise<void> => {
  // 강도 분위수 컷 갱신(일별 cron 핸드오프) — 검증과 독립. 실패해도 링크 검증은 진행.
  try {
    const cutpoints = await computeStrengthCutpoints(userId, today);
    await persistStrengthCutpoints(userId, cutpoints);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Verification] 강도 컷 산출/저장 실패 user=${userId}: ${msg}`);
  }

  const results = await verifyUserLinks(userId, today);

  let persisted = 0;
  for (const l of results) {
    // per-link 격리(#434 Phase 8a) — 한 링크 UPDATE 실패가 전체를 막지 않게.
    try {
      await persistLinkVerification(l);
      await persistWeeklySnapshot(userId, l, weekStart);
      persisted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Verification] 링크 persist 실패 link=${l.linkId}: ${msg}`);
    }
    // 역방향 종결(#555) — 반대 방향 신호 정의 보장(발굴 엔진 위임). persist와 독립 격리:
    // 거울 보장 실패가 다른 링크·검증을 막지 않게(신호 정의는 없어도 검증은 무탈). 링크는 만들지 않음.
    if (l.verdict === 'direction_mismatch' && l.nextStatus === 'rejected') {
      try {
        await ensureMirrorSignalDef(userId, l.signalId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[MirrorSignal] user=${userId} link=${l.linkId} 거울 보장 실패: ${msg}`);
      }
    }
  }

  // 포화 시드 양방향 가드(#508 ③, ADR-0046) — 검정 불가 시드 자동 archive ⟷ 탈포화 부활.
  // 검증/발굴과 독립 격리: 실패해도 검증·발굴은 무탈(빈 결과). 발굴 surface 전(부활 시드 재페어링 위해).
  let hygiene: SaturationSweepResult = { archived: [], revived: [] };
  try {
    hygiene = await runSaturationSweep(userId, today);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Saturation] user=${userId} sweep 실패: ${msg}`);
  }

  const verified = results.filter((l) => l.nextStatus === 'confirmed').length;
  const rejects = results.filter((l) => l.verdict === 'reject').length;
  const dirMismatch = results.filter((l) => l.verdict === 'direction_mismatch').length; // 역방향 종결(#555)
  console.warn(
    `[Verification] user=${userId} 링크 ${results.length} (persist ${persisted}) verified ${verified} reject ${rejects} 역방향 ${dirMismatch}`,
  );
  // 가족별 BH 집합 크기(m) 관측 — 발굴 승인 누적에 따른 가족 m-인플레이션 추적(#523 P0, §2-5).
  const familyTally = results.reduce<Map<string, number>>(
    (m, l) => m.set(l.family, (m.get(l.family) ?? 0) + 1),
    new Map(),
  );
  console.warn(
    `[Verification] user=${userId} 가족별 링크 ${[...familyTally].map(([f, n]) => `${f}=${n}`).join(' ') || '없음'}`,
  );

  // 교란 플래그(P6, ADR-0041) — DB(pattern_links.confound)에 persist. 카드 은퇴(#542)로 노출은 없음.
  try {
    const cr = await flagConfounds(userId, today);
    let flagged = 0;
    let adjusted = 0; // P7 — 게이트 통과해 MH 조정한 링크 수
    let explainedAway = 0; // P7 — 조정 후 어부지리 판정(노출 강등 대상)
    for (const r of cr) {
      try {
        await persistConfound(userId, r);
        if (r.confound.suspected.length > 0) flagged += 1;
        if (r.confound.adjusted && r.confound.adjusted.length > 0) adjusted += 1;
        if (r.confound.explainedAway) explainedAway += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Confound] persist 실패 link=${r.linkId}: ${msg}`);
      }
    }
    console.warn(
      `[Confound] user=${userId} 교란 플래그 ${flagged}/${cr.length} 링크 · 조정 ${adjusted} · 어부지리 ${explainedAway}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Confound] user=${userId} 교란 플래그 실패: ${msg}`);
  }

  // #542(ADR-0052): 검증 현황 카드 발송 은퇴 — routine 통합 카드가 단독 발송. 엔진은 DB만 갱신.
  // 포화 가드(#508 ③) 사용자 노출이 사라져 로그로 강등(통합 카드 노출은 후속 — ADR-0052 §후속).
  if (hygiene.archived.length > 0 || hygiene.revived.length > 0) {
    console.warn(
      `[Saturation] user=${userId} archive ${hygiene.archived.length} (${hygiene.archived.map((s) => s.label).join(', ') || '-'}) · ` +
        `revive ${hygiene.revived.length} (${hygiene.revived.map((s) => s.label).join(', ') || '-'})`,
    );
  }

  // 검증 후 발굴 단계 — 검증 결과를 막지 않게 격리(검증은 이미 완료, 카드는 routine이 발송).
  try {
    await recommendDiscoveries(app, userId, channelId, today);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Discovery] user=${userId} 발굴 실패: ${msg}`);
  }

  // 개인화 가중치 집계(#523 P1) — 파생 레이어 격리. 실패해도 검증·발굴 무탈(Phase 2·3가 소비).
  try {
    await persistResponseProfile(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ResponseProfile] user=${userId} 집계 실패: ${msg}`);
  }
};
