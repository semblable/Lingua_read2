import { useRef, useState } from 'react';

export type ReaderDictionary = {
  dictionaryId?: number;
  isActive?: boolean;
  purpose?: string;
  displayType?: string;
  urlTemplate?: string;
  sortOrder?: number;
};

type DictionaryLink = { key: string; href: string; label: string; embedded: boolean };

function DictionaryLookup({ dictionaries, term }: { dictionaries: ReaderDictionary[]; term: string }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const encodedTerm = encodeURIComponent(term);
  const links = dictionaries
    .filter(dict => dict.isActive && dict.purpose === 'terms')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .flatMap((dict): DictionaryLink[] => {
      try {
        const url = new URL((dict.urlTemplate ?? '').replace('###', encodedTerm));
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];

        const site = url.hostname.replace(/^www\./, '').split('.')[0];
        const label = site.charAt(0).toUpperCase() + site.slice(1);
        const embedded = dict.displayType === 'embedded' && url.protocol === 'https:';
        return [{ key: String(dict.dictionaryId ?? url.href), href: url.href, label, embedded }];
      } catch {
        return [];
      }
    });
  const active = links.find(link => link.embedded && link.key === activeKey);
  if (!links.length) return null;

  return (
    <div className="word-info-dictionaries">
      <h6 className="mb-2 small text-muted">Dictionaries</h6>
      <div className="d-flex flex-wrap gap-1">
        {links.map(link => link.embedded ? (
          <button
            key={link.key}
            type="button"
            className="btn btn-link btn-sm word-info-dictionary"
            aria-expanded={active?.key === link.key}
            onClick={event => {
              trigger.current = event.currentTarget;
              setActiveKey(link.key);
            }}
          >
            {link.label}
          </button>
        ) : (
          <a key={link.key} className="btn btn-link btn-sm word-info-dictionary" href={link.href}
            target="_blank" rel="noopener noreferrer">
            {link.label}<span aria-hidden="true"> ↗</span>
          </a>
        ))}
      </div>
      {active && (
        <div className="mt-2">
          <div className="d-flex justify-content-between flex-wrap gap-1 mb-1">
            <a className="btn btn-link btn-sm word-info-dictionary" href={active.href}
              target="_blank" rel="noopener noreferrer">
              Open in new tab<span aria-hidden="true"> ↗</span>
            </a>
            <button type="button" className="btn btn-link btn-sm word-info-dictionary"
              onClick={() => {
                setActiveKey(null);
                trigger.current?.focus();
              }}>
              Close dictionary
            </button>
          </div>
          <iframe className="word-info-dictionary-frame" src={active.href} title={`${active.label} dictionary`}
            sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" />
        </div>
      )}
    </div>
  );
}

export default DictionaryLookup;
