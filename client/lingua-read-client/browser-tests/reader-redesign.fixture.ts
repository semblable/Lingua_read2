import { test as statusTest, expect } from './word-status.fixture';

/** Interactive reader evidence uses authored data only. The ordinary layout
 * fixture still rejects every mutation; this overlay accepts two narrow seams. */
export const test = statusTest.extend<{ appearanceWrites: Array<Record<string, unknown>> }>({
  appearanceWrites: [async ({ context, openLayout, baseURL }, use) => {
    void openLayout;
    const writes: Array<Record<string, unknown>> = [];
    const sentenceCredits = new Map<number, Set<number>>();
    const settingKeys = new Set(['textSize', 'readerContentWidth', 'lineSpacing', 'paragraphSpacing',
      'readerTextAlignment', 'readerParagraphIndent', 'readingDensity', 'leftPanelWidth',
      'showWordInfoPanel', 'sentenceMode']);
    await context.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== baseURL) { await route.fallback(); return; }
      if (request.method() === 'PUT' && url.pathname === '/api/usersettings') {
        const patch = request.postDataJSON() as Record<string, unknown>;
        if (Object.keys(patch).every(key => settingKeys.has(key))) {
          writes.push(patch);
          await route.fulfill({ json: patch });
          return;
        }
      }
      if (request.method() === 'POST' && url.pathname === '/api/activity/logSentenceRead') {
        const { textId, currentSegmentIndex, segments } = request.postDataJSON() as {
          textId: number; currentSegmentIndex?: number; segments?: Array<{ segmentIndex: number; segmentText: string }>
        };
        if ([801, 802].includes(textId)
          && (currentSegmentIndex === undefined || (Number.isInteger(currentSegmentIndex) && currentSegmentIndex >= 0))
          && Array.isArray(segments) && segments.length > 0
          && segments.every(s => Number.isInteger(s.segmentIndex) && s.segmentIndex >= 0 && typeof s.segmentText === 'string' && s.segmentText.trim())) {
          const credited = sentenceCredits.get(textId) ?? new Set<number>();
          segments.forEach(s => credited.add(s.segmentIndex));
          sentenceCredits.set(textId, credited);
          await route.fulfill({ json: { creditedSegmentIndices: [...credited] } });
          return;
        }
      }
      await route.fallback();
    });
    await use(writes);
  }, { auto: true }],
});

export { expect };
