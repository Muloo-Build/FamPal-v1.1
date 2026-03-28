
import { GoogleGenAI, Type } from "@google/genai";
import { Place, ActivityType, Child, Preferences } from "./types";
import { db, collection, addDoc, serverTimestamp } from "./lib/firebase";
import { reserveSmartInsightCredit, refundSmartInsightCredit } from "./lib/smartInsightCredits";

export interface SearchContext {
  userPreferences?: Preferences;
  childrenPreferences?: Preferences[];
  partnerPreferences?: Preferences;
  circlePreferences?: Preferences[];
  searchMode?: 'me' | 'family' | 'partner' | 'circle';
}

import { auth } from './lib/firebase';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');

const getAI = () => {
  return {
    models: {
      generateContent: async (params: { model: string, contents: string, config?: any }) => {
        const currentUser = auth?.currentUser;
        let headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (currentUser) {
          const token = await currentUser.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        }
        
        const response = await fetch(`${API_BASE}/api/gemini/generate`, {
          method: 'POST',
          headers,
          body: JSON.stringify(params)
        });
        
        if (!response.ok) {
          throw new Error(await response.text().catch(() => 'request_failed'));
        }
        
        const data = await response.json();
        return {
          text: data.text || ''
        };
      }
    }
  };
};

const AI_MAX_OUTPUT_TOKENS = Number(import.meta.env.VITE_AI_MAX_OUTPUT_TOKENS || 512);
const AI_SUMMARY_MAX_OUTPUT_TOKENS = Number(import.meta.env.VITE_AI_SUMMARY_MAX_OUTPUT_TOKENS || 256);
const AI_TIMEOUT_MS = Number(import.meta.env.VITE_AI_TIMEOUT_MS || 15000);
const AI_CACHE_TTL_MS = Number(import.meta.env.VITE_AI_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const AI_CACHE_STORAGE_KEY = 'fampal_ai_cache';

// Reliable placeholder images by place type using Unsplash
const placeholderImages: Record<string, string[]> = {
  restaurant: [
    "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600&h=400&fit=crop",
  ],
  outdoor: [
    "https://images.unsplash.com/photo-1568393691622-c7ba131d63b4?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=400&fit=crop",
  ],
  indoor: [
    "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1536851674530-790ad26e2388?w=600&h=400&fit=crop",
  ],
  active: [
    "https://images.unsplash.com/photo-1564429238981-03da5e2d1a85?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1596464716127-f2a82984de30?w=600&h=400&fit=crop",
  ],
  hike: [
    "https://images.unsplash.com/photo-1551632811-561732d1e306?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=600&h=400&fit=crop",
  ],
  show: [
    "https://images.unsplash.com/photo-1503095396549-807759245b35?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=600&h=400&fit=crop",
  ],
  wine: [
    "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1543418219-44e30b057fea?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=600&h=400&fit=crop",
  ],
  all: [
    "https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1476234251651-f353703a034d?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1472653431158-6364773b2a56?w=600&h=400&fit=crop",
  ],
};

function getPlaceholderImage(type: string, name: string, index: number): string {
  const typeImages = placeholderImages[type] || placeholderImages.all;
  // Use name hash + index to get consistent but varied images
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return typeImages[(hash + index) % typeImages.length];
}

type AiUsageMeta = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  latencyMs: number;
};

type AiUsageCallback = (info: { cached: boolean; usage?: AiUsageMeta }) => void;

function getUsageMonthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildLimitReachedError(limit: number): Error {
  const error = new Error('limit_reached');
  (error as any).code = 'limit_reached';
  (error as any).limit = limit;
  return error;
}

function buildRateLimitedError(): Error {
  const error = new Error('rate_limited');
  (error as any).code = 'rate_limited';
  return error;
}

async function reserveCreditBeforeGemini(userId?: string): Promise<boolean> {
  if (!userId) return false;
  const result = await reserveSmartInsightCredit();
  if (!result.ok) {
    if ('reason' in result && result.reason === 'rate_limited') {
      throw buildRateLimitedError();
    }
    throw buildLimitReachedError('limit' in result ? result.limit : 0);
  }
  return true;
}

