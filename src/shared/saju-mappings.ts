/**
 * 사주 십성 매핑 유틸리티
 * 일간(천간 1글자)을 입력받아 십성 매핑 프롬프트 블록을 동적으로 생성한다.
 * 개인정보(일간)는 DB(saju_profiles)에서 런타임에 로드하여 코드에 하드코딩하지 않는다.
 */

/** 천간 (오행/음양 판별 순서 고정) */
const CHEONGAN = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'] as const;
const CHEONGAN_HANJA = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;

/** 지지 */
const JIJI = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'] as const;
const JIJI_HANJA = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

/** 지지의 본기 천간 */
const JIJI_BONGI: Record<string, string> = {
  자: '계',
  축: '기',
  인: '갑',
  묘: '을',
  진: '무',
  사: '병',
  오: '정',
  미: '기',
  신: '경',
  유: '신',
  술: '무',
  해: '임',
};

/** 오행 이름 (인덱스: 목=0, 화=1, 토=2, 금=3, 수=4) */
const OHANG_NAMES = ['목', '화', '토', '금', '수'] as const;

/** 십성 타입 */
type Sipsung =
  | '비견'
  | '겁재'
  | '식신'
  | '상관'
  | '편재'
  | '정재'
  | '편관'
  | '정관'
  | '편인'
  | '정인';

/** 천간의 오행 인덱스 반환 (갑을=목0, 병정=화1, 무기=토2, 경신=금3, 임계=수4) */
const getOhangIndex = (cheongan: string): number => {
  const idx = CHEONGAN.indexOf(cheongan as (typeof CHEONGAN)[number]);
  return Math.floor(idx / 2);
};

/** 천간의 음양 반환 (양간: 짝수 인덱스) */
const isYang = (cheongan: string): boolean => {
  return CHEONGAN.indexOf(cheongan as (typeof CHEONGAN)[number]) % 2 === 0;
};

/**
 * 일간과 대상 천간의 관계로 십성 판별
 *
 * 오행 관계 (상생: 목→화→토→금→수→목):
 * - diff=0: 같은 오행 → 비견(같은 음양) / 겁재(다른 음양)
 * - diff=1: 내가 생하는 오행 → 식신(같은 음양) / 상관(다른 음양)
 * - diff=2: 내가 극하는 오행 → 편재(같은 음양) / 정재(다른 음양)
 * - diff=3: 나를 극하는 오행 → 편관(같은 음양) / 정관(다른 음양)
 * - diff=4: 나를 생하는 오행 → 편인(같은 음양) / 정인(다른 음양)
 */
export const getSipsung = (ilgan: string, target: string): Sipsung => {
  const myOhang = getOhangIndex(ilgan);
  const targetOhang = getOhangIndex(target);
  const sameYinYang = isYang(ilgan) === isYang(target);

  const diff = (targetOhang - myOhang + 5) % 5;

  switch (diff) {
    case 0:
      return sameYinYang ? '비견' : '겁재';
    case 1:
      return sameYinYang ? '식신' : '상관';
    case 2:
      return sameYinYang ? '편재' : '정재';
    case 3:
      return sameYinYang ? '편관' : '정관';
    case 4:
      return sameYinYang ? '편인' : '정인';
    default:
      return '비견'; // unreachable
  }
};

/**
 * 일간 기반으로 전체 십성 매핑 프롬프트 블록 생성
 * @param ilgan 천간 1글자 (예: '경', '갑', '임')
 * @returns 시스템 프롬프트에 삽입할 사주 원국 섹션 문자열
 */
export const buildSipsungPrompt = (ilgan: string): string => {
  const ilganIdx = CHEONGAN.indexOf(ilgan as (typeof CHEONGAN)[number]);
  if (ilganIdx === -1) return '';

  const ilganHanja = CHEONGAN_HANJA[ilganIdx];
  const yangOrYin = isYang(ilgan) ? '양' : '음';
  const ohangName = OHANG_NAMES[getOhangIndex(ilgan)];

  // 천간 십성 매핑
  const cheonganLines = CHEONGAN.map(
    (c, i) => `${c}(${CHEONGAN_HANJA[i]})=${getSipsung(ilgan, c)}`,
  ).join(', ');

  // 지지 본기 십성 매핑
  const jijiLines = JIJI.map(
    (j, i) => `${j}(${JIJI_HANJA[i]})=${getSipsung(ilgan, JIJI_BONGI[j])}`,
  ).join(', ');

  const oppositeYinYang = isYang(ilgan) ? '음' : '양';

  return `## 사용자 원국 — ${ilgan}${yangOrYin}(${ilganHanja}) 일간

### 십성 매핑 (천간)
${cheonganLines}

### 십성 매핑 (지지 본기)
${jijiLines}

### 오행 상생상극 (필수 참조 — 이 외의 관계는 존재하지 않아)
상생: 목→화→토→금→수→목 (목생화, 화생토, 토생금, 금생수, 수생목)
상극: 목→토, 토→수, 수→화, 화→금, 금→목 (목극토, 토극수, 수극화, 화극금, 금극목)
⛔ "토생수", "금생화", "수생토" 같은 관계는 없어. 반드시 위 순환만 참조해.

### 천간 오행·음양
갑(양목) 을(음목) 병(양화) 정(음화) 무(양토) 기(음토) 경(양금) 신(음금) 임(양수) 계(음수)

### 편(偏) vs 정(正) 구분
일간과 같은 음양 = 편(偏), 다른 음양 = 정(正).
${ilgan}(${ilganHanja})=${yangOrYin}${ohangName}이므로: ${yangOrYin}간과 만나면 편, ${oppositeYinYang}간과 만나면 정.

### 십성 핵심 의미 (편 vs 정 혼동 주의)
- 비견: 나와 같은 기운. 경쟁, 독립, 자존심, 고집
- 겁재: 빼앗는 기운. 승부욕, 과감함, 충동, 과시
- 식신: 내가 생(같은 음양). 여유, 먹거리, 편안한 표현, 복
- 상관: 내가 생(다른 음양). 날카로움, 비판, 예술적 재능, 반항
- 편재: 내가 극(같은 음양). 큰 돈, 유동적, 투자, 사업, 아버지
- 정재: 내가 극(다른 음양). 안정적 수입, 월급, 저축, 절약, 아내
- 편관: 나를 극(같은 음양). 압박, 스트레스, 권력, 강한 통제, 위험
- 정관: 나를 극(다른 음양). 질서, 규율, 직장, 명예, 책임감
- 편인: 나를 생(같은 음양). 비정통 학문, 편벽된 사고, 독창성, 잡학, 고독
- 정인: 나를 생(다른 음양). 정통 학문, 어머니, 자격증, 보호, 안정, 인자함
⛔ 편인과 정인은 전혀 다른 십성. 편인=독창적/편벽적/고독, 정인=안정적/정통적/보호.

⚠️ 명리학 용어 사용 시 반드시 위 매핑표와 오행 상생상극을 참조해. 직접 추론하지 마.`;
};
