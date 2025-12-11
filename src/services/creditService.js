import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const USERS_COLLECTION = 'all_users';

/**
 * Get the current credit balance for a user.
 * Defaults to 100 if the field is missing.
 * @param {string} userId 
 * @returns {Promise<number>}
 */
export const getCredits = async (userId) => {
    if (!userId) return 0;
    try {
        const userRef = doc(db, USERS_COLLECTION, userId);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            // Default to 100 if undefined
            return typeof data.credits === 'number' ? data.credits : 100;
        }
        // If user doc doesn't exist yet, they technically have 100 "potential" credits 
        // that will be initialized on creation, but return 100 for display?
        // Or 0? Let's return 100 so the UI looks inviting, assuming they are logged in.
        return 100;
    } catch (error) {
        console.error("Error getting credits:", error);
        return 0;
    }
};

/**
 * Add credits to a user's balance.
 * @param {string} userId 
 * @param {number} amount 
 * @returns {Promise<number>} New balance
 */
export const addCredits = async (userId, amount) => {
    if (!userId || amount <= 0) return;
    const userRef = doc(db, USERS_COLLECTION, userId);

    try {
        const newBalance = await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) {
                // Should not happen for logged in users mostly, but auto-create?
                const initial = 100 + amount;
                transaction.set(userRef, { credits: initial, createdAt: serverTimestamp() }, { merge: true });
                return initial;
            }

            const data = userDoc.data();
            const current = typeof data.credits === 'number' ? data.credits : 100;
            const updated = current + amount;

            transaction.update(userRef, { credits: updated });
            return updated;
        });
        return newBalance;
    } catch (error) {
        console.error("Error adding credits:", error);
        throw error;
    }
};

/**
 * Deduct credits from a user's balance safely.
 * Throws an error if insufficient funds.
 * @param {string} userId 
 * @param {number} amount 
 * @returns {Promise<number>} New balance
 */
export const deductCredits = async (userId, amount) => {
    if (!userId || amount <= 0) return;
    const userRef = doc(db, USERS_COLLECTION, userId);

    try {
        const newBalance = await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) {
                throw new Error("User does not exist");
            }

            const data = userDoc.data();
            const current = typeof data.credits === 'number' ? data.credits : 100;

            if (current < amount) {
                throw new Error("Insufficient funds");
            }

            const updated = current - amount;
            transaction.update(userRef, { credits: updated });
            return updated;
        });
        return newBalance;
    } catch (error) {
        // Propagate error so UI can show message
        throw error;
    }
};
