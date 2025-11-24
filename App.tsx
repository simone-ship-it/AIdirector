import React, { useState, useMemo, useEffect } from 'react';
import { DropZone } from './components/DropZone';
import { PreviewTable } from './components/PreviewTable';
import { PremiereXmlParser } from './services/xmlParser';
import { SrtParser } from './services/srtParser';
import { GeminiService } from './services/geminiService';
import { VideoEngine } from './services/videoEngine';
import { EditDecision, ProcessingState, SequenceData, SrtEntry } from './types';

// Formatting helper for duration stats
const formatDuration = (frames: number, fps: number) => {
    if (!fps) return "00:00:00:00";
    const totalSeconds = frames / fps;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const f = Math.round((totalSeconds % 1) * fps); 
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

type ViewMode = 'source' | 'generated';

const App: React.FC = () => {
  // -- State --
  const [xmlContent, setXmlContent] = useState<string>('');
  const [srtContent, setSrtContent] = useState<string>('');
  const [xmlName, setXmlName] = useState<string>('');
  const [srtName, setSrtName] = useState<string>('');
  
  // Parsed Data
  const [sequenceData, setSequenceData] = useState<SequenceData | null>(null);
  const [srtData, setSrtData] = useState<SrtEntry[]>([]);

  // Viewing Data
  const [sourceCuts, setSourceCuts] = useState<EditDecision[]>([]);
  const [generatedCuts, setGeneratedCuts] = useState<EditDecision[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('source');

  // Control State
  const [instructions, setInstructions] = useState<string>('Mantieni le parti più coinvolgenti e riassumi la storia.');
  const [targetDuration, setTargetDuration] = useState<number>(60);
  const [seed, setSeed] = useState<number>(42); // Default deterministic seed
  const [processState, setProcessState] = useState<ProcessingState>({ status: 'idle', message: '' });
  
  // -- Services (Memoized) --
  const xmlParser = useMemo(() => new PremiereXmlParser(), []);
  const srtParser = useMemo(() => new SrtParser(), []);
  const videoEngine = useMemo(() => new VideoEngine(), []);
  const geminiService = useMemo(() => new GeminiService(), []);

  // -- Handlers --
  const handleXmlLoad = (content: string, name: string) => {
    setXmlContent(content);
    setXmlName(name);
    try {
        const parsed = xmlParser.parse(content);
        setSequenceData(parsed);
    } catch (e) {
        console.error("XML Parse error", e);
        setProcessState({ status: 'error', message: 'Errore parsing XML' });
    }
  };

  const handleSrtLoad = (content: string, name: string) => {
    setSrtContent(content);
    setSrtName(name);
    try {
        const parsed = srtParser.parse(content);
        setSrtData(parsed);
    } catch (e) {
        console.error("SRT Parse error", e);
        setProcessState({ status: 'error', message: 'Errore parsing SRT' });
    }
  };

  const handleReset = () => {
      if (sequenceData || srtData.length > 0) {
          if (!window.confirm("Sei sicuro di voler iniziare un nuovo progetto? I dati attuali andranno persi.")) {
              return;
          }
      }
      setXmlContent('');
      setSrtContent('');
      setXmlName('');
      setSrtName('');
      setSequenceData(null);
      setSrtData([]);
      setSourceCuts([]);
      setGeneratedCuts([]);
      setViewMode('source');
      setProcessState({ status: 'idle', message: '' });
      setInstructions('Mantieni le parti più coinvolgenti e riassumi la storia.');
  };

  // Effect: Generate Source Preview when data is ready
  useEffect(() => {
    if (sequenceData) {
        const sourcePreview = videoEngine.generateSourcePreview(sequenceData, srtData);
        setSourceCuts(sourcePreview);
        
        // Reset view if we reload data
        if (generatedCuts.length === 0) {
            setViewMode('source');
        }
    }
  }, [sequenceData, srtData, videoEngine]); 


  const handleRunDirector = async () => {
    if (!sequenceData || srtData.length === 0) {
      setProcessState({ status: 'error', message: 'Mancano i file di input (XML o SRT).' });
      return;
    }

    setProcessState({ status: 'thinking', message: 'Il Regista IA sta analizzando i testi...' });

    try {
        const selectedIds = await geminiService.selectQuotes(srtData, instructions, targetDuration, seed);

        if (selectedIds.length === 0) {
            setProcessState({ status: 'error', message: 'L\'IA non ha restituito risultati.' });
            return;
        }

        setProcessState({ status: 'calculating', message: 'Calcolo sincronizzazione frame...' });
        
        // Small delay to allow UI to update
        await new Promise(r => setTimeout(r, 50));

        const cuts = videoEngine.calculateCuts(selectedIds, srtData, sequenceData);

        setGeneratedCuts(cuts);
        setViewMode('generated');
        setProcessState({ status: 'done', message: `Completato: ${cuts.length} segmenti generati.` });

    } catch (error: any) {
        console.error(error);
        setProcessState({ status: 'error', message: `${error.message || 'Errore sconosciuto'}` });
    }
  };

  const handleDownload = (type: 'xml' | 'srt') => {
    if (generatedCuts.length === 0 || !sequenceData) return;

    // Create a base filename from the original XML name
    const cleanName = xmlName.toLowerCase().endsWith('.xml') ? xmlName.slice(0, -4) : xmlName;
    const baseName = cleanName || "Sequence"; 
    const suffix = `_AI_${seed}`;

    let content = '';
    let mime = '';
    let ext = '';

    if (type === 'xml') {
        content = xmlParser.generateExportXml(
            generatedCuts, 
            sequenceData.fps,
            sequenceData.width,
            sequenceData.height
        );
        mime = 'text/xml';
        ext = 'xml';
    } else {
        content = srtParser.generateExportSrt(generatedCuts, sequenceData.fps);
        mime = 'text/plain';
        ext = 'srt';
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const randomizeSeed = () => {
      setSeed(Math.floor(Math.random() * 99999));
  }

  // Stats
  const activeCuts = viewMode === 'source' ? sourceCuts : generatedCuts;
  const totalDurationFrames = activeCuts.reduce((acc, cut) => acc + cut.duration, 0);
  const fps = sequenceData?.fps || 25;
  const resWidth = sequenceData?.width || 1920;
  const resHeight = sequenceData?.height || 1080;

  // Technical Stats for Sidebar
  const uniqueFiles = sequenceData ? new Set(sequenceData.clips.map(c => c.fileId)).size : 0;
  
  return (
    <div className="flex flex-col h-screen bg-[#0d0d0d] text-[#ccc] font-sans overflow-hidden text-sm">
      
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-16 border-b border-[#333] bg-[#111] shrink-0">
        <div className="flex items-center gap-4">
            <div className="flex flex-col justify-center">
                <h1 className="text-base font-black text-blue-500 tracking-wide uppercase leading-none mb-1">AI VIDEO EDITOR</h1>
                <div className="text-[11px] text-[#666] font-medium truncate max-w-[200px]">
                    {xmlName ? xmlName : "Project Ready"}
                </div>
            </div>
            
            {/* New Project / Reset Button */}
            {(xmlContent || srtContent) && (
                <button 
                    onClick={handleReset}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#1a1a1a] hover:bg-[#252525] text-[#777] hover:text-red-400 border border-[#333] rounded transition-colors"
                    title="Nuovo Progetto"
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    <span>RESET</span>
                </button>
            )}
        </div>

        <div className="flex items-center gap-6">
            <div className="flex flex-col items-start">
                <span className="text-[9px] font-bold text-[#555] uppercase tracking-wider">Stato</span>
                <span className={`text-xs font-mono ${viewMode === 'source' ? 'text-[#888]' : 'text-green-400'}`}>
                    {viewMode === 'source' ? 'SORGENTE' : 'EDITATO'}
                </span>
            </div>
            <div className="w-px h-6 bg-[#333]"></div>
            <div className="flex flex-col items-start">
                <span className="text-[9px] font-bold text-[#555] uppercase tracking-wider">TC Durata</span>
                <span className="text-xs font-mono text-[#eee]">{formatDuration(totalDurationFrames, fps)}</span>
            </div>
            <div className="w-px h-6 bg-[#333]"></div>
            <div className="flex flex-col items-start">
                <span className="text-[9px] font-bold text-[#555] uppercase tracking-wider">Eventi</span>
                <span className="text-xs font-mono text-blue-400">{activeCuts.length}</span>
            </div>
        </div>

        <div className="flex items-center gap-2">
             <button 
                onClick={() => handleDownload('srt')}
                disabled={generatedCuts.length === 0}
                className="px-3 py-1.5 border border-[#444] rounded bg-[#222] text-[11px] font-semibold text-[#888] hover:bg-[#333] hover:text-[#aaa] disabled:opacity-30 disabled:cursor-not-allowed"
             >
                &#8595; SRT
             </button>
             <button 
                onClick={() => handleDownload('xml')}
                disabled={generatedCuts.length === 0}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-[11px] font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-900/30"
             >
                &#8595; XML
             </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Sidebar - Compacted */}
        <aside className="w-72 bg-[#111] border-r border-[#333] flex flex-col z-10">
            <div className="p-3 space-y-4 overflow-y-auto custom-scrollbar flex-1">
                
                {/* Step 1: Import (Side-by-side) */}
                <div>
                    <div className="text-[10px] font-bold text-[#555] uppercase tracking-widest mb-1.5">
                        <span className="text-blue-500 mr-1">01</span> IMPORT
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <DropZone 
                            label="XML" 
                            accept=".xml" 
                            fileType="xml"
                            onFileLoaded={handleXmlLoad} 
                            isLoaded={!!xmlContent}
                            fileName={xmlName}
                        />
                        <DropZone 
                            label="SRT" 
                            accept=".srt" 
                            fileType="srt"
                            onFileLoaded={handleSrtLoad} 
                            isLoaded={!!srtContent}
                            fileName={srtName}
                        />
                    </div>
                </div>

                <div className="w-full h-px bg-[#222]"></div>

                {/* Step 2: Strategy */}
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-[#555] uppercase tracking-widest mb-1.5">
                        <span className="text-blue-500 mr-1">02</span> STRATEGIA
                    </div>
                    
                    {sequenceData ? (
                        <div className="bg-[#161616] border border-[#333] rounded-sm p-2 mb-2">
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] font-mono text-[#aaa]">
                                <div>FPS: <span className="text-[#eee]">{fps.toFixed(2)}</span></div>
                                <div>CLIP: <span className="text-[#eee]">{uniqueFiles}</span></div>
                                <div className="col-span-2">RES: <span className="text-[#eee]">{resWidth}x{resHeight}</span></div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-[#161616] border border-[#333] border-dashed rounded-sm p-2 mb-2 text-center">
                             <span className="text-[9px] font-bold text-[#444] uppercase">
                                In attesa file
                            </span>
                        </div>
                    )}

                    <div>
                        <textarea 
                            rows={2}
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                            className="w-full bg-[#0d0d0d] border border-[#333] rounded-sm p-2 text-xs leading-relaxed focus:border-blue-500 focus:outline-none resize-none placeholder-[#444] text-[#ccc]"
                            placeholder="Istruzioni per l'IA..."
                        />
                    </div>
                </div>

                <div className="w-full h-px bg-[#222]"></div>

                {/* Step 3: Generation */}
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-[#555] uppercase tracking-widest mb-1.5">
                        <span className="text-blue-500 mr-1">03</span> GENERAZIONE
                    </div>
                    
                    {/* Compact Inputs Row */}
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-[9px] text-[#888] mb-1 font-semibold">DURATA (S)</label>
                            <input 
                                type="number" 
                                min="10" 
                                max="3600" 
                                value={targetDuration}
                                onChange={(e) => setTargetDuration(parseInt(e.target.value) || 0)}
                                className="w-full bg-[#0d0d0d] border border-[#333] rounded-sm p-1.5 text-xs font-mono text-blue-400 focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                        <div>
                             <label className="block text-[9px] text-[#888] mb-1 font-semibold">SEED</label>
                             <div className="flex gap-1">
                                <input 
                                    type="number" 
                                    value={seed}
                                    onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                                    className="w-full bg-[#0d0d0d] border border-[#333] rounded-sm p-1.5 text-xs font-mono text-purple-400 focus:border-purple-500 focus:outline-none"
                                />
                                <button 
                                    onClick={randomizeSeed}
                                    className="px-2 bg-[#222] border border-[#333] text-[#888] hover:text-[#eee] hover:bg-[#333] rounded-sm"
                                    title="Randomizza"
                                >
                                    🎲
                                </button>
                             </div>
                        </div>
                    </div>

                    <button 
                        onClick={handleRunDirector}
                        disabled={processState.status === 'parsing' || processState.status === 'thinking' || processState.status === 'calculating' || !sequenceData || srtData.length === 0}
                        className={`
                            w-full py-2 rounded-sm text-[11px] font-bold text-white tracking-wider uppercase mt-3 transition-all
                            ${processState.status === 'idle' || processState.status === 'done' || processState.status === 'error'
                                ? 'bg-[#2b2b2b] hover:bg-[#383838] border border-[#444] active:scale-[0.99]' 
                                : 'bg-blue-900/20 border border-blue-900 text-blue-400 cursor-wait'}
                             disabled:opacity-30 disabled:cursor-not-allowed
                        `}
                    >
                        {processState.status === 'idle' && 'ELABORA'}
                        {processState.status === 'done' && 'RIGENERA'}
                        {processState.status === 'error' && 'RIPROVA'}
                        {processState.status === 'parsing' && '...'}
                        {processState.status === 'thinking' && 'AI...'}
                        {processState.status === 'calculating' && 'CUT...'}
                    </button>
                    
                    {processState.message && (
                        <div className={`text-[9px] mt-1 font-mono border-l-2 pl-2 py-1 leading-tight ${processState.status === 'error' ? 'text-red-400 border-red-900 bg-red-900/10' : 'text-blue-400 border-blue-900 bg-blue-900/10'}`}>
                            {processState.status !== 'idle' && `> ${processState.message}`}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-[#333] bg-[#0e0e0e]">
                 <div className="text-[9px] text-[#444] font-mono uppercase tracking-widest text-center">
                        Lavezzo Studios
                 </div>
            </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 bg-[#0d0d0d] flex flex-col min-w-0">
             {/* Tabs Bar */}
             <div className="h-9 bg-[#161616] border-b border-[#333] flex items-end px-4 justify-between">
                <div className="flex h-full">
                    <button 
                        onClick={() => setViewMode('source')}
                        className={`
                            h-full px-4 flex items-center text-[10px] font-bold uppercase tracking-wider border-t-2 transition-colors
                            ${viewMode === 'source' 
                                ? 'bg-[#0d0d0d] border-blue-500 text-[#eee]' 
                                : 'bg-transparent border-transparent text-[#666] hover:text-[#999] hover:bg-[#1a1a1a]'}
                        `}
                    >
                        TIMELINE SORGENTE
                    </button>
                    
                    {generatedCuts.length > 0 && (
                        <button 
                            onClick={() => setViewMode('generated')}
                            className={`
                                h-full px-4 flex items-center text-[10px] font-bold uppercase tracking-wider border-t-2 transition-colors
                                ${viewMode === 'generated' 
                                    ? 'bg-[#0d0d0d] border-green-500 text-green-400' 
                                    : 'bg-transparent border-transparent text-[#666] hover:text-[#999] hover:bg-[#1a1a1a]'}
                            `}
                        >
                            SEQUENZA GENERATA
                        </button>
                    )}
                </div>

                <span className="text-[10px] text-[#444] pb-2 font-mono">
                    {activeCuts.length} SEGMENTI
                </span>
             </div>

             {/* Grid View */}
             <div className="flex-1 relative">
                <div className="absolute inset-0">
                    <PreviewTable cuts={activeCuts} fps={fps} />
                </div>
             </div>
        </div>

      </div>
    </div>
  );
};

export default App;