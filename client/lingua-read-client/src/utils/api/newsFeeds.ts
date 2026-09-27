import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';

// News feeds the user follows (Settings > News feeds). While the newsImportEnabled setting is on,
// the server imports their new articles into the Library in the background.
type NewsFeedDto = ResponseOf<'/api/NewsFeeds', 'get'>[number];
type NewsFeedFetchResultDto = ResponseOf<'/api/NewsFeeds/{id}/fetch', 'post'>;
export type AddNewsFeedInput = RequestBodyOf<'/api/NewsFeeds', 'post'>;
export type UpdateNewsFeedInput = RequestBodyOf<'/api/NewsFeeds/{id}', 'put'>;

// The DTO with its always-present fields made required (the generated types mark every field
// optional).
export type NewsFeed = {
  newsFeedId: number;
  url: string;
  title: string;
  languageId: number;
  languageName: string;
  folderId: number | null;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  importedLast24Hours: number;
  articleCount: number;
};

export type NewsFeedFetchResult = {
  success: boolean;
  imported: number;
  skipped: number;
  message: string;
  feed: NewsFeed | null;
};

const toNewsFeed = (dto: NewsFeedDto): NewsFeed => ({
  newsFeedId: dto.newsFeedId ?? 0,
  url: dto.url ?? '',
  title: dto.title ?? '',
  languageId: dto.languageId ?? 0,
  languageName: dto.languageName ?? '',
  folderId: dto.folderId ?? null,
  enabled: dto.enabled ?? true,
  createdAt: dto.createdAt ?? '',
  lastCheckedAt: dto.lastCheckedAt ?? null,
  lastSuccessAt: dto.lastSuccessAt ?? null,
  lastError: dto.lastError ?? null,
  importedLast24Hours: dto.importedLast24Hours ?? 0,
  articleCount: dto.articleCount ?? 0
});

export const getNewsFeeds = async (): Promise<NewsFeed[]> => {
  return ((await fetchApi<NewsFeedDto[]>('/newsfeeds')) ?? []).map(toNewsFeed);
};

/** Takes a feed address or a web page that links to its feed; the server checks it before saving. */
export const addNewsFeed = async (input: AddNewsFeedInput): Promise<NewsFeed> => {
  return toNewsFeed(await fetchApi<NewsFeedDto>('/newsfeeds', { method: 'POST', body: JSON.stringify(input) }));
};

export const updateNewsFeed = async (id: number, input: UpdateNewsFeedInput): Promise<NewsFeed> => {
  return toNewsFeed(await fetchApi<NewsFeedDto>(`/newsfeeds/${id}`, { method: 'PUT', body: JSON.stringify(input) }));
};

/** Stops following the feed; its articles stay in the Library. */
export const deleteNewsFeed = async (id: number): Promise<void> => {
  await fetchApi(`/newsfeeds/${id}`, { method: 'DELETE' });
};

/** Checks the feed now, within the same daily limit as the background import. */
export const fetchNewsFeed = async (id: number): Promise<NewsFeedFetchResult> => {
  const dto = await fetchApi<NewsFeedFetchResultDto>(`/newsfeeds/${id}/fetch`, { method: 'POST' });
  return {
    success: dto.success ?? false,
    imported: dto.imported ?? 0,
    skipped: dto.skipped ?? 0,
    message: dto.message ?? '',
    feed: dto.feed ? toNewsFeed(dto.feed) : null
  };
};
