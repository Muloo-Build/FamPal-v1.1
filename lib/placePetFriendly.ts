import { auth } from './firebase';
import type { PetFriendlyFeature, PetFriendlyFeatureValue } from '../src/types/place';
import { PET_FRIENDLY_FEATURE_LABELS } from '../src/types/place';

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

function generatePetFriendlySummary(features: PetFriendlyFeatureValue[]): string {
  const confirmed = features.filter((f) => f.value === true && f.confidence !== 'unknown');
  if (confirmed.length === 0) return 'Pet-friendly info not yet confirmed.';
  const labels = confirmed.map((f) => PET_FRIENDLY_FEATURE_LABELS[f.feature]).filter(Boolean);
  if (labels.length <= 3) return labels.join(', ') + '.';
  return labels.slice(0, 3).join(', ') + ` and ${labels.length - 3} more.`;
}

function normalizePetFriendly(
  existing: PetFriendlyFeatureValue[],
  incoming: PetFriendlyFeatureValue[]
): PetFriendlyFeatureValue[] {
  const map = new Map<PetFriendlyFeature, PetFriendlyFeatureValue>();
  for (const item of existing) {
    map.set(item.feature, item);
  }
  for (const item of incoming) {
    const prev = map.get(item.feature);
    if (!prev) {
      map.set(item.feature, { ...item, sourcesCount: 1 });
    } else {
      const newConfidence =
        item.confidence === 'verified' || prev.confidence === 'verified' ? 'verified' : 'reported';
      map.set(item.feature, {
        ...prev,
        value: item.value,
        confidence: newConfidence,
        sourcesCount: (prev.sourcesCount || 1) + 1,
        updatedAt: item.updatedAt || new Date().toISOString(),
      });
    }
  }
  return Array.from(map.values());
}

export async function loadPlacePetFriendlyByIds(placeIds: string[]): Promise<{
  petFriendlyById: Record<string, PetFriendlyFeatureValue[]>;
  summaryById: Record<string, string>;
}> {
  if (placeIds.length === 0) return { petFriendlyById: {}, summaryById: {} };
  const uniqueIds = [...new Set(placeIds.filter(Boolean))];
  
  const petFriendlyById: Record<string, PetFriendlyFeatureValue[]> = {};
  const summaryById: Record<string, string> = {};

  await Promise.all(
    uniqueIds.map(async (placeId) => {
      try {
        const data = await apiRequest<{ contributions: any[] }>(`/api/places/${placeId}/contributions?type=pet_friendly`);
        const item = data.contributions[0];
        const petFriendly = Array.isArray(item?.features) ? item.features : [];
        petFriendlyById[placeId] = petFriendly;
        summaryById[placeId] = item?.summary || generatePetFriendlySummary(petFriendly);
      } catch (err) {
        console.warn('Failed to load pet friendly via API', placeId, err);
        petFriendlyById[placeId] = [];
        summaryById[placeId] = '';
      }
    })
  );

  return { petFriendlyById, summaryById };
}

interface SubmitPetFriendlyReportInput {
  placeId: string;
  userId: string;
  userDisplayName?: string;
  features: PetFriendlyFeatureValue[];
  comment?: string;
}

export async function submitPetFriendlyReport(input: SubmitPetFriendlyReportInput): Promise<{ petFriendly: PetFriendlyFeatureValue[]; petFriendlySummary: string }> {
  try {
    const payload = {
      type: 'pet_friendly',
      features: input.features,
      summary: input.comment || '',
    };
    await apiRequest(`/api/places/${input.placeId}/contributions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const normalized = input.features;
    const summary = generatePetFriendlySummary(normalized);

    import('./placeCache').then(m => m.markPlaceAsCommunityEnriched(input.placeId)).catch(() => {});
    import('../src/services/gamification').then(m => { m.awardPoints('pet_friendly_report'); m.invalidateGamificationCache(); }).catch(() => {});

    return { petFriendly: normalized, petFriendlySummary: summary };
  } catch (err) {
    console.error('Submit report failed', err);
    throw err;
  }
}
