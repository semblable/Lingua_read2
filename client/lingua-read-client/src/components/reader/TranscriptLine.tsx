import React from 'react';
import type { RowComponentProps } from 'react-window';
import type { SrtEntry } from '../../utils/srtParser';

// Row props passed to react-window's List via `rowProps`; the library spreads
// them into each row alongside its own `index`/`style`/`ariaAttributes`.
export type TranscriptRowProps = {
  lines: SrtEntry[];
  currentLineId: number | string | null;
  processLineContent: (text: string) => React.ReactNode;
  handleLineClick: (startTime: number) => void;
  hasSelection?: () => boolean;
};

const TranscriptLineImpl = ({
  ariaAttributes,
  index,
  style,
  lines,
  currentLineId,
  processLineContent,
  handleLineClick,
  hasSelection
}: RowComponentProps<TranscriptRowProps>): React.ReactElement | null => {
  const line = lines[index];
  if (!line) return null;

  return (
    <div className="transcript-row" style={style} {...ariaAttributes}>
      <p
        id={`srt-line-${line.id}`}
        className={`srt-line ${line.id === currentLineId ? 'active-srt-line' : ''}`}
        onClick={() => {
          if (hasSelection?.()) return;
          handleLineClick(line.startTime);
        }}
      >
        {processLineContent(line.text)}
      </p>
    </div>
  );
};

// Memoized, but cast back to the plain function signature that react-window's
// `rowComponent` prop expects (memo's wrapper type is not assignable to it).
const TranscriptLine = React.memo(TranscriptLineImpl) as typeof TranscriptLineImpl;

export default TranscriptLine;
