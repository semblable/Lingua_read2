// Unique id for one client-side event (a listening flush, an SRS grade) so the
// server can dedupe replays of it: an offline queue drain, or a retry whose
// first response was lost on a flaky link.
export const newClientEventId = (): string =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
