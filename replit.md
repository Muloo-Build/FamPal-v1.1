# FamPals - Parents Local Guide

## Overview
FamPals is a mobile-first React app that helps parents discover and explore family-friendly venues nearby. Clean, minimal design — white backgrounds, teal accents, iOS-style aesthetic.

## User Preferences
The user prefers iterative development and detailed explanations. Ask before making major architectural changes. The user actively develops in VS Code and pushes to GitHub.

## Design System — Clean & Light (May 2026)
- **Background**: `#f8fafc` (slate-50)
- **Cards**: white, `rounded-3xl`, shadow `0_4px_24px_rgb(0,0,0,0.06)`
- **Primary accent**: teal-600 `#0d9488` — buttons, active states, links
- **Text primary**: slate-900 `#0f172a`
- **Text muted**: slate-500 `#64748b`
- **Border**: slate-100/slate-200
- **Ratings**: amber-400/amber-50
- **Saved/heart**: rose-500
- **Success/open**: emerald
- **Font**: system UI (`-apple-system, BlinkMacSystemFont, Segoe UI, Roboto`)
- **Bottom nav**: white/90 backdrop-blur, teal active + bg-teal-50 pill
- **Category chips**: teal-600 active, white border inactive
- **Hero photo nav**: rounded-full dots, white/50 inactive, white active

## System Architecture

**Tech Stack:**
- React 19 + TypeScript + Vite 7 + Tailwind CSS v4
- Mobile-first responsive UI

**Auth (JWT-based, not Firebase):**
- `lib/firebase.ts` — custom JWT auth. Google Sign-In via Google Identity Services, email/password via custom API. Token stored in localStorage (`fampal_auth_token`), user in `fampal_auth_user`.
- Key exports: `onAuthStateChanged`, `signInWithGoogle`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `sendPasswordResetEmail`, `signOut`
- Auth API endpoints: `POST /api/auth/google`, `POST /api/auth/login`, `POST /api/auth/signup`

**Data (Railway Postgres via REST API):**
- `lib/userData.ts` — polling-based sync (10s). Key exports: `listenToSavedPlaces`, `upsertSavedPlace`, `deleteSavedPlace`, `listenToUserDoc`, `upsertUserProfile`, `saveUserField`
- Saved places API: `GET/PUT/DELETE /api/user/me/saved-places/:placeId`

**Places:**
- `GET /api/places/nearby?lat=&lng=&radius=&type=&keyword=` — Google Places nearby search
- `GET /api/places/search?query=&lat=&lng=` — Text search
- `GET /api/places/details/:placeId` — Place detail
- `GET /api/places/photo?photoReference=&maxWidth=` — Photo proxy
- Returns standard Google Places API JSON shape

**Server:**
- `server/index.ts` — Express on port 8080. Proxied via Vite dev server on port 5000.

## Responsive Layout (Desktop)
- **BottomNav**: Mobile = bottom bar; Desktop (md+) = fixed left sidebar (16px icon-only → 56px with labels on lg)
- **All screens**: `md:pl-16 lg:pl-56` shifts content right of sidebar; `max-w-7xl mx-auto` centers content
- **Explore cards**: `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` — 1→2→3 columns
- **Saved items**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` grid
- **VenueDetail**: Mobile = stacked; Desktop = 2-column (photo gallery left, info right) with thumbnail strip
- **Profile**: `max-w-3xl mx-auto` centered column
- **Hover states**: Added `hover:` variants on all interactive elements for desktop UX

## File Structure

```
App.tsx                      — Auth-aware router (5 routes)
index.tsx                    — Entry point (BrowserRouter + React root)
types.ts                     — Shared types: AuthUser, Venue, VenueDetail, SavedPlace
index.html                   — PWA meta, Google GSI script
src/
  index.css                  — Tailwind v4 + scrollbar-hide + animations
  screens/
    Login.tsx                — Welcome + Google + Email/Password + guest mode
    Explore.tsx              — Home: sticky header, search, category chips, venue grid
    VenueDetail.tsx          — Photo gallery (desktop: 2-col), details, contact, save/share
    Saved.tsx                — Saved places grid with delete
    Profile.tsx              — User info, settings, sign out
  components/
    BottomNav.tsx            — Mobile: bottom bar; Desktop: left sidebar with brand logo
    VenueCard.tsx            — Card with photo, category badge, rating, distance, heart
