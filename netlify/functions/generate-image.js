import crypto from 'crypto';

export default async (req, context) => {
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const { prompt, npcId, isInitial = false } = await req.json();
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
        const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!openaiApiKey || !cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret) {
            console.error("Missing env vars:", {
                hasOpenAI: !!openaiApiKey,
                hasCloudName: !!cloudinaryCloudName,
                hasCloudKey: !!cloudinaryApiKey,
                hasCloudSecret: !!cloudinaryApiSecret
            });
            return new Response(JSON.stringify({ error: "Missing Server Configuration" }), { status: 500 });
        }

        // 1. Generate Image with appropriate model and size
        let payload;
        if (isInitial) {
            // Initial generation: DALL-E 2 with 256x256
            console.log('Generating initial image with DALL-E 2 (256x256)...');
            payload = {
                model: "dall-e-2",
                prompt: prompt,
                size: "256x256",
                n: 1
            };
        } else {
            // Regeneration: DALL-E 3 with 1024x1024 high quality
            console.log('Generating high-quality image with DALL-E 3 (1024x1024)...');
            payload = {
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1024",
                quality: "standard",
                style: "vivid"
            };
        }

        const dalleResponse = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify(payload)
        });

        const dalleResult = await dalleResponse.json();
        if (!dalleResult.data || !dalleResult.data[0].url) {
            throw new Error("DALL-E generation failed: " + JSON.stringify(dalleResult));
        }
        const imageUrl = dalleResult.data[0].url;
        console.log("DALL-E generated image URL:", imageUrl);

        // 2. Upload to Cloudinary
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

        console.log("Cloudinary upload success:", cloudinaryResult.secure_url);

        return new Response(JSON.stringify({
            secure_url: cloudinaryResult.secure_url,
            public_id: cloudinaryResult.public_id
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("Generate Image Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
