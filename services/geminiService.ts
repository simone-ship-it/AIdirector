
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { SrtEntry } from "../types";

export class GeminiService {
    private ai: GoogleGenAI;

    constructor() {
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }

    async selectQuotes(
        srtData: SrtEntry[], 
        userInstructions: string, 
        targetDuration: number,
        seed: number
    ): Promise<number[]> {
        // 1. Optimize Input: Send duration (d) and text (t)
        // We map to a simpler structure to save context window tokens
        const simplifiedTranscript = srtData.map(s => ({
            id: s.id,
            d: Number((s.endTime - s.startTime).toFixed(1)),
            t: s.text.replace(/[\r\n]+/g, ' ').trim(), 
        }));

        const totalInputDuration = simplifiedTranscript.reduce((acc, cur) => acc + cur.d, 0);
        
        // 2. Construct System Instruction with SCORING concept
        const systemInstruction = `
        Act as a professional Video Editor.
        Your goal is to edit a video summary by selecting specific subtitle IDs.

        INPUT METRICS:
        - Total Source Duration: ~${Math.round(totalInputDuration)}s
        - Target Output Duration: ${targetDuration}s
        
        CRITICAL RULES:
        1. **FULL COVERAGE**: You MUST pick clips from the BEGINNING, MIDDLE, and END. Do not ignore the ending.
        2. **STRUCTURE**: You MUST include a brief intro/hook (first 2 mins) to establish context, even if it is short.
        3. **SCORING**: Assign an 'importance' score (1-10) to every selection. 
           - 10 = Essential/Climax/Conclusion (MUST INCLUDE).
           - 8-9 = Strong Context / Hook.
           - 1 = Filler/Bridge (Can be cut if space is tight).
        4. **OVER-SELECT**: It is better to select slightly more than ${targetDuration}s. We will prune the low-score items later.
        5. **NARRATIVE**: Ensure the story makes sense. Keep the setup and the punchline.

        USER INSTRUCTIONS: "${userInstructions}"
        `;

        const userPrompt = `
        TRANSCRIPT:
        ${JSON.stringify(simplifiedTranscript)}
        `;

        // 3. Schema now requires 'importance'
        const schema: Schema = {
            type: Type.OBJECT,
            properties: {
                selectedClips: {
                    type: Type.ARRAY,
                    items: { 
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.INTEGER },
                            importance: { type: Type.INTEGER, description: "1 to 10. 10 is highest priority." }
                        },
                        required: ["id", "importance"]
                    },
                    description: "List of selected subtitle segments with priority scores."
                }
            },
            required: ["selectedClips"]
        };

        try {
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: userPrompt,
                config: {
                    systemInstruction: systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: schema,
                    temperature: 0.2, // Slightly higher to allow creative distribution
                    seed: seed,
                    thinkingConfig: { thinkingBudget: 0 },
                }
            });

            const candidate = response.candidates?.[0];
            if (!candidate) throw new Error("No response from AI.");

            let text = response.text || "";
            // Sanitize JSON
            if (text.startsWith('```json')) text = text.replace(/^```json\s?/, '').replace(/\s?```$/, '');
            else if (text.startsWith('```')) text = text.replace(/^```\s?/, '').replace(/\s?```$/, '');
            text = text.trim();

            const result = JSON.parse(text);
            
            if (!result.selectedClips || !Array.isArray(result.selectedClips)) {
                throw new Error("Invalid JSON structure");
            }

            // 4. POST-PROCESSING: INTELLIGENT PRUNING (The fix for "Barare" & "Cutting Intro")
            
            // Map IDs to their durations for quick lookup
            const durMap = new Map(simplifiedTranscript.map(s => [s.id, s.d]));
            
            // Convert to a mutable array of objects { id, importance, duration }
            let selection = result.selectedClips.map((item: any) => ({
                id: item.id,
                importance: item.importance,
                duration: durMap.get(item.id) || 0
            }));

            // Filter out invalid IDs
            selection = selection.filter((s: any) => s.duration > 0);

            // Sort chronologically first to calculate padding accurately
            selection.sort((a: any, b: any) => a.id - b.id);

            const ESTIMATED_PADDING_PER_JUMP = 0.5;

            // Function to calculate total duration of a list
            const calculateTotalDuration = (list: any[]) => {
                let total = 0;
                let lastId = -999;
                for (const item of list) {
                    let cost = item.duration;
                    if (item.id !== lastId + 1) {
                         cost += ESTIMATED_PADDING_PER_JUMP; // Add padding cost for jumps
                    }
                    total += cost;
                    lastId = item.id;
                }
                return total;
            };

            // Optimization Loop
            // While we are over budget, remove the LEAST IMPORTANT clip
            // FIX: Logic updated to avoid biased removal of the first elements (Intro)
            let attempts = 0;
            while (calculateTotalDuration(selection) > targetDuration && selection.length > 0 && attempts < 1000) {
                attempts++;
                
                let removeIdx = -1;
                let minScore = 11;
                const len = selection.length;

                // Identify the lowest score in the set
                for (let i = 0; i < len; i++) {
                    if (selection[i].importance < minScore) {
                        minScore = selection[i].importance;
                    }
                }

                // Find candidate indices with that lowest score
                const candidates = [];
                for (let i = 0; i < len; i++) {
                    if (selection[i].importance === minScore) {
                        candidates.push(i);
                    }
                }

                if (candidates.length > 0) {
                    // HEURISTIC: If we have multiple candidates with the same low score,
                    // prefer removing from the MIDDLE first to preserve Start (Hook) and End (Conclusion).
                    // If the list is short, we just pick the middle index of the candidates.
                    const middleIndex = Math.floor(candidates.length / 2);
                    // However, if candidates are scattered, we want the one that is physically in the middle of the video timeline
                    // But simplified: picking the middle candidate avoids systematically killing index 0.
                    removeIdx = candidates[middleIndex]; 
                }

                if (removeIdx !== -1) {
                    // Remove the low importance clip
                    selection.splice(removeIdx, 1);
                } else {
                    break;
                }
            }

            // 5. Final Sort & Return
            // Ensure strict chronological order for the timeline
            selection.sort((a: any, b: any) => a.id - b.id);
            
            return selection.map((s: any) => s.id);

        } catch (e: any) {
            console.error("Gemini API Error:", e);
             if (e.message && e.message.includes("JSON")) {
                 throw new Error(`AI JSON Parsing Error: ${e.message}.`);
            }
            throw new Error(`AI Error: ${e.message || 'Unknown error'}`);
        }
    }

    async generateSourceSummary(srtData: SrtEntry[]): Promise<string> {
        const fullText = srtData.map(s => s.text).join(" ");
        const truncatedText = fullText.length > 30000 ? fullText.substring(0, 30000) + "..." : fullText;
        
        const prompt = `
        Analyze this transcript and provide a 3-bullet point technical summary in Italian.
        Transcript: "${truncatedText}" 
        `;

        try {
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { temperature: 0.2 }
            });
            return response.text || "Analisi non disponibile.";
        } catch (e) {
            return "Analisi non disponibile.";
        }
    }
}
