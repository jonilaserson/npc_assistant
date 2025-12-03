import crypto from 'crypto';

export default async (req, context) => {
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const { publicId } = await req.json();
        const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
        const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret) {
            return new Response(JSON.stringify({ error: "Missing Server Configuration" }), { status: 500 });
        }

        const timestamp = Math.round(Date.now() / 1000);
        const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}${cloudinaryApiSecret}`;
        const signature = crypto.createHash('sha256').update(paramsToSign).digest('hex');

        const formData = new FormData();
        formData.append('public_id', publicId);
        formData.append('api_key', cloudinaryApiKey);
        formData.append('timestamp', timestamp.toString());
        formData.append('signature', signature);

        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/destroy`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.result !== 'ok') {
            throw new Error("Cloudinary delete failed: " + JSON.stringify(result));
        }

        return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("Delete Image Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
