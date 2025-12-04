// Helper function to extract sorting criteria from voice string
const parseVoice = (voiceStr) => {
    const match = voiceStr.match(/^(\w+) \((\w+), (\w+),/);
    if (!match) return { name: voiceStr, gender: 'Unknown', age: 'Unknown' };
    return {
        name: match[1],
        gender: match[2],
        age: match[3]
    };
};

// Define sort order for age
const ageOrder = { 'Young': 1, 'Adult': 2, 'Mature': 3 };

// Sort voices: Female first, then Male; within gender: Young, Adult, Mature; within age: alphabetically
const sortedVoices = [
    "Achernar (Male, Adult, Friendly, Engaging, Enthusiastic)",
    "Achird (Female, Young, Inquisitive, Friendly, Breathy)",
    "Algenib (Female, Mature, Warm, Confident, Authoritative)",
    "Algieba (Male, Deep, Resonant)",
    "Alnilam (Male, Adult, Energetic, Exciting, Direct)",
    "Aoede (Female, Adult, Clear, Conversational, Thoughtful, Intelligent)",
    "Autonoe (Male, Mature, Deep, Resonant, Wise, Calm)",
    "Callirrhoe (Female, Adult, Confident, Professional, Articulate)",
    "Charon (Male, Adult, Smooth, Conversational, Trustworthy, Gentle)",
    "Despina (Female, Adult, Warm, Inviting, Friendly, Smooth)",
    "Enceladus (Male, Adult, Energetic, Enthusiastic, Impactful)",
    "Erinome (Female, Adult, Professional, Articulate, Thoughtful, Sophisticated)",
    "Fenrir (Male, Adult, Friendly, Conversational, Approachable)",
    "Gacrux (Male, Mature, Smooth, Confident, Authoritative, Experienced)",
    "Iapetus (Male, Adult, Friendly, Casual, Approachable, Relatable)",
    "Kore (Female, Young, Energetic, Confident, Enthusiastic, Bright)",
    "Laomedeia (Female, Adult, Clear, Conversational, Inquisitive, Intelligent)",
    "Leda (Female, Mature, Composed, Professional, Authoritative, Sophisticated)",
    "Orus (Male, Mature, Deep, Resonant, Thoughtful, Wise, Calm)",
    "Puck (Male, Adult, Clear, Confident, Approachable, Trustworthy)",
    "Pulcherrima (Female, Young, Bright, Energetic, Enthusiastic, Upbeat)",
    "Rasalgethi (Male, Adult, Conversational, Inquisitive, Quirky, Thoughtful)",
    "Sadachbia (Male, Mature, Deep, Cool, Confident, Gravitas, Distinctive)",
    "Sadaltager (Male, Adult, Friendly, Enthusiastic, Professional, Articulate)",
    "Schedar (Male, Adult, Friendly, Informal, Approachable, Relatable)",
    "Sulafat (Female, Adult, Warm, Confident, Persuasive, Intelligent)",
    "Umbriel (Male, Mature, Smooth, Authoritative, Friendly, Trustworthy)",
    "Vindemiatrix (Female, Mature, Calm, Thoughtful, Wise, Reassuring)",
    "Zephyr (Female, Young, Energetic, Bright, Enthusiastic, Positive)",
    "Zubenelgenubi (Male, Mature, Deep, Resonant, Authoritative, Serious, Powerful)"
].sort((a, b) => {
    const voiceA = parseVoice(a);
    const voiceB = parseVoice(b);

    // Sort by gender (Female before Male)
    if (voiceA.gender !== voiceB.gender) {
        return voiceA.gender === 'Female' ? -1 : 1;
    }

    // Within same gender, sort by age
    const ageA = ageOrder[voiceA.age] || 999;
    const ageB = ageOrder[voiceB.age] || 999;
    if (ageA !== ageB) {
        return ageA - ageB;
    }

    // Within same gender and age, sort alphabetically by name
    return voiceA.name.localeCompare(voiceB.name);
});

export const AVAILABLE_VOICES = sortedVoices;
