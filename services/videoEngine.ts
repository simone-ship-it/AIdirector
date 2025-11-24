
import { SequenceData, SrtEntry, EditDecision, ClipItem } from '../types';

export class VideoEngine {
    
    /**
     * Generates a preview of the source timeline.
     * If SRT is present, it virtually "slices" the video based on text timestamps.
     */
    generateSourcePreview(sequenceData: SequenceData, srtData: SrtEntry[]): EditDecision[] {
        const previewRows: EditDecision[] = [];
        const fps = sequenceData.fps;

        if (srtData && srtData.length > 0) {
            srtData.forEach((srt, index) => {
                const srtStartFrame = Math.floor(srt.startTime * fps);
                const srtEndFrame = Math.floor(srt.endTime * fps);
                const duration = srtEndFrame - srtStartFrame;

                const clip = sequenceData.clips.find(c => 
                    srtStartFrame >= c.start && srtStartFrame < c.end
                );

                if (clip) {
                    const offsetInClip = srtStartFrame - clip.start;
                    const sourceIn = clip.in + offsetInClip;
                    const sourceOut = sourceIn + duration;

                    previewRows.push({
                        sequenceIndex: index + 1,
                        srtId: srt.id,
                        clipName: clip.name,
                        text: srt.text,
                        timelineIn: srtStartFrame,
                        timelineOut: srtEndFrame,
                        sourceIn: Math.floor(sourceIn),
                        sourceOut: Math.floor(sourceOut),
                        fileId: clip.fileId,
                        filePath: clip.filePath,
                        duration: duration,
                        masterClipId: clip.masterClipId,
                        trackIndex: 1
                    });
                } else {
                    previewRows.push({
                        sequenceIndex: index + 1,
                        srtId: srt.id,
                        clipName: "[GAP / NO VIDEO]",
                        text: srt.text,
                        timelineIn: srtStartFrame,
                        timelineOut: srtEndFrame,
                        sourceIn: -1,
                        sourceOut: -1,
                        fileId: "",
                        duration: duration,
                        trackIndex: 0
                    });
                }
            });
        } else {
            const sortedClips = [...sequenceData.clips].sort((a, b) => a.start - b.start);
            sortedClips.forEach((clip, index) => {
                previewRows.push({
                    sequenceIndex: index + 1,
                    srtId: 0,
                    clipName: clip.name,
                    text: "[Video Clip]",
                    timelineIn: clip.start,
                    timelineOut: clip.end,
                    sourceIn: clip.in,
                    sourceOut: clip.out,
                    fileId: clip.fileId,
                    filePath: clip.filePath,
                    duration: clip.end - clip.start,
                    masterClipId: clip.masterClipId,
                    trackIndex: 1
                });
            });
        }
        return previewRows;
    }

    /**
     * Calculates the final cut based on selected IDs.
     * Uses Single Track (V1) with Smart Padding logic.
     */
    calculateCuts(
        selectedSrtIds: number[], 
        fullSrt: SrtEntry[], 
        sequenceData: SequenceData
    ): EditDecision[] {
        
        // 1. Sort IDs chronologically
        const sortedIds = [...selectedSrtIds].sort((a, b) => a - b);
        const srtMap = new Map(fullSrt.map(s => [s.id, s]));
        
        // Increased padding to 8 frames (~1/3 sec) for smoother jump cuts
        const paddingFrames = 8; 

        const finalCuts: EditDecision[] = [];
        let sequenceAccumulator = 0;
        
        // State tracking for Smart Healing
        let prevSourceOut = -1;
        let prevFileId = "";

        for (let i = 0; i < sortedIds.length; i++) {
            const id = sortedIds[i];
            const prevId = sortedIds[i - 1] || -999;
            const nextId = sortedIds[i + 1] || -999;

            const srt = srtMap.get(id);
            if (!srt) continue;

            const srtStartFrame = Math.floor(srt.startTime * sequenceData.fps);
            const srtEndFrame = Math.floor(srt.endTime * sequenceData.fps);
            let rawDuration = srtEndFrame - srtStartFrame;
            
            if (rawDuration <= 0) continue;

            // Find matching video clip in source sequence
            const clip = sequenceData.clips.find(c => 
                c.start <= srtStartFrame && c.end > srtStartFrame 
            );
            if (!clip) continue;

            const isStartOfSequence = (id !== prevId + 1);
            const isEndOfSequence = (id !== nextId - 1);

            let offsetInClip = srtStartFrame - clip.start;
            let sourceIn = clip.in + offsetInClip;
            let sourceOut = sourceIn + rawDuration;

            // --- SMART HEALING (AUDIO FIXES) ---
            // If clips are sequential (part of same dialogue) and from same file
            if (!isStartOfSequence && clip.fileId === prevFileId && prevSourceOut !== -1) {
                const gap = sourceIn - prevSourceOut;
                
                // 1. FIX OVERLAPS ("Accavallate"): If Gap < 0, SRTs overlap. 
                // Snap start to previous end to avoid repeating frames/audio.
                // 2. FIX MICRO-GAPS ("Mezze parole"): If Gap is small (< 12 frames / 0.5s),
                // it's likely a breath or imperfect SRT timestamp. Bridge it to prevent chopped audio.
                if (gap < 12) {
                    sourceIn = prevSourceOut;
                }
            }
            
            // Recalculate raw duration after healing start point
            if (sourceOut <= sourceIn) continue; // Safety check

            // Apply Head Padding ONLY if it's a new sequence (Jump Cut)
            if (isStartOfSequence) {
                const availableHead = sourceIn - clip.in; 
                const pad = Math.min(paddingFrames, availableHead);
                sourceIn -= pad;
            }

            // Apply Tail Padding ONLY if the sequence ends here (Jump Cut)
            if (isEndOfSequence) {
                const clipOutPoint = clip.out; 
                const availableTail = clipOutPoint - sourceOut;
                const pad = Math.min(paddingFrames, availableTail);
                sourceOut += pad;
            }
            
            // Calculate final duration based on adjusted points
            const finalDuration = Math.floor(sourceOut - sourceIn);

            finalCuts.push({
                sequenceIndex: i + 1,
                srtId: id,
                clipName: clip.name,
                text: srt.text,
                timelineIn: sequenceAccumulator,
                timelineOut: sequenceAccumulator + finalDuration,
                sourceIn: Math.floor(sourceIn),
                sourceOut: Math.floor(sourceOut),
                fileId: clip.fileId,
                filePath: clip.filePath,
                duration: finalDuration,
                masterClipId: clip.masterClipId,
                trackIndex: 1 // Always V1
            });

            sequenceAccumulator += finalDuration;
            
            // Store state for next iteration loop
            // IMPORTANT: We store the un-padded output if we are inside a sequence? 
            // No, we store the actual cut point used. 
            // If isEndOfSequence was false, sourceOut has NO padding, which is exactly what we want for the next sequential clip.
            prevSourceOut = Math.floor(sourceOut);
            prevFileId = clip.fileId;
        }

        return finalCuts;
    }
}
