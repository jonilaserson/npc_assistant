import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { auth, db, storage } from './firebaseConfig';
import { Loader2, Zap, Brain, Wand2, MessageSquare, List, Send, Volume2, VolumeX, User, ChevronsDown, ChevronsUp, RefreshCw, Trash2, X, ChevronLeft, ChevronRight, Plus, GripVertical, Check, RotateCcw, Edit2, Eye, EyeOff, Sparkles, Maximize2 } from 'lucide-react';
import { FeedbackButton } from './components/FeedbackButton';
import { logUsage } from './analytics';
import * as Sentry from "@sentry/react";

const magicalStyles = `
@keyframes magic-wiggle {
    0%, 100% { transform: rotate(-3deg) scale(1); }
    50% { transform: rotate(3deg) scale(1.1); }
}
@keyframes magic-glow {
    0%, 100% { filter: drop-shadow(0 0 2px rgba(168, 85, 247, 0.4)); color: #9333ea; }
    50% { filter: drop-shadow(0 0 8px rgba(236, 72, 153, 0.8)); color: #db2777; }
}
@keyframes sparkle-fade {
    0%, 100% { opacity: 0; transform: scale(0); }
    50% { opacity: 1; transform: scale(1); }
}
.animate-magic {
    animation: magic-wiggle 0.5s ease-in-out infinite, magic-glow 1.5s ease-in-out infinite;
}
.animate-sparkle-1 {
    animation: sparkle-fade 1s ease-in-out infinite;
}
.animate-sparkle-2 {
    animation: sparkle-fade 1s ease-in-out infinite 0.5s;
}
`;

// --- Global Variable Access (MANDATORY) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;


import { AVAILABLE_VOICES, getVoiceById } from './voices';

// --- Voice Configuration Mapping ---

// Maps gender and age range to a suitable TTS voice (Fallback)
const voiceMap = {
    'female': {
        'young adult': 'Leda',
        'middle-aged': 'Aoede',
        'old': 'Despina',
        'default': 'Aoede'
    },
    'male': {
        'young adult': 'Fenrir',
        'middle-aged': 'Charon',
        'old': 'Gacrux',
        'default': 'Charon'
    },
    'non-binary': {
        'default': 'Puck'
    },
    'default': 'Aoede'
};

const selectVoice = (gender, ageRange) => {
    const g = gender?.toLowerCase() || 'default';
    const a = ageRange?.toLowerCase() || 'default';

    // Simplified fallback: Direct lookup only.
    // The LLM is expected to handle the primary selection.
    if (voiceMap[g] && voiceMap[g][a]) {
        return voiceMap[g][a];
    }
    return voiceMap[g]?.default || voiceMap.default;
};


// --- TTS Utility Functions ---

/**
 * Converts a base64 string to an ArrayBuffer.
 * @param {string} base64 - The base64 audio data string.
 * @returns {ArrayBuffer}
 */
const base64ToArrayBuffer = (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

/**
 * Converts 16-bit PCM audio data into a standard WAV Blob.
 * @param {Int16Array} pcm16 - The signed 16-bit PCM data.
 * @param {number} sampleRate - The audio sample rate.
 * @returns {Blob} The audio data as a WAV Blob.
 */
const pcmToWav = (pcm16, sampleRate) => {
    const numChannels = 1;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcm16.length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let offset = 0;

    const writeString = (view, currentOffset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(currentOffset + i, string.charCodeAt(i));
        }
    };

    // RIFF chunk descriptor
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;

    // fmt sub-chunk
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitDepth, true); offset += 2;

    // data sub-chunk
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, dataSize, true); offset += 4;

    // Write PCM data
    for (let i = 0; i < pcm16.length; i++) {
        view.setInt16(offset, pcm16[i], true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
};

// --- Helper Functions for API Calls ---

/**
 * Handles exponential backoff for fetch requests.
 */
const fetchWithBackoff = async (url, options, retries = 5) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                let errorBody;
                try {
                    errorBody = await response.text();
                } catch (e) {
                    errorBody = 'Could not read response body';
                }
                const error = new Error(`HTTP error! status: ${response.status}. Body: ${errorBody}`);
                error.status = response.status;
                throw error;
            }
            return response;
        } catch (error) {
            // Don't retry on 4xx errors (except 429)
            if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
                throw error;
            }

            if (i === retries - 1) throw error;
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

// --- Shared Voice Selection Guidelines ---

const VOICE_SELECTION_GUIDELINES = `Voice Selection Guidelines:
Match the voice to the character by considering:

1. GENDER: Choose a voice that matches the character's gender

2. AGE: Match voice maturity to character age
   - Young/Child → Young, Youthful voices
   - Young Adult → Adult voices with energetic qualities
   - Adult/Middle-aged → Adult, Mature voices
   - Old/Elderly → Mature, Wise, Deep voices

3. PERSONALITY & DEMEANOR: Match voice qualities to character traits
   - Friendly/Warm/Kind → Friendly, Warm, Engaging, Approachable
   - Authoritative/Leader/Noble → Authoritative, Confident, Professional, Powerful
   - Wise/Scholarly/Calm → Thoughtful, Wise, Calm, Intelligent
   - Energetic/Enthusiastic/Cheerful → Energetic, Bright, Enthusiastic, Upbeat
   - Mysterious/Cool/Edgy → Deep, Cool, Distinctive, Gravitas
   - Professional/Formal → Professional, Articulate, Composed
   - Casual/Relaxed → Casual, Conversational, Relatable
   - Gruff/Tough/Serious → Deep, Resonant, Serious, Powerful

Examples:
- Old male wizard (wise, authoritative) → Autonoe or Orus
- Young energetic female bard → Pulcherrima or Kore
- Gruff male warrior → Sadachbia or Zubenelgenubi
- Friendly female shopkeeper → Despina or Aoede
- Mysterious male rogue → Sadachbia or Charon
- Noble female leader → Leda or Algenib
- Enthusiastic young male adventurer → Enceladus or Alnilam`;




/**
 * Helper to select a voice from a list of candidates, optionally excluding one.
 * @param {string[]} candidates - List of voice names to choose from.
 * @param {string} voiceToExclude - (Optional) Voice name to exclude.
 * @returns {object|null} The selected voice object or null if none found.
 */
