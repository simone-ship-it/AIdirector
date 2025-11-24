
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
        const simplifiedTranscript = srtData.map(s => ({
            id: s.id,
            d: Number((s.endTime - s.startTime).toFixed(1)), // Duration in seconds (1 decimal)
            t: s.text.replace(/[\r\n]+/g, ' ').trim(), 
        }));

        // 2. Calculate Statistics for strict guidance
        const totalInputDuration = simplifiedTranscript.reduce((acc, cur) => acc + cur.d, 0);
        const avgLineDuration = totalInputDuration / (simplifiedTranscript.length || 1);
        
        // Estimate Padding Overhead:
        // VideoEngine adds 10 frames total padding per cut. At 25fps that is 0.4s.
        // We use 0.5s to be safe.
        const ESTIMATED_PADDING_PER_CUT = 0.5;
        
        // Calculate a safe "Content Duration" target for the AI.
        // If we want 60s total, and we expect 10 cuts, we lose 5s to padding.
        // So AI should only find 55s of raw content.
        const estimatedCuts = targetDuration / (avgLineDuration + ESTIMATED_PADDING_PER_CUT);
        const paddingBuffer = estimatedCuts * ESTIMATED_PADDING_PER_CUT; 
        
        // Ask AI for slightly LESS than the target to accommodate the engine's padding
        const aiTargetDuration = Math.max(10, targetDuration - paddingBuffer);
        const targetLineCount = Math.floor(aiTargetDuration / (avgLineDuration || 1));

        // 3. Construct System Instruction
        const systemInstruction = `
        Act as a professional Video Editor.
        Your goal is to select a subset of subtitle IDs to create a video summary.

        INPUT DATA:
        Array of { "id": number, "d": duration_seconds, "t": text }.

        STRICT CONSTRAINTS:
        1. TOTAL DURATION LIMIT: ${targetDuration} seconds.
        2. RAW CONTENT GOAL: ~${Math.floor(aiTargetDuration)} seconds (The engine adds padding to cuts).
        3. TARGET LINES: Approx ${targetLineCount} IDs.
        
        CRITICAL RULES:
        - DO NOT exceed the duration limit. It is better to be shorter.
        - You MUST skip less important sections.
        - Group IDs that form a coherent thought.
        
        USER GOAL: "${userInstructions}"
        `;

        const userPrompt = `
        TRANSCRIPT DATA:
        ${JSON.stringify(simplifiedTranscript)}
        `;

        const schema: Schema = {
            type: Type.OBJECT,
            properties: {
                selectedIds: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                    description: "The list of SRT IDs selected for the final edit."
                }
            },
            required: ["selectedIds"]
        };

        try {
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: userPrompt,
                config: {
                    systemInstruction: systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: schema,
                    temperature: 0.1, // Very low temp for strict adherence
                    seed: seed,
                    thinkingConfig: { thinkingBudget: 0 },
                }
            });

            // 4. Response Handling
            const candidate = response.candidates?.[0];
            
            if (!candidate) {
                throw new Error("No candidates returned from AI.");
            }

            if (candidate.finishReason !== "STOP") {
                throw new Error(`AI stopped generation abnormally. Reason: ${candidate.finishReason}.`);
            }

            let text = response.text;
            if (!text) throw new Error("Empty text response.");

            // Cleanup
            text = text.trim();
            if (text.startsWith('```json')) {
                text = text.replace(/^```json\s?/, '').replace(/\s?```$/, '');
            } else if (text.startsWith('```')) {
                text = text.replace(/^```\s?/, '').replace(/\s?```$/, '');
            }
            text = text.trim();

            const result = JSON.parse(text);
            
            if (!result.selectedIds || !Array.isArray(result.selectedIds)) {
                throw new Error("Invalid JSON structure");
            }
            
            // 5. Post-Processing: HARD LIMIT ENFORCER
            // We calculate the *actual* duration the VideoEngine will generate.
            // (Raw Duration + Padding)
            // We stop adding IDs the moment we cross the targetDuration.
            
            let accumulatedDuration = 0;
            const filteredIds: number[] = [];
            const idMap = new Map(simplifiedTranscript.map(s => [s.id, s.d]));

            for (const id of result.selectedIds) {
                const rawDur = idMap.get(id);
                
                // Skip invalid IDs
                if (rawDur === undefined) continue;

                // Simulate the VideoEngine's padding logic (approx 0.4s - 0.5s)
                const clipTotalDuration = rawDur + ESTIMATED_PADDING_PER_CUT;

                // Check if adding this clip would exceed the user's requested total
                if (accumulatedDuration + clipTotalDuration > targetDuration) {
                    // Stop immediately. Do not add this clip.
                    break; 
                }

                accumulatedDuration += clipTotalDuration;
                filteredIds.push(id);
            }

            // Fallback: If AI returned almost nothing, return at least one ID if available
            if (filteredIds.length === 0 && result.selectedIds.length > 0) {
                 return [result.selectedIds[0]];
            }

            return filteredIds;

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
