import { useEffect, useId, useRef, useState } from 'react';
import { Button, ButtonGroup, Form, Overlay, Popover } from 'react-bootstrap';
import { useTranscriptAppearance } from '../../hooks/useTranscriptAppearance';
import type { SecondaryControlsProps } from './SecondaryControls';
import './ReaderToolbar.css';

export function TranscriptAppearanceFields() {
  const { layout, alignment, setLayout, setAlignment } = useTranscriptAppearance();
  const flowId = useId();
  return <>
    <fieldset className="reader-appearance-field">
      <legend>Transcript alignment</legend>
      <ButtonGroup size="sm" aria-label="Transcript alignment">
        {(['left', 'center', 'justify'] as const).map(value => <Button key={value}
          variant="outline-secondary" aria-pressed={alignment === value} onClick={() => setAlignment(value)}>
          {value[0].toUpperCase() + value.slice(1)}
        </Button>)}
      </ButtonGroup>
    </fieldset>
    <Form.Check type="switch" role="switch" id={flowId} label="Flowing text" checked={layout === 'flow'}
      onChange={event => setLayout(event.target.checked ? 'flow' : 'cues')} />
  </>;
}

export default function ReaderAppearance({ isMobile, isAudioTranscript = false, globalSettings: settings,
  showParagraphIndent = true, showTextAlignment = true, setReadingDensity, setReaderContentWidth,
  setReaderParagraphIndent, setReaderTextAlignment, setTextSize, setLeftPanelWidth,
  handleLineSpacingChange, handleParagraphSpacingChange,
}: SecondaryControlsProps) {
  const [show, setShow] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restoreFocus: boolean) => {
    setShow(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!show) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus());
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setShow(false);
      trigger.current?.focus();
    };
    document.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', escape);
    };
  }, [show]);
  return <>
    <Button ref={trigger} variant="outline-secondary" size="sm" className="reader-appearance-toggle"
      aria-label="Appearance" aria-expanded={show} aria-controls={show ? id : undefined}
      aria-haspopup="dialog" onClick={() => setShow(value => !value)}>Aa</Button>
    <Overlay show={show} target={() => trigger.current} placement={isMobile ? 'bottom' : 'bottom-end'} rootClose
      onHide={() => close(false)} transition={false}
      popperConfig={{ strategy: 'fixed', modifiers: [{ name: 'preventOverflow', options: { padding: 12 } }] }}>
      <Popover id={id} role="dialog" aria-label="Reader appearance" className="reader-appearance-popover">
        <Popover.Body ref={panel}>
          <div className="reader-appearance-heading">
            <h2>Appearance</h2>
            <Button size="sm" variant="link" aria-label="Close appearance" onClick={() => close(true)}>×</Button>
          </div>
          <fieldset className="reader-appearance-field">
            <legend>Font size</legend>
            <div className="reader-font-stepper">
              <Button size="sm" variant="outline-secondary" aria-label="Decrease text size"
                disabled={settings.textSize <= 12} onClick={() => setTextSize(Math.max(12, settings.textSize - 2))}>A−</Button>
              <output aria-label="Current font size">{settings.textSize}px</output>
              <Button size="sm" variant="outline-secondary" aria-label="Increase text size"
                disabled={settings.textSize >= 32} onClick={() => setTextSize(Math.min(32, settings.textSize + 2))}>A+</Button>
            </div>
          </fieldset>
          <fieldset className="reader-appearance-field">
            <legend>Text column width</legend>
            <ButtonGroup size="sm" aria-label="Reader text width">
              {([[620, 'Narrow'], [740, 'Medium'], [900, 'Wide']] as const).map(([value, label]) => <Button key={value}
                variant="outline-secondary" aria-pressed={value === 620 ? settings.readerContentWidth <= 660
                  : value === 900 ? settings.readerContentWidth >= 820 : settings.readerContentWidth > 660 && settings.readerContentWidth < 820}
                onClick={() => setReaderContentWidth(value)}>{label}</Button>)}
            </ButtonGroup>
          </fieldset>
          <fieldset className="reader-appearance-field">
            <legend>Line spacing</legend>
            <ButtonGroup size="sm" aria-label="Line spacing">
              {[1.5, 1.75, 2].map(value => <Button key={value} variant="outline-secondary"
                aria-label={`Set line spacing to ${value}`} aria-pressed={Number(settings.lineSpacing) === value}
                onClick={() => handleLineSpacingChange(value)}>{value.toFixed(value === 1.75 ? 2 : 1)}</Button>)}
            </ButtonGroup>
          </fieldset>
          <fieldset className="reader-appearance-field">
            <legend>Paragraph spacing</legend>
            <ButtonGroup size="sm" aria-label="Paragraph spacing">
              {([[0.6, 'Tight'], [1, 'Normal'], [1.6, 'Relaxed']] as const).map(([value, label]) => <Button key={value}
                variant="outline-secondary" aria-label={`Set ${label.toLowerCase()} paragraph spacing`}
                aria-pressed={Number(settings.paragraphSpacing) === value}
                onClick={() => handleParagraphSpacingChange(value)}>{label}</Button>)}
            </ButtonGroup>
          </fieldset>
          {isAudioTranscript ? <TranscriptAppearanceFields /> : <>
            {showTextAlignment && <fieldset className="reader-appearance-field">
              <legend>Text alignment</legend>
              <ButtonGroup size="sm" aria-label="Text alignment">
                {(['left', 'justify'] as const).map(value => <Button key={value} variant="outline-secondary"
                  aria-pressed={value === 'justify' ? settings.readerTextAlignment === value : settings.readerTextAlignment !== 'justify'}
                  onClick={() => setReaderTextAlignment(value)}>{value === 'left' ? 'Left' : 'Justify'}</Button>)}
              </ButtonGroup>
            </fieldset>}
            {showParagraphIndent && <Form.Check type="switch" role="switch" id={`${id}-indent`} label="Indent paragraphs"
              checked={settings.readerParagraphIndent} onChange={event => setReaderParagraphIndent(event.target.checked)} />}
          </>}
          <details className="reader-appearance-advanced">
            <summary>Advanced layout</summary>
            <fieldset className="reader-appearance-field">
              <legend>Block density</legend>
              <ButtonGroup size="sm" aria-label="Reading density">
                {([['compact', 'Compact'], ['balanced', 'Balanced'], ['spacious', 'Spacious']] as const).map(([value, label]) =>
                  <Button key={value} variant="outline-secondary" aria-pressed={settings.readingDensity === value}
                    onClick={() => setReadingDensity(value)}>{label}</Button>)}
              </ButtonGroup>
              <p>Controls block padding and sentence grouping.</p>
            </fieldset>
            {!isMobile && settings.showWordInfoPanel && <fieldset className="reader-appearance-field">
              <legend>Reading area / word panel</legend>
              <div className="reader-font-stepper">
                <Button size="sm" variant="outline-secondary" aria-label="Decrease reading area"
                  disabled={settings.leftPanelWidth <= 20} onClick={() => setLeftPanelWidth(Math.max(20, settings.leftPanelWidth - 5))}>−</Button>
                <output aria-label="Reading area width">{settings.leftPanelWidth}%</output>
                <Button size="sm" variant="outline-secondary" aria-label="Increase reading area"
                  disabled={settings.leftPanelWidth >= 85} onClick={() => setLeftPanelWidth(Math.min(85, settings.leftPanelWidth + 5))}>+</Button>
              </div>
            </fieldset>}
          </details>
        </Popover.Body>
      </Popover>
    </Overlay>
  </>;
}
