import { create } from 'zustand';
import { authStatus, authLogin, authLogout, authSetup } from './api';

// Auth Store
export const useAuthStore = create((set) => ({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  needsSetup: false,
  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const data = await authStatus();
      set({
        isAuthenticated: data.authenticated,
        needsSetup: data.needsSetup,
        user: data.user || null,
        isLoading: false
      });
    } catch {
      set({ isAuthenticated: false, user: null, isLoading: false, needsSetup: false });
    }
  },
  login: async (password) => {
    const res = await authLogin(password);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Login failed.');
    }
    // After successful login, re-check auth status to get user info
    const status = await authStatus();
    set({
      isAuthenticated: status.authenticated,
      user: status.user || null,
      needsSetup: false
    });
  },
  logout: async () => {
    try {
      await authLogout();
    } catch { /* ignore */ }
    set({ isAuthenticated: false, user: null });
  },
  setup: async (password) => {
    const res = await authSetup(password);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Setup failed.');
    }
    const status = await authStatus();
    set({
      isAuthenticated: status.authenticated,
      user: status.user || null,
      needsSetup: false
    });
  }
}));

// Texts Store
export const useTextsStore = create((set) => ({
  texts: [],
  loading: false,
  error: null,
  setTexts: (texts) => set({ texts }),
  addText: (text) => set((state) => ({ texts: [...state.texts, text] })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}));

// Current Text Store
export const useCurrentTextStore = create((set) => ({
  text: null,
  loading: false,
  error: null,
  setText: (text) => set({ text }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  updateWord: (wordId, status) => set((state) => ({
    text: {
      ...state.text,
      words: state.text.words.map(word => 
        word.wordId === wordId 
          ? { ...word, status } 
          : word
      )
    }
  }))
}));

// Library Store
export const useLibraryStore = create((set) => ({
  currentFolder: null,
  breadcrumbs: [],
  folders: [],
  books: [],
  texts: [],
  allFolders: [], // flat list of all folders for move-to-folder modal
  loading: false,
  error: null,
  selectedItems: [], // { id, type } for multi-select
  setContents: (data) => set({
    currentFolder: data.currentFolder,
    breadcrumbs: data.breadcrumbs,
    folders: data.folders,
    books: data.books,
    texts: data.texts
  }),
  setAllFolders: (folders) => set({ allFolders: folders }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  toggleSelectItem: (id, type) => set((state) => {
    const exists = state.selectedItems.find(i => i.id === id && i.type === type);
    if (exists) {
      return { selectedItems: state.selectedItems.filter(i => !(i.id === id && i.type === type)) };
    }
    return { selectedItems: [...state.selectedItems, { id, type }] };
  }),
  clearSelection: () => set({ selectedItems: [] })
}));

// Word Modal Store
export const useWordModalStore = create((set) => ({
  isOpen: false,
  word: null,
  translation: '',
  openModal: (word, translation = '') => set({ isOpen: true, word, translation }),
  closeModal: () => set({ isOpen: false, word: null, translation: '' }),
  setTranslation: (translation) => set({ translation })
})); 