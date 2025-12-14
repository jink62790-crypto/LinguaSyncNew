import { HistoryEntry, TranscriptionResponse } from '../types';

const DB_NAME = 'LinguaSyncDB';
const STORE_NAME = 'history';
const DB_VERSION = 1;

/**
 * Open (or create) the IndexedDB
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const historyDb = {
  /**
   * Save a session to history
   */
  save: async (file: File, transcription: TranscriptionResponse) => {
    const db = await openDB();
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      fileName: file.name,
      date: Date.now(),
      audioBlob: file, // File is a specific type of Blob
      transcription
    };

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(entry);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Get all history items (metadata only ideally, but IDB is fast enough for simple lists)
   */
  getAll: async (): Promise<HistoryEntry[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      // We want to sort by date descending, but simple getAll is easiest. 
      // We'll sort in memory.
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result as HistoryEntry[];
        resolve(results.sort((a, b) => b.date - a.date));
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Delete a specific history item
   */
  delete: async (id: string) => {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};
