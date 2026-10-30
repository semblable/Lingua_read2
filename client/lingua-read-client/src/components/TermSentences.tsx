import React, { useState } from 'react';
import { Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import type { Word } from '../utils/api/words';
import { sentenceContainsTerm, splitSentenceAroundTerm } from '../utils/readerText';

type Props = {
    term: Word;
    characterSubstitutions?: string | null;
    languageCode?: string | null;
};

export default function TermSentences({ term, characterSubstitutions, languageCode }: Props) {
    const [expanded, setExpanded] = useState(false);
    const sentences = (term.sentences ?? []).filter(context =>
        sentenceContainsTerm(context.sentence ?? '', term.term ?? '', characterSubstitutions, languageCode));
    if (sentences.length === 0) {
        return <span className="terms-empty" aria-label="No matching saved sentence">—</span>;
    }

    const firstParts = splitSentenceAroundTerm(sentences[0].sentence ?? '', term.term ?? '', characterSubstitutions, languageCode);
    const canExpand = sentences.length > 1 || firstParts.reduce((length, part) => length + part.text.length, 0) > 200;
    const renderSentence = (sentence: string) => {
        const parts = splitSentenceAroundTerm(sentence, term.term ?? '', characterSubstitutions, languageCode);
        const text = parts.map(part => part.text).join('');
        let preview = text;
        if (!expanded && text.length > 200) {
            // Keep the highlighted term in view even when it occurs late in a long sentence.
            const matchIndex = parts.findIndex(part => part.isTerm);
            const termOffset = matchIndex < 0 ? 0 : parts.slice(0, matchIndex).reduce((length, part) => length + part.text.length, 0);
            const start = Math.min(Math.max(0, termOffset - 80), text.length - 200);
            preview = `${start > 0 ? '…' : ''}${text.slice(start, start + 200)}${start + 200 < text.length ? '…' : ''}`;
        }
        return splitSentenceAroundTerm(preview, term.term ?? '', characterSubstitutions, languageCode)
            .map((part, i) => part.isTerm ? <mark key={i}>{part.text}</mark> : part.text);
    };
    return (
        <div className="terms-sentences">
            {(expanded ? sentences : sentences.slice(0, 1)).map((context, index) => (
                <div key={index} className="terms-sentence">
                    <p className="mb-1">
                        {renderSentence(context.sentence ?? '')}
                    </p>
                    {(context.textTitle || context.textId != null) && <div className="terms-sentence-source">
                        {context.textTitle && <span>{context.textTitle}</span>}
                        {context.textId != null && (
                            <Link className={context.textTitle ? 'ms-2' : undefined} to={`/texts/${context.textId}`}>
                                Open in reader<span className="visually-hidden">: {context.textTitle || term.term}</span>
                            </Link>
                        )}
                    </div>}
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
