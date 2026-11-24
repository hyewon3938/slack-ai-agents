/**
 * 코드 맵 생성기 설정.
 * 훑는 최상위 폴더와 출력 위치만 여기서 정한다. 그 아래 구조는 실행할 때마다 다시 훑는다.
 */

/** 봇 소스 최상위 폴더 */
export const BOT_ROOT = 'src';
/** 웹 소스 최상위 폴더 */
export const WEB_ROOT = 'web/src';
/** Next.js app 라우터 폴더 */
export const WEB_APP_ROOT = 'web/src/app';
/** 마이그레이션 SQL 폴더 */
export const MIGRATIONS_DIR = 'db/migrations';
/** Vercel 설정 파일 */
export const VERCEL_CONFIG = 'web/vercel.json';
/** GitHub Actions 워크플로 폴더 */
export const WORKFLOWS_DIR = '.github/workflows';
/** 생성 결과 폴더 */
export const OUTPUT_DIR = 'docs/code-map';

/** 훑지 않는 폴더 이름 */
export const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.next', '.git', '_personal']);

/** 읽지 않는 파일 이름 패턴 */
const SKIP_FILE_PATTERNS = [
  /^\.env/,
  /^\.mcp\.json$/,
  /^\.claude\.json$/,
  /^credentials/i,
  /^secrets/i,
];

export const isSkippedFile = (name: string): boolean =>
  SKIP_FILE_PATTERNS.some((p) => p.test(name));

/** 모든 생성 파일 맨 위에 넣는 안내 */
export const GENERATED_NOTICE = [
  '<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->',
  '',
  '> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.',
].join('\n');
