import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import {
    TIPS,
    getStructuredNPCPrompt,
    getSceneGenerationPrompt,
    getImageGenerationPrompt,
    getImageSystemInstruction,
    getImageFallbackPrompt,
    getRoleplaySystemPrompt,
    getFieldRegenerationPrompt,
    getFieldExpansionPrompt,
    getVoiceRegenerationPrompt
} from './constants/prompts';
import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { auth, db, storage } from './firebaseConfig';
import { Loader2, Zap, Brain, Wand2, MessageSquare, List, Send, Volume2, VolumeX, User, ChevronsDown, ChevronsUp, RefreshCw, Trash2, X, ChevronLeft, ChevronRight, Plus, GripVertical, Check, RotateCcw, Edit2, Eye, EyeOff, Sparkles, Maximize2, Play, Share2, AlertTriangle, Coins } from 'lucide-react';
import { FeedbackButton, GoldStoreModal } from './components';
import { logUsage } from './analytics';
import * as Sentry from "@sentry/react";
import { getCredits, deductCredits } from './services/creditService';
import { useEscapeKey } from './hooks/useEscapeKey';

const magicalStyles = `
@keyframes magic-wiggle {
    0%, 100% { transform: rotate(-3deg) scale(1); }
    50% { transform: rotate(3deg) scale(1.1); }
}
@keyframes magic-glow {
    0%, 100% { filter: drop-shadow(0 0 2px rgba(168, 85, 247, 0.4)); color: #9333ea; }
    50% { filter: drop-shadow(0 0 8px rgba(236, 72, 153, 0.8)); color: #db2777; }
}
@keyframes sparkle-fade {
    0%, 100% { opacity: 0; transform: scale(0); }
    50% { opacity: 1; transform: scale(1); }
}
.animate-magic {
    animation: magic-wiggle 0.5s ease-in-out infinite, magic-glow 1.5s ease-in-out infinite;
}
.animate-sparkle-1 {
    animation: sparkle-fade 1s ease-in-out infinite;
}
.animate-sparkle-2 {
    animation: sparkle-fade 1s ease-in-out infinite 0.5s;
}
@keyframes gold-pulse {
    0% { transform: scale(1); filter: brightness(1); }
    50% { transform: scale(1.1); filter: brightness(1.3) drop-shadow(0 0 5px gold); }
    100% { transform: scale(1); filter: brightness(1); }
}
.animate-gold-pulse {
    animation: gold-pulse 0.5s ease-in-out;
}
`;

// --- Global Variable Access (MANDATORY) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;


import { AVAILABLE_VOICES, getVoiceById } from './constants/voices';
import { fetchWithBackoff } from './utils/apiUtils';
import { textToSpeech, regenerateVoice, selectVoice, selectVoiceFromCandidates } from './services/audioService';
import {
    generateStructuredNPC,
    generateScene,
    generateNPCImage,
    getNPCResponse,
    parseGoalFromScene,
    regenerateNPCField,
    expandNPCField
} from './services/aiGenerator';






// --- Firebase Setup and Custom Hooks ---

// Path constants
const NPC_COLLECTION_NAME = 'npcs';
const SHARED_NPC_COLLECTION_NAME = 'shared_npcs';
const npcCollectionPath = (appId, userId) => `users/${userId}/${NPC_COLLECTION_NAME}`;
const sharedNpcCollectionPath = (appId, userId) => `users/${userId}/${SHARED_NPC_COLLECTION_NAME}`;

// Helper function to get userId by email
const getUserIdByEmail = async (db, email) => {
    try {
        const usersRef = collection(db, 'all_users');
        const q = query(usersRef, where('email', '==', email));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return null;
        }

        return snapshot.docs[0].id;
    } catch (error) {
        console.error("Error getting user by email:", error);
        return null;
    }
};

// Helper function to share an NPC
const shareNPC = async (db, npc, senderUserId, senderEmail, recipientEmail, includeFirstScene) => {
    try {
        // Get recipient's userId
        const recipientUserId = await getUserIdByEmail(db, recipientEmail);

        if (!recipientUserId) {
            throw new Error(`No user found with email: ${recipientEmail}`);
        }

        if (recipientUserId === senderUserId) {
            throw new Error("You cannot share an NPC with yourself");
        }

        // Check if NPC has a first scene
        let firstScene = null;
        if (includeFirstScene && npc.chats && npc.chats.length > 0 && npc.chats[0].role === 'scene') {
            firstScene = npc.chats[0];
        }

        // Create the shared NPC data
        const sharedNpcData = {
            // Copy all NPC fields
            name: npc.name,
            description: npc.description,
            structuredData: npc.structuredData,
            imageUrl: npc.imageUrl,
            cloudinaryImageId: npc.cloudinaryImageId,

            // Add sharing metadata
            isSharedNPC: true,
            sharedFrom: {
                userId: senderUserId,
                userEmail: senderEmail,
                timestamp: new Date().toISOString()
            },
            sharedWithScene: includeFirstScene && firstScene !== null,
            protectedFirstScene: includeFirstScene && firstScene !== null,

            // Initialize chats with first scene if included
            chats: firstScene ? [firstScene] : [],

            // Set timestamps
            createdAt: new Date().toISOString(),
            ownerId: recipientUserId,
        };

        // Add to recipient's shared_npcs collection
        const sharedNpcRef = doc(collection(db, sharedNpcCollectionPath(appId, recipientUserId)));
        await setDoc(sharedNpcRef, { ...sharedNpcData, id: sharedNpcRef.id });

        return { success: true, recipientUserId };
    } catch (error) {
        console.error("Error sharing NPC:", error);
        throw error;
    }
};





