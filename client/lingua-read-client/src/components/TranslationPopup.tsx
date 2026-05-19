import React, { useMemo, useRef, useCallback, useEffect } from 'react'; // Added useEffect
import { Modal, Button, Spinner, Row, Col } from 'react-bootstrap';

// Parser for the <o s="N">...</o><t s="N">...</t> format
interface SentencePair {
  number: number;
  original: string;
  translated: string;
}

const parsePairedTranslation = (taggedText: string | undefined | null): SentencePair[] => {
  if (!taggedText) return [];
  // Regex to capture pairs of <o> and <t> tags with the same sentence number
  const regex = /<o s="(\d+?)">(.*?)<\/o>\s*<t s="\1">(.*?)<\/t>/gs;
  const pairs: SentencePair[] = [];
  let match;
  while ((match = regex.exec(taggedText)) !== null) {
    pairs.push({
      number: parseInt(match[1], 10),
      original: match[2], // Content of <o> tag
      translated: match[3] // Content of <t> tag
    });
  }
  // Sort by number just in case the LLM doesn't return them in order
  pairs.sort((a, b) => a.number - b.number);
  return pairs;
};


// sentenceColors array is no longer needed as we'll use CSS variables from themes.

type TranslationPopupProps = {
  show: boolean;
  handleClose: () => void;
  originalText?: string;
  translatedText?: string;
  isTranslating?: boolean;
  sourceLanguage?: string;
  targetLanguage?: string;
};

