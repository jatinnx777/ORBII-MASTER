# ORBII — Project Brief

## ABOUT ME (JATIN)

- Name: Jatin Kumar
- Age: 19 (turning 20), First-year engineering student at SRM Sonepat
- Role: Founder & CEO of ORBII
- Co-founder: Vishnu (CTO, 19, currently recovering from hepatitis)
- Equity split: Jatin 51%, Vishnu 49%
- Background: Non-technical founder, used no-code tools before, learning to code now
- Goal: Build ORBII to ₹5,000cr valuation in 4 years, exit at age 30, retire

## THE PROBLEM ORBII SOLVES

Women's safety in India is critical. Current police response time = 20-30 minutes. In emergencies, 20 minutes is too late. Existing solutions (panic buttons, apps) either don't work or take too long.

## THE SOLUTION: ORBII

ORBII is an emergency response platform that dispatches verified civilian helpers to emergencies within 2 minutes, while simultaneously alerting police and family.

### HOW IT WORKS

**FOR USERS (people in emergency):**
1. Download ORBII app
2. In emergency: Press large red SOS button
3. 3-second countdown (can cancel if accidental)
4. App automatically:
   - Gets GPS location
   - Sends alert to verified helpers within 2km radius
   - Alerts nearest police station
   - SMS to user's emergency contacts (up to 3)
   - Shows live map with approaching helpers
5. Helper arrives within 2 minutes
6. User is safe

**FOR HELPERS (verified civilians):**
1. Sign up as helper through app
2. Background verification (Aadhaar, police verification)
3. When user triggers SOS within 2km:
   - Receive push notification
   - See location, distance, user details
   - Accept or Decline
4. If accept: Navigate to location using maps
5. Help person in need
6. Mark incident as resolved
7. Earn ₹100 per successful response

**FOR POLICE:**
- Direct integration with police control rooms
- Every SOS auto-alerts nearest station
- Police can track helpers responding
- Serves as backup if helpers can't reach

## CORE FEATURES

### 1. USER APP FEATURES

**Authentication:**
- Phone number login (OTP-based, no password)
- Profile setup: name, photo, emergency contacts (max 3)
- No email required (India-first design)

**Home Screen:**
- Large red SOS button (center, 120px, pulsing animation)
- Shows "X helpers nearby" counter
- Bottom tab navigation: Home | Helpers | History | Profile
- Clean, minimal interface

**SOS Flow:**
- Tap SOS button → 3-second countdown (large numbers, fullscreen)
- Cancel button during countdown
- After countdown:
  * Auto-detect GPS location
  * Create SOS record in database
  * Push notification to all helpers within 2km
  * SMS to emergency contacts: "EMERGENCY! [Name] needs help at [location]. Track live: [link]"
  * Navigate to Active SOS screen

**Active SOS Screen:**
- Live map showing:
  * User location (red pulsing pin)
  * Responding helpers (blue pins with photos, ETA)
  * Nearest police stations (badge icons)
- Live timer: "Help requested: 00:42" (MM:SS)
- Bottom sheet with helper list:
  * Helper photo, name, distance, ETA
  * Updates in real-time as they move
- Cancel SOS button (red outline, bottom)
- Auto-resolve when helper marks complete

**Helpers Tab:**
- Map view: Shows all verified helpers nearby (blue pins)
- List view: Scrollable list
  * Helper photo (circle, 60px)
  * Name, rating (1-5 stars), distance
  * Online/offline status
- Filter: Online only / All helpers

**History Tab:**
- Timeline of past SOS incidents
- Card per incident:
  * Date, time
  * Location (address)
  * Helper who responded (photo, name)
  * Outcome: Resolved / Cancelled
  * Rate helper button (if not rated)
- Tap card → full details

**Profile Screen:**
- Edit profile: name, photo
- Phone number (read-only, verified)
- Emergency contacts: Add/edit/remove (max 3)
  * Name + phone number for each
- Premium upgrade: ₹99/month
  * Unlimited SOS (free = 2/month)
  * Priority dispatch
  * Family dashboard
  * No ads
- Payment via Razorpay
- Settings: Notifications, location permissions

