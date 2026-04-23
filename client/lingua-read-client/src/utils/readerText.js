export const normalizeAssetUrl = (value) => {
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }

  return `/${value.replace(/^\/+/, '')}`;
};

export const countWordsInText = (content) => {
  if (!content) return 0;
  return (content.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
};

export const titleLineEndsLikeSentence = (line) => /[.!?…]["'”’)]?$/.test(line.trim());

export const isRomanOrNumericLine = (line) => /^\d{1,4}$/.test(line) || /^[IVXLCDM]+$/i.test(line);

export const isShortHeadingLine = (line) => {
  const wordCount = countWordsInText(line);
  return wordCount > 0 && wordCount <= 4 && !titleLineEndsLikeSentence(line);
};

export const isChapterMarkerLine = (line) => /^(part|chapter|book|section|prologue|epilogue|cap[ií]tulo|parte|livro)\b/i.test(line.trim());

export const isChapterMetaLine = (line) => {
  const trimmed = line.trim();
  return /^\d{1,4}$/.test(trimmed) || /^[IVXLCDM]+$/i.test(trimmed);
};

export const isQuotedEpigraphLine = (line) => /^["'“”‘’«»]/.test(line.trim()) || /["'”‘’«»]$/.test(line.trim());

export const getTitleLineVariant = (line, lineIndex, lines) => {
  const trimmed = line.trim();
  if (!trimmed) return 'spacer';
  if (isChapterMarkerLine(trimmed)) return 'chapter-marker';
  if (isChapterMetaLine(trimmed)) return 'chapter-meta';
  if (isQuotedEpigraphLine(trimmed)) return 'epigraph';

  const previousNonEmpty = [...lines]
    .slice(0, lineIndex)
    .reverse()
    .find(candidate => candidate.trim());

  if (previousNonEmpty && isQuotedEpigraphLine(previousNonEmpty) && countWordsInText(trimmed) <= 5) {
    return 'epigraph-attribution';
  }

  if (countWordsInText(trimmed) >= 8 && lineIndex > 0) {
    return 'epigraph';
  }

  return 'default';
};

export const buildDisplayBlocks = (content, structuredContent = []) => {
  if (Array.isArray(structuredContent) && structuredContent.length > 0) {
    return structuredContent
      .map((block, blockIndex) => {
        if (block?.type === 'image' && block?.imageUrl) {
          return {
            key: `block-${blockIndex}`,
            type: 'image',
            imageUrl: normalizeAssetUrl(block.imageUrl),
            altText: block.altText || '',
            caption: block.caption || '',
            meta: block.meta || {},
            isTitleBlock: false,
            text: '',
            lines: []
          };
        }

        const normalizedText = (block?.text || '').replace(/\r\n/g, '\n').trim();
        if (!normalizedText) {
          return null;
        }

        const lines = normalizedText.split('\n').map(line => line.trim());
        return {
          key: `block-${blockIndex}`,
          type: block?.type === 'title' ? 'title' : 'paragraph',
          text: normalizedText,
          lines,
          caption: block?.caption || '',
          meta: block?.meta || {},
          isTitleBlock: block?.type === 'title'
        };
      })
      .filter(Boolean);
  }

  if (!content) return [];

  const normalizedBlocks = content
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map(block => block.trim())
    .filter(Boolean)
    .map((block, blockIndex) => {
      const rawLines = block
        .split('\n')
        .map(line => line.trimEnd());
      const displayLines = rawLines.map(line => line.trim());
      const nonEmptyLines = displayLines.filter(Boolean);
      const joinedText = nonEmptyLines.join(' ').trim();
      const totalWordCount = countWordsInText(joinedText);
      const allCapsLineCount = nonEmptyLines.filter(line => /[A-Za-zÀ-ÿ]/.test(line) && line === line.toLocaleUpperCase()).length;
      const romanOrNumericLineCount = nonEmptyLines.filter(isRomanOrNumericLine).length;
      const shortHeadingLineCount = nonEmptyLines.filter(isShortHeadingLine).length;
      const proseLineCount = nonEmptyLines.filter(titleLineEndsLikeSentence).length;
      const hasBlankLine = rawLines.some(line => line.trim() === '');
      const strongTitleSignal = blockIndex <= 3 && (
        romanOrNumericLineCount > 0 ||
        allCapsLineCount > 0 ||
        (nonEmptyLines.length === 1 && shortHeadingLineCount === 1)
      );

      return {
        key: `block-${blockIndex}`,
        text: block,
        lines: displayLines,
        nonEmptyLines,
        totalWordCount,
        proseLineCount,
        hasBlankLine,
        strongTitleSignal
      };
    });

  return normalizedBlocks.map((block, blockIndex, blocks) => {
    const prevStrongTitleSignal = blocks[blockIndex - 1]?.strongTitleSignal ?? false;
    const nextStrongTitleSignal = blocks[blockIndex + 1]?.strongTitleSignal ?? false;
    const contextualTitleSignal = (
      blockIndex <= 3 &&
      block.totalWordCount <= 28 &&
      block.nonEmptyLines.length >= 2 &&
      (block.hasBlankLine || prevStrongTitleSignal || nextStrongTitleSignal) &&
      (prevStrongTitleSignal || nextStrongTitleSignal || block.proseLineCount === 0)
    );

    return {
      key: block.key,
      text: block.text,
      lines: block.lines,
      isTitleBlock: block.strongTitleSignal || contextualTitleSignal
    };
  });
};

export const splitTextIntoSentenceSegments = (content, structuredContent = []) => {
  if (!content && (!Array.isArray(structuredContent) || structuredContent.length === 0)) return [];

  const segments = [];
  const sentenceRegex = /[^.!?…]+(?:[.!?…]+(?:"|”|'|’)?|$)/g;
  let pendingMediaBlocks = [];

  buildDisplayBlocks(content, structuredContent).forEach((block) => {
    if (block.type === 'image') {
      pendingMediaBlocks.push(block);
      return;
    }

    if (block.isTitleBlock) {
      const titleSegmentText = block.lines.join('\n').trim();
      if (titleSegmentText) {
        segments.push({
          index: segments.length,
          text: titleSegmentText,
          type: 'title',
          mediaBlocks: pendingMediaBlocks
        });
        pendingMediaBlocks = [];
      }
      return;
    }

    const matches = block.text.match(sentenceRegex) || [block.text];
    matches
      .map(sentence => sentence.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .forEach((sentence, sentenceIndex) => {
        segments.push({
          index: segments.length,
          text: sentence,
          type: 'sentence',
          mediaBlocks: sentenceIndex === 0 ? pendingMediaBlocks : []
        });
      });

    pendingMediaBlocks = [];
  });

  if (pendingMediaBlocks.length > 0 && segments.length > 0) {
    const lastSegment = segments[segments.length - 1];
    lastSegment.mediaBlocks = [...(lastSegment.mediaBlocks || []), ...pendingMediaBlocks];
  }

  return segments;
};

export const styles = {
  highlightedWord: {
    cursor: 'pointer',
    padding: '0 2px',
    margin: '0 1px',
    borderRadius: '3px',
    transition: 'all 0.2s ease',
    userSelect: 'text',
    WebkitUserSelect: 'text',
    WebkitTouchCallout: 'default'
  },
  wordStatus1: { color: '#000', backgroundColor: '#ff6666' },
  wordStatus2: { color: '#000', backgroundColor: '#ff9933' },
  wordStatus3: { color: '#000', backgroundColor: '#ffdd66' },
  wordStatus4: { color: '#000', backgroundColor: '#99dd66' },
  wordStatus5: { color: 'inherit', backgroundColor: 'transparent' },
  selectedSentence: { backgroundColor: 'rgba(0, 123, 255, 0.1)', padding: '0.25rem', borderRadius: '0.25rem', border: '1px dashed rgba(0, 123, 255, 0.5)' },
  untrackedWord: { cursor: 'pointer', color: '#007bff', textDecoration: 'underline' },
  textContainer: { height: 'calc(100vh - 120px)', overflowY: 'auto', padding: '15px', borderRight: '1px solid #eee' },
  translationPanel: { height: 'calc(100vh - 120px)', padding: '15px' },
  wordPanel: { marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' },
  modalHeader: { backgroundColor: '#f8f9fa', borderBottom: '1px solid #dee2e6' }
};
