import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import LanguageForm from './LanguageForm';
import LanguageFlag from './LanguageFlag';
import { getAllLanguages, createLanguage } from '../../utils/api';
import type { Language } from '../../utils/api/languages';
import { LANGUAGE_PRESETS, baseLanguageCode, languagePresetInput, type LanguagePreset } from '../../utils/languagePresets';
import './LanguagesPage.css';

const searchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function LanguagesPage() {
    const [languages, setLanguages] = useState<Language[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(null);
    const [query, setQuery] = useState('');
    const [onlyAvailable, setOnlyAvailable] = useState(false);
    const [addingCode, setAddingCode] = useState<string | null>(null);
    const addInFlight = useRef(false);
    const searchInput = useRef<HTMLInputElement>(null);

    const fetchLanguages = useCallback(async () => {
        setIsLoading(true);
        setLoadFailed(false);
        setError(null);
        try {
            setLanguages(await getAllLanguages() || []);
        } catch (err: unknown) {
            setLoadFailed(true);
            setError((err as Error)?.message || 'Failed to fetch languages. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { void fetchLanguages(); }, [fetchLanguages]);

    const handleSave = () => {
        setSelectedLanguage(null);
        void fetchLanguages();
    };

    const configuredCodes = new Set(languages.map(language => baseLanguageCode(language.code)));
    const normalizedQuery = searchText(query.trim());
    const filteredPresets = LANGUAGE_PRESETS.filter(preset =>
        (!onlyAvailable || !configuredCodes.has(preset.code)) &&
        searchText(`${preset.name} ${preset.nativeName} ${preset.code} ${preset.country}`).includes(normalizedQuery)
    );

    const handleAdd = async (preset: LanguagePreset) => {
        if (addInFlight.current || configuredCodes.has(preset.code)) return;
        addInFlight.current = true;
        setAddingCode(preset.code);
        setError(null);
        setNotice(null);
        try {
            const created = await createLanguage(languagePresetInput(preset));
            setLanguages(previous => [...previous, created].sort((a, b) => a.name.localeCompare(b.name)));
            setNotice(`${preset.name} added. You can now choose it when importing or creating a text.`);
        } catch (err: unknown) {
            setError((err as Error)?.message || `Could not add ${preset.name}. Please try again.`);
        } finally {
            addInFlight.current = false;
            setAddingCode(null);
        }
    };

    const showCatalog = () => {
        setSelectedLanguage(null);
        requestAnimationFrame(() => searchInput.current?.focus());
    };

    return (
        <main className="languages-page">
            <header className="languages-page-header">
                <div className="languages-page-icon" aria-hidden="true"><i className="bi bi-globe2" /></div>
                <div>
                    <h1>Make room for another language.</h1>
                    <p>Choose what you want to read. Add a language when you need it, with the settings ready to go.</p>
                </div>
            </header>

            <div role="status" aria-live="polite">
                {notice && <Alert variant="success" dismissible onClose={() => setNotice(null)}>{notice}</Alert>}
            </div>
            {error && <Alert variant="danger">{error}{loadFailed && <Button variant="link" onClick={fetchLanguages}>Try again</Button>}</Alert>}

            <div className="languages-layout">
                <aside className="languages-sidebar" aria-label="Configured languages">
                    <div className="languages-section-heading">
                        <h2>Your languages</h2><span className="languages-count">{languages.length}</span>
                    </div>
                    <p className="languages-muted languages-sidebar-hint">Select one to adjust its settings.</p>
                    {isLoading ? (
                        <div className="languages-loading" role="status"><Spinner animation="border" size="sm" /><span>Loading languages…</span></div>
                    ) : languages.length ? (
                        <div className="languages-installed">
                            {languages.map(language => (
                                <button
                                    type="button"
                                    className={`language-installed${selectedLanguage?.languageId === language.languageId ? ' is-selected' : ''}`}
                                    key={language.languageId}
                                    onClick={() => setSelectedLanguage(language)}
                                    aria-pressed={selectedLanguage?.languageId === language.languageId}
                                >
                                    <LanguageFlag code={language.code} />
                                    <span className="language-installed-name">{language.name}<small>{language.code}</small></span>
                                    <i className="bi bi-chevron-right" aria-hidden="true" />
                                </button>
                            ))}
                        </div>
                    ) : <p className="languages-empty-sidebar">Your next chapter starts here. Pick a language from the catalog.</p>}
                    <button type="button" className="languages-browse-button" onClick={showCatalog}>
                        <i className="bi bi-plus-lg" aria-hidden="true" /> Browse languages
                    </button>
                </aside>

                <section className="languages-content" aria-label={selectedLanguage ? 'Language details' : 'Language catalog'}>
                    {selectedLanguage ? (
                        <>
                            <button type="button" className="languages-back" onClick={showCatalog}><i className="bi bi-arrow-left" aria-hidden="true" /> Back to languages</button>
                            <h2 className="languages-editor-title">{selectedLanguage.languageId ? `${selectedLanguage.name} settings` : 'Custom language'}</h2>
                            <LanguageForm
                                key={selectedLanguage.languageId || 'new'}
                                language={selectedLanguage}
                                onSave={handleSave}
                                onCancel={showCatalog}
                                onDelete={handleSave}
                                onResetContent={() => { void fetchLanguages(); }}
                            />
                        </>
                    ) : (
                        <>
                            <div className="languages-catalog-heading">
                                <div><h2>Add a language</h2><p className="languages-muted">A little curiosity goes a long way.</p></div>
                                <span className="languages-catalog-total">{LANGUAGE_PRESETS.length} to explore</span>
                            </div>
                            <div className="languages-search">
                                <i className="bi bi-search" aria-hidden="true" />
                                <Form.Control
                                    ref={searchInput}
                                    type="search"
                                    aria-label="Search languages"
                                    placeholder="Search by language, native name or country…"
                                    value={query}
                                    onChange={event => setQuery(event.target.value)}
                                />
                            </div>
                            <div className="languages-catalog-tools">
                                <span className="languages-muted" aria-live="polite">{filteredPresets.length} {filteredPresets.length === 1 ? 'language' : 'languages'}</span>
                                <Form.Check type="switch" role="switch" id="languages-not-added" label="Only show languages to add" checked={onlyAvailable} onChange={event => setOnlyAvailable(event.target.checked)} />
                            </div>
                            <div className="languages-catalog-grid" aria-busy={addingCode !== null}>
                                {filteredPresets.map(preset => {
                                    const added = configuredCodes.has(preset.code);
                                    const adding = addingCode === preset.code;
                                    return (
                                        <div className={`language-option${added ? ' is-added' : ''}`} key={preset.code}>
                                            <LanguageFlag code={preset.code} />
                                            <div className="language-option-name">
                                                <h3>{preset.name}</h3>
                                                <span className="language-native-name" lang={preset.code} dir="auto">{preset.nativeName}</span>
                                                {preset.limitedWordSplitting && <span className="language-splitting-note">Basic word splitting*</span>}
                                            </div>
                                            <button
                                                type="button"
                                                className={`language-add-button${added ? ' is-added' : ''}`}
                                                disabled={added || isLoading || loadFailed || addingCode !== null}
                                                aria-label={added ? `${preset.name} already added` : `Add ${preset.name}`}
                                                aria-describedby={preset.limitedWordSplitting ? 'languages-segmentation-help' : undefined}
                                                onClick={() => { void handleAdd(preset); }}
                                            >
                                                {adding ? <Spinner animation="border" size="sm" /> : <i className={`bi bi-${added ? 'check-lg' : 'plus-lg'}`} aria-hidden="true" />}
                                                <span>{adding ? 'Adding…' : added ? 'Added' : 'Add'}</span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                            {!filteredPresets.length && (
                                <div className="languages-no-results">
                                    <i className="bi bi-search" aria-hidden="true" />
                                    <h3>{query ? 'No languages found' : 'You’ve added every language here'}</h3>
                                    <p className="languages-muted">{query ? 'Try a different name, or set up a custom language below.' : 'You can still set up a custom language below.'}</p>
                                    {query && <Button variant="outline-secondary" size="sm" onClick={() => setQuery('')}>Clear search</Button>}
                                </div>
                            )}
                            <p className="languages-segmentation-help" id="languages-segmentation-help">* Chinese, Japanese and Thai currently split at spaces and punctuation. Text without spaces is treated as one word.</p>
                            <div className="languages-custom">
                                <div><h3>Looking for something else?</h3><p className="languages-muted">Add any language and fine-tune dictionaries, script and reading settings.</p></div>
                                <Button variant="outline-secondary" onClick={() => setSelectedLanguage({} as Language)} disabled={isLoading || loadFailed || addingCode !== null}>Set up a custom language <i className="bi bi-arrow-right" aria-hidden="true" /></Button>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </main>
    );
}

export default LanguagesPage;
