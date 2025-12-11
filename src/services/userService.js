import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';

/**
 * Check if the user has accepted the legal agreement terms.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export const checkTermsAccepted = async (userId) => {
    if (!userId) return false;
    try {
        const userRef = doc(db, 'all_users', userId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            return !!userSnap.data().termsAccepted;
        }
        return false;
    } catch (error) {
        console.error("Error checking terms acceptance:", error);
        return false;
    }
};

/**
 * Record that the user has accepted the legal agreement terms.
 * @param {string} userId
 * @returns {Promise<void>}
 */
export const acceptTerms = async (userId) => {
    if (!userId) return;
    try {
        const userRef = doc(db, 'all_users', userId);
        await setDoc(userRef, {
            termsAccepted: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error("Error accepting terms:", error);
        throw error;
    }
};