**Voice Detection (Optional feature):**
- Background listening for keywords: "help", "bachao", "emergency"
- Detects in Hindi + English
- Auto-triggers SOS when detected (with 3s cancel window)
- Privacy: All processing local, no audio sent to server
- Can be disabled in settings

### 2. HELPER MODE FEATURES

**Becoming a Helper:**
- Toggle in Profile: "Become a Helper"
- Verification required:
  * Aadhaar upload
  * Police verification letter
  * Photo ID
  * Manual review (2-3 days)
- Background check status shown

**When Helper is Online:**
- App tracks location (updates every 30s)
- Shows as "available" to users within 5km
- Receives SOS notifications when incident within 2km

**Incoming SOS Notification:**
- Push notification: "Emergency 800m away!"
- Sound + vibration alert
- Shows:
  * User name, photo
  * Distance
  * Location on mini-map
- Accept / Decline buttons (30s timeout)

**After Accepting SOS:**
- Navigation to incident location (using maps)
- Shows route, ETA
- User can see helper approaching on their map
- When within 50m: "Mark as Resolved" button appears
- On resolve:
  * Asks for incident details (optional)
  * Earns ₹100 (added to wallet)
  * SOS closes for user

**Helper Dashboard:**
- Total responses (count)
- Total earnings (₹)
- Average rating
- Response time stats
- Withdraw earnings (UPI transfer, min ₹500)

### 3. PREMIUM FEATURES

**Free Tier:**
- 2 SOS per month
- Standard response time
- Ads shown in app
- Max 3 emergency contacts

**Premium (₹99/month):**
- Unlimited SOS
- Priority dispatch (helpers notified first)
- No ads
- Family dashboard (web):
  * Track family members' locations
  * See their SOS history
  * Get instant alerts
- Voice detection enabled
- Max 5 emergency contacts

## BUSINESS MODEL

### Revenue Streams:

**1. B2C - Consumer Subscriptions**
- Free tier supported by ads
- Premium: ₹99/month per user
- Target: 15% conversion rate
- Year 1: 10,000 users → 1,500 premium → ₹18L revenue

**2. B2B - Corporate Contracts**
- Gig economy: Zomato, Swiggy, Uber, Ola (delivery/driver safety)
- Pricing: ₹50-100/user/year
- IT companies: Employee safety (night shifts, cabs)
- Pricing: ₹100/employee/year
- Year 1: 5 contracts → ₹50L revenue

**3. B2G - Government Programs**
- University safety programs: ₹5-10L/year per campus
- City safety initiatives: ₹50L-2cr per program
- Nirbhaya Fund integration
- Year 1: 1 pilot (SRM) → ₹5L, Nirbhaya → ₹200L

**Year 1 Total Target: ₹2.9 crore revenue**

## CURRENT STATUS

**What exists:**
- Business plan complete
- Judge advisor secured (Delhi High Court - police integration access)
- Startup India registered
- Dean meeting scheduled (6 days from now) for ₹5L seed funding
- Figma designs complete (all screens designed in Stitch)
- Equity structure finalized (51/49)

**What needs to be built:**
- Entire mobile app (React Native)
- Backend (Firebase)
- Maps integration
- Voice detection
- Payment integration
- Everything from scratch

**Timeline:**
- Days 1-3: Build MVP (auth, SOS, maps, helper mode)
- Days 4-5: Polish, test, add voice detection
- Day 6: Demo ready for Dean meeting
- Week 2-4: Production-ready after Dean funding

## TECH STACK (ALL FREE/FREEMIUM)

### Frontend:
- **React Native** (iOS + Android from one codebase)
- **TypeScript** (type safety)
- **React Navigation** (screen navigation)
- **Redux Toolkit** (state management)

