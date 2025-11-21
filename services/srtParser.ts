
import { SrtEntry } from '../types';

export class SrtParser {
  
  // Helper: HH:MM:SS,ms or HH:MM:SS.ms -> Seconds
  private timeToSeconds(timeString: string): number {
    if (!timeString) return 0;
    const parts = timeString.trim().split(':');
    if (parts.length < 3) return 0;

    // Handle both comma (European) and dot (US) decimal separators
    const secondsParts = parts[2].split(/[.,]/); 
    
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseInt(secondsParts[0], 10);
    const ms = parseInt(secondsParts[1] || '0', 10);

    return (h * 3600) + (m * 60) + s + (ms / 1000);
  }

  // Helper: Seconds -> HH:MM:SS,ms
  secondsToSrtTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds * 1000) % 1000);

    const pad = (num: number, size: number) => num.toString().padStart(size, '0');
    
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
  }

  parse(srtContent: string): SrtEntry[] {
    // 1. Normalize Content
    // Remove BOM (\uFEFF), standardize line endings (\r\n -> \n)
    const normalized = srtContent
        .replace(/^\uFEFF/, '') 
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
    
    // Split by double newlines. Robust regex handles multiple newlines between blocks.
    const blocks = normalized.split(/\n\s*\n/);
    
    const entries: SrtEntry[] = [];

    blocks.forEach(block => {
      const lines = block.split('\n');
      
      // Recover from potential garbage lines or empty blocks
      if (lines.length < 2) return;

      // Try to identify the index line (digits only)
      let indexLineIdx = 0;
      if (!lines[0].match(/^\d+$/)) {
          // Sometimes file starts with garbage, try to find the first number line
          // or just assume line 0 is index if line 1 is timestamp
      }

      // Identify Timestamp line (contains '-->')
      let timeLineIdx = lines.findIndex(l => l.includes('-->'));
      
      if (timeLineIdx !== -1) {
          const timeLine = lines[timeLineIdx];
          const [startStr, endStr] = timeLine.split('-->');
          
          // Text starts after timeline
          const textLines = lines.slice(timeLineIdx + 1);
          const text = textLines.join(' ').trim(); // Flatten text

          // Parse ID (if present before timecode)
          let id = entries.length + 1;
          if (timeLineIdx > 0) {
             const potentialId = parseInt(lines[timeLineIdx - 1], 10);
             if (!isNaN(potentialId)) id = potentialId;
          }

          if (startStr && endStr) {
              entries.push({
                  id,
                  startTime: this.timeToSeconds(startStr),
                  endTime: this.timeToSeconds(endStr),
                  text
              });
          }
      }
    });

    return entries;
  }

  generateExportSrt(cuts: any[], fps: number): string {
    let output = '';
    let currentSeconds = 0;

    cuts.forEach((cut, index) => {
        // Duration in seconds based on frame count
        const durationSec = cut.duration / fps;
        
        const start = this.secondsToSrtTime(currentSeconds);
        const end = this.secondsToSrtTime(currentSeconds + durationSec);

        output += `${index + 1}\n`;
        output += `${start} --> ${end}\n`;
        output += `${cut.text}\n\n`;

        currentSeconds += durationSec;
    });

    return output;
  }
}
