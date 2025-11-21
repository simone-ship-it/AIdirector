
export interface SrtEntry {
  id: number;
  startTime: number; // Seconds
  endTime: number;   // Seconds
  text: string;
}

export interface ClipItem {
  id: string;
  name: string;
  start: number; // Timeline Frame Start
  end: number;   // Timeline Frame End
  in: number;    // Source In Frame
  out: number;   // Source Out Frame
  fileId: string;
  filePath: string;
  masterClipId: string;
  trackIndex: number; // V1, V2, etc.
}

export interface SequenceData {
  fps: number;
  width: number;
  height: number;
  clips: ClipItem[];
}

export interface EditDecision {
  sequenceIndex: number;
  srtId: number;
  clipName: string;
  text: string;
  timelineIn: number; // The new timeline position (0 based accumulator)
  timelineOut: number;
  sourceIn: number;
  sourceOut: number;
  fileId: string;
  filePath?: string;
  duration: number; // Frames
  masterClipId?: string;
  trackIndex: number;
}

export interface ProcessingState {
  status: 'idle' | 'parsing' | 'thinking' | 'calculating' | 'done' | 'error';
  message: string;
}
