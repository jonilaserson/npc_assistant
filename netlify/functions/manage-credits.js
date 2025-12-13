import { getFirestore, CORS_HEADERS, verifyAuth } from './utils/firebase';

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
            return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: CORS_HEADERS });
        }

        const requesterId = authUser.userId;
        const isAdmin = authUser.isAdmin;

        // 2. Parse Request
        const { action, amount, userId: targetUserId } = await req.json();

        // 3. Validation
        if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
            return new Response(JSON.stringify({ error: "Amount must be a positive integer" }), { status: 400, headers: CORS_HEADERS });
        }

        if (action !== 'add') {
            return new Response(JSON.stringify({ error: "Invalid action. Only 'add' is allowed." }), { status: 400, headers: CORS_HEADERS });
        }

        // 4. Access Control (Security)
        // If targetUserId is provided and different from requester, MUST be admin.
        // If targetUserId is NOT provided, default to requester.
        let finalTargetUserId = requesterId;

        if (targetUserId && targetUserId !== requesterId) {
            if (!isAdmin) {
                return new Response(JSON.stringify({ error: "Unauthorized: You can only modify your own credits." }), { status: 403, headers: CORS_HEADERS });
            }
            finalTargetUserId = targetUserId;
        }

        // 5. Execute Transaction
        const db = getFirestore();
        const userRef = db.collection('all_users').doc(finalTargetUserId);

        const newBalance = await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            let currentCredits = 0;
            if (userDoc.exists) {
                const data = userDoc.data();
                currentCredits = (typeof data.credits === 'number') ? data.credits : 0;
            } else {
                // For 'add', we can create the doc
            }

            let updatedCredits = currentCredits + amount;

            transaction.set(userRef, { credits: updatedCredits }, { merge: true });
            return updatedCredits;
        });

        return new Response(JSON.stringify({
            success: true,
            newBalance: newBalance,
            userId: finalTargetUserId
        }), {
            headers: CORS_HEADERS
        });

    } catch (error) {
        console.error("Manage Credits Function Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
};
