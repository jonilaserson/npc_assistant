export default async (req, context) => {
    // Only allow POST requests
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const body = await req.json();
        const { text, voiceId, languageCode = "en-US", speakingRate = 1.0, pitch = 0.0 } = body;

        // Use GOOGLE_AI_API_KEY as primary, fallback to specific one if needed later
        const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing Server API Key" }), { status: 500 });
        }

        if (!text) {
            return new Response(JSON.stringify({ error: "Missing text" }), { status: 400 });
        }

        // https://cloud.google.com/text-to-speech/docs/reference/rest/v1beta1/text/synthesize
        const apiUrl = `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`;

        const payload = {
            input: { text: text },
            voice: {
                languageCode: languageCode,
                name: voiceId, // e.g., "en-US-Neural2-A"
            },
            audioConfig: {
                audioEncoding: "MP3",
                speakingRate: speakingRate,
                pitch: pitch
            }
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Google TTS API Error:", response.status, errorText);
            return new Response(JSON.stringify({
                error: "Google TTS API Error",
                details: errorText
            }), { status: response.status });
        }

        const data = await response.json();

        // Google TTS returns { audioContent: "<base64>" }
        return new Response(JSON.stringify({
            audio: data.audioContent,
            mimeType: 'audio/mpeg'
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("Google TTS Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
