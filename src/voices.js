// Unified voice configuration for Gemini and ElevenLabs TTS

// Gemini voices with their original descriptors
const GEMINI_VOICES = [
    { name: "Achernar", gender: "Male", age: "Adult", descriptors: "Friendly, Engaging, Enthusiastic" },
    { name: "Achird", gender: "Female", age: "Young", descriptors: "Inquisitive, Friendly, Breathy" },
    { name: "Algenib", gender: "Female", age: "Mature", descriptors: "Warm, Confident, Authoritative" },
    { name: "Algieba", gender: "Male", age: "Adult", descriptors: "Deep, Resonant" },
    { name: "Alnilam", gender: "Male", age: "Adult", descriptors: "Energetic, Exciting, Direct" },
    { name: "Aoede", gender: "Female", age: "Adult", descriptors: "Clear, Conversational, Thoughtful, Intelligent" },
    { name: "Autonoe", gender: "Male", age: "Mature", descriptors: "Deep, Resonant, Wise, Calm" },
    { name: "Callirrhoe", gender: "Female", age: "Adult", descriptors: "Confident, Professional, Articulate" },
    { name: "Charon", gender: "Male", age: "Adult", descriptors: "Smooth, Conversational, Trustworthy, Gentle" },
    { name: "Despina", gender: "Female", age: "Adult", descriptors: "Warm, Inviting, Friendly, Smooth" },
    { name: "Enceladus", gender: "Male", age: "Adult", descriptors: "Energetic, Enthusiastic, Impactful" },
    { name: "Erinome", gender: "Female", age: "Adult", descriptors: "Professional, Articulate, Thoughtful, Sophisticated" },
    { name: "Fenrir", gender: "Male", age: "Adult", descriptors: "Friendly, Conversational, Approachable" },
    { name: "Gacrux", gender: "Male", age: "Mature", descriptors: "Smooth, Confident, Authoritative, Experienced" },
    { name: "Iapetus", gender: "Male", age: "Adult", descriptors: "Friendly, Casual, Approachable, Relatable" },
    { name: "Kore", gender: "Female", age: "Young", descriptors: "Energetic, Confident, Enthusiastic, Bright" },
    { name: "Laomedeia", gender: "Female", age: "Adult", descriptors: "Clear, Conversational, Inquisitive, Intelligent" },
    { name: "Leda", gender: "Female", age: "Mature", descriptors: "Composed, Professional, Authoritative, Sophisticated" },
    { name: "Orus", gender: "Male", age: "Mature", descriptors: "Deep, Resonant, Thoughtful, Wise, Calm" },
    { name: "Puck", gender: "Male", age: "Adult", descriptors: "Clear, Confident, Approachable, Trustworthy" },
    { name: "Pulcherrima", gender: "Female", age: "Young", descriptors: "Bright, Energetic, Enthusiastic, Upbeat" },
    { name: "Rasalgethi", gender: "Male", age: "Adult", descriptors: "Conversational, Inquisitive, Quirky, Thoughtful" },
    { name: "Sadachbia", gender: "Male", age: "Mature", descriptors: "Deep, Cool, Confident, Gravitas, Distinctive" },
    { name: "Sadaltager", gender: "Male", age: "Adult", descriptors: "Friendly, Enthusiastic, Professional, Articulate" },
    { name: "Schedar", gender: "Male", age: "Adult", descriptors: "Friendly, Informal, Approachable, Relatable" },
    { name: "Sulafat", gender: "Female", age: "Adult", descriptors: "Warm, Confident, Persuasive, Intelligent" },
    { name: "Umbriel", gender: "Male", age: "Mature", descriptors: "Smooth, Authoritative, Friendly, Trustworthy" },
    { name: "Vindemiatrix", gender: "Female", age: "Mature", descriptors: "Calm, Thoughtful, Wise, Reassuring" },
    { name: "Zephyr", gender: "Female", age: "Young", descriptors: "Energetic, Bright, Enthusiastic, Positive" },
    { name: "Zubenelgenubi", gender: "Male", age: "Mature", descriptors: "Deep, Resonant, Authoritative, Serious, Powerful" }
];

