
import { SequenceData, SrtEntry, EditDecision, ClipItem } from '../types';

export class VideoEngine {
    
    /**
     * Generates a preview of the source timeline.
     * If SRT is present, it virtually "slices" the video based on text timestamps.
     * If no SRT, it lists the physical video clips.
     */
    generateSourcePreview(sequenceData: SequenceData, srtData: SrtEntry[]): EditDecision[] {
        const previewRows: EditDecision[] = [];
        const fps = sequenceData.fps;

        // Scenario A: We have Subtitles -> Show row per subtitle (Virtual Segmentation)
        if (srtData && srtData.length > 0) {
            
            srtData.forEach((srt, index) => {
                // 1. Convert SRT time to Timeline Frames
                const srtStartFrame = Math.floor(srt.startTime * fps);
                const srtEndFrame = Math.floor(srt.endTime * fps);
                const duration = srtEndFrame - srtStartFrame;

                // 2. Find which video clip contains this timeframe
                // We look for a clip where the subtitle starts strictly inside it
                // or starts at the exact beginning.
                const clip = sequenceData.clips.find(c => 
                    srtStartFrame >= c.start && srtStartFrame < c.end
                );

                if (clip) {
                    // 3. Calculate exact offsets
                    // How far into the timeline clip is this subtitle?
                    const offsetInClip = srtStartFrame - clip.start;
                    
                    // Map that offset to the Source File's In point
                    const sourceIn = clip.in + offsetInClip;
                    const sourceOut = sourceIn + duration;

                    previewRows.push({
                        sequenceIndex: index + 1,
                        srtId: srt.id,
                        clipName: clip.name,
                        text: srt.text,
                        timelineIn: srtStartFrame,  // Show where it happens on the main timeline
                        timelineOut: srtEndFrame,
                        sourceIn: Math.floor(sourceIn),   // Show exact source frame match
                        sourceOut: Math.floor(sourceOut),
                        fileId: clip.fileId,
                        filePath: clip.filePath,
                        duration: duration,
                        masterClipId: clip.masterClipId,
                        trackIndex: clip.trackIndex
                    });
                } else {
                    // Subtitle falls in a gap (black screen)
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

        } 
        // Scenario B: No Subtitles -> Just list the physical clips
        else {
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
                    trackIndex: clip.trackIndex
                });
            });
        }

        return previewRows;
    }

    /**
     * Calculates the final cut based on selected IDs.
     * NOW INCLUDES: Overlap Merging to prevent duplicate frames/stuttering.
     */
    calculateCuts(
        selectedSrtIds: number[], 
        fullSrt: SrtEntry[], 
        sequenceData: SequenceData
    ): EditDecision[] {
        
        // 0. Sort IDs chronologically to ensure linear flow
        // This is crucial for the merging logic to work correctly.
        const sortedIds = [...selectedSrtIds].sort((a, b) => a - b);
        
        const srtMap = new Map(fullSrt.map(s => [s.id, s]));
        const paddingHead = 5;
        const paddingTail = 5;

        // --- PASS 1: Generate Raw Segment Candidates ---
        interface RawSegment {
            srtId: number;
            text: string;
            fileId: string;
            filePath: string;
            clipName: string;
            sourceIn: number;
            sourceOut: number;
            masterClipId: string;
            trackIndex: number;
        }

        const rawSegments: RawSegment[] = [];

        for (const id of sortedIds) {
            const srt = srtMap.get(id);
            if (!srt) continue;

            const srtStartFrame = Math.floor(srt.startTime * sequenceData.fps);
            const srtEndFrame = Math.floor(srt.endTime * sequenceData.fps);
            const rawDuration = srtEndFrame - srtStartFrame;
            
            if (rawDuration <= 0) continue;

            // Find clip
            const clip = sequenceData.clips.find(c => 
                c.start <= srtStartFrame && c.end > srtStartFrame 
            );
            if (!clip) continue;

            // Calculate Source Points with Padding
            const offsetFromClipStart = srtStartFrame - clip.start;
            let newSourceIn = (clip.in + offsetFromClipStart) - paddingHead;
            if (newSourceIn < 0) newSourceIn = 0;

            // Clamp max duration to clip end
            const framesRemainingInClip = clip.end - srtStartFrame;
            let desiredDuration = rawDuration + paddingHead + paddingTail;
            let finalDuration = Math.min(desiredDuration, framesRemainingInClip + paddingHead);
            
            if (finalDuration < 1) continue;
            
            const newSourceOut = newSourceIn + finalDuration;

            rawSegments.push({
                srtId: id,
                text: srt.text,
                fileId: clip.fileId,
                filePath: clip.filePath,
                clipName: clip.name,
                sourceIn: Math.floor(newSourceIn),
                sourceOut: Math.floor(newSourceOut),
                masterClipId: clip.masterClipId,
                trackIndex: clip.trackIndex
            });
        }

        // --- PASS 2: Merge Overlapping or Adjacent Segments ---
        // This fixes the "Duplicate Frames" issue in Premiere.
        // If Segment A ends at frame 100, and Segment B starts at frame 95 (due to padding overlap),
        // we merge them into one continuous clip from A.Start to B.End.

        const mergedSegments: RawSegment[] = [];

        if (rawSegments.length > 0) {
            let current = rawSegments[0];

            for (let i = 1; i < rawSegments.length; i++) {
                const next = rawSegments[i];

                // Check if they are from the same source file and contiguous/overlapping
                const isSameFile = current.fileId === next.fileId;
                
                // Allow a small gap (e.g. 2 frames) to be treated as continuous to avoid micro-cuts
                const isOverlappingOrAdjacent = next.sourceIn <= (current.sourceOut + 2);

                if (isSameFile && isOverlappingOrAdjacent) {
                    // MERGE
                    // We extend the current clip's Out point to the next clip's Out point
                    // (Use Math.max in case next is somehow shorter/inside current)
                    current.sourceOut = Math.max(current.sourceOut, next.sourceOut);
                    
                    // Append text for clarity in the summary view
                    current.text += " " + next.text;
                    
                    // We consume 'next' into 'current', so we don't push 'next' yet.
                } else {
                    // No merge possible (different file or large gap)
                    // Push current to finished list and start a new current
                    mergedSegments.push(current);
                    current = next;
                }
            }
            // Push the final straggler
            mergedSegments.push(current);
        }

        // --- PASS 3: Calculate Timeline Positions (Edit Decisions) ---
        const finalCuts: EditDecision[] = [];
        let sequenceAccumulator = 0;

        mergedSegments.forEach((seg, index) => {
            const duration = seg.sourceOut - seg.sourceIn;
            
            finalCuts.push({
                sequenceIndex: index + 1,
                srtId: seg.srtId, // Keeps the ID of the first merged block
                clipName: seg.clipName,
                text: seg.text,
                timelineIn: sequenceAccumulator,
                timelineOut: sequenceAccumulator + duration,
                sourceIn: seg.sourceIn,
                sourceOut: seg.sourceOut,
                fileId: seg.fileId,
                filePath: seg.filePath,
                duration: duration,
                masterClipId: seg.masterClipId,
                trackIndex: seg.trackIndex
            });

            sequenceAccumulator += duration;
        });

        return finalCuts;
    }
}
