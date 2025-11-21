
import React from 'react';
import { EditDecision } from '../types';

interface PreviewTableProps {
    cuts: EditDecision[];
    fps: number;
}

const formatTC = (frames: number, fps: number) => {
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
            {/* Header Style Reference: Dark grey background, small uppercase text */}
            <div className="grid grid-cols-12 bg-[#1a1a1a] text-[#888] text-[10px] font-bold uppercase tracking-wider border-b border-[#333] h-8 items-center px-2">
                <div className="col-span-1 pl-2">#</div>
                <div className="col-span-2">Nome Clip</div>
                <div className="col-span-1 text-center">Traccia</div>
                <div className="col-span-1 font-mono">In</div>
                <div className="col-span-1 font-mono">Out</div>
                <div className="col-span-5">Testo Sottotitolo</div>
                <div className="col-span-1 text-right pr-4">Durata</div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d0d0d]">
                {cuts.map((cut, idx) => (
                    <div 
                        key={idx} 
                        className={`
                            grid grid-cols-12 items-center px-2 h-8 text-[11px] border-b border-[#1a1a1a]
                            ${idx % 2 === 0 ? 'bg-[#0d0d0d]' : 'bg-[#121212]'} 
                            hover:bg-[#1f2937] transition-colors group cursor-default
                        `}
                    >
                        <div className="col-span-1 text-[#555] pl-2">{idx + 1}</div>
                        <div className="col-span-2 text-blue-400 truncate pr-2 font-medium" title={cut.clipName}>
                            {cut.clipName}
                        </div>
                        <div className="col-span-1 text-center text-[#666]">
                            V{cut.trackIndex}
                        </div>
                        <div className="col-span-1 font-mono text-[#888] group-hover:text-[#ccc]">
                            {formatTC(cut.timelineIn, fps)}
                        </div>
                        <div className="col-span-1 font-mono text-[#888] group-hover:text-[#ccc]">
                            {formatTC(cut.timelineOut, fps)}
                        </div>
                        <div className="col-span-5 text-[#999] italic truncate pr-2" title={cut.text}>
                            "{cut.text}"
                        </div>
                        <div className="col-span-1 text-right font-mono text-[#666] pr-4">
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
