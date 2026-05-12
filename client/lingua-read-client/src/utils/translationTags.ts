/**
 * LLM sentence API may return paired tags: <o s="N">...</o><t s="N">...</t>
 * Extract plain translation text from <t> segments only.
 */
export function extractTranslatedTextFromPairedTags(raw: unknown): string {
  if (!raw || typeof raw !== 'string') return '';
  const re = /<t\s+s=["'](\d+)["']>([\s\S]*?)<\/t>/g;
  const parts: { n: number; t: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    parts.push({ n: parseInt(m[1], 10), t: m[2].trim() });
  }
  if (parts.length === 0) return raw.trim();
  parts.sort((a, b) => a.n - b.n);
  return parts.map((p) => p.t).join(' ');
}
