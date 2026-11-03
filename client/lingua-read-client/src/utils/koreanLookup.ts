/**
 * Korean lookup aliases only. Source spelling and vocabulary identity stay intact:
 * modern conjoining Jamo compose, compatibility Jamo (ㄱ, ㅏ, …) do not.
 * Callers supply their existing trimmed/cased keys; do not persist these aliases.
 */
export const isKoreanLanguageCode = (code?: string | null): boolean =>
  (code || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0] === 'ko';

export interface KoreanTokenAnalysis {
  lemma: string;
  particle: string;
  particleType: string;
}

export type BatchimCondition =
  | 'any'
  | 'requiresBatchim'
  | 'requiresNoBatchim'
  | 'requiresNonRieulBatchim'
  | 'requiresNoBatchimOrRieul';

interface ParticleRule {
  particle: string;
  condition: BatchimCondition;
  particleType: string;
}

export const hasBatchim = (c: string): boolean => {
  const code = c.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 > 0;
};

export const getBatchim = (c: string): number => {
  const code = c.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return 0;
  return (code - 0xac00) % 28;
};

const checkBatchim = (c: string, condition: BatchimCondition): boolean => {
  const code = c.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  const jong = (code - 0xac00) % 28;
  switch (condition) {
    case 'any':
      return true;
    case 'requiresBatchim':
      return jong > 0;
    case 'requiresNoBatchim':
      return jong === 0;
    case 'requiresNonRieulBatchim':
      return jong > 0 && jong !== 8;
    case 'requiresNoBatchimOrRieul':
      return jong === 0 || jong === 8;
    default:
      return false;
  }
};

// Free 1-syllable noun whitelist (~160 common words)
export const ONE_SYLLABLE_NOUNS: ReadonlySet<string> = new Set([
  '책', '집', '밥', '물', '눈', '손', '발', '말', '일', '길', '꽃', '돈', '술', '옷', '방', '문',
  '산', '강', '달', '별', '해', '비', '차', '배', '숲', '밤', '낮', '꿈', '땀', '힘', '흙', '돌',
  '새', '소', '개', '닭', '쥐', '곰', '뱀', '봄', '빵', '떡', '면', '콩', '쌀', '살', '피', '뼈',
  '귀', '코', '입', '이', '턱', '목', '등', '팔', '볼', '혀', '털', '몸', '간', '골', '땅', '풀',
  '잎', '씨', '빛', '색', '맛', '멋', '끝', '값', '빚', '글', '뜻', '날', '곳', '점', '속', '겉',
  '앞', '뒤', '밑', '위', '옆', '칼', '줄', '끈', '통', '병', '잔', '상', '벽', '창', '총', '활',
  '솥', '잠', '숨', '정', '덕', '복', '한', '얼', '넋', '티', '짐', '법', '시', '분', '초', '쪽',
  '편', '짝', '놈', '남', '적', '신', '철', '국', '탕', '죽', '회', '김', '꿀', '깨', '감', '귤',
  '잣', '알', '양', '벌', '용', '꿩', '늪', '샘', '틀', '못', '닻', '돛', '갓', '탈', '윷', '틈',
  '덤', '몫', '꼴', '때', '첫', '약', '불', '춤', '키', '빗', '삯', '볕', '판', '품', '결', '곁'
]);

export const AGENT_NOUNS: ReadonlySet<string> = new Set([
  '정치가', '만화가', '음악가', '소설가', '전문가', '예술가', '자본가', '사업가', '운동가', '작가',
  '화가', '건축가', '사진가', '사상가', '비평가', '평론가', '연출가', '과학가', '무용가', '철학가', '탐험가'
]);

export const LOANWORDS_NA: ReadonlySet<string> = new Set([
  '바나나', '코로나', '사우나', '안테나'
]);

export const PROTECTED_WORDS: ReadonlySet<string> = new Set([
  '오이', '포도', '사자', '지도', '고속도로', '민주주의', '바나나', '코로나', '정치가', '만화가',
  '선거제도', '교육제도', '사법제도', '한반도', '피아노', '카메라', '드라마', '시네마'
]);

const COPULAS: ParticleRule[] = [
  { particle: '입니다', condition: 'any', particleType: 'Copula' },
  { particle: '이에요', condition: 'requiresBatchim', particleType: 'Copula' },
  { particle: '예요', condition: 'requiresNoBatchim', particleType: 'Copula' },
  { particle: '이다', condition: 'any', particleType: 'Copula' },
  { particle: '이었다', condition: 'requiresBatchim', particleType: 'Copula' },
  { particle: '였다', condition: 'requiresNoBatchim', particleType: 'Copula' }
];

