import React from 'react';
import type { RowComponentProps } from 'react-window';
import type { TranscriptParagraph as Paragraph } from '../../utils/audioTranscript';

// Row props passed to react-window's List via `rowProps`; the library spreads
// them into each row alongside its own `index`/`style`/`ariaAttributes`.
export type TranscriptContentProps = {
  currentLineId: number | string | null;
  processLineContent: (text: string) => React.ReactNode;
  handleLineClick: (startTime: number) => void;
  hasSelection?: () => boolean;
};
export type TranscriptRowProps = TranscriptContentProps & { paragraphs: Paragraph[] };

export const TranscriptParagraph = React.memo(({
  paragraph, currentLineId, processLineContent, handleLineClick, hasSelection
}: TranscriptContentProps & { paragraph: Paragraph }) => (
  <p className={`transcript-paragraph${paragraph.cues.some(cue => cue.line.id === currentLineId) ? ' has-active-cue' : ''}`}>
    {paragraph.cues.map(({ line, text, separator }) => (
      <React.Fragment key={line.id}>
        {separator}
        <span
          id={`srt-line-${line.id}`}
          className={`srt-line${line.id === currentLineId ? ' active-srt-line' : ''}`}
          aria-current={line.id === currentLineId ? 'true' : undefined}
          onClick={() => { if (!hasSelection?.()) handleLineClick(line.startTime); }}
        >
          {processLineContent(text)}
        </span>
      </React.Fragment>
    ))}
  </p>
));
TranscriptParagraph.displayName = 'TranscriptParagraph';

const TranscriptLineImpl = ({
  ariaAttributes,
  index,
  style,
  paragraphs,
  currentLineId,
  processLineContent,
  handleLineClick,
  hasSelection
}: RowComponentProps<TranscriptRowProps>): React.ReactElement | null => {
  const paragraph = paragraphs[index];
  if (!paragraph) return null;

  return (
    <div className="transcript-row" style={style} {...ariaAttributes}>
      <TranscriptParagraph paragraph={paragraph} currentLineId={currentLineId}
        processLineContent={processLineContent} handleLineClick={handleLineClick} hasSelection={hasSelection} />
    </div>
  );
};

// Memoized, but cast back to the plain function signature that react-window's
// `rowComponent` prop expects (memo's wrapper type is not assignable to it).
const TranscriptLine = React.memo(TranscriptLineImpl) as typeof TranscriptLineImpl;

export default TranscriptLine;
