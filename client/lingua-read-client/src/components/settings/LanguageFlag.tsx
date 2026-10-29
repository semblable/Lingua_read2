import React from 'react';
import { findLanguagePreset } from '../../utils/languagePresets';

export default function LanguageFlag({ code }: { code: string }) {
  const preset = findLanguagePreset(code);
  return (
    <span className={`language-flag${preset ? '' : ' language-flag--fallback'}`} aria-hidden="true">
      {preset ? (
        <img src={`${import.meta.env.BASE_URL}flags/${preset.flag}.svg`} alt="" width="40" height="30" />
      ) : <i className="bi bi-globe2" />}
    </span>
  );
}