async function tryRefundCredit(userId?: string): Promise<void> {
  if (!userId) return;
  try {
    await refundSmartInsightCredit();
  } catch (refundError) {
    console.warn('[FamPal] Failed to refund smart insight credit.', refundError);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('AI request timed out.'));
    }, ms);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getAiCache(): Record<string, { value: string; timestamp: number }> {
  try {
    const cached = localStorage.getItem(AI_CACHE_STORAGE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function getCachedAiResponse(key: string): string | null {
  const cache = getAiCache();
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < AI_CACHE_TTL_MS) {
    return entry.value;
  }
  return null;
}

function setCachedAiResponse(key: string, value: string) {
  try {
    const cache = getAiCache();
    cache[key] = { value, timestamp: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > 50) {
      const oldest = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp)[0];
      delete cache[oldest];
    }
    localStorage.setItem(AI_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore cache failures
  }
}

function extractUsage(response: any): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const usage = response?.usageMetadata || response?.response?.usageMetadata || {};
  const inputTokens = usage?.promptTokenCount ?? usage?.promptTokens ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? usage?.completionTokens ?? 0;
  const totalTokens = usage?.totalTokenCount ?? usage?.totalTokens ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

async function logAiUsage(userId: string | undefined, featureName: string, usage: AiUsageMeta) {
  if (!userId || !db) return;
  try {
    await addDoc(collection(db, 'users', userId, 'aiUsageLogs'), {
      timestamp: serverTimestamp(),
      user_id: userId,
      feature_name: featureName,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      model_name: usage.model,
      latency_ms: usage.latencyMs,
    });
  } catch (err) {
    console.warn('[FamPal] Failed to log AI usage.', err);
  }
}

export async function fetchNearbyPlaces(
  lat: number,
  lng: number,
  type: ActivityType = 'all',
  children: Child[] = [],
  radiusKm: number = 10,
  searchQuery?: string,
  searchContext?: SearchContext,
  options?: { userId?: string; featureName?: string }
): Promise<Place[]> {
  if (!import.meta.env.VITE_GEMINI_API_KEY) {
    throw new Error("Gemini API key missing – AI disabled");
  }
  
  // Create cache key including children ages and preferences for proper family context
  const safeChildren = Array.isArray(children) ? children : [];
  const agesKey = safeChildren.map(c => c.age).sort().join(',') || 'none';
  const userPrefsKey = searchContext?.userPreferences ? 
    `f:${(searchContext.userPreferences.foodPreferences || []).join(',')}|a:${(searchContext.userPreferences.allergies || []).join(',')}|ac:${(searchContext.userPreferences.accessibility || []).join(',')}` : '';
  const childPrefsKey = safeChildren.map(c => 
    c.preferences ? `${c.name}:a:${(c.preferences.allergies || []).join(',')}` : ''
  ).filter(Boolean).join(';');
  const cacheKey = `${lat.toFixed(2)}:${lng.toFixed(2)}:${type}:${radiusKm}:${searchQuery || ''}:ages:${agesKey}:uprefs:${userPrefsKey}:cprefs:${childPrefsKey}`;
  
  // Check localStorage cache first (persists across page refreshes)
  const cached = getCachedPlaces(cacheKey);
  if (cached) {
    console.log('[FamPal] Loaded places from cache');
    return cached;
  }
  
  const ai = getAI();
  try {
    const ageContext = safeChildren.length > 0
      ? ` The family has children with ages: ${safeChildren.map(c => c.age).join(', ')}. Recommend places appropriate for these ages.`
      : " Recommend generic kid-friendly spots.";
    
    const searchQueryContext = searchQuery 
      ? ` Focus on places matching: "${searchQuery}".`
      : "";

    // Build preferences context
    let prefsContext = '';
    if (searchContext?.userPreferences) {
      const p = searchContext.userPreferences;
      const parts = [];
      if (p.foodPreferences?.length) parts.push(`Food: ${p.foodPreferences.join(', ')}`);
      if (p.allergies?.length) parts.push(`AVOID due to allergies: ${p.allergies.join(', ')}`);
      if (p.accessibility?.length) parts.push(`Accessibility needs: ${p.accessibility.join(', ')}`);
      if (p.activityPreferences?.length) parts.push(`Preferred activities: ${p.activityPreferences.join(', ')}`);
      if (parts.length) prefsContext += ` User preferences: ${parts.join('. ')}.`;
    }
    
    // Add children's preferences
    if (safeChildren.length > 0) {
      safeChildren.forEach(child => {
        if (child.preferences) {
          const p = child.preferences;
          const parts = [];
          if (p.allergies?.length) parts.push(`allergies: ${p.allergies.join(', ')}`);
          if (p.activityPreferences?.length) parts.push(`likes: ${p.activityPreferences.join(', ')}`);
          if (parts.length) prefsContext += ` Child ${child.name} (age ${child.age}): ${parts.join(', ')}.`;
        }
      });
    }

    const prompt = `Find 5-10 kid and pet-friendly ${type === 'all' ? 'places' : type} within ${radiusKm}km of ${lat}, ${lng}.${ageContext}${searchQueryContext}${prefsContext}
    Return a strict JSON array of REAL places with actual contact info. Each place must have an id, name, description, address, rating (1-5), tags (array of strings), mapsUrl (Google Maps link), type, priceLevel ($, $$, $$$), imageUrl, distance (string), ageAppropriate string, phone (real phone number if known), and website (real website URL if known).`;

    const startedAt = performance.now();
    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                address: { type: Type.STRING },
                rating: { type: Type.NUMBER },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                mapsUrl: { type: Type.STRING },
                type: { type: Type.STRING, enum: ["restaurant", "outdoor", "indoor", "active", "hike", "wine", "golf", "all"] },
                priceLevel: { type: Type.STRING, enum: ["$", "$$", "$$$", "$$$$"] },
                imageUrl: { type: Type.STRING },
                distance: { type: Type.STRING },
                ageAppropriate: { type: Type.STRING },
                phone: { type: Type.STRING },
                website: { type: Type.STRING },
              },
              required: ["id", "name", "description", "address", "rating", "tags", "mapsUrl", "type", "priceLevel", "imageUrl", "distance", "ageAppropriate"],
            },
          },
        },
      }),
      AI_TIMEOUT_MS
    );

    const responseText = response.text;
    const data = responseText ? JSON.parse(responseText) : null;

    if (!data || !Array.isArray(data)) {
      console.warn("Gemini returned invalid JSON structure", data);
      return getSeedData(type);
    }

    // Post-process to ensure IDs are unique and use reliable placeholder images
    const places = data.map((place: any, index: number) => ({
      ...place,
      id: place.id || `gen-${Date.now()}-${index}`,
      imageUrl: getPlaceholderImage(place.type, place.name, index)
    }));
    const latencyMs = Math.round(performance.now() - startedAt);
    const usage = extractUsage(response);
    const featureName = options?.featureName || 'ai_places_search';
    logAiUsage(options?.userId, featureName, {
      ...usage,
      model: "gemini-2.5-flash",
      latencyMs,
    });
    
    // Cache the results to localStorage (persists across page refreshes)
    setPlacesCache(cacheKey, { places, timestamp: Date.now() });
    console.log('[FamPal] Cached places for faster loading');
    
    return places;

  } catch (error: any) {
    console.error("Gemini Fetch Error:", error);
    return getSeedData(type);
  }
}