lib/
  firebase.ts                — JWT auth (keep as-is)
  userData.ts                — API data sync (keep as-is)
server/
  index.ts                   — Express API server (keep as-is)
```

## Recently Viewed
- `lib/recentlyViewed.ts` — localStorage utility: `addRecentlyViewed`, `getRecentlyViewed`, `clearRecentlyViewed`
- Key: `fampal_recently_viewed`, max 8 items, newest first
- Tracked on VenueDetail mount (after venue loads)
- Shown in Profile as a horizontal scroll row with thumbnails + clear button

## Guest / Unauth Access
- Explore (`/`) and VenueDetail (`/venue/:placeId`) are open to all — no login required
- Saved (`/saved`) and Profile (`/profile`) require real auth or guest mode
- Unauthed users on Explore see a "Sign in" nudge banner; heart button redirects to login

## Explore Improvements
- 12 categories: All, Parks, Restaurants, Play Areas, Museums, Beaches, Nature, Sports, Arts & Crafts, Birthday, Splash Parks, Farms
- 6 filters: Open Now 🟢, Kid Friendly 👶, Dog Friendly 🐕, Wheelchair ♿, Outdoor 🌿, Restrooms 🚻
- Open Now filter shows count of currently-open venues in the label
- Location name resolved via Nominatim reverse geocoding (free, no key needed)
- `openNow` field added to `Venue` type, mapped from `place.opening_hours?.open_now`

## VenueCard
- Open/Closed badge shown top-left when `openNow` is defined (emerald green when open, dark when closed)
- Heart button top-right; Category badge bottom-left

## Profile
- Live stats: Saved count, Visited count (places tagged `been_loved`), Favourites count (places tagged `favourite`)
- Recently Viewed section with horizontal scroll thumbnails
- Share FamPals button (Web Share API with clipboard fallback)
- Dark mode toggle removed (was non-functional)

## Place Tags & Private Notes
- `PLACE_TAGS` exported from `src/screens/VenueDetail.tsx`: Favourite ⭐, Been there loved it ✅, Date night 🌙, Family outing 👨‍👩‍👧, Want to visit 📌, Not for me 👎
- When saving a place for the first time, a bottom sheet slides up to let user tag + add a private note
- Tag button (🏷️) in header re-opens the sheet on saved places
- Private notes are amber-styled, edit-in-place, only visible to the owner
- `patchSavedPlace` in `lib/userData.ts` calls `PATCH /api/user/me/saved-places/:placeId` to update tags/notes without changing save time
- DB: `user_saved_places.place_tags TEXT[]` + `user_saved_places.private_notes TEXT` (migrated)

## Saved Screen
- Filter tabs row at top: All + one tab per tag that has at least 1 place (with counts)
- Saved place cards show tag badges + italic private note preview
- Hover reveals pencil (edit tags/notes) and heart (unsave) action buttons
- Import `PLACE_TAGS` from `src/screens/VenueDetail.tsx`

## Attributes Section (VenueDetail "Why it works for families")
- Replaces flat badge row with expandable per-attribute cards
- Kid Friendly: lists "Good for children" + "Children's menu available" if `menuForChildren`
- Wheelchair Accessible: lists specific sub-options (entrance, parking, restrooms, seating) from `accessibilityOptions`
- Dog Friendly, Outdoor Seating, Restrooms also shown with plain-language reasons

## Key Behaviours
- Guest mode: can browse Explore and Venue Detail, cannot save. Prompted to sign in.
- Location: browser geolocation on load, defaults to Cape Town (-33.9249, 18.4241) on failure.
- Category search maps to Google Places `type` + `keyword` params.
- Radius slider (1–50km) in header, persists during session.
- Search is debounced 500ms, uses `/api/places/search` endpoint.
- Photos: `/api/places/photo?photoReference=xxx&maxWidth=600` (VenueCard), `maxWidth=800` (detail).
- Distance calculated client-side via Haversine formula.
- Saved places: optimistic UI (update local state immediately, sync to server async).

## External Dependencies
- **Google Places API**: Venue search, details, photos (proxied via Express server)
- **Google Identity Services**: OAuth sign-in (`accounts.google.com/gsi/client`)
- **Railway Postgres**: User data, saved places (via REST API, JWT auth)
- **Paystack**: Payment processing (server-side, not used in new UI yet)
