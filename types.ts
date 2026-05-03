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
  kidFriendly?: boolean;
  dogFriendly?: boolean;
  wheelchairAccessible?: boolean;
  outdoorSeating?: boolean;
  hasRestroom?: boolean;
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
  placeTags?: string[];
  privateNotes?: string;
}

export interface PlaceReview {
  id: string;
  user_id: string;
  display_name: string | null;
  rating: number;
  body: string | null;
  tags: string[];
  created_at: string;
}

export interface GoogleReview {
  authorName: string;
  authorPhoto?: string;
  rating: number;
  text?: string;
  relativeTime?: string;
}

export type User = AuthUser;

export interface AppState {
  isAuthenticated: boolean;
  user: User | null;
  savedPlaces: SavedPlace[];
}
