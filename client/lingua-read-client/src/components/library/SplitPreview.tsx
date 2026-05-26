import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert, Badge, ProgressBar } from 'react-bootstrap';
import type { SplitPreview as SplitPreviewType, ChapterPreview } from '../../utils/api/books';
import './SplitPreview.css';

interface SplitPreviewProps {
  show: boolean;
  onHide: () => void;
  previewData: SplitPreviewType | null;
  onConfirm: (editedTitles: string[]) => void | Promise<void>;
  submitting: boolean;
}

const SplitPreview = ({ show, onHide, previewData, onConfirm, submitting }: SplitPreviewProps) => {
  const [chapters, setChapters] = useState<ChapterPreview[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (previewData) {
      setChapters(JSON.parse(JSON.stringify(previewData.chapters)));
    }
  }, [previewData]);

  if (!previewData) return null;

  const handleTitleChange = (index: number, newTitle: string) => {
    setChapters(prev => prev.map(c => c.index === index ? { ...c, title: newTitle } : c));
  };

  const handleMergeNext = (index: number) => {
    // Find the chapter index in array
    const arrayIndex = chapters.findIndex(c => c.index === index);
    if (arrayIndex === -1 || arrayIndex >= chapters.length - 1) return;

    const current = chapters[arrayIndex];
    const next = chapters[arrayIndex + 1];

    // Merge next into current
    const mergedChapter: ChapterPreview = {
      ...current,
      title: `${current.title} + ${next.title}`,
      snippet: `${current.snippet}\n\n[Merged Content]\n\n${next.snippet}`,
      characterCount: current.characterCount + next.characterCount,
      estimatedWordCount: current.estimatedWordCount + next.estimatedWordCount,
    };

    // Remove the next one and replace the current one
    const updated = [...chapters];
    updated.splice(arrayIndex, 2, mergedChapter);

    // Re-index remaining chapters
    const reindexed = updated.map((c, i) => ({
      ...c,
      index: i + 1
    }));

    setChapters(reindexed);
    if (expandedIndex === index || expandedIndex === next.index) {
      setExpandedIndex(null);
    }
  };

  const maxCharCount = Math.max(...chapters.map(c => c.characterCount), 1);

  const getMethodBadgeVariant = (method: string) => {
    if (method.startsWith('epub-toc')) return 'success';
    if (method.startsWith('epub-heading')) return 'info';
    if (method.startsWith('text-heading')) return 'primary';
    if (method.startsWith('section-break')) return 'warning';
    return 'secondary';
  };

  const getMethodLabel = (method: string) => {
    if (method === 'epub-toc') return 'EPUB Table of Contents';
    if (method === 'epub-heading') return 'EPUB Document Headings';
    if (method === 'text-heading') return 'Text Chapter Regex Matches';
    if (method === 'section-break') return 'Text Line Breaks';
    if (method.startsWith('fallback')) return `Fallback Split (${method.split('-')[1]})`;
    return method;
  };

  const handleConfirm = () => {
    onConfirm(chapters.map(c => c.title));
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered className="split-preview-modal">
      <Modal.Header closeButton className="split-preview-header">
        <Modal.Title className="split-preview-title">
          📚 Book Splitting Preview
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="split-preview-body">
        <div className="preview-summary-card mb-4 d-flex justify-content-between align-items-center">
          <div>
            <div className="small-label">Chapter Detection Strategy</div>
            <Badge bg={getMethodBadgeVariant(previewData.detectionMethod)} className="method-badge">
              {getMethodLabel(previewData.detectionMethod)}
            </Badge>
          </div>
          <div className="d-flex gap-4">
            <div className="stat-item text-center">
              <span className="stat-value">{chapters.length}</span>
              <span className="stat-label">Parts</span>
            </div>
            <div className="stat-item text-center">
              <span className="stat-value">
                {chapters.reduce((sum, c) => sum + c.estimatedWordCount, 0).toLocaleString()}
              </span>
              <span className="stat-label">Words</span>
            </div>
            <div className="stat-item text-center">
              <span className="stat-value">
                {chapters.reduce((sum, c) => sum + c.characterCount, 0).toLocaleString()}
              </span>
              <span className="stat-label">Chars</span>
            </div>
          </div>
        </div>

        <div className="chapter-list-container">
          {chapters.length === 0 ? (
            <Alert variant="warning">No parts detected. Try adjusting your settings.</Alert>
          ) : (
            chapters.map((chap, idx) => {
              const percentage = (chap.characterCount / maxCharCount) * 100;
              const isExpanded = expandedIndex === chap.index;
              
              return (
                <div key={chap.index} className={`chapter-preview-row ${isExpanded ? 'expanded' : ''}`}>
                  <div className="row-main-content">
                    <span className="part-badge">Part {chap.index}</span>
                    <Form.Control
                      type="text"
                      className="chapter-title-input"
                      value={chap.title}
                      onChange={(e) => handleTitleChange(chap.index, e.target.value)}
                    />
                    <div className="chapter-stats">
                      <span className="size-badge text-muted">
                        {chap.estimatedWordCount.toLocaleString()} words
                      </span>
                      <Button
                        variant="link"
                        className="toggle-snippet-btn"
                        onClick={() => setExpandedIndex(isExpanded ? null : chap.index)}
                      >
                        {isExpanded ? 'Hide Snippet' : 'View Snippet'}
                      </Button>
                      {idx < chapters.length - 1 && (
                        <Button
                          variant="outline-danger"
                          size="sm"
                          className="merge-btn"
                          onClick={() => handleMergeNext(chap.index)}
                          title="Merge with next chapter"
                        >
                          Merge Next
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  <div className="chapter-size-indicator mt-2">
                    <ProgressBar 
                      now={percentage} 
                      className="chapter-progress-bar"
                      variant={chap.characterCount > 15000 ? "danger" : chap.characterCount > 8000 ? "warning" : "info"}
                    />
                  </div>

                  {isExpanded && (
                    <div className="snippet-preview-box mt-3 animate-fade-in">
                      <div className="snippet-title text-muted">Content Preview snippet:</div>
                      <p className="snippet-text">{chap.snippet || "No text snippet available."}</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Modal.Body>
      <Modal.Footer className="split-preview-footer">
        <Button variant="outline-secondary" onClick={onHide} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" className="confirm-split-btn" onClick={handleConfirm} disabled={submitting || chapters.length === 0}>
          {submitting ? 'Processing Book...' : 'Confirm & Split'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SplitPreview;
