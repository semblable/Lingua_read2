/**
 * Parses plain-text sentence explanations from the API into labeled sections.
 * Expected headers (from server prompt): Grammar, Nuance, Culture/Context, Natural phrasing
 */

const SECTION_ORDER = [
  { id: 'grammar', label: 'Grammar' },
  { id: 'nuance', label: 'Nuance' },
  { id: 'culture', label: 'Culture / context' },
  { id: 'natural', label: 'Natural phrasing' }
];

const HEADER_PATTERNS = [
  /^Grammar:\s*(.*)$/i,
  /^Nuance:\s*(.*)$/i,
  /^Culture\/Context:\s*(.*)$/i,
  /^Natural phrasing:\s*(.*)$/i
];

/**
 * @param {string} raw
 * @returns {{ sections: Array<{ id: string, label: string, body: string }>, fallback: string | null }}
 */
export function parseSentenceExplanation(raw) {
  if (raw == null || typeof raw !== 'string') {
    return { sections: [], fallback: '' };
  }

  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { sections: [], fallback: '' };
  }

  const lines = normalized.split('\n');
  const sections = [];
  let currentIndex = -1;
  const bodies = [[], [], [], []];

  for (const line of lines) {
    let matched = false;
    for (let i = 0; i < HEADER_PATTERNS.length; i++) {
      const m = line.match(HEADER_PATTERNS[i]);
      if (m) {
        currentIndex = i;
        matched = true;
        const rest = (m[1] || '').trim();
        if (rest) {
          bodies[i].push(rest);
        }
        break;
      }
    }
    if (!matched && currentIndex >= 0) {
      bodies[currentIndex].push(line);
    }
  }

  for (let i = 0; i < SECTION_ORDER.length; i++) {
    const body = bodies[i].join('\n').trim();
    if (body) {
      sections.push({
        id: SECTION_ORDER[i].id,
        label: SECTION_ORDER[i].label,
        body
      });
    }
  }

  if (sections.length === 0) {
    return { sections: [], fallback: raw };
  }

  return { sections, fallback: null };
}

export default parseSentenceExplanation;
