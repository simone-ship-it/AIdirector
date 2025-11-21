
import { ClipItem, SequenceData, EditDecision } from '../types';

export class PremiereXmlParser {
  private parser: DOMParser;

  constructor() {
    this.parser = new DOMParser();
  }

  parse(xmlContent: string): SequenceData {
    const xmlDoc = this.parser.parseFromString(xmlContent, "text/xml");

    // 1. Extract Timebase (FPS)
    let timebaseNode = xmlDoc.querySelector("sequence > rate > timebase");
    if (!timebaseNode) {
        timebaseNode = xmlDoc.querySelector("xmeml > sequence > rate > timebase");
    }
    const fps = timebaseNode ? parseInt(timebaseNode.textContent || "25", 10) : 25;

    // 1b. Extract Resolution
    let width = 1920;
    let height = 1080;
    const widthNode = xmlDoc.querySelector("samplecharacteristics > width");
    const heightNode = xmlDoc.querySelector("samplecharacteristics > height");
    if (widthNode && heightNode) {
        width = parseInt(widthNode.textContent || "1920", 10);
        height = parseInt(heightNode.textContent || "1080", 10);
    }

    // 2. PASS 1: File Indexing
    const fileMap = new Map<string, { path: string, name: string }>();
    const allFileNodes = xmlDoc.querySelectorAll("file"); 
    
    allFileNodes.forEach(fileNode => {
        const id = fileNode.getAttribute("id");
        const pathurl = fileNode.querySelector("pathurl")?.textContent;
        const name = fileNode.querySelector("name")?.textContent;

        if (id && pathurl && name) {
            fileMap.set(id, { path: pathurl, name: name });
        }
    });

    // 3. PASS 2: Timeline Mapping
    const clips: ClipItem[] = [];
    const videoTrackNodes = xmlDoc.querySelectorAll("sequence > media > video > track");

    videoTrackNodes.forEach((track, index) => {
        const trackIndex = index + 1; // V1, V2...
        const clipNodes = track.querySelectorAll("clipitem");
        
        clipNodes.forEach((node) => {
            const id = node.getAttribute("id") || `unknown-${Math.random()}`;
            const name = node.querySelector("name")?.textContent || "Untitled";
            
            const startStr = node.querySelector("start")?.textContent;
            const endStr = node.querySelector("end")?.textContent;
            const inStr = node.querySelector("in")?.textContent;
            const outStr = node.querySelector("out")?.textContent;
            
            if (startStr === null || endStr === null || inStr === null || outStr === null) return;

            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            const inPoint = parseInt(inStr, 10);
            const outPoint = parseInt(outStr, 10);

            const fileNode = node.querySelector("file");
            const fileId = fileNode?.getAttribute("id");
            
            if (fileId && start !== -1 && end !== -1) {
                const fileInfo = fileMap.get(fileId);
                
                if (fileInfo) {
                    clips.push({
                        id,
                        name: fileInfo.name,
                        start,
                        end,
                        in: inPoint,
                        out: outPoint,
                        fileId,
                        filePath: fileInfo.path,
                        masterClipId: node.querySelector("masterclipid")?.textContent || "",
                        trackIndex: trackIndex
                    });
                }
            }
        });
    });

    clips.sort((a, b) => a.start - b.start);

    return { fps, width, height, clips };
  }

