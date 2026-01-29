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

// Word Modal Store
export const useWordModalStore = create((set) => ({
  isOpen: false,
  word: null,
  translation: '',
  openModal: (word, translation = '') => set({ isOpen: true, word, translation }),
  closeModal: () => set({ isOpen: false, word: null, translation: '' }),
  setTranslation: (translation) => set({ translation })
})); 