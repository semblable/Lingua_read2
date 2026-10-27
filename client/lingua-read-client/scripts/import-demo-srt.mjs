import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrtContent } from '../src/utils/srtParser.ts';

// Uses the same SRT parser as the reader. Node 24 supports this file's TS import.
// Export SRT from your preferred Whisper tool against the exact bundled MP3,
// then pass that SRT here. This does not install or run a speech model.
const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = resolve(process.argv[2] || resolve(clientDir, 'demo/public/audio/north-wind-and-sun.en.srt'));
const source = readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
const cues = parseSrtContent(source);
if (!cues.length) throw new Error('The SRT contains no usable cues. Existing fixture files were not changed.');
let previousEnd = 0;
for (const cue of cues) {
  if (!Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime) || cue.startTime < previousEnd || cue.endTime <= cue.startTime || !cue.text.trim()) {
    throw new Error(`Invalid or overlapping cue ${cue.id}. Existing fixture files were not changed.`);
  }
  if (cue.endTime > 37) throw new Error('A cue ends after the 36-second sample. Transcribe the exact bundled recording.');
  previousEnd = cue.endTime;
}
writeFileSync(resolve(clientDir, 'demo/content/audio-script.json'), `${JSON.stringify(cues.map(c => c.text.replace(/\s+/g, ' ').trim()), null, 2)}\n`);
writeFileSync(resolve(clientDir, 'demo/content/audio-timing.json'), `${JSON.stringify(cues.map(c => ({ start: c.startTime, end: c.endTime })), null, 2)}\n`);
console.log(`Imported ${cues.length} cues, ending at ${previousEnd.toFixed(3)}s. Run npm run demo:build.`);
