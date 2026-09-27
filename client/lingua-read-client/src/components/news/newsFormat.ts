// "5m ago", "2h ago", "3d ago"; null for a missing or unreadable date.
export const ago = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;
