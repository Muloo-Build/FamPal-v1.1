import { auth } from './firebase';
import type { FamilyFacility, FamilyFacilityValue } from '../src/types/place';
import { generateFamilyFacilitiesSummary, normalizeFamilyFacilities } from '../src/utils/familyFacilities';

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

export async function loadPlaceFamilyFacilitiesByIds(placeIds: string[]): Promise<{
  familyFacilitiesById: Record<string, FamilyFacilityValue[]>;
  summaryById: Record<string, string>;
}> {
  if (placeIds.length === 0) return { familyFacilitiesById: {}, summaryById: {} };
  const uniqueIds = [...new Set(placeIds.filter(Boolean))];
  
  const familyFacilitiesById: Record<string, FamilyFacilityValue[]> = {};
  const summaryById: Record<string, string> = {};

  await Promise.all(
    uniqueIds.map(async (placeId) => {
      try {
        const data = await apiRequest<{ contributions: any[] }>(`/api/places/${placeId}/contributions?type=family_facilities`);
        const item = data.contributions[0];
        const familyFacilities = Array.isArray(item?.features) ? item.features : [];
        familyFacilitiesById[placeId] = familyFacilities;
        summaryById[placeId] = item?.summary || generateFamilyFacilitiesSummary(familyFacilities);
      } catch (err) {
        console.warn('Failed to load family facilities via API', placeId, err);
        familyFacilitiesById[placeId] = [];
        summaryById[placeId] = '';
      }
    })
  );

  return { familyFacilitiesById, summaryById };
}

interface SubmitFamilyFacilitiesReportInput {
  placeId: string;
  userId: string;
  userDisplayName?: string;
  features: FamilyFacilityValue[];
  comment?: string;
}

export async function submitFamilyFacilitiesReport(input: SubmitFamilyFacilitiesReportInput): Promise<{ familyFacilities: FamilyFacilityValue[]; familyFacilitiesSummary: string }> {
  try {
    const payload = {
      type: 'family_facilities',
      features: input.features,
      summary: input.comment || '',
    };
    await apiRequest(`/api/places/${input.placeId}/contributions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const normalized = input.features;
    const summary = generateFamilyFacilitiesSummary(normalized);

    import('./placeCache').then(m => m.markPlaceAsCommunityEnriched(input.placeId)).catch(() => {});
    import('../src/services/gamification').then(m => { m.awardPoints('family_facilities_report'); m.invalidateGamificationCache(); }).catch(() => {});

    return { familyFacilities: normalized, familyFacilitiesSummary: summary };
  } catch (err) {
    console.error('Submit report failed', err);
    throw err;
  }
}
