import { CORS_HEADERS, deductCredits, requireAuthAndCredits } from './utils/firebase';

export default async (req, context) => {
    // Only allow POST requests
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


        // 3. Process Request
        const { text, voiceId } = await req.json();

        if (!text || !voiceId) {
            return new Response(JSON.stringify({ error: 'Missing text or voiceId' }), { status: 400, headers: CORS_HEADERS });
        }

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            console.error('ELEVENLABS_API_KEY is not set');
            return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500, headers: CORS_HEADERS });
        }

        // Call ElevenLabs TTS API
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    model_id: "eleven_turbo_v2_5", // Fast, high-quality model
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('ElevenLabs API error:', response.status, errorText);
            return new Response(JSON.stringify({
                error: 'ElevenLabs API error',
                details: errorText
            }), { status: response.status, headers: CORS_HEADERS });
        }

        // Get audio buffer and convert to base64
        const audioBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        // 4. Deduct Credits (Atomic) - Post-Success
        const { newBalance } = await deductCredits(userId, COST);

        return new Response(JSON.stringify({
            audio: base64Audio,
            mimeType: 'audio/mpeg',
            credits_deducted: COST,
            new_balance: newBalance
        }), {
            headers: CORS_HEADERS
        });

    } catch (error) {
        console.error('Error in elevenlabs-tts function:', error);
        return new Response(JSON.stringify({
            error: 'Internal server error',
            message: error.message
        }), { status: 500, headers: CORS_HEADERS });
    }
};
