import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Container, Row, Col, Table, Form, Button, Spinner, Alert, DropdownButton, Dropdown } from 'react-bootstrap'; // Added DropdownButton, Dropdown
import { getAllLanguages, getWordsByLanguage, exportWordsCsv, addTermsBatch } from '../utils/api'; // Import API functions, added addTermsBatch
import { saveAs } from 'file-saver'; // For triggering file download
import Papa from 'papaparse'; // For CSV parsing
// Removed duplicate useRef import

const TermsPage = () => {
    const [languages, setLanguages] = useState([]);
    const [selectedLanguage, setSelectedLanguage] = useState(() => {
        // Initialize from localStorage if available
        return localStorage.getItem('lastSelectedLanguage') || '';
    });
    const [terms, setTerms] = useState([]);
    const [statusFilter, setStatusFilter] = useState([]); // Array of selected statuses (e.g., [1, 5])
    const [sortBy, setSortBy] = useState('created_desc'); // Default sort: newest first
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [importLoading, setImportLoading] = useState(false);
    const [importError, setImportError] = useState(null);
    const [importSuccess, setImportSuccess] = useState(null);
    const fileInputRef = useRef(null);

    // Fetch languages on component mount
    useEffect(() => {
        const fetchLanguages = async () => {
            try {
                setError(null);
                const data = await getAllLanguages();
                setLanguages(data || []);
            } catch (err) {
                setError('Failed to fetch languages. Please try again later.');
                console.error(err);
            }
        };
        fetchLanguages();
    }, []);

    // Fetch terms when selectedLanguage, statusFilter, or sortBy changes

    // Debounce search term
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 500); // 500ms delay

        return () => {
            clearTimeout(handler);
        };
    }, [searchTerm]);

    // Fetch terms useCallback
    const fetchTerms = useCallback(async () => {
        if (!selectedLanguage) {
            setTerms([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const data = await getWordsByLanguage(selectedLanguage, statusFilter, sortBy, debouncedSearchTerm);
            setTerms(data || []);
        } catch (err) {
            setError(`Failed to fetch terms: ${err.message}`);
            console.error(err);
            setTerms([]);
        } finally {
            setLoading(false);
        }
    }, [selectedLanguage, statusFilter, sortBy, debouncedSearchTerm]); // Include debouncedSearchTerm

    // useEffect to trigger fetchTerms
    useEffect(() => {
        fetchTerms();
    }, [fetchTerms]);

    // Handle language selection change
    const handleLanguageChange = (e) => {
        const langId = e.target.value;
        setSelectedLanguage(langId);
        localStorage.setItem('lastSelectedLanguage', langId);
        // Reset filters/sort when language changes? Optional, but can be good UX.
        // setStatusFilter([]);
        // setSortBy('term_asc');
    };

    // Handle status filter change (from checkboxes)
    const handleStatusFilterChange = (e) => {
        const { value, checked } = e.target;
        const statusValue = parseInt(value, 10);
        setStatusFilter(prev =>
            checked
                ? [...prev, statusValue] // Add status to filter
                : prev.filter(s => s !== statusValue) // Remove status from filter
        );
    };

    // Handle sorting change (e.g., clicking table headers)
    const handleSort = (column) => {
        const isAsc = sortBy === `${column}_asc`;
        setSortBy(isAsc ? `${column}_desc` : `${column}_asc`);
    };

    // Handle CSV export (takes a boolean to determine if filters should be applied)
    const handleExportCsv = async (applyFilters = false) => {
        if (!selectedLanguage) return;
        setLoading(true);
        setError(null);
        try {
            // Pass language and optionally status filters
            const filtersToApply = applyFilters ? statusFilter : [];
            const { blob, filename } = await exportWordsCsv(selectedLanguage, filtersToApply);
            saveAs(blob, filename);
        } catch (err) {
            setError(`Failed to export CSV: ${err.message}`);
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // Handle CSV Import
    const handleImportClick = () => {
        // Reset messages and trigger file input
        setImportError(null);
        setImportSuccess(null);
        fileInputRef.current?.click();
    };

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (!file || !selectedLanguage) {
            return;
        }

        setImportLoading(true);
        setImportError(null);
        setImportSuccess(null);

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const termsToImport = [];
                let parseError = null;

                // Check for required columns (case-insensitive) and optional status
                const headers = results.meta.fields.map(h => h.toLowerCase());
                const hasTerm = headers.includes('term');
                const hasTranslation = headers.includes('translation');
                const hasStatus = headers.includes('status');

                if (!hasTerm) { // Term is mandatory
                    parseError = "CSV must contain a 'Term' column.";
                } else {
                    results.data.forEach((row, index) => {
                        // Find keys case-insensitively
                        const termKey = Object.keys(row).find(k => k.toLowerCase() === 'term');
                        const translationKey = hasTranslation ? Object.keys(row).find(k => k.toLowerCase() === 'translation') : null;
                        const statusKey = hasStatus ? Object.keys(row).find(k => k.toLowerCase() === 'status') : null;

                        const term = termKey ? row[termKey]?.trim() : null;
                        const translation = translationKey ? row[translationKey]?.trim() : null;
                        const statusStr = statusKey ? row[statusKey]?.trim() : null;
                        let status = null;

                        if (statusStr) {
                            const parsedStatus = parseInt(statusStr, 10);
                            if (!isNaN(parsedStatus) && parsedStatus >= 1 && parsedStatus <= 5) {
                                status = parsedStatus;
                            } else if (!parseError) { // Report first status error only
                                parseError = `Row ${index + 2}: Invalid 'Status' value "${statusStr}". Must be a number between 1 and 5.`;
                            }
                        }

                        if (term) { // Term is required
                            const termData = { term, translation: translation || '' };
                            if (status !== null) {
                                termData.status = status; // Add status only if valid and provided
                            }
                            termsToImport.push(termData);
                        } else if (!parseError) { // Report first term error only
                            parseError = `Row ${index + 2}: 'Term' column is missing or empty.`;
                        }
                    });
                }

                if (parseError) {
                    setImportError(parseError);
                    setImportLoading(false);
                    return;
                }

                if (termsToImport.length === 0) {
                    setImportError("No valid terms found in the CSV file.");
                    setImportLoading(false);
                    return;
                }

                try {
                    const response = await addTermsBatch(selectedLanguage, termsToImport);
                    setImportSuccess(response.message || `${termsToImport.length} terms processed successfully.`);
                    fetchTerms(); // Refresh the list after import
                } catch (err) {
                    setImportError(`Failed to import terms: ${err.message}`);
                    console.error(err);
                } finally {
                    setImportLoading(false);
                }
            },
            error: (error) => {
                setImportError(`CSV parsing error: ${error.message}`);
                setImportLoading(false);
            }
        });

        // Reset file input value to allow re-uploading the same file
        event.target.value = null;
    };

    // Helper to render sort indicators
    const renderSortIndicator = (column) => {
        if (sortBy.startsWith(column)) {
            return sortBy.endsWith('_asc') ? ' ▲' : ' ▼';
        }
        return '';
    };

    return (
        <Container fluid className="mt-4">
            <h2>My Terms</h2>
            <hr />


            <Row className="mb-3 align-items-end g-2"> {/* Use g-2 for gutters */}
                <Col md={3} xs={12} sm={6}> {/* Language Select */}
                    <Form.Group controlId="languageSelect">
                        <Form.Label>Language</Form.Label>
                        <Form.Select
                            value={selectedLanguage}
                            onChange={handleLanguageChange}
                            disabled={loading || languages.length === 0}
                        >
                            <option value="">-- Select Language --</option>
                            {languages.map(lang => (
                                <option key={lang.languageId} value={lang.languageId}>
                                    {lang.name}
                                </option>
                            ))}
                        </Form.Select>
                    </Form.Group>
                </Col>
                <Col md={3} xs={12} sm={6}> {/* Status Filter */}
                    <Form.Group>
                        <Form.Label>Status Filter</Form.Label>
                        <div>
                            {[1, 2, 3, 4, 5].map(status => (
                                <Form.Check
                                    key={status}
                                    inline
                                    type="checkbox"
                                    id={`status-${status}`}
                                    label={`${status}`} // Shorten label
                                    value={status}
                                    checked={statusFilter.includes(status)}
                                    onChange={handleStatusFilterChange}
                                    disabled={loading || !selectedLanguage || importLoading}
                                />
                            ))}
                        </div>
                    </Form.Group>
                </Col>
                <Col md={2} xs={12} sm={6}> {/* Search Input */}
                    <Form.Group controlId="searchTerm">
                        <Form.Label>Search</Form.Label>
                        <Form.Control
                            type="text"
                            placeholder="Term or Translation..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            disabled={loading || !selectedLanguage || importLoading}
                        />
                    </Form.Group>
                </Col>
                <Col md={4} xs={12} sm={6} className="text-sm-end mt-2 mt-sm-0 d-flex justify-content-start justify-content-sm-end align-items-end gap-2"> {/* Actions */}
                    {/* Hidden File Input */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                        accept=".csv"
                    />
                    {/* Import Button */}
                    <Button
                        variant="success"
                        onClick={handleImportClick}
                        disabled={loading || !selectedLanguage || importLoading}
                        title={!selectedLanguage ? "Select a language first" : "Import terms from CSV"}
                    >
                        {importLoading ? <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" /> : 'Import CSV'}
                    </Button>
                    {/* Export Dropdown */}
                    <DropdownButton
                        id="export-dropdown"
                        title="Export CSV"
                        variant="secondary"
                        disabled={loading || !selectedLanguage || terms.length === 0 || importLoading}
                        >
                        <Dropdown.Item onClick={() => handleExportCsv(true)} disabled={statusFilter.length === 0}>
                            Export Filtered ({statusFilter.length > 0 ? terms.length : '0'})
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleExportCsv(false)}>
                            Export All for Language
                        </Dropdown.Item>
                    </DropdownButton>
                </Col>
            </Row>

            {/* Loading and Error Display */}
            {loading && (
                <div className="text-center my-4">
                    <Spinner animation="border" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </Spinner>
                </div>
            )}
            {error && <Alert variant="danger" className="my-2">{error}</Alert>}
            {importError && <Alert variant="danger" className="my-2">Import Error: {importError}</Alert>}
            {importSuccess && <Alert variant="success" className="my-2">{importSuccess}</Alert>}

            {/* Terms Table */}
            {!loading && !error && selectedLanguage && (
                 <Table striped bordered hover responsive size="sm">
                    <thead>
                        <tr>
                            <th onClick={() => handleSort('term')} style={{ cursor: 'pointer' }}>
                                Term{renderSortIndicator('term')}
                            </th>
                            <th>Translation</th>
                            <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                                Status{renderSortIndicator('status')}
                            </th>
                            <th onClick={() => handleSort('created')} style={{ cursor: 'pointer' }}>
                                Date Added{renderSortIndicator('created')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {terms.length > 0 ? (
                            terms.map(term => (
                                <tr key={term.wordId}>
                                    <td>{term.term}</td>
                                    <td>{term.translation}</td>
                                    <td>{term.status}</td>
                                    <td>{new Date(term.createdAt).toLocaleString()}</td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan="3" className="text-center">No terms found for the selected criteria.</td>
                            </tr>
                        )}
                    </tbody>
                </Table>
            )}
             {!loading && !error && !selectedLanguage && languages.length > 0 && !importLoading && (
                 <Alert variant="info">Please select a language to view terms.</Alert>
             )}
             {!loading && !error && languages.length === 0 && !error && !importLoading && ( // Show if languages finished loading but none exist
                 <Alert variant="warning">No languages found. Please add languages in settings.</Alert>
             )}

        </Container>
    );
};

export default TermsPage;