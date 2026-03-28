import { ActivityType } from '../../types';
import {
  auth,
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  setDoc,
  startAt,
  serverTimestamp,
  endAt,
  where,
} from '../../lib/firebase';

export interface GeoBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface PlaceSourceGoogle {
  googlePlaceId: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: string;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number | string;
  mapsUrl?: string;
  photoUrl?: string;
  goodForChildren?: boolean;
  menuForChildren?: boolean;
  restroom?: boolean;
  allowsDogs?: boolean;
  accessibilityOptions?: Record<string, unknown>;
  parkingOptions?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface CategoryContext {
  requestedCategory: ActivityType;
  searchQuery?: string;
  ingestionSource?: 'searchNearbyPlacesTextApi' | 'textSearchPlaces' | 'legacyPlacesApi' | string;
}

export interface PlaceFacets {
  categories: ActivityType[];
  venueTypes: string[];
  foodTypes: string[];
  kidFriendlySignals: string[];
  accessibilitySignals: string[];
  petFriendlySignals: string[];
  indoorOutdoorSignals: string[];
  confidence: number;
}

export interface PlaceRecord {
  placeId: string;
  googlePlaceId: string;
  name: string;
  normalizedName: string;
  address: string;
  geo: { lat: number; lng: number; geohash?: string };
  rating: number | null;
  userRatingsTotal: number | null;
  priceLevel: string | null;
  mapsUrl: string;
  imageUrl: string | null;
  types: string[];
  primaryType: string | null;
  facets: Omit<PlaceFacets, 'confidence'>;
  facetsConfidence: number;
  categoryContext: {
    requestedCategory: ActivityType;
    searchQuery?: string;
    ingestionSource?: string;
  };
  sourceVersions: {
    google: string;
  };
  reportTrust?: {
    kidPrefs: Record<string, { positiveWeight: number; totalWeight: number; confidence: number; positive: boolean }>;
    accessibility: Record<string, { positiveWeight: number; totalWeight: number; confidence: number; positive: boolean }>;
    reportCount: number;
    weightedReportCount: number;
    lastAggregatedAt?: unknown;
  };
  refreshState: {
    nextRefreshAt?: unknown;
    status: 'ready' | 'refreshing' | 'error';
    consecutiveFailures: number;
    lastAttemptAt?: unknown;
    lastError?: string | null;
  };
  staleAfterDays: number;
  popularityScore: number;
  savedCount?: number;
  viewCount?: number;
  lastRefreshedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const INDOOR_HINTS = ['museum', 'gallery', 'library', 'cinema', 'mall', 'bowling', 'aquarium', 'indoor'];
const OUTDOOR_HINTS = ['park', 'trail', 'hike', 'beach', 'garden', 'camp', 'nature', 'outdoor'];
const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function normalizeToken(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, '_');
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim();
}

function keywordMatches(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizePriceLevel(priceLevel?: number | string): string | null {
  if (priceLevel === undefined || priceLevel === null) return null;
  if (typeof priceLevel === 'string') return priceLevel;
  if (priceLevel <= 0) return '$';
  if (priceLevel === 1) return '$';
  if (priceLevel === 2) return '$$';
  if (priceLevel === 3) return '$$$';
  return '$$$$';
}

function sanitizeGooglePlaceId(googlePlaceId: string): string {
  return googlePlaceId.replace(/\//g, '_').trim();
}

function encodeGeohash(lat: number, lng: number, precision: number): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let isLngStep = true;
  let bit = 0;
  let ch = 0;
  let geohash = '';
  const bits = [16, 8, 4, 2, 1];

  while (geohash.length < precision) {
    if (isLngStep) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch |= bits[bit];
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= bits[bit];
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }

    isLngStep = !isLngStep;
    if (bit < 4) {
      bit += 1;
    } else {
      geohash += GEOHASH_BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return geohash;
}

function pickGeohashPrecision(bounds: GeoBounds): number {
  const latDelta = Math.abs(bounds.north - bounds.south);
  const lngDelta = Math.abs(bounds.east - bounds.west);
  const span = Math.max(latDelta, lngDelta);
  if (span <= 0.02) return 7;
  if (span <= 0.08) return 6;
  if (span <= 0.3) return 5;
  return 4;
}

function buildGeohashPrefixes(bounds: GeoBounds): string[] {
  const precision = pickGeohashPrecision(bounds);
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const samples: Array<[number, number]> = [
    [bounds.north, bounds.west],
    [bounds.north, bounds.east],
    [bounds.south, bounds.west],
    [bounds.south, bounds.east],
    [centerLat, centerLng],
    [centerLat, bounds.west],
    [centerLat, bounds.east],
    [bounds.north, centerLng],
    [bounds.south, centerLng],
  ];

  const prefixes = new Set<string>();
  samples.forEach(([lat, lng]) => prefixes.add(encodeGeohash(lat, lng, precision)));
  if (precision > 4) {
    prefixes.add(encodeGeohash(centerLat, centerLng, precision - 1));
  }
  return Array.from(prefixes);
}

function inBounds(geo: { lat: number; lng: number }, bounds: GeoBounds): boolean {
  return geo.lat >= bounds.south && geo.lat <= bounds.north && geo.lng >= bounds.west && geo.lng <= bounds.east;
}

function computePopularityScore(savedCount: number, viewCount: number, userRatingsTotal?: number): number {
  const ratingsSignal = Math.min(Math.max(userRatingsTotal || 0, 0), 1000);
  return Math.max(0, savedCount * 20 + viewCount + Math.round(ratingsSignal / 10));
}

function computeStaleAfterDays(savedCount: number, viewCount: number, popularityScore: number): number {
  const highEngagement = savedCount >= 10 || viewCount >= 500 || popularityScore >= 120;
  return highEngagement ? 7 : 30;
}

function pickCategories(types: string[], source: PlaceSourceGoogle, requestedCategory: ActivityType): ActivityType[] {
  const set = new Set<ActivityType>();
  const normalizedTypes = types.map(normalizeToken);
  const text = `${source.name || ''} ${source.primaryTypeDisplayName || ''}`.toLowerCase();

  if (normalizedTypes.some((type) => ['restaurant', 'cafe', 'meal_takeaway', 'meal_delivery', 'bakery'].includes(type))) {
    set.add('restaurant');
  }
  if (normalizedTypes.some((type) => ['park', 'national_park', 'beach', 'campground', 'hiking_area'].includes(type))) {
    set.add('outdoor');
  }
  if (normalizedTypes.some((type) => ['museum', 'movie_theater', 'library', 'bowling_alley', 'aquarium'].includes(type))) {
    set.add('indoor');
  }
  if (normalizedTypes.some((type) => ['gym', 'sports_complex', 'swimming_pool', 'amusement_park', 'playground'].includes(type))) {
    set.add('active');
  }
  if (normalizedTypes.some((type) => ['hiking_area', 'national_park', 'state_park'].includes(type)) || keywordMatches(text, ['hike', 'trail'])) {
    set.add('hike');
  }
  if (normalizedTypes.some((type) => ['winery', 'vineyard'].includes(type)) || keywordMatches(text, ['wine farm', 'wine estate', 'wine tasting'])) {
    set.add('wine');
  }
  if (normalizedTypes.some((type) => ['golf_course'].includes(type)) || keywordMatches(text, ['golf'])) {
    set.add('golf');
  }
  if (
    normalizedTypes.some((type) => ['playground', 'amusement_park', 'zoo', 'aquarium'].includes(type)) ||
    keywordMatches(text, ['kids', 'family', 'child'])
  ) {
    set.add('kids');
  }

  if (set.size === 0 && requestedCategory !== 'all') {
    set.add(requestedCategory);
  }
  if (set.size === 0) {
    set.add('all');
  }

  return Array.from(set);
}

export function computeFacetsFromGoogleSource(source: PlaceSourceGoogle, requestedCategory: ActivityType): PlaceFacets {
  const types = (source.types || []).map(normalizeToken);
  const text = `${source.name || ''} ${source.primaryTypeDisplayName || ''} ${source.address || ''}`.toLowerCase();

  const venueTypes = new Set<string>();
  const foodTypes = new Set<string>();
  const kidFriendlySignals = new Set<string>();
  const accessibilitySignals = new Set<string>();
  const indoorOutdoorSignals = new Set<string>();

  if (types.includes('restaurant') || types.includes('meal_takeaway') || types.includes('meal_delivery')) venueTypes.add('restaurant');
  if (types.includes('cafe') || types.includes('coffee_shop')) venueTypes.add('cafe');
  if (types.includes('bar') || types.includes('pub')) venueTypes.add('bar_pub');
  if (types.includes('market')) venueTypes.add('market');
  if (types.includes('bakery')) venueTypes.add('bakery');
  if (types.includes('food_truck') || keywordMatches(text, ['food truck'])) venueTypes.add('food_truck');
  if (types.includes('winery') || keywordMatches(text, ['wine farm', 'wine estate', 'wine tasting'])) venueTypes.add('wine_farm');

  const foodKeywords = [
    'coffee', 'bakery', 'brunch', 'breakfast', 'pizza', 'sushi', 'burger', 'steak', 'seafood',
    'italian', 'pasta', 'indian', 'curry', 'mexican', 'tacos', 'asian', 'thai', 'chinese',
    'ice cream', 'gelato', 'farm stall',
  ];
  foodKeywords.forEach((keyword) => {
    if (text.includes(keyword)) foodTypes.add(normalizeToken(keyword));
  });

  if (source.goodForChildren) kidFriendlySignals.add('child_friendly_space');
  if (source.menuForChildren) kidFriendlySignals.add('kids_menu');
  if (keywordMatches(text, ['high chair'])) kidFriendlySignals.add('high_chair');
  if (keywordMatches(text, ['play area', 'playground', 'jungle gym'])) kidFriendlySignals.add('play_area_jungle_gym');
  if (keywordMatches(text, ['stroller', 'pram'])) kidFriendlySignals.add('stroller_friendly');

  const accessibilityText = JSON.stringify(source.accessibilityOptions || {}).toLowerCase();
  if (source.restroom || accessibilityText.includes('wheelchair') || accessibilityText.includes('accessible')) {
    accessibilitySignals.add('wheelchair_friendly');
  }
  if (source.restroom || accessibilityText.includes('restroom') || accessibilityText.includes('toilet')) {
    accessibilitySignals.add('accessible_toilet');
  }
  if (keywordMatches(text, ['quiet', 'calm'])) accessibilitySignals.add('quiet_friendly');

  const petFriendlySignals = new Set<string>();
  if (source.allowsDogs) petFriendlySignals.add('dogs_allowed');
  if (keywordMatches(text, ['pet friendly', 'dog friendly', 'pets welcome', 'dogs welcome'])) petFriendlySignals.add('dogs_allowed');
  if (keywordMatches(text, ['off-leash', 'off leash', 'dog park'])) petFriendlySignals.add('off_leash_area');
  if (keywordMatches(text, ['pet patio', 'dog patio', 'outdoor seating'])) petFriendlySignals.add('pet_friendly_patio');
  if (keywordMatches(text, ['water bowl', 'water bowls', 'dog water'])) petFriendlySignals.add('water_bowls');
  if (keywordMatches(text, ['enclosed garden', 'fenced garden', 'fenced yard', 'enclosed yard'])) petFriendlySignals.add('enclosed_garden');
  if (keywordMatches(text, ['pets inside', 'dogs inside', 'pets indoors', 'dogs indoors', 'pets allowed inside'])) petFriendlySignals.add('pets_inside_allowed');
  if (types.includes('dog_park') || types.includes('pet_store')) {
    petFriendlySignals.add('dogs_allowed');
    petFriendlySignals.add('off_leash_area');
  }

  const hasIndoor = types.some((t) => INDOOR_HINTS.includes(t)) || keywordMatches(text, INDOOR_HINTS);
  const hasOutdoor = types.some((t) => OUTDOOR_HINTS.includes(t)) || keywordMatches(text, OUTDOOR_HINTS);
  if (hasIndoor) indoorOutdoorSignals.add('indoor');
  if (hasOutdoor) indoorOutdoorSignals.add('outdoor');
  if (hasIndoor && hasOutdoor) indoorOutdoorSignals.add('both');

  const categories = pickCategories(types, source, requestedCategory);
  const signalCount =
    (venueTypes.size > 0 ? 1 : 0) +
    (foodTypes.size > 0 ? 1 : 0) +
    (kidFriendlySignals.size > 0 ? 1 : 0) +
    (accessibilitySignals.size > 0 ? 1 : 0) +
    (petFriendlySignals.size > 0 ? 1 : 0) +
    (indoorOutdoorSignals.size > 0 ? 1 : 0);
  const confidence = Math.min(
    0.95,
    0.35 +
      signalCount * 0.1 +
      (typeof source.rating === 'number' ? 0.08 : 0) +
      ((source.userRatingsTotal || 0) >= 20 ? 0.12 : 0)
  );

  return {
    categories,
    venueTypes: Array.from(venueTypes),
    foodTypes: Array.from(foodTypes),
    kidFriendlySignals: Array.from(kidFriendlySignals),
    accessibilitySignals: Array.from(accessibilitySignals),
    petFriendlySignals: Array.from(petFriendlySignals),
    indoorOutdoorSignals: Array.from(indoorOutdoorSignals),
    confidence: Number(confidence.toFixed(2)),
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`).join(',')}}`;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stripUndefined(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (typeof value === 'object') {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      const stripped = stripUndefined(val);
      if (stripped !== undefined) {
        next[key] = stripped;
      }
    });
    return next;
  }
  return value;
}

export async function getPlaceByGooglePlaceId(googlePlaceId: string): Promise<PlaceRecord | null> {
  if (!db || !googlePlaceId) return null;

  const placeId = sanitizeGooglePlaceId(googlePlaceId);
  const directDoc = await getDoc(doc(db, 'places', placeId));
  if (directDoc.exists()) {
    return { placeId: directDoc.id, ...(directDoc.data() as PlaceRecord) };
  }

  const fallbackSnap = await getDocs(
    query(collection(db, 'places'), where('googlePlaceId', '==', googlePlaceId), firestoreLimit(1))
  );
  if (fallbackSnap.empty) return null;
  const first = fallbackSnap.docs[0];
  return { placeId: first.id, ...(first.data() as PlaceRecord) };
}

export async function getPlacesByGeoBoundsAndCategory(
  bounds: GeoBounds,
  category: ActivityType,
  limitCount: number
): Promise<PlaceRecord[]> {
  if (!db) return [];
  const normalizedLimit = Math.max(1, Math.min(limitCount || 20, 100));
  const prefixes = buildGeohashPrefixes(bounds);
  const perPrefixLimit = Math.max(10, Math.ceil((normalizedLimit * 3) / Math.max(1, prefixes.length)));
  const includeCategory = !!(category && category !== 'all');

  try {
    const snaps = await Promise.all(
      prefixes.map((prefix) => {
        const constraints: any[] = [orderBy('geo.geohash'), startAt(prefix), endAt(`${prefix}\uf8ff`), firestoreLimit(perPrefixLimit)];
        if (includeCategory) {
          constraints.unshift(where('facets.categories', 'array-contains', category));
        }
        return getDocs(query(collection(db, 'places'), ...constraints));
      })
    );

    const byId = new Map<string, PlaceRecord>();
    snaps.forEach((snap) => {
      snap.docs.forEach((docSnap) => {
        const record = { placeId: docSnap.id, ...(docSnap.data() as PlaceRecord) };
        if (!record.geo || typeof record.geo.lat !== 'number' || typeof record.geo.lng !== 'number') return;
        if (!inBounds(record.geo, bounds)) return;
        if (includeCategory && !(record.facets?.categories || []).includes(category)) return;
        byId.set(record.placeId, record);
      });
    });

    return Array.from(byId.values())
      .sort((a, b) => {
        const popularityDelta = (b.popularityScore || 0) - (a.popularityScore || 0);
        if (popularityDelta !== 0) return popularityDelta;
        return (b.rating || 0) - (a.rating || 0);
      })
      .slice(0, normalizedLimit);
  } catch (err: any) {
    console.warn('[FamPal placeStore] geohash cache query failed, using category fallback', err?.code || err?.message || err);
    const fallbackConstraints: any[] = [firestoreLimit(Math.max(normalizedLimit * 3, 30))];
    if (includeCategory) {
      fallbackConstraints.unshift(where('facets.categories', 'array-contains', category));
    }
    const fallbackSnap = await getDocs(query(collection(db, 'places'), ...fallbackConstraints));
    const fallback = fallbackSnap.docs
      .map((docSnap) => ({ placeId: docSnap.id, ...(docSnap.data() as PlaceRecord) }))
      .filter((record) => record.geo && inBounds(record.geo, bounds))
      .slice(0, normalizedLimit);
    return fallback;
  }
}

export async function upsertPlaceFromGoogle(
  sourceGoogle: PlaceSourceGoogle,
  categoryContext: CategoryContext
): Promise<PlaceRecord | null> {
  if (!db || !sourceGoogle.googlePlaceId) return null;
  if (!auth?.currentUser) return null;

  const placeId = sanitizeGooglePlaceId(sourceGoogle.googlePlaceId);
  const facets = computeFacetsFromGoogleSource(sourceGoogle, categoryContext.requestedCategory);
  const versionInput = {
    googlePlaceId: sourceGoogle.googlePlaceId,
    name: sourceGoogle.name,
    address: sourceGoogle.address || '',
    lat: sourceGoogle.lat,
    lng: sourceGoogle.lng,
    types: sourceGoogle.types || [],
    primaryType: sourceGoogle.primaryType || null,
    rating: sourceGoogle.rating ?? null,
    userRatingsTotal: sourceGoogle.userRatingsTotal ?? null,
    priceLevel: normalizePriceLevel(sourceGoogle.priceLevel),
    goodForChildren: sourceGoogle.goodForChildren ?? null,
    menuForChildren: sourceGoogle.menuForChildren ?? null,
    restroom: sourceGoogle.restroom ?? null,
  };
  const versionHash = hashString(stableSerialize(versionInput));
  const placeRef = doc(db, 'places', placeId);
  const existing = await getDoc(placeRef);
  const existingData = (existing.exists() ? existing.data() : {}) as Partial<PlaceRecord> & {
    savedCount?: number;
    viewCount?: number;
    popularityScore?: number;
  };
  const savedCount = Math.max(0, Number(existingData.savedCount || 0));
  const viewCount = Math.max(0, Number(existingData.viewCount || 0));
  const popularityScore = Math.max(
    0,
    Number(existingData.popularityScore || computePopularityScore(savedCount, viewCount, sourceGoogle.userRatingsTotal))
  );
  const staleAfterDays = computeStaleAfterDays(savedCount, viewCount, popularityScore);
  const nextRefreshDate = new Date(Date.now() + staleAfterDays * 24 * 60 * 60 * 1000);

  const placePayload: PlaceRecord = {
    placeId,
    googlePlaceId: sourceGoogle.googlePlaceId,
    name: sourceGoogle.name,
    normalizedName: normalizeText(sourceGoogle.name),
    address: sourceGoogle.address || '',
    geo: { lat: sourceGoogle.lat, lng: sourceGoogle.lng, geohash: encodeGeohash(sourceGoogle.lat, sourceGoogle.lng, 9) },
    rating: typeof sourceGoogle.rating === 'number' ? sourceGoogle.rating : null,
    userRatingsTotal: typeof sourceGoogle.userRatingsTotal === 'number' ? sourceGoogle.userRatingsTotal : null,
    priceLevel: normalizePriceLevel(sourceGoogle.priceLevel),
    mapsUrl: sourceGoogle.mapsUrl || `https://www.google.com/maps/place/?q=place_id:${sourceGoogle.googlePlaceId}`,
    imageUrl: sourceGoogle.photoUrl || null,
    types: sourceGoogle.types || [],
    primaryType: sourceGoogle.primaryType || null,
    facets: {
      categories: facets.categories,
      venueTypes: facets.venueTypes,
      foodTypes: facets.foodTypes,
      kidFriendlySignals: facets.kidFriendlySignals,
      accessibilitySignals: facets.accessibilitySignals,
      petFriendlySignals: facets.petFriendlySignals,
      indoorOutdoorSignals: facets.indoorOutdoorSignals,
    },
    facetsConfidence: facets.confidence,
    categoryContext: {
      requestedCategory: categoryContext.requestedCategory,
      searchQuery: categoryContext.searchQuery || undefined,
      ingestionSource: categoryContext.ingestionSource || 'placesService',
    },
    sourceVersions: {
      google: versionHash,
    },
    refreshState: {
      status: 'ready',
      consecutiveFailures: 0,
      lastError: null,
      nextRefreshAt: nextRefreshDate.toISOString(),
    },
    staleAfterDays,
    popularityScore,
    savedCount,
    viewCount,
  };

  await setDoc(
    placeRef,
    {
      ...(stripUndefined(placePayload) as object),
      createdAt: existing.exists() ? existing.data().createdAt || serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastRefreshedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await setDoc(
    doc(db, 'places', placeId, 'sources', 'google'),
    {
      googlePlaceId: sourceGoogle.googlePlaceId,
      versionHash,
      fetchedAt: serverTimestamp(),
      requestedCategory: categoryContext.requestedCategory,
      searchQuery: categoryContext.searchQuery || null,
      ingestionSource: categoryContext.ingestionSource || 'placesService',
      source: stripUndefined(sourceGoogle.raw || sourceGoogle),
    },
    { merge: true }
  );

  return {
    ...placePayload,
    placeId,
  };
}
