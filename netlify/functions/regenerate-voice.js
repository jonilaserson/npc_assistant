import { CORS_HEADERS, requireAuthAndCredits } from './utils/firebase';

import { VOICE_SELECTION_GUIDELINES } from './utils/prompts';

export default async (req, context) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
        const { errorResponse } = await requireAuthAndCredits(req, 0);
        if (errorResponse) return errorResponse;

        const body = await req.json();
        const { structuredData, availableVoices } = body;
        const apiKey = process.env.GOOGLE_AI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing Server API Key" }), { status: 500, headers: CORS_HEADERS });
        }

        const systemPrompt = `You are a professional voice casting director for RPG characters. Your task is to select a NEW voice for this character that matches their profile.

Character Information:
- Name: ${structuredData.name}
- Race/Class: ${structuredData.raceClass}
- Gender: ${structuredData.gender}
- Age Range: ${structuredData.ageRange}
- Personality: ${structuredData.personality}

Available Voices:
${(availableVoices || []).join("\n")}

${VOICE_SELECTION_GUIDELINES}

Voice Selection Process:
1. Analyze the character's gender, age, and personality traits
2. Identify the TOP 3 voices that best match this character

CRITICAL: 
- Return your TOP 3 choices as a list of strings.
- Just provide the best matches.`;

        const model = "gemini-2.5-flash";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: "Select new voice candidates for this character." }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        candidates: {
                            type: "ARRAY",
                            items: { type: "STRING" },
                            description: "List of the top 3 best matching voice names (e.g. ['Fenrir', 'Roger', 'Sarah'])."
                        }
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

        return new Response(JSON.stringify(data), {
            status: response.status,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });

    } catch (error) {
        console.error("Regenerate Voice Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
