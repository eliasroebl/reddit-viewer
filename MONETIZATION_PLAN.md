# Reddit Viewer Monetization Plan

## Executive Summary

This document outlines a comprehensive strategy to monetize the Reddit Viewer application. The app is currently a client-side only PWA with no backend infrastructure, user accounts, or payment systems. This plan covers all aspects needed to transform it into a sustainable business.

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Monetization Models](#2-monetization-models)
3. [User Authentication](#3-user-authentication)
4. [Payment Infrastructure](#4-payment-infrastructure)
5. [Premium Features](#5-premium-features)
6. [Backend Infrastructure](#6-backend-infrastructure)
7. [Bug Reporting & Feedback](#7-bug-reporting--feedback)
8. [Analytics & Tracking](#8-analytics--tracking)
9. [Legal & Compliance](#9-legal--compliance)
10. [Marketing & Growth](#10-marketing--growth)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Cost Estimates](#12-cost-estimates)
13. [Open Questions](#13-open-questions)

---

## 1. Current State Assessment

### What We Have
- ✅ Solid vanilla JS frontend (modular ES6)
- ✅ PWA capabilities (installable, offline-ready)
- ✅ Complete media browsing experience
- ✅ Mobile-optimized with touch controls
- ✅ Cloudflare Workers proxy for CORS
- ✅ Accessibility features

### What's Missing
- ❌ User authentication/accounts
- ❌ Backend server
- ❌ Database for user data
- ❌ Payment processing
- ❌ Analytics system
- ❌ Bug reporting infrastructure
- ❌ Feature flags for premium/free tiers

---

## 2. Monetization Models

### Option A: Freemium Model (Recommended)
**Free Tier:**
- Basic browsing functionality
- Limited to 3 subreddits per session
- Ads displayed between slides
- Standard quality media

**Premium Tier ($4.99/month or $39.99/year):**
- Unlimited subreddits
- No advertisements
- HD/4K media quality
- Advanced features (see Section 5)
- Priority support

### Option B: Ad-Supported Free Model
- Fully free to use
- Display ads between slides (every 10-15 slides)
- Banner ads in header/footer
- Optional "Remove Ads" purchase ($2.99 one-time)

### Option C: One-Time Purchase
- Free trial (limited features)
- $9.99 one-time purchase for full access
- No recurring revenue (less sustainable)

### Recommendation
**Start with Option A (Freemium)** because:
- Provides sustainable recurring revenue
- Low barrier to entry keeps user growth
- Clear value proposition for premium
- Can add ads to free tier for additional revenue

---

## 3. User Authentication

### 3.1 Authentication Options

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Firebase Auth** | Easy setup, multiple providers, free tier | Google lock-in | Free up to 50k MAU |
| **Auth0** | Enterprise features, great docs | Expensive at scale | Free up to 7k MAU |
| **Supabase Auth** | Open source, PostgreSQL included | Smaller community | Free up to 50k MAU |
| **Custom (JWT)** | Full control, no vendor lock-in | More dev work, security risk | Hosting costs only |
| **Clerk** | Modern UX, prebuilt components | Newer, smaller community | Free up to 10k MAU |

### 3.2 Recommended: Supabase Auth
**Why Supabase:**
- Free tier generous (50k monthly active users)
- Includes PostgreSQL database
- Built-in Row Level Security
- OAuth providers (Google, GitHub, etc.)
- Email/password authentication
- Anonymous sessions (convert later)
- Open source (no vendor lock-in)

### 3.3 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     AUTHENTICATION FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────────┐     │
│  │  User    │───▶│ Sign Up/Login │───▶│  Email + Password │     │
│  │  Visits  │    │    Modal      │    │  OR OAuth (Google)│     │
│  └──────────┘    └───────────────┘    └──────────────────┘     │
│                                              │                  │
│                                              ▼                  │
│                         ┌────────────────────────────────┐      │
│                         │   Supabase Auth Verification   │      │
│                         └────────────────────────────────┘      │
│                                              │                  │
│                    ┌─────────────────────────┼─────────────┐    │
│                    ▼                         ▼             │    │
│           ┌──────────────┐          ┌──────────────┐       │    │
│           │  Free Tier   │          │ Premium Tier │       │    │
│           │   Features   │          │   Features   │       │    │
│           └──────────────┘          └──────────────┘       │    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 User Data Model

```javascript
// users table (managed by Supabase Auth)
{
  id: uuid,
  email: string,
  created_at: timestamp,
  last_sign_in: timestamp
}

// profiles table (custom)
{
  user_id: uuid (FK to users),
  display_name: string,
  avatar_url: string,
  subscription_tier: 'free' | 'premium',
  subscription_expires: timestamp,
  preferences: jsonb,
  created_at: timestamp,
  updated_at: timestamp
}

// user_history table (custom)
{
  id: uuid,
  user_id: uuid (FK to users),
  subreddit: string,
  visited_at: timestamp
}
```

### 3.5 Anonymous to Registered Conversion
- Allow anonymous usage with localStorage
- Prompt to create account after N sessions
- Merge anonymous data when user signs up
- "Save your favorites" as conversion trigger

---

## 4. Payment Infrastructure

### 4.1 Payment Provider Options

| Provider | Pros | Cons | Fees |
|----------|------|------|------|
| **Stripe** | Best docs, global, all features | Complex for beginners | 2.9% + $0.30 |
| **Paddle** | Handles tax/compliance | Higher fees | 5% + $0.50 |
| **LemonSqueezy** | Simple, handles everything | Limited customization | 5% + $0.50 |
| **Gumroad** | Very simple | High fees, limited | 10% |

### 4.2 Recommended: Stripe
**Why Stripe:**
- Industry standard, trusted
- Excellent developer experience
- Stripe Checkout for easy implementation
- Subscription management built-in
- Billing Portal for self-service
- Handles SCA/3DS compliance
- Webhooks for subscription events

### 4.3 Subscription Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PAYMENT FLOW                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐    ┌────────────────┐    ┌──────────────────┐     │
│  │  User   │───▶│ Click Upgrade  │───▶│ Stripe Checkout  │     │
│  │         │    │    Button      │    │    (Hosted)      │     │
│  └─────────┘    └────────────────┘    └──────────────────┘     │
│                                              │                  │
│                                              ▼                  │
│                         ┌────────────────────────────────┐      │
│                         │    Payment Processed           │      │
│                         └────────────────────────────────┘      │
│                                              │                  │
│                                              ▼                  │
│                         ┌────────────────────────────────┐      │
│                         │  Stripe Webhook → Backend      │      │
│                         │  Update user subscription_tier │      │
│                         └────────────────────────────────┘      │
│                                              │                  │
│                                              ▼                  │
│                         ┌────────────────────────────────┐      │
│                         │  User sees Premium features    │      │
│                         └────────────────────────────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 Stripe Integration Steps

1. **Create Stripe Account** → Get API keys
2. **Create Products/Prices** in Stripe Dashboard
   - Product: "Reddit Viewer Premium"
   - Price 1: $4.99/month
   - Price 2: $39.99/year (saves 33%)
3. **Implement Checkout Session** → Server-side endpoint
4. **Setup Webhooks** → Handle subscription events
5. **Create Billing Portal** → Let users manage subscription

### 4.5 Subscription Data Model

```javascript
// subscriptions table
{
  id: uuid,
  user_id: uuid (FK to users),
  stripe_customer_id: string,
  stripe_subscription_id: string,
  status: 'active' | 'cancelled' | 'past_due' | 'trialing',
  plan: 'monthly' | 'yearly',
  current_period_start: timestamp,
  current_period_end: timestamp,
  cancel_at_period_end: boolean,
  created_at: timestamp,
  updated_at: timestamp
}
```

### 4.6 Webhook Events to Handle

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Create subscription record, upgrade user |
| `customer.subscription.updated` | Update subscription status |
| `customer.subscription.deleted` | Downgrade user to free |
| `invoice.payment_failed` | Notify user, grace period |
| `invoice.paid` | Update subscription period |

---

## 5. Premium Features

### 5.1 Feature Comparison

| Feature | Free | Premium |
|---------|------|---------|
| Browse subreddits | ✅ (3/session) | ✅ Unlimited |
| View images/videos | ✅ | ✅ |
| Slideshow mode | ✅ | ✅ |
| Advertisements | Every 10 slides | ❌ None |
| **Favorites/Collections** | ❌ | ✅ |
| **Save browsing history** | ❌ | ✅ (cloud sync) |
| **Custom themes** | ❌ | ✅ |
| **Download media** | ❌ | ✅ |
| **Multi-reddit presets** | ❌ | ✅ |
| **HD/4K quality** | SD only | ✅ |
| **Autoplay speed** | 3s fixed | Custom 1-30s |
| **Keyboard shortcuts** | Basic | Advanced |
| **Priority support** | ❌ | ✅ |
| **Early access features** | ❌ | ✅ |

### 5.2 Feature Flag Implementation

```javascript
// config.js addition
export const FEATURES = {
  FREE: {
    maxSubredditsPerSession: 3,
    showAds: true,
    adFrequency: 10, // every N slides
    canSaveFavorites: false,
    canDownload: false,
    maxQuality: 'sd',
    autoplaySpeeds: [3000], // fixed
    cloudSync: false
  },
  PREMIUM: {
    maxSubredditsPerSession: Infinity,
    showAds: false,
    adFrequency: null,
    canSaveFavorites: true,
    canDownload: true,
    maxQuality: '4k',
    autoplaySpeeds: [1000, 2000, 3000, 5000, 8000, 10000, 15000, 30000],
    cloudSync: true
  }
};

// Usage in code
import { getUserTier, getFeatures } from './subscription.js';

const tier = await getUserTier(); // 'free' or 'premium'
const features = getFeatures(tier);

if (!features.canDownload) {
  showUpgradePrompt('Download media');
}
```

### 5.3 Premium Feature Details

#### Favorites/Collections
- Save individual posts to collections
- Create named collections (e.g., "Funny", "Art", "Save for later")
- Sync across devices
- Quick access from sidebar

#### Cloud History Sync
- Sync browsing history across devices
- "Continue where you left off"
- History search and filtering

#### Custom Themes
- Dark/Light/OLED Black modes
- Accent color customization
- Font size options
- Custom CSS (advanced users)

#### Download Media
- Download images with one click
- Download videos (where legal)
- Batch download from collections
- Format selection (PNG, JPG, WebP)

#### Multi-Reddit Presets
- Save custom multi-reddit combinations
- Quick-switch between presets
- Share presets with others

---

## 6. Backend Infrastructure

### 6.1 Architecture Options

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Supabase** | All-in-one, generous free tier | Limited compute | Free → $25/mo |
| **Vercel + Planetscale** | Great DX, serverless | Multiple vendors | Free → $20/mo |
| **Railway** | Simple deployment | Smaller community | Free → $5/mo |
| **AWS** | Most flexible | Complex, expensive | $20-100+/mo |
| **Self-hosted VPS** | Full control, cheap | Maintenance burden | $5-20/mo |

### 6.2 Recommended: Supabase + Vercel

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARCHITECTURE                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐     │
│   │                    FRONTEND                          │      │
│   │           Vercel (Static Hosting)                    │      │
│   │    - HTML/CSS/JS served from CDN                     │      │
│   │    - PWA manifest and service worker                 │      │
│   └───────────────────────┬──────────────────────────────┘     │
│                           │                                     │
│           ┌───────────────┼───────────────┐                    │
│           ▼               ▼               ▼                    │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│   │   Supabase   │ │    Stripe    │ │  Cloudflare  │          │
│   │              │ │              │ │   Workers    │          │
│   │ - Auth       │ │ - Payments   │ │              │          │
│   │ - Database   │ │ - Subscript. │ │ - Reddit     │          │
│   │ - Storage    │ │ - Webhooks   │ │   Proxy      │          │
│   │ - Realtime   │ │              │ │ - Media      │          │
│   └──────────────┘ └──────────────┘ └──────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 API Endpoints Needed

```
Authentication:
POST   /auth/signup         - Create account
POST   /auth/login          - Login
POST   /auth/logout         - Logout
POST   /auth/reset-password - Password reset
GET    /auth/me             - Get current user

Subscription:
POST   /subscription/checkout      - Create Stripe checkout
POST   /subscription/portal        - Create billing portal session
POST   /subscription/webhook       - Stripe webhook handler
GET    /subscription/status        - Get subscription status

User Data:
GET    /user/profile        - Get user profile
PATCH  /user/profile        - Update profile
GET    /user/preferences    - Get preferences
PUT    /user/preferences    - Update preferences

Premium Features:
GET    /favorites           - List favorites
POST   /favorites           - Add favorite
DELETE /favorites/:id       - Remove favorite
GET    /collections         - List collections
POST   /collections         - Create collection
GET    /history             - Get browsing history
POST   /history             - Log visit

Feedback:
POST   /feedback            - Submit feedback
POST   /bugs                - Report bug
```

### 6.4 Database Schema

```sql
-- Supabase/PostgreSQL Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'premium')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User preferences
CREATE TABLE preferences (
  user_id UUID REFERENCES profiles(id) PRIMARY KEY,
  show_nsfw BOOLEAN DEFAULT FALSE,
  autoplay_speed INTEGER DEFAULT 3000,
  theme TEXT DEFAULT 'dark',
  default_sort TEXT DEFAULT 'hot',
  default_time TEXT DEFAULT 'all',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE subscriptions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing', 'incomplete')),
  plan TEXT CHECK (plan IN ('monthly', 'yearly')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Favorites
CREATE TABLE favorites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  collection_id UUID REFERENCES collections(id),
  reddit_post_id TEXT NOT NULL,
  subreddit TEXT NOT NULL,
  title TEXT,
  media_url TEXT,
  media_type TEXT,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, reddit_post_id)
);

-- Collections
CREATE TABLE collections (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Browsing history
CREATE TABLE history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  subreddit TEXT NOT NULL,
  visited_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feedback
CREATE TABLE feedback (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'general')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  email TEXT,
  user_agent TEXT,
  url TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;

-- Policies (users can only access their own data)
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
-- (Similar policies for other tables...)
```

---

## 7. Bug Reporting & Feedback

### 7.1 Feedback System Options

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Custom (Supabase)** | Full control, integrated | Dev work needed | Free (included) |
| **Canny** | Beautiful, voting system | Expensive | $0-400/mo |
| **GitHub Issues** | Free, dev-friendly | Not user-friendly | Free |
| **Sentry** | Error tracking built-in | Only for errors | Free-$26/mo |
| **Crisp** | Live chat + tickets | Can be costly | Free-$25/mo |

### 7.2 Recommended: Multi-Layer Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                FEEDBACK & BUG REPORTING SYSTEM                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 1: Automatic Error Tracking                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Sentry (Free Tier)                                     │   │
│  │  - Automatic JS error capture                           │   │
│  │  - Stack traces with source maps                        │   │
│  │  - User context (anonymized)                            │   │
│  │  - Browser/device info                                  │   │
│  │  - Release tracking                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 2: User-Initiated Bug Reports                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  In-App Bug Report Modal                                │   │
│  │  - Screenshot capture (optional)                        │   │
│  │  - Auto-attach: URL, browser, user ID, recent actions   │   │
│  │  - Category selection                                   │   │
│  │  - Description field                                    │   │
│  │  - Email for follow-up                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 3: Feature Requests & General Feedback                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Feedback Widget (Custom or Canny)                      │   │
│  │  - Feature request submission                           │   │
│  │  - Upvoting system                                      │   │
│  │  - Status updates (planned, in progress, done)          │   │
│  │  - Public roadmap                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 4: Direct Support (Premium)                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Email Support: support@redditviewer.app                │   │
│  │  - Premium users: Priority queue                        │   │
│  │  - Response time SLA (24-48 hours)                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Bug Report Form Fields

```javascript
// Bug report data structure
{
  // User-provided
  type: 'bug' | 'feature' | 'general',
  subject: string,        // Brief description
  message: string,        // Detailed description
  email: string,          // Optional, for follow-up
  screenshot: blob,       // Optional

  // Auto-captured
  user_id: string | null, // If logged in
  url: string,            // Current URL/state
  user_agent: string,     // Browser info
  screen_size: string,    // Viewport dimensions
  timestamp: string,      // ISO timestamp
  app_version: string,    // From manifest
  recent_errors: array,   // From Sentry context
  recent_actions: array   // Last 10 user actions
}
```

### 7.4 Sentry Integration

```javascript
// sentry.js
import * as Sentry from '@sentry/browser';

export function initSentry() {
  Sentry.init({
    dsn: 'https://xxx@sentry.io/xxx',
    environment: process.env.NODE_ENV,
    release: 'reddit-viewer@' + APP_VERSION,
    integrations: [
      new Sentry.BrowserTracing(),
      new Sentry.Replay()
    ],
    tracesSampleRate: 0.1, // 10% of transactions
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0
  });
}

export function setUserContext(user) {
  Sentry.setUser({
    id: user?.id,
    email: user?.email,
    subscription: user?.subscription_tier
  });
}

export function reportError(error, context = {}) {
  Sentry.captureException(error, { extra: context });
}
```

### 7.5 In-App Feedback UI

- Floating "?" button in corner (unobtrusive)
- Opens modal with tabs: Bug / Feature / Feedback
- Smart form with conditional fields
- Success message with ticket number
- Email notification to admin

---

## 8. Analytics & Tracking

### 8.1 Analytics Options

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Plausible** | Privacy-focused, simple | Limited features | $9/mo |
| **Fathom** | Privacy-focused, fast | Limited | $14/mo |
| **PostHog** | Full suite, self-hostable | Complex | Free-$450/mo |
| **Mixpanel** | Powerful events | Learning curve | Free-$25/mo |
| **Google Analytics** | Free, powerful | Privacy concerns | Free |
| **Umami** | Self-hosted, free | Setup required | Free (hosting) |

### 8.2 Recommended: Plausible + Custom Events

**Why Plausible:**
- GDPR/CCPA compliant (no cookies)
- Simple, focused metrics
- Lightweight script (~1KB)
- No consent banner needed
- Respects Do Not Track

**Supplement with custom events in Supabase for:**
- Subscription conversions
- Feature usage tracking
- User retention metrics

### 8.3 Key Metrics to Track

```
┌─────────────────────────────────────────────────────────────────┐
│                    KEY METRICS                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ACQUISITION                    ENGAGEMENT                      │
│  ├─ Unique visitors            ├─ Sessions per user            │
│  ├─ Traffic sources            ├─ Slides viewed per session    │
│  ├─ Landing pages              ├─ Subreddits browsed           │
│  └─ Device breakdown           ├─ Time on site                 │
│                                ├─ Autoplay usage               │
│  CONVERSION                    └─ Feature usage rates          │
│  ├─ Sign-up rate                                               │
│  ├─ Free → Premium rate        RETENTION                       │
│  ├─ Trial → Paid rate          ├─ DAU/MAU ratio                │
│  ├─ Upgrade funnel drop-off    ├─ Return visitor rate          │
│  └─ Revenue per user           ├─ Churn rate                   │
│                                └─ Cohort retention             │
│  BUSINESS                                                       │
│  ├─ MRR (Monthly Recurring Revenue)                            │
│  ├─ ARR (Annual Recurring Revenue)                             │
│  ├─ LTV (Lifetime Value)                                       │
│  ├─ CAC (Customer Acquisition Cost)                            │
│  └─ Net Revenue Retention                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.4 Event Tracking Plan

```javascript
// Events to track
const EVENTS = {
  // Core usage
  'subreddit_loaded': { subreddit, sort, nsfw },
  'slide_viewed': { subreddit, media_type, position },
  'slideshow_completed': { subreddit, slides_count },

  // Features
  'autoplay_started': { speed },
  'fullscreen_entered': {},
  'media_downloaded': { media_type }, // Premium
  'favorite_added': { subreddit },    // Premium

  // Conversion
  'signup_started': { source },
  'signup_completed': { method },
  'upgrade_modal_shown': { trigger },
  'checkout_started': { plan },
  'subscription_started': { plan, price },
  'subscription_cancelled': { reason },

  // Errors
  'media_load_failed': { url, error },
  'api_error': { endpoint, status }
};
```

---

## 9. Legal & Compliance

### 9.1 Required Legal Documents

| Document | Purpose | Priority |
|----------|---------|----------|
| **Terms of Service** | User agreement | Critical |
| **Privacy Policy** | Data handling | Critical |
| **Cookie Policy** | Cookie usage | High |
| **DMCA Policy** | Copyright claims | Medium |
| **Refund Policy** | Payment disputes | High |

### 9.2 Key Legal Considerations

#### Reddit API Terms
- ⚠️ **Review Reddit API Terms of Service**
- Reddit restricts commercial use of their API
- May need to apply for commercial API access
- Consider using Reddit's official API with OAuth

#### GDPR Compliance (EU Users)
- Explicit consent for data collection
- Right to access, rectify, delete data
- Data portability
- Clear privacy policy
- Data Processing Agreement with vendors

#### CCPA Compliance (California Users)
- "Do Not Sell My Info" option
- Right to know what data is collected
- Right to delete data

#### Payment Compliance
- PCI DSS handled by Stripe
- Clear pricing displayed
- Easy cancellation process
- Transparent refund policy

### 9.3 Privacy Policy Key Points

```
What we collect:
- Account info (email, password hash)
- Usage data (subreddits visited, preferences)
- Payment info (handled by Stripe, we don't store cards)
- Device info (browser, OS - for bug fixing)

What we DON'T collect:
- Content of what you view (we don't store Reddit content)
- Location data
- Personal files

Third parties:
- Stripe (payments)
- Supabase (database)
- Sentry (error tracking)
- Plausible (analytics - no personal data)
```

### 9.4 Terms of Service Key Points

```
User responsibilities:
- Must be 18+ (NSFW content available)
- Don't abuse the service
- Don't scrape/automate
- Respect Reddit's ToS

Our responsibilities:
- Provide the service as described
- Protect user data
- Handle payment securely

Limitations:
- Service provided "as is"
- We're not responsible for Reddit content
- We can terminate accounts for violations

Subscriptions:
- Auto-renew unless cancelled
- Cancel anytime, access until period ends
- Refunds at our discretion (typically within 7 days)
```

---

## 10. Marketing & Growth

### 10.1 Growth Channels

| Channel | Effort | Cost | Potential |
|---------|--------|------|-----------|
| **Reddit** | Medium | Free | High |
| **Product Hunt** | Medium | Free | High (launch) |
| **SEO** | High | Free | Medium-Long term |
| **Twitter/X** | Medium | Free | Medium |
| **Word of mouth** | Low | Free | High |
| **App stores** | Medium | $99/yr | Medium |
| **Paid ads** | Medium | $$$ | Variable |

### 10.2 Launch Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    LAUNCH TIMELINE                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PHASE 1: Soft Launch (Week 1-2)                               │
│  ├─ Deploy to production                                       │
│  ├─ Invite 50-100 beta testers                                │
│  ├─ Gather feedback, fix bugs                                  │
│  └─ Iterate on premium features                                │
│                                                                 │
│  PHASE 2: Public Launch (Week 3)                               │
│  ├─ Product Hunt launch (schedule for Tuesday)                 │
│  ├─ Reddit posts in relevant subreddits                        │
│  ├─ Hacker News "Show HN" post                                 │
│  ├─ Twitter announcement                                       │
│  └─ Launch discount (40% off first year)                       │
│                                                                 │
│  PHASE 3: Growth (Week 4+)                                     │
│  ├─ SEO content (blog posts about Reddit)                      │
│  ├─ Feature updates announcements                              │
│  ├─ User testimonials/reviews                                  │
│  └─ Referral program consideration                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 10.3 Reddit Marketing (Careful!)

**DO:**
- Share genuinely in relevant subreddits (r/InternetIsBeautiful, r/SideProject)
- Respond to feedback honestly
- Be transparent about monetization
- Contribute value to discussions

**DON'T:**
- Spam multiple subreddits
- Use fake accounts
- Hide that you're the creator
- Aggressively promote

### 10.4 SEO Strategy

- **Domain**: redditviewer.app or similar
- **Title**: "Reddit Viewer - Browse Reddit Media in Slideshow Mode"
- **Blog content**: "Best subreddits for X", "How to browse Reddit efficiently"
- **Backlinks**: Product directories, tech blogs

---

## 11. Implementation Roadmap

### Phase 1: Foundation (2-3 weeks)
- [ ] Set up Supabase project
- [ ] Implement authentication (email + Google OAuth)
- [ ] Create database schema
- [ ] Build user profile system
- [ ] Add feature flags infrastructure
- [ ] Deploy to Vercel

### Phase 2: Premium Features (2-3 weeks)
- [ ] Implement favorites/collections
- [ ] Add cloud sync for preferences
- [ ] Build download functionality
- [ ] Create custom themes system
- [ ] Add advanced autoplay options

### Phase 3: Payments (1-2 weeks)
- [ ] Set up Stripe account and products
- [ ] Implement checkout flow
- [ ] Build webhook handlers
- [ ] Create billing portal integration
- [ ] Test subscription lifecycle

### Phase 4: Feedback & Analytics (1 week)
- [ ] Integrate Sentry for error tracking
- [ ] Build feedback/bug report modal
- [ ] Set up Plausible analytics
- [ ] Create admin dashboard for feedback

### Phase 5: Legal & Polish (1 week)
- [ ] Draft Terms of Service
- [ ] Draft Privacy Policy
- [ ] Add cookie consent (if needed)
- [ ] UI polish and testing
- [ ] Performance optimization

### Phase 6: Launch (1 week)
- [ ] Beta testing with select users
- [ ] Fix critical issues
- [ ] Prepare marketing materials
- [ ] Product Hunt submission
- [ ] Public launch

**Total estimated timeline: 8-11 weeks**

---

## 12. Cost Estimates

### Monthly Costs (Starting)

| Service | Free Tier | Paid Tier |
|---------|-----------|-----------|
| Supabase | Free (50k MAU) | $25/mo |
| Vercel | Free | $20/mo |
| Stripe | 2.9% + $0.30/tx | Same |
| Cloudflare | Free | Free |
| Sentry | Free (5k errors) | $26/mo |
| Plausible | - | $9/mo |
| Domain | - | $12/yr |
| **Total** | **~$1/mo** | **~$80/mo** |

### Revenue Projections (Conservative)

| Month | Users | Paid (5%) | MRR |
|-------|-------|-----------|-----|
| 1 | 500 | 25 | $125 |
| 3 | 2,000 | 100 | $500 |
| 6 | 5,000 | 250 | $1,250 |
| 12 | 15,000 | 750 | $3,750 |

*Assuming $5/month average revenue per paid user*

### Break-even Analysis
- Monthly costs: ~$80
- Price per user: $5/month
- Break-even: 16 paying users

---

## 13. Open Questions

### Business Questions
1. **Pricing**: Is $4.99/mo the right price point? Should we test $2.99 or $6.99?
2. **Free tier limits**: Is 3 subreddits/session too restrictive? Or not restrictive enough?
3. **Trial period**: Should we offer 7-day free trial of Premium?
4. **Refund policy**: 7 days? 14 days? No questions asked?

### Technical Questions
1. **Reddit API**: Do we need official API access for commercial use?
2. **NSFW content**: Any legal implications for monetizing access to NSFW subreddits?
3. **Mobile apps**: Should we build native iOS/Android apps? PWA wrapper?
4. **Offline mode**: How important is offline access for premium users?

### Marketing Questions
1. **Target audience**: Who exactly is our ideal customer?
2. **Positioning**: "Better Reddit browsing" vs "Media slideshow" vs "Reddit gallery"?
3. **Competition**: How do we differentiate from Apollo, Relay, RIF, etc.?

### Feature Priority Questions
1. **What's the #1 feature that would make users pay?**
2. **Should we add Reddit login for personalized feeds?**
3. **Video download - legal concerns?**

---

## Next Steps

1. **Validate the business model** - Talk to potential users
2. **Choose specific technologies** - Confirm Supabase + Stripe
3. **Create detailed technical specs** - For each phase
4. **Set up development environment** - Staging vs production
5. **Start Phase 1 implementation** - Auth + database

---

*Document created: February 2026*
*Last updated: February 2026*
*Version: 1.0*