### Backend:
- **Firebase** (Google's free tier):
  * Authentication (phone OTP)
  * Firestore (real-time database)
  * Cloud Storage (photos, documents)
  * Cloud Messaging (push notifications)
  * Cloud Functions (serverless backend logic)
- Free tier: 50K reads/day, 20K writes/day (enough for MVP + early users)

### Maps:
- **Mapbox** (NOT Google Maps - expensive)
  * Free tier: 50K map loads/month
  * Better styling, cheaper than Google
  * Same quality maps
- Alternative: **OpenStreetMap** (completely free)

### Geolocation:
- **react-native-geolocation-service** (free library)
- Uses device GPS (no API cost)

### Voice Detection:
- **react-native-voice** (uses device speech recognition)
- iOS: Uses Apple's built-in Speech framework (free)
- Android: Uses Google Speech API (free tier: 60 min/month)

### SMS:
- **Twilio** (free trial: ₹1,300 credit)
- After trial: ₹0.50 per SMS (cheap)
- Alternative: **MSG91** (India-based, ₹0.20 per SMS)

### Payment:
- **Razorpay** (India's best, free to integrate)
- Fee: 2% per transaction (only when user pays)
- No upfront cost

### Push Notifications:
- **Firebase Cloud Messaging** (FCM) - completely free
- Unlimited notifications

### Analytics:
- **Firebase Analytics** (free)
- **Mixpanel** (free tier: 100K events/month)

### Hosting (when needed):
- **Vercel** (free tier for web dashboard)
- **Firebase Hosting** (free tier: 10GB storage, 360MB/day transfer)

### Code/Version Control:
- **GitHub** (free for private repos)
- **Git** (free)

### Development Tools:
- **VS Code** (free)
- **Expo** (optional - makes React Native easier, free tier)
- **Android Studio** (free - for Android testing)
- **Xcode** (free - for iOS testing, Mac only)

**Total upfront cost: ₹0**
**Monthly cost (MVP): ₹0-500** (only if exceeding free tiers)

## PROJECT STRUCTURE

```
orbii-app/
├── src/
│   ├── screens/
│   │   ├── Onboarding/
│   │   ├── Auth/
│   │   │   ├── LoginScreen.tsx
│   │   │   ├── OTPScreen.tsx
│   │   │   └── ProfileSetupScreen.tsx
│   │   ├── Home/
│   │   │   ├── HomeScreen.tsx
│   │   │   └── components/
│   │   │       └── SOSButton.tsx
│   │   ├── SOS/
│   │   │   ├── CountdownScreen.tsx
│   │   │   └── ActiveSOSScreen.tsx
│   │   ├── Helper/
│   │   │   ├── HelpersListScreen.tsx
│   │   │   ├── HelperMapScreen.tsx
│   │   │   └── AcceptSOSScreen.tsx
│   │   ├── History/
│   │   │   └── HistoryScreen.tsx
│   │   └── Profile/
│   │       ├── ProfileScreen.tsx
│   │       ├── EditProfileScreen.tsx
│   │       └── PremiumUpgradeScreen.tsx
│   ├── navigation/
│   │   ├── AppNavigator.tsx
│   │   ├── AuthNavigator.tsx
│   │   └── TabNavigator.tsx
│   ├── components/
│   │   ├── common/
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   └── Card.tsx
│   │   └── maps/
│   │       ├── MapView.tsx
│   │       ├── UserPin.tsx
│   │       └── HelperPin.tsx
│   ├── services/
│   │   ├── firebase/
│   │   │   ├── auth.ts
│   │   │   ├── firestore.ts
│   │   │   └── storage.ts
│   │   ├── location/
│   │   │   └── geolocation.ts
│   │   ├── notifications/
│   │   │   └── fcm.ts
│   │   ├── voice/
│   │   │   └── speechRecognition.ts
│   │   └── payment/
│   │       └── razorpay.ts
│   ├── redux/
│   │   ├── store.ts
│   │   ├── slices/
│   │   │   ├── userSlice.ts
│   │   │   ├── sosSlice.ts
│   │   │   └── helperSlice.ts
│   ├── utils/
│   │   ├── constants.ts
│   │   ├── helpers.ts
│   │   └── validation.ts
│   ├── types/
│   │   └── index.ts
│   └── assets/
│       ├── icons/
│       ├── images/
│       └── fonts/
├── android/
├── ios/
├── App.tsx
├── package.json
└── tsconfig.json
```

## DESIGN SYSTEM

**Colors:**
- Primary: #FF0000 (red - emergency, urgency)
- Secondary: #FFFFFF (white)
- Accent: #FFD700 (gold - premium)
- Dark: #2C2C2C (text, dark mode background)
- Success: #00C853 (helper online, resolved)
- Warning: #FFC107 (countdown)

**Typography:**
- Headers: Poppins Bold, 24px
- Body: Inter Regular, 16px
- Captions: Inter Light, 12px
- Buttons: Poppins SemiBold, 16px

**Spacing:**
- xs: 4px
- sm: 8px
- md: 16px
- lg: 24px
- xl: 32px

**Border Radius:**
- Small (buttons): 8px
- Medium (cards): 12px
- Large (SOS button): 60px (circle)

## KEY TECHNICAL REQUIREMENTS

### 1. Real-time Updates:
- Use Firestore's onSnapshot listeners
- Helper locations update every 30s
- SOS status updates in real-time
- User sees helpers approaching live

### 2. Background Services:
- Location tracking continues when app backgrounded (for helpers)
- Voice detection works in background
- Push notifications work when app closed

### 3. Offline Handling:
- Cache last known helper locations
- Queue SOS if no internet (send when online)
- Show offline indicator
- Emergency contacts SMS works without internet (via SMS API)

### 4. Performance:
- App launch < 2 seconds
- SOS trigger < 500ms
- Map loads < 1 second
- Smooth 60fps animations

### 5. Security:
- Phone number verification required
- Helper background checks before verification
- Location data encrypted in transit
- User data GDPR/India data protection compliant
- No location tracking unless user consents

### 6. Accessibility:
- Large touch targets (min 44px)
- High contrast (red on white)
- Screen reader support
- Works for elderly users
- Voice activation for users who can't tap

## INTEGRATIONS NEEDED

### Firebase Setup:
1. Create Firebase project: "orbii-production"
2. Enable services:
   - Authentication (Phone)
   - Firestore Database
   - Cloud Storage
   - Cloud Messaging
   - Cloud Functions
3. Add Firebase config to app
4. Set up Firestore security rules
5. Create indexes for geo-queries

### Mapbox Setup:
1. Create free Mapbox account
2. Get API token
3. Add to app config
4. Install react-native-mapbox-gl
5. Style maps (red theme for consistency)

### Razorpay Setup:
1. Create test account
2. Get API keys (test mode)
3. Integrate SDK
4. Test payment flow
5. Switch to live when ready

### Twilio/MSG91 SMS:
1. Create account
2. Get API credentials
3. Set up SMS template: "EMERGENCY! {name} needs help at {location}. Track: {link}"
4. Test delivery
5. Set up credits

## DEPLOYMENT REQUIREMENTS

### For Dean Demo (Day 6):
- iOS TestFlight build (internal testing)
- OR Android APK (sideload for demo)
- Test with 5 demo users + 3 demo helpers
- Pre-populated demo data
- Stable, no crashes

### For SRM Launch (Week 4):
- App Store submission (iOS)
- Play Store submission (Android)
- 50 verified helpers onboarded
- 100 beta users tested
- Terms of Service, Privacy Policy ready
- Support email/phone set up

## SUCCESS METRICS

### MVP Success (Week 1):
- App installs and runs without crashes
- User can sign up
- SOS button works
- Map shows helpers
- At least 1 full end-to-end test successful

### Dean Demo Success (Day 6):
- Live demo works smoothly
- Shows real-time helper response
- Dean sees value proposition clearly
- Closes ₹5L funding

### Launch Success (Month 1):
- 500 users signed up
- 50 helpers verified and active
- 30+ successful SOS responses
- <3 min average response time
- >90% user satisfaction
- ₹30-50K MRR (monthly recurring revenue)

## CONSTRAINTS

**Budget:** ₹0 until Dean funding (Day 6)
**Time:** 6 days to MVP
**Team:** Solo (Vishnu recovering)
**Experience:** First mobile app, learning as I build
**Resources:** Claude Code, free tier of all services

## WHAT I NEED FROM CLAUDE CODE

Build this entire application following these specifications. Be autonomous but ask clarifying questions when truly needed. Default to best practices for React Native, Firebase, and mobile app development.

Prioritize:
1. Working > Perfect (ship fast, iterate)
2. Free services (stay within free tiers)
3. Simple > Complex (MVP first, features later)
4. User safety (this app saves lives - bugs = danger)

When making decisions:
- Choose the simpler approach
- Use well-tested libraries
- Write clean, commented code
- Handle errors gracefully
- Think about edge cases (no internet, low battery, etc.)
