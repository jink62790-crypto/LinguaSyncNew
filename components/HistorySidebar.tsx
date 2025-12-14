import React, { useEffect, useState } from 'react';
import { HistoryEntry } from '../types';
import { historyDb } from '../services/historyDb';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntry: (entry: HistoryEntry) => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({ isOpen, onClose, onSelectEntry }) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Load history whenever the sidebar opens
  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const items = await historyDb.getAll();
      setHistory(items);
    } catch (e) {
      console.error("Failed to load history", e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this file?")) {
      await historyDb.delete(id);
      loadHistory(); // Reload list
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-black/50 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      
      {/* Sidebar Panel */}
      <div className={`absolute top-0 right-0 h-full w-3/4 max-w-xs bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h2 className="font-bold text-slate-800 text-lg">History</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="text-center py-8 text-slate-400">Loading...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-slate-400 flex flex-col items-center gap-2">
                <svg className="w-12 h-12 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p>No history yet.</p>
                <p className="text-xs">Import a file to get started.</p>
            </div>
          ) : (
            history.map((item) => (
              <div 
                key={item.id}
                onClick={() => onSelectEntry(item)}
                className="group relative bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <div className="bg-blue-100 text-blue-600 p-1.5 rounded-lg shrink-0">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                        </div>
                        <h3 className="font-semibold text-slate-700 truncate text-sm">{item.fileName}</h3>
                    </div>
                </div>
                
                <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
                    <span>{formatDate(item.date)}</span>
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-medium">
                        {item.transcription.meta.estimatedLevel}
                    </span>
                </div>

                {/* Delete Button (Visible on Hover) */}
                <button 
                    onClick={(e) => handleDelete(e, item.id)}
                    className="absolute -top-2 -right-2 bg-red-100 text-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-500 hover:text-white"
                    title="Delete"
                >
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};
