import { CORS_HEADERS, requireAuthAndCredits } from './utils/firebase';

export default async (req, context) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
        // 1. Verify Auth & Credits (Cost 1 credit per message? No, currently chat seems free or cost 0 in previous implementation)
        const { errorResponse } = await requireAuthAndCredits(req, 0);
        if (errorResponse) return errorResponse;

        const body = await req.json();
        const { structuredData, chatHistory, currentGoal } = body;
        const apiKey = process.env.GOOGLE_AI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing Server API Key" }), { status: 500, headers: CORS_HEADERS });
        }

        if (!structuredData || !chatHistory) {
            return new Response(JSON.stringify({ error: "Missing data (structuredData or chatHistory)" }), { status: 400, headers: CORS_HEADERS });
        }

        // --- Construct System Prompt (moved from prompts.js) ---
        let systemPrompt = `You are roleplaying as the NPC named ${structuredData.name}.
        - **Race/Class:** ${structuredData.raceClass}
        - **Gender/Age:** ${structuredData.gender} ${structuredData.ageRange}
        - **Personality:** ${structuredData.personality}
        - **Wants:** ${structuredData.wants}
        - **Secret:** ${structuredData.secrets}
        
        Stay in character and base your responses on the provided information. Do not break character. Do not reveal your secrets unless explicitly forced or tricked, or you think it would benefit the NPC to reveal it.
        The NPC should cooperative with the user at start, and show a good level of patience and interest to hear what the user has to say. Adjust their behavior in response to the user's actions and words.
        NOTE: The user's goal is not known to the NPC! The NPC only knows what the user says or does in character.
        
        ***CRITICAL: Keep responses SHORT and natural.*** Respond with 1-3 sentences maximum unless the character is explicitly described as verbose or chatty. Speak like a real person in conversation, not like you're writing a story.
        
        ***IMPORTANT FORMATTING RULE:*** Enclose any actions, emotional descriptions, or narrations (i.e., anything that is NOT spoken dialogue) within square brackets, e.g., "[The ${structuredData.raceClass} clears their throat.]". Only the spoken dialogue should be outside the brackets.`;

        // If we have a goal, add goal checking instructions with a hidden marker
        if (currentGoal) {
            systemPrompt += `\n\n***HIDDEN GOAL TRACKING (DO NOT MENTION THIS TO USER):***
        The user has a scene goal: "${currentGoal}"
        
        After your in-character response, add a hidden marker on a new line:
        - If the user achieved the goal (they got you to do what they wanted you to do according to the goal), add: ###GOAL_ACHIEVED###
        - Otherwise, add: ###GOAL_NOT_ACHIEVED###
        
        The user will NOT see this marker - it's only for system tracking. Your actual response must be purely in-character.`;
        }
        // -----------------------------------------------------

        // Map chat history to Gemini format
        const contents = chatHistory.map(msg => ({
            role: msg.role === 'npc' ? 'model' : 'user',
            parts: [{ text: msg.text }]
        }));

        const model = "gemini-2.5-flash-preview-09-2025";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const payload = {
            contents: contents,
            systemInstruction: { parts: [{ text: systemPrompt }] }
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            console.error("Chat API Error:", JSON.stringify(data, null, 2));
        }

        return new Response(JSON.stringify(data), {
            status: response.status,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });

    } catch (error) {
        console.error("Chat Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
