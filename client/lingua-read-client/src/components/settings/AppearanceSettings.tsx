import React from 'react';
import { Form, Row, Col } from 'react-bootstrap';

const AppearanceSettings = ({ settings, handleChange }) => {
  return (
    <>
      <div className="settings-control-group">
        <Row>
          <Col md={6}>
            <Form.Group className="mb-3" controlId="theme">
              <Form.Label>Theme</Form.Label>
              <Form.Select name="theme" value={settings.theme} onChange={handleChange}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="classic-dark">Classic Dark</option>
                <option value="system">System Default</option>
              </Form.Select>
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
            <option value="left">Ragged Right</option>
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
    </>
  );
};

export default AppearanceSettings;
