# ORBII

### AI-Powered Emergency Safety Platform

ORBII is an emergency response and personal safety platform designed to help people quickly alert trusted contacts and nearby helpers during dangerous situations.

Built with an offline-first approach, ORBII focuses on rapid emergency activation, real-time location sharing, and voice-triggered SOS detection, even when the user cannot manually access their phone.

---

## The Problem

In many emergency situations, victims may not have enough time to unlock their phones, navigate through menus, or manually contact emergency services.

Traditional safety tools often depend on:

* Internet connectivity
* Manual interaction
* Multiple taps
* Visible phone usage

ORBII aims to reduce the time between danger and response.

---

## Key Features

### Voice SOS Detection

Offline voice recognition continuously listens for emergency phrases and can trigger an SOS event without requiring internet access.

### One-Touch SOS

Users can instantly activate emergency mode through a dedicated emergency interface.

### Real-Time Location Sharing

Emergency contacts receive the user's live location during active SOS events.

### Nearby Helper Network

ORBII can notify nearby verified users who may be able to assist during emergencies.

### Emergency Contact Alerts

Trusted contacts are informed immediately when an SOS is triggered.

### Background Protection

Voice detection and emergency monitoring continue to operate even when the application is not actively open.

### Offline-First Design

Critical safety functionality remains available without relying on cloud-based speech recognition.

---

## Technical Challenges Solved

* Offline speech recognition on mobile devices
* Android background service management
* Android 14 lock-screen restrictions
* Wake-lock and battery optimization
* Real-time emergency dispatch architecture
* Voice-triggered SOS activation
* Foreground service reliability
* Realtime location synchronization
* Secure authentication and user management
* Emergency workflow state management

---

## Technology Stack

### Frontend

* React Native
* TypeScript

### Backend

* Supabase
* PostgreSQL
* Realtime Subscriptions

### Mobile Systems

* Android Native Modules
* Foreground Services
* Lock-Screen Activities
* Deep Links
* Notification Channels

### AI & Voice Processing

* Vosk Speech Recognition
* Offline Voice Detection
* Voice Activity Detection (VAD)

---

## Vision

ORBII aims to make emergency assistance faster, more accessible, and more reliable through intelligent mobile technology.

The long-term goal is to build a trusted safety ecosystem that connects individuals, communities, institutions, and emergency responders.

---

## Current Status

Development Stage: MVP Complete

Current Focus:

* User testing
* Reliability validation
* Community onboarding
* Campus deployments
* Emergency response optimization

---

```
                      ORBII Architecture
```

┌─────────────────────────────┐
│           USER              │
└──────────────┬──────────────┘
│
▼
┌─────────────────────────────┐
│      React Native App       │
│                             │
│ • Home Screen               │
│ • SOS Interface             │
│ • Voice Settings            │
│ • Active SOS Tracking       │
└──────────────┬──────────────┘
│
▼
┌─────────────────────────────┐
│ Android Native Services     │
│                             │
│ • VoiceGuard Service        │
│ • Background Monitoring     │
│ • Lock Screen Activation    │
│ • Notifications             │
└──────────────┬──────────────┘
│
▼
┌─────────────────────────────┐
│ Offline Voice Engine        │
│                             │
│ • Vosk                      │
│ • Voice Activity Detection  │
│ • Custom Trigger Phrases    │
└──────────────┬──────────────┘
│
▼
┌─────────────────────────────┐
│ Emergency Dispatch Layer    │
│                             │
│ • SOS Creation              │
│ • Contact Alerts            │
│ • Helper Notifications      │
│ • Location Updates          │
└──────────────┬──────────────┘
│
▼
┌─────────────────────────────┐
│          Supabase           │
│                             │
│ • Authentication            │
│ • Database                  │
│ • Realtime                  │
│ • Storage                   │
└──────────────┬──────────────┘
│
┌────────┴────────┐
▼                 ▼

┌─────────────┐   ┌─────────────┐
│ Emergency   │   │ Nearby      │
│ Contacts    │   │ Helpers     │
└─────────────┘   └─────────────┘


## Founder

Jatin Kumar

Founder, ORBII

Building technology focused on safety, emergency response, and offline-first systems.
