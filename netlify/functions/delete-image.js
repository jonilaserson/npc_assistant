import crypto from 'crypto';
import { CORS_HEADERS, verifyAuth, getFirestore } from './utils/firebase';

export default async (req, context) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
        // 1. Verify Authentication
        let authUser;
        try {
            authUser = await verifyAuth(req);
        } catch (e) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS_HEADERS });
        }

        const userId = authUser.userId;

        // 2. Parse Request
        const { publicId } = await req.json();

        if (!publicId) {
            return new Response(JSON.stringify({ error: "Missing publicId" }), { status: 400, headers: CORS_HEADERS });
        }

        // 3. Verify Ownership
        // Check if any of THIS user's NPCs actually own this image
        const db = getFirestore();
        const npcsRef = db.collection(`users/${userId}/npcs`);
        const querySnapshot = await npcsRef.where('cloudinaryImageId', '==', publicId).limit(1).get();

        if (querySnapshot.empty) {
            console.warn(`Unauthorized deletion attempt: User ${userId} tried to delete ${publicId} but does not own it.`);
            return new Response(JSON.stringify({ error: "Forbidden: You do not own this image." }), { status: 403, headers: CORS_HEADERS });
        }

        // 4. Cloudinary Deletion
        const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
        const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret) {
            return new Response(JSON.stringify({ error: "Missing Server Configuration" }), { status: 500, headers: CORS_HEADERS });
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
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });

    } catch (error) {
        console.error("Delete Image Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
