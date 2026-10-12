import crypto from 'crypto';
import { CORS_HEADERS, deductCredits, requireAuthAndCredits } from './utils/firebase';

export default async (req, context) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
        const cost = 5; // Fixed cost per generated image

        // 1. Verify Authentication & Credits
        const { user: authUser, errorResponse } = await requireAuthAndCredits(req, cost);
        if (errorResponse) return errorResponse;

        const userId = authUser.userId;
        const { prompt, npcId } = await req.json();
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
        const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!openaiApiKey || !cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret) {
            return new Response(JSON.stringify({ error: "Missing Server Configuration" }), { status: 500, headers: CORS_HEADERS });
        }

        // 3. Generate Image (GPT Image 2; DALL-E 3 was retired by OpenAI)
        console.log('Generating image with gpt-image-2 (1024x1024)...');
        const payload = { model: "gpt-image-2", prompt: prompt, n: 1, size: "1024x1024", quality: "low", output_format: "jpeg" };

        const dalleResponse = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify(payload)
        });

        const dalleResult = await dalleResponse.json();
        if (!dalleResult.data || !dalleResult.data[0].b64_json) {
            throw new Error("Image generation failed: " + JSON.stringify(dalleResult));
        }
        // GPT image models return base64 only; Cloudinary accepts it as a data URI
        const imageUrl = `data:image/jpeg;base64,${dalleResult.data[0].b64_json}`;

        // 4. Upload to Cloudinary
        console.log("Uploading to Cloudinary...");
        const timestamp = Math.round(Date.now() / 1000);
        const publicId = `npcs/images/${npcId}`;
        const paramsToSign = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}${cloudinaryApiSecret}`;
        const signature = crypto.createHash('sha256').update(paramsToSign).digest('hex');

        const formData = new FormData();
        formData.append('file', imageUrl);
        formData.append('public_id', publicId);
        formData.append('timestamp', timestamp.toString());
        formData.append('api_key', cloudinaryApiKey);
        formData.append('signature', signature);
        formData.append('overwrite', 'true');

        const cloudinaryResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`, {
            method: 'POST',
            body: formData
        });

        const cloudinaryResult = await cloudinaryResponse.json();

        if (!cloudinaryResponse.ok) {
            throw new Error("Cloudinary upload failed: " + JSON.stringify(cloudinaryResult));
        }

        // 5. Deduct Credits (Atomic) - Post-Success
        const { newBalance } = await deductCredits(userId, cost);

        return new Response(JSON.stringify({
            secure_url: cloudinaryResult.secure_url,
            public_id: cloudinaryResult.public_id,
            credits_deducted: cost,
            new_balance: newBalance
        }), {
            headers: CORS_HEADERS
        });

    } catch (error) {
        console.error("Generate Image Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
