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
        // Add/update user in all_users collection
        await setDoc(doc(db, 'all_users', userId), {
            email,
            displayName,
            lastSeen: serverTimestamp(),
            createdAt: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error('Error tracking user:', error);
    }
};
