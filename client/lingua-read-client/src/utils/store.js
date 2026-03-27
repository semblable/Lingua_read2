import { create } from 'zustand';
import { jwtDecode } from 'jwt-decode';

// Auth Store
export const useAuthStore = create((set) => ({
  token: null,
  user: null,
  setToken: (token) => {
    try {
      localStorage.setItem('token', token);
      const decodedToken = jwtDecode(token);
      set({
        token,
        user: {
          id: decodedToken.sub,
          email: decodedToken.email
        }
      });
    } catch (error) {
      console.error('Failed to decode token, clearing auth state.', error);
      localStorage.removeItem('token');
      set({ token: null, user: null });
    }
  },
  clearToken: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null });
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