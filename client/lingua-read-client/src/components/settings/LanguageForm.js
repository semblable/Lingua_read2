import React, { useState, useEffect } from 'react';
import { Form, Button, Row, Col, Card, InputGroup, Alert } from 'react-bootstrap';
import { createLanguage, updateLanguage, deleteLanguage } from '../../utils/api'; // <-- Import deleteLanguage

// Initial empty state for a new language
const initialLanguageState = {
    name: '',
    code: '',
    showRomanization: false,
    rightToLeft: false,
    parserType: 'spacedel',
    characterSubstitutions: '',
    splitSentences: '.!?',
    wordCharacters: 'a-zA-Z',
    isActiveForTranslation: false,
    dictionaries: [],
    sentenceSplitExceptions: [],
    deepLTargetCode: '',
    geminiTargetCode: ''
};

function LanguageForm({ language, onSave, onCancel, onDelete }) {
    const [formData, setFormData] = useState(initialLanguageState);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    // Effect to load the passed language data into the form when it changes
    useEffect(() => {
        if (language && language.languageId) {
            // Editing existing language
            setFormData({
                ...initialLanguageState, // Start with defaults
                ...language, // Overwrite with actual data
                // Ensure collections are arrays
                dictionaries: language.dictionaries || [],
                sentenceSplitExceptions: language.sentenceSplitExceptions || [],
                // Handle potential null values from backend for optional fields
                characterSubstitutions: language.characterSubstitutions || '',
                deepLTargetCode: language.deepLTargetCode || '',
                geminiTargetCode: language.geminiTargetCode || '',
            });
        } else {
            // Adding new language or no language selected
            setFormData(initialLanguageState);
        }
        setError(null); // Clear errors when language changes
    }, [language]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    // --- Dictionary Handlers ---
    const handleAddDictionary = () => {
        setFormData(prev => ({
            ...prev,
            dictionaries: [
                ...prev.dictionaries,
                // Add a new dictionary object with default values
                { dictionaryId: 0, purpose: 'terms', displayType: 'popup', urlTemplate: '', isActive: true, sortOrder: prev.dictionaries.length }
            ]
        }));
    };

    const handleRemoveDictionary = (indexToRemove) => {
        setFormData(prev => ({
            ...prev,
            dictionaries: prev.dictionaries.filter((_, index) => index !== indexToRemove)
        }));
    };

    const handleChangeDictionary = (index, field, value, type = 'text') => {
         const newValue = type === 'checkbox' ? !formData.dictionaries[index][field] : value;
         // Special handling for sortOrder to ensure it's a number
         const finalValue = field === 'sortOrder' ? parseInt(newValue, 10) || 0 : newValue;

        setFormData(prev => ({
            ...prev,
            dictionaries: prev.dictionaries.map((dict, i) =>
                i === index ? { ...dict, [field]: finalValue } : dict
            )
        }));
    };

    // --- Sentence Split Exception Handlers ---
    const handleAddException = () => {
        setFormData(prev => ({
            ...prev,
            sentenceSplitExceptions: [
                ...prev.sentenceSplitExceptions,
                // Add a new exception object with default values
                { exceptionId: 0, exceptionString: '' }
            ]
        }));
    };

    const handleRemoveException = (indexToRemove) => {
        setFormData(prev => ({
            ...prev,
            sentenceSplitExceptions: prev.sentenceSplitExceptions.filter((_, index) => index !== indexToRemove)
        }));
    };

     const handleChangeException = (index, value) => {
        setFormData(prev => ({
            ...prev,
            sentenceSplitExceptions: prev.sentenceSplitExceptions.map((ex, i) =>
                i === index ? { ...ex, exceptionString: value } : ex
            )
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setError(null);
        console.log("Submitting form data:", formData);

        try {
            // Prepare payload - ensure collections are included
            const payload = { ...formData };

            if (formData.languageId) {
                // Update existing language
                await updateLanguage(formData.languageId, payload);
            } else {
                // Create new language - remove languageId if present (should be 0 or undefined)
                delete payload.languageId;
                await createLanguage(payload);
            }
            onSave(); // Notify parent component (e.g., to refetch list and clear selection)
        } catch (err) {
            setError(err.message || 'Failed to save language.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = async () => {
        if (formData.languageId && window.confirm(`Are you sure you want to delete the language "${formData.name}"? This cannot be undone.`)) {
            setIsSaving(true); // Use isSaving state to disable buttons during delete
            setError(null);
            try {
                await deleteLanguage(formData.languageId);
                onDelete(formData.languageId); // Notify parent component
            } catch (err) {
                setError(err.message || 'Failed to delete language.');
            } finally {
                setIsSaving(false);
            }
        }
    };


    return (
        <Form onSubmit={handleSubmit}>
            {error && <Alert variant="danger">{error}</Alert>}

            <Row className="mb-3">
                <Form.Group as={Col} controlId="formLanguageName">
                    <Form.Label>Language Name</Form.Label>
                    <Form.Control
                        type="text"
                        placeholder="e.g., French"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                    />
                </Form.Group>

                <Form.Group as={Col} controlId="formLanguageCode">
                    <Form.Label>Language Code</Form.Label>
                    <Form.Control
                        type="text"
                        placeholder="e.g., fr"
                        name="code"
                        value={formData.code}
                        onChange={handleChange}
                        required
                        maxLength={10}
                    />
                </Form.Group>
            </Row>

            <Row className="mb-3">
                 <Form.Group as={Col} controlId="formParserType">
                    <Form.Label>Parser Type</Form.Label>
                    <Form.Select
                        name="parserType"
                        value={formData.parserType}
                        onChange={handleChange}
                    >
                        <option value="spacedel">Space Delimited</option>
                        <option value="mecab">MeCab (Japanese/Korean)</option>
                        <option value="jieba">Jieba (Chinese)</option>
                        {/* Add other parser types as needed */}
                    </Form.Select>
                    <Form.Text muted>Select the word tokenization strategy.</Form.Text>
                </Form.Group>
                 <Form.Group as={Col} controlId="formWordCharacters">
                    <Form.Label>Word Characters (Regex)</Form.Label>
                    <Form.Control
                        type="text"
                        placeholder="e.g., a-zA-ZÀ-Üà-ü'-"
                        name="wordCharacters"
                        value={formData.wordCharacters}
                        onChange={handleChange}
                        required
                    />
                     <Form.Text muted>Regex character class defining valid word characters.</Form.Text>
                </Form.Group>
            </Row>

             <Row className="mb-3">
                <Form.Group as={Col} controlId="formSplitSentences">
                    <Form.Label>Sentence Splitting Characters</Form.Label>
                    <Form.Control
                        type="text"
                        placeholder="e.g., .!?"
                        name="splitSentences"
                        value={formData.splitSentences}
                        onChange={handleChange}
                        required
                    />
                     <Form.Text muted>Characters that mark the end of a sentence.</Form.Text>
                </Form.Group>
                 <Form.Group as={Col} controlId="formCharacterSubstitutions">
                    <Form.Label>Character Substitutions</Form.Label>
                    <Form.Control
                        type="text"
                        placeholder="e.g., ´='|`='|’='|‘='"
                        name="characterSubstitutions"
                        value={formData.characterSubstitutions}
                        onChange={handleChange}
                    />
                     <Form.Text muted>Pipe-separated replacements (e.g., old=new|old2=new2).</Form.Text>
                </Form.Group>
            </Row>

            <Row className="mb-3">
                <Col>
                    <Form.Check
                        type="switch"
                        id="showRomanizationSwitch"
                        label="Show Romanization"
                        name="showRomanization"
                        checked={formData.showRomanization}
                        onChange={handleChange}
                    />
                </Col>
                 <Col>
                    <Form.Check
                        type="switch"
                        id="rightToLeftSwitch"
                        label="Right-to-Left Script"
                        name="rightToLeft"
                        checked={formData.rightToLeft}
                        onChange={handleChange}
                    />
                </Col>
                 <Col>
                    <Form.Check
                        type="switch"
                        id="isActiveForTranslationSwitch"
                        label="Active for Translation"
                        name="isActiveForTranslation"
                        checked={formData.isActiveForTranslation}
                        onChange={handleChange}
                    />
                     <Form.Text muted>Make this language available in translation dropdowns.</Form.Text>
                </Col>
            </Row>

            <Row className="mb-3">
                <Form.Group as={Col} controlId="formDeepLTargetCode">
                    <Form.Label>DeepL Target Code</Form.Label>
                    <Form.Control
                        type="text"
                        placeholder="e.g., EN-US, DE"
                        name="deepLTargetCode"
                        value={formData.deepLTargetCode}
                        onChange={handleChange}
                    />
                    <Form.Text muted>
                        Optional override for DeepL translations when this language is the source. Falls back to global target if empty.
                    </Form.Text>
                </Form.Group>

                <Form.Group as={Col} controlId="formGeminiTargetCode">
                    <Form.Label>Gemini Target Code</Form.Label>
                    <Form.Control
                        type="text"
                        placeholder="e.g., en, de"
                        name="geminiTargetCode"
                        value={formData.geminiTargetCode}
                        onChange={handleChange}
                    />
                    <Form.Text muted>
                        Optional override for Gemini translations when this language is the source. Falls back to global target if empty.
                    </Form.Text>
                </Form.Group>
            </Row>

            <hr />

            {/* --- Dictionary Editor Section --- */}
            <h5 className="mt-4">Dictionaries</h5>
            <p>Configure external dictionary and translation links. Use <code>###</code> as the placeholder for the Looked Up Term/Expression.</p>
            {formData.dictionaries.map((dict, index) => (
                <Card key={index} className="mb-3"> {/* Use index as key for dynamic list */}
                    <Card.Body>
                        <Row>
                            <Col md={2}>
                                <Form.Group controlId={`dictPurpose-${index}`}>
                                    <Form.Label>Purpose</Form.Label>
                                    <Form.Select
                                        name="purpose"
                                        value={dict.purpose}
                                        onChange={(e) => handleChangeDictionary(index, 'purpose', e.target.value)}
                                    >
                                        <option value="terms">Terms</option>
                                        <option value="sentences">Sentences</option>
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                             <Col md={2}>
                                <Form.Group controlId={`dictDisplayType-${index}`}>
                                    <Form.Label>Display</Form.Label>
                                    <Form.Select
                                        name="displayType"
                                        value={dict.displayType}
                                        onChange={(e) => handleChangeDictionary(index, 'displayType', e.target.value)}
                                    >
                                        <option value="popup">Popup</option>
                                        <option value="embedded">Embedded</option>
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                            <Col md={5}>
                                 <Form.Group controlId={`dictUrlTemplate-${index}`}>
                                    <Form.Label>URL Template</Form.Label>
                                    <Form.Control
                                        type="text"
                                        placeholder="e.g., https://example.com/search?q=###"
                                        name="urlTemplate"
                                        value={dict.urlTemplate}
                                        onChange={(e) => handleChangeDictionary(index, 'urlTemplate', e.target.value)}
                                        required
                                    />
                                </Form.Group>
                            </Col>
                             <Col md={1}>
                                 <Form.Group controlId={`dictSortOrder-${index}`}>
                                    <Form.Label>Order</Form.Label>
                                    <Form.Control
                                        type="number"
                                        name="sortOrder"
                                        value={dict.sortOrder}
                                        onChange={(e) => handleChangeDictionary(index, 'sortOrder', e.target.value)}
                                        min="0"
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={1} className="d-flex align-items-end justify-content-center">
                                 <Form.Check
                                    type="switch"
                                    id={`dictIsActive-${index}`}
                                    label="Active"
                                    name="isActive"
                                    checked={dict.isActive}
                                    onChange={(e) => handleChangeDictionary(index, 'isActive', e.target.checked, 'checkbox')}
                                />
                            </Col>
                            <Col md={1} className="d-flex align-items-end">
                                <Button
                                    variant="outline-danger"
                                    size="sm"
                                    onClick={() => handleRemoveDictionary(index)}
                                >
                                    Remove
                                </Button>
                            </Col>
                        </Row>
                    </Card.Body>
                </Card>
            ))}
            <Button variant="outline-secondary" size="sm" onClick={handleAddDictionary}>+ Add Dictionary</Button>


            {/* --- Sentence Split Exceptions Section --- */}
             <h5 className="mt-4">Sentence Split Exceptions</h5>
             <p>Define abbreviations or terms (case-sensitive) that should not end a sentence (e.g., "Dr.", "Mr.").</p>
             {formData.sentenceSplitExceptions.map((ex, index) => (
                 <InputGroup key={index} className="mb-2"> {/* Use index as key */}
                     <Form.Control
                         type="text"
                         placeholder="e.g., Sr."
                         value={ex.exceptionString}
                         onChange={(e) => handleChangeException(index, e.target.value)}
                         maxLength={50} // Match backend model
                     />
                     <Button
                         variant="outline-danger"
                         onClick={() => handleRemoveException(index)}
                     >
                         Remove
                     </Button>
                 </InputGroup>
             ))}
             <Button variant="outline-secondary" size="sm" onClick={handleAddException}>+ Add Exception</Button>

            <hr />

            <div className="mt-4 d-flex justify-content-between">
                <div>
                    <Button variant="primary" type="submit" disabled={isSaving}>
                        {isSaving ? 'Saving...' : (formData.languageId ? 'Update Language' : 'Create Language')}
                    </Button>
                    <Button variant="secondary" onClick={onCancel} className="ms-2" disabled={isSaving}>
                        Cancel
                    </Button>
                </div>
                {formData.languageId && (
                     <Button variant="danger" onClick={handleDeleteClick} disabled={isSaving}>
                        Delete Language
                    </Button>
                )}
            </div>
        </Form>
    );
}

export default LanguageForm;