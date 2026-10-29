import React, { useState } from 'react';
import { Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import type { Word } from '../utils/api/words';
import { splitSentenceAroundTerm } from '../utils/readerText';

type Props = {
    term: Word;
    characterSubstitutions?: string | null;
};

export default function TermSentences({ term, characterSubstitutions }: Props) {
    const [expanded, setExpanded] = useState(false);
    const sentences = term.sentences ?? [];
    if (sentences.length === 0) {
        return <div className="small text-body-secondary mt-2">No saved sentence yet.</div>;
    }

    const firstParts = splitSentenceAroundTerm(sentences[0].sentence ?? '', term.term ?? '', characterSubstitutions);
    const canExpand = sentences.length > 1 || firstParts.reduce((length, part) => length + part.text.length, 0) > 200;
    const renderSentence = (sentence: string) => {
        const parts = splitSentenceAroundTerm(sentence, term.term ?? '', characterSubstitutions);
        const text = parts.map(part => part.text).join('');
        let preview = text;
        if (!expanded && text.length > 200) {
            // Keep the highlighted term in view even when it occurs late in a long sentence.
            const matchIndex = parts.findIndex(part => part.isTerm);
            const termOffset = matchIndex < 0 ? 0 : parts.slice(0, matchIndex).reduce((length, part) => length + part.text.length, 0);
            const start = Math.min(Math.max(0, termOffset - 80), text.length - 200);
            preview = `${start > 0 ? '…' : ''}${text.slice(start, start + 200)}${start + 200 < text.length ? '…' : ''}`;
        }
        return splitSentenceAroundTerm(preview, term.term ?? '', characterSubstitutions)
            .map((part, i) => part.isTerm ? <mark key={i}>{part.text}</mark> : part.text);
    };
    return (
        <div className="small mt-2" style={{ maxWidth: '48rem', overflowWrap: 'anywhere' }}>
            {(expanded ? sentences : sentences.slice(0, 1)).map((context, index) => (
                <div key={index} className="border-start ps-2 mb-2">
                    <p className="mb-1">
                        {renderSentence(context.sentence ?? '')}
                    </p>
                    <div className="text-body-secondary">
                        {context.textTitle && <span>{context.textTitle}</span>}
                        {context.textId != null && (
                            <Link className={context.textTitle ? 'ms-2' : undefined} to={`/texts/${context.textId}`}>
                                Open in reader<span className="visually-hidden">: {context.textTitle || term.term}</span>
                            </Link>
                        )}
                    </div>
                </div>
            ))}
            {canExpand && (
                <Button variant="link" size="sm" className="p-0" aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse sentences' : 'Expand sentences'} for ${term.term}`}
                    onClick={() => setExpanded(value => !value)}>
                    {expanded ? 'Show less' : sentences.length > 1 ? `Show all ${sentences.length} sentences` : 'Show full sentence'}
                </Button>
            )}
        </div>
    );
}