  generateExportXml(cuts: EditDecision[], fps: number, width: number, height: number): string {
    let videoTrackContent = '';
    let audioTrack1Content = '';
    let audioTrack2Content = '';
    
    let currentTime = 0;

    cuts.forEach((cut, index) => {
        const duration = cut.duration;
        const end = currentTime + duration;
        
        // Video Item
        const vidId = `clipitem-video-${index + 1}`;
        videoTrackContent += `
        <clipitem id="${vidId}">
            <masterclipid>${cut.fileId}</masterclipid> 
            <name>${cut.clipName}</name>
            <enabled>TRUE</enabled>
            <duration>${duration}</duration>
            <rate>
                <timebase>${fps}</timebase>
                <ntsc>FALSE</ntsc>
            </rate>
            <start>${currentTime}</start>
            <end>${end}</end>
            <in>${cut.sourceIn}</in>
            <out>${cut.sourceOut}</out>
            <file id="${cut.fileId}">
                <name>${cut.clipName}</name>
                <pathurl>${cut.filePath || ''}</pathurl>
                <rate>
                    <timebase>${fps}</timebase>
                    <ntsc>FALSE</ntsc>
                </rate>
                <media>
                    <video>
                        <samplecharacteristics>
                            <rate>
                                <timebase>${fps}</timebase>
                                <ntsc>FALSE</ntsc>
                            </rate>
                            <width>${width}</width> 
                            <height>${height}</height>
                            <anamorphic>FALSE</anamorphic>
                            <pixelaspectratio>square</pixelaspectratio>
                        </samplecharacteristics>
                    </video>
                    <audio>
                        <samplecharacteristics>
                            <depth>16</depth>
                            <samplerate>48000</samplerate>
                        </samplecharacteristics>
                        <channelcount>2</channelcount>
                    </audio>
                </media>
            </file>
             <link>
                <linkclipref>${vidId}</linkclipref>
                <mediatype>video</mediatype>
                <trackindex>1</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
            <link>
                <linkclipref>clipitem-audio1-${index + 1}</linkclipref>
                <mediatype>audio</mediatype>
                <trackindex>1</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
            <link>
                <linkclipref>clipitem-audio2-${index + 1}</linkclipref>
                <mediatype>audio</mediatype>
                <trackindex>2</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
        </clipitem>`;

        // Audio Track 1 Item
        audioTrack1Content += `
        <clipitem id="clipitem-audio1-${index + 1}">
            <masterclipid>${cut.fileId}</masterclipid>
            <name>${cut.clipName}</name>
            <enabled>TRUE</enabled>
            <duration>${duration}</duration>
            <rate>
                <timebase>${fps}</timebase>
                <ntsc>FALSE</ntsc>
            </rate>
            <start>${currentTime}</start>
            <end>${end}</end>
            <in>${cut.sourceIn}</in>
            <out>${cut.sourceOut}</out>
            <file id="${cut.fileId}" />
            <sourcetrack>
                <mediatype>audio</mediatype>
                <trackindex>1</trackindex>
            </sourcetrack>
            <link>
                <linkclipref>${vidId}</linkclipref>
                <mediatype>video</mediatype>
                <trackindex>1</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
            <link>
                <linkclipref>clipitem-audio1-${index + 1}</linkclipref>
                <mediatype>audio</mediatype>
                <trackindex>1</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
            <link>
                <linkclipref>clipitem-audio2-${index + 1}</linkclipref>
                <mediatype>audio</mediatype>
                <trackindex>2</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
        </clipitem>`;

        // Audio Track 2 Item
        audioTrack2Content += `
        <clipitem id="clipitem-audio2-${index + 1}">
            <masterclipid>${cut.fileId}</masterclipid>
            <name>${cut.clipName}</name>
            <enabled>TRUE</enabled>
            <duration>${duration}</duration>
            <rate>
                <timebase>${fps}</timebase>
                <ntsc>FALSE</ntsc>
            </rate>
            <start>${currentTime}</start>
            <end>${end}</end>
            <in>${cut.sourceIn}</in>
            <out>${cut.sourceOut}</out>
            <file id="${cut.fileId}" />
             <sourcetrack>
                <mediatype>audio</mediatype>
                <trackindex>2</trackindex>
            </sourcetrack>
            <link>
                <linkclipref>${vidId}</linkclipref>
                <mediatype>video</mediatype>
                <trackindex>1</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
            <link>
                <linkclipref>clipitem-audio1-${index + 1}</linkclipref>
                <mediatype>audio</mediatype>
                <trackindex>1</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
            <link>
                <linkclipref>clipitem-audio2-${index + 1}</linkclipref>
                <mediatype>audio</mediatype>
                <trackindex>2</trackindex>
                <clipindex>${index + 1}</clipindex>
            </link>
        </clipitem>`;
        
        currentTime = end;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-ai-generated">
    <uuid>${crypto.randomUUID()}</uuid>
    <name>AI_Sequence_${new Date().toISOString().slice(0,10)}</name>
    <rate>
        <timebase>${fps}</timebase>
        <ntsc>FALSE</ntsc>
    </rate>
    <media>
        <video>
            <format>
                <samplecharacteristics>
                    <rate>
                        <timebase>${fps}</timebase>
                        <ntsc>FALSE</ntsc>
                    </rate>
                    <width>${width}</width>
                    <height>${height}</height>
                    <pixelaspectratio>square</pixelaspectratio>
                </samplecharacteristics>
            </format>
            <track>
                ${videoTrackContent}
            </track>
        </video>
        <audio>
            <numOutputChannels>2</numOutputChannels>
            <format>
                <samplecharacteristics>
                    <depth>16</depth>
                    <samplerate>48000</samplerate>
                </samplecharacteristics>
            </format>
             <track>
                ${audioTrack1Content}
             </track>
             <track>
                ${audioTrack2Content}
             </track>
        </audio>
    </media>
</sequence>
</xmeml>`;
  }
}
