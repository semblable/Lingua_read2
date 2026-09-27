// Stored media paths (book covers, news photos) are relative to wwwroot, like
// "epub_assets/{userId}/news/42.jpg"; the page loads them from the site root. Absolute and
// protocol-relative URLs pass through.
export const normalizeMediaUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) return value;
  return `/${value.replace(/^\/+/, '')}`;
};
