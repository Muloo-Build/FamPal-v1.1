import { auth } from './firebase';
import type { Place, UserAccessibilityNeeds, AccessibilityFeatureValue } from '../types';
import { generateAccessibilitySummary, normalizeAccessibility } from '../src/utils/accessibility';
import type { AccessibilityFeature } from '../src/types/place';

export const ACCESSIBILITY_RANK_WEIGHTS = {
  matchBoost: 3,
  conflictPenalty: -4,
  unknownPenalty: -1,
} as const;

const NEEDS_TO_FEATURES: Record<keyof UserAccessibilityNeeds, AccessibilityFeature[]> = {
  usesWheelchair: ['step_free_entry', 'ramp_access', 'lift_available', 'wide_doorways'],
  needsStepFree: ['step_free_entry', 'ramp_access'],
  needsAccessibleToilet: ['accessible_toilet'],
  prefersPavedPaths: ['paved_paths', 'smooth_surface'],
  usesPushchair: ['step_free_entry', 'paved_paths', 'smooth_surface', 'wide_doorways'],
};

const CONFLICT_FEATURES: Partial<Record<keyof UserAccessibilityNeeds, AccessibilityFeature[]>> = {
  usesWheelchair: ['steep_slopes', 'gravel_or_sand'],
  needsStepFree: ['steep_slopes'],
  prefersPavedPaths: ['gravel_or_sand'],
  usesPushchair: ['steep_slopes', 'gravel_or_sand'],
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const currentUser = auth?.currentUser;
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (currentUser) {
    const token = await currentUser.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(await response.text().catch(() => 'request_failed'));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function loadPlaceAccessibilityByIds(placeIds: string[]): Promise<{
  accessibilityById: Record<string, AccessibilityFeatureValue[]>;
  summaryById: Record<string, string>;
}> {
  if (placeIds.length === 0) return { accessibilityById: {}, summaryById: {} };
  const uniqueIds = [...new Set(placeIds.filter(Boolean))];
  
  const accessibilityById: Record<string, AccessibilityFeatureValue[]> = {};
  const summaryById: Record<string, string> = {};
  
  await Promise.all(
    uniqueIds.map(async (placeId) => {
      try {
        const data = await apiRequest<{ contributions: any[] }>(`/api/places/${placeId}/contributions?type=accessibility`);
        const item = data.contributions[0]; // Assuming one aggregated record or we just take the first
        const accessibility = Array.isArray(item?.features) ? item.features : [];
        accessibilityById[placeId] = accessibility;
        summaryById[placeId] = item?.summary || generateAccessibilitySummary(accessibility);
      } catch (err) {
        console.warn('Failed to load accessibility via API', placeId, err);
        accessibilityById[placeId] = [];
        summaryById[placeId] = '';
      }
    })
  );
  
  return { accessibilityById, summaryById };
}

interface SubmitAccessibilityReportInput {
  placeId: string;
  userId: string;
  userDisplayName?: string;
  features: AccessibilityFeatureValue[];
  comment?: string;
}

export async function submitAccessibilityReport(input: SubmitAccessibilityReportInput): Promise<{ accessibility: AccessibilityFeatureValue[]; accessibilitySummary: string }> {
  try {
    const payload = {
      type: 'accessibility',
      features: input.features,
      summary: input.comment || '',
    };
    await apiRequest(`/api/places/${input.placeId}/contributions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    // We just return normalized assuming the API saved it.
    const normalized = input.features;
    const summary = generateAccessibilitySummary(normalized);

    import('./placeCache').then(m => m.markPlaceAsCommunityEnriched(input.placeId)).catch(() => {});
    import('../src/services/gamification').then(m => { m.awardPoints('accessibility_report'); m.invalidateGamificationCache(); }).catch(() => {});

    return { accessibility: normalized, accessibilitySummary: summary };
  } catch (err) {
    console.error('Submit report failed', err);
    throw err;
  }
}

function placeFeatureValue(accessibility: AccessibilityFeatureValue[] = [], feature: AccessibilityFeature): boolean | 'unknown' {
  const found = accessibility.find((item) => item.feature === feature);
  if (!found || found.confidence === 'unknown') return 'unknown';
  return found.value;
}

function scorePlaceByNeeds(place: Place, needs: UserAccessibilityNeeds): number {
  const accessibility = place.accessibility || [];
  let score = 0;

  (Object.keys(NEEDS_TO_FEATURES) as Array<keyof UserAccessibilityNeeds>).forEach((needKey) => {
    if (!needs[needKey]) return;
    const needFeatures = NEEDS_TO_FEATURES[needKey];
    needFeatures.forEach((feature) => {
      const value = placeFeatureValue(accessibility, feature);
      if (value === true) score += ACCESSIBILITY_RANK_WEIGHTS.matchBoost;
      else if (value === false) score += ACCESSIBILITY_RANK_WEIGHTS.conflictPenalty;
      else score += ACCESSIBILITY_RANK_WEIGHTS.unknownPenalty;
    });

    const conflictFeatures = CONFLICT_FEATURES[needKey] || [];
    conflictFeatures.forEach((feature) => {
      const value = placeFeatureValue(accessibility, feature);
      if (value === true) score += ACCESSIBILITY_RANK_WEIGHTS.conflictPenalty;
      else if (value === 'unknown') score += ACCESSIBILITY_RANK_WEIGHTS.unknownPenalty;
    });
  });

  return score;
}

export function rankPlacesWithAccessibilityNeeds(places: Place[], needs?: UserAccessibilityNeeds): Place[] {
  if (!needs) return places;
  const hasNeeds = Object.values(needs).some(Boolean);
  if (!hasNeeds) return places;

  return [...places].sort((a, b) => {
    const scoreA = scorePlaceByNeeds(a, needs);
    const scoreB = scorePlaceByNeeds(b, needs);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (b.rating || 0) - (a.rating || 0);
  });
}
