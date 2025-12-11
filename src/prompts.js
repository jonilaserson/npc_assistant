/**
 * Constants and Prompt Generators for NPC Assistant
 */

export const TIPS = [
    { text: 'Type', code: '/scene', suffix: 'to set a scene at any time' },
    { text: 'Describe your character\'s actions using square brackets', code: '[like this]', suffix: '' },
    { text: 'Try typing', code: '[Describe the NPC\'s internal monologue]', suffix: '— you might be surprised!' },
];

export const VOICE_SELECTION_GUIDELINES = `Voice Selection Guidelines:
Match the voice to the character by considering:

1. GENDER: Choose a voice that matches the character's gender

2. AGE: Match voice maturity to character age
   - Young/Child → Young, Youthful voices
   - Young Adult → Adult voices with energetic qualities
   - Adult/Middle-aged → Adult, Mature voices
   - Old/Elderly → Mature, Wise, Deep voices

3. PERSONALITY & DEMEANOR: Match voice qualities to character traits
   - Friendly/Warm/Kind → Friendly, Warm, Engaging, Approachable
   - Authoritative/Leader/Noble → Authoritative, Confident, Professional, Powerful
   - Wise/Scholarly/Calm → Thoughtful, Wise, Calm, Intelligent
   - Energetic/Enthusiastic/Cheerful → Energetic, Bright, Enthusiastic, Upbeat
   - Mysterious/Cool/Edgy → Deep, Cool, Distinctive, Gravitas
   - Professional/Formal → Professional, Articulate, Composed
   - Casual/Relaxed → Casual, Conversational, Relatable
   - Gruff/Tough/Serious → Deep, Resonant, Serious, Powerful

Examples:
- Old male wizard (wise, authoritative) → Autonoe or Orus
- Young energetic female bard → Pulcherrima or Kore
- Gruff male warrior → Sadachbia or Zubenelgenubi
- Friendly female shopkeeper → Despina or Aoede
- Mysterious male rogue → Sadachbia or Charon
- Noble female leader → Leda or Algenib
- Enthusiastic young male adventurer → Enceladus or Alnilam`;

export const getStructuredNPCPrompt = (description, availableVoices) => {
    return {
        userQuery: `Convert the following raw description into a structured NPC profile suitable for a Dungeons and Dragons style setting. Focus only on the content and adhere strictly to the provided JSON schema. If the user hasn't provided a name, make up a suitable name for the NPC. Raw Description: "${description}"`,
        systemPrompt: `You are a professional RPG game assistant. Your task is to analyze the provided text and output a complete JSON object based on the schema.

            CRITICAL: You must select the most appropriate voice for this character from the following list of available voices.

            Available Voices:
            ${availableVoices.join("\n")}

            ${VOICE_SELECTION_GUIDELINES}
            
            IMPORTANT: Select your TOP 3 best matching voices.
            Return them as a list in the 'voiceCandidates' field.`
    };
};

export const getSceneGenerationPrompt = (npcData, conversationHistory = null) => {
    // Build conversation history section if available
    let conversationSection = '';
    if (conversationHistory && conversationHistory.length > 0) {
        // Find the most recent scene
        let previousSceneText = '';
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
            if (conversationHistory[i].role === 'scene') {
                previousSceneText = conversationHistory[i].text;
                break;
            }
        }

        // Get last 10 messages (should cover ~5 per side), excluding scene messages
        const recentMessages = conversationHistory.slice(-10)
            .filter(msg => msg.role !== 'scene') // Exclude scenes since we show previous scene separately
            .map(msg => {
                if (msg.role === 'user') return `User: ${msg.text}`;
                if (msg.role === 'npc' || msg.role === 'assistant') return `${npcData.name}: ${msg.text}`;
                return '';
            })
            .filter(m => m)
            .join('\n');

        conversationSection = `
    ${previousSceneText ? `Previous Scene:
    ${previousSceneText}
    
    ` : ''}Recent Conversation (last ~5 exchanges):
    ${recentMessages}
    `;
    }

    const systemPrompt = `You are a creative Dungeon Master helper. Your task is to generate a concise scene for a roleplay conversation with the following NPC.
    
    NPC: ${npcData.name} (${npcData.raceClass})
    Personality: ${npcData.personality}
    Principal Desire/Want: ${npcData.wants}${conversationSection}
    
    Output Format:
    Setting: [Where the scene takes place, time of day if relevant${conversationHistory && conversationHistory.length > 0 ? ', and how much time passed since the previous scene if there was a time skip' : ''}. May include brief atmospheric details like weather, sounds, or smells if relevant]

    Context: [What the NPC is doing and how the User encountered them, or the development that arised in the conclusion of the previous scene]

    Goal: [A specific objective for the User to achieve in this conversation scene]
    
    Requirements:
    - Keep all three sections short (max 1 sentence each).
    - Separate the three sections (Setting, Context, Goal) with an empty line between them.
    ${conversationHistory && conversationHistory.length > 0 ? '- The new scene should take place some time after the events in the conversation so far, and offer a fresh, *new* direction or development. The goal should also be a different type of challenge from the previous scene. A reasonable time skip is acceptable.' : ''}
    - Make the Goal be something the NPC could provide or assist with, but requires some effort or convincing from the user.
    - Do not use markdown bolding in the output logic, just plain text headers are fine.
    - Refer to the user's character as "your character".
    `;

    return systemPrompt;
};

