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
        const { npcData, conversationHistory } = body;
        const apiKey = process.env.GOOGLE_AI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing Server API Key" }), { status: 500, headers: CORS_HEADERS });
        }

        if (!npcData) {
            return new Response(JSON.stringify({ error: "Missing npcData" }), { status: 400, headers: CORS_HEADERS });
        }

        // --- Construct System Prompt (moved from prompts.js) ---

        // Build conversation history section if available
        let conversationSection = '';
        if (conversationHistory && conversationHistory.length > 0) {
            // Find the most recent scene
            let previousSceneText = '';
            for (let i = conversationHistory.length - 1; i >= 0; i--) {
                if (conversationHistory[i].role === 'scene') {
                    previousSceneText = conversationHistory[i].text;
                    break;
                }
            }

            // Get last 10 messages (should cover ~5 per side), excluding scene messages
            // Since we receive 'conversationHistory' (expecting Array), we process it.
            // Note: In frontend code, it mapped roles 'npc'/'assistant' to name. We need to reproduce that logic.
            const recentMessages = conversationHistory.slice(-10)
                .filter(msg => msg.role !== 'scene')
                .map(msg => {
                    if (msg.role === 'user') return `User: ${msg.text}`;
                    if (msg.role === 'npc' || msg.role === 'assistant') return `${npcData.name}: ${msg.text}`;
                    return '';
                })
                .filter(m => m)
                .join('\n');

            conversationSection = `
        ${previousSceneText ? `Previous Scene:
        ${previousSceneText}
        
        ` : ''}Recent Conversation (last ~5 exchanges):
        ${recentMessages}
        `;
        }

        const systemPrompt = `You are a creative Dungeon Master helper. Your task is to generate a concise scene for a roleplay conversation with the following NPC.
        
        NPC: ${npcData.name} (${npcData.raceClass})
        Personality: ${npcData.personality}
        Principal Desire/Want: ${npcData.wants}${conversationSection}
        
        Output Format:
        Setting: [Where the scene takes place, time of day if relevant${conversationHistory && conversationHistory.length > 0 ? ', and how much time passed since the previous scene if there was a time skip' : ''}. May include brief atmospheric details like weather, sounds, or smells if relevant]

        Context: [What the NPC is doing and how the User encountered them, or the development that arised in the conclusion of the previous scene]

        Goal: [A specific objective for the User to achieve in this conversation scene]
        
        Requirements:
        - Keep all three sections short (max 1 sentence each).
        - Separate the three sections (Setting, Context, Goal) with an empty line between them.
        ${conversationHistory && conversationHistory.length > 0 ? '- The new scene should take place some time after the events in the conversation so far, and offer a fresh, *new* direction or development. The goal should also be a different type of challenge from the previous scene. A reasonable time skip is acceptable.' : ''}
        - Make the Goal be something the NPC could provide or assist with, but requires some effort or convincing from the user.
        - Do not use markdown bolding in the output logic, just plain text headers are fine.
        - Refer to the user's character as "your character".
        `;

        // --------------------------------------------------------

        const model = "gemini-2.5-flash";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: "Generate a scene." }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            console.error("Generate Scene API Error:", JSON.stringify(data, null, 2));
        }

        return new Response(JSON.stringify(data), {
            status: response.status,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });

    } catch (error) {
        console.error("Generate Scene Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
