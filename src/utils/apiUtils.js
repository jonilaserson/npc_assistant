/**
 * Utility for making fetch requests with exponential backoff.
 */
export const fetchWithBackoff = async (url, options, retries = 3, backoff = 1000) => {
    try {
        const response = await fetch(url, options);

        // 429 Too Many Requests - specific handling
        if (response.status === 429 && retries > 0) {
            console.warn(`Rate limited (429). Retrying in ${backoff}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithBackoff(url, options, retries - 1, backoff * 2);
        }

        // 503 Service Unavailable or 504 Gateway Timeout - transient errors
        if ((response.status === 503 || response.status === 504) && retries > 0) {
            console.warn(`Server error (${response.status}). Retrying in ${backoff}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithBackoff(url, options, retries - 1, backoff * 2);
        }

        // Other errors are returned as-is
        return response;
    } catch (error) {
        if (retries > 0) {
            console.warn(`Fetch error: ${error.message}. Retrying in ${backoff}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithBackoff(url, options, retries - 1, backoff * 2);
        }
        throw error;
    }
};
