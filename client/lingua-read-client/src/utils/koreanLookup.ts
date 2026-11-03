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

export type KoreanVerbAnalysis = KoreanTokenAnalysis;

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
  if (particle === '만' && target.endsWith('지만')) {
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
    if (s.endsWith(copula.particle) && s.length > copula.particle.length) {
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
    if (s.endsWith(slot3.particle) && s.length > slot3.particle.length) {
      if (shouldSkipParticle(s, slot3.particle)) continue;
      const charBefore = s[s.length - slot3.particle.length - 1];
      if (checkBatchim(charBefore, slot3.condition)) {
        const rem1 = s.slice(0, -slot3.particle.length);

        // Can Slot 2 attach before Slot 3?
        for (const slot2 of SLOT2_RULES) {
          if (rem1.endsWith(slot2.particle) && rem1.length > slot2.particle.length) {
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
    if (s.endsWith(slot2.particle) && s.length > slot2.particle.length) {
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

  return deconjugateKoreanVerb(s);
};

export const decomposeHangulSyllable = (c: string): { cho: number; jung: number; jong: number } => {
  const code = c.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return { cho: -1, jung: -1, jong: -1 };
  const s = code - 0xac00;
  const jong = s % 28;
  const jung = Math.floor(s / 28) % 21;
  const cho = Math.floor(s / (28 * 21));
  return { cho, jung, jong };
};

export const composeHangulSyllable = (cho: number, jung: number, jong: number): string =>
  String.fromCharCode(0xac00 + (cho * 21 + jung) * 28 + jong);

export const PURE_ONE_SYLLABLE_NOUNS: ReadonlySet<string> = new Set([
  '책', '꽃', '돈', '술', '옷', '방', '문', '산', '강', '별', '숲', '새', '소', '개', '떡', '빵', '집', '밥', '물', '눈', '손', '발'
]);

export const H_IRREGULAR_PRESENT_MAP: Record<string, string> = {
  하얘: '하얗',
  하예: '하얗',
  하애: '하얗',
  그래: '그렇',
  이래: '이렇',
  저래: '저렇',
  어때: '어떻',
  노래: '노랗',
  파래: '파랗',
  빨개: '빨갛',
  까매: '까맣'
};

export const H_IRREGULAR_MODIFIER_MAP: Record<string, string> = {
  하얀: '하얗',
  그런: '그렇',
  이런: '이렇',
  저런: '저렇',
  어떤: '어떻',
  노란: '노랗',
  파란: '파랗',
  빨간: '빨갛',
  까만: '까맣'
};

export const D_IRREGULAR_L_STEMS: ReadonlySet<string> = new Set([
  '들', '걸', '깨달', '물', '실'
]);

export const S_IRREGULAR_STEMS: ReadonlySet<string> = new Set([
  '나', '지', '부', '이'
]);

export const WUDA_STEMS: ReadonlySet<string> = new Set([
  '배', '키', '지', '세', '채', '태', '피', '치', '비', '깨', '가두', '겨누', '나누', '거두'
]);

const resolveEoASyllable = (stemPrefix: string, last: string): string | null => {
  const { cho, jung, jong } = decomposeHangulSyllable(last);
  if (cho < 0 || jong !== 0) return null;

  // 1. 하다 verbs
  if (last === '해') {
    return stemPrefix + '하';
  }

  // 2. 르 irregular (stemPrefix ends with ㄹ batchim, last is 라 or 러)
  if (stemPrefix.length >= 1 && (last === '라' || last === '러')) {
    const prevChar = stemPrefix[stemPrefix.length - 1];
    const { cho: pCho, jung: pJung, jong: pJong } = decomposeHangulSyllable(prevChar);
    if (pJong === 8) {
      const pWithoutRieul = composeHangulSyllable(pCho, pJung, 0);
      return stemPrefix.slice(0, -1) + pWithoutRieul + '르';
    }
  }

  // 3. ㅂ irregular with 와 (돕다, 곱다)
  if (last === '와') {
    if (stemPrefix.endsWith('도'))
      return stemPrefix.slice(0, -1) + '돕';
    if (stemPrefix.endsWith('고'))
      return stemPrefix.slice(0, -1) + '곱';
  }

  // 4. ㅂ irregular with 워
  if (last === '워') {
    if (stemPrefix.length >= 1) {
      for (const wuda of WUDA_STEMS) {
        if (stemPrefix.endsWith(wuda))
          return stemPrefix + '우';
      }
      const prevChar = stemPrefix[stemPrefix.length - 1];
      const { cho: pCho, jung: pJung, jong: pJong } = decomposeHangulSyllable(prevChar);
      if (pJong === 0) {
        const pWithB = composeHangulSyllable(pCho, pJung, 17);
        return stemPrefix.slice(0, -1) + pWithB;
      }
    }
  }

  // 5. ㅎ irregular present
  const fullSurface = stemPrefix + last;
  if (H_IRREGULAR_PRESENT_MAP[fullSurface]) {
    return H_IRREGULAR_PRESENT_MAP[fullSurface];
  }

  // 6. ㅘ (jung 9) -> ㅗ (jung 8): 보다, 오다
  if (jung === 9) {
    return stemPrefix + composeHangulSyllable(cho, 8, 0);
  }

  // 7. ㅝ (jung 14) with cho !== 11 (ㅇ): 주다, 꾸다, 추다
  if (jung === 14 && cho !== 11) {
    return stemPrefix + composeHangulSyllable(cho, 13, 0);
  }

  // 8. ㅕ (jung 6) -> ㅣ (jung 20): 마시다, 가르치다, 기다리다
  if (jung === 6) {
    return stemPrefix + composeHangulSyllable(cho, 20, 0);
  }

  // 9. ㅡ elision
  if (!stemPrefix) {
    if (last === '써') return '쓰';
    if (last === '커') return '크';
    if (last === '떠') return '뜨';
    if (last === '꺼') return '끄';
  } else {
    if (cho === 8) { // ㅃ: 예뻐 -> 예쁘, 바빠 -> 바쁘, 기뻐 -> 기쁘, 나빠 -> 나쁘
      return stemPrefix + composeHangulSyllable(cho, 18, 0);
    }
    if (cho === 17) { // ㅍ: 아파 -> 아프, 슬퍼 -> 슬프
      return stemPrefix + composeHangulSyllable(cho, 18, 0);
    }
    if (last === '가' && (stemPrefix.endsWith('담') || stemPrefix.endsWith('잠'))) {
      return stemPrefix + '그';
    }
  }

  // 10. Regular vowel ㅏ stem: 가, 자, 사, 타, 만나, 떠나
  if (jung === 0) {
    return stemPrefix + last;
  }

  // 11. Regular vowel ㅓ stem: 서, 펴
  if (jung === 4) {
    return stemPrefix + last;
  }

  // 12. Regular vowel ㅐ stem: 보내, 지내, 내
  if (jung === 1) {
    return stemPrefix + last;
  }

  // 13. ㅙ (jungseong 10) -> ㅚ (jungseong 11): 되다 (돼 -> 되)
  if (jung === 10) {
    return stemPrefix + composeHangulSyllable(cho, 11, 0);
  }

  return null;
};

/**
 * Deconjugates an inflected Korean verb or adjective form into its base dictionary lemma (ending in '다'),
 * the attached verbal ending (eomi), and the grammatical classification badge.
 * Returns null if not a recognized inflected verbal form.
 */
export const deconjugateKoreanVerb = (surface: string): KoreanTokenAnalysis | null => {
  if (!surface || typeof surface !== 'string') return null;
  const s = composeKoreanLookupText(surface);
  if (s.length === 0) return null;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0xac00 || code > 0xd7a3) return null;
  }
  if (PROTECTED_WORDS.has(s)) return null;

  // 1-syllable verbs
  if (s.length === 1) {
    const { jong: cJong } = decomposeHangulSyllable(s[0]);
    if (cJong === 4) { // ㄴ batchim
      if (s === '간') return { lemma: '가다', particle: 'ㄴ', particleType: 'Modifier Form' };
      if (s === '본') return { lemma: '보다', particle: 'ㄴ', particleType: 'Modifier Form' };
      if (s === '한') return { lemma: '하다', particle: 'ㄴ', particleType: 'Modifier Form' };
    }
    if (cJong === 8) { // ㄹ batchim
      if (s === '갈') return { lemma: '가다', particle: 'ㄹ', particleType: 'Modifier Form' };
      if (s === '볼') return { lemma: '보다', particle: 'ㄹ', particleType: 'Modifier Form' };
      if (s === '할') return { lemma: '하다', particle: 'ㄹ', particleType: 'Modifier Form' };
    }
    return null;
  }

  // 1. Honorific verb endings
  if (s.endsWith('으셨습니다') && s.length >= 6 && hasBatchim(s[s.length - 6]))
    return { lemma: s.slice(0, -5) + '다', particle: '으셨습니다', particleType: 'Honorific Past Polite' };
  if (s.endsWith('셨습니다') && s.length >= 5 && !hasBatchim(s[s.length - 5]))
    return { lemma: s.slice(0, -4) + '다', particle: '셨습니다', particleType: 'Honorific Past Polite' };
  if (s.endsWith('으시었습니다') && s.length >= 7 && hasBatchim(s[s.length - 7]))
    return { lemma: s.slice(0, -6) + '다', particle: '으시었습니다', particleType: 'Honorific Past Polite' };
  if (s.endsWith('시었습니다') && s.length >= 6 && !hasBatchim(s[s.length - 6]))
    return { lemma: s.slice(0, -5) + '다', particle: '시었습니다', particleType: 'Honorific Past Polite' };
  if (s.endsWith('으셨어요') && s.length >= 5 && hasBatchim(s[s.length - 5]))
    return { lemma: s.slice(0, -4) + '다', particle: '으셨어요', particleType: 'Honorific Past Polite' };
  if (s.endsWith('셨어요') && s.length >= 4 && !hasBatchim(s[s.length - 4]))
    return { lemma: s.slice(0, -3) + '다', particle: '셨어요', particleType: 'Honorific Past Polite' };
  if (s.endsWith('으시었어요') && s.length >= 6 && hasBatchim(s[s.length - 6]))
    return { lemma: s.slice(0, -5) + '다', particle: '으시었어요', particleType: 'Honorific Past Polite' };
  if (s.endsWith('시었어요') && s.length >= 5 && !hasBatchim(s[s.length - 5]))
    return { lemma: s.slice(0, -4) + '다', particle: '시었어요', particleType: 'Honorific Past Polite' };
  if (s.endsWith('으시지요') && s.length >= 5 && hasBatchim(s[s.length - 5]))
    return { lemma: s.slice(0, -4) + '다', particle: '으시지요', particleType: 'Honorific Polite' };
  if (s.endsWith('시지요') && s.length >= 4 && !hasBatchim(s[s.length - 4]))
    return { lemma: s.slice(0, -3) + '다', particle: '시지요', particleType: 'Honorific Polite' };
  if (s.endsWith('으시죠') && s.length >= 4 && hasBatchim(s[s.length - 4]))
    return { lemma: s.slice(0, -3) + '다', particle: '으시죠', particleType: 'Honorific Polite' };
  if (s.endsWith('시죠') && s.length >= 3 && !hasBatchim(s[s.length - 3]))
    return { lemma: s.slice(0, -2) + '다', particle: '시죠', particleType: 'Honorific Polite' };
  if (s.endsWith('으세요') && s.length >= 4 && hasBatchim(s[s.length - 4]))
    return { lemma: s.slice(0, -3) + '다', particle: '으세요', particleType: 'Honorific Polite' };
  if (s.endsWith('세요') && s.length >= 3 && !hasBatchim(s[s.length - 3]))
    return { lemma: s.slice(0, -2) + '다', particle: '세요', particleType: 'Honorific Polite' };
  if (s.endsWith('셔요') && s.length >= 3 && !s.startsWith('마셔') && !s.startsWith('모셔') && !hasBatchim(s[s.length - 3]))
    return { lemma: s.slice(0, -2) + '다', particle: '셔요', particleType: 'Honorific Polite' };
  if (s.endsWith('시어') && s.length >= 3 && !hasBatchim(s[s.length - 3]))
    return { lemma: s.slice(0, -2) + '다', particle: '시어', particleType: 'Honorific' };

  // 2. Formal polite endings
  if (s.endsWith('습니다') && s.length >= 4) {
    const charBefore = s[s.length - 4];
    const { cho: cbCho, jung: cbJung, jong: cbJong } = decomposeHangulSyllable(charBefore);
    if (s === '있습니다')
      return { lemma: '있다', particle: '습니다', particleType: 'Formal Polite' };
    if (s === '없습니다')
      return { lemma: '없다', particle: '습니다', particleType: 'Formal Polite' };

    // Past tense before 습니다 (batchim ㅆ)
    if (cbJong === 20) {
      if (charBefore === '었' || charBefore === '았') {
        let stemBefore = s.slice(0, -4);
        if (stemBefore.length >= 1 && D_IRREGULAR_L_STEMS.has(stemBefore)) {
          const { cho: lCho, jung: lJung } = decomposeHangulSyllable(stemBefore[stemBefore.length - 1]);
          stemBefore = stemBefore.slice(0, -1) + composeHangulSyllable(lCho, lJung, 7); // ㄷ
        } else if (stemBefore.length >= 1 && S_IRREGULAR_STEMS.has(stemBefore)) {
          const { cho: lCho, jung: lJung } = decomposeHangulSyllable(stemBefore[stemBefore.length - 1]);
          stemBefore = stemBefore.slice(0, -1) + composeHangulSyllable(lCho, lJung, 19); // ㅅ
        }
        const p = charBefore === '았' ? '았습니다' : '었습니다';
        return { lemma: stemBefore + '다', particle: p, particleType: 'Past Formal Polite' };
      }

      // Contracted with ㅆ (갔습니다, 봤습니다...)
      const last = composeHangulSyllable(cbCho, cbJung, 0);
      const stemPrefix = s.slice(0, -4);
      const resolved = resolveEoASyllable(stemPrefix, last);
      if (resolved) {
        const p = last === '해' ? '했습니다' : (cbJung === 0 || cbJung === 9 ? '았습니다' : '었습니다');
        return { lemma: resolved + '다', particle: p, particleType: 'Past Formal Polite' };
      }
    }

    if (cbJong > 0) {
      const rem = s.slice(0, -3);
      return { lemma: rem + '다', particle: '습니다', particleType: 'Formal Polite' };
    }
  }

  if (s.endsWith('습니까') && s.length >= 4) {
    const charBefore = s[s.length - 4];
    if (hasBatchim(charBefore)) {
      return { lemma: s.slice(0, -3) + '다', particle: '습니까', particleType: 'Formal Polite Question' };
    }
  }

  if (s.endsWith('니다') && s.length >= 3) {
    const charBefore = s[s.length - 3];
    const { cho: cbCho, jung: cbJung, jong: cbJong } = decomposeHangulSyllable(charBefore);
    if (cbJong === 17) { // ㅂ batchim
      const charWithoutB = composeHangulSyllable(cbCho, cbJung, 0);
      const rem = s.slice(0, -3) + charWithoutB;
      return { lemma: rem + '다', particle: 'ㅂ니다', particleType: 'Formal Polite' };
    }
  }

  if (s.endsWith('니까') && s.length >= 3) {
    const charBefore = s[s.length - 3];
    const { cho: cbCho, jung: cbJung, jong: cbJong } = decomposeHangulSyllable(charBefore);
    if (cbJong === 17) { // ㅂ batchim: -ㅂ니까
      const charWithoutB = composeHangulSyllable(cbCho, cbJung, 0);
      const rem = s.slice(0, -3) + charWithoutB;
      return { lemma: rem + '다', particle: 'ㅂ니까', particleType: 'Formal Polite Question' };
    }
  }

  // 3. Past tense informal polite (-았어요, -었어요)
  if ((s.endsWith('어요') || s.endsWith('아요')) && s.length >= 2) {
    const endingLen = 2;
    const charBefore = s[s.length - endingLen - 1];
    const { cho: cbCho, jung: cbJung, jong: cbJong } = decomposeHangulSyllable(charBefore);
    if (cbJong === 20) { // ㅆ batchim
      if (charBefore === '었' || charBefore === '았') {
        let stemBefore = s.slice(0, -(endingLen + 1));
        if (stemBefore.length >= 1 && D_IRREGULAR_L_STEMS.has(stemBefore)) {
          const { cho: lCho, jung: lJung } = decomposeHangulSyllable(stemBefore[stemBefore.length - 1]);
          stemBefore = stemBefore.slice(0, -1) + composeHangulSyllable(lCho, lJung, 7); // ㄷ
        } else if (stemBefore.length >= 1 && S_IRREGULAR_STEMS.has(stemBefore)) {
          const { cho: lCho, jung: lJung } = decomposeHangulSyllable(stemBefore[stemBefore.length - 1]);
          stemBefore = stemBefore.slice(0, -1) + composeHangulSyllable(lCho, lJung, 19); // ㅅ
        }
        const p = charBefore === '았' ? '았어요' : '었어요';
        return { lemma: stemBefore + '다', particle: p, particleType: 'Past Polite' };
      }

      const last = composeHangulSyllable(cbCho, cbJung, 0);
      const stemPrefix = s.slice(0, -(endingLen + 1));
      const resolved = resolveEoASyllable(stemPrefix, last);
      if (resolved) {
        const p = last === '해' ? '했어요' : (cbJung === 0 || cbJung === 9 ? '았어요' : '었어요');
        return { lemma: resolved + '다', particle: p, particleType: 'Past Polite' };
      }
    }
  }

  // 4. Present tense informal polite (-아요, -었어요, -여요, -해요)
  if (s.endsWith('요') && s.length >= 2) {
    const rem = s.slice(0, -1);
    const last = rem[rem.length - 1];
    const stemPrefix = rem.slice(0, -1);
    const { cho: lCho, jung: lJung, jong: lJong } = decomposeHangulSyllable(last);

    if (last === '해') {
      const resolved = resolveEoASyllable(stemPrefix, last);
      return { lemma: resolved + '다', particle: '해요', particleType: 'Present Polite' };
    }

    if (last === '어' || last === '아' || last === '여') {
      if (stemPrefix.length >= 1) {
        if (D_IRREGULAR_L_STEMS.has(stemPrefix)) {
          const { cho: pCho, jung: pJung } = decomposeHangulSyllable(stemPrefix[stemPrefix.length - 1]);
          const stemD = stemPrefix.slice(0, -1) + composeHangulSyllable(pCho, pJung, 7);
          return { lemma: stemD + '다', particle: last + '요', particleType: 'Present Polite' };
        }
        if (S_IRREGULAR_STEMS.has(stemPrefix)) {
          const { cho: pCho, jung: pJung } = decomposeHangulSyllable(stemPrefix[stemPrefix.length - 1]);
          const stemS = stemPrefix.slice(0, -1) + composeHangulSyllable(pCho, pJung, 19);
          return { lemma: stemS + '다', particle: last + '요', particleType: 'Present Polite' };
        }
        const { jong: pJong2 } = decomposeHangulSyllable(stemPrefix[stemPrefix.length - 1]);
        if (pJong2 > 0) {
          return { lemma: stemPrefix + '다', particle: last + '요', particleType: 'Present Polite' };
        }
      }
    }

    if (lJong === 0) {
      const resolved = resolveEoASyllable(stemPrefix, last);
      if (resolved) {
        const p = (lJung === 0 || lJung === 9) ? '아요' : '어요';
        return { lemma: resolved + '다', particle: p, particleType: 'Present Polite' };
      }
    }
  }

  // 5. Converb / Causal / Sequential (-아서, -어서, -여서, -해서)
  if (s.endsWith('서') && s.length >= 2) {
    const rem = s.slice(0, -1);
    const last = rem[rem.length - 1];
    const stemPrefix = rem.slice(0, -1);
    const { cho: lCho, jung: lJung, jong: lJong } = decomposeHangulSyllable(last);

    if (last === '해') {
      const resolved = resolveEoASyllable(stemPrefix, last);
      return { lemma: resolved + '다', particle: '해서', particleType: 'Causal/Sequential' };
    }

    if (last === '어' || last === '아' || last === '여') {
      if (stemPrefix.length >= 1) {
        if (D_IRREGULAR_L_STEMS.has(stemPrefix)) {
          const { cho: pCho, jung: pJung } = decomposeHangulSyllable(stemPrefix[stemPrefix.length - 1]);
          const stemD = stemPrefix.slice(0, -1) + composeHangulSyllable(pCho, pJung, 7);
          return { lemma: stemD + '다', particle: last + '서', particleType: 'Causal/Sequential' };
        }
        if (S_IRREGULAR_STEMS.has(stemPrefix)) {
          const { cho: pCho, jung: pJung } = decomposeHangulSyllable(stemPrefix[stemPrefix.length - 1]);
          const stemS = stemPrefix.slice(0, -1) + composeHangulSyllable(pCho, pJung, 19);
          return { lemma: stemS + '다', particle: last + '서', particleType: 'Causal/Sequential' };
        }
        const { jong: pJong2 } = decomposeHangulSyllable(stemPrefix[stemPrefix.length - 1]);
        if (pJong2 > 0) {
          return { lemma: stemPrefix + '다', particle: last + '서', particleType: 'Causal/Sequential' };
        }
      }
    }

    if (lJong === 0) {
      const resolved = resolveEoASyllable(stemPrefix, last);
      if (resolved) {
        const p = (lJung === 0 || lJung === 9) ? '아서' : '어서';
        return { lemma: resolved + '다', particle: p, particleType: 'Causal/Sequential' };
      }
    }
  }

  // 6. Connective & Conditional Endings
  if (s.endsWith('지만') && s.length >= 3) {
    const rem = s.slice(0, -2);
    return { lemma: rem + '다', particle: '지만', particleType: 'Contrastive' };
  }

  if (s.endsWith('는데') && s.length >= 3) {
    const rem = s.slice(0, -2);
    return { lemma: rem + '다', particle: '는데', particleType: 'Connective/Background' };
  }

  if (s.endsWith('은데') && s.length >= 3 && (hasBatchim(s[s.length - 3]) || S_IRREGULAR_STEMS.has(s.slice(0, -2)))) {
    let rem = s.slice(0, -2);
    if (D_IRREGULAR_L_STEMS.has(rem)) {
      const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
      rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 7);
    } else if (S_IRREGULAR_STEMS.has(rem)) {
      const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
      rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 19);
    }
    return { lemma: rem + '다', particle: '은데', particleType: 'Connective/Background' };
  }

  if (s.endsWith('데') && s.length >= 2) {
    const charBefore = s[s.length - 2];
    const { cho: cbCho, jung: cbJung, jong: cbJong } = decomposeHangulSyllable(charBefore);
    if (cbJong === 4) { // ㄴ batchim
      if (s.endsWith('그런데')) return { lemma: '그렇다', particle: 'ㄴ데', particleType: 'Connective/Background' };
      if (s.endsWith('이런데')) return { lemma: '이렇다', particle: 'ㄴ데', particleType: 'Connective/Background' };
      if (s.endsWith('저런데')) return { lemma: '저렇다', particle: 'ㄴ데', particleType: 'Connective/Background' };
      if (s.endsWith('어려운데')) return { lemma: '어렵다', particle: 'ㄴ데', particleType: 'Connective/Background' };
      if (s.endsWith('추운데')) return { lemma: '춥다', particle: 'ㄴ데', particleType: 'Connective/Background' };
      if (s.endsWith('더운데')) return { lemma: '덥다', particle: 'ㄴ데', particleType: 'Connective/Background' };
      if (s.endsWith('쉬운데')) return { lemma: '쉽다', particle: 'ㄴ데', particleType: 'Connective/Background' };
      const charWithoutN = composeHangulSyllable(cbCho, cbJung, 0);
      const rem = s.slice(0, -2) + charWithoutN;
      return { lemma: rem + '다', particle: 'ㄴ데', particleType: 'Connective/Background' };
    }
  }

  if (s.endsWith('으면') && s.length >= 3 && (hasBatchim(s[s.length - 3]) || S_IRREGULAR_STEMS.has(s.slice(0, -2)))) {
    let rem = s.slice(0, -2);
    if (D_IRREGULAR_L_STEMS.has(rem)) {
      const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
      rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 7);
    } else if (S_IRREGULAR_STEMS.has(rem)) {
      const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
      rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 19);
    }
    return { lemma: rem + '다', particle: '으면', particleType: 'Conditional' };
  }

  if (s.endsWith('면') && s.length >= 2) {
    const charBefore = s[s.length - 2];
    const jong = getBatchim(charBefore);
    if (jong === 0 || jong === 8) {
      const rem = s.slice(0, -1);
      if (!PURE_ONE_SYLLABLE_NOUNS.has(rem)) {
        return { lemma: rem + '다', particle: '면', particleType: 'Conditional' };
      }
    }
  }

  if (s.endsWith('으니까') && s.length >= 4 && (hasBatchim(s[s.length - 4]) || S_IRREGULAR_STEMS.has(s.slice(0, -3)))) {
    let rem = s.slice(0, -3);
    if (D_IRREGULAR_L_STEMS.has(rem)) {
      const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
      rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 7);
    } else if (S_IRREGULAR_STEMS.has(rem)) {
      const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
      rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 19);
    }
    return { lemma: rem + '다', particle: '으니까', particleType: 'Causal' };
  }

  if (s.endsWith('니까') && s.length >= 3 && !hasBatchim(s[s.length - 3])) {
    const rem = s.slice(0, -2);
    return { lemma: rem + '다', particle: '니까', particleType: 'Causal' };
  }

  if (s.endsWith('으려고') && s.length >= 4 && (hasBatchim(s[s.length - 4]) || S_IRREGULAR_STEMS.has(s.slice(0, -3)))) {
    let rem = s.slice(0, -3);
    if (D_IRREGULAR_L_STEMS.has(rem)) {
      const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
      rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 7);
    } else if (S_IRREGULAR_STEMS.has(rem)) {
      const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
      rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 19);
    }
    return { lemma: rem + '다', particle: '으려고', particleType: 'Intentional' };
  }

  if (s.endsWith('려고') && s.length >= 3) {
    const charBefore = s[s.length - 3];
    const jong = getBatchim(charBefore);
    if (jong === 0 || jong === 8) {
      const rem = s.slice(0, -2);
      return { lemma: rem + '다', particle: '려고', particleType: 'Intentional' };
    }
  }

  if (s.endsWith('고') && s.length >= 2) {
    const rem = s.slice(0, -1);
    if (!PURE_ONE_SYLLABLE_NOUNS.has(rem)) {
      return { lemma: rem + '다', particle: '고', particleType: 'Connective' };
    }
  }

  // 7. Adnominal / Modifier forms
  if (s.endsWith('던') && s.length >= 2) {
    const rem = s.slice(0, -1);
    if (!PURE_ONE_SYLLABLE_NOUNS.has(rem)) {
      const { cho: cbCho, jung: cbJung, jong: cbJong } = decomposeHangulSyllable(rem[rem.length - 1]);
      if (cbJong === 20) { // ㅆ past batchim: 했던, 갔던, 봤던, 왔던, 먹었던
        if (rem[rem.length - 1] === '었' || rem[rem.length - 1] === '았') {
          let stemBefore = rem.slice(0, -1);
          if (stemBefore.length >= 1 && D_IRREGULAR_L_STEMS.has(stemBefore)) {
            const { cho: lCho, jung: lJung } = decomposeHangulSyllable(stemBefore[stemBefore.length - 1]);
            stemBefore = stemBefore.slice(0, -1) + composeHangulSyllable(lCho, lJung, 7);
          } else if (stemBefore.length >= 1 && S_IRREGULAR_STEMS.has(stemBefore)) {
            const { cho: lCho, jung: lJung } = decomposeHangulSyllable(stemBefore[stemBefore.length - 1]);
            stemBefore = stemBefore.slice(0, -1) + composeHangulSyllable(lCho, lJung, 19);
          }
          return { lemma: stemBefore + '다', particle: '던', particleType: 'Modifier Form' };
        }

        const last = composeHangulSyllable(cbCho, cbJung, 0);
        const stemPrefix = rem.slice(0, -1);
        const resolved = resolveEoASyllable(stemPrefix, last);
        if (resolved) {
          return { lemma: resolved + '다', particle: '던', particleType: 'Modifier Form' };
        }
      }
      return { lemma: rem + '다', particle: '던', particleType: 'Modifier Form' };
    }
  }

  if (s.endsWith('는') && s.length >= 2) {
    const rem = s.slice(0, -1);
    if (!PURE_ONE_SYLLABLE_NOUNS.has(rem)) {
      return { lemma: rem + '다', particle: '는', particleType: 'Modifier Form' };
    }
  }

  if (s.endsWith('은') && s.length >= 2 && (hasBatchim(s[s.length - 2]) || S_IRREGULAR_STEMS.has(s.slice(0, -1)))) {
    let rem = s.slice(0, -1);
    if (!PURE_ONE_SYLLABLE_NOUNS.has(rem)) {
      if (D_IRREGULAR_L_STEMS.has(rem)) {
        const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
        rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 7);
      } else if (S_IRREGULAR_STEMS.has(rem)) {
        const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
        rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 19);
      }
      return { lemma: rem + '다', particle: '은', particleType: 'Modifier Form' };
    }
  }

  if (s.endsWith('을') && s.length >= 2 && hasBatchim(s[s.length - 2])) {
    let rem = s.slice(0, -1);
    if (!PURE_ONE_SYLLABLE_NOUNS.has(rem)) {
      if (D_IRREGULAR_L_STEMS.has(rem)) {
        const { cho: pCho, jung: pJung } = decomposeHangulSyllable(rem[rem.length - 1]);
        rem = rem.slice(0, -1) + composeHangulSyllable(pCho, pJung, 7);
      }
      return { lemma: rem + '다', particle: '을', particleType: 'Modifier Form' };
    }
  }

  // Fused ㄴ / ㄹ modifier endings
  const lastChar = s[s.length - 1];
  const { cho: mCho, jung: mJung, jong: mJong } = decomposeHangulSyllable(lastChar);
  if (mJong === 4) { // ㄴ batchim
    if (H_IRREGULAR_MODIFIER_MAP[s])
      return { lemma: H_IRREGULAR_MODIFIER_MAP[s] + '다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (lastChar === '운' && s.length >= 2) {
      if (s === '도운') return { lemma: '돕다', particle: 'ㄴ', particleType: 'Modifier Form' };
      const stemBefore = s.slice(0, -1);
      let hasWuda = false;
      for (const wuda of WUDA_STEMS) {
        if (stemBefore.endsWith(wuda)) {
          hasWuda = true;
          break;
        }
      }
      if (hasWuda) {
        return { lemma: stemBefore + '우다', particle: 'ㄴ', particleType: 'Modifier Form' };
      }
      const prevChar = s[s.length - 2];
      const { cho: pCho, jung: pJung, jong: pJong } = decomposeHangulSyllable(prevChar);
      if (pJong === 0) {
        const pWithB = composeHangulSyllable(pCho, pJung, 17);
        return { lemma: s.slice(0, -2) + pWithB + '다', particle: 'ㄴ', particleType: 'Modifier Form' };
      }
    }

    if (lastChar === '한' && s.length >= 2)
      return { lemma: s.slice(0, -1) + '하다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (lastChar === '싼' && s.length >= 2)
      return { lemma: s.slice(0, -1) + '싸다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (mCho === 8 && s.length >= 2) // 쁜: 예쁜, 바쁜, 나쁜, 기쁜
      return { lemma: s.slice(0, -1) + '쁘다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (mCho === 17 && s.length >= 2) // 픈: 슬픈, 아픈
      return { lemma: s.slice(0, -1) + '프다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (lastChar === '른' && s.length >= 2) // 빠른, 이른
      return { lemma: s.slice(0, -1) + '르다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (lastChar === '린' && s.length >= 2) // 느린
      return { lemma: s.slice(0, -1) + '리다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (lastChar === '난' && s.length >= 2) // 떠난, 만난
      return { lemma: s.slice(0, -1) + '나다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (lastChar === '간' && s.length >= 3) // 돌아간, 나아간
      return { lemma: s.slice(0, -1) + '가다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (lastChar === '본' && s.length >= 3) // 돌아본, 살펴본
      return { lemma: s.slice(0, -1) + '보다', particle: 'ㄴ', particleType: 'Modifier Form' };

    if (lastChar === '준' && s.length >= 3) // 도와준
      return { lemma: s.slice(0, -1) + '주다', particle: 'ㄴ', particleType: 'Modifier Form' };
  }

  if (mJong === 8) { // ㄹ batchim
    const prevChar = s[s.length - 2];
    const { jong: pJong } = decomposeHangulSyllable(prevChar);
    if (pJong === 0 && !PURE_ONE_SYLLABLE_NOUNS.has(s.slice(0, -1))) {
      if (lastChar === '쌀' && s.length >= 2)
        return { lemma: s.slice(0, -1) + '싸다', particle: 'ㄹ', particleType: 'Modifier Form' };

      if (mCho === 8 && s.length >= 2) // 쁠: 예쁠
        return { lemma: s.slice(0, -1) + '쁘다', particle: 'ㄹ', particleType: 'Modifier Form' };

      if (lastChar === '를' && s.length >= 2) // 빠를
        return { lemma: s.slice(0, -1) + '르다', particle: 'ㄹ', particleType: 'Modifier Form' };

      if (lastChar === '할' && s.length >= 2) // 공부할
        return { lemma: s.slice(0, -1) + '하다', particle: 'ㄹ', particleType: 'Modifier Form' };

      if (lastChar === '갈' && s.length >= 3) // 돌아갈
        return { lemma: s.slice(0, -1) + '가다', particle: 'ㄹ', particleType: 'Modifier Form' };

      if (lastChar === '볼' && s.length >= 3) // 돌아볼
        return { lemma: s.slice(0, -1) + '보다', particle: 'ㄹ', particleType: 'Modifier Form' };
    }

    if (lastChar === '날' && s.length >= 2 && !PURE_ONE_SYLLABLE_NOUNS.has(s.slice(0, -1))) // 만날, 떠날
      return { lemma: s.slice(0, -1) + '나다', particle: 'ㄹ', particleType: 'Modifier Form' };
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
