import { doc, getDoc, setDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebaseConfig';
import * as Sentry from "@sentry/react";
import { AVAILABLE_VOICES, getVoiceById } from './constants/voices';
import {
    getStructuredNPCPrompt,
    getSceneGenerationPrompt,
    getImageGenerationPrompt,
    getImageSystemInstruction,
    getImageFallbackPrompt,
    getRoleplaySystemPrompt,
    getFieldRegenerationPrompt,
    getFieldExpansionPrompt,
    getVoiceRegenerationPrompt
} from './constants/prompts';

// ==========================================
// API Utilities
// ==========================================

/**
 * Utility for making fetch requests with exponential backoff.
 */
export const fetchWithBackoff = async (url, options, retries = 3, backoff = 1000) => {
    try {
        const response = await fetch(url, options);

        // 429 Too Many Requests - specific handling
        if (response.status === 429 && retries > 0) {
            console.warn(`Rate limited (429). Retrying in ${backoff}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithBackoff(url, options, retries - 1, backoff * 2);
        }

        // 503 Service Unavailable or 504 Gateway Timeout - transient errors
        if ((response.status === 503 || response.status === 504) && retries > 0) {
            console.warn(`Server error (${response.status}). Retrying in ${backoff}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithBackoff(url, options, retries - 1, backoff * 2);
        }

        // Other errors are returned as-is
        return response;
    } catch (error) {
        if (retries > 0) {
            console.warn(`Fetch error: ${error.message}. Retrying in ${backoff}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithBackoff(url, options, retries - 1, backoff * 2);
        }
        throw error;
    }
};

// ==========================================
// User Service
// ==========================================

/**
 * Check if the user has accepted the legal agreement terms.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export const checkTermsAccepted = async (userId) => {
    if (!userId) return false;
    try {
        const userRef = doc(db, 'all_users', userId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            return !!userSnap.data().termsAccepted;
        }
        return false;
    } catch (error) {
        console.error("Error checking terms acceptance:", error);
        return false;
    }
};

/**
 * Record that the user has accepted the legal agreement terms.
 * @param {string} userId
 * @returns {Promise<void>}
 */
export const acceptTerms = async (userId) => {
    if (!userId) return;
    try {
        const userRef = doc(db, 'all_users', userId);
        await setDoc(userRef, {
            termsAccepted: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error("Error accepting terms:", error);
        throw error;
    }
};

// ==========================================
// Credit Service
// ==========================================

const USERS_COLLECTION = 'all_users';

/**
 * Get the current credit balance for a user.
 * Defaults to 100 if the field is missing.
 * @param {string} userId 
 * @returns {Promise<number>}
 */
export const getCredits = async (userId) => {
    if (!userId) return 0;
    try {
        const userRef = doc(db, USERS_COLLECTION, userId);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            // Default to 100 if undefined
            return typeof data.credits === 'number' ? data.credits : 100;
        }
        // If user doc doesn't exist yet, they technically have 100 "potential" credits 
        // that will be initialized on creation, but return 100 for display?
        // Or 0? Let's return 100 so the UI looks inviting, assuming they are logged in.
        return 100;
    } catch (error) {
        console.error("Error getting credits:", error);
        return 0;
    }
};

/**
 * Add credits to a user's balance.
 * @param {string} userId 
 * @param {number} amount 
 * @returns {Promise<number>} New balance
 */
export const addCredits = async (userId, amount) => {
    if (!userId || amount <= 0) return;
    const userRef = doc(db, USERS_COLLECTION, userId);

    try {
        const newBalance = await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) {
                // Should not happen for logged in users mostly, but auto-create?
                const initial = 100 + amount;
                transaction.set(userRef, { credits: initial, createdAt: serverTimestamp() }, { merge: true });
                return initial;
            }

            const data = userDoc.data();
            const current = typeof data.credits === 'number' ? data.credits : 100;
            const updated = current + amount;

            transaction.update(userRef, { credits: updated });
            return updated;
        });
        return newBalance;
    } catch (error) {
        console.error("Error adding credits:", error);
        throw error;
    }
};

/**
 * Deduct credits from a user's balance safely.
 * Throws an error if insufficient funds.
 * @param {string} userId 
 * @param {number} amount 
 * @returns {Promise<number>} New balance
 */
export const deductCredits = async (userId, amount) => {
    if (!userId || amount <= 0) return;
    const userRef = doc(db, USERS_COLLECTION, userId);

    try {
        const newBalance = await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) {
                throw new Error("User does not exist");
            }

            const data = userDoc.data();
            const current = typeof data.credits === 'number' ? data.credits : 100;

            if (current < amount) {
                throw new Error("Insufficient funds");
            }

            const updated = current - amount;
            transaction.update(userRef, { credits: updated });
            return updated;
        });
        return newBalance;
    } catch (error) {
        // Propagate error so UI can show message
        throw error;
    }
};

// ==========================================
// Audio Service
// ==========================================

// --- Helper Functions ---

const base64ToArrayBuffer = (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

const pcmToWav = (pcmData, sampleRate = 24000) => {
    // 16-bit PCM
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.byteLength * 2; // 16-bit = 2 bytes per sample
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF chunk
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, byteRate, true); // ByteRate
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM data
    let offset = 44;
    for (let i = 0; i < pcmData.length; i++) {
        view.setInt16(offset, pcmData[i], true); // Little-endian
        offset += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
};

// --- Voice Selection Logic ---

/**
 * Maps gender and age range to a suitable TTS voice.
 * Fallback mechanism if specific logical selection fails.
 */
const VOICE_MAP = {
    'female': {
        'young adult': 'Leda',
        'middle-aged': 'Aoede',
        'old': 'Despina',
        'child': 'Kore',
        'default': 'Aoede'
    },
    'male': {
        'young adult': 'Fenrir',
        'middle-aged': 'Autonoe',
        'old': 'Orus',
        'child': 'Puck',
        'default': 'Charon'
    },
    'neutral': {
        'default': 'Puck'
    }
};

/**
 * Selects a fallback voice based on gender and age range.
 */
export const selectVoice = (genderRaw, ageRangeRaw) => {
    const gender = (genderRaw || 'neutral').toLowerCase().trim();
    // Simple age mapping
    let age = 'adult';
    const ageRawLower = (ageRangeRaw || '').toLowerCase();

    if (ageRawLower.includes('young') || ageRawLower.includes('child')) age = 'young adult';
    if (ageRawLower.includes('middle') || ageRawLower.includes('old') || ageRawLower.includes('elderly')) age = 'old';

    // Get specific map or fallback
    const genderMap = VOICE_MAP[gender] || VOICE_MAP['neutral'];
    return genderMap[age] || genderMap['default'];
};


/**
 * Helper to select a voice from a list of candidates, optionally excluding one.
 */
export const selectVoiceFromCandidates = (candidates, voiceToExclude = '') => {
    if (!candidates || candidates.length === 0) return null;

    console.log("Voice Candidates:", candidates);

    // Filter out excluded voice (compare first word)
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
        // Fallback: pick random available voice that isn't the excluded one
        console.warn("All candidates matched excluded voice. Picking random fallback.");
        const otherVoices = AVAILABLE_VOICES.filter(v => !v.startsWith(voiceToExclude + ' '));
        const randomVoice = otherVoices[Math.floor(Math.random() * otherVoices.length)];
        selectedVoiceName = randomVoice.split(' ')[0];
    }

    // Clean up name
    selectedVoiceName = selectedVoiceName.trim().replace(/['"]/g, '');

    // Find the full voice string from AVAILABLE_VOICES that starts with this name
    const fullVoiceString = AVAILABLE_VOICES.find(v => v.startsWith(selectedVoiceName + ' ')) || selectedVoiceName;
    return fullVoiceString;
};

/**
 * Regenerates the voice selection for an NPC.
 * Asks the LLM to select from the top 3 matching voices, excluding the current voice.
 */
export const regenerateVoice = async (structuredData) => {
    if (!AVAILABLE_VOICES || AVAILABLE_VOICES.length === 0) {
        throw new Error("Configuration Error: AVAILABLE_VOICES list is missing or empty.");
    }

    const currentVoice = structuredData.voiceId?.split(' ')[0] || '';

    const systemPrompt = getVoiceRegenerationPrompt(structuredData, AVAILABLE_VOICES);

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

// --- TTS Logic ---

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

        console.error('Gemini TTS API Error Response:', result.error);

        Sentry.captureException(new Error(`Gemini TTS API Error: ${errorMsg}`), {
            tags: { feature: 'gemini_tts', api_error: true },
            extra: { errorCode: result.error.code, errorMessage: errorMsg, voiceName, textLength: text.length }
        });

        if (result.error.code === 429) throw new Error('TTS quota exceeded. Please try again later.');
        throw new Error('TTS service temporarily unavailable.');
    }

    const part = result?.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType;

    if (audioData && mimeType && mimeType.startsWith("audio/")) {
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

        const pcmData = base64ToArrayBuffer(audioData);
        const pcm16 = new Int16Array(pcmData);
        const wavBlob = pcmToWav(pcm16, sampleRate);

        return URL.createObjectURL(wavBlob);
    } else {
        console.error('Missing audio data or invalid mimeType:', { hasAudioData: !!audioData, mimeType });
        throw new Error('Unable to generate audio. Please try again.');
    }
};

/**
 * Main TTS entry point.
 * Converts text to a playable audio URL, selecting voice based on structured data.
 */
export const textToSpeech = async (text, structuredData) => {
    // 1. Strip stage directions in brackets
    const dialogueOnly = text.replace(/ *\[[\s\S]*?\] */g, '').trim();

    if (!dialogueOnly) {
        throw new Error("No spoken dialogue found in the message.");
    }

    // 2. Select the voice dynamically
    let selectedVoice = structuredData.voiceId;
    let voiceData = getVoiceById(selectedVoice);

    if (!voiceData && selectedVoice) {
        const shortName = selectedVoice.split(' ')[0].trim();
        voiceData = getVoiceById(shortName);
    }

    // Fallback if needed
    if (!voiceData) {
        const fallbackName = selectVoice(structuredData.gender, structuredData.ageRange);
        voiceData = getVoiceById(fallbackName);
        if (!voiceData) voiceData = getVoiceById('Aoede'); // Ultimate fallback
    }

    const processTTSResponse = async (response) => {
        const data = await response.json();
        if (data.error) throw new Error(data.error + (data.details ? `: ${data.details}` : ''));

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
        console.log(`%c[TTS] Generating audio using provider: ${voiceData.provider} (Voice: ${voiceData.name})`, 'color: #0ea5e9; font-weight: bold;');

        if (voiceData.provider === 'gemini') {
            return await geminiTTS(dialogueOnly, voiceData.id);
        } else if (voiceData.provider === 'elevenlabs') {
            const response = await fetchWithBackoff('/.netlify/functions/elevenlabs-tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: dialogueOnly, voiceId: voiceData.id })
            });
            return await processTTSResponse(response);
        } else if (voiceData.provider === 'google') {
            const response = await fetchWithBackoff('/.netlify/functions/google-tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: dialogueOnly, voiceId: voiceData.id })
            });
            return await processTTSResponse(response);
        } else {
            throw new Error(`Unknown voice provider: ${voiceData.provider}`);
        }
    } catch (e) {
        console.error("TTS Generation Error:", e.message);
        // Only log critical errors to Sentry
        if (e.message.includes('quota') || e.message.includes('API error') || e.message.includes('503') || e.message.includes('429')) {
            Sentry.captureException(e, {
                tags: { feature: 'tts_critical', provider: voiceData?.provider || 'unknown' },
                extra: { voiceId: voiceData?.id, textLength: dialogueOnly.length, errorMessage: e.message }
            });
        }
        throw new Error(`Failed to generate voice: ${e.message}`);
    }
};

// ==========================================
// AI Generator Service
// ==========================================

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
