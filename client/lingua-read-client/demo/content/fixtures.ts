import script from './audio-script.json';
import timing from './audio-timing.json';

export const spanishSentences = [
  'Cada mañana, Clara camina junto al río antes de ir al trabajo.',
  'El aire está fresco y las calles todavía están tranquilas.',
  'Cerca del puente, un pequeño café abre sus puertas.',
  'Clara pide un café y se sienta junto a la ventana.',
  'Mientras espera, lee unas páginas de su libro favorito.',
  'Hoy encuentra una palabra nueva y escribe su significado en una libreta.',
  'Después sonríe: aprender un idioma también puede ser un momento de calma.',
];

export const spanishTranslations = [
  'Every morning, Clara walks beside the river before going to work.',
  'The air is cool and the streets are still quiet.',
  'Near the bridge, a small café opens its doors.',
  'Clara orders a coffee and sits beside the window.',
  'While she waits, she reads a few pages of her favorite book.',
  'Today she finds a new word and writes its meaning in a notebook.',
  'Then she smiles: learning a language can also be a moment of calm.',
];

const spanishGlossary: Record<string, string> = {
  cada: 'every; each', mañana: 'morning', clara: 'Clara (a name)', camina: 'walks',
  junto: 'beside; together', al: 'to / beside the (a + el)', río: 'river', antes: 'before',
  de: 'of; from', ir: 'to go', trabajo: 'work', el: 'the (masculine)', aire: 'air',
  está: 'is', fresco: 'cool; fresh', y: 'and', las: 'the (feminine plural)', calles: 'streets',
  todavía: 'still', están: 'are', tranquilas: 'quiet; peaceful', cerca: 'near', del: 'of the',
  puente: 'bridge', un: 'a; one', pequeño: 'small', café: 'coffee; café', abre: 'opens',
  sus: 'his / her / its (plural possessions)', puertas: 'doors', pide: 'orders; asks for',
  se: 'reflexive pronoun', sienta: 'sits (se sienta)', a: 'to; at', la: 'the (feminine)',
  ventana: 'window', mientras: 'while', espera: 'waits', lee: 'reads', unas: 'a few; some',
  páginas: 'pages', su: 'his; her; its', libro: 'book', favorito: 'favorite', hoy: 'today',
  encuentra: 'finds', una: 'a; one (feminine)', palabra: 'word', nueva: 'new', escribe: 'writes',
  significado: 'meaning', en: 'in; on', libreta: 'notebook', después: 'afterwards; then',
  sonríe: 'smiles', aprender: 'to learn', idioma: 'language', también: 'also', puede: 'can',
  ser: 'to be', momento: 'moment', calma: 'calm', 'junto al río': 'beside the river',
  'al río': 'to the river', 'antes de': 'before', 'junto a la ventana': 'beside the window', 'un momento de calma': 'a moment of calm',
};

const englishGlossary: Record<string, string> = {
  the: 'definite article: a particular person or thing', north: 'the direction opposite south',
  wind: 'moving air', and: 'joins words or ideas', sun: 'the star that gives the Earth light and warmth',
  were: 'past tense of “be”', disputing: 'arguing; disagreeing', which: 'used to choose between possibilities',
  was: 'past tense of “be”', stronger: 'more powerful', when: 'at the time that',
  a: 'indefinite article: one unspecified thing', traveler: 'someone making a journey',
  came: 'past tense of “come”', along: 'moving forward; passing by', wrapped: 'covered or enclosed',
  in: 'inside; within', warm: 'comfortably hot', cloak: 'a loose outer garment worn over other clothes',
  they: 'the people or things already mentioned', agreed: 'accepted the same idea or proposal',
  that: 'introduces an idea or identifies something', one: 'a single person or thing', who: 'the person that',
  first: 'before all the others', succeeded: 'managed to achieve a goal', making: 'causing something to happen',
  take: 'remove, in “take off”', his: 'belonging to him', off: 'away from; removed',
  should: 'indicates what is expected or appropriate', be: 'exist; have a state or quality',
  considered: 'thought of or judged in a particular way', than: 'used in a comparison', other: 'the remaining one',
  then: 'after that', blew: 'past tense of “blow”: moved air forcefully', as: 'to the same degree',
  hard: 'with great force or effort', he: 'a male person or personified character', could: 'was able to',
  but: 'introduces a contrasting idea', more: 'to a greater degree', closely: 'tightly; with little space',
  did: 'past-tense auxiliary verb', fold: 'wrap or bend material around something', around: 'surrounding',
  him: 'the male person already mentioned', at: 'indicates a place or time', last: 'finally, in “at last”',
  gave: 'past tense of “give”', up: 'stopped trying, in “gave up”', attempt: 'an effort to do something',
  shone: 'past tense of “shine”: gave out light', out: 'outward; visibly', warmly: 'with pleasant heat',
  immediately: 'at once; without delay', took: 'past tense of “take”', so: 'as a result',
  obliged: 'required or compelled', to: 'introduces an infinitive verb', confess: 'admit something is true',
  of: 'indicates belonging or connection', two: 'the number 2', 'gave up': 'stopped trying',
  'at last': 'finally', 'take his cloak off': 'remove his cloak', 'was obliged to': 'had to; was forced to',
};

export const lessons = [
  { textId: 1, languageId: 1, title: 'Un momento de calma', languageName: 'Spanish', languageCode: 'ES', sentences: spanishSentences, glossary: spanishGlossary, isAudioLesson: false },
  { textId: 2, languageId: 2, title: 'The North Wind and the Sun', languageName: 'English', languageCode: 'EN', sentences: script, glossary: englishGlossary, isAudioLesson: true },
];

export type DemoWord = { wordId: number; term: string; translation: string; status: number; languageId: number };

export const normalizeTerm = (value: string) => value.trim().toLocaleLowerCase().replace(/[.!?,;:]+$/u, '');

export function initialWords(): DemoWord[] {
  const learning = new Set(['río', 'puente', 'tranquilas', 'palabra', 'libreta', 'disputing', 'cloak', 'traveler', 'blew', 'obliged', 'confess']);
  const known = new Set(['cada', 'clara', 'de', 'el', 'y', 'las', 'un', 'café', 'se', 'a', 'la', 'su', 'una', 'en', 'the', 'was', 'she', 'her', 'and', 'to', 'a', 'he', 'an', 'is', 'of', 'but', 'not']);
  let id = 100;
  return lessons.flatMap(lesson => [...new Set(lesson.sentences.join(' ').toLocaleLowerCase().match(/[\p{L}\p{M}]+/gu) || [])].map(term => ({
    wordId: id++, term, languageId: lesson.languageId,
    status: learning.has(term) ? 2 : known.has(term) ? 5 : 0,
    translation: learning.has(term) || known.has(term) ? lesson.glossary[term] || '' : '',
  })));
}

export const demoLanguages = lessons.map(lesson => ({
  languageId: lesson.languageId, name: lesson.languageName, code: lesson.languageCode,
  wordCharacters: '\\p{L}\\p{M}', characterSubstitutions: '', parserType: 'spacedel',
  sentenceSplitRegex: '[.!?]+', sentenceSplitExceptions: '', rightToLeft: false,
  showRomanization: false, dictionaries: [],
}));

const srtTime = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

export const demoSrt = timing.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${script[index]}\n`).join('\n');
