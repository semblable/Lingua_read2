import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';

export type FoldersList = ResponseOf<'/api/Folders', 'get'>;
export type LibraryContents = ResponseOf<'/api/Folders/library', 'get'>;

export const getLibraryContents = async (
  folderId: number | string | null = null
): Promise<LibraryContents> => {
  const params = new URLSearchParams();
  if (folderId) params.append('folderId', String(folderId));
  const queryString = params.toString();
  return await fetchApi<LibraryContents>(
    `/folders/library${queryString ? `?${queryString}` : ''}`
  );
};

export const deleteLibraryItems = async (
  textIds: Array<number | string> | null = null,
  bookIds: Array<number | string> | null = null,
  folderIds: Array<number | string> | null = null
): Promise<unknown> => {
  const params = new URLSearchParams();
  if (textIds?.length) params.append('textIds', textIds.join(','));
  if (bookIds?.length) params.append('bookIds', bookIds.join(','));
  if (folderIds?.length) params.append('folderIds', folderIds.join(','));
  return await fetchApi(`/folders/delete-items?${params.toString()}`, { method: 'DELETE' });
};

export const getFolders = async (): Promise<FoldersList> => {
  return await fetchApi<FoldersList>('/folders');
};

export const createFolder = async (
  name: string,
  parentFolderId: number | string | null = null,
  color: string | null = null,
  languageId: number | string | null = null
): Promise<unknown> => {
  return await fetchApi('/folders', {
    method: 'POST',
    body: JSON.stringify({ name, parentFolderId, color, languageId })
  });
};

export type UpdateFolderInput = {
  name?: string;
  parentFolderId?: number | string | null;
  color?: string | null;
  languageId?: number | string | null;
};

export const updateFolder = async (
  folderId: number | string,
  data: UpdateFolderInput
): Promise<unknown> => {
  return await fetchApi(`/folders/${folderId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const deleteFolder = async (folderId: number | string): Promise<unknown> => {
  return await fetchApi(`/folders/${folderId}`, { method: 'DELETE' });
};

export const moveLibraryItems = async (
  textIds: Array<number | string> | null = null,
  bookIds: Array<number | string> | null = null,
  folderIds: Array<number | string> | null = null,
  targetFolderId: number | string | null = null
): Promise<unknown> => {
  return await fetchApi('/folders/move-items', {
    method: 'PUT',
    body: JSON.stringify({ textIds, bookIds, folderIds, targetFolderId })
  });
};

export type ReorderItem = {
  id: number | string;
  type: string;
  position: number;
};

export const reorderLibraryItems = async (
  folderId: number | string | null,
  items: ReorderItem[]
): Promise<unknown> => {
  return await fetchApi('/folders/reorder', {
    method: 'PUT',
    body: JSON.stringify({ folderId, items })
  });
};
