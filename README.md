# 🎭 NPC Assistant

**AI-Powered NPC Generator & Roleplay Assistant for D&D Game Masters**

Transform your tabletop RPG sessions with intelligent, voice-enabled NPCs that bring your world to life. NPC Assistant uses cutting-edge AI to generate rich, detailed characters and enables natural conversations with authentic voice synthesis.

![NPC Assistant](https://img.shields.io/badge/AI-Powered-blue) ![Firebase](https://img.shields.io/badge/Firebase-Ready-orange) ![Netlify](https://img.shields.io/badge/Netlify-Deployed-00C7B7)

---

## ✨ Key Features

### 🤖 **AI-Powered Character Generation**
Describe an NPC in plain English and watch AI create a complete character profile with personality, motivations, secrets, and visual descriptions. The system intelligently generates everything needed for rich roleplay.

### 🎙️ **Intelligent Voice Matching**
AI automatically selects the perfect voice from 100+ premium options (Gemini + ElevenLabs) by analyzing character traits—gender, age, and personality. Don't like it? Regenerate for a different match.

### 🎨 **Two-Step Image Generation**
A unique approach: First, an LLM analyzes your character and crafts the perfect DALL-E prompt. Then DALL-E 3 generates a stunning 1024x1024 fantasy portrait. The result? Professional-quality character art that actually matches your vision.

### 💬 **Context-Aware Roleplay**
NPCs stay in character across entire conversations, remembering history and reacting based on their personality, goals, and secrets. They won't reveal secrets unless tricked or forced—just like a real character.

### 🎬 **Dynamic Scene System**
Set rich, contextual scenes that guide NPC interactions. AI automatically generates atmospheric scene descriptions complete with location, time, mood, and player objectives. The system intelligently tracks scene goals and celebrates when your players achieve them—then seamlessly transitions to the next scene. Perfect for structured adventures or spontaneous roleplay.

### ✨ **AI Field Regeneration**
Any character trait can be regenerated or expanded with AI. Personality too bland? Regenerate it. Secret too simple? Expand it. Every field is editable and AI-enhanceable.

### 🔐 **Secure & Serverless**
Built on Firebase + Netlify Functions with complete user isolation. API keys never touch the client. Your NPCs are private, synced across devices, and always available.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ and npm
- Firebase project (free tier works great)
- Google AI API key (Gemini)
- OpenAI API key (for DALL-E image generation)
- Cloudinary account (for image storage)
- ElevenLabs API key (optional, for premium voices)

### Installation

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd npc_assistant
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   
   Copy `.env.example` to `.env` and fill in your API keys:
   ```bash
   cp .env.example .env
   ```
   
   Required variables:
   ```env
   GOOGLE_AI_API_KEY=your_gemini_api_key
   OPENAI_API_KEY=your_openai_api_key
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_cloudinary_key
   CLOUDINARY_API_SECRET=your_cloudinary_secret
   ELEVENLABS_API_KEY=your_elevenlabs_key  # Optional
   ```

4. **Set up Firebase**:
   
   Update `index.html` with your Firebase config:
   ```javascript
   window.__firebase_config = JSON.stringify({
     apiKey: "your-api-key",
     authDomain: "your-app.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-app.appspot.com",
     messagingSenderId: "123456789",
     appId: "your-app-id"
   });
   ```

5. **Deploy Firestore rules**:
   ```bash
   firebase deploy --only firestore:rules
   ```

### Development

Run the local development server with Netlify Functions:
```bash
npx netlify dev
```

The app will be available at `http://localhost:8888`

### Deployment

Deploy to Netlify:
```bash
netlify deploy --prod
```

---

## 🏗️ Tech Stack

- **Frontend**: React 18, Vite, TailwindCSS
- **Backend**: Netlify Functions (serverless)
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **AI Models**: 
  - Google Gemini 2.0 (character generation, conversations, voice selection)
  - OpenAI DALL-E 3 (image generation)
- **Voice Synthesis**:
  - Google Gemini TTS (100+ voices)
  - ElevenLabs (premium voices)
- **Image Storage**: Cloudinary
- **Icons**: Lucide React

---

## 📁 Project Structure

```
npc_assistant/
├── src/
│   ├── NPC_Generator_Chatbot.jsx  # Main application component
│   ├── firebaseConfig.js          # Firebase initialization
│   ├── voices.js                  # Voice configuration
│   └── main.jsx                   # Entry point
├── netlify/
│   └── functions/
│       ├── gemini.js              # Gemini API proxy
│       ├── generate-image.js      # DALL-E image generation
│       ├── elevenlabs-tts.js      # ElevenLabs TTS proxy
│       └── delete-image.js        # Cloudinary cleanup
├── firestore.rules                # Firestore security rules
├── voices.json                    # Voice library data
└── netlify.toml                   # Netlify configuration
```

---

## 🎮 Usage Guide

### Creating Your First NPC

1. Click **"Add New NPC"**
2. Describe your character in natural language:
   - "A gruff old dwarf blacksmith who secretly works for the thieves guild"
   - "An enthusiastic young elf bard seeking fame and fortune"
3. AI generates complete character profile with voice and portrait
4. Review and edit any fields as needed

### Conversing with NPCs

1. Select an NPC from your list
2. **Set a Scene** (optional): Click "Set a Scene" to establish context with location, mood, and objectives
3. Type your message in the conversation panel
4. NPC responds in character, staying true to their personality and scene context
5. Click the speaker icon to hear their voice (100+ premium voices)
6. Enable auto-play for automatic voice responses
7. Track scene goals—when achieved, seamlessly transition to the next scene

### GM Tools

- **GM Details Panel**: View/edit personality, wants, secrets, and pitfalls
- **Scene System**: 
  - AI-generated scene descriptions with atmospheric details
  - Automatic goal extraction and tracking from scene context
  - "Set Next Scene" button appears when goals are achieved
  - Seamless scene transitions that maintain conversation flow
  - Type `/scene` anytime to set a new scene
- **Voice Selection**: Regenerate or manually select from 100+ voices
- **Image Regeneration**: Create new character portraits anytime
- **Field Regeneration**: Use AI to regenerate individual character traits
- **Mobile Optimized**: Full-featured experience on phones with responsive design

---

## 🔒 Security Features

- API keys secured in Netlify Functions (never exposed to client)
- User authentication required for all operations
- Firestore rules enforce user data isolation
- Environment variables for sensitive configuration
- Cloudinary secure image uploads

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

---

## 📝 License

This project is licensed under the MIT License.

---

## 🙏 Acknowledgments

- Built with [Google Gemini](https://deepmind.google/technologies/gemini/) for AI generation
- Images powered by [OpenAI DALL-E 3](https://openai.com/dall-e-3)
- Voice synthesis by [Google Gemini TTS](https://ai.google.dev/) and [ElevenLabs](https://elevenlabs.io/)
- Hosted on [Netlify](https://www.netlify.com/)
- Database by [Firebase](https://firebase.google.com/)

---

**Happy GMing! 🎲✨**
