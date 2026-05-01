// Dynamically set API URL based on platform.
//
// - Web (behind Nginx): default to `/api`
// - Native/mobile: set `REACT_APP_API_BASE_URL_MOBILE` (e.g. `http://<LAN-IP>:5000/api`)
// - Optional override for web too: `REACT_APP_API_BASE_URL` (e.g. `https://yourdomain.com/api`)
const WEB_API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';
const MOBILE_API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL_MOBILE ||
  process.env.REACT_APP_API_BASE_URL ||
  'http://localhost:5000/api';


const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';
export const API_URL = isWeb ? WEB_API_BASE_URL : MOBILE_API_BASE_URL;

// --- Auth API (raw fetch, used by store before fetchApi is appropriate) ---
export const authStatus = async () => {
  const res = await fetch(API_URL + '/auth/status', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to check auth status');
  return res.json();
};

export const authLogin = (password) => {
  return fetch(API_URL + '/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify({ password })
  });
};

export const authLogout = () => {
  return fetch(API_URL + '/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
};

export const authSetup = (password) => {
  return fetch(API_URL + '/auth/setup', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify({ password })
  });
};

// Redirect to login on 401
const handleUnauthorized = () => {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
};

// --- NEW HELPER: Upload with Progress (XHR) ---
const uploadWithProgress = (endpoint, formData, onProgress) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fullUrl = API_URL + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);

    // Upload progress event
    if (onProgress) {
      let lastPercent = 0;
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          // Ensure monotonic progress to prevent jitter or resets during the same request
          if (percentComplete > lastPercent) {
            lastPercent = percentComplete;
            onProgress(percentComplete);
          }
        }
      });
    }

    xhr.open('POST', fullUrl);
    xhr.withCredentials = true; // Send httpOnly auth cookie
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest'); // CSRF protection

    // Response handler
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Success
        try {
          // Check if response has content
          if (xhr.status === 204 || xhr.getResponseHeader('Content-Length') === '0') {
            resolve({ message: 'Success' });
            return;
          }
          const contentType = xhr.getResponseHeader('Content-Type');
          if (contentType && contentType.includes('application/json')) {
            const json = JSON.parse(xhr.responseText);
            resolve(json);
          } else {
            resolve({ message: xhr.responseText || xhr.statusText });
          }
        } catch (e) {
          console.error('JSON Parse Error:', e);
          resolve({ message: xhr.statusText }); // Fallback
        }
      } else {
        if (xhr.status === 401) {
          handleUnauthorized();
          reject(new Error('Authentication required'));
          return;
        }
        try {
          const json = JSON.parse(xhr.responseText);
          const message = json.message || json.title || `Upload failed: ${xhr.status} ${xhr.statusText}`;
          reject(new Error(message));
        } catch (e) {
          reject(new Error(xhr.responseText || `Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => {
      console.error('[API Error] XHR Network Error:', {
        status: xhr.status,
        statusText: xhr.statusText,
        readyState: xhr.readyState,
        responseURL: xhr.responseURL
      });
      reject(new Error(`Network error occurred during upload. Status: ${xhr.status}`));
    };

    xhr.send(formData);
  });
};


// Helper function for making API requests
const fetchApi = async (endpoint, options = {}) => {
  // Ensure endpoint starts with a slash
  if (!endpoint.startsWith('/')) {
    endpoint = '/' + endpoint;
  }

  try {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };

    // Add any additional headers from options
    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    const requestConfig = {
      ...options,
      headers,
      credentials: 'include',
      mode: 'cors'
    };

    // Construct the full URL properly
    const fullUrl = API_URL + endpoint;

    const response = await fetch(fullUrl.toString(), requestConfig);

    // Handle 401: redirect to login
    if (response.status === 401) {
      handleUnauthorized();
      throw new Error('Authentication required');
    }

    // Handle response
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorMessage;

      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        errorMessage = errorData.message || `HTTP error! Status: ${response.status}`;
      } else {
        const text = await response.text();
        errorMessage = text || `HTTP error! Status: ${response.status}`;
      }

      console.error('[API Error] Request failed:', {
        status: response.status,
        statusText: response.statusText,
        url: fullUrl.toString(),
        error: errorMessage
      });

      const err = new Error(errorMessage);
      err.status = response.status;
      throw err;
    }

    // Parse successful response
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      return data;
    } else {
      const text = await response.text();
      return { message: text || response.statusText };
    }
  } catch (error) {
    console.error('[API Error] Request failed:', {
      endpoint,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

// Helper function for making API requests that expect a file download
const fetchApiDownload = async (endpoint, options = {}) => {
  if (!endpoint.startsWith('/')) {
    endpoint = '/' + endpoint;
  }

  try {
    const headers = {
      'Accept': 'application/octet-stream',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const requestConfig = {
      ...options,
      headers,
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint;

    const response = await fetch(fullUrl.toString(), requestConfig);

    if (!response.ok) {
      if (response.status === 401) {
        handleUnauthorized();
        throw new Error('Authentication required');
      }
      let errorMessage = `HTTP error! Status: ${response.status}`;
      try {
        // Try to parse error as JSON first
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        // If not JSON, try text
        try {
          const text = await response.text();
          errorMessage = text || errorMessage;
        } catch (textError) { /* Keep original status error */ }
      }
      console.error('[API Download Error] Request failed:', errorMessage);
      throw new Error(errorMessage);
    }

    // Get filename from Content-Disposition header if available
    const disposition = response.headers.get('content-disposition');
    let filename = 'linguaread_backup.backup'; // Default filename
    if (disposition && disposition.indexOf('attachment') !== -1) {
      const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
      const matches = filenameRegex.exec(disposition);
      if (matches != null && matches[1]) {
        filename = matches[1].replace(/['"]/g, '');
      }
    }

    // Get the blob data
    const blob = await response.blob();

    return { blob, filename };

  } catch (error) {
    console.error('[API Download Error] Request failed:', error);
    throw error;
  }
};


// Simple test function to check API connectivity
export const testApiConnection = async () => {
  try {
    // Use the dedicated, unauthenticated health check endpoint
    const response = await fetch(`${API_URL}/Health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      mode: 'cors'
    });
    return response.ok;
  } catch (error) {
    console.error('API connection error:', error);
    return false;
  }
};

