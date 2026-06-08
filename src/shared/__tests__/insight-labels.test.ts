import { describe, it, expect } from 'vitest';
import { seedLabel, signalLabel, type SignalLabelInput } from '../insight-labels.js';

// 변수명·provenance 노출 0 불변식 검증의 핵심 헬퍼 — 라벨에 raw 식별자 흔적이 없는지.
const looksLikeIdentifier = (s: string): boolean => /[A-Za-z]|_/.test(s);

describe('seedLabel — description tail-strip', () => {
  it('→ 앞 활성조건만 취하고 십성 주석 (편재)은 보존', () => {
    expect(
      seedLabel({
        name: 'S1_갑목_편재_천간',
        description: '일운 천간 갑목(편재) → 일정/지출 폭증 가능성',
      }),
    ).toBe('일운 천간 갑목(편재)');
  });

  it('— (em dash) 앞 활성조건만 취함 (ganji 콤보·예측절 제거)', () => {
    expect(
      seedLabel({
        name: 'pool_갑술',
        description: '갑술 60갑자일 — 갑(편재) + 술(편인) 콤보 — 본인 일지 비화',
      }),
    ).toBe('갑술 60갑자일');
  });

  it('life_signal — 가설 꼬리표 제거', () => {
    expect(
      seedLabel({
        name: 'life_month_end',
        description: '월말 3일 — 카드 결제일·마무리 분위기 가설',
      }),
    ).toBe('월말 3일');
  });

  it('내부 참조(ADR) 꼬리표 제거', () => {
    expect(
      seedLabel({
        name: 'pool_편재_누적_N1',
        description: '편재 누적 1개 이상 (5개 운 레벨 중) — 풀셋 임계치 (ADR-0028)',
      }),
    ).toBe('편재 누적 1개 이상 (5개 운 레벨 중)');
  });

  it('구분자 없으면 description 전체 (괄호 범위 표기 보존)', () => {
    expect(seedLabel({ name: 'life_weekday', description: '평일(월~금) 발현일' })).toBe(
      '평일(월~금) 발현일',
    );
  });

  it('override 우선', () => {
    // 빈 맵이라 실제로는 미발동 — 시그니처/우선순위 회귀 가드.
    expect(seedLabel({ name: 'life_month_end', description: '월말 3일 — 가설' })).toBe('월말 3일');
  });

  it('description 비면 name fallback (방어)', () => {
    expect(seedLabel({ name: '갑목일주', description: null })).toBe('갑목일주');
    expect(seedLabel({ name: '갑목일주', description: '   ' })).toBe('갑목일주');
  });

  it('strip 결과가 전 시드 타입에서 변수명·언더스코어 미노출', () => {
    const samples: Array<{ name: string; description: string }> = [
      { name: 'N1_임수_식신_천간', description: '일운 천간 임수(식신) → 요리/창작/대화/먹기' },
      {
        name: 'pool_강도_일간_강',
        description: '일간 실효 강도 강(신강 경향) — 생조 강한 날, 추진력·활동 가설',
      },
      { name: 'pool_귀문_묘신', description: '지지 귀문 발현일 — 묘·신' },
      { name: 'pool_건록', description: '건록일 — 활력·열정·업무 폭주·운동 잘됨' },
      { name: 'S5_토_과다', description: '본명 토 2개 + 일운 토 합산 ≥ 4 → 무기력/수면↑' },
    ];
    for (const s of samples) {
      const label = seedLabel(s);
      expect(label).not.toContain('_');
      expect(label).not.toContain('pool');
      expect(label).not.toMatch(/[A-Za-z]/);
    }
  });
});

// 신호 라벨 입력 빌더 — 실제 signal_defs 메타 기준.
const sig = (over: Partial<SignalLabelInput> & { name: string }): SignalLabelInput => ({
  kind: 'sql',
  source: 'seed',
  direction: 'above_avg',
  threshold: null,
  tagName: null,
  domain: null,
  description: null,
  ...over,
});