export const getImageGenerationPrompt = (name, raceClass, visualDescription, gender, ageRange, personality) => {
    return `You are now working as a professional DALL-E artist, who knows all the little tricks to make the perfect image. Your task is to create the PERFECT prompt that will encapsulate this NPC the best for DALL-E image generation.

Character Information:
- Name: ${name}
- Race/Class: ${raceClass}
- Gender: ${gender}
- Age Range: ${ageRange}
- Visual Description: ${visualDescription || 'Not provided'}
- Personality: ${personality}

Create a detailed, vivid DALL-E prompt that will generate a portrait that perfectly captures this character. The prompt should:
1. Focus on visual details that bring the character to life
2. Include appropriate art style directions (Dungeons and Dragons fantasy art, dramatic lighting, professional illustration)
3. Ensure the character is centered and fills the frame
4. Incorporate personality traits into visual cues where appropriate
5. Be specific about physical appearance, clothing, equipment, and atmosphere
6. Use the following style: Dungeons and Dragons fantasy art, dramatic lighting, professional illustration
7. The resulting should be an image without any textual labels or overlays other than a single portrait of the character.
8. CRITICAL: The generated prompt MUST be less than 700 characters in length.
Respond with ONLY the prompt text, nothing else.`;
};

export const getImageSystemInstruction = () => {
    return `You are an expert DALL-E prompt engineer specializing in fantasy character art. Your task is to create the most effective prompt possible to generate a stunning character portrait. Be specific, vivid, and focus on visual details that will translate well to image generation.`;
};

export const getImageFallbackPrompt = (name, gender, ageRange, raceClass, description) => {
    return `Create a portrait of ${name}, a ${gender} ${ageRange} ${raceClass}. ${description || ''} The character should be centered and fill the frame. Style: Dungeons and Dragons fantasy art, dramatic lighting, professional illustration.`;
};

export const getRoleplaySystemPrompt = (structuredData, currentGoal = null) => {
    let systemPrompt = `You are roleplaying as the NPC named ${structuredData.name}.
        - **Race/Class:** ${structuredData.raceClass}
        - **Gender/Age:** ${structuredData.gender} ${structuredData.ageRange}
        - **Personality:** ${structuredData.personality}
        - **Wants:** ${structuredData.wants}
        - **Secret:** ${structuredData.secrets}
        
        Stay in character and base your responses on the provided information. Do not break character. Do not reveal your secrets unless explicitly forced or tricked, or you think it would benefit the NPC to reveal it.
        The NPC should cooperative with the user at start, and show a good level of patience and interest to hear what the user has to say. Adjust their behavior in response to the user's actions and words.
        NOTE: The user's goal is not known to the NPC! The NPC only knows what the user says or does in character.
        
        ***CRITICAL: Keep responses SHORT and natural.*** Respond with 1-3 sentences maximum unless the character is explicitly described as verbose or chatty. Speak like a real person in conversation, not like you're writing a story.
        
        ***IMPORTANT FORMATTING RULE:*** Enclose any actions, emotional descriptions, or narrations (i.e., anything that is NOT spoken dialogue) within square brackets, e.g., "[The ${structuredData.raceClass} clears their throat.]". Only the spoken dialogue should be outside the brackets.`;

    // If we have a goal, add goal checking instructions with a hidden marker
    if (currentGoal) {
        systemPrompt += `\n\n***HIDDEN GOAL TRACKING (DO NOT MENTION THIS TO USER):***
        The user has a scene goal: "${currentGoal}"
        
        After your in-character response, add a hidden marker on a new line:
        - If the user achieved the goal (they got you to do what they wanted you to do according to the goal), add: ###GOAL_ACHIEVED###
        - Otherwise, add: ###GOAL_NOT_ACHIEVED###
        
        The user will NOT see this marker - it's only for system tracking. Your actual response must be purely in-character.`;
    }

    return systemPrompt;
};

