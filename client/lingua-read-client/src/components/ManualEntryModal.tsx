import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert, Spinner } from 'react-bootstrap';
import { getAllLanguages, logManualActivity } from '../utils/api'; // Use named imports

function ManualEntryModal({ show, onHide, onSubmitSuccess }) {
    const [languages, setLanguages] = useState([]);
    const [selectedLanguage, setSelectedLanguage] = useState('');
    const [wordsRead, setWordsRead] = useState('');
    const [minutesListened, setMinutesListened] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [isFetchingLanguages, setIsFetchingLanguages] = useState(false);

    // Fetch languages when the modal is shown for the first time or when 'show' becomes true
    useEffect(() => {
        if (show && languages.length === 0) {
            const fetchLanguages = async () => {
                // console.log('[ManualEntryModal] Fetching languages...'); // DEBUG REMOVED
                setIsFetchingLanguages(true);
                setError('');
                try {
                    const response = await getAllLanguages();
                    const languagesData = response || [];
                    setLanguages(languagesData);
                    // Pre-selecting the first language was previously gated on a
                    // wrapped axios-style `response.data` payload; the typed
                    // getAllLanguages now returns the array directly, and the
                    // pre-select line was already commented out. Left as a no-op.
                } catch (err) {
                    console.error("Error fetching languages:", err); // Revert DEBUG
                    setError('Failed to load languages. Please try closing and reopening the modal.'); // Revert DEBUG
                } finally {
                    setIsFetchingLanguages(false);
                }
            };
            fetchLanguages();
        }
    }, [show, languages.length]); // Depend on show and languages.length

    const handleInputChange = (setter) => (event) => {
        // Allow digits and a single optional leading minus (for corrections)
        const value = event.target.value
            .replace(/[^0-9-]/g, '')
            .replace(/(?!^)-/g, '');
        setter(value);
    };

    const resetForm = () => {
        setSelectedLanguage('');
        setWordsRead('');
        setMinutesListened('');
        setError('');
        setIsLoading(false);
    }

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');

        if (!selectedLanguage) {
            setError('Please select a language.');
            return;
        }

        const words = parseInt(wordsRead, 10);
        const minutes = parseInt(minutesListened, 10);

        if (isNaN(words) && isNaN(minutes)) {
             setError('Please enter words read or minutes listened.');
             return;
        }
        if ((!isNaN(words) && words === 0) || (!isNaN(minutes) && minutes === 0)) {
            setError('Words read and minutes listened must be non-zero if entered. Use a negative number to subtract from today\'s total.');
            return;
        }


        setIsLoading(true);
        try {
            const payload = {
                languageId: parseInt(selectedLanguage, 10),
                wordCount: !isNaN(words) && words !== 0 ? words : null,
                listeningDurationSeconds: !isNaN(minutes) && minutes !== 0 ? minutes * 60 : null,
            };

            // Ensure at least one value is being sent
            if (payload.wordCount === null && payload.listeningDurationSeconds === null) {
                 setError('Please enter a value for words read or minutes listened.');
                 setIsLoading(false);
                 return;
            }


            await logManualActivity(payload); // Use imported function
            onSubmitSuccess(); // Notify parent component (Statistics page)
            resetForm(); // Reset form on success
            onHide(); // Close modal on success
        } catch (err) {
            console.error("Error logging manual activity:", err);
            setError(err.response?.data?.message || 'An error occurred while saving the activity.');
        } finally {
            setIsLoading(false);
        }
    };

    // Reset form state when modal is hidden
    const handleExited = () => {
        resetForm();
    };


    return (
        <Modal show={show} onHide={onHide} onExited={handleExited} centered>
            <Modal.Header closeButton className="p-3" style={{ borderBottom: '1px solid var(--border-color)' }}> {/* Added padding and themed border */}
                <Modal.Title as="h5">Log Manual Activity</Modal.Title> {/* Use h5 for consistency */}
            </Modal.Header>
            <Modal.Body className="p-3"> {/* Added padding */}
                {error && <Alert variant="danger">{error}</Alert>}
                {isFetchingLanguages ? (
                    <div className="text-center">
                        <Spinner animation="border" role="status">
                            <span className="visually-hidden">Loading languages...</span>
                        </Spinner>
                    </div>
                ) : (
                    <Form onSubmit={handleSubmit}>
                        <Form.Group className="mb-3" controlId="manualLanguage">
                            <Form.Label>Language</Form.Label>
                            <Form.Select
                                value={selectedLanguage}
                                onChange={(e) => setSelectedLanguage(e.target.value)}
                                required
                                disabled={languages.length === 0}
                            >
                                <option value="" disabled>-- Select Language --</option>
                                {languages.map((lang) => (
                                    <option key={lang.languageId} value={lang.languageId}>
                                        {lang.name}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3" controlId="manualWordsRead">
                            <Form.Label>Words Read (Optional)</Form.Label>
                            <Form.Control
                                type="text"
                                inputMode="text"
                                pattern="-?[0-9]*"
                                placeholder="e.g., 1500"
                                value={wordsRead}
                                onChange={handleInputChange(setWordsRead)}
                                disabled={isLoading}
                            />
                            <Form.Text muted>
                                Enter a negative number (e.g. -100) to correct an over-count.
                            </Form.Text>
                        </Form.Group>

                        <Form.Group className="mb-3" controlId="manualMinutesListened">
                            <Form.Label>Time Listened (Minutes, Optional)</Form.Label>
                            <Form.Control
                                type="text"
                                inputMode="text"
                                pattern="-?[0-9]*"
                                placeholder="e.g., 45"
                                value={minutesListened}
                                onChange={handleInputChange(setMinutesListened)}
                                disabled={isLoading}
                            />
                            <Form.Text muted>
                                Enter a negative number (e.g. -10) to correct an over-count.
                            </Form.Text>
                        </Form.Group>

                        <div className="d-grid gap-2">
                             <Button type="submit" className="btn-primary" disabled={isLoading || isFetchingLanguages}> {/* Use global class */}
                                 {isLoading ? <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" /> : 'Log Activity'}
                             </Button>
                             <Button onClick={onHide} className="btn-secondary" disabled={isLoading}> {/* Use global class */}
                                 Cancel
                             </Button>
                        </div>
                    </Form>
                )}
            </Modal.Body>
        </Modal>
    );
}

export default ManualEntryModal;