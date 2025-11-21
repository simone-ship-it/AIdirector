
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
     * Handles clamping to ensure we don't select black frames or cross clip boundaries.
     */
    calculateCuts(
        selectedSrtIds: number[], 
        fullSrt: SrtEntry[], 
        sequenceData: SequenceData
    ): EditDecision[] {
        
        const cuts: EditDecision[] = [];
        let sequenceAccumulator = 0; 

        const srtMap = new Map(fullSrt.map(s => [s.id, s]));
        
        selectedSrtIds.forEach((id) => {
            const srt = srtMap.get(id);
            if (!srt) return;

            const srtStartFrame = Math.floor(srt.startTime * sequenceData.fps);
            const srtEndFrame = Math.floor(srt.endTime * sequenceData.fps);
            
            let rawDuration = srtEndFrame - srtStartFrame;
            if (rawDuration <= 0) return;

            // Find the clip covering this start time
            const clip = sequenceData.clips.find(c => 
                c.start <= srtStartFrame && c.end > srtStartFrame 
            );

            if (!clip) {
                // Skip gaps
                return;
            }

            // Calculate exact sync points
            const offsetFromClipStart = srtStartFrame - clip.start;
            
            // Apply padding logic
            const paddingHead = 5;
            const paddingTail = 5;

            let newSourceIn = (clip.in + offsetFromClipStart) - paddingHead;
            
            // Safety: Ensure we don't trim before the physical media start
            // (Assuming mostly 0-based or standard TC, simplistic check)
            if (newSourceIn < 0) newSourceIn = 0; 

            // Calculate Max Length available in this specific clip from the In Point
            // (Clip End in Source) - (New In Point)
            // clip.out is the source out point used in timeline. 
            // Actually easier: Frame count remaining on timeline = clip.end - srtStartFrame
            const framesRemainingInClip = clip.end - srtStartFrame; 

            let desiredDuration = rawDuration + paddingHead + paddingTail;
            
            // Clamp duration: Cannot be longer than what's left in the clip + a bit of padding logic adjustment
            // Actually, precise logic:
            // We can't play past clip.out (source) unless the underlying file has handles, 
            // but we only know about the XML clip bounds. We must assume we can't go past clip.end.
            
            let finalDuration = Math.min(desiredDuration, framesRemainingInClip + paddingHead);
            
            if (finalDuration < 1) return;

            const newSourceOut = newSourceIn + finalDuration;

            cuts.push({
                sequenceIndex: cuts.length + 1,
                srtId: id,
                clipName: clip.name,
                text: srt.text,
                timelineIn: sequenceAccumulator,
                timelineOut: sequenceAccumulator + finalDuration,
                sourceIn: Math.floor(newSourceIn),
                sourceOut: Math.floor(newSourceOut),
                fileId: clip.fileId,
                filePath: clip.filePath,
                duration: Math.floor(finalDuration),
                masterClipId: clip.masterClipId,
                trackIndex: clip.trackIndex
            });

            sequenceAccumulator += Math.floor(finalDuration);
        });

        return cuts;
    }
}
