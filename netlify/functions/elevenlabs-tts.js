// Note: fetch is built-in to Node.js 18+, no need to import

export default async (req, context) => {
    // Only allow POST requests
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const { text, voiceId } = await req.json();

        if (!text || !voiceId) {
            return new Response(JSON.stringify({ error: 'Missing text or voiceId' }), { status: 400 });
        }

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            console.error('ELEVENLABS_API_KEY is not set');
            return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
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
            }), { status: response.status });
        }

        // Get audio buffer and convert to base64
        const audioBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        return new Response(JSON.stringify({
            audio: base64Audio,
            mimeType: 'audio/mpeg'
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error('Error in elevenlabs-tts function:', error);
        return new Response(JSON.stringify({
            error: 'Internal server error',
            message: error.message
        }), { status: 500 });
    }
};
