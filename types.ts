export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface Venue {
  placeId: string;
  name: string;
  vicinity: string;
  rating?: number;
  userRatingsTotal?: number;
  photoReference?: string;
  types: string[];
  lat: number;
  lng: number;
  distance?: string;
  category?: string;
}

export interface VenueDetail extends Venue {
  formattedAddress?: string;
  phone?: string;
  website?: string;
  openNow?: boolean;
  editorialSummary?: string;
  mapsUrl?: string;
}

export interface SavedPlace {
  placeId: string;
  name: string;
  address: string;
  rating?: number;
  photoReference?: string;
  category?: string;
  savedAt: string;
}

export type User = AuthUser;

export interface AppState {
  isAuthenticated: boolean;
  user: User | null;
  savedPlaces: SavedPlace[];
}
