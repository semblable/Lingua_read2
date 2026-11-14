// Shared by the synthetic settings preview and reader presentations.
export const readerFontFamily = (font: string): string => {
  switch (font) {
    case 'serif': return 'var(--font-family-serif)';
    case 'lato': return "'Lato', sans-serif";
    case 'open-sans': return "'Open Sans', sans-serif";
    case 'atkinson': return "'Atkinson Hyperlegible', sans-serif";
    case 'merriweather': return "'Merriweather', serif";
    case 'roboto-slab': return "'Roboto Slab', serif";
    case 'comic-sans': return "'Comic Sans MS', 'Comic Sans', cursive";
    case 'monospace': return "'Courier New', monospace";
    case 'dyslexic': return "'OpenDyslexic', sans-serif";
    default: return 'var(--font-family-sans-serif)';
  }
};
