import React, { useState, useEffect } from 'react';
import { getCredits, addCredits } from '../services/creditService';
import { Coins } from 'lucide-react';

const GoldStoreModal = ({ userId, onClose }) => {
    const [credits, setCredits] = useState(0);
    const [loading, setLoading] = useState(true);
    const [buying, setBuying] = useState(false);

    useEffect(() => {
        loadCredits();
    }, [userId]);

    const loadCredits = async () => {
        setLoading(true);
        const amount = await getCredits(userId);
        setCredits(amount);
        setLoading(false);
    };

    const handleBuyGold = async () => {
        setBuying(true);
        try {
            const newBalance = await addCredits(userId, 25);
            setCredits(newBalance);
        } catch (error) {
            console.error("Failed to add credits", error);
        } finally {
            setBuying(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 border border-yellow-600 rounded-xl shadow-2xl max-w-sm w-full p-6 relative overflow-hidden">
                {/* Decorative background glow */}
                <div className="absolute top-0 right-0 -mt-8 -mr-8 w-32 h-32 bg-yellow-500 rounded-full mix-blend-overlay filter blur-3xl opacity-20"></div>

                <h2 className="text-3xl font-bold text-yellow-400 mb-6 text-center" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Gold Store</h2>

                <div className="bg-gray-900 rounded-lg p-6 mb-6 text-center border border-gray-700">
                    <p className="text-gray-400 text-sm uppercase tracking-wider mb-1">Current Balance</p>
                    <div className="text-5xl font-extrabold text-white flex items-center justify-center gap-2">
                        {loading ? (
                            <span className="animate-pulse">...</span>
                        ) : (
                            <>
                                <>
                                    <>
                                        <Coins className="w-12 h-12 text-yellow-600 fill-yellow-400" /> <span className="text-white">{credits}</span>
                                    </>
                                </>
                            </>
                        )}
                    </div>
                </div>

                <div className="space-y-3 mb-8">
                    <h3 className="text-white font-semibold border-b border-gray-700 pb-2">Price List</h3>
                    <div className="flex justify-between items-center text-gray-300">
                        <span>Generare NPC</span>
                        <span className="text-yellow-400 font-mono">1 Gold</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-300">
                        <span>Audio Output</span>
                        <span className="text-yellow-400 font-mono">2 Gold</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-300">
                        <span>Picture Generation</span>
                        <span className="text-yellow-400 font-mono">5 Gold</span>
                    </div>
                </div>

                <button
                    onClick={handleBuyGold}
                    disabled={buying || loading}
                    className="w-full py-3 px-4 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-bold rounded-lg shadow-lg transform transition hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {buying ? (
                        <>Adding...</>
                    ) : (
                        <>Get more Gold! <span className="text-xs bg-black bg-opacity-20 px-2 py-0.5 rounded-full text-yellow-900">+25</span></>
                    )}
                </button>

                <button
                    onClick={onClose}
                    className="absolute top-2 right-2 text-gray-500 hover:text-white p-2"
                    aria-label="Close"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default GoldStoreModal;
