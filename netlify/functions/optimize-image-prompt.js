import { CORS_HEADERS, requireAuthAndCredits } from './utils/firebase';

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
        const { name, raceClass, visualDescription, gender, ageRange, personality } = body;
        const apiKey = process.env.GOOGLE_AI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing Server API Key" }), { status: 500, headers: CORS_HEADERS });
        }

        // --- Prompts moved from src/prompts.js ---
        const userQuery = `You are now working as a professional DALL-E artist, who knows all the little tricks to make the perfect image. Your task is to create the PERFECT prompt that will encapsulate this NPC the best for DALL-E image generation.

Character Information:
- Name: ${name}
- Race/Class: ${raceClass}
- Gender: ${gender}
- Age Range: ${ageRange}
- Visual Description: ${visualDescription || 'Not provided'}
- Personality: ${personality}

Create a detailed, vivid DALL-E prompt that will generate a portrait that perfectly captures this character. The prompt should:
1. Focus on visual details that bring the character to life
2. Include appropriate art style directions (Dungeons and Dragons fantasy art, dramatic lighting, professional illustration)
3. Ensure the character is centered and fills the frame
4. Incorporate personality traits into visual cues where appropriate
5. Be specific about physical appearance, clothing, equipment, and atmosphere
6. Use the following style: Dungeons and Dragons fantasy art, dramatic lighting, professional illustration
7. The resulting should be an image without any textual labels or overlays other than a single portrait of the character.
8. CRITICAL: The generated prompt MUST be less than 700 characters in length.
Respond with ONLY the prompt text, nothing else.`;

        const systemInstruction = `You are an expert DALL-E prompt engineer specializing in fantasy character art. Your task is to create the most effective prompt possible to generate a stunning character portrait. Be specific, vivid, and focus on visual details that will translate well to image generation.`;

        const model = "gemini-2.5-flash";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        let optimizedPrompt = data.candidates?.[0]?.content?.parts?.[0]?.text;

        // Fallback Logic (if Gemini fails to return text, we can construct fallback here or let frontend do it)
        // Ideally we return the refined prompt or null.
        // We can replicate fallback logic here if needed, but simplest is to return what we got.

        // If empty, we can provide the fallback prompt directly from here?
        if (!optimizedPrompt) {
            optimizedPrompt = `Create a portrait of ${name}, a ${gender} ${ageRange} ${raceClass}. ${visualDescription || personality || ''} The character should be centered and fill the frame. Style: Dungeons and Dragons fantasy art, dramatic lighting, professional illustration.`;
        }

        return new Response(JSON.stringify({ optimizedPrompt }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });

    } catch (error) {
        console.error("Optimize Image Prompt Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