const selectVoiceFromCandidates = (candidates, voiceToExclude = '') => {
    if (!candidates || candidates.length === 0) return null;

    console.log("Voice Candidates:", candidates);

    // Filter out excluded voice
    // We compare just the name part (first word)
    const validCandidates = candidates.filter(c => {
        const candidateName = c.trim().split(' ')[0];
        return candidateName !== voiceToExclude;
    });

    console.log(`Valid Candidates (excluding '${voiceToExclude}'):`, validCandidates);

    let selectedVoiceName;
    if (validCandidates.length > 0) {
        // Randomly select from valid candidates
        selectedVoiceName = validCandidates[Math.floor(Math.random() * validCandidates.length)];
    } else {
        // If all candidates were excluded (unlikely but possible), pick a random one from available that isn't the excluded one
        console.warn("All candidates matched excluded voice. Picking random fallback.");
        const otherVoices = AVAILABLE_VOICES.filter(v => !v.startsWith(voiceToExclude + ' '));
        const randomVoice = otherVoices[Math.floor(Math.random() * otherVoices.length)];
        // randomVoice is the full string, extract name
        selectedVoiceName = randomVoice.split(' ')[0];
    }

    // Clean up the name
    selectedVoiceName = selectedVoiceName.trim().replace(/['"]/g, '');

    // Find the full voice string from AVAILABLE_VOICES
    const fullVoice = AVAILABLE_VOICES.find(v => v.startsWith(selectedVoiceName + ' '));

    if (!fullVoice) {
        // Try to find by exact match if startsWith failed (e.g. if LLM returned full string)
        const exactMatch = AVAILABLE_VOICES.find(v => v === selectedVoiceName);
        if (exactMatch) return exactMatch;

        // If still not found, check if the candidate is just the name and try to find it
        const nameMatch = AVAILABLE_VOICES.find(v => v.split(' ')[0] === selectedVoiceName);
        if (nameMatch) return nameMatch;

        // If still not found, return null (caller should handle error)
        return null;
    }

    return fullVoice;
};

/**
 * Generates structured NPC data (Personality, Wants, Secrets, Gender, Age) from a text description.
 */
const generateStructuredNPC = async (description) => {
    if (!AVAILABLE_VOICES || AVAILABLE_VOICES.length === 0) {
        throw new Error("Configuration Error: AVAILABLE_VOICES list is missing or empty.");
    }

    const userQuery = `Convert the following raw description into a structured NPC profile suitable for a Dungeons and Dragons style setting. Focus only on the content and adhere strictly to the provided JSON schema. If the user hasn't provided a name, make up a suitable name for the NPC. Raw Description: "${description}"`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: {
            parts: [{
                text: `You are a professional RPG game assistant. Your task is to analyze the provided text and output a complete JSON object based on the schema.

            CRITICAL: You must select the most appropriate voice for this character from the following list of available voices.

            Available Voices:
            ${AVAILABLE_VOICES.join("\n")}

            ${VOICE_SELECTION_GUIDELINES}
            
            IMPORTANT: Select your TOP 3 best matching voices.
            Return them as a list in the 'voiceCandidates' field.` }]
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

        // Remove the candidates field from the final object to match expected structure
        delete parsedData.voiceCandidates;

        return parsedData;
    } catch (e) {
        console.error("Error generating structured NPC:", e);
        throw new Error(`Failed to generate structured profile: ${e.message}`);
    }
};

/**
 * Generates an image for the NPC using OpenAI's DALL-E 3.
 * Uses a two-step process: first asks an LLM to create the perfect DALL-E prompt,
 * then generates the image with that optimized prompt.
 */
const generateNPCImage = async (name, raceClass, visualDescription, gender, ageRange, personality, npcId, isInitial = false) => {
    // Step 1: Ask the LLM to act as a DALL-E artist and create the perfect prompt
    console.log(`\n%c[NPC Generator] Step 1: Asking LLM to create optimized DALL-E prompt...`, 'color: magenta; font-weight: bold;');

    const promptCreationQuery = `You are now working as a professional DALL-E artist, who knows all the little tricks to make the perfect image. Your task is to create the PERFECT prompt that will encapsulate this NPC the best for DALL-E image generation.

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

    const promptPayload = {
        contents: [{ parts: [{ text: promptCreationQuery }] }],
        systemInstruction: {
            parts: [{
                text: `You are an expert DALL-E prompt engineer specializing in fantasy character art. Your task is to create the most effective prompt possible to generate a stunning character portrait. Be specific, vivid, and focus on visual details that will translate well to image generation.`
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
            optimizedPrompt = `Create a portrait of ${name}, a ${gender} ${ageRange} ${raceClass}. ${description || ''} The character should be centered and fill the frame. Style: Dungeons and Dragons fantasy art, dramatic lighting, professional illustration.`;
        }
    } catch (e) {
        console.warn("Error generating optimized prompt, using fallback:", e);
        const description = (visualDescription && visualDescription.trim()) ? visualDescription : personality;
        optimizedPrompt = `Create a portrait of ${name}, a ${gender} ${ageRange} ${raceClass}. ${description || ''} The character should be centered and fill the frame. Style: Dungeons and Dragons fantasy art, dramatic lighting, professional illustration.`;
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
 */
const getNPCResponse = async (structuredData, chatHistory) => {
    const systemPrompt = `You are roleplaying as the NPC named ${structuredData.name}.
        - **Race/Class:** ${structuredData.raceClass}
        - **Gender/Age:** ${structuredData.gender} ${structuredData.ageRange}
        - **Personality:** ${structuredData.personality}
        - **Wants:** ${structuredData.wants}
        - **Secret:** ${structuredData.secrets}
        
        Stay in character and base your responses on the provided information. Do not break character. Do not reveal your secrets unless explicitly forced or tricked.
        
        ***CRITICAL: Keep responses SHORT and natural.*** Respond with 1-3 sentences maximum unless the character is explicitly described as verbose or chatty. Speak like a real person in conversation, not like you're writing a story.
        
        ***IMPORTANT FORMATTING RULE:*** Enclose any actions, emotional descriptions, or narrations (i.e., anything that is NOT spoken dialogue) within square brackets, e.g., "[The ${structuredData.raceClass} clears their throat.]". Only the spoken dialogue should be outside the brackets.`;

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
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Model returned no text response.");
        return text;
    } catch (e) {
        console.error("Error getting NPC response:", e);
        throw new Error("Failed to get response. Check console for details.");
    }
};

/**
 * Regenerates a specific field of the NPC profile based on the rest of the data.
 */
const regenerateNPCField = async (structuredData, field) => {
    const fieldDescriptions = {
        personality: "A concise, detailed summary of the NPC's disposition and mannerisms.",
        wants: "The NPC's primary goal or desire.",
        secrets: "A key secret the NPC hides, critical for plot development.",
        pitfalls: "One thing that may make the NPC lose patience, interest, or demand a clarification in the conversation.",
        visual: "A detailed visual description of the NPC's physical appearance, clothing, and equipment."
    };

    const targetDescription = fieldDescriptions[field] || "content for this field";

    const systemPrompt = `You are an expert RPG character creator. Your task is to regenerate ONLY the '${field}' field for the following character, keeping it consistent with their other traits but providing a fresh, creative variation.

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
const expandNPCField = async (structuredData, field) => {
    const fieldDescriptions = {
        wants: "The NPC's primary goal or desire.",
        secrets: "A key secret the NPC hides, critical for plot development.",
        pitfalls: "One thing that may make the NPC lose patience, interest, or demand a clarification in the conversation."
    };

    const targetDescription = fieldDescriptions[field] || "content for this field";

    const systemPrompt = `You are an expert RPG character creator. Your task is to EXPAND the '${field}' field for the following character.
    
    Character Context:
    - Name: ${structuredData.name}
    - Race/Class: ${structuredData.raceClass}
    - Gender/Age: ${structuredData.gender} ${structuredData.ageRange}
    ${field !== 'personality' ? `- Personality: ${structuredData.personality}` : ''}
    
    Current '${field}': "${structuredData[field]}"
    
    Task: Expand and/or add one more *short* sentence to the '${field}' entry. Otherwise, only minimal modification are allowed to the existing text.
    Description of this field: ${targetDescription}
    
    Respond with ONLY the resulted text. Do not include labels, quotes, or explanations.`;

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

/**
 * Regenerates the voice selection for an NPC.
 * Asks the LLM to select from the top 3 matching voices, excluding the current voice.
 */
const regenerateVoice = async (structuredData) => {
    if (!AVAILABLE_VOICES || AVAILABLE_VOICES.length === 0) {
        throw new Error("Configuration Error: AVAILABLE_VOICES list is missing or empty.");
    }

    const currentVoice = structuredData.voiceId?.split(' ')[0] || '';

    const systemPrompt = `You are a professional voice casting director for RPG characters. Your task is to select a NEW voice for this character that matches their profile.

Character Information:
- Name: ${structuredData.name}
- Race/Class: ${structuredData.raceClass}
- Gender: ${structuredData.gender}
- Age Range: ${structuredData.ageRange}
- Personality: ${structuredData.personality}

Available Voices:
${AVAILABLE_VOICES.join("\n")}

${VOICE_SELECTION_GUIDELINES}

Voice Selection Process:
1. Analyze the character's gender, age, and personality traits
2. Identify the TOP 3 voices that best match this character

CRITICAL: 
- Return your TOP 3 choices as a list of strings.
- Just provide the best matches.`;

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

    const apiUrl = `/.netlify/functions/gemini`;

    try {
        const response = await fetchWithBackoff(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("Model returned no voice selection.");

        const parsedData = JSON.parse(jsonText);
        const candidates = parsedData.candidates || [];

        // Use shared helper to select voice, excluding the current one
        const selectedVoice = selectVoiceFromCandidates(candidates, currentVoice);

        if (!selectedVoice) {
            throw new Error(`Failed to select a valid voice from candidates.`);
        }

        return selectedVoice;
    } catch (e) {
        console.error("Error regenerating voice:", e);
        throw new Error("Failed to regenerate voice.");
    }
};




/**
 * Gemini TTS implementation
 */
const geminiTTS = async (text, voiceName) => {
    const payload = {
        contents: [{
            parts: [{ text }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName }
                }
            }
        },
        model: "gemini-2.5-flash-preview-tts"
    };

    const apiUrl = `/.netlify/functions/gemini`;

    const response = await fetchWithBackoff(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await response.json();

    // Check for API errors
    if (result.error) {
        const errorMsg = result.error.message || 'Unknown API error';

        // Log full API error response for debugging (may include quota reset info)
        console.error('Gemini TTS API Error Response:', result.error);
        console.error('Full API result:', result);

        // Log Gemini TTS API errors to Sentry
        Sentry.captureException(new Error(`Gemini TTS API Error: ${errorMsg}`), {
            tags: {
                feature: 'gemini_tts',
                api_error: true
            },
            extra: {
                errorCode: result.error.code,
                errorMessage: errorMsg,
                voiceName: voiceName,
                textLength: text.length,
                fullError: result.error
            }
        });

        if (result.error.code === 429) {
            throw new Error('TTS quota exceeded. Please try again later.');
        }
        throw new Error('TTS service temporarily unavailable.');
    }

    const part = result?.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType;

    if (audioData && mimeType && mimeType.startsWith("audio/")) {
        // Get the sample rate from the mimeType (e.g., audio/L16;codec=pcm;rate=24000)
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

        // Convert PCM to WAV
        const pcmData = base64ToArrayBuffer(audioData);
        const pcm16 = new Int16Array(pcmData);
        const wavBlob = pcmToWav(pcm16, sampleRate);

        return URL.createObjectURL(wavBlob);
    } else {
        console.error('Missing audio data or invalid mimeType:', {
            hasAudioData: !!audioData,
            mimeType
        });
        throw new Error('Unable to generate audio. Please try again.');
    }
};

/**
 * Converts text to a playable audio URL, selecting voice based on structured data.
 * Routes to either Gemini or ElevenLabs based on the voice provider.
 * @param {string} text - The raw text from the NPC, which includes [descriptors].
 * @param {object} structuredData - NPC profile data for voice selection.
 * @returns {Promise<string>} The Blob URL for the audio.
 */
const textToSpeech = async (text, structuredData) => {

    // 1. Strip all content inside square brackets, including brackets and surrounding spaces/newlines.
    // This is the CRITICAL fix for preventing the voice from reading stage directions.
    const dialogueOnly = text.replace(/ *\[[\s\S]*?\] */g, '').trim();

    if (!dialogueOnly) {
        throw new Error("No spoken dialogue found in the message.");
    }

    // 2. Select the voice dynamically
    // Use the LLM-selected voice if available, otherwise fallback to the map
    let selectedVoice = structuredData.voiceId;

    // Try direct lookup first (matches "Charon (Male, Google HD)")
    let voiceData = getVoiceById(selectedVoice);

    // If not found, try cleaning up (e.g. "Fenrir (Male...)" -> "Fenrir") for legacy/LLM formats
    if (!voiceData && selectedVoice) {
        const shortName = selectedVoice.split(' ')[0].trim();
        voiceData = getVoiceById(shortName);
    }

    // Validate and fallback if needed
    if (!voiceData) {
        // Fallback to voice map
        const fallbackName = selectVoice(structuredData.gender, structuredData.ageRange);
        voiceData = getVoiceById(fallbackName);

        if (!voiceData) {
            // Ultimate fallback to first Gemini voice
            voiceData = getVoiceById('Aoede');
        }
    }

    /**
     * Helper to process the JSON response from TTS functions, checking for errors
     * and converting the base64 audio to a Blob URL.
     */
    const processTTSResponse = async (response) => {
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error + (data.details ? `: ${data.details}` : ''));
        }

        // Base64 to Blob (MP3)
        const byteCharacters = atob(data.audio);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/mpeg' });
        return URL.createObjectURL(blob);
    };

    try {
        // Route to appropriate TTS provider
        console.log(`%c[TTS] Generating audio using provider: ${voiceData.provider} (Voice: ${voiceData.name})`, 'color: #0ea5e9; font-weight: bold;');

        if (voiceData.provider === 'gemini') {
            return await geminiTTS(dialogueOnly, voiceData.id);
        } else if (voiceData.provider === 'elevenlabs') {
            // ElevenLabs TTS
            const response = await fetchWithBackoff('/.netlify/functions/elevenlabs-tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: dialogueOnly,
                    voiceId: voiceData.id
                })
            });
            return await processTTSResponse(response);

        } else if (voiceData.provider === 'google') {
            // Google Cloud TTS
            const response = await fetchWithBackoff('/.netlify/functions/google-tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: dialogueOnly,
                    voiceId: voiceData.id
                })
            });
            return await processTTSResponse(response);

        } else {
            throw new Error(`Unknown voice provider: ${voiceData.provider}`);
        }
    } catch (e) {
        console.error("TTS Generation Error:", e.message);

        // Only log critical errors to Sentry (quota, API failures)
        if (e.message.includes('quota') || e.message.includes('API error') || e.message.includes('503') || e.message.includes('429')) {
            Sentry.captureException(e, {
                tags: {
                    feature: 'tts_critical',
                    provider: voiceData?.provider || 'unknown'
                },
                extra: {
                    voiceId: voiceData?.id,
                    textLength: dialogueOnly.length,
                    errorMessage: e.message
                }
            });
        }

        throw new Error(`Failed to generate voice: ${e.message}`);
    }
};