// In-memory cache for AI responses during the session (reduces API calls for repeated questions)
const aiResponseCache: Map<string, string> = new Map();

// Persistent localStorage cache for places (survives page refresh)
const PLACES_CACHE_KEY = 'fampal_places_cache';
const PLACES_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for better UX

interface CacheEntry {
  places: Place[];
  timestamp: number;
}

interface PlacesCacheData {
  [key: string]: CacheEntry;
}

function getPlacesCache(): PlacesCacheData {
  try {
    const cached = localStorage.getItem(PLACES_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function setPlacesCache(key: string, data: CacheEntry) {
  try {
    const cache = getPlacesCache();
    cache[key] = data;
    // Keep only last 10 cache entries to avoid storage bloat
    const keys = Object.keys(cache);
    if (keys.length > 10) {
      const oldest = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp)[0];
      delete cache[oldest];
    }
    localStorage.setItem(PLACES_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Silently fail if localStorage is full
  }
}

function getCachedPlaces(key: string): Place[] | null {
  const cache = getPlacesCache();
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < PLACES_CACHE_TTL) {
    return entry.places;
  }
  return null;
}

export interface TripContext {
  allergies?: string[];
  accessibility?: string[];
  foodPreferences?: string[];
  activityPreferences?: string[];
  includesPartner?: boolean;
  includesChildren?: boolean;
}

export async function askAboutPlace(
  place: Place,
  question: string,
  userContext?: { childrenAges?: number[]; tripContext?: TripContext },
  options?: { userId?: string; featureName?: string; forceRefresh?: boolean; onUsage?: AiUsageCallback }
): Promise<string> {
  if (!import.meta.env.VITE_GEMINI_API_KEY) {
    throw new Error("Gemini API key missing – AI disabled");
  }
  
  // Create a cache key from place ID, question, and family context
  const agesKey = userContext?.childrenAges?.sort().join(',') || 'none';
  const tripKey = userContext?.tripContext ? 
    `${userContext.tripContext.allergies?.join(',')}|${userContext.tripContext.foodPreferences?.join(',')}` : 'none';
  const usageMonth = getUsageMonthKey();
  const userIdPart = options?.userId || 'guest';
  const cacheKey = `user:${userIdPart}:place:${place.id}:month:${usageMonth}:q:${question.toLowerCase().trim()}:ages:${agesKey}:trip:${tripKey}`;
  
  // Check memory cache first
  if (!options?.forceRefresh) {
    if (aiResponseCache.has(cacheKey)) {
      options?.onUsage?.({ cached: true });
      return aiResponseCache.get(cacheKey)!;
    }
    const cached = getCachedAiResponse(cacheKey);
    if (cached) {
      aiResponseCache.set(cacheKey, cached);
      options?.onUsage?.({ cached: true });
      return cached;
    }
  }

  const creditReserved = await reserveCreditBeforeGemini(options?.userId);
  
  const ai = getAI();
  
  try {
    const startedAt = performance.now();
    const childContext = userContext?.childrenAges?.length 
      ? `The family has children aged ${userContext.childrenAges.join(', ')}.`
      : '';
    
    // Build trip context section
    const tripContext = userContext?.tripContext;
    let tripContextSection = '';
    if (tripContext) {
      const parts: string[] = [];
      if (tripContext.includesPartner) parts.push('This trip includes the parents/partner.');
      if (tripContext.includesChildren) parts.push('Children are coming on this trip.');
      if (tripContext.allergies?.length) parts.push(`IMPORTANT - Group has allergies to: ${tripContext.allergies.join(', ')}. Please check if this venue can accommodate these allergies.`);
      if (tripContext.accessibility?.length) parts.push(`Accessibility needs: ${tripContext.accessibility.join(', ')}.`);
      if (tripContext.foodPreferences?.length) parts.push(`Food preferences: ${tripContext.foodPreferences.join(', ')}.`);
      if (parts.length) tripContextSection = '\n\nTrip context:\n' + parts.join('\n');
    }
    
    const prompt = `You are a helpful family travel assistant. A parent is asking about "${place.name}" located at ${place.address}.

Place details:
- Type: ${place.type}
- Rating: ${place.rating}/5
- Price: ${place.priceLevel}
- Tags: ${place.tags.join(', ')}
- Description: ${place.description}

${childContext}${tripContextSection}

Question: ${question}

Provide a helpful, concise answer focused on family-friendliness, kid safety, and practical tips. If there are allergy concerns, address them specifically. Keep response under 150 words.`;

    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        },
      }),
      AI_TIMEOUT_MS
    );

    const answer = response.text || "Sorry, I couldn't generate an answer. Please try again.";
    
    // Cache the response
    aiResponseCache.set(cacheKey, answer);
    setCachedAiResponse(cacheKey, answer);
    const latencyMs = Math.round(performance.now() - startedAt);
    const usage = extractUsage(response);
    const featureName = options?.featureName || 'ask_about_place';
    const usageMeta: AiUsageMeta = {
      ...usage,
      model: "gemini-2.5-flash",
      latencyMs,
    };
    logAiUsage(options?.userId, featureName, usageMeta);
    options?.onUsage?.({ cached: false, usage: usageMeta });
    
    return answer;
  } catch (error: any) {
    if (creditReserved) {
      await tryRefundCredit(options?.userId);
    }
    console.error("Gemini Ask Error:", error);
    throw error;
  }
}

