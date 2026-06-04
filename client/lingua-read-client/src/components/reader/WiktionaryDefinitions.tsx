import React, { useEffect, useRef, useState } from 'react';
import { Spinner } from 'react-bootstrap';
import { getWordDefinition, type WordDefinitionEntry } from '../../utils/api';

type WiktionaryDefinitionsProps = {
  term: string;
  sourceLanguageCode: string;
  // True only when the user's provider is Wiktionary AND rich display is enabled.
  enabled: boolean;
};

// Optional rich display for the Wiktionary provider: shows part of speech + senses
// below the editable translation field. Self-contained — it fetches its own data so the
// presentational WordInfoPanel does not need extra wiring. Renders nothing when disabled,
// empty, or on error (the flattened gloss in the translation field is the fallback).
const WiktionaryDefinitions = ({ term, sourceLanguageCode, enabled }: WiktionaryDefinitionsProps) => {
  const [entries, setEntries] = useState<WordDefinitionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !term) {
      setEntries([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    getWordDefinition(term, sourceLanguageCode, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) {
          setEntries(res.entries ?? []);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEntries([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [term, sourceLanguageCode, enabled]);

  if (!enabled) return null;

  if (loading) {
    return (
      <div className="mt-3 pt-2 border-top">
        <Spinner animation="border" size="sm" /> <span className="small text-muted">Loading definitions…</span>
      </div>
    );
  }

  if (entries.length === 0) return null;

  return (
    <div className="mt-3 pt-2 border-top">
      <h6 className="mb-2 small text-muted">Wiktionary</h6>
      {entries.map((entry, i) => (
        <div key={`${entry.partOfSpeech}-${i}`} className="mb-2">
          {entry.partOfSpeech && (
            <div className="small fst-italic text-muted">{entry.partOfSpeech}</div>
          )}
          <ol className="mb-0 ps-3 small">
            {entry.senses.map((sense, j) => (
              <li key={j}>{sense}</li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
};

export default WiktionaryDefinitions;
