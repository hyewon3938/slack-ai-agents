# fix: Insight 에이전트 일운 데이터 할루시네이션 방지

## 개요

Sonnet이 일기 응답 시 fortune_analyses를 직접 조회하지 않고 자체 추론으로 잘못된 일주를 생성하는 문제.
기축일(3/16)인데 경인일(3/17)로 해석하는 등 인접 날짜 혼동 발생.

**원인**: 프롬프트가 "query_db로 직접 조회해라"고 지시하지만, Sonnet이 도구 호출을 건너뛰고 자체 생성하는 비결정적 동작.

**해결**: life_themes/saju_patterns와 동일하게, 프롬프트 빌드 시점에 오늘 일운을 DB에서 미리 조회하여 시스템 프롬프트에 주입.

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/agents/insight/prompt.ts` | MODIFY | loadTodayFortune() 추가 + 프롬프트에 주입 + 기존 조회 지시 간소화 |

## 구현 상세

### 1. loadTodayFortune() 함수 추가

**위치**: `prompt.ts` 상단, loadSajuPatterns() 아래

```typescript
/** DB에서 오늘 일운 조회 → 프롬프트 주입용 */
const loadTodayFortune = async (today: string): Promise<string> => {
  try {
    const result = await query<{
      day_pillar: string | null;
      analysis: string;
      summary: string | null;
      warnings: unknown;
      recommendations: unknown;
      advice: string | null;
    }>(
      `SELECT day_pillar, analysis, summary, warnings, recommendations, advice
       FROM fortune_analyses
       WHERE user_id = 1 AND period = 'daily' AND date = $1`,
      [today],
    );
    if (result.rows.length === 0) return '\n\n## 오늘 일운\n아직 오늘 일운 분석이 준비되지 않았어.';

    const f = result.rows[0]!;
    const parts: string[] = [];
    if (f.day_pillar) parts.push(`오늘의 일주: ${f.day_pillar}`);
    if (f.summary) parts.push(`요약: ${f.summary}`);
    if (f.analysis) parts.push(`\n${f.analysis}`);
    if (f.advice) parts.push(`\n조언: ${f.advice}`);
    return `\n\n## 오늘 일운 (Opus 분석 — 이 데이터를 기반으로 말해)\n${parts.join('\n')}`;
  } catch {
    return '';
  }
};
```

**패턴**: loadLifeThemes(), loadSajuPatterns()와 동일한 패턴.
**today 파라미터**: getTodayISO() 결과를 받음 (YYYY-MM-DD 형식, DB 조회에 사용).

### 2. buildInsightSystemPrompt() 수정

**Before:**
```typescript
export const buildInsightSystemPrompt = async (): Promise<string> => {
  const today = getTodayString();
  const weekRef = getWeekReference();
  const lifeThemes = await loadLifeThemes();
  const sajuPatterns = await loadSajuPatterns();
```

**After:**
```typescript
export const buildInsightSystemPrompt = async (): Promise<string> => {
  const today = getTodayString();
  const todayISO = getTodayISO();
  const weekRef = getWeekReference();
  const [lifeThemes, sajuPatterns, todayFortune] = await Promise.all([
    loadLifeThemes(),
    loadSajuPatterns(),
    loadTodayFortune(todayISO),
  ]);
```

**변경점**:
- `getTodayISO` import 추가
- 3개 DB 조회를 `Promise.all`로 병렬 실행 (기존 순차 → 병렬, 성능 개선)
- todayFortune 변수 추가

### 3. 프롬프트 주입 위치

**Before (끝부분):**
```
${lifeThemes}${sajuPatterns}`;
```

**After:**
```
${lifeThemes}${sajuPatterns}${todayFortune}`;
```

### 4. 기존 "조회 지시" 간소화

**Before (136\~145):**
```
⚠️ **일기 응답 시 사주 연결 규칙** (반드시 준수):
1. 일기/고민/감정에 응답하기 전, fortune_analyses에서 오늘의 일운을 조회해:
   SELECT analysis, summary, warnings, recommendations FROM fortune_analyses WHERE user_id = 1 AND period = 'daily' AND date = '${today}'
2. 일운 데이터가 있으면: ...
3. 일운 데이터가 없으면: ...
4. ⛔ fortune_analyses 없이 독립적으로 오행/십성 작용을 분석하지 마.
```

**After:**
```
⚠️ **일기 응답 시 사주 연결 규칙** (반드시 준수):
1. 시스템 프롬프트 하단의 "오늘 일운" 섹션에 Opus 분석이 포함되어 있어. 이 데이터를 기반으로 사주 코멘트를 해.
2. 일운 데이터가 "준비되지 않았어"로 표시되면: 사주 해석 없이 공감 위주로 응답해.
3. ⛔ 프롬프트에 제공된 일운 외에 독립적으로 오행/십성 작용을 분석하지 마.
4. ⛔ 특히 오늘의 일주(천간+지지)를 직접 계산하거나 추론하지 마 — 프롬프트에 명시된 일주만 사용해.
```

**핵심 변경**: "직접 SQL 조회해라" → "프롬프트에 이미 있다. 그걸 써라"

### 5. import 추가

```typescript
import { getTodayString, getWeekReference, getTodayISO } from '../../shared/kst.js';
```

## 커밋 계획

1. `fix: insight 에이전트에 오늘 일운 사전 주입 — 일주 할루시네이션 방지` - prompt.ts

## 테스트 계획

- [ ] 빌드 성공 (npx tsc --noEmit)
- [ ] 배포 후 #insight에서 일기 기록 → 응답에 정확한 일주 사용 확인
- [ ] fortune_analyses에 오늘 데이터 없을 때 → "아직 준비되지 않았어" 메시지 + 사주 해석 없이 공감

## 체크리스트

- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (query<T> 제네릭)
- [ ] 에러 핸들링 포함 (try-catch, 빈 문자열 반환)
- [ ] user_id = 1 조건 포함
- [ ] Promise.all 병렬 처리로 성능 저하 없음
