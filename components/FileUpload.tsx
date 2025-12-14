import React, { useCallback, useState } from 'react';
import { AppState } from '../types';

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  appState: AppState;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelected, appState }) => {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setErrorMsg(null);

    if (file) {
      const fileName = file.name.toLowerCase();
      
      // 1. Check Extension (Case-insensitive via toLowerCase above)
      // Added common mobile recording formats
      const hasValidExtension = /\.(mp3|wav|flac|m4a|aac|ogg|oga|weba|apk\.1)$/.test(fileName);
      
      // 2. Check MIME type (Relaxed for mobile)
      // Mobile browsers often report "" or "application/octet-stream", so we rely heavily on extension if MIME is vague.
      const validAudioPrefixes = ['audio/', 'video/mp4', 'video/webm', 'application/ogg', 'application/octet-stream'];
      const hasValidMime = validAudioPrefixes.some(prefix => file.type.startsWith(prefix)) || file.type === "";

      if (hasValidExtension || (hasValidMime && file.type !== "" && file.type !== "application/octet-stream")) {
        onFileSelected(file);
      } else {
        console.warn("Rejected file:", file.name, file.type);
        setErrorMsg(`Unsupported file type: ${file.name} (${file.type || 'unknown'}). Please use MP3, M4A, or WAV.`);
      }
    }
  }, [onFileSelected]);

  return (
    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors h-64">
      <div className="text-center space-y-4">
        <div className="bg-blue-100 p-4 rounded-full inline-block">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Import Audio</h3>
          <p className="text-sm text-slate-500 mt-1">Supports MP3, WAV, FLAC, M4A</p>
        </div>
        
        <label className={`cursor-pointer inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${appState === AppState.PROCESSING ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}>
          <span>{appState === AppState.PROCESSING ? 'Processing...' : 'Select File'}</span>
          <input 
            type="file" 
            className="hidden" 
            accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga"
            onChange={handleInputChange}
            disabled={appState === AppState.PROCESSING}
          />
        </label>

        {errorMsg && (
          <p className="text-red-500 text-xs mt-2 px-4">{errorMsg}</p>
        )}
      </div>
    </div>
  );
};