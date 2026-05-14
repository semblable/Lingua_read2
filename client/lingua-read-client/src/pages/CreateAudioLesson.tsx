import React, { useState, useEffect, useContext } from 'react'; // Added useContext
// import { useNavigate } from 'react-router-dom'; // Keep commented if not used
import { Container, Form, Button, Alert, Spinner, Row, Col } from 'react-bootstrap';
import { getAllLanguages, createAudioLesson } from '../utils/api'; // Changed getLanguages to getAllLanguages
import { SettingsContext } from '../contexts/SettingsContext'; // Import SettingsContext
// import './CreateAudioLesson.css'; // Remove CSS file import

function CreateAudioLesson() {
    const [title, setTitle] = useState('');
    const [languageId, setLanguageId] = useState('');
    const [audioFile, setAudioFile] = useState(null);
    const [srtFile, setSrtFile] = useState(null);
    const [tag, setTag] = useState('');
    const [languages, setLanguages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    // const navigate = useNavigate();
    const { settings: userSettings } = useContext(SettingsContext); // Get settings from context

    // Fetch languages on component mount
    useEffect(() => {
        const fetchLanguages = async () => {
            try {
                const data = await getAllLanguages();
                setLanguages(data || []);

                // Use default language from context if available and valid
                const defaultLangId = userSettings?.defaultLanguageId;

                if (data.length > 0) {
                    const found = data.find(l => l.languageId === defaultLangId);
                    if (found) {
                        setLanguageId(found.languageId.toString());
                    } else {
                        // Don't default if no user setting, let user select
                        // setLanguageId(data[0].languageId.toString());
                    }
                }
            } catch (err) {
                setError('Failed to load languages.');
                console.error(err);
            }
        };
        fetchLanguages();
        // Re-run if userSettings context changes
    }, [userSettings?.defaultLanguageId]);

    const handleAudioFileChange = (event) => {
        setAudioFile(event.target.files[0]);
    };

    const handleSrtFileChange = (event) => {
        setSrtFile(event.target.files[0]);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setSuccessMessage('');

        if (!title || !languageId || !audioFile || !srtFile) {
            setError('Please fill in all required fields and select both files.');
            return;
        }

        // Basic file type validation
        if (!audioFile.type.startsWith('audio/')) {
            setError('Invalid audio file type. Please select an audio file.');
            return;
        }
         if (!srtFile.name.toLowerCase().endsWith('.srt')) {
             setError('Invalid subtitle file type. Please select a .srt file.');
             return;
         }

        setIsLoading(true);
        try {
            const result = (await createAudioLesson(title, languageId, audioFile, srtFile, tag)) as { title?: string } | null;
            setSuccessMessage(`Audio lesson "${result?.title}" created successfully!`);
            setTitle('');
            setLanguageId(''); // Reset language selection
            setAudioFile(null);
            setSrtFile(null);
            setTag('');
            // Reset file inputs by resetting the form
            event.target.reset();

        } catch (err) {
            setError(`Failed to create audio lesson: ${err.response?.data?.message || err.message || 'Unknown error'}`);
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Container className="mt-4 mb-5" style={{ maxWidth: '700px' }}>
            <Row className="justify-content-center">
                <Col md={10} lg={8}>
                    <h2 className="mb-4 text-center">Create New Audio Lesson</h2>
                    {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
                    {successMessage && <Alert variant="success" onClose={() => setSuccessMessage('')} dismissible>{successMessage}</Alert>}

                    <Form onSubmit={handleSubmit}>
                        <Form.Group className="mb-3" controlId="formLessonTitle">
                            <Form.Label>Lesson Title <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="text"
                                placeholder="Enter lesson title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                required
                                disabled={isLoading}
                            />
                        </Form.Group>

                        <Form.Group className="mb-3" controlId="formLanguage">
                            <Form.Label>Language <span className="text-danger">*</span></Form.Label>
                            <Form.Select
                                value={languageId}
                                onChange={(e) => setLanguageId(e.target.value)}
                                required
                                disabled={isLoading || languages.length === 0}
                                aria-label="Select language"
                            >
                                <option value="" disabled>-- Select Language --</option>
                                {languages.length === 0 && !isLoading && <option disabled>Loading languages...</option>}
                                {languages.map((lang) => (
                                    <option key={lang.languageId} value={lang.languageId}>
                                        {lang.name}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3" controlId="formTag">
                            <Form.Label>Tag (Optional)</Form.Label>
                            <Form.Control
                                type="text"
                                placeholder="Enter a tag (e.g., Beginner, News)"
                                value={tag}
                                onChange={(e) => setTag(e.target.value)}
                                maxLength={100}
                                disabled={isLoading}
                            />
                        </Form.Group>

                        <Form.Group controlId="formAudioFile" className="mb-3">
                            <Form.Label>Audio File <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="file"
                                accept="audio/*"
                                onChange={handleAudioFileChange}
                                required
                                disabled={isLoading}
                            />
                             {audioFile && <Form.Text muted>Selected: {audioFile.name}</Form.Text>}
                        </Form.Group>

                        <Form.Group controlId="formSrtFile" className="mb-3">
                            <Form.Label>SRT Subtitle File <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="file"
                                accept=".srt"
                                onChange={handleSrtFileChange}
                                required
                                disabled={isLoading}
                            />
                            {srtFile && <Form.Text muted>Selected: {srtFile.name}</Form.Text>}
                        </Form.Group>

                        <div className="d-grid">
                            <Button variant="primary" type="submit" disabled={isLoading}>
                                {isLoading ? (
                                    <>
                                        <Spinner
                                            as="span"
                                            animation="border"
                                            size="sm"
                                            role="status"
                                            aria-hidden="true"
                                            className="me-2"
                                        />
                                        Creating...
                                    </>
                                ) : (
                                    'Create Lesson'
                                )}
                            </Button>
                        </div>
                    </Form>
                </Col>
            </Row>
        </Container>
    );
}

export default CreateAudioLesson;