import reactHooks from 'eslint-plugin-react-hooks';
import rootConfig from '../eslint.config.mjs';

// 웹 대시보드 전용 ESLint 설정.
// 규칙의 단일 출처는 루트 설정이고, 여기서는 웹에만 해당하는 차이만 얹는다.
// (typescript-eslint 등 루트 설정이 import하는 패키지는 루트 node_modules에서 해석된다)
export default [
  ...rootConfig,

  {
    ignores: ['.next/', 'next-env.d.ts'],
  },

  // React 훅 규칙. 훅 호출 순서 위반은 실제 버그라 error,
  // 의존성 배열은 의도적으로 비우는 경우가 있어 warn.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // non-null 단언은 봇에선 error지만 웹에선 warn으로 둔다.
  // 웹 코드에 이미 널리 퍼져 있어 지금 일괄 제거하면 이 PR 범위를 벗어나고,
  // 되레 런타임 동작을 바꿀 위험이 있다. 새로 쓰지 말라는 신호로 남긴다.
  {
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  // 테스트는 픽스처가 존재한다는 전제 위에서 단언하는 게 정상이라 아예 끈다.
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
