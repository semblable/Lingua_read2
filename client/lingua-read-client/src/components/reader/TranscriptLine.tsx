import React from 'react';
import type { SrtEntry } from '../../utils/srtParser';

type TranscriptLineProps = {
  index: number;
  style: React.CSSProperties;
  data: {
    lines: SrtEntry[];
    currentLineId: number | string | null;
    processLineContent: (text: string) => React.ReactNode;
    handleLineClick: (startTime: number) => void;
    getFontStyling: (lineSpacing: number) => React.CSSProperties;
    currentLineSpacing: number;
    hasSelection?: () => boolean;
  };
};

const TranscriptLine = React.memo(({ index, style, data }: TranscriptLineProps) => {
  const {
    lines, currentLineId, processLineContent, handleLineClick, getFontStyling, currentLineSpacing, hasSelection
  } = data;
  const line = lines[index];
  if (!line) return null;

  return (
    <div style={style}>
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
});

TranscriptLine.displayName = 'TranscriptLine';

export default TranscriptLine;
