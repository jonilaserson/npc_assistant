import { CORS_HEADERS, requireAuthAndCredits } from './utils/firebase';

import { VOICE_SELECTION_GUIDELINES } from './utils/prompts';

export default async (req, context) => {
    // Only allow POST requests
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
        // 1. Verify Authentication (Cost 0 for now as previously implicitly defined)
        const { errorResponse } = await requireAuthAndCredits(req, 0);
        if (errorResponse) return errorResponse;

        const body = await req.json();
        const { description, availableVoices } = body;
        const apiKey = process.env.GOOGLE_AI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing Server API Key" }), { status: 500, headers: CORS_HEADERS });
        }

        if (!description) {
            return new Response(JSON.stringify({ error: "Description is required" }), { status: 400, headers: CORS_HEADERS });
        }

        // Construct System Prompt
        const userQuery = `Convert the following raw description into a structured NPC profile suitable for a Dungeons and Dragons style setting. Focus only on the content and adhere strictly to the provided JSON schema. If the user hasn't provided a name, make up a suitable name for the NPC. Raw Description: "${description}"`;

        const systemPrompt = `You are a professional RPG game assistant. Your task is to analyze the provided text and output a complete JSON object based on the schema.

            CRITICAL: You must select the most appropriate voice for this character from the following list of available voices.

            Available Voices:
            ${(availableVoices || []).join("\n")}

            ${VOICE_SELECTION_GUIDELINES}
            
            IMPORTANT: Select your TOP 3 best matching voices.
            Return them as a list in the 'voiceCandidates' field.`;


        const model = "gemini-2.5-flash";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: {
                parts: [{
                    text: systemPrompt
                }]
            },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        name: { type: "STRING", description: "The NPC's full name or title." },
                        raceClass: { type: "STRING", description: "The NPC's race and class/profession (e.g., 'Half-Elf Bard', 'Gnome Tinker', 'Human Guard')." },
                        gender: { type: "STRING", description: "The NPC's gender, e.g., 'female', 'male', 'other'." },
                        ageRange: { type: "STRING", description: "The NPC's general age range, e.g., 'adult','young adult', 'old', 'middle-aged', 'child'." },
                        personality: { type: "STRING", description: "A concise, detailed summary of the NPC's disposition and mannerisms." },
                        wants: { type: "STRING", description: "The NPC's primary goal or desire. Write one very short sentence." },
                        secrets: { type: "STRING", description: "A key secret the NPC hides, critical for plot development. Write one very short sentence." },
                        pitfalls: { type: "STRING", description: "One thing that may make the NPC lose patience, interest, or demand a clarification in the conversation. Write one very short sentence." },
                        visual: { type: "STRING", description: "A detailed visual description of the NPC's physical appearance, clothing, and equipment." },
                        voiceCandidates: { type: "ARRAY", items: { type: "STRING" }, description: "List of the top 3 best matching voice names (e.g. ['Fenrir', 'Roger', 'Sarah'])." }
                    }
                }
            }
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Log the response for debugging (optional)
        if (!response.ok || data.error) {
            console.error("Gemini API Error Response:", JSON.stringify(data, null, 2));
        }

        return new Response(JSON.stringify(data), {
            status: response.status,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });

    } catch (error) {
        console.error("Generate NPC Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