export async function generateFamilySummary(
  place: Place,
  childrenAges?: number[],
  options?: { userId?: string; featureName?: string; forceRefresh?: boolean; onUsage?: AiUsageCallback }
): Promise<string> {
  
  const usageMonth = getUsageMonthKey();
  const userIdPart = options?.userId || 'guest';
  const cacheKey = `summary:user:${userIdPart}:place:${place.id}:month:${usageMonth}:ages:${childrenAges?.join(',') || 'general'}`;
  
  if (!options?.forceRefresh) {
    if (aiResponseCache.has(cacheKey)) {
      options?.onUsage?.({ cached: true });
      return aiResponseCache.get(cacheKey)!;
    }
    const cached = getCachedAiResponse(cacheKey);
    if (cached) {
      aiResponseCache.set(cacheKey, cached);
      options?.onUsage?.({ cached: true });
      return cached;
    }
  }

  const creditReserved = await reserveCreditBeforeGemini(options?.userId);
  
  const ai = getAI();
  
  try {
    const startedAt = performance.now();
    const ageContext = childrenAges?.length 
      ? `for a family with children aged ${childrenAges.join(', ')}`
      : 'for families with young children';
    
    const prompt = `Generate a brief, enthusiastic family-friendly summary ${ageContext} for:

"${place.name}" at ${place.address}
Type: ${place.type} | Rating: ${place.rating}/5 | Price: ${place.priceLevel}
Tags: ${place.tags.join(', ')}

Include: 
1. Why families love it (1 sentence)
2. Best for ages (specific range)
3. Pro tip for parents (1 sentence)

Keep it under 80 words, warm and helpful tone.`;

    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: AI_SUMMARY_MAX_OUTPUT_TOKENS,
        },
      }),
      AI_TIMEOUT_MS
    );

    const summary = response.text || place.description;
    aiResponseCache.set(cacheKey, summary);
    setCachedAiResponse(cacheKey, summary);
    const latencyMs = Math.round(performance.now() - startedAt);
    const usage = extractUsage(response);
    const featureName = options?.featureName || 'family_summary';
    const usageMeta: AiUsageMeta = {
      ...usage,
      model: "gemini-2.5-flash",
      latencyMs,
    };
    logAiUsage(options?.userId, featureName, usageMeta);
    options?.onUsage?.({ cached: false, usage: usageMeta });
    
    return summary;
  } catch (error: any) {
    if (creditReserved) {
      await tryRefundCredit(options?.userId);
    }
    console.error("Gemini Summary Error:", error);
    throw error;
  }
}

