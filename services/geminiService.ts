
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
        targetDuration: number
    ): Promise<number[]> {
        // Simplify input significantly to reduce token load
        const simplifiedTranscript = srtData.map(s => ({
            id: s.id,
            text: s.text,
        }));

        const prompt = `
        Act as a professional Video Editor.
        
        OBJECTIVE:
        Select a subset of subtitle IDs to create a video summary.
        
        INPUT PARAMETERS:
        - Target Duration: ${targetDuration} seconds.
        - User Instructions: "${userInstructions}"

        CRITICAL RULES:
        1. CONFLICT RESOLUTION: The numeric Target Duration (${targetDuration}s) ALWAYS overrides any duration mentioned in the User Instructions. Ignore text like "halve the video" if it conflicts with the number.
        2. FLOW: Prioritize selecting CONTIGUOUS blocks of IDs (e.g., [10, 11, 12, 13]) rather than isolated lines. This is crucial for smooth audio.
        3. GRAMMAR: Do not start a cut with conjunctions (And, But, So) unless the previous line is also selected.
        4. NARRATIVE: Ensure the selection has a logical start, middle, and end.
        
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
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: schema,
                    temperature: 0.4, // Slightly higher to prevent "freezing" on strict constraints
                    maxOutputTokens: 8192,
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
                    ]
                }
            });

            const text = response.text;
            if (!text) {
                throw new Error("Empty response from AI. The model blocked the content or failed to generate.");
            }

            const result = JSON.parse(text);
            
            if (!result.selectedIds || !Array.isArray(result.selectedIds)) {
                throw new Error("Invalid JSON structure returned by AI");
            }
            
            return result.selectedIds;

        } catch (e: any) {
            console.error("Gemini API Error:", e);
            throw new Error(`AI Error: ${e.message || 'Unknown error'}`);
        }
    }

    async generateSourceSummary(srtData: SrtEntry[]): Promise<string> {
        const fullText = srtData.map(s => s.text).join(" ");
        
        const prompt = `
        Analyze this transcript and provide a 3-bullet point technical summary in Italian (Topic, Speaker Type, Key Themes). Keep it under 50 words.
        
        Transcript:
        "${fullText.substring(0, 10000)}" 
        `;

        try {
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    temperature: 0.2,
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
                    ]
                }
            });

            return response.text || "Analisi non disponibile.";
        } catch (e) {
            console.error("Gemini Summary Error:", e);
            return "Analisi non disponibile.";
        }
    }
}
