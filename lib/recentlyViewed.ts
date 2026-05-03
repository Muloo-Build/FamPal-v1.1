const KEY = 'fampal_recently_viewed';
const MAX = 8;

export interface RecentlyViewedItem {
  placeId: string;
  name: string;
  address: string;
  photoReference?: string;
  rating?: number;
  viewedAt: string;
}

export function getRecentlyViewed(): RecentlyViewedItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function addRecentlyViewed(item: Omit<RecentlyViewedItem, 'viewedAt'>) {
  const list = getRecentlyViewed().filter(i => i.placeId !== item.placeId);
  const updated = [{ ...item, viewedAt: new Date().toISOString() }, ...list].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(updated));
}

export function clearRecentlyViewed() {
  localStorage.removeItem(KEY);
}
