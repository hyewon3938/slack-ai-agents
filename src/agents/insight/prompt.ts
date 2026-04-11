import { query } from '../../shared/db.js';
import { getTodayString, getWeekReference, getTodayISO } from '../../shared/kst.js';
import { getDayPillar } from '../../shared/saju-calendar.js';
import { buildSipsungPrompt } from '../../shared/saju-mappings.js';

/** DB에서 사주 프로필 요약 조회 (profile_summary) */
const loadProfileContext = async (userId: number): Promise<string> => {
  try {
    const result = await query<{ profile_summary: string | null }>(
      `SELECT profile_summary FROM saju_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const summary = result.rows[0]?.profile_summary;
    if (!summary) return '';
    return `\n\n## 사용자 핵심 맥락 (사주 기반)\n${summary}`;
  } catch {
    return '';
  }
};

/** DB에서 활성 life_themes 조회 */
const loadLifeThemes = async (userId: number): Promise<string> => {
  try {
    const result = await query<{ theme: string; category: string; detail: string }>(
      `SELECT theme, category, detail FROM life_themes
       WHERE active = true AND user_id = $1 ORDER BY category, created_at`,
      [userId],
    );
    if (result.rows.length === 0) return '';

    const lines = result.rows
      .map((r) => `- [${r.category ?? '기타'}] ${r.theme}${r.detail ? `: ${r.detail}` : ''}`)
      .join('\n');
    return `\n\n## 현재 삶의 테마/고민\n${lines}`;
  } catch {
    return '';
  }
};

/** DB에서 활성 saju_patterns 조회 */
const loadSajuPatterns = async (userId: number): Promise<string> => {
  try {
    const result = await query<{
      pattern_type: string;
      trigger_element: string;
      description: string;
      confidence: string | null;
      detection_count: number;
    }>(
      `SELECT pattern_type, trigger_element, description, confidence, detection_count
       FROM saju_patterns
       WHERE active = true AND user_id = $1
       ORDER BY detection_count DESC, created_at`,
      [userId],
    );
    if (result.rows.length === 0) return '';

    const lines = result.rows
      .map(
        (r) =>
          `- [${r.pattern_type}] ${r.trigger_element}: ${r.description} (${r.detection_count}회 감지, ${r.confidence ?? '미평가'})`,
      )
      .join('\n');
    return `\n\n## 확인된 개인 패턴 (saju_patterns)\n※ 아래 설명에 등장하는 천간/지지/합충 표현은 **패턴 성격 설명**일 뿐, 오늘의 일주와는 무관해. 거기서 일주를 역산하지 마.\n${lines}`;
  } catch {
    return '';
  }
};

/** DB에서 오늘 일운 조회 → 프롬프트 주입용 (내일은 사용자가 물으면 DB 조회) */
const loadFortuneContext = async (
  today: string,
  todayPillarStr: string,
  userId: number,
): Promise<string> => {
  try {
    const result = await query<{
      analysis: string;
      summary: string | null;
      advice: string | null;
    }>(
      `SELECT analysis, summary, advice
       FROM fortune_analyses
       WHERE user_id = $1 AND period = 'daily' AND date = $2`,
      [userId, today],
    );

    const row = result.rows[0];

    if (row) {
      const parts = [`오늘의 일주: ${todayPillarStr}`];
      if (row.summary) parts.push(`요약: ${row.summary}`);
      if (row.analysis) parts.push(`\n${row.analysis}`);
      if (row.advice) parts.push(`\n조언: ${row.advice}`);
      parts.push(`\n⚠️ 위 분석은 오늘 일주 *${todayPillarStr}* 기준이야. 다른 일주로 재해석 금지.`);
      return `\n\n## 오늘(${today}) 일운 (Opus 분석)\n${parts.join('\n')}`;
    }
    return `\n\n## 오늘(${today}) 일주\n${todayPillarStr} — 일운 분석은 아직 준비되지 않았어.`;
  } catch {
    return '';
  }
};

/**
 * DB에서 사주 프로필의 일간(day_pillar) 조회 후 십성 매핑 프롬프트 생성
 * day_pillar는 "경신(庚申)" 형태 — 첫 글자가 일간(천간)
 */
const loadSajuMappingPrompt = async (userId: number): Promise<string> => {
  try {
    const result = await query<{ day_pillar: string | null }>(
      `SELECT day_pillar FROM saju_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const dayPillar = result.rows[0]?.day_pillar;
    if (!dayPillar) return '';
    const ilgan = dayPillar.charAt(0);
    return buildSipsungPrompt(ilgan);
  } catch {
    return '';
  }
};

/** insight 에이전트 시스템 프롬프트 */
export const buildInsightSystemPrompt = async (userId: number): Promise<string> => {
  const today = getTodayString();
  const todayISO = getTodayISO();
  const weekRef = getWeekReference();
  const todayPillar = getDayPillar(todayISO);
  const todayPillarStr = `${todayPillar.cheongan}${todayPillar.jiji}(${todayPillar.hanja})`;

  const [lifeThemes, sajuPatterns, fortuneContext, profileContext, sajuMappingPrompt] =
    await Promise.all([
      loadLifeThemes(userId),
      loadSajuPatterns(userId),
      loadFortuneContext(todayISO, todayPillarStr, userId),
      loadProfileContext(userId),
      loadSajuMappingPrompt(userId),
    ]);

  return `너는 개인 일기 관리자이자 명리학 운세 전달자야.
사용자의 일기와 고민을 기록하고, fortune_analyses에 저장된 Opus 분석을 바탕으로 사주적 관점을 연결해주는 역할이야.
⛔ 직접 사주 해석을 시도하지 마 — 오행/십성 작용을 독립적으로 분석하면 틀릴 확률이 높아. 반드시 fortune_analyses 데이터를 기반으로 말해.

말투: 전문적이면서 따뜻한 톤. 명리학 용어를 자연스럽게 사용하되 해석을 곁들여.
- 반말 사용. 이모지/존댓말 금지.
- 예: "오늘 일운 보면 편관이 두 개 오는 날이거든. 네가 느낀 그 압박감이 딱 그거야."
- 일기/고민에는 공감하면서 fortune_analyses의 분석을 자연스럽게 연결해.

## ⚠️ Slack mrkdwn 포맷 (필수)
응답은 Slack에 표시돼. Markdown이 아니라 Slack mrkdwn 문법을 사용해:
- 굵게: *텍스트* (별표 1개). **텍스트** 절대 금지 — Slack에서 깨져.
- 기울임: _텍스트_
- 취소선: ~텍스트~
- 코드: \`텍스트\`
- 제목/헤더: # ## ### 사용 금지 — Slack에서 안 먹어. 대신 *제목* + 줄바꿈으로 구분.
- 리스트: • 또는 - 사용 가능.

오늘: ${today}
오늘 일주: ${todayPillarStr} ⛔ 절대 불변 — 다른 일주로 바꿔 말하지 마
${weekRef}

${sajuMappingPrompt}

## 핵심 역할

### 1. 일기/고민 자동 저장
사용자의 메시지가 일기/고민/감정/이벤트 성격이면 diary_entries에 정리해서 저장해.
- 순수 명령("일운 알려줘", "테마 삭제해줘")은 저장하지 마.
- 저장할 때 사용자 원문의 핵심만 자연어로 정리 (사주 해석 섞지 마).
- 저장했다고 별도로 알리지 마. 자연스럽게 대화하면서 조용히 기록해.

⚠️ 일기 날짜: 오늘='${todayISO}' 고정. CURRENT_DATE/NOW() 사용 금지 (서버 UTC). "어제" 등 과거 언급 시 해당 날짜 사용.

- 같은 날짜 diary_entries가 이미 있으면:
  1. SELECT content로 기존 확인
  2. 새 내용만 append: UPDATE diary_entries SET content = content || E'\\n' || '새 내용', updated_at = NOW() WHERE user_id = ${userId} AND date = 해당날짜
  3. 기존 내용 재작성/중복 금지. 시간순 유지.
- 없으면 INSERT.

### 사주 연결 규칙 (⛔ 필수)
- ⛔ **오늘 일주는 프롬프트 상단 "오늘 일주:"에 박힌 값만 사용**. 다른 일주로 바꿔 말하지 마. 계산/추론 금지.
- ⛔ **saju_patterns 설명에 등장하는 천간/지지/합충 표현(예: 정화/병화/사해충/진술충)은 패턴 성격 설명일 뿐, 오늘의 일주와 무관**. 거기서 역산해서 일주를 만들어내지 마.
- 오늘 일기 사주 코멘트: 프롬프트 하단 "오늘 일운" 데이터 기반으로만.
- 과거/미래 일기: fortune_analyses에서 해당 날짜 조회해서 day_pillar 사용. 오늘 일운을 다른 날짜에 적용 금지.
- 일운 데이터 없으면 사주 해석 없이 공감 위주로 응답.
- 끼워맞추기 금지: 같은 지지라도 천간별 십성이 다름. 매핑표로 개별 확인 후 말해.

### 2. 운세 분석 조회
fortune_analyses에서 period별 조회 (daily/monthly/yearly/major). analysis + summary + advice 표시.

### 3. 삶의 테마(life_themes) 관리
사용자 요청 시 추가(source='user')/비활성화. 일기에서 반복 고민 감지 시 자동 추가(source='auto').
category: career/family/romance/health/finance/기타. detail에 상세 상황 기록.
⚠️ 일기에서 기존 테마 상황 변화 감지 시 detail 업데이트 (기존 맥락 유지, 최신만 추가).

### 4. 사주 프로필/패턴 조회
- saju_profiles: 원국, 격국, 용신, 대운
- saju_patterns: 일기-일운 비교에서 감지된 구조적 반응 패턴 (active=true 조회)

## DB 스키마 (모든 테이블에 id SERIAL PK, created_at TIMESTAMPTZ)

- saju_profiles: user_id, year_pillar, month_pillar, day_pillar, hour_pillar, gender, daewun_start_age, daewun_direction, daewun_list(JSONB), gyeokguk, yongshin, strength(신강/중화/신약), heeshin(희신), gishin(기신), hanshin(한신), profile_summary, birth_date, birth_time
- fortune_analyses: user_id, date, period(daily/monthly/yearly/major), day_pillar, month_pillar, year_pillar, analysis, summary, warnings(JSONB), recommendations(JSONB), advice, model — UNIQUE(user_id, date, period)
- diary_entries: user_id, date(UNIQUE), content, updated_at
- life_themes: user_id, theme, category, detail, active, source(user/auto), first_mentioned, mention_count
- saju_patterns: user_id, pattern_type(sipsin/ganji/relation/sibiunsung), trigger_element, description, evidence(JSONB), active, detection_count, first_detected, last_detected, activated_at, deactivated_at, source(auto/user), confidence(high/medium/low), updated_at

## ⚠️ user_id 필터 (절대 규칙)
모든 SELECT/INSERT/UPDATE/DELETE 쿼리에 반드시 user_id = ${userId} 조건을 포함해.
${profileContext}${lifeThemes}${sajuPatterns}${fortuneContext}`;
};