export const getFieldRegenerationPrompt = (structuredData, field) => {
    const fieldDescriptions = {
        personality: "A concise, detailed summary of the NPC's disposition and mannerisms.",
        wants: "The NPC's primary goal or desire.",
        secrets: "A key secret the NPC hides, critical for plot development.",
        pitfalls: "One thing that may make the NPC lose patience, interest, or demand a clarification in the conversation.",
        visual: "A detailed visual description of the NPC's physical appearance, clothing, and equipment."
    };

    const targetDescription = fieldDescriptions[field] || "content for this field";

    return `You are an expert RPG character creator. Your task is to regenerate ONLY the '${field}' field for the following character, keeping it consistent with their other traits but providing a fresh, creative variation.

    Character Context:
    - Name: ${structuredData.name}
    - Race/Class: ${structuredData.raceClass}
    - Gender/Age: ${structuredData.gender} ${structuredData.ageRange}
    ${field !== 'personality' ? `- Personality: ${structuredData.personality}` : ''}
    ${field !== 'wants' ? `- Wants: ${structuredData.wants}` : ''}
    ${field !== 'secrets' ? `- Secret: ${structuredData.secrets}` : ''}
    
    Task: Write a new, unique entry for '${field}'.
    CRITICAL: Keep the response SHORT and CONCISE (maximum 1-2 sentences).
    Description of this field: ${targetDescription}
    
    Respond with ONLY the text for the new '${field}'. Do not include labels, quotes, or explanations.`;
};

export const getFieldExpansionPrompt = (structuredData, field) => {
    const fieldDescriptions = {
        wants: "The NPC's primary goal or desire.",
        secrets: "A key secret the NPC hides, critical for plot development.",
        pitfalls: "One thing that may make the NPC lose patience, interest, or demand a clarification in the conversation."
    };

    const targetDescription = fieldDescriptions[field] || "content for this field";

    return `You are an expert RPG character creator. Your task is to EXPAND the '${field}' field for the following character.
    
    Character Context:
    - Name: ${structuredData.name}
    - Race/Class: ${structuredData.raceClass}
    - Gender/Age: ${structuredData.gender} ${structuredData.ageRange}
    ${field !== 'personality' ? `- Personality: ${structuredData.personality}` : ''}
    
    Current '${field}': "${structuredData[field]}"
    
    Task: Expand and/or add one more *short* sentence to the '${field}' entry. Otherwise, only minimal modification are allowed to the existing text.
    Description of this field: ${targetDescription}
    
    Respond with ONLY the resulted text. Do not include labels, quotes, or explanations.`;
};

export const getVoiceRegenerationPrompt = (structuredData, availableVoices) => {
    return `You are a professional voice casting director for RPG characters. Your task is to select a NEW voice for this character that matches their profile.

Character Information:
- Name: ${structuredData.name}
- Race/Class: ${structuredData.raceClass}
- Gender: ${structuredData.gender}
- Age Range: ${structuredData.ageRange}
- Personality: ${structuredData.personality}

Available Voices:
${availableVoices.join("\n")}

${VOICE_SELECTION_GUIDELINES}

Voice Selection Process:
1. Analyze the character's gender, age, and personality traits
2. Identify the TOP 3 voices that best match this character

CRITICAL: 
- Return your TOP 3 choices as a list of strings.
- Just provide the best matches.`;
};
