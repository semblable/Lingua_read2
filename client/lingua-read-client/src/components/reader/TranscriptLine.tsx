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
  getFontStyling: (lineSpacing: number) => React.CSSProperties;
  currentLineSpacing: number;
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
  getFontStyling,
  currentLineSpacing,
  hasSelection
}: RowComponentProps<TranscriptRowProps>): React.ReactElement | null => {
  const line = lines[index];
  if (!line) return null;

  return (
    <div style={style} {...ariaAttributes}>
      <p
        id={`srt-line-${line.id}`}
        className={`srt-line ${line.id === currentLineId ? 'active-srt-line' : ''}`}
        style={{
          ...getFontStyling(currentLineSpacing),
          padding: '0.3rem 0.5rem',
          borderRadius: '4px',
          transition: 'background-color 0.3s ease',
          cursor: 'pointer'
        }}
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
