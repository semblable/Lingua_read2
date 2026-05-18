import React, { useState, useEffect, useCallback } from 'react';
import { Container, Row, Col, Button, ListGroup, Card, Spinner, Alert } from 'react-bootstrap';
import LanguageForm from './LanguageForm';
import { getAllLanguages, deleteLanguage } from '../../utils/api';
import type { Language } from '../../utils/api/languages';

function LanguagesPage() {
    const [languages, setLanguages] = useState<Language[]>([]);
    const [isLoading, setIsLoading] = useState(true); // Start loading initially
    const [error, setError] = useState<string | null>(null);
    const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(null); // To hold the language being edited/viewed

    // Function to fetch languages
    const fetchLanguages = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getAllLanguages();
            setLanguages(data || []); // Ensure languages is always an array
        } catch (err: unknown) {
            setError((err as Error)?.message || 'Failed to fetch languages.');
            setLanguages([]); // Clear languages on error
        } finally {
            setIsLoading(false);
        }
    }, []); // No dependencies, fetch once on mount or when called manually

    useEffect(() => {
        fetchLanguages();
        // Example:
        // fetchLanguages();
    }, [fetchLanguages]); // Depend on fetchLanguages callback

    // --- Handlers for LanguageForm ---
    const handleSave = () => {
        setSelectedLanguage(null);
        fetchLanguages();
    };

    const handleCancel = () => {
        setSelectedLanguage(null);
    };

    const handleDelete = async (languageId: number) => {
        try {
            await deleteLanguage(languageId);
            handleSave();
        } catch (err: unknown) {
            setError((err as Error)?.message || 'Failed to delete language.');
        }
    };

    const handleResetContent = () => {
        fetchLanguages();
    };

    return (
        <Container fluid className="mt-4">
            <Row>
                <Col>
                    <h2>Manage Languages</h2>
                    <p>Configure language settings, dictionaries, parsing rules, and translation availability.</p>
                    {isLoading && <Spinner animation="border" role="status"><span className="visually-hidden">Loading...</span></Spinner>}
                    {error && <Alert variant="danger">{error}</Alert>}
                    <hr />

                    <Row>
                        <Col md={4}>
                            <h4>Available Languages</h4>
                            {!isLoading && !error && (
                                <ListGroup>
                                    {languages.length > 0 ? languages.map(lang => (
                                        <ListGroup.Item
                                            key={lang.languageId}
                                            action
                                            active={selectedLanguage?.languageId === lang.languageId}
                                            onClick={() => setSelectedLanguage(lang)}
                                        >
                                            {lang.name} ({lang.code})
                                        </ListGroup.Item>
                                    )) : (
                                        <ListGroup.Item disabled>No languages found.</ListGroup.Item>
                                    )}
                                </ListGroup>
                            )}
                            <Button variant="primary" className="mt-3" onClick={() => setSelectedLanguage({} as Language)}>Add New Language</Button>
                        </Col>
                        <Col md={8}>
                            <> {/* Start React Fragment */}
                                <h4>Language Details</h4>
                            {selectedLanguage ?
                                <LanguageForm
                                    key={selectedLanguage.languageId || 'new'} // Add key to force re-render on selection change
                                    language={selectedLanguage}
                                    onSave={handleSave}
                                    onCancel={handleCancel}
                                    onDelete={handleDelete} // Pass the delete handler
                                    onResetContent={handleResetContent}
                                />
                            :
                                <Card>
                                    <Card.Body>
                                        <Card.Text>
                                            Select a language from the list to edit its details, or click "Add New Language".
                                        </Card.Text>
                                </Card.Body>
                            </Card>}
                            </> {/* End React Fragment */}
                        </Col>
                    </Row>
                </Col>
            </Row>
        </Container>
    );
}

export default LanguagesPage;