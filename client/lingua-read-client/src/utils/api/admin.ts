import { API_URL, fetchApiDownload, ApiError, handleUnauthorized } from './client';

// Backup Database — triggers a download in the browser
export const backupDatabase = async (): Promise<{ message: string }> => {
  const { blob, filename } = await fetchApiDownload('/datamanagement/backup', {
    method: 'GET'
  });

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
  return { message: `Backup download started as ${filename}` };
};

// Restore Database — uploads a backup file via multipart/form-data.
// Uses bare fetch because fetchApi assumes JSON Content-Type and uploadWithProgress
// is for tracked-progress uploads (not needed here).
export const restoreDatabase = async (
  backupFile: File
): Promise<{ message: string }> => {
  const endpoint = '/datamanagement/restore';

  if (!backupFile) {
    throw new Error('Backup file is required for restore.');
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const formData = new FormData();
    formData.append('backupFile', backupFile);

    const requestConfig: RequestInit = {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint;
    const response = await fetch(fullUrl.toString(), requestConfig);

    if (response.status === 401) {
      handleUnauthorized();
      throw new ApiError('Authentication required', 401);
    }

    const responseData = await response.json();

    if (!response.ok) {
      const errorMessage =
        responseData.message || responseData.title || `HTTP error! Status: ${response.status}`;
      console.error('[API Error] Database restore failed:', errorMessage);
      throw new ApiError(errorMessage, response.status);
    }

    return responseData;
  } catch (error) {
    console.error('[API Error] Failed to restore database:', error);
    throw error;
  }
};
