import { fetchWithBackoff } from '../utils/apiUtils';
import { AVAILABLE_VOICES, getVoiceById } from '../constants/voices';
import { selectVoiceFromCandidates } from './audioService';
import {
    getStructuredNPCPrompt,
    getSceneGenerationPrompt,
    getImageGenerationPrompt,
    getImageSystemInstruction,
    getImageFallbackPrompt,
    getRoleplaySystemPrompt,
    getFieldRegenerationPrompt,
    getFieldExpansionPrompt
} from '../constants/prompts';

/**
 * Generates structured NPC data (Personality, Wants, Secrets, Gender, Age) from a text description.
 */
export const generateStructuredNPC = async (description) => {
    if (!AVAILABLE_VOICES || AVAILABLE_VOICES.length === 0) {
        throw new Error("Configuration Error: AVAILABLE_VOICES list is missing or empty.");
    }

    const { userQuery, systemPrompt } = getStructuredNPCPrompt(description, AVAILABLE_VOICES);

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

    const apiUrl = `/.netlify/functions/gemini`;

    try {
        const response = await fetchWithBackoff(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("Could not parse structured NPC response.");

        const parsedData = JSON.parse(jsonText);

        // Programmatic Voice Selection using shared helper
        const candidates = parsedData.voiceCandidates || [];
        const selectedVoice = selectVoiceFromCandidates(candidates); // No exclusion for initial generation

        parsedData.voiceId = selectedVoice || null;

        if (selectedVoice) {
            const voiceData = getVoiceById(selectedVoice.split(' ')[0]);
            if (voiceData) {
                // console.log(`voice_id: ${voiceData.id} (${voiceData.provider === 'elevenlabs' ? 'Elevenlabs' : 'Google TTS'})`);
            }
        }

        // Remove the candidates field from the final object to match expected structure
        delete parsedData.voiceCandidates;

        return parsedData;
    } catch (e) {
        console.error("Error generating structured NPC:", e);
        throw new Error(`Failed to generate structured profile: ${e.message}`);
    }
};

/**
 * Generates a scene description, context, and goal.
 * If conversationHistory is provided, the scene will build on the conversation.
 */
export const generateScene = async (npcData, conversationHistory = null) => {
    const systemPrompt = getSceneGenerationPrompt(npcData, conversationHistory);

    const payload = {
        contents: [{ parts: [{ text: "Generate a scene." }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
    };

    const apiUrl = `/.netlify/functions/gemini`;

    try {
        const response = await fetchWithBackoff(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Model returned no text response.");
        return text.trim();
    } catch (e) {
        console.error("Error generating scene:", e);
        throw new Error("Failed to generate scene.");
    }
};

/**
 * Generates an image for the NPC using OpenAI's DALL-E 3.
 * Uses a two-step process: first asks an LLM to create the perfect DALL-E prompt,
 * then generates the image with that optimized prompt.
 */
export const generateNPCImage = async (name, raceClass, visualDescription, gender, ageRange, personality, npcId, isInitial = false) => {
    // Step 1: Ask the LLM to act as a DALL-E artist and create the perfect prompt
    console.log(`\n%c[NPC Generator] Step 1: Asking LLM to create optimized DALL-E prompt...`, 'color: magenta; font-weight: bold;');

    const promptCreationQuery = getImageGenerationPrompt(name, raceClass, visualDescription, gender, ageRange, personality);

    const promptPayload = {
        contents: [{ parts: [{ text: promptCreationQuery }] }],
        systemInstruction: {
            parts: [{
                text: getImageSystemInstruction()
            }]
        }
    };

    const geminiApiUrl = `/.netlify/functions/gemini`;

    let optimizedPrompt;
    try {
        const promptResponse = await fetchWithBackoff(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(promptPayload)
        });
        const promptResult = await promptResponse.json();
        optimizedPrompt = promptResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!optimizedPrompt) {
            console.warn("Could not generate optimized prompt, falling back to basic prompt");
            const description = (visualDescription && visualDescription.trim()) ? visualDescription : personality;
            optimizedPrompt = getImageFallbackPrompt(name, gender, ageRange, raceClass, description);
        }
    } catch (e) {
        console.warn("Error generating optimized prompt, using fallback:", e);
        const description = (visualDescription && visualDescription.trim()) ? visualDescription : personality;
        optimizedPrompt = getImageFallbackPrompt(name, gender, ageRange, raceClass, description);
    }

    console.log(`\n%c[NPC Generator] Optimized DALL-E Prompt:`, 'color: cyan; font-weight: bold;');
    console.log(optimizedPrompt);
    console.log('----------------------------------------\n');

    // Step 2: Use the optimized prompt with the appropriate model
    console.log(`%c[NPC Generator] Step 2: Generating ${isInitial ? 'initial (DALL-E 2, 256x256)' : 'high-quality (DALL-E 3, 1024x1024)'} image...`, 'color: green; font-weight: bold;');

    const apiUrl = '/.netlify/functions/generate-image';

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: optimizedPrompt,
                npcId: npcId,
                isInitial: isInitial
            })
        });

        if (!response.ok) {
            let errorMessage = "Image generation failed";
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
            } catch (parseError) {
                // If response is not JSON (e.g. timeout text), get text
                const errorText = await response.text();
                errorMessage = errorText || response.statusText || errorMessage;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        console.log(`[${new Date().toISOString()}] Image Generated and Uploaded:`, result);

        // Return the object with secure_url and public_id
        return result;
    } catch (e) {
        console.error("Error generating image:", e);
        throw new Error(`Failed to generate NPC image: ${e.message}`);
    }
};