describe('signalLabel — sql seed 룰', () => {
  it('above_avg → 측정 명사 + 평소보다 많음', () => {
    expect(
      signalLabel(sig({ name: 'sleep_night_minutes', domain: 'sleep', direction: 'above_avg' })),
    ).toBe('밤잠 평소보다 많음');
  });

  it('below_avg → 평소보다 적음', () => {
    expect(
      signalLabel(
        sig({ name: 'schedule_count_today', domain: 'schedule', direction: 'below_avg' }),
      ),
    ).toBe('일정 수 평소보다 적음');
  });

  it('율 신호는 높음/낮음 어휘', () => {
    expect(
      signalLabel(
        sig({ name: 'routine_completion_rate', domain: 'routine', direction: 'below_avg' }),
      ),
    ).toBe('루틴 완료율 평소보다 낮음');
    expect(
      signalLabel(
        sig({ name: 'schedule_completion_rate', domain: 'schedule', direction: 'above_avg' }),
      ),
    ).toBe('일정 완료율 평소보다 높음');
  });

  it('기상 시각은 늦음/이름 어휘', () => {
    expect(
      signalLabel(sig({ name: 'sleep_wake_hour', domain: 'sleep', direction: 'above_avg' })),
    ).toBe('기상 시각 평소보다 늦음');
  });

  it('한글접미 신호는 도메인 명사로 자연어화', () => {
    expect(
      signalLabel(sig({ name: 'expense_배달음식', domain: 'expense', direction: 'above_avg' })),
    ).toBe('배달음식 지출 평소보다 많음');
  });

  it('above_abs threshold=1 → 있음', () => {
    expect(
      signalLabel(
        sig({ name: 'schedule_영화', domain: 'schedule', direction: 'above_abs', threshold: 1 }),
      ),
    ).toBe('영화 일정 있음');
  });

  it('above_abs threshold>1 → N회 이상', () => {
    expect(
      signalLabel(
        sig({ name: 'sleep_nap_count', domain: 'sleep', direction: 'above_abs', threshold: 2 }),
      ),
    ).toBe('낮잠 2회 이상');
  });

  it('flag_present → 있음', () => {
    expect(
      signalLabel(
        sig({
          name: 'expense_의료건강',
          kind: 'sql',
          domain: 'expense_category_present',
          direction: 'flag_present',
          threshold: 1,
        }),
      ),
    ).toBe('의료·건강 지출 있음');
  });
});

describe('signalLabel — override / tag / llm', () => {
  it('합성 신호는 override 라벨 (direction 무시)', () => {
    expect(
      signalLabel(
        sig({
          name: 'schedule_tax_keyword',
          domain: 'schedule',
          direction: 'above_abs',
          threshold: 1,
        }),
      ),
    ).toBe('세금 관련 일정');
    expect(
      signalLabel(
        sig({
          name: 'expense_hospital_excl_installment',
          domain: 'expense',
          direction: 'above_abs',
          threshold: 1,
        }),
      ),
    ).toBe('병원비 지출(할부 제외)');
  });

  it('tag 신호는 diary 한글맵', () => {
    expect(
      signalLabel(
        sig({
          name: 'creating',
          kind: 'tag',
          domain: 'diary_meta',
          tagName: 'creating',
          direction: null,
        }),
      ),
    ).toBe('창작');
    expect(
      signalLabel(
        sig({
          name: 'wealth_awareness',
          kind: 'tag',
          domain: 'diary_meta',
          tagName: 'wealth_awareness',
          direction: null,
        }),
      ),
    ).toBe('돈 인식');
  });

  it('llm 신호는 자작 description 사용', () => {
    expect(
      signalLabel(
        sig({
          name: 'llm_some_signal',
          source: 'llm',
          domain: 'sleep',
          direction: 'above_avg',
          description: '주말 늦잠 패턴',
        }),
      ),
    ).toBe('주말 늦잠 패턴');
  });
});

describe('signalLabel — 미매핑 fallback (불변식: raw 변수명 노출 0)', () => {
  it('미매핑 영문 신호도 도메인 명사로 — 변수명·언더스코어 미노출', () => {
    const label = signalLabel(
      sig({ name: 'sleep_rem_ratio', domain: 'sleep', direction: 'above_avg' }),
    );
    expect(label).toBe('수면 평소보다 많음');
    expect(looksLikeIdentifier(label)).toBe(false);
  });

  it('미매핑 한글접미 신호는 도메인 명사 + 접미 보존', () => {
    expect(
      signalLabel(sig({ name: 'expense_술', domain: 'expense', direction: 'above_avg' })),
    ).toBe('지출 술 평소보다 많음');
  });

  it('도메인까지 미상이면 지표 fallback (그래도 변수명 미노출)', () => {
    const label = signalLabel(
      sig({ name: 'mystery_metric', domain: null, direction: 'above_avg' }),
    );
    expect(looksLikeIdentifier(label)).toBe(false);
  });

  it('llm 신호인데 description 비면 도메인 명사 fallback', () => {
    const label = signalLabel(
      sig({
        name: 'llm_blank',
        source: 'llm',
        domain: 'expense',
        direction: 'above_avg',
        description: null,
      }),
    );
    expect(looksLikeIdentifier(label)).toBe(false);
    expect(label).toBe('지출 평소보다 많음');
  });
});
