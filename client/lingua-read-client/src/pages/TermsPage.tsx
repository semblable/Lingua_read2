import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Container, Row, Col, Table, Form, Button, Spinner, Alert, DropdownButton, Dropdown, Pagination, Badge } from 'react-bootstrap'; // Added Pagination, Badge
import { getAllLanguages, getPaginatedWordsByLanguage, exportWordsCsv, addTermsBatch, deleteWord } from '../utils/api'; // Changed to use paginated API
import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import type { Language } from '../utils/api/languages';
import type { Word } from '../utils/api/words';

const TermsPage = () => {
    const [languages, setLanguages] = useState<Language[]>([]);
    const [selectedLanguage, setSelectedLanguage] = useState(() => {
        return localStorage.getItem('lastSelectedLanguage') || '';
    });
    const [terms, setTerms] = useState<Word[]>([]);
    const [statusFilter, setStatusFilter] = useState<number[]>([]);
    const [sortBy, setSortBy] = useState('created_desc');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [deletingWordId, setDeletingWordId] = useState<number | null>(null);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalItems, setTotalItems] = useState(0);
    const pageSize = 20; // Fixed page size for now

    const [importLoading, setImportLoading] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [importSuccess, setImportSuccess] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

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

    // Debounce search term
    useEffect(() => {
        const handler = setTimeout(() => {
            if (searchTerm !== debouncedSearchTerm) {
                setDebouncedSearchTerm(searchTerm);
                setCurrentPage(1); // Reset to page 1 on search change
            }
        }, 500);

        return () => {
            clearTimeout(handler);
        };
    }, [searchTerm, debouncedSearchTerm]);

    // Fetch terms useCallback
    const fetchTerms = useCallback(async () => {
        if (!selectedLanguage) {
            setTerms([]);
            setTotalItems(0);
            setTotalPages(0);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            // Call the new paginated endpoint
            const data = await getPaginatedWordsByLanguage(
                selectedLanguage,
                currentPage,
                pageSize,
                statusFilter,
                sortBy,
                debouncedSearchTerm
            );

            // Access properties from PagedResult
            setTerms(data.items || []);
            setTotalItems(data.totalCount || 0);
            setTotalPages(data.totalPages || 0);

        } catch (err: unknown) {
            setError(`Failed to fetch terms: ${(err as Error)?.message}`);
            console.error(err);
            setTerms([]);
            setTotalItems(0);
            setTotalPages(0);
        } finally {
            setLoading(false);
        }
    }, [selectedLanguage, currentPage, pageSize, statusFilter, sortBy, debouncedSearchTerm]);

    // useEffect to trigger fetchTerms
    useEffect(() => {
        fetchTerms();
    }, [fetchTerms]);

    // Handle language selection change
    const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const langId = e.target.value;
        setSelectedLanguage(langId);
        setCurrentPage(1); // Reset to page 1
        localStorage.setItem('lastSelectedLanguage', langId);
    };

    // Handle status filter change
    const handleStatusFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { value, checked } = e.target;
        const statusValue = parseInt(value, 10);
        setStatusFilter(prev => {
            const newFilter = checked
                ? [...prev, statusValue]
                : prev.filter(s => s !== statusValue);
            return newFilter;
        });
        setCurrentPage(1); // Reset to page 1
    };

    // Handle sorting change
    const handleSort = (column: string) => {
        const isAsc = sortBy === `${column}_asc`;
        setSortBy(isAsc ? `${column}_desc` : `${column}_asc`);
        setCurrentPage(1); // Reset to page 1 optional, but usually good practice on sort change
    };

    // Handle CSV export
    const handleExportCsv = async (applyFilters = false) => {
        if (!selectedLanguage) return;
        setLoading(true);
        setError(null);
        try {
            const filtersToApply = applyFilters ? statusFilter : [];
            const { blob, filename } = await exportWordsCsv(selectedLanguage, filtersToApply);
            saveAs(blob, filename);
        } catch (err: unknown) {
            setError(`Failed to export CSV: ${(err as Error)?.message}`);
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteTerm = async (term: Word) => {
        if (!term?.wordId) return;
        if (!window.confirm(`Delete term "${term.term}"? This will also remove its SRS data and cannot be undone.`)) return;

        setDeletingWordId(term.wordId);
        setError(null);
        try {
            await deleteWord(term.wordId);
            if (terms.length === 1 && currentPage > 1) {
                setCurrentPage(prev => Math.max(prev - 1, 1));
            } else {
                await fetchTerms();
            }
        } catch (err: unknown) {
            setError(`Failed to delete term: ${(err as Error)?.message}`);
            console.error(err);
        } finally {
            setDeletingWordId(null);
        }
    };

    // Handle CSV Import
    const handleImportClick = () => {
        setImportError(null);
        setImportSuccess(null);
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !selectedLanguage) return;

        setImportLoading(true);
        setImportError(null);
        setImportSuccess(null);

        Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const termsToImport: Array<{ term: string; translation: string; status?: number }> = [];
                let parseError: string | null = null;
                const headers = (results.meta.fields ?? []).map((h: string) => h.toLowerCase());
                const hasTerm = headers.includes('term');
                const hasTranslation = headers.includes('translation');
                const hasStatus = headers.includes('status');

                if (!hasTerm) {
                    parseError = "CSV must contain a 'Term' column.";
                } else {
                    results.data.forEach((row, index) => {
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
                            } else if (!parseError) {
                                parseError = `Row ${index + 2}: Invalid 'Status' value "${statusStr}". Must be a number between 1 and 5.`;
                            }
                        }

                        if (term) {
                            const termData: { term: string; translation: string; status?: number } = {
                                term,
                                translation: translation || ''
                            };
                            if (status !== null) termData.status = status;
                            termsToImport.push(termData);
                        } else if (!parseError) {
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
                    const response = (await addTermsBatch(selectedLanguage, termsToImport)) as { message?: string } | null;
                    setImportSuccess(response?.message || `${termsToImport.length} terms processed successfully.`);
                    fetchTerms(); // Refresh the list - will fetch page 1 automatically if we wanted, or stay on current page
                } catch (err: unknown) {
                    setImportError(`Failed to import terms: ${(err as Error)?.message}`);
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
        event.target.value = '';
    };

    const renderSortIndicator = (column: string) => {
        if (sortBy.startsWith(column)) {
            return sortBy.endsWith('_asc') ? ' ▲' : ' ▼';
        }
        return '';
    };

    // Helper for status badge
    const getStatusBadge = (status: number) => {
        const variants: Record<number, string> = {
            1: 'danger',   // New (Red)
            2: 'warning',  // Learning (Orange-ish)
            3: 'info',     // Familiar (Blue)
            4: 'primary',  // Advanced (Blue/Green)
            5: 'success'   // Known (Green)
        };
        const labels: Record<number, string> = {
            1: 'New', 2: 'Learning', 3: 'Familiar', 4: 'Advanced', 5: 'Known'
        };
        return <Badge bg={variants[status] || 'secondary'}>{labels[status] || status}</Badge>;
    };

    // Pagination Component
    const renderPagination = () => {
        if (totalPages <= 1) return null;

        let items = [];
        const maxPagesToShow = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

        if (endPage - startPage + 1 < maxPagesToShow) {
            startPage = Math.max(1, endPage - maxPagesToShow + 1);
        }

        // First Page
        if (startPage > 1) {
            items.push(<Pagination.First key="first" onClick={() => setCurrentPage(1)} />);
            items.push(<Pagination.Prev key="prev" onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} />);
        }

        // Ellipsis start
        if (startPage > 1) {
            items.push(<Pagination.Ellipsis key="ellipsis-start" disabled />);
        }

        // Page Numbers
        for (let number = startPage; number <= endPage; number++) {
            items.push(
                <Pagination.Item key={number} active={number === currentPage} onClick={() => setCurrentPage(number)}>
                    {number}
                </Pagination.Item>,
            );
        }

        // Ellipsis end
        if (endPage < totalPages) {
            items.push(<Pagination.Ellipsis key="ellipsis-end" disabled />);
        }

        // Last Page
        if (endPage < totalPages) {
            items.push(<Pagination.Next key="next" onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} />);
            items.push(<Pagination.Last key="last" onClick={() => setCurrentPage(totalPages)} />);
        }

        return (
            <div className="d-flex justify-content-between align-items-center mt-3">
                <div>
                    Showing {Math.min((currentPage - 1) * pageSize + 1, totalItems)} to {Math.min(currentPage * pageSize, totalItems)} of {totalItems} terms
                </div>
                <Pagination size="sm" className="mb-0">{items}</Pagination>
            </div>
        );
    };


    return (
        <Container fluid className="mt-4">
            <h2>My Terms</h2>
            <hr />

            <Row className="mb-3 align-items-end g-2">
                <Col md={3} xs={12} sm={6}>
                    <Form.Group controlId="languageSelect">
                        <Form.Label>Language</Form.Label>
                        <Form.Select
                            value={selectedLanguage}
                            onChange={handleLanguageChange}
                            disabled={(loading && terms.length === 0) || languages.length === 0}
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
                <Col md={3} xs={12} sm={6}>
                    <Form.Group>
                        <Form.Label>Status Filter</Form.Label>
                        <div>
                            {[1, 2, 3, 4, 5].map(status => (
                                <Form.Check
                                    key={status}
                                    inline
                                    type="checkbox"
                                    id={`status-${status}`}
                                    label={`${status}`}
                                    value={status}
                                    checked={statusFilter.includes(status)}
                                    onChange={handleStatusFilterChange}
                                    disabled={loading || !selectedLanguage || importLoading}
                                />
                            ))}
                        </div>
                    </Form.Group>
                </Col>
                <Col md={2} xs={12} sm={6}>
                    <Form.Group controlId="searchTerm">
                        <Form.Label>Search</Form.Label>
                        <Form.Control
                            type="text"
                            placeholder="Term or Translation..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            disabled={(loading && terms.length === 0) || !selectedLanguage || importLoading}
                        />
                    </Form.Group>
                </Col>
                <Col md={4} xs={12} sm={6} className="text-sm-end mt-2 mt-sm-0 d-flex justify-content-start justify-content-sm-end align-items-end gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                        accept=".csv"
                    />
                    <Button
                        variant="success"
                        onClick={handleImportClick}
                        disabled={loading || !selectedLanguage || importLoading}
                        title={!selectedLanguage ? "Select a language first" : "Import terms from CSV"}
                    >
                        {importLoading ? <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" /> : 'Import CSV'}
                    </Button>
                    <DropdownButton
                        id="export-dropdown"
                        title="Export CSV"
                        variant="secondary"
                        disabled={loading || !selectedLanguage || terms.length === 0 || importLoading}
                    >
                        <Dropdown.Item onClick={() => handleExportCsv(true)} disabled={statusFilter.length === 0}>
                            Export Filtered
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleExportCsv(false)}>
                            Export All for Language
                        </Dropdown.Item>
                    </DropdownButton>
                </Col>
            </Row>

            {loading && terms.length === 0 && ( /* Only show full spinner if no data yet or language switching */
                <div className="text-center my-4">
                    <Spinner animation="border" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </Spinner>
                </div>
            )}

            {error && <Alert variant="danger" className="my-2">{error}</Alert>}
            {importError && <Alert variant="danger" className="my-2">Import Error: {importError}</Alert>}
            {importSuccess && <Alert variant="success" className="my-2">{importSuccess}</Alert>}

            {!loading && !error && selectedLanguage && (
                <>
                    <div style={{ minHeight: '400px', position: 'relative' }}>
                        {loading && ( /* Overlay spinner for updates */
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.6)', zIndex: 10, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                <Spinner animation="border" size="sm" />
                            </div>
                        )}
                        <Table striped bordered hover responsive size="sm">
                            <thead>
                                <tr>
                                    <th onClick={() => handleSort('term')} style={{ cursor: 'pointer' }}>
                                        Term{renderSortIndicator('term')}
                                    </th>
                                    <th>Translation</th>
                                    <th onClick={() => handleSort('status')} style={{ cursor: 'pointer', width: '120px' }}>
                                        Status{renderSortIndicator('status')}
                                    </th>
                                    <th onClick={() => handleSort('created')} style={{ cursor: 'pointer', width: '180px' }}>
                                        Date Added{renderSortIndicator('created')}
                                    </th>
                                    <th style={{ width: '100px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {terms.length > 0 ? (
                                    terms.map(term => (
                                        <tr key={term.wordId}>
                                            <td>{term.term}</td>
                                            <td>{term.translation}</td>
                                            <td className="text-center">{getStatusBadge(term.status ?? 0)}</td>
                                            <td>{term.createdAt ? new Date(term.createdAt).toLocaleString() : ''}</td>
                                            <td className="text-center">
                                                <Button
                                                    variant="outline-danger"
                                                    size="sm"
                                                    onClick={() => handleDeleteTerm(term)}
                                                    disabled={deletingWordId === term.wordId || importLoading}
                                                >
                                                    {deletingWordId === term.wordId ? 'Deleting...' : 'Delete'}
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="text-center">No terms found for the selected criteria.</td>
                                    </tr>
                                )}
                            </tbody>
                        </Table>
                    </div>
                    {renderPagination()}
                </>
            )}
            {!loading && !error && !selectedLanguage && languages.length > 0 && !importLoading && (
                <Alert variant="info">Please select a language to view terms.</Alert>
            )}
            {!loading && !error && languages.length === 0 && !error && !importLoading && (
                <Alert variant="warning">No languages found. Please add languages in settings.</Alert>
            )}

        </Container>
    );
};

export default TermsPage;