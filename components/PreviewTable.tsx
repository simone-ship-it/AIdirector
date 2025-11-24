
import React from 'react';
import { EditDecision } from '../types';

interface PreviewTableProps {
    cuts: EditDecision[];
    fps: number;
}

const formatTC = (frames: number, fps: number) => {
    if (!fps || fps === 0) return "00:00:00:00";
    const totalSeconds = Math.floor(frames / fps);
    const f = frames % fps;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
};

export const PreviewTable: React.FC<PreviewTableProps> = ({ cuts, fps }) => {
    return (
        <div className="w-full h-full flex flex-col bg-[#111] border-t border-[#333]">
            {/* Header */}
            <div className="grid grid-cols-[30px_1.5fr_1fr_1fr_1fr_1fr_3fr_0.8fr] gap-2 bg-[#1a1a1a] text-[#888] text-[9px] font-bold uppercase tracking-wider border-b border-[#333] h-8 items-center px-2">
                <div className="pl-1">#</div>
                <div>Nome Clip</div>
                <div className="text-center text-blue-900/80">Src In</div>
                <div className="text-center text-blue-900/80">Src Out</div>
                <div className="text-center text-green-900/80">Seq In</div>
                <div className="text-center text-green-900/80">Seq Out</div>
                <div>Testo Sottotitolo</div>
                <div className="text-right pr-2">Durata</div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d0d0d]">
                {cuts.map((cut, idx) => (
                    <div 
                        key={idx} 
                        className={`
                            grid grid-cols-[30px_1.5fr_1fr_1fr_1fr_1fr_3fr_0.8fr] gap-2 items-center px-2 h-8 text-[10px] border-b border-[#1a1a1a]
                            ${idx % 2 === 0 ? 'bg-[#0d0d0d]' : 'bg-[#121212]'} 
                            hover:bg-[#1f2937] transition-colors group cursor-default
                        `}
                    >
                        <div className="text-[#555] pl-1">{idx + 1}</div>
                        <div className="text-blue-400 truncate font-medium" title={cut.clipName}>
                            {cut.clipName}
                        </div>
                        
                        {/* Source Timecodes (Blue tint on hover) */}
                        <div className="text-center font-mono text-[#666] group-hover:text-blue-300 bg-[#15151a] rounded px-1 py-0.5">
                            {formatTC(cut.sourceIn, fps)}
                        </div>
                        <div className="text-center font-mono text-[#666] group-hover:text-blue-300 bg-[#15151a] rounded px-1 py-0.5">
                            {formatTC(cut.sourceOut, fps)}
                        </div>

                        {/* Sequence Timecodes (Green tint on hover) */}
                        <div className="text-center font-mono text-[#888] group-hover:text-green-300">
                            {formatTC(cut.timelineIn, fps)}
                        </div>
                        <div className="text-center font-mono text-[#888] group-hover:text-green-300">
                            {formatTC(cut.timelineOut, fps)}
                        </div>

                        <div className="text-[#999] italic truncate" title={cut.text}>
                            "{cut.text}"
                        </div>
                        <div className="text-right font-mono text-[#666] pr-2">
                            {formatTC(cut.duration, fps)}
                        </div>
                    </div>
                ))}

                {cuts.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-[#444]">
                        <p className="text-sm font-medium">Nessun evento in timeline</p>
                    </div>
                )}
            </div>
        </div>
    );
};
