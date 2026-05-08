/**
 * fortune_analyses 표시 포맷터.
 * summary(*볼드*) + analysis + advice(_기울임_) 자연 prose 결합.
 */

export interface FortuneFormatInput {
  summary: string | null;
  analysis: string;
  advice: string | null;
}

export const formatFortuneText = (f: FortuneFormatInput): string => {
  const parts: string[] = [];
  if (f.summary) parts.push(`*${f.summary}*`);
  if (f.analysis) parts.push(f.analysis);
  if (f.advice) parts.push(`_${f.advice}_`);
  return parts.join('\n\n');
};
