import React, { useState, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { TranscriptView } from './components/TranscriptView';
import { AudioPlayer } from './components/AudioPlayer';
import { ShadowingView } from './components/ShadowingView';
import { HistorySidebar } from './components/HistorySidebar';
import { transcribeAudio } from './services/geminiService';
import { historyDb } from './services/historyDb';
import { AppState, TranscriptionResponse, AudioFileMetadata, HistoryEntry } from './types';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [audioFile, setAudioFile] = useState<AudioFileMetadata | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionResponse | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTab, setActiveTab] = useState<'original' | 'notes' | 'favorites'>('original');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (audioFile?.url) URL.revokeObjectURL(audioFile.url);
    };
  }, [audioFile]);

  const handleFileSelected = async (file: File) => {
    try {
      setAppState(AppState.PROCESSING);
      setErrorDetails(null);
      const url = URL.createObjectURL(file);
      setAudioFile({
        name: file.name,
        size: file.size,
        type: file.type,
        url,
        originalFile: file
      });

      const result = await transcribeAudio(file);
      
      // Save to History DB
      try {
          await historyDb.save(file, result);
          console.log("Saved to history");
      } catch (e) {
          console.warn("Failed to save history", e);
      }

      setTranscription(result);
      setAppState(AppState.READY);
    } catch (err: any) {
      console.error("Transcription Error:", err);
      
      // Robust Error Parsing
      let msg = "An unexpected error occurred.";
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'object' && err !== null) {
        msg = JSON.stringify(err);
      } else {
        msg = String(err);
      }

      const lowerMsg = msg.toLowerCase();
      
      // Check for common error signatures
      if (
        lowerMsg.includes("api key is missing") || 
        lowerMsg.includes("401") || 
        lowerMsg.includes("unauthenticated") || 
        lowerMsg.includes("invalid authentication")
      ) {
        msg = "API_KEY_MISSING";
      } else if (
        lowerMsg.includes("internal error") || 
        lowerMsg.includes("500") || 
        lowerMsg.includes("503") || 
        lowerMsg.includes("overloaded")
      ) {
        msg = "SERVICE_UNAVAILABLE";
      } else if (
        lowerMsg.includes("fetch failed") || 
        lowerMsg.includes("network") ||
        lowerMsg.includes("failed to fetch")
      ) {
        msg = "NETWORK_ERROR";
      }

      setErrorDetails(msg);
      setAppState(AppState.ERROR);
    }
  };

  const handleLoadHistory = (entry: HistoryEntry) => {
    // Revoke previous URL if exists
    if (audioFile?.url) URL.revokeObjectURL(audioFile.url);

    // Create new blob URL from the stored blob
    const url = URL.createObjectURL(entry.audioBlob);
    
    // Set State directly to READY (Bypassing API)
    setAudioFile({
        name: entry.fileName,
        size: entry.audioBlob.size,
        type: entry.audioBlob.type,
        url: url,
        originalFile: entry.audioBlob as File
    });
    setTranscription(entry.transcription);
    setCurrentTime(0);
    setErrorDetails(null);
    setAppState(AppState.READY);
    setIsHistoryOpen(false);
  };

  const handleReset = () => {
    setAppState(AppState.IDLE);
    setAudioFile(null);
    setTranscription(null);
    setCurrentTime(0);
    setErrorDetails(null);
  };

  const handleToggleFavorite = (index: number) => {
    if (!transcription) return;
    const newSegments = [...transcription.segments];
    newSegments[index] = {
      ...newSegments[index],
      isFavorite: !newSegments[index].isFavorite
    };
    setTranscription({
      ...transcription,
      segments: newSegments
    });
  };

  // Filter segments for the Favorites tab
  const displayedSegments = activeTab === 'favorites' && transcription
    ? transcription.segments.filter(s => s.isFavorite)
    : transcription?.segments || [];

  return (
    <div className="h-screen w-full flex justify-center bg-gray-100">
    <div className="h-full w-full max-w-md bg-slate-50 shadow-2xl overflow-hidden relative flex flex-col font-sans">
      
      {/* Header */}
      <header className="bg-white px-4 pt-12 pb-2 shadow-sm shrink-0 z-20">
        <div className="flex items-center justify-between mb-4">
            <button onClick={handleReset} className={`p-2 -ml-2 text-slate-400 hover:text-slate-800 ${appState === AppState.IDLE ? 'opacity-0 pointer-events-none' : ''}`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-lg font-bold text-slate-800">LinguaSync</h1>
            <div className="flex gap-2">
                <button 
                    onClick={() => setIsHistoryOpen(true)}
                    className="p-2 text-slate-400 hover:text-blue-600 transition-colors relative"
                    title="History"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                <button className="p-2 text-slate-400 hover:text-slate-800">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                </button>
            </div>
        </div>

        {/* Tab Bar */}
        {appState === AppState.READY && (
            <div className="flex items-center gap-6 px-2 border-b border-transparent">
                {(['original', 'notes', 'favorites'] as const).map(tab => (
                    <button 
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`pb-2 text-sm font-bold transition-colors capitalize border-b-2 ${activeTab === tab ? 'text-slate-900 border-blue-600' : 'text-slate-400 border-transparent'}`}
                    >
                        {tab}
                    </button>
                ))}
            </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative bg-slate-50">
        
        {appState === AppState.IDLE && (
          <div className="h-full flex flex-col justify-center px-6">
            <FileUpload onFileSelected={handleFileSelected} appState={appState} />
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="h-full flex flex-col items-center justify-center space-y-4 px-6">
            <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-slate-500 font-medium">Analyzing audio...</p>
            <p className="text-xs text-slate-400">This may take up to 30 seconds.</p>
          </div>
        )}

        {appState === AppState.ERROR && (
          <div className="h-full flex flex-col items-center justify-center space-y-6 px-6 text-center animate-fade-in-up">
            <div className="text-red-500 bg-red-100 p-4 rounded-full mx-auto">
               <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            
            {errorDetails === "API_KEY_MISSING" ? (
                <div>
                    <h3 className="text-lg font-bold text-slate-800">Authentication Error</h3>
                    <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                        The API request was rejected (401). <br/>
                        Your API Key is missing or invalid.
                    </p>
                    <div className="text-xs text-left text-slate-600 bg-slate-100 p-4 rounded-lg mt-3 border border-slate-200">
                        <p className="font-bold mb-2">Troubleshooting:</p>
                        <ol className="space-y-1 list-decimal list-inside">
                            <li>Check <b>.env</b> file or Cloud environment variables.</li>
                            <li>Ensure <b>API_KEY</b> is correct and has Gemini API enabled.</li>
                            <li>If you just added the key, <b>restart your dev server</b> or redeploy.</li>
                        </ol>
                    </div>
                </div>
            ) : errorDetails === "SERVICE_UNAVAILABLE" ? (
                <div>
                    <h3 className="text-lg font-bold text-slate-800">AI Service Busy</h3>
                    <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                        Google's AI service is currently overloaded (500 Error).<br/>
                        We automatically retried 3 times but it failed.
                    </p>
                    <p className="text-xs text-slate-400 mt-2">
                        Please wait 1 minute and try again.
                    </p>
                </div>
            ) : errorDetails === "NETWORK_ERROR" ? (
                <div>
                    <h3 className="text-lg font-bold text-slate-800">Network Error</h3>
                    <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                        Cannot connect to Google's servers. Please check your internet connection.
                    </p>
                </div>
            ) : (
                <div>
                    <h3 className="text-lg font-bold text-slate-800">Analysis Failed</h3>
                    <p className="text-slate-500 text-sm mt-2 leading-relaxed break-words">
                        {errorDetails || "An unknown error occurred."}
                    </p>
                </div>
            )}

            <button onClick={handleReset} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-medium hover:bg-slate-700 transition shadow-lg shadow-slate-200 w-full">
                Try Again
            </button>
          </div>
        )}

        {appState === AppState.READY && transcription && audioFile && (
           activeTab === 'notes' ? (
               <div className="h-full flex items-center justify-center text-slate-400">
                   <p>No notes yet.</p>
               </div>
           ) : (
              activeTab === 'favorites' && displayedSegments.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                     <svg className="w-12 h-12 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                     <p>No favorites yet.</p>
                  </div>
              ) : (
                <TranscriptView 
                    segments={displayedSegments}
                    currentTime={currentTime}
                    onSegmentClick={(time) => setCurrentTime(time)}
                    meta={transcription.meta}
                    onToggleFavorite={(segment) => {
                        const idx = transcription.segments.indexOf(segment);
                        if (idx !== -1) handleToggleFavorite(idx);
                    }}
                />
              )
           )
        )}
      </main>

      {/* History Sidebar */}
      <HistorySidebar 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)} 
        onSelectEntry={handleLoadHistory}
      />

      {/* Footer / Shadowing Overlay */}
      {appState === AppState.SHADOWING && transcription && (
        <ShadowingView 
            segments={transcription.segments} 
            onClose={() => setAppState(AppState.READY)}
        />
      )}

      {appState === AppState.READY && audioFile && (
        <AudioPlayer 
            audioUrl={audioFile.url}
            currentTime={currentTime}
            onTimeUpdate={setCurrentTime}
            onEnterShadowing={() => setAppState(AppState.SHADOWING)}
        />
      )}

    </div>
    </div>
  );
};

export default App;