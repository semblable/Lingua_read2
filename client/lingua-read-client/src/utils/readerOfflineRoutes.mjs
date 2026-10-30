// Exact read dependencies only; never cache activity writes or admin endpoints.
export const readerTextUrlPattern = /^.*\/api\/texts\/\d+(?:\/content)?(?:\?.*)?$/i;
export const readerLanguageUrlPattern = /^.*\/api\/(?:languages\/\d+|words\/language\/\d+)(?:\?.*)?$/i;