/**
 * Sends a message to the NPC and gets a roleplaying response.
 * Includes formatting instructions for narration/dialogue.
 * If currentGoal is provided, also checks if the goal was achieved.
 * Returns: string (if no goal) or { response: string, goalAchieved: boolean } (if goal provided)
 */
export const getNPCResponse = async (structuredData, chatHistory, currentGoal = null) => {
    let systemPrompt = getRoleplaySystemPrompt(structuredData, currentGoal);

    // Map chat history to the required model format
    const contents = chatHistory.map(msg => ({
        role: msg.role === 'npc' ? 'model' : 'user',
        parts: [{ text: msg.text }]
    }));

    const payload = {
        contents: contents,
        systemInstruction: { parts: [{ text: systemPrompt }] }
    };

    const apiUrl = `/.netlify/functions/gemini`;

    try {
        const response = await fetchWithBackoff(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        // Log the full response for debugging
        console.log("Gemini API response:", result);

        // Check for API error
        if (result.error) {
            console.error("Gemini API error:", result.error);

            // Handle 503 (overloaded) specifically
            if (result.error.code === 503 || result.error.status === "UNAVAILABLE") {
                throw new Error("The service is currently overloaded. Please wait a moment and try again.");
            }

            // Generic error - don't expose technical details
            console.error("Full error details:", result.error);
            throw new Error("Unable to get a response right now. Please try again.");
        }

        // Check if content was blocked
        if (result.candidates?.[0]?.finishReason === 'SAFETY' ||
            result.candidates?.[0]?.finishReason === 'RECITATION' ||
            result.candidates?.[0]?.finishReason === 'OTHER') {
            console.error("Content blocked by safety filters:", result.candidates[0]);
            throw new Error("Content blocked. Try rephrasing your message.");
        }

        let text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            console.error("No text in response. Full result:", JSON.stringify(result, null, 2));
            throw new Error("No response was generated. Please try rephrasing your message.");
        }

        // If we're tracking a goal, look for the hidden marker
        if (currentGoal) {
            const achievedMarker = '###GOAL_ACHIEVED###';
            const notAchievedMarker = '###GOAL_NOT_ACHIEVED###';

            let goalAchieved = false;

            if (text.includes(achievedMarker)) {
                goalAchieved = true;
                text = text.replace(achievedMarker, '').trim();
            } else if (text.includes(notAchievedMarker)) {
                goalAchieved = false;
                text = text.replace(notAchievedMarker, '').trim();
            }

            return {
                response: text,
                goalAchieved: goalAchieved
            };
        }

        return text;
    } catch (e) {
        console.error("Error getting NPC response:", e);
        // Re-throw user-friendly errors, or provide a generic message
        if (e.message && !e.message.includes('API') && !e.message.includes('console')) {
            throw e;
        }
        throw new Error("Unable to get a response. Please try again.");
    }
};

/**
 * Extracts the goal text from a scene description.
 * Scene format: "Setting: ...\n\nContext: ...\n\nGoal: ..."
 */
export const parseGoalFromScene = (sceneText) => {
    if (!sceneText) return null;

    // Look for "Goal:" followed by the goal text
    const goalMatch = sceneText.match(/Goal:\s*(.+?)(?:\n\n|\n|$)/i);
    if (goalMatch && goalMatch[1]) {
        return goalMatch[1].trim();
    }
    return null;
};

/**
 * Regenerates a specific field of the NPC profile based on the rest of the data.
 */
export const regenerateNPCField = async (structuredData, field) => {
    const systemPrompt = getFieldRegenerationPrompt(structuredData, field);

    const payload = {
        contents: [{ parts: [{ text: "Regenerate this field." }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
    };

    const apiUrl = `/.netlify/functions/gemini`;

    try {
        const response = await fetchWithBackoff(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Model returned no text response.");
        return text.trim();
    } catch (e) {
        console.error(`Error regenerating field ${field}:`, e);
        throw new Error(`Failed to regenerate ${field}.`);
    }
};

/**
 * Expands a specific field of the NPC profile to be more detailed.
 */
export const expandNPCField = async (structuredData, field) => {
    const systemPrompt = getFieldExpansionPrompt(structuredData, field);

    const payload = {
        contents: [{ parts: [{ text: "Expand this field." }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
    };

    const apiUrl = `/.netlify/functions/gemini`;

    try {
        const response = await fetchWithBackoff(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Model returned no text response.");
        return text.trim();
    } catch (e) {
        console.error(`Error expanding field ${field}:`, e);
        throw new Error(`Failed to expand ${field}.`);
    }
};
