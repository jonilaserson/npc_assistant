import { fetchWithBackoff } from '../utils/apiUtils';
import * as Sentry from "@sentry/react";
import { AVAILABLE_VOICES, getVoiceById } from '../constants/voices';
import { getVoiceRegenerationPrompt } from '../constants/prompts';

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
