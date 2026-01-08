// Import Platform from react-native
import { Platform } from 'react-native';
// import storage from './storage'; // Removed unused storage

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

export const API_URL = Platform.OS === 'web' ? WEB_API_BASE_URL : MOBILE_API_BASE_URL;

// Helper function to get token from storage
const getToken = () => {
  try {
    const token = localStorage.getItem('token');
    if (!token) {
      return null;
    }
    return token;
  } catch (error) {
    console.error('Error retrieving token:', error);
    return null;
  }
};

// Helper function for making API requests
const fetchApi = async (endpoint, options = {}) => {
  // Ensure endpoint starts with a slash
  if (!endpoint.startsWith('/')) {
    endpoint = '/' + endpoint;
  }

  try {
    const token = getToken();

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // --- DEBUG: Log token status specifically for /usersettings ---
    if (endpoint === '/usersettings') {
      console.log(`[fetchApi DEBUG /usersettings] Token check: token exists=${!!token}, type=${typeof token}, trimmed length=${token?.trim().length ?? 'N/A'}`);
    }
    // --- END DEBUG ---

    // Only add Authorization header if token exists and is a string
    if (token && typeof token === 'string' && token.trim() !== '') {
      const cleanToken = token.trim();
      headers.Authorization = `Bearer ${cleanToken}`;
      // Authorization header added
    } else {
       // Allow /usersettings even without token initially? Or rely on context to call only when logged in?
       // For now, let's assume /usersettings REQUIRES auth like others, except login/register.
      if (endpoint !== '/auth/login' && endpoint !== '/auth/register') {
        // --- DEBUG: Log auth error trigger ---
        if (endpoint === '/usersettings') {
           console.log(`[fetchApi DEBUG /usersettings] Throwing 'Authentication required' because token check failed.`);
        }
        // --- END DEBUG ---
        throw new Error('Authentication required');
      }
    }

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
    const fullUrl = API_URL + endpoint; // Directly concatenate the relative path

    const response = await fetch(fullUrl.toString(), requestConfig);

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

      throw new Error(errorMessage);
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
    const token = getToken();
    console.log('[API Download Debug] Endpoint:', endpoint);
    const headers = {
      // Accept might vary depending on what the server sends, but often octet-stream for downloads
      'Accept': 'application/octet-stream',
      // No Content-Type needed for GET
    };

    if (token && typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token.trim()}`;
    } else {
      // Authentication is likely required for admin actions
      throw new Error('Authentication required for download');
    }

    const requestConfig = {
      ...options,
      headers,
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint; // Directly concatenate the relative path
    console.log('[API Download Debug] Full URL:', fullUrl.toString());

    const response = await fetch(fullUrl.toString(), requestConfig);
    console.log('[API Download Debug] Response status:', response.status);

    if (!response.ok) {
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
    console.log('Testing API connection to server using /api/Health');
    // Use the dedicated, unauthenticated health check endpoint
    const response = await fetch(`${API_URL}/Health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      mode: 'cors'
    });
    console.log('API response status:', response.status);
    return response.ok;
  } catch (error) {
    console.error('API connection error:', error);
    return false;
  }
};

// Auth API
// Modified for auto-login: No longer sends email/password
export const login = () => {
  return fetchApi('/auth/login', {
    method: 'POST'
    // No body needed for the auto-login endpoint
  });
};

// REMOVED register function as it's no longer used

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

// Texts API
export const getTexts = () => {
  return fetchApi('/texts');
};