// --- Firebase Setup and Custom Hooks ---

// Path constants
const NPC_COLLECTION_NAME = 'npcs';
const npcCollectionPath = (appId, userId) => `users/${userId}/${NPC_COLLECTION_NAME}`;



function useNPCs(db, userId, isAuthReady) {
    const [npcs, setNpcs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthReady || !userId) {
            setLoading(true);
            return;
        }

        if (!db) {
            // Demo mode or no DB connection
            setLoading(false);
            return;
        }

        const path = npcCollectionPath(appId, userId);
        const q = query(collection(db, path), orderBy('createdAt', 'desc'));

        setLoading(false);
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const npcList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setNpcs(npcList);
        }, (error) => {
            console.error("Error listening to NPCs:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady]);

    return { npcs, loading };
}

// --- Editable Field Component ---

const EditableField = ({ label, value, displayValue, onSave, onRegenerate, onExpand, type = 'text', options = [], className = '', hideLabel = false, textClassName = '' }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [tempValue, setTempValue] = useState(value);
    const [isSaving, setIsSaving] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const selectRef = useRef(null);

    useEffect(() => {
        setTempValue(value);
    }, [value]);

    // Auto-open select dropdown when entering edit mode
    useEffect(() => {
        if (isEditing && type === 'select' && selectRef.current) {
            // Small delay to ensure the select is rendered and focused
            setTimeout(() => {
                if (selectRef.current) {
                    selectRef.current.focus();
                    // Use showPicker() if available (modern browsers), otherwise try click
                    if (typeof selectRef.current.showPicker === 'function') {
                        try {
                            selectRef.current.showPicker();
                        } catch (e) {
                            // showPicker can throw in some contexts, fallback to click
                            selectRef.current.click();
                        }
                    } else {
                        // Fallback for older browsers
                        const event = new MouseEvent('mousedown', { bubbles: true });
                        selectRef.current.dispatchEvent(event);
                    }
                }
            }, 50);
        }
    }, [isEditing, type]);

    const handleSave = async () => {
        if (tempValue === value) {
            setIsEditing(false);
            return;
        }
        setIsSaving(true);
        try {
            await onSave(tempValue);
            setIsEditing(false);
        } catch (error) {
            console.error("Failed to save:", error);
            // Optionally show error state
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setTempValue(value);
        setIsEditing(false);
    };

    const handleRegenerate = async (e) => {
        e.stopPropagation(); // Prevent toggling edit mode if clicked outside
        if (!onRegenerate) return;

        setIsRegenerating(true);
        try {
            const newValue = await onRegenerate();
            if (newValue) {
                setTempValue(newValue);

                // For select fields, auto-save the new value
                // For textarea/text fields, enter edit mode to review
                if (type === 'select') {
                    // Auto-save for select fields
                    try {
                        await onSave(newValue);
                        // Don't enter edit mode, just update the value
                    } catch (error) {
                        console.error("Failed to save regenerated value:", error);
                        // On error, enter edit mode to let user try again
                        setIsEditing(true);
                    }
                } else {
                    // For other field types, enter edit mode to review
                    setIsEditing(true);
                }
            }
        } catch (error) {
            console.error("Regeneration failed:", error);
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleExpand = async (e) => {
        e.stopPropagation();
        if (!onExpand) return;

        setIsExpanding(true);
        try {
            const newValue = await onExpand();
            if (newValue) {
                setTempValue(newValue);
                setIsEditing(true);
            }
        } catch (error) {
            console.error("Expansion failed:", error);
        } finally {
            setIsExpanding(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && (type === 'text' || type === 'select')) {
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    if (isEditing) {
        return (
            <div className={`mb-2 p-2 bg-white rounded-lg border border-indigo-300 shadow-sm ${className}`}>
                <style>{magicalStyles}</style>
                <div className="flex items-center justify-between mb-1">
                    {!hideLabel && <label className="block text-xs font-bold text-indigo-700">{label}</label>}
                    <div className="flex items-center space-x-1">
                        {onExpand && (
                            <button
                                onClick={handleExpand}
                                disabled={isExpanding || isRegenerating || isSaving}
                                className={`p-0.5 rounded transition-colors ${isExpanding ? 'cursor-default' : 'text-blue-600 hover:text-blue-800'}`}
                                title="Expand this field"
                            >
                                {isExpanding ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Maximize2 className="w-3 h-3" />
                                )}
                            </button>
                        )}
                        {onRegenerate && (
                            <div className="relative">
                                <button
                                    onClick={handleRegenerate}
                                    disabled={isRegenerating || isSaving}
                                    className={`p-0.5 rounded transition-colors ${isRegenerating ? 'cursor-default' : 'text-purple-600 hover:text-purple-800'}`}
                                    title="Regenerate this field"
                                >
                                    {isRegenerating ? (
                                        <div className="relative">
                                            <Wand2 className="w-4 h-4 animate-magic" />
                                            <Sparkles className="w-2 h-2 text-yellow-400 absolute -top-1 -right-1 animate-sparkle-1" />
                                            <Sparkles className="w-2 h-2 text-cyan-400 absolute -bottom-1 -left-1 animate-sparkle-2" />
                                        </div>
                                    ) : (
                                        <Wand2 className="w-3 h-3" />
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-start space-x-2 max-w-full overflow-hidden">
                    {type === 'textarea' ? (
                        <textarea
                            value={tempValue}
                            onChange={(e) => setTempValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    handleCancel();
                                }
                            }}
                            className="flex-1 p-2 text-sm border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500"
                            rows={8}
                            autoFocus
                        />
                    ) : type === 'select' ? (
                        <select
                            ref={selectRef}
                            value={tempValue}
                            onChange={async (e) => {
                                const newValue = e.target.value;
                                setTempValue(newValue);
                                // Auto-save for select fields - no confirmation needed
                                if (newValue !== value) {
                                    setIsSaving(true);
                                    try {
                                        await onSave(newValue);
                                        setIsEditing(false);
                                    } catch (error) {
                                        console.error("Failed to save:", error);
                                    } finally {
                                        setIsSaving(false);
                                    }
                                } else {
                                    // Same value selected - just close edit mode
                                    setIsEditing(false);
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    handleCancel();
                                }
                            }}
                            onBlur={() => {
                                // If user clicks away without changing, just close
                                if (tempValue === value) {
                                    setIsEditing(false);
                                }
                            }}
                            className="flex-1 p-2 text-sm border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 max-w-full overflow-hidden text-ellipsis"
                            autoFocus
                            disabled={isSaving}
                        >
                            {options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            type="text"
                            value={tempValue}
                            onChange={(e) => setTempValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleSave();
                                } else if (e.key === 'Escape') {
                                    handleCancel();
                                }
                            }}
                            onBlur={handleSave}
                            className={`flex-1 p-2 border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 break-words ${textClassName || 'text-sm'}`}
                            autoFocus
                            disabled={isSaving}
                        />
                    )}

                    {/* Vertical Pill Action Buttons - Only show for textarea */}
                    {type === 'textarea' && (
                        <div className="flex flex-col items-center bg-white shadow-sm border border-gray-200 rounded-full overflow-hidden ml-1">
                            <button
                                onClick={handleSave}
                                disabled={isSaving || isRegenerating || isExpanding}
                                className="p-2 text-green-600 hover:bg-green-50 transition-colors focus:outline-none"
                                title="Save"
                            >
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <div className="h-px w-4 bg-gray-200"></div>
                            <button
                                onClick={handleCancel}
                                disabled={isSaving || isRegenerating || isExpanding}
                                className="p-2 text-gray-500 hover:bg-gray-50 transition-colors focus:outline-none"
                                title="Cancel"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className={`group relative p-2 rounded-lg hover:bg-indigo-100 cursor-pointer transition-colors ${className}`}
            title="Click to edit"
        >
            <style>{magicalStyles}</style>
            <div className="flex items-center justify-between mb-0.5">
                {!hideLabel && <p className="text-xs font-bold text-indigo-700">{label}</p>}
                <div className="flex items-center space-x-1">
                    {onExpand && (
                        <div className="relative">
                            <button
                                onClick={handleExpand}
                                disabled={isExpanding}
                                className={`p-1 rounded transition-all ${isExpanding ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 text-blue-600 hover:text-blue-800'}`}
                                title="Expand"
                            >
                                {isExpanding ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Maximize2 className="w-3 h-3" />
                                )}
                            </button>
                        </div>
                    )}
                    {onRegenerate && (
                        <div className="relative">
                            <button
                                onClick={handleRegenerate}
                                disabled={isRegenerating}
                                className={`p-1 rounded transition-all ${isRegenerating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 text-purple-600 hover:text-purple-800'}`}
                                title="Regenerate"
                            >
                                {isRegenerating ? (
                                    <div className="relative">
                                        <Wand2 className="w-4 h-4 animate-magic" />
                                        <Sparkles className="w-2 h-2 text-yellow-400 absolute -top-1 -right-1 animate-sparkle-1" />
                                        <Sparkles className="w-2 h-2 text-cyan-400 absolute -bottom-1 -left-1 animate-sparkle-2" />
                                    </div>
                                ) : (
                                    <Wand2 className="w-3 h-3" />
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <p className={`whitespace-pre-wrap break-words ${textClassName || 'text-sm text-gray-800'}`}>{displayValue || value || <span className="text-gray-400 italic">Empty</span>}</p>
            {!onRegenerate && <Edit2 className="absolute top-2 right-2 w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />}
        </div>
    );
};

// --- NPC Management Components ---

const Button = ({ children, onClick, disabled = false, className = '', icon: Icon, loading = false, variant = 'primary' }) => {
    let variantStyles = '';

    if (variant === 'primary') {
        variantStyles = disabled
            ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500';
    } else if (variant === 'custom') {
        variantStyles = disabled ? 'opacity-50 cursor-not-allowed' : '';
    }

    return (
        <button
            onClick={onClick}
            disabled={disabled || loading}
            className={`flex items-center justify-center px-4 py-2 font-semibold transition-all duration-200 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 
                ${variantStyles}
                ${className}`}
        >
            {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : Icon && <Icon className="w-5 h-5 mr-2" />}
            {children}
        </button>
    );
};

const LoadingIndicator = () => (
    <div className="flex items-center justify-center p-8 text-indigo-500">
        <Loader2 className="w-8 h-8 mr-3 animate-spin" />
        <span className="text-lg font-medium">Loading Data...</span>
    </div>
);

const NpcCreation = ({ db, userId, onNpcCreated }) => {
    const [rawDescription, setRawDescription] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [status, setStatus] = useState('');

    const handleGenerateNPC = async () => {
        if (!rawDescription.trim()) {
            setStatus("Please enter a description first.");
            return;
        }
        setIsGenerating(true);
        setStatus('Generating NPC profile...');

        try {
            // Step 1: Generate structured data
            const structuredData = await generateStructuredNPC(rawDescription);
            const npcName = structuredData.name || 'Unnamed NPC';

            // Step 2: Save to database (without image initially)
            setStatus('Saving NPC...');
            const newNpcRef = doc(collection(db, npcCollectionPath(appId, userId)));

            const npcData = {
                id: newNpcRef.id,
                name: npcName,
                description: rawDescription,
                structuredData: structuredData,
                imageUrl: null,
                cloudinaryImageId: null,
                chats: [],
                createdAt: new Date().toISOString(),
                ownerId: userId,
            };

            await setDoc(newNpcRef, npcData);
            setStatus(`NPC "${npcName}" created successfully!`);

            // Log NPC creation for analytics
            const userEmail = auth.currentUser?.email || 'unknown';
            await logUsage(userId, userEmail, 'npc_created', {
                npcId: newNpcRef.id,
                npcName: npcName
            });

            // Step 3: Skip initial image generation (as per new safeguard)
            // We leave imageUrl as null so the user sees the "Image not saved" placeholder.

            // Clear form and notify parent with the new NPC ID
            setRawDescription('');
            onNpcCreated(newNpcRef.id);
        } catch (e) {
            setStatus(`Error: ${e.message}`);
            console.error('Error creating NPC:', e);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="p-4 space-y-6 bg-white rounded-lg shadow-xl md:p-8">
            <h2 className="flex items-center text-2xl font-bold text-indigo-700">
                <Brain className="w-6 h-6 mr-2" />
                Create New NPC Profile
            </h2>
            <div className="p-4 space-y-4 rounded-lg bg-gray-50">
                <label className="block text-sm font-medium text-gray-700">
                    Raw NPC Description (Copy-Paste your notes here):
                </label>
                <textarea
                    value={rawDescription}
                    onChange={(e) => setRawDescription(e.target.value)}
                    onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault();
                            handleGenerateNPC();
                        }
                    }}
                    rows="6"
                    placeholder="E.g., An elven librarian named Elara. She is frail, old and wears thick glasses. Constantly dusts her shelves. Secretly a member of the resistance."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                />
                <Button
                    onClick={handleGenerateNPC}
                    loading={isGenerating}
                    icon={Zap}
                    disabled={!rawDescription.trim()}
                    className="w-full"
                >
                    Generate NPC
                </Button>
            </div>



            {status && (
                <div className={`p-3 text-sm rounded-lg ${status.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    Status: {status}
                </div>
            )}
        </div>
    );
};

// --- Chat Interface Components ---

const ChatBubble = ({ message, npcName, isSpeaking, onSpeakClick }) => {
    const isNpc = message.role === 'npc';
    const isScene = message.role === 'scene';

    // Function to extract only the dialogue for display/TTS purposes
    const getDialogueText = (text) => text.replace(/ *\[[\s\S]*?\] */g, '').trim();

    if (isScene) {
        return (
            <div className="flex w-full justify-center my-4">
                <div className={`w-[80%] max-w-lg p-4 rounded-lg shadow-sm text-left border-2 ${message.isHidden
                    ? 'bg-red-50 border-red-500' // Hidden scene style
                    : 'bg-indigo-50 border-indigo-500' // Regular scene style
                    }`}>
                    <p className={`text-xs font-bold uppercase tracking-wider mb-1 opacity-70 ${message.isHidden ? 'text-red-700' : 'text-indigo-700'}`}>
                        {message.isHidden ? 'Secret Scene' : 'Scene'}
                    </p>
                    <p className="font-mono text-sm italic text-gray-900">{message.text}</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex w-full ${isNpc ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-xl p-4 rounded-xl shadow-md ${isNpc
                ? 'bg-gray-100 text-gray-800 rounded-tl-none border border-gray-200'
                : 'bg-indigo-600 text-white rounded-br-none'
                }`}>
                <p className="text-xs font-semibold mb-1 opacity-70">
                    {isNpc ? npcName : 'GM/Player'}
                </p>
                <p className="whitespace-pre-wrap">{message.text}</p>

                {isNpc && getDialogueText(message.text) && (
                    <div className="flex items-center justify-end mt-2">
                        <button
                            onClick={() => onSpeakClick(message.text)}
                            // isSpeaking is set to true when audio is playing or loading, so it acts as the stop button.
                            className={`p-1 rounded-full transition-colors duration-200 ${isSpeaking
                                ? 'bg-red-200 text-red-600 hover:bg-red-300'
                                : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                                }`}
                            title={isSpeaking ? "Click to stop speaking" : "Click to hear dialogue"}
                        >
                            {isSpeaking ? <X className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                        {isSpeaking && <span className="ml-2 text-xs text-red-600">Stop</span>}
                    </div>
                )}
            </div>
        </div>
    );
};

const ImageModal = ({ isOpen, onClose, imageUrl, altText }) => {
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80" onClick={onClose}>
            <div className="relative max-w-7xl max-h-screen p-2" onClick={e => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-white bg-black bg-opacity-50 rounded-full hover:bg-opacity-75"
                >
                    <X className="w-6 h-6" />
                </button>
                <img
                    src={imageUrl}
                    alt={altText}
                    className="object-contain max-w-full max-h-[90vh] rounded-lg shadow-2xl"
                />
            </div>
        </div>
    );
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
            <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-gray-900">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                <p className="mb-6 text-gray-600">{message}</p>
                <div className="flex justify-end space-x-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

const NpcChat = ({ db, userId, userEmail, npc, onBack, isMobile = false, mobileView = 'details', onShowConversation, onShowDetails }) => {
    const [message, setMessage] = useState('');
    const [chatHistory, setChatHistory] = useState(npc.chats || []);
    const [isThinking, setIsThinking] = useState(false);
    const [playingMessageIndex, setPlayingMessageIndex] = useState(null); // Track which message is playing
    const [isAutoPlayEnabled, setIsAutoPlayEnabled] = useState(false); // Auto-play toggle
    const [audioCache, setAudioCache] = useState({}); // Cache for audio Blob URLs
    const [audioPlayer, setAudioPlayer] = useState(null);
    const [showNpcDetails, setShowNpcDetails] = useState(true);
    const [currentImageUrl, setCurrentImageUrl] = useState(null);
    const [isImageGenerating, setIsImageGenerating] = useState(false);
    const [isImageModalOpen, setIsImageModalOpen] = useState(false);

    // Scene State
    const [sceneDescription, setSceneDescription] = useState('');
    const [showHiddenScenes, setShowHiddenScenes] = useState(true);

    // Ref for message input to maintain focus
    const messageInputRef = useRef(null);

    // Load initial chat history and audio player on component mount
    useEffect(() => {
        setChatHistory(npc.chats || []);
        // Load the saved Cloudinary image URL if it exists
        setCurrentImageUrl(npc.imageUrl || null);

        if (!audioPlayer) {
            const player = new Audio();
            setAudioPlayer(player);

            // Cleanup function for when component unmounts
            return () => {
                player.pause();
                player.currentTime = 0;
                // Clean up all cached audio Blob URLs
                Object.values(audioCache).forEach(url => {
                    if (url.startsWith('blob:')) {
                        URL.revokeObjectURL(url);
                    }
                });
                if (player.src && player.src.startsWith('blob:')) {
                    URL.revokeObjectURL(player.src);
                }
            };
        }
    }, [npc.id]);

    const scrollToBottom = (elementId) => {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    };

    useEffect(() => {
        // Scroll to bottom whenever chat history updates
        scrollToBottom('chat-container');
    }, [chatHistory, isThinking]);

    /**
     * FIX 1: The stopAudio function now reliably resets the playing state.
     */
    const stopAudio = useCallback(() => {
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            setPlayingMessageIndex(null);
        }
    }, [audioPlayer]);

    useEffect(() => {
        return () => {
            stopAudio();
            // The unmount cleanup is handled in the effect where audioPlayer is created.
        };
    }, [stopAudio]);

    const handleSpeakClick = async (text, index) => {
        // If speaking THIS message, clicking the button should stop it immediately.
        if (playingMessageIndex === index) {
            stopAudio();
            return;
        }

        if (!audioPlayer) return;

        stopAudio(); // Ensure any existing audio stops
        setPlayingMessageIndex(index);
        audioPlayer.src = '';

        try {
            let audioUrl;

            // Check if we have this audio cached
            if (audioCache[text]) {
                audioUrl = audioCache[text];
            } else {
                // Generate TTS using the NPC's structured data for voice selection
                audioUrl = await textToSpeech(text, npc.structuredData);

                if (!audioUrl) {
                    throw new Error('TTS returned empty audio URL');
                }

                // Log TTS usage for analytics
                const voiceId = npc.structuredData.voiceId?.split(' ')[0]?.trim();
                const voiceData = getVoiceById(voiceId);
                const ttsType = voiceData?.provider === 'elevenlabs' ? 'elevenlabs_tts' : 'gemini_tts';

                await logUsage(userId, userEmail, ttsType, {
                    npcId: npc.id,
                    npcName: npc.name,
                    voiceId: voiceId
                });

                // Cache the audio URL for future use
                setAudioCache(prev => ({
                    ...prev,
                    [text]: audioUrl
                }));
            }

            // Clean up old blob URL if present
            if (audioPlayer.src.startsWith('blob:')) {
                URL.revokeObjectURL(audioPlayer.src);
            }

            audioPlayer.src = audioUrl;

            // Play is now explicitly triggered by the user's click on the icon.
            await audioPlayer.play();

            audioPlayer.onended = () => {
                setPlayingMessageIndex(null);
                // Don't revoke cached URLs - keep them for replay
            };
            audioPlayer.onerror = (e) => {
                console.error("Audio playback error:", audioPlayer.error?.message || e);
                setPlayingMessageIndex(null);
            };
        } catch (e) {
            console.error("TTS Error:", e.message);

            // Only log critical TTS errors to Sentry (quota, API failures)
            if (e.message.includes('quota') || e.message.includes('API') || e.message.includes('service')) {
                Sentry.captureException(e, {
                    tags: {
                        feature: 'tts_critical',
                        user_action: 'speak_button'
                    },
                    extra: {
                        npcId: npc?.id,
                        npcName: npc?.name,
                        messageIndex: index,
                        textLength: text?.length || 0,
                        errorMessage: e.message
                    }
                });
            }

            setPlayingMessageIndex(null);
        }
    };

    const handleSend = async () => {
        const text = message.trim();
        if (!text || isThinking) return;

        stopAudio();
        setIsThinking(true);
        setMessage('');

        const userMsg = { role: 'user', text: text, timestamp: new Date().toISOString() };

        // 1. Optimistically update the UI immediately with user message
        const newHistory = [...chatHistory, userMsg];
        setChatHistory(newHistory);
        scrollToBottom('chat-container');

        try {
            // 2. Get NPC response (text only)
            const npcResponseText = await getNPCResponse(npc.structuredData, newHistory);
            const npcMsg = { role: 'npc', text: npcResponseText, timestamp: new Date().toISOString() };
            const finalHistory = [...newHistory, npcMsg];

            // 3. Update Firestore with the full final history
            const npcRef = doc(db, npcCollectionPath(appId, userId), npc.id);
            await updateDoc(npcRef, {
                chats: finalHistory,
                updatedAt: new Date().toISOString()
            });

            setChatHistory(finalHistory);

            // Log chat message for analytics
            await logUsage(userId, userEmail, 'gemini_chat', {
                npcId: npc.id,
                npcName: npc.name,
                messageCount: finalHistory.length
            });

            // 4. Auto-play if enabled
            if (isAutoPlayEnabled) {
                // The new message is at the end of finalHistory
                handleSpeakClick(npcResponseText, finalHistory.length - 1);
            }

        } catch (e) {
            console.error("Chat Error:", e);
            // Revert optimistic update or show error
            setChatHistory(prev => prev.slice(0, prev.length - 1));
            // Restore the message so the user doesn't have to retype it
            setMessage(text);
            console.error("Failed to get NPC response or save chat. See console for details.");
        } finally {
            setIsThinking(false);
            // Refocus the message input after response is complete
            setTimeout(() => {
                messageInputRef.current?.focus();
            }, 0);
        }
    };

    const handleResetConversation = async () => {
        if (!confirm("Are you sure you want to clear the conversation history? This cannot be undone.")) return;

        try {
            const npcRef = doc(db, npcCollectionPath(appId, userId), npc.id);
            await updateDoc(npcRef, {
                chats: [],
                updatedAt: new Date().toISOString()
            });
            setChatHistory([]);
        } catch (e) {
            console.error("Error resetting conversation:", e);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleRegenerateImage = async () => {
        setIsImageGenerating(true);
        try {
            const data = npc.structuredData;

            // Step 1: Generate image with DALL-E 3 and upload to Cloudinary (via backend)
            const { secure_url, public_id } = await generateNPCImage(data.name, data.raceClass, data.visual, data.gender, data.ageRange, data.personality, npc.id);

            const cloudinaryUrl = secure_url;
            const cloudinaryImageId = public_id;

            // Log analytics
            await logUsage(userId, userEmail, 'dalle', {
                npcId: npc.id,
                model: 'dall-e-3'
            });

            // Step 3: Update the current display
            setCurrentImageUrl(cloudinaryUrl);

            // Step 4: Update the NPC in Firestore with the new Cloudinary URL
            if (db) {
                try {
                    const npcRef = doc(db, npcCollectionPath(appId, userId), npc.id);
                    await updateDoc(npcRef, {
                        imageUrl: cloudinaryUrl,
                        cloudinaryImageId: cloudinaryImageId
                    });
                    console.log(`[${new Date().toISOString()}] Updated NPC imageUrl in Firestore`);
                } catch (updateError) {
                    console.error('Failed to update NPC imageUrl in Firestore:', updateError);
                }
            }
        } catch (error) {
            console.error(`Error regenerating image: ${error.message}`);
        } finally {
            setIsImageGenerating(false);
        }
    };

    const handleUpdateField = async (field, value) => {
        // Optimistic update handled by Firestore listener, but we can also log it.
        console.log(`Updating ${field} to:`, value);

        if (!db) return;

        try {
            const npcRef = doc(db, npcCollectionPath(appId, userId), npc.id);

            // Handle 'name' field separately as it's at the top level
            if (field === 'name') {
                // Update both top-level name AND structuredData.name to keep them in sync
                const updatedStructuredData = {
                    ...npc.structuredData,
                    name: value
                };

                await updateDoc(npcRef, {
                    name: value,
                    structuredData: updatedStructuredData,
                    updatedAt: new Date().toISOString()
                });
            } else {
                // Create the updated structuredData object for other fields
                const updatedStructuredData = {
                    ...npc.structuredData,
                    [field]: value
                };

                await updateDoc(npcRef, {
                    structuredData: updatedStructuredData,
                    updatedAt: new Date().toISOString()
                });
            }
            console.log("Field updated successfully");
        } catch (e) {
            console.error("Error updating field:", e);
            throw e; // Propagate error to the component to show error state
        }
    };

    const handleRegenerateField = async (field) => {
        try {
            return await regenerateNPCField(npc.structuredData, field);
        } catch (e) {
            console.error("Error regenerating field:", e);
            return null;
        }
    };

    const handleExpandField = async (field) => {
        try {
            return await expandNPCField(npc.structuredData, field);
        } catch (e) {
            console.error("Error expanding field:", e);
            return null;
        }
    };

    const handleRegenerateVoice = async () => {
        try {
            return await regenerateVoice(npc.structuredData);
        } catch (e) {
            console.error("Error regenerating voice:", e);
            return null;
        }
    };



    const handleSetScene = async (isHidden) => {
        if (!sceneDescription.trim()) return;

        const sceneMsg = {
            role: 'scene',
            text: sceneDescription,
            isHidden: isHidden,
            timestamp: new Date().toISOString()
        };

        const newHistory = [...chatHistory, sceneMsg];
        setChatHistory(newHistory);
        setSceneDescription('');

        if (db) {
            try {
                const npcRef = doc(db, npcCollectionPath(appId, userId), npc.id);
                await updateDoc(npcRef, {
                    chats: newHistory,
                    updatedAt: new Date().toISOString()
                });
            } catch (e) {
                console.error("Error saving scene:", e);
            }
        }
    };

    // NPC Details for GM reference
    const npcDetails = useMemo(() => (
        <div className="p-4 mb-4 bg-indigo-50 rounded-xl shadow-inner border border-indigo-200">
            <h4 className="flex items-center text-lg font-bold text-indigo-700 cursor-pointer" onClick={() => setShowNpcDetails(!showNpcDetails)}>
                <Brain className="w-5 h-5 mr-2" />
                GM Details (Click to {showNpcDetails ? 'Hide' : 'Show'})
                {showNpcDetails ? <ChevronsUp className="w-4 h-4 ml-2" /> : <ChevronsDown className="w-4 h-4 ml-2" />}
            </h4>
            {showNpcDetails && (
                <div className="mt-2 text-sm space-y-2">
                    <p><strong className="text-indigo-600">Race/Class:</strong> {npc.structuredData.raceClass}</p>
                    <p><strong className="text-indigo-600">Gender/Age:</strong> {npc.structuredData.gender} / {npc.structuredData.ageRange}</p>
                    <p><strong className="text-indigo-600">Voice:</strong> {selectVoice(npc.structuredData.gender, npc.structuredData.ageRange)}</p>
                    <p><strong className="text-indigo-600">Visual Description:</strong> {npc.structuredData.visual}</p>
                    <p><strong className="text-indigo-600">Personality:</strong> {npc.structuredData.personality}</p>
                    <p><strong className="text-indigo-600">Wants:</strong> {npc.structuredData.wants}</p>
                    <p><strong className="text-indigo-600">Pitfalls:</strong> {npc.structuredData.pitfalls}</p>
                    <p className="p-2 border-l-4 border-red-500 bg-red-50"><strong className="text-red-700">SECRET:</strong> {npc.structuredData.secrets}</p>
                </div>
            )}
        </div>
    ), [npc.structuredData, showNpcDetails]);

    // UI for the main chat component
    // Left panel: NPC details
    const npcDetailsPanel = (
        <div className="h-full p-6 overflow-y-auto bg-gray-50">
            <EditableField
                label="Name"
                value={npc.name}
                onSave={(val) => handleUpdateField('name', val)}
                hideLabel={true}
                textClassName="text-2xl font-bold text-gray-900"
                className="mb-4 -m-2"
            />
            <p className="mb-4 text-sm font-semibold text-indigo-600">{npc.structuredData.raceClass}</p>

            {currentImageUrl ? (
                <img
                    src={currentImageUrl}
                    alt={npc.name}
                    onClick={() => setIsImageModalOpen(true)}
                    className="object-contain w-full mb-4 rounded-lg shadow-lg aspect-square bg-gray-200 cursor-pointer hover:opacity-95 transition-opacity"
                />
            ) : (
                <div className="flex items-center justify-center w-full mb-4 text-gray-500 bg-gray-200 rounded-lg aspect-square">
                    <p className='p-4 text-center text-xs'>Image not saved. Click below to generate.</p>
                </div>
            )}

            <button
                onClick={handleRegenerateImage}
                disabled={isImageGenerating}
                className={`w-full mb-6 flex items-center justify-center px-4 py-2 font-semibold transition-all duration-200 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 ${isImageGenerating ? 'bg-purple-100 text-purple-700 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white focus:ring-purple-500'}`}
            >
                <style>{magicalStyles}</style>
                {isImageGenerating ? (
                    <div className="relative mr-2">
                        <Wand2 className="w-5 h-5 animate-magic" />
                        <Sparkles className="w-3 h-3 text-yellow-400 absolute -top-1 -right-1 animate-sparkle-1" />
                        <Sparkles className="w-3 h-3 text-cyan-400 absolute -bottom-1 -left-1 animate-sparkle-2" />
                    </div>
                ) : (
                    <Wand2 className="w-5 h-5 mr-2" />
                )}
                {isImageGenerating ? 'Conjuring Masterpiece...' : 'Generate Epic Portrait'}
            </button>

            {/* GM Details Panel */}
            <div className="p-4 bg-indigo-50 rounded-xl shadow-inner border border-indigo-200">
                {/* Always Visible Section */}
                <div className="space-y-1 mb-4">
                    <div className="grid grid-cols-2 gap-2">
                        <EditableField
                            label="Gender"
                            value={npc.structuredData.gender}
                            type="select"
                            options={['male', 'female', 'other']}
                            onSave={(val) => handleUpdateField('gender', val)}
                        />
                        <EditableField
                            label="Age"
                            value={npc.structuredData.ageRange}
                            type="select"
                            options={['child', 'young adult', 'adult', 'middle-age', 'old']}
                            onSave={(val) => handleUpdateField('ageRange', val)}
                        />
                    </div>
                    <EditableField
                        label="Voice"
                        value={npc.structuredData.voiceId || selectVoice(npc.structuredData.gender, npc.structuredData.ageRange)}
                        displayValue={(npc.structuredData.voiceId || selectVoice(npc.structuredData.gender, npc.structuredData.ageRange)).split(' ')[0]}
                        type="select"
                        options={AVAILABLE_VOICES}
                        onSave={(val) => handleUpdateField('voiceId', val)}
                        onRegenerate={handleRegenerateVoice}
                    />
                    <EditableField
                        label="Race/Class"
                        value={npc.structuredData.raceClass}
                        onSave={(val) => handleUpdateField('raceClass', val)}
                    />
                    <EditableField
                        label="Visual Description"
                        value={npc.structuredData.visual}
                        type="textarea"
                        onSave={(val) => handleUpdateField('visual', val)}
                        onRegenerate={() => handleRegenerateField('visual')}
                    />
                </div>

                {/* Collapsible GM Details Section */}
                <h4 className="flex items-center text-lg font-bold text-indigo-700 cursor-pointer mb-3 pt-3 border-t border-indigo-200" onClick={() => setShowNpcDetails(!showNpcDetails)}>
                    <Brain className="w-5 h-5 mr-2" />
                    GM Details
                    {showNpcDetails ? <ChevronsUp className="w-4 h-4 ml-auto" /> : <ChevronsDown className="w-4 h-4 ml-auto" />}
                </h4>

                {showNpcDetails && (
                    <div className="space-y-1">
                        <EditableField
                            label="Personality"
                            value={npc.structuredData.personality}
                            type="textarea"
                            onSave={(val) => handleUpdateField('personality', val)}
                            onRegenerate={() => handleRegenerateField('personality')}
                        />
                        <EditableField
                            label="Wants"
                            value={npc.structuredData.wants}
                            type="textarea"
                            onSave={(val) => handleUpdateField('wants', val)}
                            onRegenerate={() => handleRegenerateField('wants')}
                            onExpand={() => handleExpandField('wants')}
                        />
                        <EditableField
                            label="Pitfalls"
                            value={npc.structuredData.pitfalls}
                            type="textarea"
                            onSave={(val) => handleUpdateField('pitfalls', val)}
                            onRegenerate={() => handleRegenerateField('pitfalls')}
                            onExpand={() => handleExpandField('pitfalls')}
                        />
                        <div className="border-l-4 border-red-500 bg-red-50 rounded-r-lg">
                            <EditableField
                                label="SECRET (GM ONLY)"
                                value={npc.structuredData.secrets}
                                type="textarea"
                                className="bg-transparent hover:bg-red-100"
                                onSave={(val) => handleUpdateField('secrets', val)}
                                onRegenerate={() => handleRegenerateField('secrets')}
                                onExpand={() => handleExpandField('secrets')}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Scene Control Panel */}
            <div className="mt-6 p-4 bg-indigo-50 rounded-xl shadow-inner border border-indigo-200">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="flex items-center text-lg font-bold text-indigo-700">
                        <Zap className="w-5 h-5 mr-2" />
                        Scene Control
                    </h4>
                    <button
                        onClick={() => setShowHiddenScenes(!showHiddenScenes)}
                        className={`p-1.5 rounded-lg transition-colors flex items-center space-x-1 text-xs font-medium ${showHiddenScenes ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-500'}`}
                        title={showHiddenScenes ? "Hidden scenes are visible to you" : "Hidden scenes are hidden from you"}
                    >
                        {showHiddenScenes ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
                        <span>{showHiddenScenes ? 'Show Hidden' : 'Hide Hidden'}</span>
                    </button>
                </div>
                <div className="space-y-3">
                    <textarea
                        value={sceneDescription}
                        onChange={(e) => setSceneDescription(e.target.value)}
                        placeholder="Describe the setting or scene change..."

                        className="w-full p-2 text-sm border border-indigo-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                        rows={3}
                        maxLength={1000}
                    />
                    <div className="flex items-center justify-between gap-3">
                        <Button
                            onClick={() => handleSetScene(false)}
                            disabled={!sceneDescription.trim()}
                            icon={Zap}
                            variant="custom"
                            className="flex-1 px-3 py-2 text-xs bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 shadow-sm"
                        >
                            Set Scene
                        </Button>
                        <Button
                            onClick={() => handleSetScene(true)}
                            disabled={!sceneDescription.trim()}
                            icon={EyeOff}
                            variant="custom"
                            className="flex-1 px-3 py-2 text-xs bg-white text-red-700 border border-red-200 hover:bg-red-50 shadow-sm"
                        >
                            Set Secret Scene
                        </Button>
                    </div>
                </div>
            </div>

            <p className="mt-4 text-xs font-mono text-gray-400">ID: {npc.id.substring(0, 8)}...</p>
        </div>
    );

    // Right panel: Chat
    const chatPanel = (
        <div className="flex flex-col h-full overflow-hidden bg-white">
            {/* Chat Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                <h3 className="text-lg font-semibold text-gray-800">Conversation</h3>
                <div className="flex items-center space-x-3">
                    {chatHistory.length > 0 && (
                        <>
                            <p className="text-sm text-gray-500">{chatHistory.length} messages</p>
                            <div className="flex space-x-1">
                                <button
                                    onClick={() => setIsAutoPlayEnabled(!isAutoPlayEnabled)}
                                    className={`p-1.5 rounded-full transition-colors ${isAutoPlayEnabled
                                        ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                        }`}
                                    title={isAutoPlayEnabled ? "Auto-play Enabled" : "Auto-play Disabled"}
                                >
                                    {isAutoPlayEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={handleResetConversation}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                    title="Reset Conversation"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Chat History Container - Scrollable */}
            <div id="chat-container" className="flex-1 p-6 space-y-4 overflow-y-auto bg-gray-50">
                {chatHistory.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-center text-gray-400">
                        <div>
                            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p>Start the conversation with {npc.name}!</p>
                            <p className="mt-2 text-sm">Click the <Volume2 className="w-4 h-4 inline-block" /> icon to hear their voice.</p>
                        </div>
                    </div>
                ) : (
                    chatHistory
                        .filter(msg => {
                            // Filter logic:
                            // If it's a scene AND it's hidden AND showHiddenScenes is false -> Hide it
                            if (msg.role === 'scene' && msg.isHidden && !showHiddenScenes) {
                                return false;
                            }
                            return true;
                        })
                        .map((msg, index) => (
                            <ChatBubble
                                key={index}
                                message={msg}
                                npcName={npc.name}
                                isSpeaking={playingMessageIndex === index}
                                onSpeakClick={() => handleSpeakClick(msg.text, index)}
                            />
                        ))
                )}
                {isThinking && (
                    <div className="flex justify-start">
                        <div className="p-3 text-gray-600 bg-gray-100 rounded-xl rounded-tl-none animate-pulse">
                            {npc.name} is thinking...
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area - Fixed at Bottom */}
            <div className="p-4 border-t border-gray-200 bg-white">
                <div className="flex items-end space-x-2">
                    <textarea
                        ref={messageInputRef}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows="2"
                        placeholder={`Say something to ${npc.name}...`}
                        className="flex-grow p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                        disabled={isThinking}
                        maxLength={1000}
                    />
                    <Button
                        onClick={handleSend}
                        disabled={!message.trim() || isThinking}
                        loading={isThinking}
                        className="h-12 w-12 p-0 flex-shrink-0 rounded-xl"
                    >
                        {!isThinking && <Send className="w-5 h-5" />}
                    </Button>
                </div>
            </div>
        </div>
    );

    // Mobile rendering: show only one panel at a time
    if (isMobile) {
        if (mobileView === 'details') {
            return (
                <div className="flex flex-col h-full overflow-hidden bg-white">
                    {/* Mobile header with back button - no title bar */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white flex-shrink-0">
                        <button
                            onClick={onBack}
                            className="flex items-center text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                            <ChevronLeft className="w-5 h-5 mr-1" />
                            Back to List
                        </button>
                        <button
                            onClick={onShowConversation}
                            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                        >
                            <MessageSquare className="w-4 h-4 mr-2" />
                            Conversation
                        </button>
                    </div>
                    {/* NPC Details Panel - Scrollable */}
                    <div className="flex-1 overflow-y-auto">
                        {npcDetailsPanel}
                    </div>
                    <ImageModal
                        isOpen={isImageModalOpen}
                        onClose={() => setIsImageModalOpen(false)}
                        imageUrl={currentImageUrl}
                        altText={npc.name}
                    />
                </div>
            );
        } else if (mobileView === 'conversation') {
            return (
                <div className="flex flex-col h-full overflow-hidden bg-white">
                    {/* Mobile header - Simplified */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={onShowDetails}
                                className="text-indigo-600 hover:text-indigo-800"
                            >
                                <ChevronLeft className="w-6 h-6" />
                            </button>
                            <h3 className="text-lg font-semibold text-gray-800">{npc.name}</h3>
                        </div>

                        {chatHistory.length > 0 && (
                            <div className="flex space-x-1">
                                <button
                                    onClick={() => setIsAutoPlayEnabled(!isAutoPlayEnabled)}
                                    className={`p-1.5 rounded-full transition-colors ${isAutoPlayEnabled
                                        ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                        }`}
                                    title={isAutoPlayEnabled ? "Auto-play Enabled" : "Auto-play Disabled"}
                                >
                                    {isAutoPlayEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={handleResetConversation}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                    title="Reset Conversation"
                                >
                                    <RotateCcw className="w-5 h-5" />
                                </button>
                            </div>
                        )}
                    </div>
                    {/* Chat Panel - Full Height */}
                    <div className="flex-1 overflow-hidden">
                        {/* Chat History Container - Scrollable */}
                        <div id="chat-container" className="h-full p-6 space-y-4 overflow-y-auto bg-gray-50">
                            {chatHistory.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-center text-gray-400">
                                    <div>
                                        <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                        <p>Start the conversation with {npc.name}!</p>
                                        <p className="mt-2 text-sm">Click the <Volume2 className="w-4 h-4 inline-block" /> icon to hear their voice.</p>
                                    </div>
                                </div>
                            ) : (
                                chatHistory
                                    .filter(msg => {
                                        if (msg.role === 'scene' && msg.isHidden && !showHiddenScenes) {
                                            return false;
                                        }
                                        return true;
                                    })
                                    .map((msg, index) => (
                                        <ChatBubble
                                            key={index}
                                            message={msg}
                                            npcName={npc.name}
                                            isSpeaking={playingMessageIndex === index}
                                            onSpeakClick={() => handleSpeakClick(msg.text, index)}
                                        />
                                    ))
                            )}
                            {isThinking && (
                                <div className="flex justify-start">
                                    <div className="p-3 text-gray-600 bg-gray-100 rounded-xl rounded-tl-none animate-pulse">
                                        {npc.name} is thinking...
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Input Area - Fixed at Bottom */}
                    <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
                        <div className="flex items-end space-x-2">
                            <textarea
                                ref={messageInputRef}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows="2"
                                placeholder={`Say something to ${npc.name}...`}
                                className="flex-grow p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                                disabled={isThinking}
                                maxLength={1000}
                            />
                            <Button
                                onClick={handleSend}
                                disabled={!message.trim() || isThinking}
                                loading={isThinking}
                                className="h-12 w-12 p-0 flex-shrink-0 rounded-xl"
                            >
                                {!isThinking && <Send className="w-5 h-5" />}
                            </Button>
                        </div>
                    </div>
                    <ImageModal
                        isOpen={isImageModalOpen}
                        onClose={() => setIsImageModalOpen(false)}
                        imageUrl={currentImageUrl}
                        altText={npc.name}
                    />
                </div >
            );
        }
    }

    // Desktop rendering: ResizablePanels
    return (
        <div className="flex h-full overflow-hidden bg-white">
            <ResizablePanels
                leftPanel={npcDetailsPanel}
                rightPanel={chatPanel}
                storageKey="npc-details-width"
                defaultLeftWidth={320}
                minLeftWidth={250}
                maxLeftWidth={500}
            />
            <ImageModal
                isOpen={isImageModalOpen}
                onClose={() => setIsImageModalOpen(false)}
                imageUrl={currentImageUrl}
                altText={npc.name}
            />
        </div>
    );
};


// --- Resizable Panel Components ---

const ResizablePanels = ({ leftPanel, rightPanel, isLeftCollapsed = false, storageKey = 'npc-panel-width', defaultLeftWidth = 320, minLeftWidth = 250, maxLeftWidth = 600 }) => {
    const containerRef = useRef(null);

    const [leftWidth, setLeftWidth] = useState(() => {
        const saved = localStorage.getItem(storageKey);
        return saved ? parseInt(saved, 10) : defaultLeftWidth;
    });
    const [isResizing, setIsResizing] = useState(false);

    // When collapsed, use minimal width (60px for the collapse button)
    const collapsedWidth = 60;
    const effectiveLeftWidth = isLeftCollapsed ? collapsedWidth : leftWidth;

    const startResizing = useCallback(() => {
        if (!isLeftCollapsed) {
            setIsResizing(true);
        }
    }, [isLeftCollapsed]);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((e) => {
        if (isResizing && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const newWidth = e.clientX - containerRect.left;
            if (newWidth >= minLeftWidth && newWidth <= maxLeftWidth) {
                setLeftWidth(newWidth);
                localStorage.setItem(storageKey, newWidth.toString());
            }
        }
    }, [isResizing, minLeftWidth, maxLeftWidth, storageKey]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
            document.body.classList.add('resizing');
        } else {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
            document.body.classList.remove('resizing');
        }

        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
            document.body.classList.remove('resizing');
        };
    }, [isResizing, resize, stopResizing]);

    return (
        <div ref={containerRef} className="flex h-full overflow-hidden">
            <div
                className={`flex-shrink-0 overflow-hidden ${!isResizing ? 'panel-transition' : ''}`}
                style={{ width: `${effectiveLeftWidth}px` }}
            >
                {leftPanel}
            </div>
            {!isLeftCollapsed && (
                <div
                    className="flex items-center justify-center w-1 bg-gray-300 resize-handle hover:w-1.5"
                    onMouseDown={startResizing}
                >
                    <GripVertical className="w-3 h-3 text-gray-500" />
                </div>
            )}
            <div className="flex-1 overflow-hidden">
                {rightPanel}
            </div>
        </div>
    );
};

// --- Compact NPC List Components ---

const CompactNpcListItem = ({ npc, isActive, onClick, onDelete }) => {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleDelete = (e) => {
        e.stopPropagation();
        setShowDeleteConfirm(true);
    };

    const confirmDelete = (e) => {
        e.stopPropagation();
        onDelete(npc);
        setShowDeleteConfirm(false);
    };

    const cancelDelete = (e) => {
        e.stopPropagation();
        setShowDeleteConfirm(false);
    };

    return (
        <div
            className={`npc-list-item group relative p-3 border-b border-gray-200 ${isActive ? 'active' : ''}`}
            onClick={onClick}
        >
            <div className="flex items-center space-x-3">
                <img
                    src={npc.imageUrl || 'https://placehold.co/64x64/4f46e5/ffffff?text=NPC'}
                    alt={npc.name}
                    className="object-cover w-12 h-12 rounded-md flex-shrink-0 bg-gray-200"
                />
                <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 truncate">{npc.name}</h4>
                    <p className="text-xs text-indigo-600 truncate">{npc.structuredData.raceClass}</p>
                    {npc.chats && npc.chats.length > 0 && (
                        <p className="text-xs text-gray-500">{npc.chats.length} messages</p>
                    )}
                </div>
                {!showDeleteConfirm ? (
                    <button
                        onClick={handleDelete}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all duration-200 flex-shrink-0 opacity-0 group-hover:opacity-100"
                        title="Delete NPC"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                ) : (
                    <div className="flex items-center bg-white shadow-sm border border-gray-200 rounded-full overflow-hidden animate-slide-in">
                        <button
                            onClick={confirmDelete}
                            className="p-2 text-green-600 hover:bg-green-50 transition-colors"
                            title="Confirm Delete"
                        >
                            <Check className="w-4 h-4" />
                        </button>
                        <div className="w-px h-4 bg-gray-200"></div>
                        <button
                            onClick={cancelDelete}
                            className="p-2 text-gray-500 hover:bg-gray-50 transition-colors"
                            title="Cancel"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )
                }
            </div >
        </div >
    );
};

const CompactNpcList = ({ npcs, selectedNpcId, onNpcSelected, onNpcDelete, onCreateNew, loading, isCollapsed, onToggleCollapse }) => {
    /**
     * Deletes an image from Cloudinary.
     */
    const deleteFromCloudinary = async (publicId) => {
        if (!publicId) return;

        console.log(`[${new Date().toISOString()}] Deleting image from Cloudinary: ${publicId}`);

        try {
            const response = await fetch('/.netlify/functions/delete-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicId })
            });

            const data = await response.json();

            if (data.result === 'ok') {
                console.log('Image deleted from Cloudinary successfully');
            } else {
                console.error('Failed to delete image from Cloudinary:', data);
            }
        } catch (error) {
            console.error('Error deleting image from Cloudinary:', error);
        }
    };

    const handleDelete = async (npc) => {
        try {
            // Delete image from Cloudinary if it exists
            if (npc.cloudinaryImageId) {
                await deleteFromCloudinary(npc.cloudinaryImageId);
            }
            onNpcDelete(npc);
        } catch (error) {
            console.error("Error deleting NPC:", error);
        }
    };

    if (isCollapsed) {
        return (
            <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
                <div className="flex items-center justify-center p-4 border-b border-gray-200 bg-white">
                    <button
                        onClick={onToggleCollapse}
                        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Expand sidebar"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                <div className="flex items-center space-x-2">
                    <List className="w-5 h-5 text-indigo-600" />
                    <h2 className="font-bold text-gray-900">My NPCs ({npcs.length})</h2>
                </div>
                <div className="flex items-center space-x-1">
                    <button
                        onClick={onCreateNew}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Create new NPC"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                    {/* Hide collapse button on mobile */}
                    <button
                        onClick={onToggleCollapse}
                        className="hidden md:block p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Collapse sidebar"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* NPC List */}
            <div className="flex-1 overflow-y-auto compact-npc-list">
                {loading ? (
                    <div className="flex items-center justify-center p-8">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                    </div>
                ) : npcs.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">
                        <p>No NPCs yet.</p>
                        <p className="mt-2">Click the <Plus className="w-4 h-4 inline" /> button to create your first one!</p>
                    </div>
                ) : (
                    npcs.map(npc => (
                        <CompactNpcListItem
                            key={npc.id}
                            npc={npc}
                            isActive={npc.id === selectedNpcId}
                            onClick={() => onNpcSelected(npc)}
                            onDelete={handleDelete}
                        />
                    ))
                )}
            </div>

            {/* Feedback Button */}
            <div className="p-4 border-t border-gray-200 bg-white">
                <FeedbackButton />
            </div>
        </div>
    );
};


// --- NPC List Component (Unchanged) ---


const NpcList = ({ npcs, onNpcSelected, db, userId, loading }) => {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [npcToDelete, setNpcToDelete] = useState(null);

    const handleDeleteClick = (npc) => {
        setNpcToDelete(npc);
        setIsDeleteModalOpen(true);
    };

    /**
     * Deletes an image from Cloudinary.
     * @param {string} publicId - The public ID of the image to delete
     * @returns {Promise<void>}
     */
    const deleteFromCloudinary = async (publicId) => {
        if (!publicId) return;

        console.log(`[${new Date().toISOString()}] Deleting image from Cloudinary: ${publicId}`);

        try {
            const response = await fetch('/.netlify/functions/delete-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicId })
            });

            const data = await response.json();

            if (data.result === 'ok') {
                console.log('Image deleted from Cloudinary successfully');
            } else {
                console.error('Failed to delete image from Cloudinary:', data);
            }
        } catch (error) {
            console.error('Error deleting image from Cloudinary:', error);
        }
    };

    const confirmDelete = async () => {
        if (!npcToDelete) return;

        try {
            // Delete image from Cloudinary if it exists
            if (npcToDelete.cloudinaryImageId) {
                await deleteFromCloudinary(npcToDelete.cloudinaryImageId);
            }

            const npcRef = doc(db, npcCollectionPath(appId, userId), npcToDelete.id);
            await deleteDoc(npcRef);
            setIsDeleteModalOpen(false);
            setNpcToDelete(null);
        } catch (error) {
            console.error("Error deleting NPC:", error);
            console.warn("Failed to delete NPC. See console.");
        }
    };

    if (loading) return <LoadingIndicator />;

    return (
        <div className="p-4 space-y-4 bg-white rounded-lg shadow-xl md:p-8">
            <h2 className="flex items-center text-2xl font-bold text-indigo-700">
                <List className="w-6 h-6 mr-2" />
                My Saved NPCs ({npcs.length})
            </h2>
            <p className="text-sm text-gray-600">The chat history for these NPCs is stored in the database for persistence and sharing.</p>

            <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {npcs.map(npc => (
                    <div key={npc.id} className="p-4 transition-all duration-300 bg-gray-50 border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-indigo-300">
                        <img
                            // The image is not persisted, so we show a placeholder here
                            src={npc.imageUrl || 'https://placehold.co/400x200/4f46e5/ffffff?text=Image+Not+Saved'}
                            alt={npc.name}
                            className="object-contain w-full mb-3 rounded-lg aspect-square bg-gray-100"
                        />
                        <h3 className="text-lg font-bold text-gray-800">{npc.name}</h3>
                        <p className="text-sm italic text-indigo-600">{npc.structuredData.raceClass}</p>
                        <p className="mt-2 text-sm text-gray-600 line-clamp-2">{npc.structuredData.personality}</p>
                        <p className="mt-1 text-xs font-mono text-gray-400">ID: {npc.id.substring(0, 6)}...</p>

                        <div className="flex justify-between mt-4">
                            <Button
                                onClick={() => onNpcSelected(npc)}
                                icon={MessageSquare}
                                className="px-3 py-1 text-sm"
                            >
                                Open Chat
                            </Button>
                            <Button
                                onClick={() => handleDeleteClick(npc)}
                                icon={Trash2}
                                className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600"
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
            {npcs.length === 0 && (
                <div className="p-10 text-center text-gray-500 bg-gray-100 rounded-lg">
                    No NPCs found. Go to the "New NPC" tab to create your first one!
                </div>
            )}

            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                title="Delete NPC"
                message={`Are you sure you want to permanently delete "${npcToDelete?.name}"? This action cannot be undone.`}
            />
        </div>
    );
};

// --- Main Application Component (Unchanged) ---


const NPCGeneratorChatbot = ({ user, impersonatedUserId, onShowAdmin }) => {
    // Use impersonated user ID if set, otherwise use actual user ID
    const userId = impersonatedUserId || user.uid;
    const isAuthReady = true;

    const { npcs, loading } = useNPCs(db, userId, isAuthReady);

    // Retrieve API key from environment variables
    const apiKey = null; // API Key removed. Using Netlify Functions.

    const [selectedNpcId, setSelectedNpcId] = useState(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    // Mobile state management
    const [isMobile, setIsMobile] = useState(false);
    const [mobileView, setMobileView] = useState('list'); // 'list', 'details', 'conversation'

    // Detect mobile screen size
    useEffect(() => {
        const mediaQuery = window.matchMedia('(max-width: 768px)');

        const handleMediaChange = (e) => {
            setIsMobile(e.matches);
            // Reset to list view when switching to mobile
            if (e.matches && mobileView !== 'list' && !selectedNpcId) {
                setMobileView('list');
            }
        };

        // Set initial value
        setIsMobile(mediaQuery.matches);

        // Listen for changes
        mediaQuery.addEventListener('change', handleMediaChange);
        return () => mediaQuery.removeEventListener('change', handleMediaChange);
    }, []);

    // Derive the selected NPC object from the live list
    const selectedNpc = useMemo(() => {
        return npcs.find(n => n.id === selectedNpcId) || null;
    }, [npcs, selectedNpcId]);

    const handleNpcSelected = (npc) => {
        setSelectedNpcId(npc.id);
        setShowCreateForm(false);
        // On mobile, navigate to details view
        if (isMobile) {
            setMobileView('details');
        }
    };

    const handleCreateNew = () => {
        if (npcs.length >= 10) {
            alert("You have reached the limit of 10 NPCs. Please delete an NPC before creating a new one.");
            return;
        }
        setSelectedNpcId(null);
        setShowCreateForm(true);
        // On mobile, show the create form by setting view to 'details'
        if (isMobile) {
            setMobileView('details'); // Changed from 'list' to 'details' to show create form
        }
    };

    const handleNpcCreated = (newNpcId) => {
        setShowCreateForm(false);
        setSelectedNpcId(newNpcId);
        // On mobile, navigate to details view
        if (isMobile) {
            setMobileView('details');
        }
    };

    const handleNpcDelete = async (npc) => {
        if (!db) return;
        try {
            const npcRef = doc(db, npcCollectionPath(appId, userId), npc.id);
            await deleteDoc(npcRef);
            // If the deleted NPC was selected, clear selection
            if (selectedNpcId === npc.id) {
                setSelectedNpcId(null);
                // On mobile, return to list view
                if (isMobile) {
                    setMobileView('list');
                }
            }
        } catch (error) {
            console.error("Error deleting NPC:", error);
        }
    };

    // Mobile navigation handlers
    const handleBackToList = () => {
        setSelectedNpcId(null);
        setMobileView('list');
    };

    const handleShowConversation = () => {
        setMobileView('conversation');
    };

    const handleShowDetails = () => {
        setMobileView('details');
    };

    // Right panel content
    let rightPanelContent;
    if (!isAuthReady) {
        rightPanelContent = (
            <div className="flex items-center justify-center h-full bg-white">
                <LoadingIndicator />
            </div>
        );
    } else if (selectedNpc) {
        rightPanelContent = (
            <NpcChat
                db={db}
                userId={userId}
                userEmail={user?.email}
                npc={selectedNpc}
                onBack={handleBackToList}
                isMobile={isMobile}
                mobileView={mobileView}
                onShowConversation={handleShowConversation}

                onShowDetails={handleShowDetails}
            />
        );
    } else if (showCreateForm) {
        rightPanelContent = (
            <div className="h-full overflow-y-auto bg-gray-50 p-4">
                <NpcCreation
                    db={db}
                    userId={userId}

                    onNpcCreated={handleNpcCreated}
                />
            </div>
        );
    } else {
        // Empty state
        rightPanelContent = (
            <div className="flex items-center justify-center h-full bg-white">
                <div className="text-center p-8">
                    <User className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">No NPC Selected</h3>
                    <p className="text-gray-500 mb-6">Select an NPC from the sidebar to start chatting, or create a new one.</p>
                    <Button
                        onClick={handleCreateNew}
                        icon={Plus}
                        className="px-6 py-3 text-lg"
                    >
                        Create New NPC
                    </Button>


                </div>
            </div >
        );
    }

    // Left panel content
    const leftPanelContent = (
        <CompactNpcList
            npcs={npcs}
            selectedNpcId={selectedNpc?.id}
            onNpcSelected={handleNpcSelected}
            onNpcDelete={handleNpcDelete}
            onCreateNew={handleCreateNew}
            loading={loading}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />
    );

    // Mobile rendering: full-screen views
    if (isMobile) {
        return (
            <div className="flex flex-col h-screen font-sans bg-gray-100">
                {/* Only show header on list view */}
                {(mobileView === 'list' || (!selectedNpc && !showCreateForm)) && (
                    <header className="flex-shrink-0 p-4 bg-white border-b border-gray-200 shadow-sm">
                        <div className="flex flex-col justify-between md:flex-row md:items-center">
                            <div>
                                <h1 className="flex items-center text-2xl font-extrabold text-indigo-800">
                                    <User className="w-7 h-7 mr-2 text-indigo-500" />
                                    GM NPC Assistant
                                </h1>
                                <p className="mt-1 text-xs text-gray-600">
                                    Generate, store, and roleplay your campaign's characters.
                                </p>
                            </div>
                        </div>
                    </header>
                )}

                <div className="flex-1 overflow-hidden">
                    {mobileView === 'list' || (!selectedNpc && !showCreateForm) ? (
                        // Show NPC list
                        leftPanelContent
                    ) : showCreateForm ? (
                        // Show create form
                        rightPanelContent
                    ) : (
                        // Show NPC details or conversation
                        rightPanelContent
                    )}
                </div>
            </div>
        );
    }

    // Desktop rendering: ResizablePanels
    return (
        <div className="flex flex-col h-screen font-sans bg-gray-100">
            <header className="flex-shrink-0 p-4 bg-white border-b border-gray-200 shadow-sm">
                <div className="flex flex-col justify-between md:flex-row md:items-center">
                    <div>
                        <h1 className="flex items-center text-2xl font-extrabold text-indigo-800">
                            <User className="w-7 h-7 mr-2 text-indigo-500" />
                            GM NPC Assistant
                        </h1>
                        <p className="mt-1 text-xs text-gray-600">
                            Generate, store, and roleplay your campaign's characters.
                        </p>
                    </div>

                    {/* Admin Button - only show if user is admin and not impersonating */}
                    {user?.email === import.meta.env.VITE_ADMIN_EMAIL && !impersonatedUserId && onShowAdmin && (
                        <button
                            onClick={onShowAdmin}
                            className="mt-2 md:mt-0 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                            Admin Dashboard
                        </button>
                    )}
                </div>
            </header>

            <div className="flex-1 overflow-hidden">
                <ResizablePanels
                    leftPanel={leftPanelContent}
                    rightPanel={rightPanelContent}
                    isLeftCollapsed={isSidebarCollapsed}
                />
            </div>
        </div>
    );
};

export default NPCGeneratorChatbot; 