const TranslationPopup = ({
  show,
  handleClose,
  originalText,
  translatedText,
  isTranslating,
  sourceLanguage,
  targetLanguage
}: TranslationPopupProps) => {
  const originalScrollRef = useRef<HTMLDivElement | null>(null);
  const translatedScrollRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScroll = useRef(false); // Flag to prevent scroll loops

  // Memoize sentence processing to avoid re-calculation on every render
  const sentencePairs = useMemo(() => {
    // Parse the combined tagged text directly
    const pairs = parsePairedTranslation(translatedText);
    if (pairs.length > 0) {
      return pairs;
    }

    // Fallback: show raw translation when tags are missing.
    if (translatedText && translatedText.trim()) {
      return [
        {
          number: 1,
          original: originalText || '',
          translated: translatedText
        }
      ];
    }

    return [];
    // No longer need originalText as a dependency here if it's embedded in translatedText
  }, [translatedText, originalText]);

  // Scroll synchronization handler
  const handleScroll = useCallback((source: 'original' | 'translated') => {
    if (isSyncingScroll.current) return; // Exit if already syncing

    isSyncingScroll.current = true; // Set flag

    const sourceEl = source === 'original' ? originalScrollRef.current : translatedScrollRef.current;
    // Removed duplicate sourceEl declaration
    const targetEl = source === 'original' ? translatedScrollRef.current : originalScrollRef.current;

    if (sourceEl && targetEl) {
      // Directly synchronize scrollTop
      targetEl.scrollTop = sourceEl.scrollTop;
    }

    // Reset the flag slightly later to allow the scroll event to settle
    requestAnimationFrame(() => {
       isSyncingScroll.current = false;
    });
  }, []); // No dependencies needed as refs are stable


  // Effect to synchronize sentence block heights using ResizeObserver
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      // Use a Set to avoid redundant processing if both elements trigger the observer simultaneously
      const elementsToSync = new Set<HTMLElement>();
      for (const entry of entries) {
        // Find the corresponding pair element based on the ID structure
        const target = entry.target as HTMLElement;
        const id = target.id;
        const parts = id.split('-');
        const type = parts[0]; // 'orig' or 'trans'
        const number = parts[parts.length - 1];
        const counterpartType = type === 'orig' ? 'trans' : 'orig';
        const counterpartId = `${counterpartType}-block-${number}`;
        const counterpartEl = document.getElementById(counterpartId);
        if (counterpartEl) {
          // Add both elements of the pair to the set for syncing
          elementsToSync.add(target);
          elementsToSync.add(counterpartEl);
        }
      }
      // Process sync requests, ensuring pairs are handled together
      const processedPairs = new Set<string | undefined>();
      elementsToSync.forEach((el) => {
        const id = el.id;
        const number = id.split('-').pop();
        if (!processedPairs.has(number)) {
          const originalEl = document.getElementById(`orig-block-${number}`);
          const translatedEl = document.getElementById(`trans-block-${number}`);
          syncPairHeight(originalEl, translatedEl);
          processedPairs.add(number);
        }
      });
    });

    const syncPairHeight = (originalEl: HTMLElement | null, translatedEl: HTMLElement | null) => {
      if (originalEl && translatedEl) {
        // Temporarily reset minHeight to measure natural height accurately
        originalEl.style.minHeight = '0px';
        translatedEl.style.minHeight = '0px';

        // Use offsetHeight as it includes padding and borders
        const originalHeight = originalEl.offsetHeight;
        const translatedHeight = translatedEl.offsetHeight;
        const maxHeight = Math.max(originalHeight, translatedHeight);

        // Set minHeight to the max height
        originalEl.style.minHeight = `${maxHeight}px`;
        translatedEl.style.minHeight = `${maxHeight}px`;
      }
    };

    // Observe elements after initial render/update
    if (sentencePairs.length > 0 && !isTranslating) {
       sentencePairs.forEach(pair => {
           const originalEl = document.getElementById(`orig-block-${pair.number}`);
           const translatedEl = document.getElementById(`trans-block-${pair.number}`);
           if (originalEl && translatedEl) {
               // Initial sync
               syncPairHeight(originalEl, translatedEl);
               // Observe both elements
               observer.observe(originalEl);
               observer.observe(translatedEl);
           }
       });
    }

    // Cleanup function to disconnect the observer
    return () => {
      observer.disconnect();
    };
  }, [sentencePairs, isTranslating]); // Rerun when pairs change or translation finishes

  return (
    <Modal
      show={show}
      onHide={handleClose}
      size="lg" /* Changed from xl to lg */
      aria-labelledby="translation-popup"
      centered
      dialogClassName="translation-modal-wide" /* Custom class for wider modal */
    >
      <Modal.Header closeButton className="p-3" style={{ borderBottom: '1px solid var(--border-color)' }}> {/* Added padding and themed border */}
        <Modal.Title id="translation-popup" as="h5"> {/* Use h5 for consistency */}
          Translation ({sourceLanguage} → {targetLanguage})
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-3"> {/* Added padding */}
        <Row>
          <Col md={6}>
            <h6>Original Text:</h6>
            {/* Original Text Column - Add ref and onScroll */}
            <div
              ref={originalScrollRef}
              onScroll={() => handleScroll('original')}
              className="p-2 border rounded h-100" /* Increased padding slightly */
              style={{
                minHeight: '200px',
                maxHeight: '60vh',
                overflowY: 'auto',
                lineHeight: '1.8',
                borderColor: 'var(--border-color)',
                backgroundColor: 'var(--popup-original-panel-bg)' /* Added themed background */
              }}
            >
              {isTranslating ? (
                 <div className="d-flex justify-content-center align-items-center p-4 h-100"><span>Loading...</span></div>
              ) : sentencePairs.length > 0 ? (
                 sentencePairs.map((pair, index) => (
                  <div
                    id={`orig-block-${pair.number}`} // Add ID
                    key={`orig-${pair.number}`}
                    className="p-2 mb-2 rounded sentence-block"
                    style={{ backgroundColor: index % 2 === 0 ? 'var(--popup-sentence-bg-1)' : 'var(--popup-sentence-bg-2)' }}
                    // Render original text, potentially decoding HTML entities if needed later
                  >
                    <span className={`translation-segment-color-${(index % 5) + 1}`}>
                      {pair.original}
                    </span>
                  </div>
                 ))
              ) : (
                 <div className="p-2 text-muted">Original text will appear here after translation.</div>
              )}
            </div>
          </Col>
          <Col md={6}>
            <h6>Translation:</h6>
            {/* Translation Column - Add ref and onScroll */}
            {isTranslating ? (
              <div className="d-flex justify-content-center align-items-center p-4 border rounded h-100" style={{ minHeight: '200px', borderColor: 'var(--border-color)' }}> {/* Themed border */}
                <Spinner animation="border" className="me-2" />
                <span>Translating text...</span>
              </div>
            ) : sentencePairs.length > 0 ? (
              <div
                ref={translatedScrollRef}
                onScroll={() => handleScroll('translated')}
                className="p-2 border rounded h-100" /* Increased padding slightly */
                style={{
                  minHeight: '200px',
                  maxHeight: '60vh',
                  overflowY: 'auto',
                  lineHeight: '1.8',
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--popup-translated-panel-bg)' /* Added themed background */
                }}
              >
                {sentencePairs.map((pair, index) => (
                  <div
                    id={`trans-block-${pair.number}`} // Add ID
                    key={`trans-${pair.number}`}
                    className="p-2 mb-2 rounded sentence-block"
                    style={{ backgroundColor: index % 2 === 0 ? 'var(--popup-sentence-bg-1)' : 'var(--popup-sentence-bg-2)' }}
                    // Render translated text, potentially decoding HTML entities if needed later
                  >
                    <span className={`translation-segment-color-${(index % 5) + 1}`}>
                      {pair.translated}
                    </span>
                  </div>
                ))}
              </div>
             ) : (
                 <div className="p-2 text-muted">Translation will appear here.</div>
             )}
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer className="p-3" style={{ borderTop: '1px solid var(--border-color)' }}> {/* Added padding and themed border */}
        <Button variant="secondary" onClick={handleClose} className="btn-secondary"> {/* Ensure it uses global styles */}
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default TranslationPopup; 