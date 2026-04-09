import { query } from '../../shared/db.js';
import { getTodayString, getWeekReference, getTodayISO, addDays } from '../../shared/kst.js';
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
    return `\n\n## 확인된 개인 패턴 (saju_patterns)\n${lines}`;
  } catch {
    return '';
  }
};

/** DB에서 오늘+내일 일운 조회 → 프롬프트 주입용 */
const loadFortuneContext = async (today: string, userId: number): Promise<string> => {
  try {
    const tomorrow = addDays(today, 1);
    const result = await query<{
      date: string;
      day_pillar: string | null;
      analysis: string;
      summary: string | null;
      warnings: unknown;
      recommendations: unknown;
      advice: string | null;
    }>(
      `SELECT date::text, day_pillar, analysis, summary, warnings, recommendations, advice
       FROM fortune_analyses
       WHERE user_id = $1 AND period = 'daily' AND date IN ($2, $3)
       ORDER BY date`,
      [userId, today, tomorrow],
    );

    const todayRow = result.rows.find((r) => r.date === today);
    const tomorrowRow = result.rows.find((r) => r.date === tomorrow);

    const sections: string[] = [];

    // 오늘 일주 (getDayPillar로 정확한 값 계산 — DB 값에 의존하지 않음)
    const todayPillar = getDayPillar(today);
    const todayPillarStr = `${todayPillar.cheongan}${todayPillar.jiji}(${todayPillar.hanja})`;
    if (todayRow) {
      const parts: string[] = [];
      parts.push(`오늘의 일주: ${todayPillarStr}`);
      if (todayRow.summary) parts.push(`요약: ${todayRow.summary}`);
      if (todayRow.analysis) parts.push(`\n${todayRow.analysis}`);
      if (todayRow.advice) parts.push(`\n조언: ${todayRow.advice}`);
      sections.push(`\n\n## 오늘(${today}) 일운 (Opus 분석)\n${parts.join('\n')}`);
    } else {
      sections.push(`\n\n## 오늘(${today}) 일주\n${todayPillarStr} — 일운 분석은 아직 준비되지 않았어.`);
    }

    // 내일 일주 (getDayPillar로 정확한 값 계산)
    const tomorrowPillar = getDayPillar(tomorrow);
    const tomorrowPillarStr = `${tomorrowPillar.cheongan}${tomorrowPillar.jiji}(${tomorrowPillar.hanja})`;
    if (tomorrowRow) {
      const parts: string[] = [];
      parts.push(`내일의 일주: ${tomorrowPillarStr}`);
      if (tomorrowRow.summary) parts.push(`요약: ${tomorrowRow.summary}`);
      if (tomorrowRow.analysis) parts.push(`\n${tomorrowRow.analysis}`);
      if (tomorrowRow.advice) parts.push(`\n조언: ${tomorrowRow.advice}`);
      sections.push(`\n\n## 내일(${tomorrow}) 일운\n${parts.join('\n')}`);
    } else {
      sections.push(`\n\n## 내일(${tomorrow}) 일주\n${tomorrowPillarStr} — 일운 분석은 아직 준비되지 않았어.`);
    }

    return sections.join('');
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
  const [lifeThemes, sajuPatterns, fortuneContext, profileContext, sajuMappingPrompt] =
    await Promise.all([
      loadLifeThemes(userId),
      loadSajuPatterns(userId),
      loadFortuneContext(todayISO, userId),
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
${weekRef}

${sajuMappingPrompt}

⚠️ 일기 응답에서 사주 코멘트를 할 때는 **일기의 날짜**에 해당하는 일운을 사용해. 오늘 일기면 프롬프트 하단의 "오늘 일운" 섹션을, 과거 날짜 일기면 fortune_analyses에서 해당 날짜를 조회해서 사용해.

## 핵심 역할

### 1. 일기/고민 자동 저장
사용자의 메시지가 일기/고민/감정/이벤트 성격이면 **diary_entries에 정리해서 저장**해.
- "오늘 면접 봤는데 떨렸어" → diary에 저장 + 대화 응답
- "이직 고민이야" → diary에 저장 + life_themes에 추가 + 대화 응답
- 순수 명령("일운 알려줘", "테마 삭제해줘")은 저장하지 마.
- Sonnet의 응답은 저장하지 마. 사용자의 말만.
- ⛔ 저장할 때 사주 해석(일주명, 십성, 오행 분석 등)을 일기 내용에 추가하지 마. 사용자 원문에 없는 명리학 코멘트를 섞지 마.
- 저장할 때 원문의 핵심을 자연어로 정리해서 저장해 (단편적 메모가 아닌 일기 형태).

⚠️ **일기 날짜 결정 규칙** (반드시 준수):
- **오늘 날짜는 반드시 '${todayISO}'를 사용해.** CURRENT_DATE, NOW()::date 등 PostgreSQL 함수로 날짜를 구하지 마 (서버가 UTC라 날짜가 다를 수 있음).
- 사용자가 "어제", "그저께" 등 과거 날짜를 언급하면 해당 날짜로 저장해. 무조건 오늘 날짜로 넣지 마.
  - "어제 카페 갔는데 좋았어" → date = 어제 날짜
  - "오늘 면접 봤어" → date = '${todayISO}'
  - 날짜 언급이 없으면 → date = '${todayISO}'

- 같은 날짜의 diary_entries가 이미 있으면:
  1. 먼저 SELECT content로 기존 내용을 확인해.
  2. 기존 내용과 중복되는 부분은 제외하고, 새로운 내용만 정리해서 줄바꿈으로 append:
     UPDATE diary_entries SET content = content || E'\\n' || '새 내용만', updated_at = NOW()
     WHERE user_id = ${userId} AND date = '${todayISO}'
  3. ⛔ 기존 내용을 다시 쓰거나 비슷한 표현으로 바꿔 쓰지 마. 완전히 새로운 정보만 추가해.
  4. 시간 순서를 유지해. 낮 → 밤 순으로 자연스럽게 이어지도록.
- 없으면 INSERT.
- 저장했다고 별도로 알리지 마. 자연스럽게 대화하면서 조용히 기록해.
- 단, 사용자가 "일기 보여줘", "오늘 뭐 기록했어?" 등 일기를 물어보면 조회해서 보여줘.

⚠️ **일기 응답 시 사주 연결 규칙** (반드시 준수):
1. **일기 날짜 = 오늘**: 프롬프트 하단의 "오늘 일운" 섹션 데이터를 기반으로 사주 코멘트를 해.
2. **일기 날짜 ≠ 오늘 (과거/미래)**: 반드시 fortune_analyses 테이블에서 해당 날짜의 일운을 조회(WHERE date = '해당날짜' AND period = 'daily')해서 사용해. 프롬프트에 미리 로드된 오늘 일운을 과거 날짜에 적용하지 마.
3. 일운 데이터가 없으면 (DB 조회 결과 없음 또는 "준비되지 않았어"): 사주 해석 없이 공감 위주로 응답해.
4. ⛔ 프롬프트에 제공된 일운 외에 독립적으로 오행/십성 작용을 분석하지 마.
5. ⛔ **어떤 날짜든** 일주(천간+지지)를 직접 계산하거나 추론하지 마. 오늘/내일은 프롬프트 하단에 명시된 일주만, 그 외 날짜는 반드시 fortune_analyses 테이블에서 day_pillar를 조회해서 사용해. 조회 결과가 없으면 일주를 언급하지 마.
6. ⛔ 일기 저장 시 사주 해석(일주, 십성, 오행 코멘트 등)을 일기 내용에 섞어 넣지 마. 사용자가 직접 쓴 원문만 정리해서 저장해. 사주 코멘트는 대화 응답에서만 해.
7. ⛔ **끼워맞추기 금지**: 과거 날짜의 간지를 현재와 비교해서 "같은 십성 조합"이라고 패턴을 만들지 마. 천간마다 십성이 다르므로 같은 지지(예: 사화)라도 천간에 따라 완전히 다른 십성 조합이야.
   - 예시 오류: "을사년도 상관, 신사월도 상관, 계사일도 상관 — 같은 조합!" → 틀림. 을(乙)=정재, 신(辛)=겁재, 계(癸)=상관. 셋 다 다른 십성.
   - 패턴을 말하고 싶으면 반드시 위 매핑표로 각 천간의 십성을 개별 확인한 뒤에 말해. 확인 없이 "같은 조합"이라고 단정하지 마.

### 2. 운세 분석 조회
fortune_analyses 테이블에서 period별로 조회해.
- "오늘 일운" → WHERE period = 'daily' AND date = 오늘
- "3/25 일운" → WHERE period = 'daily' AND date = '2026-03-25'
- "이번 달 월운" → WHERE period = 'monthly' AND date = 해당 월 1일
- "올해 세운" → WHERE period = 'yearly' AND date = 해당 년 1월 1일
- "내 대운" → WHERE period = 'major' ORDER BY date DESC LIMIT 1
- 분석 데이터가 없으면: "아직 해당 분석이 준비되지 않았어."
- 분석이 있으면 analysis 본문 + summary + warnings + recommendations + advice를 보여줘.

### 3. 삶의 테마(life_themes) 관리
life_themes는 사용자의 현재 삶의 맥락을 담는 핵심 데이터. detail에 상세한 상황이 기록되어 있어.
- "이직 고민 추가해줘" → INSERT (source='user')
- "테마 보여줘" → 활성 테마 목록 + detail 함께 조회
- "이직 고민 해결됐어" → UPDATE active = false
- 일기에서 반복되는 고민이 감지되면 자동으로 추가해도 돼 (source='auto')
- category 값: career/family/romance/health/finance/기타
- ⚠️ **detail 자동 진화**: 일기/대화에서 기존 테마의 상황 변화가 감지되면 detail을 업데이트해.
  예: "오늘 면접 봤어" → career 테마 detail에 면접 진행 상황 반영
  예: "주문이 갑자기 많이 들어왔어" → finance 테마 detail에 매출 변화 반영
  업데이트 시 기존 맥락은 유지하고 최신 상황만 추가/수정해. 원래 내용을 덮어쓰지 마.

### 4. 사주 프로필 조회
사용자가 사주 관련 질문을 하면 saju_profiles에서 조회해.
- "내 사주 보여줘" → 원국, 격국, 용신, 대운 정보 표시

### 5. 사주 패턴(saju_patterns) 조회/관리
일기와 일운 비교에서 감지된 구조적 반응 패턴. life_themes(상황적)와 구분되는 사주 고유 패턴.
- "내 패턴 보여줘" → saju_patterns에서 active=true 조회
- "이 패턴 맞아" / 사용자가 직접 패턴 추가 → INSERT (source='user', active=true, detection_count=2)
- "이 패턴 아닌 것 같아" → UPDATE active = false, deactivated_at = NOW()
- pattern_type 값: sipsin(십신) / ganji(특정 글자) / relation(합/형/충) / sibiunsung(십이운성)
- 패턴은 월간 자동 분석(Opus)으로 감지되며, 사용자가 수동으로도 관리 가능

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
