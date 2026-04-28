import React, { useContext } from 'react';
import { SettingsContext } from '../../contexts/SettingsContext';

const VocabIndicator = ({ text, className = '' }) => {
  const { settings } = useContext(SettingsContext);
  const mode = settings?.libraryUnknownIndicator || 'both';

  if (mode === 'none' || !text || !text.totalUniqueWords || text.totalUniqueWords <= 0) {
    return null;
  }

  const pctNew = Math.round(text.percentNew ?? 0);
  const pctLearning = Math.round(text.percentLearning ?? 0);
  const showNew = mode === 'new' || mode === 'both';
  const showLearning = mode === 'learning' || mode === 'both';

  const parts = [];
  if (showNew) parts.push(<span key="new" style={{ color: '#dc3545' }}>{pctNew}% new</span>);
  if (showLearning) {
    if (parts.length) parts.push(<span key="sep" className="text-muted"> · </span>);
    parts.push(<span key="learning" style={{ color: '#d97706' }}>{pctLearning}% learning</span>);
  }

  const tooltip = `${text.newWords ?? 0} new · ${text.learningWords ?? 0} learning · ${text.totalUniqueWords} unique words`;

  return (
    <small className={className} title={tooltip}>
      {parts}
    </small>
  );
};

export default VocabIndicator;
