import React from 'react';
import { Form, Row, Col } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import { THEME_OPTIONS } from '../../utils/theme';
import { readerFontFamily } from '../../utils/readerAppearance';

export type SettingsChangeHandler = (
  event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
) => void;

interface AppearanceSettingsProps {
  settings: Settings;
  handleChange: SettingsChangeHandler;
}

const AppearanceSettings = ({ settings, handleChange }: AppearanceSettingsProps) => {
  return (
    <>
      <div className="settings-control-group">
        <Row>
          <Col md={6}>
            <Form.Group className="mb-3" controlId="theme">
              <Form.Label>Theme</Form.Label>
              <Form.Select name="theme" value={settings.theme} onChange={handleChange}>
                {THEME_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Form.Select>
              <Form.Text className="text-muted">
                High Contrast themes are optional. System Default follows your device&apos;s light or dark appearance.
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-3" controlId="textFont">
              <Form.Label>Font Family</Form.Label>
              <Form.Select name="textFont" value={settings.textFont} onChange={handleChange}>
                <option value="default">Default (Inter)</option>
                <option value="serif">Serif (Lora)</option>
                <option value="open-sans">Open Sans</option>
                <option value="lato">Lato</option>
                <option value="atkinson">Atkinson Hyperlegible</option>
                <option value="merriweather">Merriweather</option>
                <option value="roboto-slab">Roboto Slab</option>
                <option value="monospace">Monospace</option>
                <option value="comic-sans">Comic Sans</option>
                <option value="dyslexic">OpenDyslexic</option>
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
      </div>

      <div className="settings-control-group">
        <h3 className="h6">Reading comfort</h3>
        <p className="small text-muted">Try the font, spacing and width that work for your reading.</p>
        <Row>
          <Col md={6}>
            <Form.Group className="mb-3" controlId="textSize">
              <Form.Label>Text Size ({settings.textSize}px)</Form.Label>
              <Form.Range name="textSize" min={10} max={36} value={settings.textSize} onChange={handleChange} />
              <div className="d-flex justify-content-between">
                <small className="text-muted">Small</small>
                <small className="text-muted">Large</small>
              </div>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-3" controlId="lineSpacing">
              <Form.Label>Line Spacing</Form.Label>
              <Form.Select name="lineSpacing" value={settings.lineSpacing} onChange={handleChange}>
                <option value={1.5}>Default (1.5)</option>
                <option value={1.75}>Relaxed (1.75)</option>
                <option value={2.0}>Spacious (2.0)</option>
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
      </div>

      <div className="settings-control-group">
        <Row>
          <Col md={6}>
            <Form.Group className="mb-3" controlId="readingUiMode">
              <Form.Label>Reader Display Mode</Form.Label>
              <Form.Select name="readingUiMode" value={settings.readingUiMode} onChange={handleChange}>
                <option value="classic">Classic</option>
                <option value="modern">Modern</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-3" controlId="readingDensity">
              <Form.Label>Reading Density</Form.Label>
              <Form.Select name="readingDensity" value={settings.readingDensity} onChange={handleChange}>
                <option value="compact">Compact</option>
                <option value="balanced">Balanced</option>
                <option value="spacious">Spacious</option>
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
      </div>

      <div className="settings-control-group">
        <Form.Group className="mb-3" controlId="leftPanelWidth">
          <Form.Label>Reading Panel Width ({settings.leftPanelWidth}%)</Form.Label>
          <Form.Range name="leftPanelWidth" min={20} max={85} value={settings.leftPanelWidth} onChange={handleChange} />
          <div className="d-flex justify-content-between">
            <small className="text-muted">Narrow</small>
            <small className="text-muted">Wide</small>
          </div>
        </Form.Group>

        <Form.Group className="mb-3" controlId="readerContentWidth">
          <Form.Label>Reader Text Width ({settings.readerContentWidth}px)</Form.Label>
          <Form.Range name="readerContentWidth" min={520} max={980} step={20} value={settings.readerContentWidth} onChange={handleChange} />
          <div className="d-flex justify-content-between">
            <small className="text-muted">Narrow</small>
            <small className="text-muted">Wide</small>
          </div>
        </Form.Group>
      </div>

      <div className="settings-control-group">
        <Form.Group className="mb-3" controlId="readerTextAlignment">
          <Form.Label>Body Text Alignment</Form.Label>
          <Form.Select name="readerTextAlignment" value={settings.readerTextAlignment} onChange={handleChange}>
            <option value="left">Start of line (follows reading direction)</option>
            <option value="justify">Justified</option>
          </Form.Select>
        </Form.Group>

        <Form.Group className="mb-3" controlId="showWordInfoPanel">
          <Form.Check
            type="switch"
            name="showWordInfoPanel"
            label="Show word info side panel by default on desktop"
            checked={settings.showWordInfoPanel}
            onChange={handleChange}
          />
        </Form.Group>

        <Form.Group className="mb-0" controlId="readerParagraphIndent">
          <Form.Check
            type="switch"
            name="readerParagraphIndent"
            label="Indent body paragraphs"
            checked={settings.readerParagraphIndent}
            onChange={handleChange}
          />
        </Form.Group>
      </div>

      <div className="settings-control-group">
        <Form.Group className="mb-3" controlId="readerStatusMarkersEnabled">
          <Form.Check
            type="switch"
            name="readerStatusMarkersEnabled"
            label="Experimental word-status markers"
            checked={settings.readerStatusMarkersEnabled}
            onChange={handleChange}
            aria-describedby="readerStatusMarkersHelp"
          />
          <Form.Text id="readerStatusMarkersHelp" className="text-muted">
            Adds non-color cues independently of your theme. Off by default; these styles await multilingual and user review.
            Known and Ignored words remain plain.
          </Form.Text>
        </Form.Group>
        <figure className="settings-reading-preview" aria-label="Synthetic reading preview">
          <p lang="en" style={{ fontSize: `${settings.textSize}px`, lineHeight: settings.lineSpacing, fontFamily: readerFontFamily(settings.textFont) }}>
            A <span className="highlighted-word word-status-0">quiet</span>{' '}
            <span className="highlighted-word word-status-1">garden</span>{' '}
            <span className="highlighted-word word-status-2">welcomes</span>{' '}
            <span className="highlighted-word word-status-3">curious</span>{' '}
            <span className="highlighted-word word-status-4">readers</span>{' '}
            <span className="word-status-5">each</span> <span className="word-status-6">day.</span>
          </p>
          <figcaption className="text-muted">
            Synthetic example: Untracked, New, Learning, Familiar, Advanced, Known, Ignored.
            Your current saved theme and marker preference apply after saving.
          </figcaption>
        </figure>
      </div>
    </>
  );
};

export default AppearanceSettings;