export const getText = (textId) => {
  return fetchApi(`/texts/${textId}`);
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
export const createAudioLesson = async (title, languageId, audioFile, srtFile, tag = null) => {
  const endpoint = '/texts/audio';
  console.log(`[API] Creating audio lesson: "${title}" with tag: ${tag || 'none'}`);

  try {
    const token = getToken();
    const headers = {
      'Accept': 'application/json',
      // DO NOT set Content-Type for FormData, browser does it with boundary
    };

    if (token && typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token.trim()}`;
      console.log('[API Debug] Authorization header added for audio lesson upload');
    } else {
       console.log('[API Debug] No token available for audio lesson upload');
       // Decide if auth is strictly required for this endpoint based on backend
       throw new Error('Authentication required to create audio lesson');
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('languageId', languageId);
    formData.append('audioFile', audioFile); // The File object
    formData.append('srtFile', srtFile);     // The File object
    if (tag) {
      formData.append('tag', tag); // Add tag if provided
    }

    const requestConfig = {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include', // Keep consistent with fetchApi
      mode: 'cors'           // Keep consistent with fetchApi
    };

    const fullUrl = API_URL + endpoint; // Directly concatenate the relative path
    console.log('[API Debug] Full URL for audio lesson:', fullUrl.toString());
    console.log('[API Debug] Request config for audio lesson:', {
        method: requestConfig.method,
        headers: requestConfig.headers, // Log headers (excluding Content-Type)
        credentials: requestConfig.credentials,
        mode: requestConfig.mode
    });

    const response = await fetch(fullUrl.toString(), requestConfig);
    console.log('[API Debug] Audio lesson creation response status:', response.status);

    if (!response.ok) {
      let errorMessage = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
         // If response is not JSON, try to get text
         try {
            const text = await response.text();
            errorMessage = text || errorMessage;
         } catch (textError) {
            // Keep the original status code error
         }
      }
      console.error('[API Error] Audio lesson creation failed:', errorMessage);
      throw new Error(errorMessage);
    }

    // Parse successful response (assuming backend returns JSON like other create endpoints)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      console.log('[API Debug] Audio lesson creation response data:', data);
      return data;
    } else {
      console.log('[API Debug] Non-JSON response for audio lesson creation.');
      return { message: response.statusText }; // Or handle as appropriate
    }

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
export const uploadBook = async (formData) => {
  const endpoint = '/books/upload';
  console.log(`[API] Uploading book file...`);

  try {
    const token = getToken();
    const headers = {
      'Accept': 'application/json',
      // Content-Type is NOT set for FormData, browser handles it
    };

    if (token && typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token.trim()}`;
    } else {
       throw new Error('Authentication required for book upload');
    }

    const requestConfig = {
      method: 'POST',
      headers,
      body: formData, // FormData object
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint; // Directly concatenate the relative path
    console.log('[API Debug] Full URL for book upload:', fullUrl.toString());

    const response = await fetch(fullUrl.toString(), requestConfig);
    console.log('[API Debug] Book upload response status:', response.status);

    if (!response.ok) {
      let errorMessage = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.title || errorMessage;
      } catch (e) {
         try { const text = await response.text(); errorMessage = text || errorMessage; } catch (textError) {}
      }
      console.error('[API Error] Book upload failed:', errorMessage);
      throw new Error(errorMessage);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      console.log('[API Debug] Book upload response data:', data);
      return data; // Should be the created BookDto
    } else {
      console.log('[API Debug] Non-JSON response for book upload.');
      return { message: response.statusText };
    }

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
export const uploadAudiobookTracks = async (bookId, formData) => {
  const endpoint = `/books/${bookId}/audiobook`;
  console.log(`[API] Uploading audiobook tracks for book ${bookId}...`);

  try {
    const token = getToken();
    const headers = {
      'Accept': 'application/json',
      // Content-Type is NOT set for FormData, browser handles it
    };

    if (token && typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token.trim()}`;
    } else {
       throw new Error('Authentication required for audiobook upload');
    }

    const requestConfig = {
      method: 'POST',
      headers,
      body: formData, // FormData object
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint; // Directly concatenate the relative path
    console.log('[API Debug] Full URL for audiobook upload:', fullUrl.toString());

    const response = await fetch(fullUrl.toString(), requestConfig);
    console.log('[API Debug] Audiobook upload response status:', response.status);

    if (!response.ok) {
      let errorMessage = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.title || errorMessage;
      } catch (e) {
         try { const text = await response.text(); errorMessage = text || errorMessage; } catch (textError) {}
      }
      console.error('[API Error] Audiobook upload failed:', errorMessage);
      throw new Error(errorMessage);
    }

    // Check if response has content before trying to parse JSON
    const contentType = response.headers.get('content-type');
    if (response.status === 204 || !contentType) { // 204 No Content
        console.log('[API Debug] Audiobook upload successful (No Content).');
        return { message: 'Upload successful' }; // Or return null/undefined
    } else if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      console.log('[API Debug] Audiobook upload response data:', data);
      return data;
    } else {
      const text = await response.text();
      console.log('[API Debug] Non-JSON response for audiobook upload:', text);
      return { message: text || response.statusText };
    }

  } catch (error) {
    console.error('[API Error] Failed to upload audiobook tracks:', error);
    throw error;
  }
};

// Add createAudioLessonsBatch function
export const createAudioLessonsBatch = async (languageId, tag, files) => {
  const endpoint = '/texts/audio/batch';
  console.log(`[API] Creating batch audio lessons for language ${languageId} with tag: ${tag || 'none'}`);

  try {
    const token = getToken();
    const headers = {
      'Accept': 'application/json',
      // Content-Type is set automatically by browser for FormData
    };

    if (token && typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token.trim()}`;
    } else {
       throw new Error('Authentication required for batch upload');
    }

    const formData = new FormData();
    formData.append('languageId', languageId);
    if (tag) {
      formData.append('tag', tag);
    }
    // Append all files under the same key 'files'
    // Note: The backend expects List<IFormFile> files, so the key should match the parameter name.
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }


    const requestConfig = {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint; // Directly concatenate the relative path
    console.log('[API Debug] Full URL for batch audio lesson:', fullUrl.toString());

    const response = await fetch(fullUrl.toString(), requestConfig);
    console.log('[API Debug] Batch audio lesson creation response status:', response.status);

    // Handle response (similar to single audio lesson upload)
    if (!response.ok) {
      let errorMessage = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = await response.json();
        // Include skipped files info if available in error response
        errorMessage = errorData.message || errorData.title || errorMessage;
        if (errorData.skippedFiles) {
            errorMessage += ` Skipped: ${errorData.skippedFiles.join(', ')}`;
        }
      } catch (e) {
         try { const text = await response.text(); errorMessage = text || errorMessage; } catch (textError) {}
      }
      console.error('[API Error] Batch audio lesson creation failed:', errorMessage);
      throw new Error(errorMessage);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      console.log('[API Debug] Batch audio lesson creation response data:', data);
      return data; // Should contain { createdCount, skippedFiles }
    } else {
      console.log('[API Debug] Non-JSON response for batch audio lesson creation.');
      return { message: response.statusText };
    }

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

// User Statistics API
export const getUserStatistics = () => {
  return fetchApi('/users/statistics');
};

export const getReadingActivity = async (period = 'all', timezoneOffsetMinutes = null) => {
  try {
    const tzParam = timezoneOffsetMinutes !== null ? `&timezoneOffsetMinutes=${timezoneOffsetMinutes}` : '';
    console.log(`[API] Getting reading activity for period: ${period}, timezoneOffsetMinutes: ${timezoneOffsetMinutes}`);
    const data = await fetchApi(`/users/reading-activity?period=${period}${tzParam}`);
    return data;
  } catch (error) {
    console.error('Error getting reading activity:', error);
    return { error: error.message };
  }
};

// Fetch listening activity data
export const getListeningActivity = async (period = 'all', timezoneOffsetMinutes = null) => {
  try {
    let tzParam = '';
    if (timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== undefined) {
      tzParam = `&timezoneOffsetMinutes=${timezoneOffsetMinutes}`;
    }
    console.log(`[API] Fetching listening activity for period: ${period}, timezoneOffsetMinutes: ${timezoneOffsetMinutes}`);
    const data = await fetchApi(`/users/listening-activity?period=${period}${tzParam}`);
    return data;
  } catch (error) {
    console.error('Error getting listening activity:', error);
    return { error: error.message }; // Return error object on failure
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
export const createWord = async (textId, term, status, translation) => {
  try {
    // Validate inputs
    if (!textId) throw new Error('Text ID is required');
    if (!term || term.trim() === '') throw new Error('Word term is required');
    if (!status) throw new Error('Word status is required');

    console.log(`[API] Creating word: "${term}" with status: ${status}`);

    const payload = {
      textId,
      term: term.trim(),
      status,
      translation: translation || null
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
      translation: translation || null
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
export const translateText = async (text, sourceLanguageCode, targetLanguageCode) => {
  try {
    const payload = {
      text,
      sourceLanguageCode,
      targetLanguageCode
    };
    return await fetchApi('/translation', {
      method: 'POST',
      body: JSON.stringify(payload)
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

export const translateSentence = async (text, sourceLanguageCode, targetLanguageCode) => {
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
      body: JSON.stringify(payload)
    });

    return response;
  } catch (error) {
    console.error('Sentence translation failed:', error);
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

// Updated updateAudiobookProgress function (requires bookId)
export const updateAudiobookProgress = async (bookId, progressData) => {
  // progressData should be { currentAudiobookTrackId: number | null, currentAudiobookPosition: number | null }
  const payload = {
    bookId: bookId,
    currentAudiobookTrackId: progressData.currentAudiobookTrackId,
    currentAudiobookPosition: progressData.currentAudiobookPosition
  };
  console.log('[API] Updating audiobook progress via UserActivityController:', payload);
  return await fetchApi('/activity/audiobookprogress', {
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
export const updateAudioLessonProgress = async (textId, progressData) => {
  // progressData should be { currentPosition: number | null }
  const payload = {
    textId: textId,
    currentPosition: progressData.currentPosition
  };
  console.log('[API] Updating audio lesson progress via UserActivityController:', payload);
  return await fetchApi('/activity/audiolessonprogress', {
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
export const logListeningActivity = async (languageId, durationSeconds) => {
  console.log(`[API] Logging listening activity: Lang ${languageId}, Duration ${durationSeconds}s`);
  const payload = { languageId, durationSeconds };
  return await fetchApi('/activity/logListening', {
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
// Add near other translation functions

export const batchTranslateWords = async (words, targetLanguageCode, sourceLanguageCode = null) => {
  try {
    const payload = {
      words,
      targetLanguageCode,
      sourceLanguageCode // Optional
    };
    console.log(`[API] Sending batch translation request for ${words.length} words to ${targetLanguageCode}`);
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
    const token = getToken();
    const headers = {
      'Accept': 'application/json', // Expect JSON response (success/error message)
      // DO NOT set Content-Type for FormData
    };

    if (token && typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token.trim()}`;
    } else {
       throw new Error('Authentication required for database restore');
    }

    const formData = new FormData();
    // Key 'backupFile' must match the parameter name in AdminController.RestoreDatabase
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
