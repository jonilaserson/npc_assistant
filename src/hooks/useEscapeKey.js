import { useEffect } from 'react';

/**
 * Custom hook to handle ESC key press
 * @param {Function} onEscape - Callback function to execute when ESC is pressed
 * @param {boolean} enabled - Whether the hook is enabled (default: true)
 */
export const useEscapeKey = (onEscape, enabled = true) => {
    useEffect(() => {
        if (!enabled || !onEscape) return;

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                onEscape();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [onEscape, enabled]);
};