// ElevenLabs voices from CSV
const ELEVENLABS_VOICES = [
    { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", gender: "Male", age: "Adult", accent: "American", description: "Easy going and perfect for casual conversations" },
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "Female", age: "Young", accent: "American", description: "Confident and warm, mature quality, reassuring, professional" },
    { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "Female", age: "Young", accent: "American", description: "Sunny enthusiasm with a quirky attitude" },
    { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", gender: "Male", age: "Young", accent: "Australian", description: "Confident and energetic" },
    { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "Male", age: "Adult", accent: "British", description: "Warm resonance that instantly captivates listeners" },
    { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", gender: "Male", age: "Adult", accent: "American", description: "Deceptively gravelly, yet unsettling edge" },
    { id: "SAz9YHcvj6GT2YYXdXww", name: "River", gender: "Neutral", age: "Adult", accent: "American", description: "Relaxed, neutral voice ready for narrations or conversational projects" },
    { id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry", gender: "Male", age: "Young", accent: "American", description: "Animated warrior ready to charge forward" },
    { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "Male", age: "Young", accent: "American", description: "Energy and warmth - suitable for reels and shorts" },
    { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", gender: "Female", age: "Adult", accent: "British", description: "Clear and engaging, friendly, suitable for e-learning" },
    { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "Female", age: "Adult", accent: "American", description: "Professional with a pleasing alto pitch" },
    { id: "bIHbv24MWmeRgasZH58o", name: "Will", gender: "Male", age: "Young", accent: "American", description: "Conversational and laid back" },
    { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "Female", age: "Young", accent: "American", description: "Young and popular, playful, perfect for trendy content" },
    { id: "cjVigY5qzO86Huf0OWal", name: "Eric", gender: "Male", age: "Adult", accent: "American", description: "Smooth tenor pitch, perfect for agentic use cases" },
    { id: "iP95p4xoKVk53GoZ742B", name: "Chris", gender: "Male", age: "Adult", accent: "American", description: "Natural and real, down-to-earth" },
    { id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "Male", age: "Adult", accent: "American", description: "Resonant and comforting tone, great for narrations" },
    { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "Male", age: "Adult", accent: "British", description: "Strong voice for professional broadcast or news" },
    { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", gender: "Female", age: "Adult", accent: "British", description: "Velvety British female, warmth and clarity" },
    { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "Male", age: "Adult", accent: "American", description: "Bright tenor, brash and openly confident" },
    { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", gender: "Male", age: "Mature", accent: "American", description: "Friendly and comforting" },
    { id: "SpzUGWa5UHDAUbr0ya82", name: "French Sage", gender: "Male", age: "Mature", accent: "French", description: "Wise elderly French male, patient and wise" },
    { id: "xYWUvKNK6zWCgsdAK7Wi", name: "Reptilian Monster", gender: "Male", age: "Adult", accent: "Arabic", description: "Deep, reptilian, sinister tone for horror and dark fantasy" },
    { id: "wXvR48IpOq9HACltTmt7", name: "Ancient Monster", gender: "Male", age: "Mature", accent: "American", description: "Deep, menacing, otherworldly for horror" },
    { id: "7NsaqHdLuKNFvEfjpUno", name: "Seer Morganna", gender: "Female", age: "Mature", accent: "Neutral", description: "Old wise seer woman, fortunes and animations" },
    { id: "pPdl9cQBQq4p6mRkZy2Z", name: "Emma", gender: "Female", age: "Young", accent: "American", description: "Adorable, perfect for animation projects" },
    { id: "flHkNRp1BlvT73UL6gyz", name: "Jessica Villain", gender: "Female", age: "Adult", accent: "American", description: "Wickedly eloquent, calculating, cruel and calm" },
    { id: "TC0Zp7WVFzhA8zpTlRqV", name: "Aria", gender: "Female", age: "Young", accent: "American", description: "Dark velvet, sultry tones for villain or seductress" },
    { id: "PPzYpIqttlTYA83688JI", name: "Pirate Marshal", gender: "Male", age: "Adult", accent: "British", description: "Jovial and exuberant sea dog, Cornwall accent" },
    { id: "ZF6FPAbjXT4488VcRRnw", name: "Amelia", gender: "Female", age: "Young", accent: "British", description: "Clear, expressive and enthusiastic British" },
    { id: "EiNlNiXeDU1pqqOPrYMO", name: "John Doe", gender: "Male", age: "Adult", accent: "American", description: "Very deep voice, perfect for audiobooks" }
];

// Google Cloud Neural2 Voices
// Google Cloud Voices (Chirp 3 HD) mapped directly from Gemini definitions below

// Create unified voice objects
const VOICES = [
    // Gemini voices (Mapped to Google Chirp 3 HD)
    ...GEMINI_VOICES.map(v => ({
        id: `en-US-Chirp3-HD-${v.name}`, // Use Google ID
        name: v.name, // Keep short name for lookup
        displayName: `${v.name} (${v.gender}, ${v.age}, ${v.descriptors})`, // Original Gemini description
        provider: "google", // Route to Google TTS
        gender: v.gender.toLowerCase(),
        age: v.age.toLowerCase(),
        description: v.descriptors
    })),
    // ElevenLabs voices
    ...ELEVENLABS_VOICES.map(v => ({
        id: v.id,
        name: v.name,
        displayName: v.accent
            ? `${v.name} (${v.gender}, ${v.age}, ${v.accent}, ${v.description})`
            : `${v.name} (${v.gender}, ${v.age}, ${v.description})`,
        provider: "elevenlabs",
        gender: v.gender.toLowerCase(),
        age: v.age.toLowerCase(),
        accent: v.accent?.toLowerCase(),
        description: v.description
    }))
];

// Define sort order for age
const ageOrder = { 'young': 1, 'adult': 2, 'mature': 3 };

// Sort voices: Female first, then Male, then Neutral; within gender: Young, Adult, Mature; within age: alphabetically
const sortedVoices = VOICES.sort((a, b) => {
    // Sort by gender (Female before Male before Neutral)
    const genderOrder = { 'female': 1, 'male': 2, 'neutral': 3 };
    const genderA = genderOrder[a.gender] || 999;
    const genderB = genderOrder[b.gender] || 999;

    if (genderA !== genderB) {
        return genderA - genderB;
    }

    // Within same gender, sort by age
    const ageA = ageOrder[a.age] || 999;
    const ageB = ageOrder[b.age] || 999;
    if (ageA !== ageB) {
        return ageA - ageB;
    }

    // Within same gender and age, sort alphabetically by name
    return a.name.localeCompare(b.name);
});

// Export for LLM (backward compatible - just the display names)
export const AVAILABLE_VOICES = sortedVoices.map(v => v.displayName);

// Export full voice data for lookup
export const VOICE_DATA = sortedVoices;

/**
 * Get voice data by name or ID
 * @param {string} nameOrId - Voice name or ID
 * @returns {object|null} Voice data object or null if not found
 */
export const getVoiceById = (nameOrId) => {
    if (!nameOrId) return null;

    const searchTerm = nameOrId.trim();

    return VOICE_DATA.find(v =>
        v.name === searchTerm ||
        v.id === searchTerm ||
        v.displayName === searchTerm ||
        v.displayName.startsWith(searchTerm + ' ')
    ) || null;
};
