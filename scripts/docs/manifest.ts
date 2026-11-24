/**
 * docs/doc-manifest.json 읽기와 문서 분류.
 */
import { matchesGlob } from './glob.js';

export const MANIFEST_PATH = 'docs/doc-manifest.json';

export type DocKind = 'record' | 'current';

export interface ManifestEntry {
  glob: string;
  kind: DocKind;
  /** 현황 문서가 설명하는 코드 범위. 이 범위가 바뀌면 문서도 다시 봐야 한다. */
  sources: string[];
}

export interface Classification {
  kinds: DocKind[];
  sources: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON 문자열을 검증해 항목 목록으로 바꾼다. 형식이 틀리면 이유를 담아 던진다. */
export const parseManifest = (json: string): ManifestEntry[] => {
  const data: unknown = JSON.parse(json);
  if (!isRecord(data) || !Array.isArray(data['documents'])) {
    throw new Error(`${MANIFEST_PATH}: documents 배열이 없습니다`);
  }
  return data['documents'].map((item: unknown, index): ManifestEntry => {
    if (!isRecord(item)) throw new Error(`${MANIFEST_PATH}: documents[${index}]가 객체가 아닙니다`);
    const { glob, kind, sources } = item;
    if (typeof glob !== 'string' || glob.length === 0) {
      throw new Error(`${MANIFEST_PATH}: documents[${index}].glob이 없습니다`);
    }
    if (kind !== 'record' && kind !== 'current') {
      throw new Error(`${MANIFEST_PATH}: ${glob}의 kind는 record 또는 current여야 합니다`);
    }
    if (sources !== undefined && !(Array.isArray(sources) && sources.every((s) => typeof s === 'string'))) {
      throw new Error(`${MANIFEST_PATH}: ${glob}의 sources는 문자열 배열이어야 합니다`);
    }
    return { glob, kind, sources: Array.isArray(sources) ? (sources as string[]) : [] };
  });
};

/** 문서 하나가 속한 종류와 sources를 모은다. 종류가 0개이거나 2개면 등록이 잘못된 것이다. */
export const classify = (docPath: string, entries: readonly ManifestEntry[]): Classification => {
  const matched = entries.filter((entry) => matchesGlob(docPath, entry.glob));
  return {
    kinds: [...new Set(matched.map((entry) => entry.kind))],
    sources: [...new Set(matched.flatMap((entry) => entry.sources))],
  };
};

/** 어느 문서와도 맞지 않는 글롭. 문서를 지우거나 옮긴 뒤 남은 항목을 찾는다. */
export const findUnusedGlobs = (entries: readonly ManifestEntry[], docs: readonly string[]): string[] =>
  entries.filter((entry) => !docs.some((doc) => matchesGlob(doc, entry.glob))).map((entry) => entry.glob);
