/**
 * 사주 달력 CLI 실행 경로.
 * 저장소 밖 예약 작업이 `npx tsx src/shared/saju-calendar.ts <시작일> <일수>`로 부르므로 경로를 유지한다.
 * 계산 로직은 `src/shared/saju/` 아래에 있고, 코드에서는 이 파일을 import하지 않는다.
 */
import { runCLI } from './saju/cli.js';

runCLI().catch((err: unknown) => {
  console.error('[saju-calendar] 오류:', err instanceof Error ? err.message : err);
  process.exit(1);
});
