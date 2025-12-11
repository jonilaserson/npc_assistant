import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import * as Sentry from "@sentry/react";
import { auth } from './firebaseConfig';
import { Login, AdminDashboard, LegalAgreementModal } from './components';
import NPC_Generator_Chatbot from './NPC_Generator_Chatbot';
import { trackUser } from './analytics';
import { checkTermsAccepted, acceptTerms } from './services';

const App = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showAdmin, setShowAdmin] = useState(false);
    const [impersonatedUserId, setImpersonatedUserId] = useState(null);
    const [impersonatedEmail, setImpersonatedEmail] = useState(null);
    const [showLegalModal, setShowLegalModal] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                // Check if user has accepted terms BEFORE showing app
                const accepted = await checkTermsAccepted(currentUser.uid);
                setShowLegalModal(!accepted);

                // Track user in Firestore
                await trackUser(currentUser.uid, currentUser.email, currentUser.displayName);

                // Set Sentry user context for error tracking
                if (Sentry.isEnabled()) {
                    Sentry.setUser({
                        id: currentUser.uid,
                        email: currentUser.email,
                        username: currentUser.displayName || currentUser.email
                    });
                }
            } else {
                // Clear Sentry user context on logout
                if (Sentry.isEnabled()) {
                    Sentry.setUser(null);
                }
            }

            setUser(currentUser);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Check URL for admin route
    useEffect(() => {
        const path = window.location.pathname;
        if (path === '/admin') {
            setShowAdmin(true);
        }
    }, []);

    const handleAdminToggle = (show) => {
        setShowAdmin(show);
        window.history.pushState({}, '', show ? '/admin' : '/');
    };

    const handleImpersonate = (userId, email) => {
        setImpersonatedUserId(userId);
        setImpersonatedEmail(email);
        setShowAdmin(false);
        window.history.pushState({}, '', '/');
    };

    const handleExitImpersonation = () => {
        setImpersonatedUserId(null);
        setImpersonatedEmail(null);
    };

    const handleTermsAccepted = async () => {
        if (user) {
            await acceptTerms(user.uid);
            setShowLegalModal(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
            </div>
        );
    }

    if (!user) {
        return <Login />;
    }

    // Show admin dashboard
    if (showAdmin) {
        return (
            <AdminDashboard
                user={user}
                onExit={() => handleAdminToggle(false)}
                onImpersonate={handleImpersonate}
            />
        );
    }

    // Show main app (with impersonation banner if active)
    return (
        <>
            {showLegalModal && (
                <LegalAgreementModal onAccept={handleTermsAccepted} />
            )}

            {impersonatedUserId && (
                <div className="fixed top-0 left-0 right-0 bg-red-600 text-white p-3 text-center z-50 shadow-lg">
                    <strong>⚠️ ADMIN MODE:</strong> Viewing as {impersonatedEmail}
                    <button
                        onClick={handleExitImpersonation}
                        className="ml-4 px-3 py-1 bg-white text-red-600 rounded hover:bg-gray-100 transition-colors font-semibold"
                    >
                        Exit Impersonation
                    </button>
                    <button
                        onClick={() => handleAdminToggle(true)}
                        className="ml-2 px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800 transition-colors"
                    >
                        Back to Admin
                    </button>
                </div>
            )}
            <div className={impersonatedUserId ? 'mt-14' : ''}>
                <NPC_Generator_Chatbot
                    user={user}
                    impersonatedUserId={impersonatedUserId}
                    onShowAdmin={() => handleAdminToggle(true)}
                />
            </div>
        </>
    );
};

export default App;
