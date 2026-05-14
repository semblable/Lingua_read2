import React from 'react';

// react-window itemRenderer signature: { index, style, data }
type TranscriptLineProps = {
  index: number;
  style: React.CSSProperties;
  data: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: any[];
    currentLineId: number | string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processLineContent: (text: string) => any;
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

export default TranscriptLine;