const SLOT3_RULES: ParticleRule[] = [
  { particle: '이나마', condition: 'requiresBatchim', particleType: 'Delimiter' },
  { particle: '나마', condition: 'requiresNoBatchim', particleType: 'Delimiter' },
  { particle: '이라도', condition: 'requiresBatchim', particleType: 'Delimiter' },
  { particle: '라도', condition: 'requiresNoBatchim', particleType: 'Delimiter' },
  { particle: '이라서', condition: 'requiresBatchim', particleType: 'Causal Marker' },
  { particle: '라서', condition: 'requiresNoBatchim', particleType: 'Causal Marker' },
  { particle: '이란', condition: 'requiresBatchim', particleType: 'Topic Marker' },
  { particle: '란', condition: 'requiresNoBatchim', particleType: 'Topic Marker' },
  { particle: '이나', condition: 'requiresBatchim', particleType: 'Delimiter' },
  { particle: '나', condition: 'requiresNoBatchim', particleType: 'Delimiter' },
  { particle: '이며', condition: 'requiresBatchim', particleType: 'Connective Marker' },
  { particle: '며', condition: 'requiresNoBatchim', particleType: 'Connective Marker' },
  { particle: '부터', condition: 'any', particleType: 'Starting Point Marker' },
  { particle: '까지', condition: 'any', particleType: 'Ending Point Marker' },
  { particle: '은', condition: 'requiresBatchim', particleType: 'Topic Marker' },
  { particle: '는', condition: 'requiresNoBatchim', particleType: 'Topic Marker' },
  { particle: '이', condition: 'requiresBatchim', particleType: 'Subject Marker' },
  { particle: '가', condition: 'requiresNoBatchim', particleType: 'Subject Marker' },
  { particle: '을', condition: 'requiresBatchim', particleType: 'Object Marker' },
  { particle: '를', condition: 'requiresNoBatchim', particleType: 'Object Marker' },
  { particle: '도', condition: 'any', particleType: 'Additive Marker' },
  { particle: '만', condition: 'any', particleType: 'Exclusive Marker' },
  { particle: '아', condition: 'requiresBatchim', particleType: 'Vocative Marker' },
  { particle: '야', condition: 'requiresNoBatchim', particleType: 'Vocative Marker' }
];

const SLOT2_RULES: ParticleRule[] = [
  { particle: '으로서', condition: 'requiresNonRieulBatchim', particleType: 'Role Marker' },
  { particle: '으로써', condition: 'requiresNonRieulBatchim', particleType: 'Instrumental Marker' },
  { particle: '로서', condition: 'requiresNoBatchimOrRieul', particleType: 'Role Marker' },
  { particle: '로써', condition: 'requiresNoBatchimOrRieul', particleType: 'Instrumental Marker' },
  { particle: '으로', condition: 'requiresNonRieulBatchim', particleType: 'Instrumental Marker' },
  { particle: '로', condition: 'requiresNoBatchimOrRieul', particleType: 'Instrumental Marker' },
  { particle: '께서', condition: 'any', particleType: 'Honorific Subject Marker' },
  { particle: '에서', condition: 'any', particleType: 'Locative Marker' },
  { particle: '에게', condition: 'any', particleType: 'Dative Marker' },
  { particle: '한테', condition: 'any', particleType: 'Dative Marker' },
  { particle: '하고', condition: 'any', particleType: 'Connective Marker' },
  { particle: '보다', condition: 'any', particleType: 'Comparative Marker' },
  { particle: '처럼', condition: 'any', particleType: 'Comparative Marker' },
  { particle: '마다', condition: 'any', particleType: 'Every' },
  { particle: '조차', condition: 'any', particleType: 'Even' },
  { particle: '마저', condition: 'any', particleType: 'Even' },
  { particle: '께', condition: 'any', particleType: 'Honorific Dative Marker' },
  { particle: '에', condition: 'any', particleType: 'Locative/Time Marker' },
  { particle: '과', condition: 'requiresBatchim', particleType: 'Connective Marker' },
  { particle: '와', condition: 'requiresNoBatchim', particleType: 'Connective Marker' },
  { particle: '의', condition: 'any', particleType: 'Possessive Marker' }
];

const combineParticleTypes = (plural: string | null, slot2Type: string | null, slot3Type: string | null): string => {
  if (plural) {
    if (slot2Type && slot3Type) {
      return `Plural + ${slot2Type.replace(' Marker', '')} + ${slot3Type}`;
    }
    if (slot2Type) {
      return `Plural + ${slot2Type}`;
    }
    if (slot3Type) {
      return `Plural + ${slot3Type}`;
    }
    return 'Plural Marker';
  }

  if (slot2Type && slot3Type) {
    return `${slot2Type.replace(' Marker', '')} + ${slot3Type}`;
  }
  if (slot2Type) return slot2Type;
  if (slot3Type) return slot3Type;
  return '';
};

