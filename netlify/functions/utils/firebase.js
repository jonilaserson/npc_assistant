import admin from 'firebase-admin';

let isInitialized = false;

const ADMIN_EMAIL = 'jonilaserson@gmail.com';

export const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
};

export const initializeFirebase = () => {
    if (admin.apps.length > 0) {
        return admin;
    }

    try {
        const privateKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
            ? process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
            : undefined;

        const serviceAccount = {
            projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'npc-assistant-c2b5b',
            clientEmail: process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL,
            privateKey: privateKey,
        };

        if (privateKey) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            isInitialized = true;
            console.log('Firebase Admin initialized successfully');
        } else {
            console.error("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY missing");
        }
    } catch (error) {
        console.error("Firebase Admin Init Error:", error);
    }

    return admin;
};

export const getAuth = () => {
    if (!isInitialized) initializeFirebase();
    return admin.auth();
};

export const getFirestore = () => {
    if (!isInitialized) initializeFirebase();
    return admin.firestore();
};

/**
 * Verifies the Bearer token and returns user details.
 * returns { userId, email, isAdmin }
 * throws Error if unauthorized
 */
export const verifyAuth = async (request) => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Unauthorized: Missing Bearer token");
    }

    const idToken = authHeader.split("Bearer ")[1];
    try {
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const email = decodedToken.email;
        return {
            userId: decodedToken.uid,
            email: email,
            isAdmin: email === ADMIN_EMAIL // Simple email check matching firestore.rules
        };
    } catch (authError) {
        console.error("Token verification failed:", authError);
        throw new Error("Unauthorized: Invalid token");
    }
};

/**
 * Checks if the user has enough credits.
 * returns boolean
 */
export const hasEnoughCredits = async (userId, cost) => {
    try {
        const db = getFirestore();
        const userRef = db.collection('all_users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) return false;

        const data = userDoc.data();
        const credits = (typeof data.credits === 'number') ? data.credits : 0;

        return credits >= cost;
    } catch (error) {
        console.error("Error checking credits:", error);
        return false;
    }
};

/**
 * Atomically deducts credits from a user.
 * Clamps balance at 0.
 * returns { success: boolean, newBalance: number }
 */
export const deductCredits = async (userId, cost) => {
    const db = getFirestore();
    const userRef = db.collection('all_users').doc(userId);

    try {
        const newBalance = await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            let currentCredits = 0;
            if (userDoc.exists) {
                const data = userDoc.data();
                currentCredits = (typeof data.credits === 'number') ? data.credits : 0;
            } else {
                // If user doc doesn't exist, create it with 0 credits
                transaction.set(userRef, { credits: 0 }, { merge: true });
                return 0;
            }

            // Deduct cost, clamp at 0
            let updatedCredits = currentCredits - cost;
            if (updatedCredits < 0) updatedCredits = 0;

            transaction.update(userRef, { credits: updatedCredits });
            return updatedCredits;
        });

        return { success: true, newBalance };
    } catch (error) {
        console.error("Error deducting credits:", error);
        throw error;
    }
};

/**
 * Validates that the request is authenticated and has enough credits.
 * Returns either { user } OR { errorResponse }.
 * Usage:
 * const { user, errorResponse } = await requireAuthAndCredits(req, cost);
 * if (errorResponse) return errorResponse;
 */
export const requireAuthAndCredits = async (req, cost) => {
    try {
        const user = await verifyAuth(req);
        const hasCredits = await hasEnoughCredits(user.userId, cost);
        if (!hasCredits) {
            return { errorResponse: new Response(JSON.stringify({ error: "Insufficient funds" }), { status: 403, headers: CORS_HEADERS }) };
        }
        return { user };
    } catch (e) {
        return { errorResponse: new Response(JSON.stringify({ error: e.message }), { status: 401, headers: CORS_HEADERS }) };
    }
};

export default admin;