// Languages API
export const getLanguages = () => {
  // Note: This might be fetching the translation-specific list.
  // Keep it for now, but the new functions below target the full config endpoint.
  return fetchApi('/translation/languages'); // Assuming this is what it was intended for
};

// --- Language Configuration API ---

// Gets ALL languages with full configuration details
export const getAllLanguages = () => {
  return fetchApi('/languages');
};

// Gets a single language by ID with full configuration
export const getLanguage = (languageId) => {
  return fetchApi(`/languages/${languageId}`);
};

// Creates a new language configuration
export const createLanguage = (languageData) => {
  return fetchApi('/languages', {
    method: 'POST',
    body: JSON.stringify(languageData)
  });
};

// Updates an existing language configuration
export const updateLanguage = (languageId, languageData) => {
  return fetchApi(`/languages/${languageId}`, {
    method: 'PUT',
    body: JSON.stringify(languageData)
  });
};

// Deletes a language configuration
export const deleteLanguage = (languageId) => {
  return fetchApi(`/languages/${languageId}`, {
    method: 'DELETE'
  });
};

// Deletes all user content (texts, books, words, activity, stats) for a language,
// keeping the language configuration itself.
export const resetLanguageContent = (languageId) => {
  return fetchApi(`/languages/${languageId}/reset-content`, {
    method: 'POST'
  });
};

// Texts API
export const getTexts = () => {
  return fetchApi('/texts');
};

export const getText = (textId) => {
  return fetchApi(`/texts/${textId}`);
};

export const getTextSrt = async (textId) => {
  const fullUrl = API_URL + `/texts/${textId}/srt`;
  const response = await fetch(fullUrl, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'include',
    mode: 'cors'
  });
  if (response.status === 401) { handleUnauthorized(); throw new Error('Authentication required'); }
  if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
  return response.text();
};

export const getWordLinkingStatus = (textId) => {
  return fetchApi(`/texts/${textId}/word-linking-status`);
};

// Add getRecentTexts function
export const getRecentTexts = () => {
  return fetchApi('/texts/recent');
};