function useNPCs(db, userId, isAuthReady) {
    const [npcs, setNpcs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthReady || !userId) {
            setLoading(true);
            return;
        }

        if (!db) {
            // Demo mode or no DB connection
            setLoading(false);
            return;
        }

        const path = npcCollectionPath(appId, userId);
        const q = query(collection(db, path), orderBy('createdAt', 'desc'));

        setLoading(false);
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const npcList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setNpcs(npcList);
        }, (error) => {
            console.error("Error listening to NPCs:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady]);

    return { npcs, loading };
}

function useSharedNPCs(db, userId, isAuthReady) {
    const [sharedNpcs, setSharedNpcs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthReady || !userId) {
            setLoading(true);
            return;
        }

        if (!db) {
            // Demo mode or no DB connection
            setLoading(false);
            return;
        }

        const path = sharedNpcCollectionPath(appId, userId);
        const q = query(collection(db, path), orderBy('createdAt', 'desc'));

        setLoading(false);
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const npcList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setSharedNpcs(npcList);
        }, (error) => {
            console.error("Error listening to shared NPCs:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady]);

    return { sharedNpcs, loading };
}

// --- Editable Field Component ---

const EditableField = ({ label, value, displayValue, onSave, onRegenerate, onExpand, type = 'text', options = [], className = '', hideLabel = false, textClassName = '', stayInModeAfterRegenerate = false, onEditStateChange, rows = 6, disabled = false }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [tempValue, setTempValue] = useState(value);
    const [isSaving, setIsSaving] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const selectRef = useRef(null);

    useEffect(() => {
        if (onEditStateChange) {
            onEditStateChange(isEditing);
        }
    }, [isEditing, onEditStateChange]);

    useEffect(() => {
        setTempValue(value);
    }, [value]);

    // Auto-open select dropdown when entering edit mode
    useEffect(() => {
        if (isEditing && type === 'select' && selectRef.current) {
            // Small delay to ensure the select is rendered and focused
            setTimeout(() => {
                if (selectRef.current) {
                    selectRef.current.focus();
                    // Use showPicker() if available (modern browsers), otherwise try click
                    if (typeof selectRef.current.showPicker === 'function') {
                        try {
                            selectRef.current.showPicker();
                        } catch (e) {
                            // showPicker can throw in some contexts, fallback to click
                            selectRef.current.click();
                        }
                    } else {
                        // Fallback for older browsers
                        const event = new MouseEvent('mousedown', { bubbles: true });
                        selectRef.current.dispatchEvent(event);
                    }
                }
            }, 50);
        }
    }, [isEditing, type]);

    const handleSave = async () => {
        if (tempValue === value) {
            setIsEditing(false);
            return;
        }
        setIsSaving(true);
        try {
            await onSave(tempValue);
            setIsEditing(false);
        } catch (error) {
            console.error("Failed to save:", error);
            // Optionally show error state
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setTempValue(value);
        setIsEditing(false);
    };

    const handleRegenerate = async (e) => {
        e.stopPropagation(); // Prevent toggling edit mode if clicked outside
        if (!onRegenerate) return;

        setIsRegenerating(true);
        try {
            const newValue = await onRegenerate();
            if (newValue) {
                setTempValue(newValue);

                // For select fields, auto-save the new value
                // For textarea/text fields, enter edit mode to review unless stayInModeAfterRegenerate is true
                if (type === 'select') {
                    // Auto-save for select fields
                    try {
                        await onSave(newValue);
                        // Don't enter edit mode, just update the value
                    } catch (error) {
                        console.error("Failed to save regenerated value:", error);
                        // On error, enter edit mode to let user try again
                        setIsEditing(true);
                    }
                } else {
                    if (stayInModeAfterRegenerate) {
                        // Automatically save and stay in view mode
                        try {
                            await onSave(newValue);
                        } catch (error) {
                            console.error("Failed to save regenerated value:", error);
                            setIsEditing(true);
                        }
                    } else {
                        // Enter edit mode to review
                        setIsEditing(true);
                    }
                }
            }
        } catch (error) {
            console.error("Regeneration failed:", error);
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleExpand = async (e) => {
        e.stopPropagation();
        if (!onExpand) return;

        setIsExpanding(true);
        try {
            const newValue = await onExpand();
            if (newValue) {
                setTempValue(newValue);
                setIsEditing(true);
            }
        } catch (error) {
            console.error("Expansion failed:", error);
        } finally {
            setIsExpanding(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && (type === 'text' || type === 'select')) {
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    if (isEditing) {
        return (
            <div className={`p-2 bg-white rounded-lg border border-indigo-300 shadow-sm w-full ${className}`}>
                <style>{magicalStyles}</style>
                <div className="flex items-center justify-between mb-1">
                    {!hideLabel && <label className="block text-xs font-bold text-indigo-700">{label}</label>}
                    <div className="flex items-center space-x-1">
                        {onExpand && (
                            <button
                                onClick={handleExpand}
                                disabled={isExpanding || isRegenerating || isSaving}
                                className={`p-0.5 rounded transition-colors ${isExpanding ? 'cursor-default' : 'text-blue-600 hover:text-blue-800'}`}
                                title="Expand this field"
                            >
                                {isExpanding ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Maximize2 className="w-3 h-3" />
                                )}
                            </button>
                        )}
                        {onRegenerate && (
                            <div className="relative">
                                <button
                                    onClick={handleRegenerate}
                                    disabled={isRegenerating || isSaving}
                                    className={`p-0.5 rounded transition-colors ${isRegenerating ? 'cursor-default' : 'text-purple-600 hover:text-purple-800'}`}
                                    title="Regenerate this field"
                                >
                                    {isRegenerating ? (
                                        <div className="relative">
                                            <Wand2 className="w-4 h-4 animate-magic" />
                                            <Sparkles className="w-2 h-2 text-yellow-400 absolute -top-1 -right-1 animate-sparkle-1" />
                                            <Sparkles className="w-2 h-2 text-cyan-400 absolute -bottom-1 -left-1 animate-sparkle-2" />
                                        </div>
                                    ) : (
                                        <Wand2 className="w-3 h-3" />
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-start space-x-2">
                    {type === 'textarea' ? (
                        <textarea
                            value={tempValue}
                            onChange={(e) => setTempValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="flex-1 p-2 border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                            style={{ fontSize: '16px' }}
                            rows={rows}
                            autoFocus
                        />
                    ) : type === 'select' ? (
                        <select
                            ref={selectRef}
                            value={tempValue}
                            onChange={async (e) => {
                                const newValue = e.target.value;
                                setTempValue(newValue);
                                // Auto-save for select fields - no confirmation needed
                                if (newValue !== value) {
                                    setIsSaving(true);
                                    try {
                                        await onSave(newValue);
                                        setIsEditing(false);
                                    } catch (error) {
                                        console.error("Failed to save:", error);
                                    } finally {
                                        setIsSaving(false);
                                    }
                                } else {
                                    // Same value selected - just close edit mode
                                    setIsEditing(false);
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    handleCancel();
                                }
                            }}
                            onBlur={() => {
                                // If user clicks away without changing, just close
                                if (tempValue === value) {
                                    setIsEditing(false);
                                }
                            }}
                            className="flex-1 p-2 text-sm border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 max-w-full overflow-hidden text-ellipsis"
                            autoFocus
                            disabled={isSaving}
                        >
                            {options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            type="text"
                            value={tempValue}
                            onChange={(e) => setTempValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleSave();
                                } else if (e.key === 'Escape') {
                                    handleCancel();
                                }
                            }}
                            className={`flex-1 p-2 border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 break-words ${textClassName || 'text-sm'}`}
                            autoFocus
                            disabled={isSaving}
                        />
                    )}

                    {/* Vertical Pill Action Buttons - Only show for textarea */}
                    {type === 'textarea' && (
                        <div className="flex flex-col items-center bg-white shadow-sm border border-gray-200 rounded-full overflow-hidden ml-1">
                            <button
                                onClick={handleSave}
                                disabled={isSaving || isRegenerating || isExpanding}
                                className="p-2 text-green-600 hover:bg-green-50 transition-colors focus:outline-none"
                                title="Save"
                            >
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <div className="h-px w-4 bg-gray-200"></div>
                            <button
                                onClick={handleCancel}
                                disabled={isSaving || isRegenerating || isExpanding}
                                className="p-2 text-gray-500 hover:bg-gray-50 transition-colors focus:outline-none"
                                title="Cancel"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={disabled ? undefined : () => setIsEditing(true)}
            className={`group relative p-2 rounded-lg ${disabled ? 'cursor-default' : 'hover:bg-indigo-100 cursor-pointer'} transition-colors ${className}`}
            title={disabled ? "" : "Click to edit"}
        >
            <style>{magicalStyles}</style>
            <div className="flex items-center justify-between mb-0.5">
                {!hideLabel && <p className="text-xs font-bold text-indigo-700">{label}</p>}
                <div className="flex items-center space-x-1">
                    {!disabled && onExpand && (
                        <div className="relative">
                            <button
                                onClick={handleExpand}
                                disabled={isExpanding}
                                className={`p-1 rounded transition-all ${isExpanding ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 text-blue-600 hover:text-blue-800'}`}
                                title="Expand"
                            >
                                {isExpanding ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Maximize2 className="w-3 h-3" />
                                )}
                            </button>
                        </div>
                    )}
                    {!disabled && onRegenerate && (
                        <div className="relative">
                            <button
                                onClick={handleRegenerate}
                                disabled={isRegenerating}
                                className={`p-1 rounded transition-all ${isRegenerating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 text-purple-600 hover:text-purple-800'}`}
                                title="Regenerate"
                            >
                                {isRegenerating ? (
                                    <div className="relative">
                                        <Wand2 className="w-4 h-4 animate-magic" />
                                        <Sparkles className="w-2 h-2 text-yellow-400 absolute -top-1 -right-1 animate-sparkle-1" />
                                        <Sparkles className="w-2 h-2 text-cyan-400 absolute -bottom-1 -left-1 animate-sparkle-2" />
                                    </div>
                                ) : (
                                    <Wand2 className="w-3 h-3" />
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <p className={`whitespace-pre-wrap break-words ${textClassName || 'text-sm text-gray-800'}`}>{displayValue || value || <span className="text-gray-400 italic">Empty</span>}</p>
            {!disabled && !onRegenerate && <Edit2 className="absolute top-2 right-2 w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />}
        </div>
    );
};

// --- NPC Management Components ---

const Button = ({ children, onClick, disabled = false, className = '', icon: Icon, loading = false, variant = 'primary' }) => {
    let variantStyles = '';

    if (variant === 'primary') {
        variantStyles = disabled
            ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500';
    } else if (variant === 'custom') {
        variantStyles = disabled ? 'opacity-50 cursor-not-allowed' : '';
    }

    return (
        <button
            onClick={onClick}
            disabled={disabled || loading}
            className={`flex items-center justify-center px-4 py-2 font-semibold transition-all duration-200 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 
                ${variantStyles}
                ${className}`}
        >
            {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : Icon && <Icon className="w-5 h-5 mr-2" />}
            {children}
        </button>
    );
};

const LoadingIndicator = () => (
    <div className="flex items-center justify-center p-8 text-indigo-500">
        <Loader2 className="w-8 h-8 mr-3 animate-spin" />
        <span className="text-lg font-medium">Loading Data...</span>
    </div>
);

const NpcCreation = ({ db, userId, onNpcCreated, handleDeductCredits, onCancel }) => {
    const [rawDescription, setRawDescription] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [status, setStatus] = useState('');

    // ESC key handler
    useEscapeKey(onCancel);

    const handleGenerateNPC = async () => {
        if (!rawDescription.trim()) {
            setStatus("Please enter a description first.");
            return;
        }
        setIsGenerating(true);

        setStatus('Generating NPC profile...');

        try {
            // Check and deduct credits (1 Gold)
            await handleDeductCredits(1);

            // Step 1: Generate structured data
            const structuredData = await generateStructuredNPC(rawDescription);
            const npcName = structuredData.name || 'Unnamed NPC';

            // Step 2: Save to database (without image initially)
            setStatus('Saving NPC...');
            const newNpcRef = doc(collection(db, npcCollectionPath(appId, userId)));

            const npcData = {
                id: newNpcRef.id,
                name: npcName,
                description: rawDescription,
                structuredData: structuredData,
                imageUrl: null,
                cloudinaryImageId: null,
                chats: [],
                createdAt: new Date().toISOString(),
                ownerId: userId,
            };

            await setDoc(newNpcRef, npcData);
            setStatus(`NPC "${npcName}" created successfully!`);

            // Log NPC creation for analytics
            const userEmail = auth.currentUser?.email || 'unknown';
            await logUsage(userId, userEmail, 'npc_created', {
                npcId: newNpcRef.id,
                npcName: npcName
            });

            // Step 3: Skip initial image generation (as per new safeguard)
            // We leave imageUrl as null so the user sees the "Image not saved" placeholder.

            // Clear form and notify parent with the new NPC ID
            setRawDescription('');
            onNpcCreated(newNpcRef.id);
        } catch (e) {
            setStatus(`Error: ${e.message}`);
            if (e.message === "Insufficient funds") {
                alert("Insufficient Gold! Please visit the Gold Store to get more.");
            }
            console.error('Error creating NPC:', e);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999] p-4"
            onClick={onCancel}
        >
            <div
                className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-white border-b border-gray-200 p-4 md:p-6 flex items-center justify-between">
                    <h2 className="flex items-center text-2xl font-bold text-indigo-700">
                        <Brain className="w-6 h-6 mr-2" />
                        Create New NPC Profile
                    </h2>
                    <button
                        onClick={onCancel}
                        className="text-gray-500 hover:text-gray-700 p-2"
                        aria-label="Close"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="p-4 md:p-6 space-y-6">
                    <div className="p-4 space-y-4 rounded-lg bg-gray-50">
                        <label className="block text-sm font-medium text-gray-700">
                            Raw NPC Description (Copy-Paste your notes here):
                        </label>
                        <textarea
                            value={rawDescription}
                            onChange={(e) => setRawDescription(e.target.value)}
                            onKeyDown={(e) => {
                                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    handleGenerateNPC();
                                }
                            }}
                            rows="6"
                            placeholder="E.g., An elven librarian named Elara. She is frail, old and wears thick glasses. Constantly dusts her shelves. Secretly a member of the resistance."
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        />
                        <Button
                            onClick={handleGenerateNPC}
                            loading={isGenerating}
                            icon={Zap}
                            disabled={!rawDescription.trim()}
                            className="w-full"
                        >
                            Generate NPC
                        </Button>
                    </div>

                    {status && (
                        <div className={`p-3 text-sm rounded-lg ${status.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            Status: {status}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- Confirmation Modal ---
const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center space-x-3 text-amber-600">
                    <AlertTriangle className="w-8 h-8" />
                    <h3 className="text-xl font-bold text-gray-900">{title}</h3>
                </div>
                <p className="text-gray-600 leading-relaxed md:leading-normal">
                    {message}
                </p>
                <div className="flex justify-end space-x-3 pt-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => { onConfirm(); onClose(); }}
                        className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors font-medium shadow-sm"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Chat Interface Components ---

const ChatBubble = ({ message, npcName, isSpeaking, onSpeakClick, onSetNextScene, onRollbackToScene, showGoalButtons, currentTip, isProtected }) => {
    const isNpc = message.role === 'npc';
    const isScene = message.role === 'scene';
    const isGoalAchieved = message.role === 'goal_achieved';

    // Function to extract only the dialogue for display/TTS purposes
    const getDialogueText = (text) => text.replace(/ *\[[\s\S]*?\] */g, '').trim();

    if (isScene) {
        return (
            <div className="flex w-full justify-center my-4">
                <div className="w-[80%] max-w-lg p-4 rounded-lg shadow-sm text-left border-2 bg-indigo-50 border-indigo-500 relative">
                    <p className="text-xs font-bold uppercase tracking-wider mb-1 opacity-70 text-indigo-700">
                        Scene {isProtected && <span className="text-xs font-normal">(Protected)</span>}
                    </p>
                    <p className="font-mono text-sm italic text-gray-900 whitespace-pre-wrap">{message.text}</p>
                    {!isProtected && (
                        <button
                            onClick={onRollbackToScene}
                            className="absolute bottom-2 right-2 p-1.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                            title="Rollback to this scene"
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (isGoalAchieved) {
        return (
            <div className="flex w-full justify-center my-4">
                <div className="w-[80%] max-w-lg p-6 rounded-lg shadow-lg text-center border-2 bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-400 animate-in fade-in zoom-in-95 duration-300 relative">
                    <div className="flex items-center justify-center mb-3">
                        <div className="w-12 h-12 rounded-full bg-yellow-400 flex items-center justify-center animate-bounce">
                            <span className="text-2xl">🎉</span>
                        </div>
                    </div>
                    <p className="text-lg font-bold text-yellow-800 mb-2">
                        Scene Goal Achieved!
                    </p>
                    <p className="text-sm text-gray-700 mb-4">
                        "{message.text}"
                    </p>
                    {showGoalButtons && (
                        <div className="flex justify-center mb-3">
                            <button
                                onClick={onSetNextScene}
                                className="flex items-center justify-center px-6 py-3 font-semibold transition-all duration-200 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 bg-purple-600 hover:bg-purple-700 text-white focus:ring-purple-500"
                            >
                                <Wand2 className="w-5 h-5 mr-2" />
                                Set Next Scene!
                            </button>
                        </div>
                    )}
                    {currentTip && (
                        <p className="text-xs text-gray-600 bg-white bg-opacity-60 py-1 px-3 rounded-full inline-block">
                            Tip: {currentTip.text} <code className="text-indigo-600 font-bold">{currentTip.code}</code>{currentTip.suffix && ` ${currentTip.suffix}`}
                        </p>
                    )}
                    <button
                        onClick={onRollbackToScene}
                        className="absolute bottom-2 right-2 p-1.5 text-yellow-600 hover:text-yellow-800 hover:bg-yellow-100 rounded-full transition-colors"
                        title="Rollback to this point"
                    >
                        <RotateCcw className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex w-full ${isNpc ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-xl p-4 rounded-xl shadow-md ${isNpc
                ? 'bg-gray-100 text-gray-800 rounded-tl-none border border-gray-200'
                : 'bg-indigo-600 text-white rounded-br-none'
                }`}>
                <p className="text-xs font-semibold mb-1 opacity-70">
                    {isNpc ? npcName : 'GM/Player'}
                </p>
                <p className="whitespace-pre-wrap">{message.text}</p>

                {isNpc && getDialogueText(message.text) && (
                    <div className="flex items-center justify-end mt-2">
                        <button
                            onClick={() => onSpeakClick(message.text)}
                            // isSpeaking is set to true when audio is playing or loading, so it acts as the stop button.
                            className={`p-1 rounded-full transition-colors duration-200 ${isSpeaking
                                ? 'bg-red-200 text-red-600 hover:bg-red-300'
                                : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                                }`}
                            title={isSpeaking ? "Click to stop speaking" : "Click to hear dialogue"}
                        >
                            {isSpeaking ? <X className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                        {isSpeaking && <span className="ml-2 text-xs text-red-600">Stop</span>}
                    </div>
                )}
            </div>
        </div>
    );
};

const ImageModal = ({ isOpen, onClose, imageUrl, altText }) => {
    useEscapeKey(onClose, isOpen);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80" onClick={onClose}>
            <div className="relative max-w-7xl max-h-screen p-2" onClick={e => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-white bg-black bg-opacity-50 rounded-full hover:bg-opacity-75"
                >
                    <X className="w-6 h-6" />
                </button>
                <img
                    src={imageUrl}
                    alt={altText}
                    className="object-contain max-w-full max-h-[90vh] rounded-lg shadow-2xl"
                />
            </div>
        </div>
    );
};



const SceneModal = ({
    isOpen,
    onClose,
    sceneText,
    isGenerating,
    isEditing,
    onEdit,
    onSave,
    onRegenerate,
    onStartWithScene
}) => {
    useEscapeKey(onClose, isOpen);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4" onClick={onClose}>
            <div
                className="w-full bg-white rounded-xl shadow-2xl border-2 border-indigo-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                style={{ maxWidth: 'min(672px, 85vw)' }}
                onClick={e => e.stopPropagation()}
            >
                {isGenerating ? (
                    <div className="p-12 flex flex-col items-center text-indigo-600">
                        <style>{magicalStyles}</style>
                        <div className="relative mb-4">
                            <Wand2 className="w-12 h-12 animate-magic" />
                            <Sparkles className="w-6 h-6 text-yellow-400 absolute -top-2 -right-2 animate-sparkle-1" />
                            <Sparkles className="w-6 h-6 text-cyan-400 absolute -bottom-2 -left-2 animate-sparkle-2" />
                        </div>
                        <h3 className="text-xl font-bold">Setting the Scene...</h3>
                        <p className="text-sm text-indigo-400">Consulting the Dungeon Master...</p>
                    </div>
                ) : (
                    <>
                        <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex items-center justify-between">
                            <h3 className="font-bold text-indigo-800 flex items-center">
                                <Sparkles className="w-4 h-4 mr-2 text-indigo-500" />
                                New Scene
                            </h3>
                            <div className="flex items-center gap-2">
                                {!isEditing && (
                                    <>
                                        <button
                                            onClick={onRegenerate}
                                            className="p-1.5 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                                            title="Regenerate Scene"
                                        >
                                            <Wand2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={onClose}
                                            className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-lg transition-colors"
                                            title="Close"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="p-4 text-left">
                            <EditableField
                                label="Scene Description"
                                value={sceneText}
                                onSave={onSave}
                                type="textarea"
                                hideLabel={true}
                                textClassName="min-h-[150px]"
                                rows={10}
                                stayInModeAfterRegenerate={true}
                                onEditStateChange={onEdit}
                            />
                        </div>

                        {!isEditing && (
                            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end items-center gap-4">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={onStartWithScene}
                                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center"
                                >
                                    <Play className="w-4 h-4 mr-2" />
                                    Start Scene
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

const ShareNPCModal = ({ isOpen, onClose, npc, db, userId, userEmail }) => {
    const [recipientEmail, setRecipientEmail] = useState('');
    const [includeFirstScene, setIncludeFirstScene] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [status, setStatus] = useState('');
    const [statusType, setStatusType] = useState(''); // 'success' or 'error'

    const hasFirstScene = npc?.chats?.length > 0 && npc.chats[0].role === 'scene';

    useEffect(() => {
        if (isOpen) {
            // Reset state when modal opens
            setRecipientEmail('');
            setIncludeFirstScene(false);
            setStatus('');
            setStatusType('');
        }
    }, [isOpen]);

    useEscapeKey(onClose, isOpen && !isSharing);

    const handleShare = async () => {
        const email = recipientEmail.trim().toLowerCase();

        if (!email) {
            setStatus('Please enter an email address');
            setStatusType('error');
            return;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            setStatus('Please enter a valid email address');
            setStatusType('error');
            return;
        }

        setIsSharing(true);
        setStatus('Sharing NPC...');
        setStatusType('');

        try {
            await shareNPC(db, npc, userId, userEmail, email, includeFirstScene);
            setStatus(`Successfully shared "${npc.name}" with ${email}!`);
            setStatusType('success');

            // Log usage
            await logUsage(userId, userEmail, 'npc_shared', {
                npcId: npc.id,
                npcName: npc.name,
                recipientEmail: email,
                includeFirstScene
            });

            // Close modal after 2 seconds
            setTimeout(() => {
                onClose();
            }, 2000);
        } catch (error) {
            console.error('Error sharing NPC:', error);
            setStatus(error.message || 'Failed to share NPC');
            setStatusType('error');
        } finally {
            setIsSharing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4" onClick={onClose}>
            <div
                className="w-full max-w-md bg-white rounded-xl shadow-2xl border-2 border-indigo-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex items-center justify-between">
                    <h3 className="font-bold text-indigo-800 flex items-center">
                        <Share2 className="w-4 h-4 mr-2 text-indigo-500" />
                        Share "{npc?.name}"
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-lg transition-colors"
                        title="Close"
                        disabled={isSharing}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Recipient Email
                        </label>
                        <input
                            type="email"
                            value={recipientEmail}
                            onChange={(e) => setRecipientEmail(e.target.value)}
                            placeholder="user@example.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            disabled={isSharing}
                        />
                    </div>

                    {hasFirstScene && (
                        <div className="flex items-start space-x-2">
                            <input
                                type="checkbox"
                                id="includeFirstScene"
                                checked={includeFirstScene}
                                onChange={(e) => setIncludeFirstScene(e.target.checked)}
                                className="mt-1 w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                disabled={isSharing}
                            />
                            <label htmlFor="includeFirstScene" className="text-sm text-gray-700 cursor-pointer">
                                <span className="font-medium">Include first scene</span>
                                <p className="text-xs text-gray-500 mt-1">
                                    The recipient will start with this scene and it will be protected from deletion
                                </p>
                            </label>
                        </div>
                    )}

                    {status && (
                        <div className={`p-3 rounded-lg text-sm ${statusType === 'success'
                            ? 'bg-green-50 text-green-800 border border-green-200'
                            : statusType === 'error'
                                ? 'bg-red-50 text-red-800 border border-red-200'
                                : 'bg-blue-50 text-blue-800 border border-blue-200'
                            }`}>
                            {status}
                        </div>
                    )}
                </div>

                <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end items-center gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                        disabled={isSharing}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleShare}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isSharing || statusType === 'success'}
                    >
                        {isSharing ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Sharing...
                            </>
                        ) : (
                            <>
                                <Share2 className="w-4 h-4 mr-2" />
                                Share NPC
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

const NpcChat = ({ db, userId, userEmail, npc, onBack, isMobile = false, mobileView = 'details', onShowConversation, onShowDetails, currentTip, handleDeductCredits }) => {


    const [message, setMessage] = useState('');
    const [chatHistory, setChatHistory] = useState(npc.chats || []);
    const [isThinking, setIsThinking] = useState(false);
    const [playingMessageIndex, setPlayingMessageIndex] = useState(null); // Track which message is playing
    const [isAutoPlayEnabled, setIsAutoPlayEnabled] = useState(false); // Auto-play toggle
    const [audioCache, setAudioCache] = useState({}); // Cache for audio Blob URLs
    const [audioPlayer, setAudioPlayer] = useState(null);
    const [showNpcDetails, setShowNpcDetails] = useState(true);
    const [currentImageUrl, setCurrentImageUrl] = useState(null);
    const [isImageGenerating, setIsImageGenerating] = useState(false);
    const [isImageModalOpen, setIsImageModalOpen] = useState(false);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);

    // Scene State
    const [startingSceneText, setStartingSceneText] = useState('');
    const [isGeneratingScene, setIsGeneratingScene] = useState(false);
    const [isSceneWizardOpen, setIsSceneWizardOpen] = useState(false);
    const [isEditingScene, setIsEditingScene] = useState(false); // Unified for both mobile and desktop

    // Goal Tracking State
    const [currentSceneGoal, setCurrentSceneGoal] = useState(null);
    const [goalAchievedForScene, setGoalAchievedForScene] = useState(null); // Stores the scene index for which goal was achieved

    // Cache for generated scenes: { [npcId]: "scene text" }
    const sceneCache = useRef({});

    // Ref for message input to maintain focus
    const messageInputRef = useRef(null);

    // Load initial chat history and audio player on component mount
    useEffect(() => {
        // Reset scene state when NPC changes
        // Reset scene state when NPC changes
        setStartingSceneText(sceneCache.current[npc.id] || '');
        setIsSceneWizardOpen(false);
        setIsGeneratingScene(false);
        setIsEditingScene(false);

        const chats = npc.chats || [];
        setChatHistory(chats);

        // Parse and restore current goal from chat history
        if (chats.length > 0) {
            // Find the most recent scene
            let mostRecentSceneIndex = -1;
            let mostRecentSceneText = null;
            for (let i = chats.length - 1; i >= 0; i--) {
                if (chats[i].role === 'scene') {
                    mostRecentSceneIndex = i;
                    mostRecentSceneText = chats[i].text;
                    break;
                }
            }

            if (mostRecentSceneText) {
                // Check if goal was already achieved (look for goal_achieved message after this scene)
                let goalAlreadyAchieved = false;
                for (let i = mostRecentSceneIndex + 1; i < chats.length; i++) {
                    if (chats[i].role === 'goal_achieved') {
                        goalAlreadyAchieved = true;
                        setGoalAchievedForScene(mostRecentSceneIndex);
                        break;
                    }
                }

                // If goal not achieved yet, parse and set current goal
                if (!goalAlreadyAchieved) {
                    const goal = parseGoalFromScene(mostRecentSceneText);
                    if (goal) {
                        setCurrentSceneGoal(goal);
                        setGoalAchievedForScene(null);
                    }
                }
            }
        }

        // Load the saved Cloudinary image URL if it exists
        setCurrentImageUrl(npc.imageUrl || null);

        if (!audioPlayer) {
            const player = new Audio();
            setAudioPlayer(player);

            // Cleanup function for when component unmounts
            return () => {
                player.pause();
                player.currentTime = 0;
                // Clean up all cached audio Blob URLs
                Object.values(audioCache).forEach(url => {
                    if (url.startsWith('blob:')) {
                        URL.revokeObjectURL(url);
                    }
                });
                if (player.src && player.src.startsWith('blob:')) {
                    URL.revokeObjectURL(player.src);
                }
            };
        }
    }, [npc.id]);

    const scrollToBottom = (elementId) => {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    };

    useEffect(() => {
        // Scroll to bottom whenever chat history updates
        scrollToBottom('chat-container');
    }, [chatHistory, isThinking]);

    /**
     * FIX 1: The stopAudio function now reliably resets the playing state.
     */
    const stopAudio = useCallback(() => {
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            setPlayingMessageIndex(null);
        }
    }, [audioPlayer]);

    useEffect(() => {
        return () => {
            stopAudio();
            // The unmount cleanup is handled in the effect where audioPlayer is created.
        };
    }, [stopAudio]);

    // Play success sound when goal is achieved
    const playSuccessSound = () => {
        try {
            // Create a simple "pa-pam!" sound using Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // First note "pa" (higher pitch)
            const oscillator1 = audioContext.createOscillator();
            const gainNode1 = audioContext.createGain();
            oscillator1.connect(gainNode1);
            gainNode1.connect(audioContext.destination);
            oscillator1.frequency.value = 523.25; // C5
            gainNode1.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            oscillator1.start(audioContext.currentTime);
            oscillator1.stop(audioContext.currentTime + 0.2);

            // Second note "pam" (lower pitch, slightly delayed)
            const oscillator2 = audioContext.createOscillator();
            const gainNode2 = audioContext.createGain();
            oscillator2.connect(gainNode2);
            gainNode2.connect(audioContext.destination);
            oscillator2.frequency.value = 392.00; // G4
            gainNode2.gain.setValueAtTime(0, audioContext.currentTime + 0.15);
            gainNode2.gain.setValueAtTime(0.3, audioContext.currentTime + 0.15);
            gainNode2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            oscillator2.start(audioContext.currentTime + 0.15);
            oscillator2.stop(audioContext.currentTime + 0.5);
        } catch (e) {
            console.error("Error playing success sound:", e);
        }
    };

    const handleSpeakClick = async (text, index) => {
        // If speaking THIS message, clicking the button should stop it immediately.
        if (playingMessageIndex === index) {
            stopAudio();
            return;
        }

        if (!audioPlayer) return;

        stopAudio(); // Ensure any existing audio stops
        setPlayingMessageIndex(index);
        audioPlayer.src = '';

        try {
            let audioUrl;

            // Check if we have this audio cached
            if (audioCache[text]) {
                audioUrl = audioCache[text];
            } else {
                // Generate TTS using the NPC's structured data for voice selection
                // Deduct credits (2 Gold) for NEW generation
                await handleDeductCredits(2);

                audioUrl = await textToSpeech(text, npc.structuredData);

                if (!audioUrl) {
                    throw new Error('TTS returned empty audio URL');
                }

                // Log TTS usage for analytics
                const voiceId = npc.structuredData.voiceId?.split(' ')[0]?.trim();
                const voiceData = getVoiceById(voiceId);
                const ttsType = voiceData?.provider === 'elevenlabs' ? 'elevenlabs_tts' : 'gemini_tts';

                await logUsage(userId, userEmail, ttsType, {
                    npcId: npc.id,
                    npcName: npc.name,
                    voiceId: voiceId
                });

                // Cache the audio URL for future use
                setAudioCache(prev => ({
                    ...prev,
                    [text]: audioUrl
                }));
            }

            // Clean up old blob URL if present
            if (audioPlayer.src.startsWith('blob:')) {
                URL.revokeObjectURL(audioPlayer.src);
            }

            audioPlayer.src = audioUrl;

            // Play is now explicitly triggered by the user's click on the icon.
            await audioPlayer.play();

            audioPlayer.onended = () => {
                setPlayingMessageIndex(null);
                // Don't revoke cached URLs - keep them for replay
            };
            audioPlayer.onerror = (e) => {
                console.error("Audio playback error:", audioPlayer.error?.message || e);
                setPlayingMessageIndex(null);
            };
        } catch (e) {
            console.error("TTS Error:", e.message);

            if (e.message === "Insufficient funds") {
                alert("Insufficient Gold! Please visit the Gold Store to get more.");
            }

            // Only log critical TTS errors to Sentry (quota, API failures)
            if (e.message.includes('quota') || e.message.includes('API') || e.message.includes('service')) {
                Sentry.captureException(e, {
                    tags: {
                        feature: 'tts_critical',
                        user_action: 'speak_button'
                    },
                    extra: {
                        npcId: npc?.id,
                        npcName: npc?.name,
                        messageIndex: index,
                        textLength: text?.length || 0,
                        errorMessage: e.message
                    }
                });
            }

            setPlayingMessageIndex(null);
        }
    };


    // Helper function to get NPC response, update state and Firestore
    // Returns: { npcResponseText, isGoalAchieved, finalHistory }
    const getNPCResponseAndUpdate = async (historyBeforeResponse, options = {}) => {
        const {
            checkGoal = false,
            playAudioOnResponse = false
        } = options;

        // Get NPC response (and check goal if needed)
        const npcResponse = await getNPCResponse(
            npc.structuredData,
            historyBeforeResponse,
            checkGoal ? currentSceneGoal : null
        );

        // Handle response format (string or object with goalAchieved)
        let npcResponseText;
        let isGoalAchieved = false;

        if (typeof npcResponse === 'string') {
            npcResponseText = npcResponse;
        } else {
            npcResponseText = npcResponse.response;
            isGoalAchieved = npcResponse.goalAchieved;
        }

        // Create NPC message
        const npcMsg = {
            role: 'npc',
            text: npcResponseText,
            timestamp: new Date().toISOString()
        };

        let finalHistory = [...historyBeforeResponse, npcMsg];

        // Update state
        setChatHistory(finalHistory);

        // Update Firestore
        const collectionPath = npc.isSharedNPC ? sharedNpcCollectionPath(appId, userId) : npcCollectionPath(appId, userId);
        const npcRef = doc(db, collectionPath, npc.id);
        await updateDoc(npcRef, {
            chats: finalHistory,
            updatedAt: new Date().toISOString()
        });

        // Auto-play audio if requested and enabled
        if (playAudioOnResponse && isAutoPlayEnabled && npc.structuredData.voiceId) {
            const voiceId = npc.structuredData.voiceId.split(' ')[0];
            const npcMessageIndex = historyBeforeResponse.length;
            await playAudio(npcResponseText, voiceId, npcMessageIndex);
        }

        return { npcResponseText, isGoalAchieved, finalHistory };
    };

    const handleSend = async () => {
        const text = message.trim();
        if (!text || isThinking) return;

        // Check for slash command /scene
        if (text.toLowerCase().startsWith('/scene')) {
            const sceneText = text.substring(6).trim();

            // If no text after /scene, open the scene modal
            if (!sceneText) {
                setMessage('');
                handleOpenSceneWizard();
                return;
            }

            stopAudio();
            setMessage('');
            setIsThinking(true);

            const sceneMsg = { role: 'scene', text: sceneText, timestamp: new Date().toISOString() };
            const newHistory = [...chatHistory, sceneMsg];

            // Parse and store the goal from this scene
            const goal = parseGoalFromScene(sceneText);
            if (goal) {
                setCurrentSceneGoal(goal);
                setGoalAchievedForScene(null); // Reset achievement status for new scene
            }

            // Clear scene cache after adding scene to conversation
            delete sceneCache.current[npc.id];
            setStartingSceneText('');

            setChatHistory(newHistory);
            scrollToBottom('chat-container');

            try {
                // Get NPC response to the scene
                await getNPCResponseAndUpdate(
                    newHistory,
                    { checkGoal: false, playAudioOnResponse: isAutoPlayEnabled }
                );

                // Log usage
                await logUsage(userId, userEmail, 'scene_command', {
                    npcId: npc.id,
                    sceneLength: sceneText.length
                });

            } catch (e) {
                console.error("Error after scene command:", e);
                alert("Scene added, but NPC couldn't respond. Please try sending a message.");
            } finally {
                setIsThinking(false);
            }

            scrollToBottom('chat-container');
            return;
        }

        stopAudio();
        setIsThinking(true);
        setMessage('');

        const userMsg = { role: 'user', text: text, timestamp: new Date().toISOString() };

        // 1. Optimistically update the UI immediately with user message
        const newHistory = [...chatHistory, userMsg];
        setChatHistory(newHistory);
        scrollToBottom('chat-container');

        try {
            // 2. Get NPC response (with goal checking if applicable)
            const shouldCheckGoal = currentSceneGoal && goalAchievedForScene === null;
            const { npcResponseText, isGoalAchieved, finalHistory: historyWithNPC } = await getNPCResponseAndUpdate(
                newHistory,
                { checkGoal: shouldCheckGoal, playAudioOnResponse: false }
            );

            let finalHistory = historyWithNPC;

            // 3. If goal was achieved, add achievement message
            if (isGoalAchieved && shouldCheckGoal) {
                // Find the index of the most recent scene to mark it as achieved
                let mostRecentSceneIndex = -1;
                for (let i = finalHistory.length - 1; i >= 0; i--) {
                    if (finalHistory[i].role === 'scene') {
                        mostRecentSceneIndex = i;
                        break;
                    }
                }

                // Add goal achievement message
                const goalAchievedMsg = {
                    role: 'goal_achieved',
                    text: currentSceneGoal,
                    timestamp: new Date().toISOString()
                };
                finalHistory = [...finalHistory, goalAchievedMsg];
                setGoalAchievedForScene(mostRecentSceneIndex);

                // Clear scene cache so next scene will be freshly generated
                delete sceneCache.current[npc.id];
                setStartingSceneText('');

                // Play success sound
                playSuccessSound();

                // Update Firestore with goal achieved message
                const collectionPath = npc.isSharedNPC ? sharedNpcCollectionPath(appId, userId) : npcCollectionPath(appId, userId);
                const npcRef = doc(db, collectionPath, npc.id);
                await updateDoc(npcRef, {
                    chats: finalHistory,
                    updatedAt: new Date().toISOString()
                });

                setChatHistory(finalHistory);
            }

            // 4. Log chat message for analytics
            await logUsage(userId, userEmail, 'gemini_chat', {
                npcId: npc.id,
                npcName: npc.name,
                messageCount: finalHistory.length
            });

            // 5. Auto-play if enabled
            if (isAutoPlayEnabled) {
                // The new message is at the end of finalHistory (or second to last if goal achieved)
                const npcMessageIndex = finalHistory[finalHistory.length - 1].role === 'goal_achieved'
                    ? finalHistory.length - 2
                    : finalHistory.length - 1;
                handleSpeakClick(npcResponseText, npcMessageIndex);
            }

        } catch (e) {
            console.error("Chat Error:", e);
            // Revert optimistic update or show error
            setChatHistory(prev => prev.slice(0, prev.length - 1));
            // Restore the message so the user doesn't have to retype it
            setMessage(text);

            // Show user-friendly error message
            let errorMessage = `${npc.name} couldn't respond right now.\n\n`;
            if (e.message && e.message.includes("overloaded")) {
                errorMessage += "⏳ The service is currently busy. Please wait 10-30 seconds and try again.\n\nYour message has been restored so you can easily resend it.";
            } else if (e.message && e.message.includes("Content blocked")) {
                errorMessage += "Your message may have triggered content filters. Try rephrasing it.";
            } else {
                errorMessage += "Something went wrong. Please try again in a moment.\n\nYour message has been restored.";
            }
            alert(errorMessage);
        } finally {
            setIsThinking(false);
            // Refocus the message input after response is complete
            setTimeout(() => {
                messageInputRef.current?.focus();
            }, 0);
        }
    };

    const handleRollbackToScene = async (sceneIndex) => {
        const message = chatHistory[sceneIndex];
        if (!message || (message.role !== 'scene' && message.role !== 'goal_achieved')) return;

        // Don't allow rollback to protected first scene
        const isProtectedScene = npc.protectedFirstScene && sceneIndex === 0 && chatHistory[0].role === 'scene';
        if (isProtectedScene) return;

        // Use slight delay to allow UI to settle before native block
        await new Promise(resolve => setTimeout(resolve, 50));

        if (!window.confirm("Rollback to this point? This will clear all conversation after it.")) return;

        try {
            if (message.role === 'scene') {
                // For scenes: remove the scene and everything after it
                const newHistory = chatHistory.slice(0, sceneIndex);

                // Put the scene text in cache and state
                sceneCache.current[npc.id] = message.text;
                setStartingSceneText(message.text);

                // Reset goal tracking state
                setCurrentSceneGoal(null);
                setGoalAchievedForScene(null);

                // Update chat history in state and Firestore
                setChatHistory(newHistory);

                if (db) {
                    const collectionPath = npc.isSharedNPC ? sharedNpcCollectionPath(appId, userId) : npcCollectionPath(appId, userId);
                    const npcRef = doc(db, collectionPath, npc.id);
                    await updateDoc(npcRef, {
                        chats: newHistory,
                        updatedAt: new Date().toISOString()
                    });
                }

                // Log usage
                await logUsage(userId, userEmail, 'rollback_to_scene', {
                    npcId: npc.id,
                    sceneIndex
                });

                // Open the scene wizard with the scene in cache
                setIsSceneWizardOpen(true);

            } else if (message.role === 'goal_achieved') {
                // For goal_achieved: keep the goal_achieved message, remove everything after it
                const newHistory = chatHistory.slice(0, sceneIndex + 1);

                // Update chat history in state and Firestore
                setChatHistory(newHistory);

                if (db) {
                    const collectionPath = npc.isSharedNPC ? sharedNpcCollectionPath(appId, userId) : npcCollectionPath(appId, userId);
                    const npcRef = doc(db, collectionPath, npc.id);
                    await updateDoc(npcRef, {
                        chats: newHistory,
                        updatedAt: new Date().toISOString()
                    });
                }

                // Log usage
                await logUsage(userId, userEmail, 'rollback_to_goal_achieved', {
                    npcId: npc.id,
                    messageIndex: sceneIndex
                });

                scrollToBottom('chat-container');
            }

        } catch (e) {
            console.error("Error rolling back:", e);
            alert("Failed to rollback. Please try again.");
        }
    };

    const handleResetConversation = async (e) => {
        // Prevent event bubbling which often causes double-fires or quick closes
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();

        const hasProtectedScene = npc.protectedFirstScene && chatHistory.length > 0 && chatHistory[0].role === 'scene';
        const confirmMessage = hasProtectedScene
            ? "This will clear the conversation but keep the protected starting scene. Continue?"
            : "Are you sure you want to clear the conversation history? This cannot be undone.";

        // Use slight delay to ensure UI is clean before blocking
        await new Promise(resolve => setTimeout(resolve, 50));

        if (!window.confirm(confirmMessage)) return;

        try {
            const hasProtectedScene = npc.protectedFirstScene && chatHistory.length > 0 && chatHistory[0].role === 'scene';

            // Save the first scene to cache if it exists
            if (chatHistory.length > 0 && chatHistory[0].role === 'scene') {
                sceneCache.current[npc.id] = chatHistory[0].text;
                setStartingSceneText(chatHistory[0].text);
            }

            // Determine what to reset to
            const newChats = hasProtectedScene ? [chatHistory[0]] : [];

            const collectionPath = npc.isSharedNPC ? sharedNpcCollectionPath(appId, userId) : npcCollectionPath(appId, userId);
            const npcRef = doc(db, collectionPath, npc.id);
            await updateDoc(npcRef, {
                chats: newChats,
                updatedAt: new Date().toISOString()
            });

            setChatHistory(newChats);
            setPlayingMessageIndex(null);
            setCurrentSceneGoal(null);
            setGoalAchievedForScene(null);

            // Log usage
            await logUsage(userId, userEmail, 'reset_conversation', { npcId: npc.id });

        } catch (e) {
            console.error("Error resetting conversation:", e);
            alert("Failed to reset conversation. Please try again.");
        }
    };


    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleRegenerateImage = async () => {
        setIsImageGenerating(true);
        try {
            // Deduct credits (5 Gold)
            await handleDeductCredits(5);

            const data = npc.structuredData;

            // Step 1: Generate image with DALL-E 3 and upload to Cloudinary (via backend)
            const { secure_url, public_id } = await generateNPCImage(data.name, data.raceClass, data.visual, data.gender, data.ageRange, data.personality, npc.id);

            const cloudinaryUrl = secure_url;
            const cloudinaryImageId = public_id;

            // Log analytics
            await logUsage(userId, userEmail, 'dalle', {
                npcId: npc.id,
                model: 'dall-e-3'
            });

            // Step 3: Update the current display
            setCurrentImageUrl(cloudinaryUrl);

            // Step 4: Update the NPC in Firestore with the new Cloudinary URL
            if (db) {
                try {
                    const npcRef = doc(db, npcCollectionPath(appId, userId), npc.id);
                    await updateDoc(npcRef, {
                        imageUrl: cloudinaryUrl,
                        cloudinaryImageId: cloudinaryImageId
                    });
                    console.log(`[${new Date().toISOString()}] Updated NPC imageUrl in Firestore`);
                } catch (updateError) {
                    console.error('Failed to update NPC imageUrl in Firestore:', updateError);
                }
            }
        } catch (error) {
            console.error(`Error regenerating image: ${error.message}`);
            if (error.message === "Insufficient funds") {
                alert("Insufficient Gold! Please visit the Gold Store to get more.");
            } else {
                alert("Failed to generate image. Please try again.");
            }
        } finally {
            setIsImageGenerating(false);
        }
    };

    const handleUpdateField = async (field, value) => {
        // Prevent updates to shared NPCs
        if (npc.isSharedNPC) {
            console.error("Cannot update shared NPC fields");
            throw new Error("Cannot update shared NPC fields");
        }

        // Optimistic update handled by Firestore listener, but we can also log it.
        console.log(`Updating ${field} to:`, value);

        if (field === 'voiceId' && value) {
            const voiceData = getVoiceById(value.split(' ')[0]);
            if (voiceData) {
                console.log(`voice_id: ${voiceData.id} (${voiceData.provider === 'elevenlabs' ? 'Elevenlabs' : 'Google TTS'})`);
            }
        }

        if (!db) return;

        try {
            const npcRef = doc(db, npcCollectionPath(appId, userId), npc.id);

            // Handle 'name' field separately as it's at the top level
            if (field === 'name') {
                // Update both top-level name AND structuredData.name to keep them in sync
                const updatedStructuredData = {
                    ...npc.structuredData,
                    name: value
                };

                await updateDoc(npcRef, {
                    name: value,
                    structuredData: updatedStructuredData,
                    updatedAt: new Date().toISOString()
                });
            } else {
                // Create the updated structuredData object for other fields
                const updatedStructuredData = {
                    ...npc.structuredData,
                    [field]: value
                };

                await updateDoc(npcRef, {
                    structuredData: updatedStructuredData,
                    updatedAt: new Date().toISOString()
                });
            }
            console.log("Field updated successfully");
        } catch (e) {
            console.error("Error updating field:", e);
            throw e; // Propagate error to the component to show error state
        }
    };

    const handleRegenerateField = async (field) => {
        try {
            return await regenerateNPCField(npc.structuredData, field);
        } catch (e) {
            console.error("Error regenerating field:", e);
            return null;
        }
    };

    const handleExpandField = async (field) => {
        try {
            return await expandNPCField(npc.structuredData, field);
        } catch (e) {
            console.error("Error expanding field:", e);
            return null;
        }
    };

    const handleRegenerateVoice = async () => {
        try {
            return await regenerateVoice(npc.structuredData);
        } catch (e) {
            console.error("Error regenerating voice:", e);
            return null;
        }
    };


    // --- Scene Modal Logic ---

    const handleOpenSceneWizard = () => {
        setIsSceneWizardOpen(true);
        setIsEditingScene(false); // Reset mobile editing state
        // Check cache first
        if (sceneCache.current[npc.id]) {
            setStartingSceneText(sceneCache.current[npc.id]);
        } else if (!startingSceneText) {
            handleGenerateStartingScene();
        }
    };

    const handleCancelScene = () => {
        setIsSceneWizardOpen(false);
        setIsEditingScene(false);
    };

    /**
     * Core generator function that returns the string.
     * Does NOT update state directly (unless called by the initial loader).
     */
    const fetchStartingScene = async () => {
        try {
            return await generateScene(npc.structuredData, chatHistory);
        } catch (e) {
            console.error("Error generating scene:", e);
            throw e;
        }
    };

    const handleGenerateStartingScene = async () => {
        setIsGeneratingScene(true);
        setIsEditingScene(false);
        try {
            const scene = await fetchStartingScene();
            if (scene) {
                setStartingSceneText(scene);
                sceneCache.current[npc.id] = scene;
            }
        } catch (e) {
            console.error("Error generating scene:", e);
        } finally {
            setIsGeneratingScene(false);
        }
    };

    const handleSaveSceneEdit = (newText) => {
        setStartingSceneText(newText);
        // Update cache with manual edits
        sceneCache.current[npc.id] = newText;
    };


    const handleStartWithScene = async () => {
        if (!startingSceneText) return;

        const sceneMsg = {
            role: 'scene',
            text: startingSceneText,
            timestamp: new Date().toISOString()
        };

        // Parse and store the goal from this scene
        const goal = parseGoalFromScene(startingSceneText);
        if (goal) {
            setCurrentSceneGoal(goal);
            setGoalAchievedForScene(null); // Reset achievement status for new scene
        }

        const newHistory = [...chatHistory, sceneMsg];
        setChatHistory(newHistory);
        setIsSceneWizardOpen(false);
        setIsEditingScene(false); // Reset mobile editing state

        // Clear scene cache after adding scene to conversation
        delete sceneCache.current[npc.id];
        setStartingSceneText('');

        // Update Firestore with scene
        if (db) {
            try {
                const collectionPath = npc.isSharedNPC ? sharedNpcCollectionPath(appId, userId) : npcCollectionPath(appId, userId);
                const npcRef = doc(db, collectionPath, npc.id);
                await updateDoc(npcRef, {
                    chats: newHistory,
                    updatedAt: new Date().toISOString()
                });
            } catch (e) {
                console.error("Error saving scene:", e);
            }
        }

        // Trigger initial NPC message
        setIsThinking(true);
        try {
            const { npcResponseText } = await getNPCResponseAndUpdate(
                newHistory,
                { checkGoal: false, playAudioOnResponse: false }
            );

            // Auto-play if enabled
            if (isAutoPlayEnabled) {
                handleSpeakClick(npcResponseText, chatHistory.length);
            }

        } catch (error) {
            console.error("Error generating initial NPC response:", error);
        } finally {
            setIsThinking(false);
        }
    };

    // NPC Details for GM reference
    const npcDetails = useMemo(() => (
        <div className="p-4 mb-4 bg-indigo-50 rounded-xl shadow-inner border border-indigo-200">
            <h4 className="flex items-center text-lg font-bold text-indigo-700 cursor-pointer" onClick={() => setShowNpcDetails(!showNpcDetails)}>
                <Brain className="w-5 h-5 mr-2" />
                GM Details (Click to {showNpcDetails ? 'Hide' : 'Show'})
                {showNpcDetails ? <ChevronsUp className="w-4 h-4 ml-2" /> : <ChevronsDown className="w-4 h-4 ml-2" />}
            </h4>
            {showNpcDetails && (
                <div className="mt-2 text-sm space-y-2">
                    <p><strong className="text-indigo-600">Race/Class:</strong> {npc.structuredData.raceClass}</p>
                    <p><strong className="text-indigo-600">Gender/Age:</strong> {npc.structuredData.gender} / {npc.structuredData.ageRange}</p>
                    <p><strong className="text-indigo-600">Voice:</strong> {selectVoice(npc.structuredData.gender, npc.structuredData.ageRange)}</p>
                    <p><strong className="text-indigo-600">Visual Description:</strong> {npc.structuredData.visual}</p>
                    <p><strong className="text-indigo-600">Personality:</strong> {npc.structuredData.personality}</p>
                    <p><strong className="text-indigo-600">Wants:</strong> {npc.structuredData.wants}</p>
                    <p><strong className="text-indigo-600">Pitfalls:</strong> {npc.structuredData.pitfalls}</p>
                    <p className="p-2 border-l-4 border-red-500 bg-red-50"><strong className="text-red-700">SECRET:</strong> {npc.structuredData.secrets}</p>
                </div>
            )}
        </div>
    ), [npc.structuredData, showNpcDetails]);

    // UI for the main chat component
    // Left panel: NPC details
    const npcDetailsPanel = (
        <div className="h-full p-6 overflow-y-auto bg-gray-50">
            {/* Header with Name and Toolbar */}
            <div className="flex items-start justify-between mb-4 -m-2">
                <div className="flex-1 min-w-0">
                    <EditableField
                        label="Name"
                        value={npc.name}
                        onSave={(val) => handleUpdateField('name', val)}
                        hideLabel={true}
                        textClassName="text-2xl font-bold text-gray-900"
                        className=""
                        disabled={npc.isSharedNPC}
                    />
                </div>
                {/* Toolbar */}
                {!npc.isSharedNPC && (
                    <div className="flex items-center ml-3 pt-2">
                        <button
                            onClick={() => setIsShareModalOpen(true)}
                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Share NPC"
                        >
                            <Share2 className="w-5 h-5" />
                        </button>
                    </div>
                )}
            </div>
            <p className="mb-4 text-sm font-semibold text-indigo-600">{npc.structuredData.raceClass}</p>

            {currentImageUrl ? (
                <img
                    src={currentImageUrl}
                    alt={npc.name}
                    onClick={() => setIsImageModalOpen(true)}
                    className="object-contain w-full mb-4 rounded-lg shadow-lg aspect-square bg-gray-200 cursor-pointer hover:opacity-95 transition-opacity"
                />
            ) : (
                <div className="flex items-center justify-center w-full mb-4 text-gray-500 bg-gray-200 rounded-lg aspect-square">
                    <p className='p-4 text-center text-xs'>Image not saved. Click below to generate.</p>
                </div>
            )}

            <button
                onClick={handleRegenerateImage}
                disabled={isImageGenerating || npc.isSharedNPC}
                className={`w-full mb-3 flex items-center justify-center px-4 py-2 font-semibold transition-all duration-200 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 ${isImageGenerating || npc.isSharedNPC ? 'bg-purple-100 text-purple-700 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white focus:ring-purple-500'}`}
            >
                <style>{magicalStyles}</style>
                {isImageGenerating ? (
                    <div className="relative mr-2">
                        <Wand2 className="w-5 h-5 animate-magic" />
                        <Sparkles className="w-3 h-3 text-yellow-400 absolute -top-1 -right-1 animate-sparkle-1" />
                        <Sparkles className="w-3 h-3 text-cyan-400 absolute -bottom-1 -left-1 animate-sparkle-2" />
                    </div>
                ) : (
                    <Wand2 className="w-5 h-5 mr-2" />
                )}
                {isImageGenerating ? 'Conjuring Masterpiece...' : 'Generate Epic Portrait'}
            </button>

            {/* Shared Badge - only for shared NPCs */}
            {npc.isSharedNPC && (
                <div className="mb-6 p-3 bg-blue-50 border-2 border-blue-200 rounded-lg">
                    <p className="text-sm font-semibold text-blue-800 flex items-center">
                        <User className="w-4 h-4 mr-2" />
                        Shared by {npc.sharedFrom?.userEmail || 'Unknown'}
                    </p>
                    <p className="text-xs text-blue-600 mt-1">
                        This NPC is read-only. You can chat but cannot edit details.
                    </p>
                </div>
            )}

            {/* GM Details Panel */}
            <div className="p-4 bg-indigo-50 rounded-xl shadow-inner border border-indigo-200">
                {/* Always Visible Section */}
                <div className="space-y-1 mb-4">
                    <div className="grid grid-cols-2 gap-2">
                        <EditableField
                            label="Gender"
                            value={npc.structuredData.gender}
                            type="select"
                            options={['male', 'female', 'other']}
                            onSave={(val) => handleUpdateField('gender', val)}
                            disabled={npc.isSharedNPC}
                        />
                        <EditableField
                            label="Age"
                            value={npc.structuredData.ageRange}
                            type="select"
                            options={['child', 'young adult', 'adult', 'middle-age', 'old']}
                            onSave={(val) => handleUpdateField('ageRange', val)}
                            disabled={npc.isSharedNPC}
                        />
                    </div>
                    <EditableField
                        label="Voice"
                        value={npc.structuredData.voiceId || selectVoice(npc.structuredData.gender, npc.structuredData.ageRange)}
                        displayValue={(npc.structuredData.voiceId || selectVoice(npc.structuredData.gender, npc.structuredData.ageRange)).split(' ')[0]}
                        type="select"
                        options={AVAILABLE_VOICES}
                        onSave={(val) => handleUpdateField('voiceId', val)}
                        onRegenerate={handleRegenerateVoice}
                        disabled={npc.isSharedNPC}
                    />
                    <EditableField
                        label="Race/Class"
                        value={npc.structuredData.raceClass}
                        onSave={(val) => handleUpdateField('raceClass', val)}
                        disabled={npc.isSharedNPC}
                    />
                    <EditableField
                        label="Visual Description"
                        value={npc.structuredData.visual}
                        type="textarea"
                        onSave={(val) => handleUpdateField('visual', val)}
                        onRegenerate={() => handleRegenerateField('visual')}
                        disabled={npc.isSharedNPC}
                    />
                </div>

                {/* Collapsible GM Details Section */}
                <h4 className="flex items-center text-lg font-bold text-indigo-700 cursor-pointer mb-3 pt-3 border-t border-indigo-200" onClick={() => setShowNpcDetails(!showNpcDetails)}>
                    <Brain className="w-5 h-5 mr-2" />
                    GM Details
                    {showNpcDetails ? <ChevronsUp className="w-4 h-4 ml-auto" /> : <ChevronsDown className="w-4 h-4 ml-auto" />}
                </h4>

                {showNpcDetails && (
                    <div className="space-y-1">
                        <EditableField
                            label="Personality"
                            value={npc.structuredData.personality}
                            type="textarea"
                            onSave={(val) => handleUpdateField('personality', val)}
                            onRegenerate={() => handleRegenerateField('personality')}
                            disabled={npc.isSharedNPC}
                        />
                        <EditableField
                            label="Wants"
                            value={npc.structuredData.wants}
                            type="textarea"
                            onSave={(val) => handleUpdateField('wants', val)}
                            onRegenerate={() => handleRegenerateField('wants')}
                            onExpand={() => handleExpandField('wants')}
                            disabled={npc.isSharedNPC}
                        />
                        <EditableField
                            label="Pitfalls"
                            value={npc.structuredData.pitfalls}
                            type="textarea"
                            onSave={(val) => handleUpdateField('pitfalls', val)}
                            onRegenerate={() => handleRegenerateField('pitfalls')}
                            onExpand={() => handleExpandField('pitfalls')}
                            disabled={npc.isSharedNPC}
                        />
                        <div className="border-l-4 border-red-500 bg-red-50 rounded-r-lg">
                            <EditableField
                                label="SECRET (GM ONLY)"
                                value={npc.structuredData.secrets}
                                type="textarea"
                                className="bg-transparent hover:bg-red-100"
                                onSave={(val) => handleUpdateField('secrets', val)}
                                onRegenerate={() => handleRegenerateField('secrets')}
                                onExpand={() => handleExpandField('secrets')}
                                disabled={npc.isSharedNPC}
                            />
                        </div>
                    </div>
                )}
            </div>


            <p className="mt-4 text-xs font-mono text-gray-400">ID: {npc.id.substring(0, 8)}...</p>
        </div>
    );

    // Right panel: Chat
    const chatPanel = (
        <div className="flex flex-col h-full overflow-hidden bg-white">
            {/* Chat Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                <h3 className="text-lg font-semibold text-gray-800">Conversation</h3>
                <div className="flex items-center space-x-3">
                    {chatHistory.length > 0 && (
                        <>
                            <p className="text-sm text-gray-500">{chatHistory.length} messages</p>
                            <div className="flex space-x-1">
                                <button
                                    onClick={() => setIsAutoPlayEnabled(!isAutoPlayEnabled)}
                                    className={`p-1.5 rounded-full transition-colors ${isAutoPlayEnabled
                                        ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                        }`}
                                    title={isAutoPlayEnabled ? "Auto-play Enabled" : "Auto-play Disabled"}
                                >
                                    {isAutoPlayEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={handleResetConversation}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                    title="Reset Conversation"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Chat History Container - Scrollable */}
            <div id="chat-container" className="flex-1 px-2 sm:px-6 py-6 space-y-4 overflow-y-auto bg-gray-50">
                {chatHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-6 animate-fade-in">
                        <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-200" />
                        <h3 className="text-xl font-bold text-gray-400 mb-2">Ready to Chat</h3>
                        <p className="text-gray-400 mb-6">Start the conversation with {npc.name}!</p>

                        <button
                            onClick={handleOpenSceneWizard}
                            className="flex items-center justify-center px-6 py-3 font-semibold transition-all duration-200 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 bg-purple-600 hover:bg-purple-700 text-white focus:ring-purple-500"
                        >
                            <Wand2 className="w-5 h-5 mr-2" />
                            Set a Scene
                        </button>

                        {currentTip && (
                            <p className="mt-6 text-sm text-gray-400 bg-gray-100 py-1 px-3 rounded-full inline-block">
                                Tip: {currentTip.text} <code className="text-indigo-500 font-bold">{currentTip.code}</code>{currentTip.suffix && ` ${currentTip.suffix}`}
                            </p>
                        )}
                    </div>
                ) : (
                    chatHistory
                        .map((msg, index) => {
                            // Check if this is a goal_achieved message and if there's a scene after it
                            const showGoalButtons = msg.role === 'goal_achieved' &&
                                !chatHistory.slice(index + 1).some(m => m.role === 'scene');

                            // Check if this is a protected first scene
                            const isProtected = npc.protectedFirstScene && index === 0 && msg.role === 'scene';

                            return (
                                <ChatBubble
                                    key={index}
                                    message={msg}
                                    npcName={npc.name}
                                    isSpeaking={playingMessageIndex === index}
                                    onSpeakClick={() => handleSpeakClick(msg.text, index)}
                                    onSetNextScene={handleOpenSceneWizard}
                                    onRollbackToScene={() => handleRollbackToScene(index)}
                                    showGoalButtons={showGoalButtons}
                                    currentTip={currentTip}
                                    isProtected={isProtected}
                                />
                            );
                        })
                )}
                {isThinking && (
                    <div className="flex justify-start">
                        <div className="p-3 text-gray-600 bg-gray-100 rounded-xl rounded-tl-none animate-pulse">
                            {npc.name} is thinking...
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area - Fixed at Bottom */}
            <div className="p-4 border-t border-gray-200 bg-white">
                <div className="flex items-end space-x-2">
                    <textarea
                        ref={messageInputRef}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows="2"
                        placeholder={`Say something to ${npc.name}...`}
                        className="flex-grow p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                        disabled={isThinking}
                        maxLength={1000}
                    />
                    <Button
                        onClick={handleSend}
                        disabled={!message.trim() || isThinking}
                        loading={isThinking}
                        className="h-12 w-12 p-0 flex-shrink-0 rounded-xl"
                    >
                        {!isThinking && <Send className="w-5 h-5" />}
                    </Button>
                </div>
            </div>
        </div>
    );

    // Mobile rendering: show only one panel at a time
    if (isMobile) {
        if (mobileView === 'details') {
            return (
                <div className="flex flex-col h-full overflow-hidden bg-white">
                    {/* Mobile header with back button - no title bar */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white flex-shrink-0">
                        <button
                            onClick={onBack}
                            className="flex items-center text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                            <ChevronLeft className="w-5 h-5 mr-1" />
                            Back to List
                        </button>
                        <button
                            onClick={onShowConversation}
                            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                        >
                            <MessageSquare className="w-4 h-4 mr-2" />
                            Conversation
                        </button>
                    </div>
                    {/* NPC Details Panel - Scrollable */}
                    <div className="flex-1 overflow-y-auto">
                        {npcDetailsPanel}
                    </div>
                    <ImageModal
                        isOpen={isImageModalOpen}
                        onClose={() => setIsImageModalOpen(false)}
                        imageUrl={currentImageUrl}
                        altText={npc.name}
                    />
                    <SceneModal
                        isOpen={isSceneWizardOpen}
                        onClose={handleCancelScene}
                        sceneText={startingSceneText}
                        isGenerating={isGeneratingScene}
                        isEditing={isEditingScene}
                        onEdit={setIsEditingScene}
                        onSave={handleSaveSceneEdit}
                        onRegenerate={handleGenerateStartingScene}
                        onStartWithScene={handleStartWithScene}
                    />
                    <ShareNPCModal
                        isOpen={isShareModalOpen}
                        onClose={() => setIsShareModalOpen(false)}
                        npc={npc}
                        db={db}
                        userId={userId}
                        userEmail={userEmail}
                    />
                </div>
            );
        } else if (mobileView === 'conversation') {
            return (
                <div className="flex flex-col h-full overflow-hidden bg-white">
                    {/* Mobile header - Simplified */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={onShowDetails}
                                className="text-indigo-600 hover:text-indigo-800"
                            >
                                <ChevronLeft className="w-6 h-6" />
                            </button>
                            <h3 className="text-lg font-semibold text-gray-800">{npc.name}</h3>
                        </div>

                        {chatHistory.length > 0 && (
                            <div className="flex space-x-1">
                                <button
                                    onClick={() => setIsAutoPlayEnabled(!isAutoPlayEnabled)}
                                    className={`p-1.5 rounded-full transition-colors ${isAutoPlayEnabled
                                        ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                        }`}
                                    title={isAutoPlayEnabled ? "Auto-play Enabled" : "Auto-play Disabled"}
                                >
                                    {isAutoPlayEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={handleResetConversation}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                    title="Reset Conversation"
                                >
                                    <RotateCcw className="w-5 h-5" />
                                </button>
                            </div>
                        )}
                    </div>
                    {/* Chat Panel - Full Height */}
                    <div className="flex-1 overflow-hidden">
                        {/* Chat History Container - Scrollable */}
                        <div id="chat-container" className="h-full px-2 sm:px-6 py-6 space-y-4 overflow-y-auto bg-gray-50">
                            {chatHistory.length === 0 ? (
                                <div
                                    className="flex flex-col items-center justify-center h-full p-8 text-center space-y-6 animate-fade-in"
                                >
                                    <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-200" />
                                    <h3 className="text-xl font-bold text-gray-400 mb-2">Ready to Chat</h3>
                                    <p className="text-gray-400 mb-6">Start the conversation with {npc.name}!</p>

                                    <button
                                        onClick={handleOpenSceneWizard}
                                        className="w-full max-w-xs mb-6 flex items-center justify-center px-6 py-3 font-semibold transition-all duration-200 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 bg-purple-600 hover:bg-purple-700 text-white focus:ring-purple-500"
                                    >
                                        <Wand2 className="w-5 h-5 mr-2" />
                                        Set a Scene
                                    </button>

                                    {currentTip && (
                                        <p className="text-sm text-gray-400 bg-gray-100 py-1 px-3 rounded-full inline-block">
                                            Tip: {currentTip.text} <code className="text-indigo-500 font-bold">{currentTip.code}</code>{currentTip.suffix && ` ${currentTip.suffix}`}
                                        </p>
                                    )}
                                </div>
                            ) : (
                                chatHistory
                                    .map((msg, index) => {
                                        // Check if this is a goal_achieved message and if there's a scene after it
                                        const showGoalButtons = msg.role === 'goal_achieved' &&
                                            !chatHistory.slice(index + 1).some(m => m.role === 'scene');

                                        // Check if this is a protected first scene
                                        const isProtected = npc.protectedFirstScene && index === 0 && msg.role === 'scene';

                                        return (
                                            <ChatBubble
                                                key={index}
                                                message={msg}
                                                npcName={npc.name}
                                                isSpeaking={playingMessageIndex === index}
                                                onSpeakClick={() => handleSpeakClick(msg.text, index)}
                                                onSetNextScene={handleOpenSceneWizard}
                                                onRollbackToScene={() => handleRollbackToScene(index)}
                                                showGoalButtons={showGoalButtons}
                                                currentTip={currentTip}
                                                isProtected={isProtected}
                                            />
                                        );
                                    })
                            )}
                            {isThinking && (
                                <div className="flex justify-start">
                                    <div className="p-3 text-gray-600 bg-gray-100 rounded-xl rounded-tl-none animate-pulse">
                                        {npc.name} is thinking...
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Input Area - Fixed at Bottom */}
                    <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
                        <div className="flex items-end space-x-2">
                            <textarea
                                ref={messageInputRef}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows="2"
                                placeholder={`Say something to ${npc.name}...`}
                                className="flex-grow p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                                disabled={isThinking}
                                maxLength={1000}
                            />
                            <Button
                                onClick={handleSend}
                                disabled={!message.trim() || isThinking || (chatHistory.length === 0 && isSceneWizardOpen)}
                                loading={isThinking}
                                className="h-12 w-12 p-0 flex-shrink-0 rounded-xl"
                            >
                                {!isThinking && <Send className="w-5 h-5" />}
                            </Button>
                        </div>
                    </div>
                    <ImageModal
                        isOpen={isImageModalOpen}
                        onClose={() => setIsImageModalOpen(false)}
                        imageUrl={currentImageUrl}
                        altText={npc.name}
                    />
                    <SceneModal
                        isOpen={isSceneWizardOpen}
                        onClose={handleCancelScene}
                        sceneText={startingSceneText}
                        isGenerating={isGeneratingScene}
                        isEditing={isEditingScene}
                        onEdit={setIsEditingScene}
                        onSave={handleSaveSceneEdit}
                        onRegenerate={handleGenerateStartingScene}
                        onStartWithScene={handleStartWithScene}
                    />
                    <ShareNPCModal
                        isOpen={isShareModalOpen}
                        onClose={() => setIsShareModalOpen(false)}
                        npc={npc}
                        db={db}
                        userId={userId}
                        userEmail={userEmail}
                    />
                </div >
            );
        }
    }

    // Desktop rendering: ResizablePanels
    return (
        <div className="flex h-full overflow-hidden bg-white">
            <ResizablePanels
                leftPanel={npcDetailsPanel}
                rightPanel={chatPanel}
                storageKey="npc-details-width"
                defaultLeftWidth={320}
                minLeftWidth={250}
                maxLeftWidth={500}
            />
            <ImageModal
                isOpen={isImageModalOpen}
                onClose={() => setIsImageModalOpen(false)}
                imageUrl={currentImageUrl}
                altText={npc.name}
            />
            <SceneModal
                isOpen={isSceneWizardOpen}
                onClose={handleCancelScene}
                sceneText={startingSceneText}
                isGenerating={isGeneratingScene}
                isEditing={isEditingScene}
                onEdit={setIsEditingScene}
                onSave={handleSaveSceneEdit}
                onRegenerate={handleGenerateStartingScene}
                onStartWithScene={handleStartWithScene}
            />
            <ShareNPCModal
                isOpen={isShareModalOpen}
                onClose={() => setIsShareModalOpen(false)}
                npc={npc}
                db={db}
                userId={userId}
                userEmail={userEmail}
            />
        </div>
    );
};


// --- Resizable Panel Components ---

const ResizablePanels = ({ leftPanel, rightPanel, isLeftCollapsed = false, storageKey = 'npc-panel-width', defaultLeftWidth = 320, minLeftWidth = 250, maxLeftWidth = 600 }) => {
    const containerRef = useRef(null);

    const [leftWidth, setLeftWidth] = useState(() => {
        const saved = localStorage.getItem(storageKey);
        return saved ? parseInt(saved, 10) : defaultLeftWidth;
    });
    const [isResizing, setIsResizing] = useState(false);

    // When collapsed, use minimal width (60px for the collapse button)
    const collapsedWidth = 60;
    const effectiveLeftWidth = isLeftCollapsed ? collapsedWidth : leftWidth;

    const startResizing = useCallback(() => {
        if (!isLeftCollapsed) {
            setIsResizing(true);
        }
    }, [isLeftCollapsed]);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((e) => {
        if (isResizing && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const newWidth = e.clientX - containerRect.left;
            if (newWidth >= minLeftWidth && newWidth <= maxLeftWidth) {
                setLeftWidth(newWidth);
                localStorage.setItem(storageKey, newWidth.toString());
            }
        }
    }, [isResizing, minLeftWidth, maxLeftWidth, storageKey]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
            document.body.classList.add('resizing');
        } else {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
            document.body.classList.remove('resizing');
        }

        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
            document.body.classList.remove('resizing');
        };
    }, [isResizing, resize, stopResizing]);

    return (
        <div ref={containerRef} className="flex h-full overflow-hidden">
            <div
                className={`flex-shrink-0 overflow-hidden ${!isResizing ? 'panel-transition' : ''}`}
                style={{ width: `${effectiveLeftWidth}px` }}
            >
                {leftPanel}
            </div>
            {!isLeftCollapsed && (
                <div
                    className="flex items-center justify-center w-1 bg-gray-300 resize-handle hover:w-1.5"
                    onMouseDown={startResizing}
                >
                    <GripVertical className="w-3 h-3 text-gray-500" />
                </div>
            )}
            <div className="flex-1 overflow-hidden">
                {rightPanel}
            </div>
        </div>
    );
};

// --- Compact NPC List Components ---

const CompactNpcListItem = ({ npc, isActive, onClick, onDelete }) => {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleDelete = (e) => {
        e.stopPropagation();
        setShowDeleteConfirm(true);
    };

    const confirmDelete = (e) => {
        e.stopPropagation();
        onDelete(npc);
        setShowDeleteConfirm(false);
    };

    const cancelDelete = (e) => {
        e.stopPropagation();
        setShowDeleteConfirm(false);
    };

    return (
        <div
            className={`npc-list-item group relative p-3 border-b border-gray-200 ${isActive ? 'active' : ''}`}
            onClick={onClick}
        >
            <div className="flex items-center space-x-3">
                <img
                    src={npc.imageUrl || 'https://placehold.co/64x64/4f46e5/ffffff?text=NPC'}
                    alt={npc.name}
                    className="object-cover w-12 h-12 rounded-md flex-shrink-0 bg-gray-200"
                />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                        <h4 className="font-semibold text-gray-900 truncate">{npc.name}</h4>
                        {npc.isSharedNPC && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded" title={`Shared by ${npc.sharedFrom?.userEmail}`}>
                                <User className="w-3 h-3 inline" />
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-indigo-600 truncate">{npc.structuredData.raceClass}</p>
                    {npc.chats && npc.chats.length > 0 && (
                        <p className="text-xs text-gray-500">{npc.chats.length} messages</p>
                    )}
                </div>
                {onDelete && !showDeleteConfirm ? (
                    <button
                        onClick={handleDelete}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all duration-200 flex-shrink-0 opacity-0 group-hover:opacity-100"
                        title="Delete NPC"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                ) : showDeleteConfirm ? (
                    <div className="flex items-center bg-white shadow-sm border border-gray-200 rounded-full overflow-hidden animate-slide-in">
                        <button
                            onClick={confirmDelete}
                            className="p-2 text-green-600 hover:bg-green-50 transition-colors"
                            title="Confirm Delete"
                        >
                            <Check className="w-4 h-4" />
                        </button>
                        <div className="w-px h-4 bg-gray-200"></div>
                        <button
                            onClick={cancelDelete}
                            className="p-2 text-gray-500 hover:bg-gray-50 transition-colors"
                            title="Cancel"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

const CompactNpcList = ({ npcs, sharedNpcs = [], selectedNpcId, onNpcSelected, onNpcDelete, onCreateNew, loading, isCollapsed, onToggleCollapse }) => {
    /**
     * Deletes an image from Cloudinary.
     */
    const deleteFromCloudinary = async (publicId) => {
        if (!publicId) return;

        console.log(`[${new Date().toISOString()}] Deleting image from Cloudinary: ${publicId}`);

        try {
            const response = await fetch('/.netlify/functions/delete-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicId })
            });

            const data = await response.json();

            if (data.result === 'ok') {
                console.log('Image deleted from Cloudinary successfully');
            } else {
                console.error('Failed to delete image from Cloudinary:', data);
            }
        } catch (error) {
            console.error('Error deleting image from Cloudinary:', error);
        }
    };

    const handleDelete = async (npc) => {
        try {
            // Delete image from Cloudinary if it exists
            if (npc.cloudinaryImageId) {
                await deleteFromCloudinary(npc.cloudinaryImageId);
            }
            onNpcDelete(npc);
        } catch (error) {
            console.error("Error deleting NPC:", error);
        }
    };

    if (isCollapsed) {
        return (
            <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
                <div className="flex items-center justify-center p-4 border-b border-gray-200 bg-white">
                    <button
                        onClick={onToggleCollapse}
                        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Expand sidebar"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                <div className="flex items-center space-x-2">
                    <List className="w-5 h-5 text-indigo-600" />
                    <h2 className="font-bold text-gray-900">My NPCs ({npcs.length})</h2>
                </div>
                <div className="flex items-center space-x-1">
                    <button
                        onClick={onCreateNew}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Create new NPC"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                    {/* Hide collapse button on mobile */}
                    <button
                        onClick={onToggleCollapse}
                        className="hidden md:block p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Collapse sidebar"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* NPC List */}
            <div className="flex-1 overflow-y-auto compact-npc-list">
                {loading ? (
                    <div className="flex items-center justify-center p-8">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                    </div>
                ) : npcs.length === 0 && sharedNpcs.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">
                        <p>No NPCs yet.</p>
                        <p className="mt-2">Click the <Plus className="w-4 h-4 inline" /> button to create your first one!</p>
                    </div>
                ) : (
                    <>
                        {/* My NPCs Section */}
                        {npcs.length > 0 && (
                            <div>
                                <div className="px-4 py-2 bg-gray-100 border-b border-gray-200">
                                    <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                                        My NPCs ({npcs.length})
                                    </h3>
                                </div>
                                {npcs.map(npc => (
                                    <CompactNpcListItem
                                        key={npc.id}
                                        npc={npc}
                                        isActive={npc.id === selectedNpcId}
                                        onClick={() => onNpcSelected(npc)}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Shared with Me Section */}
                        {sharedNpcs.length > 0 && (
                            <div>
                                <div className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                                    <h3 className="text-xs font-bold text-blue-700 uppercase tracking-wide flex items-center">
                                        <User className="w-3 h-3 mr-1" />
                                        Shared with Me ({sharedNpcs.length})
                                    </h3>
                                </div>
                                {sharedNpcs.map(npc => (
                                    <CompactNpcListItem
                                        key={npc.id}
                                        npc={npc}
                                        isActive={npc.id === selectedNpcId}
                                        onClick={() => onNpcSelected(npc)}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Feedback Button */}
            <div className="p-4 border-t border-gray-200 bg-white">
                <FeedbackButton />
            </div>
        </div>
    );
};


// --- NPC List Component (Unchanged) ---


const NpcList = ({ npcs, onNpcSelected, db, userId, loading }) => {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [npcToDelete, setNpcToDelete] = useState(null);

    const handleDeleteClick = (npc) => {
        setNpcToDelete(npc);
        setIsDeleteModalOpen(true);
    };

    /**
     * Deletes an image from Cloudinary.
     * @param {string} publicId - The public ID of the image to delete
     * @returns {Promise<void>}
     */
    const deleteFromCloudinary = async (publicId) => {
        if (!publicId) return;

        console.log(`[${new Date().toISOString()}] Deleting image from Cloudinary: ${publicId}`);

        try {
            const response = await fetch('/.netlify/functions/delete-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicId })
            });

            const data = await response.json();

            if (data.result === 'ok') {
                console.log('Image deleted from Cloudinary successfully');
            } else {
                console.error('Failed to delete image from Cloudinary:', data);
            }
        } catch (error) {
            console.error('Error deleting image from Cloudinary:', error);
        }
    };

    const confirmDelete = async () => {
        if (!npcToDelete) return;

        try {
            // Delete image from Cloudinary if it exists
            if (npcToDelete.cloudinaryImageId) {
                await deleteFromCloudinary(npcToDelete.cloudinaryImageId);
            }

            const npcRef = doc(db, npcCollectionPath(appId, userId), npcToDelete.id);
            await deleteDoc(npcRef);
            setIsDeleteModalOpen(false);
            setNpcToDelete(null);
        } catch (error) {
            console.error("Error deleting NPC:", error);
            console.warn("Failed to delete NPC. See console.");
        }
    };

    if (loading) return <LoadingIndicator />;

    return (
        <div className="p-4 space-y-4 bg-white rounded-lg shadow-xl md:p-8">
            <h2 className="flex items-center text-2xl font-bold text-indigo-700">
                <List className="w-6 h-6 mr-2" />
                My Saved NPCs ({npcs.length})
            </h2>
            <p className="text-sm text-gray-600">The chat history for these NPCs is stored in the database for persistence and sharing.</p>

            <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {npcs.map(npc => (
                    <div key={npc.id} className="p-4 transition-all duration-300 bg-gray-50 border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-indigo-300">
                        <img
                            // The image is not persisted, so we show a placeholder here
                            src={npc.imageUrl || 'https://placehold.co/400x200/4f46e5/ffffff?text=Image+Not+Saved'}
                            alt={npc.name}
                            className="object-contain w-full mb-3 rounded-lg aspect-square bg-gray-100"
                        />
                        <h3 className="text-lg font-bold text-gray-800">{npc.name}</h3>
                        <p className="text-sm italic text-indigo-600">{npc.structuredData.raceClass}</p>
                        <p className="mt-2 text-sm text-gray-600 line-clamp-2">{npc.structuredData.personality}</p>
                        <p className="mt-1 text-xs font-mono text-gray-400">ID: {npc.id.substring(0, 6)}...</p>

                        <div className="flex justify-between mt-4">
                            <Button
                                onClick={() => onNpcSelected(npc)}
                                icon={MessageSquare}
                                className="px-3 py-1 text-sm"
                            >
                                Open Chat
                            </Button>
                            <Button
                                onClick={() => handleDeleteClick(npc)}
                                icon={Trash2}
                                className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600"
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
            {npcs.length === 0 && (
                <div className="p-10 text-center text-gray-500 bg-gray-100 rounded-lg">
                    No NPCs found. Go to the "New NPC" tab to create your first one!
                </div>
            )}

            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                title="Delete NPC"
                message={`Are you sure you want to permanently delete "${npcToDelete?.name}"? This action cannot be undone.`}
            />
        </div>
    );
};

// --- Main Application Component (Unchanged) ---


const NPCGeneratorChatbot = ({ user, impersonatedUserId, onShowAdmin }) => {
    // Use impersonated user ID if set, otherwise use actual user ID
    const userId = impersonatedUserId || user.uid;
    const isAuthReady = true;

    const { npcs, loading } = useNPCs(db, userId, isAuthReady);
    const { sharedNpcs, loading: sharedLoading } = useSharedNPCs(db, userId, isAuthReady);

    // Combine owned and shared NPCs
    const allNpcs = useMemo(() => {
        return [...npcs, ...sharedNpcs];
    }, [npcs, sharedNpcs]);

    const isLoadingNpcs = loading || sharedLoading;

    // Retrieve API key from environment variables
    const apiKey = null; // API Key removed. Using Netlify Functions.

    const [selectedNpcId, setSelectedNpcId] = useState(null);
    const [showCreateForm, setShowCreateForm] = useState(false);

    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [showGoldStore, setShowGoldStore] = useState(false);
    const [isGoldGlittering, setIsGoldGlittering] = useState(false);
    const [credits, setCredits] = useState(0); // State to store displayed credits

    // Fetch credits on load
    useEffect(() => {
        if (userId) {
            getCredits(userId).then(setCredits);
        }
    }, [userId]);

    // Wrapper for deducting credits with animation and state update
    const handleDeductCredits = async (amount) => {
        const newBalance = await deductCredits(userId, amount);
        setCredits(newBalance); // Update displayed balance
        setIsGoldGlittering(true);
        setTimeout(() => setIsGoldGlittering(false), 500);
    };

    const handleCloseGoldStore = () => {
        setShowGoldStore(false);
        // Refetch credits in case user bought more
        if (userId) {
            getCredits(userId).then(setCredits);
        }
    };

    // Mobile state management
    const [isMobile, setIsMobile] = useState(false);
    const [mobileView, setMobileView] = useState('list'); // 'list', 'details', 'conversation'

    // Tip rotation state - changes when entering a new NPC with empty chat
    const [currentTipIndex, setCurrentTipIndex] = useState(0);

    // Detect mobile screen size
    useEffect(() => {
        const mediaQuery = window.matchMedia('(max-width: 768px)');

        const handleMediaChange = (e) => {
            setIsMobile(e.matches);
            // Reset to list view when switching to mobile
            if (e.matches && mobileView !== 'list' && !selectedNpcId) {
                setMobileView('list');
            }
        };

        // Set initial value
        setIsMobile(mediaQuery.matches);

        // Listen for changes
        mediaQuery.addEventListener('change', handleMediaChange);
        return () => mediaQuery.removeEventListener('change', handleMediaChange);
    }, []);

    // Change tip when entering an NPC with empty discussion
    useEffect(() => {
        if (selectedNpc && (!selectedNpc.chats || selectedNpc.chats.length === 0)) {
            // Cycle to next tip when entering an NPC with empty chat
            setCurrentTipIndex((prevIndex) => (prevIndex + 1) % TIPS.length);
        }
    }, [selectedNpcId]);

    // Derive the selected NPC object from the live list
    const selectedNpc = useMemo(() => {
        return allNpcs.find(n => n.id === selectedNpcId) || null;
    }, [allNpcs, selectedNpcId]);

    const handleNpcSelected = (npc) => {
        setSelectedNpcId(npc.id);
        setShowCreateForm(false);
        // On mobile, navigate to details view
        if (isMobile) {
            setMobileView('details');
        }
    };

    const handleCreateNew = () => {
        if (npcs.length >= 10) {
            alert("You have reached the limit of 10 NPCs. Please delete an NPC before creating a new one.");
            return;
        }
        setSelectedNpcId(null);
        setShowCreateForm(true);
        // On mobile, show the create form by setting view to 'details'
        if (isMobile) {
            setMobileView('details'); // Changed from 'list' to 'details' to show create form
        }
    };

    const handleNpcCreated = (newNpcId) => {
        setShowCreateForm(false);
        setSelectedNpcId(newNpcId);
        // On mobile, navigate to details view
        if (isMobile) {
            setMobileView('details');
        }
    };

    const handleNpcDelete = async (npc) => {
        if (!db) return;

        try {
            // Use the correct collection path based on NPC type
            const collectionPath = npc.isSharedNPC ? sharedNpcCollectionPath(appId, userId) : npcCollectionPath(appId, userId);
            const npcRef = doc(db, collectionPath, npc.id);
            await deleteDoc(npcRef);

            // If the deleted NPC was selected, clear selection
            if (selectedNpcId === npc.id) {
                setSelectedNpcId(null);
                // On mobile, return to list view
                if (isMobile) {
                    setMobileView('list');
                }
            }
        } catch (error) {
            console.error("Error deleting NPC:", error);
        }
    };

    // Mobile navigation handlers
    const handleBackToList = () => {
        setSelectedNpcId(null);
        setMobileView('list');
    };

    const handleShowConversation = () => {
        setMobileView('conversation');
    };

    const handleShowDetails = () => {
        setMobileView('details');
    };

    // Right panel content
    let rightPanelContent;
    if (!isAuthReady) {
        rightPanelContent = (
            <div className="flex items-center justify-center h-full bg-white">
                <LoadingIndicator />
            </div>
        );
    } else if (selectedNpc) {
        rightPanelContent = (
            <NpcChat
                db={db}
                userId={userId}
                userEmail={user?.email}
                npc={selectedNpc}
                onBack={handleBackToList}
                isMobile={isMobile}
                mobileView={mobileView}
                onShowConversation={handleShowConversation}
                onShowDetails={handleShowDetails}
                currentTip={TIPS[currentTipIndex]}
                handleDeductCredits={handleDeductCredits}
            />
        );
    } else {
        // Empty state
        rightPanelContent = (
            <div className="flex items-center justify-center h-full bg-white">
                <div className="text-center p-8">
                    <User className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">No NPC Selected</h3>
                    <p className="text-gray-500 mb-6">Select an NPC from the sidebar to start chatting, or create a new one.</p>
                    <Button
                        onClick={handleCreateNew}
                        icon={Plus}
                        className="px-6 py-3 text-lg mx-auto"
                    >
                        Create New NPC
                    </Button>


                </div>
            </div >
        );
    }

    // Left panel content
    const leftPanelContent = (
        <CompactNpcList
            npcs={npcs}
            sharedNpcs={sharedNpcs}
            selectedNpcId={selectedNpc?.id}
            onNpcSelected={handleNpcSelected}
            onNpcDelete={handleNpcDelete}
            onCreateNew={handleCreateNew}
            loading={isLoadingNpcs}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />
    );

    // Mobile rendering: full-screen views
    if (isMobile) {
        return (
            <div className="flex flex-col h-screen font-sans bg-gray-100">
                {/* Only show header on list view */}
                {(mobileView === 'list' || (!selectedNpc && !showCreateForm)) && (
                    <header className="flex-shrink-0 p-4 bg-white border-b border-gray-200 shadow-sm">
                        <div className="flex items-start justify-between">
                            <div>
                                <h1 className="flex items-center text-xl font-extrabold text-indigo-800">
                                    <User className="w-6 h-6 mr-2 text-indigo-500" />
                                    Drive My Character
                                </h1>
                                <p className="mt-1 text-xs text-gray-600">
                                    Roleplay with your NPCs.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowGoldStore(true)}
                                className={`group flex-shrink-0 ml-2 px-3 py-1.5 text-gray-700 hover:text-yellow-300 font-bold text-sm rounded-full transition-all duration-300 flex items-center bg-gray-50 hover:bg-gray-600 border border-gray-200 hover:border-gray-500 ${isGoldGlittering ? 'animate-gold-pulse text-yellow-600' : ''}`}
                            >
                                <Coins className={`w-4 h-4 mr-1.5 text-yellow-500 group-hover:text-yellow-300 ${isGoldGlittering ? 'text-yellow-500' : ''}`} />
                                {credits}
                            </button>
                        </div>
                    </header>
                )}

                <div className="flex-1 overflow-hidden">
                    {mobileView === 'list' || !selectedNpc ? (
                        // Show NPC list
                        leftPanelContent
                    ) : (
                        // Show NPC details or conversation
                        rightPanelContent
                    )}
                </div>

                {showGoldStore && (
                    <GoldStoreModal
                        userId={userId}
                        onClose={handleCloseGoldStore}
                    />
                )}

                {showCreateForm && (
                    <NpcCreation
                        db={db}
                        userId={userId}
                        handleDeductCredits={handleDeductCredits}
                        onNpcCreated={handleNpcCreated}
                        onCancel={() => setShowCreateForm(false)}
                    />
                )}
            </div>
        );
    }

    // Desktop rendering: ResizablePanels
    return (
        <div className="flex flex-col h-screen font-sans bg-gray-100">
            <header className="flex-shrink-0 p-4 bg-white border-b border-gray-200 shadow-sm">
                <div className="flex flex-col justify-between md:flex-row md:items-center">
                    <div>
                        <h1 className="flex items-center text-2xl font-extrabold text-indigo-800">
                            <User className="w-7 h-7 mr-2 text-indigo-500" />
                            Drive My Character
                        </h1>
                        <p className="mt-1 text-xs text-gray-600">
                            Roleplay with your NPCs.
                        </p>
                    </div>

                    {/* Admin Button - only show if user is admin and not impersonating */}
                    <div className="flex items-center">
                        <button
                            onClick={() => setShowGoldStore(true)}
                            className={`group mt-2 md:mt-0 mr-4 px-3 py-1.5 text-gray-700 hover:text-yellow-300 font-bold text-sm rounded-full transition-all duration-300 flex items-center hover:bg-gray-600 border border-transparent hover:border-gray-500 ${isGoldGlittering ? 'animate-gold-pulse text-yellow-600' : ''}`}
                            title="My Gold"
                        >
                            <Coins className={`w-4 h-4 mr-1.5 text-yellow-500 group-hover:text-yellow-300 ${isGoldGlittering ? 'text-yellow-500' : ''}`} />
                            {credits}
                        </button>

                        {user?.email === import.meta.env.VITE_ADMIN_EMAIL && !impersonatedUserId && onShowAdmin && (
                            <button
                                onClick={onShowAdmin}
                                className="mt-2 md:mt-0 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
                            >
                                Admin Dashboard
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {showGoldStore && (
                <GoldStoreModal
                    userId={userId}
                    onClose={handleCloseGoldStore}
                />
            )}

            {showCreateForm && (
                <NpcCreation
                    db={db}
                    userId={userId}
                    handleDeductCredits={handleDeductCredits}
                    onNpcCreated={handleNpcCreated}
                    onCancel={() => setShowCreateForm(false)}
                />
            )}

            <div className="flex-1 overflow-hidden">
                <ResizablePanels
                    leftPanel={leftPanelContent}
                    rightPanel={rightPanelContent}
                    isLeftCollapsed={isSidebarCollapsed}
                />
            </div>
        </div >
    );
};

export default NPCGeneratorChatbot; 