import React, { useMemo } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';

const SummaryPopup = ({
  show,
  handleClose,
  title,
  sourceLanguage,
  targetLanguage,
  setTargetLanguage,
  languages,
  isLoadingLanguages,
  summaryText,
  isSummarizing,
  error,
  onSummarize
}) => {
  const languageOptions = useMemo(() => {
    const options = [{ code: 'EN', name: 'English' }];
    const seen = new Set(['EN']);

    (languages || []).forEach(language => {
      const code = language.code?.toUpperCase();
      if (!code || seen.has(code)) return;
      seen.add(code);
      options.push({ code, name: language.name || code });
    });

    return options;
  }, [languages]);

  return (
    <Modal
      show={show}
      onHide={handleClose}
      size="lg"
      aria-labelledby="summary-popup"
      centered
    >
      <Modal.Header closeButton className="p-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <Modal.Title id="summary-popup" as="h5">
          Summarize Text
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-3">
        <div className="mb-3">
          <div className="fw-semibold">{title}</div>
          <div className="text-muted small">Source language: {sourceLanguage || 'Auto'}</div>
        </div>

        <Form.Group className="mb-3" controlId="summaryTargetLanguage">
          <Form.Label>Summary language</Form.Label>
          <Form.Select
            value={targetLanguage}
            onChange={(event) => setTargetLanguage(event.target.value)}
            disabled={isSummarizing || isLoadingLanguages}
          >
            {languageOptions.map(language => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </Form.Select>
          {isLoadingLanguages && (
            <Form.Text className="text-muted">Loading languages...</Form.Text>
          )}
        </Form.Group>

        {error && <Alert variant="danger">{error}</Alert>}

        <div
          className="p-3 border rounded"
          style={{
            minHeight: '220px',
            maxHeight: '60vh',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.7,
            borderColor: 'var(--border-color)',
            backgroundColor: 'var(--popup-translated-panel-bg)'
          }}
        >
          {isSummarizing ? (
            <div className="d-flex justify-content-center align-items-center h-100">
              <Spinner animation="border" className="me-2" />
              <span>Summarizing text...</span>
            </div>
          ) : summaryText ? (
            summaryText
          ) : (
            <span className="text-muted">Choose a language and generate a summary.</span>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer className="p-3" style={{ borderTop: '1px solid var(--border-color)' }}>
        <Button variant="secondary" onClick={handleClose}>
          Close
        </Button>
        <Button variant="primary" onClick={onSummarize} disabled={isSummarizing || !targetLanguage}>
          {isSummarizing ? <Spinner size="sm" className="me-2" /> : null}
          Generate Summary
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SummaryPopup;
