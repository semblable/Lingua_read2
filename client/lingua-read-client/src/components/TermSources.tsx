import { Link } from 'react-router-dom';
import type { Word } from '../utils/api/words';

export default function TermSources({ sources }: { sources: Word['sources'] }) {
    if (!sources?.length) return <span className="terms-empty" aria-label="No source">—</span>;
    const renderSource = (source: NonNullable<Word['sources']>[number], index: number) => (
        <div key={index} className="terms-source">
            {source.textId != null
                ? <Link to={`/texts/${source.textId}`} title={source.textTitle || 'Open in reader'}>
                    {source.textTitle || 'Open in reader'}
                  </Link>
                : <span>{source.textTitle}</span>}
        </div>
    );
    return <>
        {renderSource(sources[0], 0)}
        {sources.length > 1 && <details className="terms-more-sources">
            <summary>{sources.length - 1} more {sources.length === 2 ? 'source' : 'sources'}</summary>
            {sources.slice(1).map(renderSource)}
        </details>}
    </>;
}