// Modified to include optional tag
export const createText = (title, content, languageId, tag = null) => {
  const payload = { title, content, languageId };
  if (tag) {
    payload.tag = tag;
  }
  return fetchApi('/texts', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

// Modified to include optional tag
// Modified to use XHR for progress
export const createAudioLesson = async (title, languageId, audioFile, srtFile, tag = null, onProgress = null) => {
  const endpoint = '/texts/audio';

  try {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('languageId', languageId);
    formData.append('audioFile', audioFile); // The File object
    formData.append('srtFile', srtFile);     // The File object
    if (tag) {
      formData.append('tag', tag); // Add tag if provided
    }

    return await uploadWithProgress(endpoint, formData, onProgress);

  } catch (error) {
    console.error('[API Error] Failed to create audio lesson:', error);
    throw error;
  }
};

// Add updateText function
export const updateText = (textId, { title, content, tag }) => {
  const payload = { title, content, tag }; // Include tag in payload
  return fetchApi(`/texts/${textId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

// Add deleteText function
export const deleteText = (textId) => {
  return fetchApi(`/texts/${textId}`, {
    method: 'DELETE'
  });
};

// Marks a text as completed and logs activity
export const completeText = (textId) => {
  console.log(`[API] Marking text ${textId} as complete.`);
  return fetchApi(`/texts/${textId}/complete`, {
    method: 'PUT'
    // No body needed for this request
  });
};



// Books API
export const getBooks = () => {
  return fetchApi('/books');
};

export const getBook = (bookId) => {
  return fetchApi(`/books/${bookId}`);
};

// Modified createBook to include tags
export const createBook = (title, description, languageId, content, splitMethod = 'paragraph', maxSegmentSize = 3000, tags = []) => {
  return fetchApi('/books', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      languageId,
      content,
      splitMethod,
      maxSegmentSize,
      tags // Add tags array to payload
    })
  });
};

// Added uploadBook function for file uploads
// Added uploadBook function for file uploads with progress support
export const uploadBook = async (formData, onProgress = null) => {
  const endpoint = '/books/upload';
  console.log(`[API] Uploading book file...`);

  try {
    return await uploadWithProgress(endpoint, formData, onProgress);
  } catch (error) {
    console.error('[API Error] Failed to upload book:', error);
    throw error;
  }
};

// Modified updateBook to include tags and description
export const updateBook = (bookId, { title, description, tags }) => {
  const payload = { title, description, tags }; // Include description and tags
  return fetchApi(`/books/${bookId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

// Added uploadAudiobookTracks function for MP3 uploads
// Added uploadAudiobookTracks function for MP3 uploads with progress
export const uploadAudiobookTracks = async (bookId, formData, onProgress = null) => {
  const endpoint = `/books/${bookId}/audiobook`;
  console.log(`[API] Uploading audiobook tracks for book ${bookId}...`);

  try {
    return await uploadWithProgress(endpoint, formData, onProgress);
  } catch (error) {
    console.error('[API Error] Failed to upload audiobook tracks:', error);
    throw error;
  }
};

// Add createAudioLessonsBatch function
// Add createAudioLessonsBatch function
export const createAudioLessonsBatch = async (languageId, tag, files, onProgress = null) => {
  const endpoint = '/texts/audio/batch';
  console.log(`[API] Creating batch audio lessons for language ${languageId} with tag: ${tag || 'none'}`);

  try {
    const formData = new FormData();
    formData.append('languageId', languageId);
    if (tag) {
      formData.append('tag', tag);
    }
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    return await uploadWithProgress(endpoint, formData, onProgress);

  } catch (error) {
    console.error('[API Error] Failed to create batch audio lessons:', error);
    throw error;
  }
};


// Add deleteBook function
export const deleteBook = (bookId) => {
  return fetchApi(`/books/${bookId}`, {
    method: 'DELETE'
  });
};

export const updateLastRead = (bookId, textId) => {
  return fetchApi(`/books/${bookId}/lastread`, {
    method: 'PUT',
    body: JSON.stringify({ textId })
  });
};

export const completeLesson = (bookId, textId) => {
  if (bookId) {
    // Existing call for lessons within books
    return fetchApi(`/books/${bookId}/complete-lesson`, {
      method: 'PUT',
      body: JSON.stringify({ textId }) // Assuming textId is still needed in body
    });
  } else {
    // New call for standalone texts (Assumes backend endpoint PUT /api/texts/{textId}/complete exists)
    return fetchApi(`/texts/${textId}/complete`, {
      method: 'PUT'
      // Body might not be needed if textId is in the URL
    });
  }
};

export const finishBook = (bookId) => {
  return fetchApi(`/books/${bookId}/finish`, {
    method: 'PUT'
  });
};

// Hardcover API
export const getHardcoverStatus = () => {
  return fetchApi('/hardcover/status');
};

export const matchHardcoverBook = (bookId, hardcoverBookId = null) => {
  const body = hardcoverBookId ? JSON.stringify({ hardcoverBookId }) : undefined;
  return fetchApi(`/hardcover/match/${bookId}`, {
    method: 'POST',
    ...(body ? { body } : {})
  });
};

export const importHardcoverMetadata = (bookId) => {
  return fetchApi(`/hardcover/import-metadata/${bookId}`, {
    method: 'POST'
  });
};

export const syncHardcoverProgress = (bookId) => {
  return fetchApi(`/hardcover/sync-progress/${bookId}`, {
    method: 'POST'
  });
};

export const syncAllHardcover = () => {
  return fetchApi('/hardcover/sync-all', {
    method: 'POST'
  });
};

// User Statistics API
export const getUserStatistics = () => {
  return fetchApi('/users/statistics');
};

export const getDashboard = async (timezoneOffsetMinutes = null) => {
  const params = new URLSearchParams();
  if (timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== undefined) {
    params.append('timezoneOffsetMinutes', timezoneOffsetMinutes);
  }
  const qs = params.toString();
  return fetchApi(`/users/dashboard${qs ? `?${qs}` : ''}`);
};

// --- Goals API ---
const tzOffset = () => -new Date().getTimezoneOffset();

export const getGoals = (status = 'active') => {
  const params = new URLSearchParams({ status, timezoneOffsetMinutes: tzOffset() });
  return fetchApi(`/goals?${params.toString()}`);
};

export const getGoal = (goalId) => {
  const params = new URLSearchParams({ timezoneOffsetMinutes: tzOffset() });
  return fetchApi(`/goals/${goalId}?${params.toString()}`);
};

export const createGoal = (payload) => {
  const params = new URLSearchParams({ timezoneOffsetMinutes: tzOffset() });
  return fetchApi(`/goals?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const updateGoal = (goalId, payload) => {
  const params = new URLSearchParams({ timezoneOffsetMinutes: tzOffset() });
  return fetchApi(`/goals/${goalId}?${params.toString()}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

export const archiveGoal = (goalId) =>
  fetchApi(`/goals/${goalId}/archive`, { method: 'POST' });

export const restoreGoal = (goalId) =>
  fetchApi(`/goals/${goalId}/restore`, { method: 'POST' });

export const deleteGoal = (goalId) =>
  fetchApi(`/goals/${goalId}`, { method: 'DELETE' });

export const getGoalSuggestion = ({ type, languageId = null, recurrence = 0, mode = 1 }) => {
  const params = new URLSearchParams({
    type,
    recurrence,
    mode,
    timezoneOffsetMinutes: tzOffset()
  });
  if (languageId !== null && languageId !== undefined) {
    params.append('languageId', languageId);
  }
  return fetchApi(`/goals/suggestions?${params.toString()}`);
};

export const getReadingActivity = async (period = 'all', timezoneOffsetMinutes = null, languageId = null, offset = 0) => {
  try {
    const params = new URLSearchParams({ period });
    if (timezoneOffsetMinutes !== null) {
      params.append('timezoneOffsetMinutes', timezoneOffsetMinutes);
    }
    if (languageId !== null) {
      params.append('languageId', languageId);
    }
    if (offset && offset > 0) {
      params.append('offset', offset);
    }
    console.log(`[API] Getting reading activity with params: ${params.toString()}`);
    const data = await fetchApi(`/users/reading-activity?${params.toString()}`);
    return data;
  } catch (error) {
    console.error('Error getting reading activity:', error);
    return { error: error.message };
  }
};

// Fetch listening activity data
export const getListeningActivity = async (period = 'all', timezoneOffsetMinutes = null, languageId = null, offset = 0) => {
  try {
    const params = new URLSearchParams({ period });
    if (timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== undefined) {
      params.append('timezoneOffsetMinutes', timezoneOffsetMinutes);
    }
    if (languageId !== null && languageId !== undefined) {
      params.append('languageId', languageId);
    }
    if (offset && offset > 0) {
      params.append('offset', offset);
    }
    console.log(`[API] Fetching listening activity with params: ${params.toString()}`);
    const data = await fetchApi(`/users/listening-activity?${params.toString()}`);
    return data;
  } catch (error) {
    console.error('Error getting listening activity:', error);
    return { error: error.message }; // Return error object on failure
  }
};


// Fetch cumulative known-words activity (words by Status >= 4 grouped by CreatedAt date)
export const getKnownWordsActivity = async (period = 'all', timezoneOffsetMinutes = null, languageId = null, offset = 0) => {
  try {
    const params = new URLSearchParams({ period });
    if (timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== undefined) {
      params.append('timezoneOffsetMinutes', timezoneOffsetMinutes);
    }
    if (languageId !== null && languageId !== undefined) {
      params.append('languageId', languageId);
    }
    if (offset && offset > 0) {
      params.append('offset', offset);
    }
    const data = await fetchApi(`/users/known-words-activity?${params.toString()}`);
    return data;
  } catch (error) {
    console.error('Error getting known-words activity:', error);
    return { error: error.message };
  }
};


// User Statistics API
export const resetUserStatistics = () => {
  console.log('[API] Resetting user statistics.');
  return fetchApi('/users/reset-statistics', {
    method: 'POST'
    // No body needed for this request
  });
};


// Words API
export const createWord = async (textId, term, status, translation, sentence = null) => {
  try {
    console.log(`[API] Creating word: "${term}" with status: ${status}, sentence: "${sentence || 'N/A'}"`);

    const payload = {
      textId: parseInt(textId, 10),
      term: term.trim(),
      status: parseInt(status, 10),
      translation: translation || '',
      sentence: sentence // Include sentence for auto-mining
    };

    const response = await fetchApi('/words', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    return response;
  } catch (error) {
    console.error('Error in createWord:', error);
    throw error;
  }
};

export const updateWord = async (wordId, status, translation) => {
  try {
    // Validate inputs
    if (!wordId) throw new Error('Word ID is required');
    if (!status) throw new Error('Word status is required');

    const payload = {
      status,
      translation: translation ?? ''
    };

    const response = await fetchApi(`/words/${wordId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    return response;
  } catch (error) {
    console.error('Error in updateWord:', error);
    throw error;
  }
};

export const deleteWord = async (wordId) => {
  try {
    if (!wordId) throw new Error('Word ID is required');

    return await fetchApi(`/words/${wordId}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('Error in deleteWord:', error);
    throw error;
  }
};

// Fetches words for a specific language, with optional filtering and sorting
export const getWordsByLanguage = (languageId, statusFilter = [], sortBy = 'term_asc', searchTerm = '') => {
  const params = new URLSearchParams();
  if (statusFilter && statusFilter.length > 0) {
    params.append('status', statusFilter.join(','));
  }
  if (sortBy) {
    params.append('sortBy', sortBy);
  }
  if (searchTerm && searchTerm.trim() !== '') {
    params.append('searchTerm', searchTerm.trim());
  }
  const queryString = params.toString();
  const endpoint = `/words/language/${languageId}${queryString ? `?${queryString}` : ''}`;
  return fetchApi(endpoint);
};

// Fetches paginated words for a specific language
export const getPaginatedWordsByLanguage = (languageId, page = 1, pageSize = 20, statusFilter = [], sortBy = 'term_asc', searchTerm = '') => {
  const params = new URLSearchParams();
  params.append('page', page);
  params.append('pageSize', pageSize);

  if (statusFilter && statusFilter.length > 0) {
    params.append('status', statusFilter.join(','));
  }
  if (sortBy) {
    params.append('sortBy', sortBy);
  }
  if (searchTerm && searchTerm.trim() !== '') {
    params.append('searchTerm', searchTerm.trim());
  }
  const queryString = params.toString();
  const endpoint = `/words/language/${languageId}/paginated${queryString ? `?${queryString}` : ''}`;
  return fetchApi(endpoint);
};

// Triggers CSV export for words, with optional filtering
export const exportWordsCsv = (languageId = null, statusFilter = []) => {
  const params = new URLSearchParams();
  if (languageId) {
    params.append('languageId', languageId);
  }
  if (statusFilter && statusFilter.length > 0) {
    params.append('status', statusFilter.join(','));
  }
  const queryString = params.toString();
  const endpoint = `/words/export${queryString ? `?${queryString}` : ''}`; // Remove leading /api
  // Use fetchApiDownload for file downloads
  return fetchApiDownload(endpoint);
};

// Translation API
export const translateText = async (text, sourceLanguageCode, targetLanguageCode, { signal } = {}) => {
  try {
    const payload = {
      text,
      sourceLanguageCode,
      targetLanguageCode
    };
    return await fetchApi('/translation', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal
    });
  } catch (error) {
    console.error('Translation failed:', error);
    throw error;
  }
};

// Story Generation API
export const generateStory = async (prompt, language, level, maxLength) => {
  try {
    const payload = {
      prompt,
      language,
      level,
      maxLength
    };
    return await fetchApi('/storygeneration', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Story generation failed:', error);
    throw error;
  }
};

// Summarization API
export const summarizeText = async (text, sourceLanguageCode, targetLanguageCode, maxSummaryWords = 200) => {
  try {
    const payload = {
      text,
      sourceLanguageCode,
      targetLanguageCode,
      maxSummaryWords
    };

    return await fetchApi('/summarization', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Summarization failed:', error);
    throw error;
  }
};

// SRS Story Generation API
export const generateSrsStory = async (languageId, { theme, maxWords, maxLength, status, style, cardType, tense } = {}) => {
  try {
    const payload = { languageId, theme, maxWords, maxLength, style, status: status?.join(','), cardType, tense };
    return await fetchApi('/srs/story-generate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('SRS story generation failed:', error);
    throw error;
  }
};

export const translateSentence = async (text, sourceLanguageCode, targetLanguageCode, { signal } = {}) => {
  try {
    console.log('Initiating sentence translation request');

    const payload = {
      text,
      sourceLanguageCode,
      targetLanguageCode
    };

    const response = await fetchApi('/sentencetranslation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload),
      signal
    });

    return response;
  } catch (error) {
    console.error('Sentence translation failed:', error);
    throw error;
  }
};

export const translateSelectionWithContext = async (selectedText, sentenceContext, sourceLanguageCode, targetLanguageCode, { signal } = {}) => {
  try {
    const payload = {
      selectedText,
      sentenceContext,
      sourceLanguageCode,
      targetLanguageCode
    };

    const response = await fetchApi('/sentencetranslation/selection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload),
      signal
    });

    return response;
  } catch (error) {
    console.error('Selection translation failed:', error);
    throw error;
  }
};

export const explainSentence = async (text, sourceLanguageCode, targetLanguageCode) => {
  try {
    const payload = {
      text,
      sourceLanguageCode,
      targetLanguageCode
    };

    return await fetchApi('/sentencetranslation/explain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Sentence explanation failed:', error);
    throw error;
  }
};

export const translateFullText = async (text, sourceLanguageCode, targetLanguageCode) => {
  try {
    console.log('Initiating full text translation request');

    const payload = {
      text,
      sourceLanguageCode,
      targetLanguageCode
    };

    const response = await fetchApi('/sentencetranslation/full-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    return response;
  } catch (error) {
    console.error('Full text translation failed:', error);
    throw error;
  }
};

export const getSupportedLanguages = () => {
  return fetchApi('/translation/languages'); // Keep this one as /api/translation/languages might be distinct
};

// Get next lesson from a book
export const getNextLesson = (bookId, currentTextId) => {
  return fetchApi(`/books/${bookId}/next-lesson?currentTextId=${currentTextId}`);
};

// User Settings API
export const getUserSettings = async () => {
  try {
    return await fetchApi('/usersettings');
  } catch (error) {
    console.error('Failed to get user settings:', error);
    throw error;
  }
};

export const updateUserSettings = async (settings) => {
  try {
    return await fetchApi('/usersettings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  } catch (error) {
    console.error('Failed to update user settings:', error);
    throw error;
  }
};

export const sendDiscordReport = async (period = 'week', days = null) => {
  const params = new URLSearchParams({ period });
  if (period === 'days' && days) {
    params.append('days', days);
  }

  return fetchApi(`/usersettings/discord/report?${params.toString()}`, {
    method: 'POST'
  });
};

// Test OpenRouter connection
export const testOpenRouterConnection = async () => {
  console.log('[API] Testing OpenRouter connection');
  return await fetchApi('/usersettings/test-openrouter', {
    method: 'POST'
  });
};

// Get total audio storage size
export const getAudioStorageSize = async () => {
  try {
    console.log('[API] Getting audio storage size');
    return await fetchApi('/usersettings/audio-storage-size');
  } catch (error) {
    console.error('Failed to get audio storage size:', error);
    throw error;
  }
};

// Updated updateAudiobookProgress function (requires bookId)
export const updateAudiobookProgress = async (bookId, progressData, options = {}) => {
  // progressData should be { currentAudiobookTrackId: number | null, currentAudiobookPosition: number | null }
  const payload = {
    bookId: bookId,
    currentAudiobookTrackId: progressData.currentAudiobookTrackId,
    currentAudiobookPosition: progressData.currentAudiobookPosition
  };
  console.log('[API] Updating audiobook progress via UserActivityController:', payload);
  return await fetchApi('/activity/audiobookprogress', {
    ...options,
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

// Updated function to get audiobook progress specifically (requires bookId)
export const getAudiobookProgress = async (bookId) => {
  console.log(`[API] Getting audiobook progress for book ${bookId} via UserActivityController`);
  // Point to the new endpoint in UserActivityController, appending bookId
  return await fetchApi(`/activity/audiobookprogress/${bookId}`); // GET request by default
};

// --- Audio Lesson Progress ---

// Update audio lesson progress (requires textId)
export const updateAudioLessonProgress = async (textId, progressData, options = {}) => {
  // progressData should be { currentPosition: number | null }
  const payload = {
    textId: parseInt(textId, 10),
    currentPosition: progressData.currentPosition
  };
  console.log('[API] Updating audio lesson progress via UserActivityController:', payload);
  return await fetchApi('/activity/audiolessonprogress', {
    ...options,
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

// Get audio lesson progress (requires textId)
export const getAudioLessonProgress = async (textId) => {
  console.log(`[API] Getting audio lesson progress for text ${textId} via UserActivityController`);
  // Point to the new endpoint in UserActivityController, appending textId
  return await fetchApi(`/activity/audiolessonprogress/${textId}`); // GET request by default
};

// Added logListeningActivity function
export const logListeningActivity = async (languageId, durationSeconds, options = {}) => {
  console.log(`[API] Logging listening activity: Lang ${languageId}, Duration ${durationSeconds}s`);
  const payload = { languageId, durationSeconds };
  return await fetchApi('/activity/logListening', {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

// Add logManualActivity function
export const logManualActivity = async (payload) => {
  console.log('[API] Logging manual activity:', payload);
  return await fetchApi('/activity/logManual', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getSentenceProgress = async (textId) => {
  return await fetchApi(`/activity/sentenceprogress/${textId}`);
};

export const logSentenceReadActivity = async (payload) => {
  return await fetchApi('/activity/logSentenceRead', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};
// Add near other translation functions

export const batchTranslateWords = async (words, targetLanguageCode, sourceLanguageCode = null) => {
  try {
    const payload = {
      words,
      targetLanguageCode,
      sourceLanguageCode // Optional
    };
    console.log(`[API] Sending batch translation request for ${words.length} words from ${sourceLanguageCode || 'auto'} to ${targetLanguageCode}`);
    // Assuming the endpoint is /api/translation/batch based on backend changes
    return await fetchApi('/translation/batch', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Batch translation failed:', error);
    throw error;
  }
};

// Add near other word functions

/**
 * Add a batch of terms and their translations to the database.
 * @param {string} languageId - The language ID.
 * @param {Array<{term: string, translation: string}>} terms - Array of objects with term and translation.
 * @returns {Promise<any>}
 */
export const addTermsBatch = async (languageId, terms) => {
  try {
    // The backend expects: [{ term: string, translation: string }]
    // The endpoint is /api/words/batch
    const payload = {
      languageId,
      terms
    };
    return await fetchApi('/words/batch', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Batch add terms failed:', error);
    throw error;
  }
};

// --- Admin API ---
// Backup Database
export const backupDatabase = async () => {
  console.log('[API] Requesting database backup download');
  // Use the specialized download helper
  const { blob, filename } = await fetchApiDownload('/datamanagement/backup', { // Remove leading /api
    method: 'GET',
  });


  // Trigger download in the browser
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
  console.log(`[API] Backup download triggered as ${filename}`);
  return { message: `Backup download started as ${filename}` }; // Return success message
};
// Restore Database
export const restoreDatabase = async (backupFile) => {
  const endpoint = '/datamanagement/restore'; // REMOVED leading /api
  console.log(`[API] Uploading database backup file: ${backupFile.name}`);


  if (!backupFile) {
    throw new Error('Backup file is required for restore.');
  }

  try {
    const headers = {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const formData = new FormData();
    formData.append('backupFile', backupFile);

    const requestConfig = {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint; // Directly concatenate the relative path
    console.log('[API Debug] Full URL for restore:', fullUrl.toString());

    const response = await fetch(fullUrl.toString(), requestConfig);
    console.log('[API Debug] Restore response status:', response.status);

    // Handle response (expecting JSON success/error message)
    const responseData = await response.json();

    if (!response.ok) {
      const errorMessage = responseData.message || responseData.title || `HTTP error! Status: ${response.status}`;
      console.error('[API Error] Database restore failed:', errorMessage);
      throw new Error(errorMessage);
    }

    console.log('[API Debug] Restore response data:', responseData);
    return responseData; // Should contain { message: "..." } on success

  } catch (error) {
    console.error('[API Error] Failed to restore database:', error);
    throw error; // Re-throw to be caught by calling component
  }
};
// --- SRS (Spaced Repetition System) API ---

export const getSrsDueCards = async (languageId = null, { status, onlyOneTarget = false, limit = 50 } = {}) => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', languageId);
  if (status && status.length > 0) params.append('status', status.join(','));
  if (onlyOneTarget) params.append('onlyOneTarget', 'true');
  params.append('limit', limit);
  const queryString = params.toString();
  return await fetchApi(`/srs/due${queryString ? `?${queryString}` : ''}`);
};

export const submitSrsReview = async (srsCardReviewId, grade) => {
  return await fetchApi('/srs/review', {
    method: 'POST',
    body: JSON.stringify({ srsCardReviewId, grade })
  });
};

export const mineSentence = async (wordId, sentence, textId = null, textTitle = null) => {
  return await fetchApi('/srs/mine', {
    method: 'POST',
    body: JSON.stringify({ wordId, sentence, textId, textTitle })
  });
};

export const getSrsPhrases = async (wordId) => {
  return await fetchApi(`/srs/phrases/${wordId}`);
};

export const deleteSrsPhrase = async (phraseId) => {
  return await fetchApi(`/srs/phrases/${phraseId}`, {
    method: 'DELETE'
  });
};

export const getSrsStats = async (languageId = null) => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', languageId);
  const queryString = params.toString();
  return await fetchApi(`/srs/stats${queryString ? `?${queryString}` : ''}`);
};

export const undoSrsReview = async () => {
  return await fetchApi('/srs/undo', {
    method: 'POST'
  });
};

export const getSrsForecast = async (languageId = null, days = 14) => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', languageId);
  params.append('days', days);
  const queryString = params.toString();
  return await fetchApi(`/srs/forecast${queryString ? `?${queryString}` : ''}`);
};

export const suspendSrsCard = async (cardId) => {
  return await fetchApi(`/srs/suspend/${cardId}`, { method: 'POST' });
};

export const unsuspendSrsCard = async (cardId) => {
  return await fetchApi(`/srs/unsuspend/${cardId}`, { method: 'POST' });
};

export const burySrsCard = async (cardId) => {
  return await fetchApi(`/srs/bury/${cardId}`, { method: 'POST' });
};

export const updateSrsCard = async (cardId, { flag, tags } = {}) => {
  const body = {};
  if (flag !== undefined) body.flag = flag;
  if (tags !== undefined) body.tags = tags;
  return await fetchApi(`/srs/cards/${cardId}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
};

export const getSrsHeatmap = async (days = 365) => {
  const params = new URLSearchParams();
  params.append('days', days);
  const queryString = params.toString();
  return await fetchApi(`/srs/heatmap${queryString ? `?${queryString}` : ''}`);
};

export const getSrsAnalytics = async (languageId = null) => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', languageId);
  const queryString = params.toString();
  return await fetchApi(`/srs/analytics${queryString ? `?${queryString}` : ''}`);
};

export const getSrsStories = async (languageId = null) => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', languageId);
  const queryString = params.toString();
  return await fetchApi(`/srs/stories${queryString ? `?${queryString}` : ''}`);
};

export const applySrsReadingCredit = async (wordId) => {
  return await fetchApi(`/srs/reading-credit/${wordId}`, { method: 'POST' });
};

// ==================== Library / Folders ====================

export const getLibraryContents = async (folderId = null) => {
  const params = new URLSearchParams();
  if (folderId) params.append('folderId', folderId);
  const queryString = params.toString();
  return await fetchApi(`/folders/library${queryString ? `?${queryString}` : ''}`);
};

export const deleteLibraryItems = async (textIds = null, bookIds = null, folderIds = null) => {
  const params = new URLSearchParams();
  if (textIds?.length) params.append('textIds', textIds.join(','));
  if (bookIds?.length) params.append('bookIds', bookIds.join(','));
  if (folderIds?.length) params.append('folderIds', folderIds.join(','));
  return await fetchApi(`/folders/delete-items?${params.toString()}`, { method: 'DELETE' });
};

export const getFolders = async () => {
  return await fetchApi('/folders');
};

export const createFolder = async (name, parentFolderId = null, color = null, languageId = null) => {
  return await fetchApi('/folders', {
    method: 'POST',
    body: JSON.stringify({ name, parentFolderId, color, languageId })
  });
};

export const updateFolder = async (folderId, data) => {
  return await fetchApi(`/folders/${folderId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const deleteFolder = async (folderId) => {
  return await fetchApi(`/folders/${folderId}`, { method: 'DELETE' });
};

export const moveLibraryItems = async (textIds = null, bookIds = null, folderIds = null, targetFolderId = null) => {
  return await fetchApi('/folders/move-items', {
    method: 'PUT',
    body: JSON.stringify({ textIds, bookIds, folderIds, targetFolderId })
  });
};

export const reorderLibraryItems = async (folderId, items) => {
  return await fetchApi('/folders/reorder', {
    method: 'PUT',
    body: JSON.stringify({ folderId, items })
  });
};
