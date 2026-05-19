import React, { useState, useEffect, useContext } from 'react'; // Added useContext
import { Container, Form, Button, Card, Alert, Spinner, ListGroup, ProgressBar } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { getAllLanguages, createAudioLessonsBatch } from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext'; // Import SettingsContext
import type { Language } from '../utils/api/languages';

type BatchAudioResults = {
    createdCount?: number;
    skippedFiles?: string[];
};

const BatchAudioCreate = () => {
    const [languageId, setLanguageId] = useState('');
    const [tag, setTag] = useState('');
    const [files, setFiles] = useState<FileList | null>(null); // Holds FileList object
    const [languages, setLanguages] = useState<Language[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingLanguages, setLoadingLanguages] = useState(true);
    const [error, setError] = useState('');
    const [uploadProgress, setUploadProgress] = useState(0); // Basic progress state (can be enhanced)
    const [results, setResults] = useState<BatchAudioResults | null>(null);
    const navigate = useNavigate();
    const { settings: userSettings } = useContext(SettingsContext); // Get settings from context

    // Fetch languages on component mount
    useEffect(() => {
        const fetchLanguages = async () => {
            setLoadingLanguages(true);
            try {
                const data = await getAllLanguages();
                setLanguages(data || []);

                // Use default language from context if available and valid
                const defaultLangId = userSettings?.defaultLanguageId;

                if (data.length > 0) {
                    const found = data.find(l => l.languageId === defaultLangId);
                    if (found && found.languageId != null) {
                        setLanguageId(found.languageId.toString());
                    } else if (data[0].languageId != null) {
                        // Fallback to first language if default not found or not set
                        setLanguageId(data[0].languageId.toString());
                    }
                }
            } catch (err) {
                setError('Failed to load languages.');
                console.error(err);
            } finally {
                setLoadingLanguages(false);
            }
        };
        fetchLanguages();
        // Re-run if userSettings context changes
    }, [userSettings?.defaultLanguageId]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setFiles(event.target.files); // Store the FileList
        setResults(null); // Clear previous results when files change
        setError('');
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError('');
        setResults(null);
        setUploadProgress(0);

        if (!languageId) {
            setError('Please select a language.');
            return;
        }
        if (!files || files.length === 0) {
            setError('Please select files to upload.');
            return;
        }

        // --- Start: Fuzzy Pairing Validation using Normalization (with Debugging) ---
        const fileList = Array.from(files).sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );
        const mp3Files = fileList.filter(f => f.name.toLowerCase().endsWith('.mp3'));
        const srtFiles = fileList.filter(f => f.name.toLowerCase().endsWith('.srt'));

        // Function to normalize base names: trim whitespace/punctuation, convert to lowercase
        const normalizeBaseName = (name: string | null | undefined): string => {
            if (!name) return '';
            // Normalize unicode and strip extension if present
            let base = name.normalize('NFKC').replace(/\.(mp3|srt)$/i, '');
            // Trim whitespace and collapse repeated spaces
            base = base.trim().replace(/\s+/g, ' ');
            // Trim trailing dots/underscores/dashes/spaces repeatedly (iteratively to handle mixed cases)
            while (/[._\-\s]+$/.test(base)) {
                base = base.replace(/[._\-\s]+$/, '');
            }
            return base.toLowerCase();
        };

        // Function to extract base name and lang from SRT with flexible suffix patterns
        interface SrtInfo {
            baseName?: string;
            lang?: string;
            originalFullName: string;
            error?: string;
        }
        const extractSrtInfo = (srtFileName: string): SrtInfo => {
            const patterns = [
                /^(.+?)__([a-z]{2,3})(?:[-_]?([a-z]{2}))?\.srt$/i, // base__fr or base__fr-CA
                /^(.+?)_([a-z]{2,3})(?:[-_]?([a-z]{2}))?\.srt$/i,  // base_fr or base_fr_CA
                /^(.+?)[ -]([a-z]{2,3})(?:[-_]?([a-z]{2}))?\.srt$/i, // base fr or base-fr
                /^(.+?)\.([a-z]{2,3})(?:[-_]?([a-z]{2}))?\.srt$/i  // base.fr or base.fr-CA
            ];

            for (const pattern of patterns) {
                const match = srtFileName.match(pattern);
                if (match) {
                    return {
                        baseName: match[1].trim(), // Trim whitespace from base name
                        lang: match[2].toLowerCase(),
                        originalFullName: srtFileName
                    };
                }
            }

            // If none matched, it's an invalid format
            return { error: 'Invalid Format (expected base + lang suffix like __fr, _fr, -fr, .fr)', originalFullName: srtFileName };
        };

        type SrtFileEntry = SrtInfo & { file: File };
        const mp3sByNormalizedBase = new Map<string, File[]>();
        const srtsByNormalizedBase = new Map<string, SrtFileEntry[]>();
        const problematicFiles = new Map<string, Set<string>>(); // Store problems: fileName -> Set<reason>

        const addProblem = (fileName: string, reason: string) => {
            if (!problematicFiles.has(fileName)) problematicFiles.set(fileName, new Set());
            problematicFiles.get(fileName)!.add(reason);
        };

        // 1. Process and Normalize MP3s
        mp3Files.forEach(mp3File => {
            const rawBaseName = mp3File.name.replace(/\.mp3$/i, '').trim(); // Trim whitespace
            const normalized = normalizeBaseName(rawBaseName);
            if (!mp3sByNormalizedBase.has(normalized)) mp3sByNormalizedBase.set(normalized, []);
            mp3sByNormalizedBase.get(normalized)!.push(mp3File);
        });

        // 2. Process, Validate Format, and Normalize SRTs
        srtFiles.forEach(srtFile => {
            const info = extractSrtInfo(srtFile.name);
            if (info.error) {
                addProblem(srtFile.name, info.error);
            } else {
                const normalized = normalizeBaseName(info.baseName);
                if (!srtsByNormalizedBase.has(normalized)) srtsByNormalizedBase.set(normalized, []);
                // Store the original file along with extracted info
                srtsByNormalizedBase.get(normalized)!.push({ ...info, file: srtFile });
            }
        });

        // 3. Attempt Pairing and Identify Issues
        const pairedMp3s = new Set();
        const pairedSrts = new Set();
        const ambiguousMatches = new Set(); // Store normalized names with >1 MP3 or >1 SRT

        // Helper function to find fuzzy matches for truncated filenames
        const findFuzzyMatch = <T,>(targetNormalized: string, candidateMap: Map<string, T[]>): T[] | null => {
            // Try exact match first
            if (candidateMap.has(targetNormalized)) {
                return candidateMap.get(targetNormalized) ?? null;
            }

            // Try prefix matching for truncated names (min 10 chars to avoid false positives)
            if (targetNormalized.length >= 10) {
                for (const [candidateNormalized, candidateList] of candidateMap.entries()) {
                    if (candidateNormalized.length >= 10) {
                        // Check if one is a prefix of the other
                        if (targetNormalized.startsWith(candidateNormalized) ||
                            candidateNormalized.startsWith(targetNormalized)) {
                            return candidateList;
                        }
                    }
                }
            }
            return null;
        };

        mp3sByNormalizedBase.forEach((mp3List, normalizedName) => {
            const matchingSrtList = findFuzzyMatch(normalizedName, srtsByNormalizedBase);

            // Check for ambiguity first
            let isAmbiguous = false;
            if (mp3List.length > 1) {
                ambiguousMatches.add(normalizedName);
                mp3List.forEach((f) => addProblem(f.name, `Ambiguous Match (multiple MP3s normalize to '${normalizedName}')`));
                isAmbiguous = true;
            }
            if (matchingSrtList && matchingSrtList.length > 1) {
                ambiguousMatches.add(normalizedName);
                matchingSrtList.forEach((s) => addProblem(s.originalFullName, `Ambiguous Match (multiple SRTs normalize to '${normalizedName}')`));
                isAmbiguous = true;
            }

            // Attempt pairing only if not ambiguous
            if (!isAmbiguous) {
                if (mp3List.length === 1 && matchingSrtList && matchingSrtList.length === 1) {
                    // Perfect 1-to-1 match based on normalized name
                    pairedMp3s.add(mp3List[0].name);
                    pairedSrts.add(matchingSrtList[0].originalFullName);
                } else if (mp3List.length === 1 && !matchingSrtList) {
                    // MP3 exists, but no SRT normalizes to the same name (and MP3 wasn't ambiguous)
                    addProblem(mp3List[0].name, 'Missing Matching SRT');
                }
                // Note: The case where SRT exists but MP3 doesn't is handled in step 4
            }
        });

        // 4. Identify Unpaired SRTs (that weren't ambiguous or invalid format)
        srtsByNormalizedBase.forEach((srtList, normalizedName) => {
            srtList.forEach((srtInfo) => {
                // Check if this SRT was successfully paired OR if it was already flagged (e.g., ambiguous, invalid format)
                if (!pairedSrts.has(srtInfo.originalFullName) && !problematicFiles.has(srtInfo.originalFullName)) {
                    // Try fuzzy matching before marking as missing
                    const fuzzyMp3Match = findFuzzyMatch(normalizedName, mp3sByNormalizedBase);
                    if (!fuzzyMp3Match) {
                        // No MP3 existed with the same normalized name (even fuzzy)
                        addProblem(srtInfo.originalFullName, 'Missing Matching MP3');
                    } else if (ambiguousMatches.has(normalizedName)) {
                        // An MP3 existed, but it was part of an ambiguous match
                        addProblem(srtInfo.originalFullName, 'Unpaired (Related MP3 was ambiguous)');
                    } else {
                        addProblem(srtInfo.originalFullName, 'Unpaired (Reason unclear)');
                    }
                }
            });
        });


        if (problematicFiles.size > 0) {
            const errorMessages: string[] = [];
            problematicFiles.forEach((reasons: Set<string>, fileName: string) => {
                errorMessages.push(`${fileName} (${Array.from(reasons).join(', ')})`);
            });
            errorMessages.sort();
            setError(`File validation errors: ${errorMessages.join('; ')}`);
            return;
        }

        // --- End: Fuzzy Pairing Validation using Normalization ---


        setIsLoading(true);

        try {
            const resultData = await createAudioLessonsBatch(languageId, tag || null, fileList, (percent) => {
                setUploadProgress(percent);
            });

            setUploadProgress(100);
            setResults(resultData as BatchAudioResults); // Store results { createdCount, skippedFiles }
            setFiles(null); // Clear file input
            setTag(''); // Clear tag input
            // Reset file input visually (requires direct DOM manipulation or key change)
            (event.target as HTMLFormElement).reset();


        } catch (err: unknown) {
            setError(`Batch upload failed: ${(err as Error)?.message}`);
            console.error(err);
            // Do not reset progress on error, so user sees where it failed
            // setUploadProgress(0);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Container className="py-5">
            <Card className="shadow-sm">
                <Card.Body className="p-4">
                    <h2 className="mb-4">Batch Create Audio Lessons</h2>
                    <p className="mb-4">Upload paired audio (.mp3) and subtitle (.srt) files. Files must follow the naming convention:</p>
                    <ul>
                        <li>Audio: <code>Lesson Name_.mp3</code></li>
                        <li>Subtitle: <code>Lesson Name__fr.srt</code> (or other language code)</li>
                    </ul>
                    <p>The part before the final <code>_</code> or <code>__</code> must match exactly for files to be paired.</p>

                    {loadingLanguages && <Spinner animation="border" size="sm" />}
                    {error && <Alert variant="danger">{error}</Alert>}

                    <Form onSubmit={handleSubmit}>
                        <Form.Group className="mb-3" controlId="language">
                            <Form.Label>Language (for all lessons in batch)</Form.Label>
                            <Form.Select
                                value={languageId}
                                onChange={(e) => setLanguageId(e.target.value)}
                                required
                                disabled={isLoading || loadingLanguages || languages.length === 0}
                            >
                                {languages.length === 0 && !loadingLanguages && <option value="">No languages available</option>}
                                {languages.map((lang) => (
                                    <option key={lang.languageId} value={lang.languageId}>
                                        {lang.name}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3" controlId="tag">
                            <Form.Label>Tag (Optional, for all lessons in batch)</Form.Label>
                            <Form.Control
                                type="text"
                                placeholder="Enter a tag (e.g., news, podcast)"
                                value={tag}
                                onChange={(e) => setTag(e.target.value)}
                                maxLength={100}
                                disabled={isLoading}
                            />
                        </Form.Group>

                        <Form.Group controlId="formFileMultiple" className="mb-3">
                            <Form.Label>Select Paired Audio (.mp3) and Subtitle (.srt) Files</Form.Label>
                            <Form.Control
                                type="file"
                                multiple
                                accept=".mp3,.srt"
                                onChange={handleFileChange}
                                required
                                disabled={isLoading}
                            />
                            {files && <div className="mt-2 text-muted">{files.length} file(s) selected</div>}
                        </Form.Group>

                        {(isLoading || uploadProgress > 0) && (
                            <div className="mb-3">
                                <ProgressBar
                                    animated={isLoading}
                                    now={uploadProgress}
                                    label={`${uploadProgress}%`}
                                    variant={error ? "danger" : (uploadProgress === 100 ? "success" : "primary")}
                                    striped={!error && uploadProgress < 100}
                                />
                                <div className="text-center mt-2">
                                    <small className={error ? "text-danger fw-bold" : (uploadProgress === 100 ? "text-success fw-bold" : "text-muted")}>
                                        {error ? "Upload failed" : (
                                            uploadProgress < 100
                                                ? "Uploading files..."
                                                : "Upload complete. Processing files on server (this may take a moment)..."
                                        )}
                                    </small>
                                </div>
                            </div>
                        )}

                        <div className="d-grid">
                            <Button variant="primary" type="submit" disabled={isLoading || loadingLanguages || !files || files.length === 0}>
                                {isLoading ? <Spinner animation="border" size="sm" /> : null} {isLoading ? 'Uploading & Processing...' : 'Create Batch Lessons'}
                            </Button>
                        </div>
                    </Form>

                    {results && (
                        <Alert variant={(results.createdCount ?? 0) > 0 ? "success" : "warning"} className="mt-4">
                            <Alert.Heading>Batch Process Complete</Alert.Heading>
                            <p>Successfully created <strong>{results.createdCount}</strong> audio lessons.</p>
                            {results.skippedFiles && results.skippedFiles.length > 0 && (
                                <>
                                    <hr />
                                    <p className="mb-1"><strong>Skipped Files ({results.skippedFiles.length}):</strong></p>
                                    <ListGroup variant="flush">
                                        {[...results.skippedFiles].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).map((skipped, index) => (
                                            <ListGroup.Item key={index} className="py-1 px-0 border-0">
                                                <small>{skipped}</small>
                                            </ListGroup.Item>
                                        ))}
                                    </ListGroup>
                                </>
                            )}
                            <div className="d-flex justify-content-end mt-3">
                                <Button onClick={() => navigate('/texts')} variant="outline-secondary" size="sm">Go to My Texts</Button>
                            </div>
                        </Alert>
                    )}
                </Card.Body>
            </Card>
        </Container>
    );
};

export default BatchAudioCreate;