const shouldSkipParticle = (target: string, particle: string): boolean => {
  if (particle === '로' || particle.startsWith('로')) {
    if (target.endsWith('으로')) return true;
    if (target.endsWith('도로') && target.length >= 3) return true;
  }
  if (particle === '의' || particle.startsWith('의')) {
    if (target.endsWith('주의') && target.length >= 3) return true;
  }
  if (particle === '도') {
    if ((target.endsWith('제도') || target.endsWith('반도')) && target.length >= 3) return true;
  }
  if (particle === '가' && AGENT_NOUNS.has(target)) {
    return true;
  }
  if (particle === '나' && LOANWORDS_NA.has(target)) {
    return true;
  }
  return false;
};

const isStemValid = (stem: string, surface: string, particle: string): boolean => {
  if (!stem) return false;
  for (let i = 0; i < stem.length; i++) {
    const code = stem.charCodeAt(i);
    if (code < 0xac00 || code > 0xd7a3) return false;
  }

  if (stem.length === 1 && !ONE_SYLLABLE_NOUNS.has(stem)) {
    return false;
  }

  if (PROTECTED_WORDS.has(surface)) {
    return false;
  }

  if (particle.endsWith('로') && surface.endsWith('도로')) {
    return false;
  }

  if (particle.endsWith('의') && surface.endsWith('주의')) {
    return false;
  }

  if (particle.endsWith('도') && (surface.endsWith('제도') || surface.endsWith('반도'))) {
    return false;
  }

  if (particle === '가' && AGENT_NOUNS.has(surface)) {
    return false;
  }

  if (particle === '나' && LOANWORDS_NA.has(surface)) {
    return false;
  }

  return true;
};

/**
 * Decomposes an inflected Korean surface form into its base lemma, attached particle(s),
 * and particle classification badge. Returns null if no particle is attached.
 */
export const analyzeKoreanToken = (surface: string): KoreanTokenAnalysis | null => {
  if (!surface || typeof surface !== 'string') return null;
  const s = composeKoreanLookupText(surface);
  if (s.length < 2) return null;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0xac00 || code > 0xd7a3) return null;
  }

  // 1. Check copula endings
  for (const copula of COPULAS) {
    if (s.endsWith(copula.particle)) {
      const charBefore = s[s.length - copula.particle.length - 1];
      if (checkBatchim(charBefore, copula.condition)) {
        const rem = s.slice(0, -copula.particle.length);
        if (rem.endsWith('들') && rem.length >= 2) {
          const remWithoutDeul = rem.slice(0, -1);
          const fullParticle = s.slice(remWithoutDeul.length);
          if (isStemValid(remWithoutDeul, s, fullParticle)) {
            return { lemma: remWithoutDeul, particle: fullParticle, particleType: 'Plural + Copula' };
          }
        }

        const particle = s.slice(rem.length);
        if (isStemValid(rem, s, particle)) {
          return { lemma: rem, particle, particleType: copula.particleType };
        }
      }
    }
  }

  // 2. Check Slot 3 (optionally preceded by Slot 2, optionally preceded by Slot 1 -들)
  for (const slot3 of SLOT3_RULES) {
    if (s.endsWith(slot3.particle)) {
      if (shouldSkipParticle(s, slot3.particle)) continue;
      const charBefore = s[s.length - slot3.particle.length - 1];
      if (checkBatchim(charBefore, slot3.condition)) {
        const rem1 = s.slice(0, -slot3.particle.length);

        // Can Slot 2 attach before Slot 3?
        for (const slot2 of SLOT2_RULES) {
          if (rem1.endsWith(slot2.particle)) {
            if (shouldSkipParticle(rem1, slot2.particle)) continue;
            const charBefore2 = rem1[rem1.length - slot2.particle.length - 1];
            if (checkBatchim(charBefore2, slot2.condition)) {
              const rem2 = rem1.slice(0, -slot2.particle.length);
              if (rem2.endsWith('들') && rem2.length >= 2) {
                const rem3 = rem2.slice(0, -1);
                const fullParticle = s.slice(rem3.length);
                if (isStemValid(rem3, s, fullParticle)) {
                  return {
                    lemma: rem3,
                    particle: fullParticle,
                    particleType: combineParticleTypes('Plural Marker', slot2.particleType, slot3.particleType)
                  };
                }
              }

              const particle23 = s.slice(rem2.length);
              if (isStemValid(rem2, s, particle23)) {
                return {
                  lemma: rem2,
                  particle: particle23,
                  particleType: combineParticleTypes(null, slot2.particleType, slot3.particleType)
                };
              }
            }
          }
        }

        // No Slot 2; check -들 before Slot 3
        if (rem1.endsWith('들') && rem1.length >= 2) {
          const rem2 = rem1.slice(0, -1);
          const fullParticle = s.slice(rem2.length);
          if (isStemValid(rem2, s, fullParticle)) {
            return {
              lemma: rem2,
              particle: fullParticle,
              particleType: combineParticleTypes('Plural Marker', null, slot3.particleType)
            };
          }
        }

        const particle3 = s.slice(rem1.length);
        if (isStemValid(rem1, s, particle3)) {
          return { lemma: rem1, particle: particle3, particleType: slot3.particleType };
        }
      }
    }
  }

  // 3. Check Slot 2 only (optionally preceded by Slot 1 -들)
  for (const slot2 of SLOT2_RULES) {
    if (s.endsWith(slot2.particle)) {
      if (shouldSkipParticle(s, slot2.particle)) continue;
      const charBefore = s[s.length - slot2.particle.length - 1];
      if (checkBatchim(charBefore, slot2.condition)) {
        const rem1 = s.slice(0, -slot2.particle.length);
        if (rem1.endsWith('들') && rem1.length >= 2) {
          const rem2 = rem1.slice(0, -1);
          const fullParticle = s.slice(rem2.length);
          if (isStemValid(rem2, s, fullParticle)) {
            return {
              lemma: rem2,
              particle: fullParticle,
              particleType: combineParticleTypes('Plural Marker', slot2.particleType, null)
            };
          }
        }

        const particle2 = s.slice(rem1.length);
        if (isStemValid(rem1, s, particle2)) {
          return { lemma: rem1, particle: particle2, particleType: slot2.particleType };
        }
      }
    }
  }

  // 4. Check Slot 1 -들 only
  if (s.endsWith('들') && s.length >= 2) {
    const rem = s.slice(0, -1);
    if (isStemValid(rem, s, '들')) {
      return { lemma: rem, particle: '들', particleType: 'Plural Marker' };
    }
  }

  return null;
};

