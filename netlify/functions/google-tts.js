import { CORS_HEADERS, deductCredits, requireAuthAndCredits } from './utils/firebase';

export default async (req, context) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
        const COST = 2; // Deduct 2 Gold for TTS

        // 1. Verify Authentication & Credits
        const { user: authUser, errorResponse } = await requireAuthAndCredits(req, COST);
        if (errorResponse) return errorResponse;

        const userId = authUser.userId;

        // 3. Process TTS Request
        const body = await req.json();
        const { text, voiceId, languageCode = "en-US", speakingRate = 1.0, pitch = 0.0 } = body;
        const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing Server API Key" }), { status: 500, headers: CORS_HEADERS });
        }

        if (!text) {
            return new Response(JSON.stringify({ error: "Missing text" }), { status: 400, headers: CORS_HEADERS });
        }

        const apiUrl = `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`;
        const payload = {
            input: { text: text },
            voice: { languageCode: languageCode, name: voiceId },
            audioConfig: { audioEncoding: "MP3", speakingRate: speakingRate, pitch: pitch }
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Google TTS API Error:", response.status, errorText);
            return new Response(JSON.stringify({ error: "Google TTS API Error", details: errorText }), { status: response.status, headers: CORS_HEADERS });
        }

        const data = await response.json();

        // 4. Deduct Credits (Atomic) - Post-Success
        const { newBalance } = await deductCredits(userId, COST);

        return new Response(JSON.stringify({
            audio: data.audioContent,
            mimeType: 'audio/mpeg',
            credits_deducted: COST,
            new_balance: newBalance
        }), {
            headers: CORS_HEADERS
        });

    } catch (error) {
        console.error("Google TTS Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