function getSeedData(type: string): Place[] {
  const base = [
    {
      id: 'seed-1',
      name: "Sunny Side Playground",
      description: "Massive outdoor park with specialized areas for toddlers and pre-teens.",
      address: "123 Golden Gate Park",
      rating: 4.8,
      tags: ["Outdoor", "Free", "Stroller-Friendly"],
      mapsUrl: "https://maps.google.com",
      type: "outdoor" as const,
      priceLevel: "$" as const,
      imageUrl: getPlaceholderImage("outdoor", "Sunny Side Playground", 0),
      distance: "0.4 km",
      ageAppropriate: "0-12"
    },
    {
      id: 'seed-2',
      name: "The Pet-Friendly Pasta Bar",
      description: "Dine with your dog and kids. Includes a coloring station and dog treats.",
      address: "456 Main St",
      rating: 4.6,
      tags: ["Dine", "Pet-Friendly", "Kids Menu"],
      mapsUrl: "https://maps.google.com",
      type: "restaurant" as const,
      priceLevel: "$$" as const,
      imageUrl: getPlaceholderImage("restaurant", "The Pet-Friendly Pasta Bar", 1),
      distance: "1.1 km",
      ageAppropriate: "All ages"
    }
  ];
  return base.filter(p => type === 'all' || p.type === type);
}
