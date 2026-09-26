import { create } from 'zustand';
import { authStatus, authLogin, authLogout, authSetup } from './api';
import type { AuthUser } from './api/auth';
import { clearOfflineState } from './offline/cleanup';

// --- Auth Store ---

export type AuthState = {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  needsSetup: boolean;
  checkAuth: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  setup: (password: string) => Promise<void>;
};

export const useAuthStore = create<AuthState>()((set) => ({
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
        needsSetup: data.needsSetup ?? false,
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
    } catch {
      /* ignore */
    }
    // Wipe SW caches + offline queue so the next user on this browser
    // can't read User A's cached texts/audio or replay their queued
    // mutations under a new auth context.
    await clearOfflineState();
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

// --- Texts ---

// Shape consumed by text lists (e.g. the dashboard). Fields are optional because endpoints
// like TextDto, TextListDto, and RecentTextDto each carry different subsets.
// Backed structurally by api-types.d.ts so server shape drift surfaces here.
export type StoredText = {
  textId?: number;
  title?: string;
  content?: string;
  tag?: string;
  bookId?: number | null;
  languageId?: number;
  languageName?: string;
  isAudioLesson?: boolean;
  isFinished?: boolean;
  audioProgress?: number;
  wordCount?: number;
  totalWords?: number;
  knownWords?: number;
  learningWords?: number;
  unknownWords?: number;
  unknownWordPercentage?: number | null;
  createdAt?: string;
};

// --- Current Text Store ---

export type CurrentWord = {
  wordId: number;
  term?: string;
  translation?: string;
  status?: number;
  isNew?: boolean;
};

export type CurrentText = {
  textId?: number;
  title?: string;
  content?: string;
  languageId?: number;
  languageCode?: string;
  bookId?: number | null;
  partNumber?: number;
  words?: CurrentWord[];
};

export type CurrentTextState = {
  text: CurrentText | null;
  loading: boolean;
  error: string | null;
  setText: (text: CurrentText | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updateWord: (wordId: number, status: number) => void;
};

export const useCurrentTextStore = create<CurrentTextState>()((set) => ({
  text: null,
  loading: false,
  error: null,
  setText: (text) => set({ text }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  updateWord: (wordId, status) =>
    set((state) => ({
      text: state.text
        ? {
            ...state.text,
            words: (state.text.words || []).map((word) =>
              word.wordId === wordId ? { ...word, status } : word
            )
          }
        : state.text
    }))
}));

// --- Library Store ---

export type SelectableType = 'text' | 'book' | 'folder';
export type SelectedItem = { id: number; type: SelectableType };

export type LibraryFolder = {
  folderId?: number;
  name?: string | null;
  color?: string | null;
  itemCount?: number;
  parentFolderId?: number | null;
};

export type LibraryBook = {
  bookId?: number;
  title?: string | null;
  author?: string | null;
  createdAt?: string;
  lastReadAt?: string | null;
  coverImagePath?: string | null;
  isFinished?: boolean;
  languageName?: string | null;
  partCount?: number;
  finishedPartCount?: number;
  completionPercentage?: number;
  totalWords?: number;
  knownWords?: number;
  unknownWords?: number;
  unknownWordPercentage?: number | null;
  tags?: string[] | null;
  lastReadTextId?: number | null;
};

export type LibraryText = {
  textId?: number;
  title?: string | null;
  isAudioLesson?: boolean;
  isFinished?: boolean;
  languageName?: string | null;
  tag?: string | null;
  createdAt?: string;
  lastAccessedAt?: string | null;
  totalWords?: number;
  knownWords?: number;
  unknownWords?: number;
  unknownWordPercentage?: number | null;
};
export type Breadcrumb = { folderId?: number | null; name?: string | null };

export type LibraryContentsPayload = {
  // The folder these contents were loaded for (null = library root).
  folderId: number | null;
  currentFolder: LibraryFolder | null;
  breadcrumbs: Breadcrumb[];
  folders: LibraryFolder[];
  books: LibraryBook[];
  texts: LibraryText[];
};

export type LibraryState = {
  // Folder the current contents belong to; undefined until the first load. The page compares it
  // with the URL so it never shows (or lets you act on) the previous folder's items.
  contentsFolderId: number | null | undefined;
  currentFolder: LibraryFolder | null;
  breadcrumbs: Breadcrumb[];
  folders: LibraryFolder[];
  books: LibraryBook[];
  texts: LibraryText[];
  allFolders: LibraryFolder[];
  loading: boolean;
  error: string | null;
  selectedItems: SelectedItem[];
  lastClickedItem: SelectedItem | null;
  setContents: (data: LibraryContentsPayload) => void;
  setSectionOrder: (type: SelectableType, orderedIds: number[]) => void;
  setAllFolders: (folders: LibraryFolder[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedItems: (items: SelectedItem[]) => void;
  setLastClickedItem: (item: SelectedItem | null) => void;
  toggleSelectItem: (id: number, type: SelectableType) => void;
  clearSelection: () => void;
};

const orderBy = <T>(items: T[], idOf: (item: T) => number | undefined, orderedIds: number[]): T[] => {
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) => (position.get(idOf(a) ?? -1) ?? Infinity) - (position.get(idOf(b) ?? -1) ?? Infinity)
  );
};

export const useLibraryStore = create<LibraryState>()((set) => ({
  contentsFolderId: undefined,
  currentFolder: null,
  breadcrumbs: [],
  folders: [],
  books: [],
  texts: [],
  allFolders: [],
  loading: false,
  error: null,
  selectedItems: [],
  lastClickedItem: null,
  setContents: (data) =>
    set({
      contentsFolderId: data.folderId,
      currentFolder: data.currentFolder,
      breadcrumbs: data.breadcrumbs,
      folders: data.folders,
      books: data.books,
      texts: data.texts
    }),
  setSectionOrder: (type, orderedIds) =>
    set((state) => {
      if (type === 'folder') return { folders: orderBy(state.folders, (f) => f.folderId, orderedIds) };
      if (type === 'book') return { books: orderBy(state.books, (b) => b.bookId, orderedIds) };
      return { texts: orderBy(state.texts, (t) => t.textId, orderedIds) };
    }),
  setAllFolders: (folders) => set({ allFolders: folders }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSelectedItems: (items) => set({ selectedItems: items }),
  setLastClickedItem: (item) => set({ lastClickedItem: item }),
  toggleSelectItem: (id, type) =>
    set((state) => {
      const exists = state.selectedItems.find((i) => i.id === id && i.type === type);
      if (exists) {
        return {
          selectedItems: state.selectedItems.filter((i) => !(i.id === id && i.type === type))
        };
      }
      return { selectedItems: [...state.selectedItems, { id, type }] };
    }),
  clearSelection: () => set({ selectedItems: [], lastClickedItem: null })
}));

// --- Word Modal Store ---

export type ModalWord = {
  term?: string;
  wordId?: number;
  translation?: string;
  status?: number;
  nextReviewDate?: string | null;
};

export type WordModalState = {
  isOpen: boolean;
  word: ModalWord | null;
  translation: string;
  openModal: (word: ModalWord, translation?: string) => void;
  closeModal: () => void;
  setTranslation: (translation: string) => void;
};

export const useWordModalStore = create<WordModalState>()((set) => ({
  isOpen: false,
  word: null,
  translation: '',
  openModal: (word, translation = '') => set({ isOpen: true, word, translation }),
  closeModal: () => set({ isOpen: false, word: null, translation: '' }),
  setTranslation: (translation) => set({ translation })
}));
