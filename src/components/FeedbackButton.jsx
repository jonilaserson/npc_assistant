import React, { useState } from 'react';
import { MessageSquare, X, Send } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

export const FeedbackButton = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!feedback.trim() || isSubmitting) return;

        setIsSubmitting(true);
        try {
            await addDoc(collection(db, 'feedback'), {
                userId: auth.currentUser?.uid,
                email: auth.currentUser?.email,
                message: feedback,
                timestamp: serverTimestamp()
            });

            setSubmitted(true);
            setTimeout(() => {
                setIsOpen(false);
                setSubmitted(false);
                setFeedback('');
            }, 2000);
        } catch (error) {
            console.error('Error submitting feedback:', error);
            alert('Failed to submit feedback. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSubmit();
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="w-full mt-4 flex items-center justify-center px-4 py-2 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                title="Send feedback or report issues"
            >
                <MessageSquare className="w-4 h-4 mr-2" />
                Send Feedback
            </button>

            {isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setIsOpen(false)}>
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-gray-900">Send Feedback</h3>
                            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        {submitted ? (
                            <div className="text-center py-8">
                                <div className="text-green-600 text-lg font-semibold mb-2">✓ Thank you!</div>
                                <p className="text-gray-600">Your feedback has been received.</p>
                            </div>
                        ) : (
                            <>
                                <textarea
                                    value={feedback}
                                    onChange={(e) => setFeedback(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Share your thoughts, report bugs, or request features..."
                                    className="w-full p-3 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                                    rows={5}
                                    autoFocus
                                    disabled={isSubmitting}
                                />
                                <div className="flex justify-between items-center">
                                    <p className="text-xs text-gray-500">Press Cmd+Enter to submit</p>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={!feedback.trim() || isSubmitting}
                                        className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isSubmitting ? (
                                            <>Sending...</>
                                        ) : (
                                            <>
                                                <Send className="w-4 h-4 mr-2" />
                                                Submit
                                            </>
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};
