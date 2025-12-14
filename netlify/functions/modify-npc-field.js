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
        const { action, structuredData, field } = body;
        // action: 'regenerate' or 'expand'

        const apiKey = process.env.GOOGLE_AI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing Server API Key" }), { status: 500, headers: CORS_HEADERS });
        }

        let userQuery = '';
        const fieldDescriptions = {
            personality: "A concise, detailed summary of the NPC's disposition and mannerisms.",
            wants: "The NPC's primary goal or desire.",
            secrets: "A key secret the NPC hides, critical for plot development.",
            pitfalls: "One thing that may make the NPC lose patience, interest, or demand a clarification in the conversation.",
            visual: "A detailed visual description of the NPC's physical appearance, clothing, and equipment."
        };
        const targetDescription = fieldDescriptions[field] || "content for this field";

        if (action === 'regenerate') {
            userQuery = `You are an expert RPG character creator. Your task is to regenerate ONLY the '${field}' field for the following character, keeping it consistent with their other traits but providing a fresh, creative variation.

    Character Context:
    - Name: ${structuredData.name}
    - Race/Class: ${structuredData.raceClass}
    - Gender/Age: ${structuredData.gender} ${structuredData.ageRange}
    ${field !== 'personality' ? `- Personality: ${structuredData.personality}` : ''}
    ${field !== 'wants' ? `- Wants: ${structuredData.wants}` : ''}
    ${field !== 'secrets' ? `- Secret: ${structuredData.secrets}` : ''}
    
    Task: Write a new, unique entry for '${field}'.
    CRITICAL: Keep the response SHORT and CONCISE (maximum 1-2 sentences).
    Description of this field: ${targetDescription}
    
    Respond with ONLY the text for the new '${field}'. Do not include labels, quotes, or explanations.`;

        } else if (action === 'expand') {
            userQuery = `You are an expert RPG character creator. Your task is to EXPAND the '${field}' field for the following character.
    
    Character Context:
    - Name: ${structuredData.name}
    - Race/Class: ${structuredData.raceClass}
    - Gender/Age: ${structuredData.gender} ${structuredData.ageRange}
    ${field !== 'personality' ? `- Personality: ${structuredData.personality}` : ''}
    
    Current '${field}': "${structuredData[field]}"
    
    Task: Expand and/or add one more *short* sentence to the '${field}' entry. Otherwise, only minimal modification are allowed to the existing text.
    Description of this field: ${targetDescription}
    
    Respond with ONLY the resulted text. Do not include labels, quotes, or explanations.`;
        } else {
            return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: CORS_HEADERS });
        }

        const model = "gemini-2.5-flash-preview-09-2025";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }]
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
        console.error("Modify NPC Field Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
