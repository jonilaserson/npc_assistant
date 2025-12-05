# Admin & Analytics Setup Guide

## 🎯 What's Been Implemented

✅ **Sentry Error Tracking** - Automatic error logging with user context  
✅ **User Tracking** - All users automatically tracked on first login  
✅ **Analytics Logging** - DALL-E image generation tracked with cost estimates  
✅ **Feedback System** - Users can submit feedback from the NPC list  
✅ **Firestore Security Rules** - Updated to support new collections  

## 📋 Configuration Required

### 1. Update Your `.env` File

Add these two new variables to your `.env` file:

```env
VITE_SENTRY_DSN=your_sentry_dsn_here
VITE_ADMIN_EMAIL=your.email@gmail.com
```

**To get your Sentry DSN:**
1. Go to [sentry.io](https://sentry.io) and create a free account
2. Create a new project (choose "React")
3. Copy the DSN from the project settings
4. Paste it into your `.env` file

### 2. Update Firestore Security Rules

**IMPORTANT:** Update line 7 in `firestore.rules` with your admin email:

```javascript
// Line 7 in firestore.rules
return request.auth != null && 
       request.auth.token.email == 'YOUR_ACTUAL_EMAIL@gmail.com'; // ← CHANGE THIS
```

Then deploy the rules:
```bash
firebase deploy --only firestore:rules
```

### 3. Test the Setup

1. **Test Sentry:**
   - Open browser console
   - Type: `throw new Error("Test error")`
   - Check your Sentry dashboard for the error

2. **Test User Tracking:**
   - Log in to your app
   - Check Firestore → `all_users` collection
   - You should see your user document

3. **Test Analytics:**
   - Generate an NPC image
   - Check Firestore → `usage_logs` collection
   - You should see a log entry with cost estimate

4. **Test Feedback:**
   - Click "Send Feedback" at bottom of NPC list
   - Submit a message
   - Check Firestore → `feedback` collection

## 📊 What's Being Tracked

### User Tracking (`all_users` collection)
- User ID
- Email
- Display name
- Created at timestamp
- Last seen timestamp

### Usage Logs (`usage_logs` collection)
- User ID and email
- Type: `dalle`, `gemini_tts`, `elevenlabs_tts`, `gemini_chat`
- Timestamp
- Estimated cost in USD
- Metadata (model, NPC ID, etc.)

### Cost Estimates
- **DALL-E 3 (1024x1024)**: $0.04 per image
- **DALL-E 2 (256x256)**: $0.016 per image  
- **Gemini TTS**: $0 (free)
- **ElevenLabs TTS**: $0.01 per call
- **Gemini Chat**: $0.00005 per message

## 🚧 Still To Do

The following features are planned but not yet implemented:

- [ ] Admin dashboard UI (`/admin` route)
- [ ] User impersonation
- [ ] TTS usage logging (Gemini & ElevenLabs)
- [ ] Chat message logging
- [ ] View feedback in admin dashboard

## 🔍 Monitoring Your App

### View Analytics in Firestore Console
1. Go to Firebase Console → Firestore Database
2. Check these collections:
   - `all_users` - See all your users
   - `usage_logs` - See all API calls with costs
   - `feedback` - See user feedback

### View Errors in Sentry
1. Go to sentry.io
2. Select your project
3. View errors with full stack traces and user context

## 💡 Next Steps

Once you've configured everything above, you can:
1. Share the app
2. Monitor usage in Firestore
3. Track errors in Sentry
4. Review feedback from users
