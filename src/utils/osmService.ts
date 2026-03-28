import type { AccessibilityFeature } from '../types/place';
import type { FamilyFacility } from '../types/place';
import type { PetFriendlyFeature } from '../types/place';

export interface OsmVenueData {
  accessibilityHints: AccessibilityFeature[];
  familyFacilityHints: FamilyFacility[];
  petFriendlyHints: PetFriendlyFeature[];
  tags: Record<string, string>;
}

const OSM_CACHE = new Map<string, { data: OsmVenueData | null; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000;

function buildOverpassQuery(lat: number, lng: number, name: string): string {
  const radius = 150;
  const escapedName = name.replace(/['"\\]/g, '');
  const query = `
[out:json][timeout:10];
(
  nwr["name"~"${escapedName}",i](around:${radius},${lat},${lng});
  nwr["amenity"](around:${radius},${lat},${lng})["name"~"${escapedName}",i];
  nwr["shop"](around:${radius},${lat},${lng})["name"~"${escapedName}",i];
  nwr["tourism"](around:${radius},${lat},${lng})["name"~"${escapedName}",i];
  nwr["leisure"](around:${radius},${lat},${lng})["name"~"${escapedName}",i];
);
out tags;
`.trim();
  return query;
}

function extractAccessibilityFromTags(tags: Record<string, string>): AccessibilityFeature[] {
  const hints: AccessibilityFeature[] = [];

  if (tags['wheelchair'] === 'yes' || tags['wheelchair'] === 'designated') {
    hints.push('step_free_entry');
  }
  if (tags['wheelchair:description']?.toLowerCase().includes('ramp') || tags['ramp'] === 'yes') {
    hints.push('ramp_access');
  }
  if (tags['elevator'] === 'yes' || tags['lift'] === 'yes') {
    hints.push('lift_available');
  }
  if (tags['toilets:wheelchair'] === 'yes' || tags['wheelchair_toilet'] === 'yes') {
    hints.push('accessible_toilet');
  }
  if (tags['parking:disabled'] === 'yes' || tags['capacity:disabled'] !== undefined) {
    hints.push('accessible_parking');
  }
  if (tags['surface'] === 'paved' || tags['surface'] === 'asphalt' || tags['surface'] === 'concrete') {
    hints.push('paved_paths');
  }
  if (tags['bench'] === 'yes' || tags['amenity'] === 'bench') {
    hints.push('seating_available');
  }

  return hints;
}

function extractFamilyFacilitiesFromTags(tags: Record<string, string>): FamilyFacility[] {
  const hints: FamilyFacility[] = [];

  if (tags['leisure'] === 'playground' || tags['playground'] === 'yes') {
    hints.push('playground');
  }
  if (tags['diaper'] === 'yes' || tags['changing_table'] === 'yes' || tags['baby_changing'] === 'yes') {
    hints.push('baby_changing_table');
  }
  if (tags['highchair'] === 'yes' || tags['high_chair'] === 'yes') {
    hints.push('high_chairs');
  }
  if (tags['kids_menu'] === 'yes' || tags['diet:children'] === 'yes') {
    hints.push('kids_menu');
  }
  if (tags['toilets'] === 'yes' || tags['amenity'] === 'toilets') {
    hints.push('family_restroom');
  }
  if (tags['nursing_room'] === 'yes' || tags['baby_feeding'] === 'yes') {
    hints.push('nursing_room');
  }
  if (
    tags['stroller'] === 'yes' ||
    tags['pushchair'] === 'yes' ||
    (tags['wheelchair'] === 'yes' && (tags['door:width'] || tags['width']))
  ) {
    hints.push('stroller_friendly');
  }
  if (
    tags['children'] === 'yes' ||
    tags['kids_area'] === 'yes' ||
    tags['child_friendly'] === 'yes'
  ) {
    hints.push('child_friendly_space');
  }

  return hints;
}

function extractPetFriendlyFromTags(tags: Record<string, string>): PetFriendlyFeature[] {
  const hints: PetFriendlyFeature[] = [];

  if (tags['dog'] === 'yes' || tags['dogs'] === 'yes' || tags['pet'] === 'yes') {
    hints.push('dogs_allowed');
  }
  if (tags['cat'] === 'yes' || tags['cats'] === 'yes') {
    hints.push('cats_allowed');
  }
  if (tags['leisure'] === 'dog_park' || tags['animal'] === 'dog_park') {
    hints.push('dogs_allowed');
    hints.push('off_leash_area');
  }
  if (tags['outdoor_seating'] === 'yes' && (tags['dog'] === 'yes' || tags['pet'] === 'yes')) {
    hints.push('pet_friendly_patio');
  }
  if (tags['drinking_water:dogs'] === 'yes' || tags['dog:water'] === 'yes') {
    hints.push('water_bowls');
  }
  if (tags['fence'] === 'yes' || tags['fenced'] === 'yes') {
    hints.push('enclosed_garden');
  }

  return hints;
}

export async function fetchOsmVenueData(
  lat: number,
  lng: number,
  name: string
): Promise<OsmVenueData | null> {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}_${name.toLowerCase().slice(0, 30)}`;
  const cached = OSM_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const query = buildOverpassQuery(lat, lng, name);
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn('[FamPal OSM] Overpass API returned', response.status);
      OSM_CACHE.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const json = await response.json();
    const elements = json.elements || [];

    if (elements.length === 0) {
      OSM_CACHE.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const allTags: Record<string, string> = {};
    for (const el of elements) {
      if (el.tags) {
        Object.assign(allTags, el.tags);
      }
    }

    const data: OsmVenueData = {
      accessibilityHints: extractAccessibilityFromTags(allTags),
      familyFacilityHints: extractFamilyFacilitiesFromTags(allTags),
      petFriendlyHints: extractPetFriendlyFromTags(allTags),
      tags: allTags,
    };

    OSM_CACHE.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.warn('[FamPal OSM] Failed to fetch:', error);
    OSM_CACHE.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }
}
