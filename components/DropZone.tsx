
import React, { useCallback } from 'react';

interface DropZoneProps {
    label: string;
    accept: string;
    onFileLoaded: (content: string, fileName: string) => void;
    fileType: 'xml' | 'srt';
    isLoaded: boolean;
    fileName?: string;
}

export const DropZone: React.FC<DropZoneProps> = ({ label, accept, onFileLoaded, fileType, isLoaded, fileName }) => {
    
    const handleFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            onFileLoaded(content, file.name);
        };
        reader.readAsText(file);
    };

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    }, []);

    const onDragOver = (e: React.DragEvent) => e.preventDefault();

    return (
        <div 
            onDrop={onDrop}
            onDragOver={onDragOver}
            className={`
                relative flex flex-col items-center justify-center h-20 
                border border-dashed rounded-sm transition-all duration-300 cursor-pointer
                ${isLoaded 
                    ? 'border-blue-500/30 bg-blue-900/5' 
                    : 'border-[#333] hover:border-[#555] bg-[#111]'}
            `}
        >
            <input 
                type="file" 
                accept={accept}
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => e.target.files && handleFile(e.target.files[0])}
            />
            
            {isLoaded ? (
                 <div className="text-center px-2 w-full overflow-hidden">
                    <div className="flex items-center justify-center gap-2 mb-1 text-blue-400">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-[9px] font-bold uppercase tracking-wider">Caricato</span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate w-full">{fileName}</p>
                 </div>
            ) : (
                <div className="text-center p-2">
                    <p className="text-[10px] text-[#666] font-bold uppercase tracking-wide">{label}</p>
                </div>
            )}
        </div>
    );
};
