/**
 * 문서 검사에서 쓰는 최소 글롭 매처.
 * `**`는 폴더 경계를 넘고 `*`는 한 구간 안에서만 맞는다.
 */

const escapeRegex = (text: string): string => text.replace(/[.+^${}()|[\]\\?]/g, '\\$&');

/** 글롭을 전체 일치 정규식으로 바꾼다. */
export const globToRegex = (glob: string): RegExp => {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
    } else if (glob.startsWith('**', i)) {
      out += '.*';
      i += 2;
    } else if (glob[i] === '*') {
      out += '[^/]*';
      i += 1;
    } else {
      out += escapeRegex(glob[i] ?? '');
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
};

export const matchesGlob = (path: string, glob: string): boolean => globToRegex(glob).test(path);

export const matchesAny = (path: string, globs: readonly string[]): boolean =>
  globs.some((glob) => matchesGlob(path, glob));