export interface KoreanLookupProjection {
  text: string;
  sourceStarts: number[];
  sourceEnds: number[];
}

/** Map each composed UTF-16 unit back to its complete original source span. */
export const projectKoreanLookupText = (source: string): KoreanLookupProjection => {
  let text = '';
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  for (let start = 0; start < source.length;) {
    let code = source.charCodeAt(start);
    let end = start + 1;
    const vowel = source.charCodeAt(end);
    if (code >= 0x1100 && code <= 0x1112 && vowel >= 0x1161 && vowel <= 0x1175) {
      code = 0xac00 + ((code - 0x1100) * 21 + vowel - 0x1161) * 28;
      end++;
    }
    const final = source.charCodeAt(end);
    if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 0
      && final >= 0x11a8 && final <= 0x11c2) {
      code += final - 0x11a7;
      end++;
    }
    text += String.fromCharCode(code);
    sourceStarts.push(start);
    sourceEnds.push(end);
    start = end;
  }
  return { text, sourceStarts, sourceEnds };
};

export const composeKoreanLookupText = (source: string): string => projectKoreanLookupText(source).text;

export interface KoreanLookupIndex<T> {
  exact: ReadonlyMap<string, T | null>;
  canonical: ReadonlyMap<string, T | null>;
}

/**
 * Keep every row. An alias with multiple candidates deliberately has no winner,
 * even if one row has a newer status, translation, or a lower database ID.
 */
export const createKoreanLookup = <T>(rows: Iterable<T>, exactKey: (row: T) => string): KoreanLookupIndex<T> => {
  const exact = new Map<string, T | null>();
  const canonical = new Map<string, T | null>();
  for (const row of rows) {
    const key = exactKey(row);
    exact.set(key, exact.has(key) ? null : row);
    const alias = composeKoreanLookupText(key);
    canonical.set(alias, canonical.has(alias) ? null : row);
  }
  return { exact, canonical };
};

/** Exact legacy spelling wins; use a canonical alias only when it is unique. */
export const resolveKoreanLookup = <T>(index: KoreanLookupIndex<T>, exactKey: string): T | null =>
  index.exact.has(exactKey)
    ? index.exact.get(exactKey) ?? null
    : index.canonical.get(composeKoreanLookupText(exactKey)) ?? null;

export interface KoreanSourceSpan { start: number; end: number }

/** Canonical matches with offsets in the unmodified source, including phrases. */
export const findKoreanLookupMatches = (source: string, term: string): KoreanSourceSpan[] => {
  const projection = projectKoreanLookupText(source);
  const needle = composeKoreanLookupText(term);
  if (!needle) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(projection.text.matchAll(new RegExp(escaped, 'giu')), match => {
    const start = match.index;
    return {
      start: projection.sourceStarts[start],
      end: projection.sourceEnds[start + match[0].length - 1]
    };
  });
};
