// Analytics utility functions for tracking usage and costs

import { collection, addDoc, serverTimestamp, setDoc, doc } from 'firebase/firestore';
import { db } from './firebaseConfig';

// Cost estimates (in USD)
export const COSTS = {
    'dalle-3': 0.04,
    'dalle-2': 0.016,
    'gemini-chat': 0.00005,
    'gemini-tts': 0,
    'elevenlabs-tts': 0.01
};

/**
 * Log API usage to Firestore
 */
export const logUsage = async (userId, email, type, metadata = {}) => {
    if (!userId || !email) {
        console.warn('Cannot log usage: missing userId or email');
        return;
    }

    try {
        // Determine cost
        let cost = 0;
        if (type === 'dalle') {
            cost = metadata.model === 'dall-e-3' ? COSTS['dalle-3'] : COSTS['dalle-2'];
        } else if (type === 'gemini_chat') {
            cost = COSTS['gemini-chat'];
        } else if (type === 'gemini_tts') {
            cost = COSTS['gemini-tts'];
        } else if (type === 'elevenlabs_tts') {
            cost = COSTS['elevenlabs-tts'];
        }

        // Log to usage_logs collection
        await addDoc(collection(db, 'usage_logs'), {
            userId,
            email,
            type,
            timestamp: serverTimestamp(),
            estimatedCost: cost,
            metadata
        });
    } catch (error) {
        console.error('Error logging usage:', error);
    }
};

/**
 * Track user on first login
 */
export const trackUser = async (userId, email, displayName = null) => {
    if (!userId || !email) {
        console.warn('Cannot track user: missing userId or email');
        return;
    }

    try {
        const userRef = doc(db, 'all_users', userId);
        const userSnap = await import('firebase/firestore').then(m => m.getDoc(userRef));

        const userData = {
            email,
            displayName,
            lastSeen: serverTimestamp(),
            createdAt: userSnap.exists() ? undefined : serverTimestamp()
        };

        // Initialize credits if user is new or doesn't have credits
        if (!userSnap.exists() || userSnap.data().credits === undefined) {
            userData.credits = 100;
        }

        // We use setDoc with merge: true to safe update
        // Note: undefined fields in userData (like createdAt if exists) won't overwrite due to how JS objects work 
        // IF we clean them, but Firestore setDoc might treat undefined as "delete" or "ignore" depending on settings?
        // Actually, with merge:true, it's safer to just build the object conditionally.

        const stringifiedData = JSON.parse(JSON.stringify(userData)); // quick clean of undefineds if any remain
        // actually better to just not add them.

        const finalData = {
            email,
            displayName,
            lastSeen: serverTimestamp()
        };

        if (!userSnap.exists()) {
            finalData.createdAt = serverTimestamp();
            finalData.credits = 100;
        } else if (userSnap.data().credits === undefined) {
            // Existing user but no credits? Give them the starter pack.
            finalData.credits = 100;
        }

        await setDoc(userRef, finalData, { merge: true });

    } catch (error) {
        console.error('Error tracking user:', error);
    }
};
