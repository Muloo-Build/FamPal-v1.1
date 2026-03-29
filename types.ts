
import type { Timestamp } from './lib/firebase';
// Timestamp is re-exported from lib/firebase (Firestore Timestamp shape stub)
import type { AccessibilityFeatureValue, FamilyFacilityValue, PetFriendlyFeatureValue, UserAccessibilityNeeds } from './src/types/place';
import type { ClaimStatus, OwnerTier, OwnerContent, PlaceClaim, PlaceOwnerProfile } from './src/types/placeOwner';
export type {
  AccessibilityFeature,
  AccessibilityConfidence,
  AccessibilityFeatureValue,
  FamilyFacility,
  FamilyFacilityConfidence,
  FamilyFacilityValue,
  PetFriendlyFeature,
  PetFriendlyConfidence,
  PetFriendlyFeatureValue,
  UserAccessibilityNeeds,
} from './src/types/place';
export type { ClaimStatus, OwnerTier, OwnerContent, PlaceClaim, PlaceOwnerProfile } from './src/types/placeOwner';

export interface Place {
  id: string;
  name: string;
  description: string;
  address: string;
  rating?: number;
  tags: string[];
  imageUrl?: string;
  mapsUrl: string;
  type: ActivityType;
  priceLevel?: '$' | '$$' | '$$$' | '$$$$';
  phone?: string;
  website?: string;
  distance?: string;
  ageAppropriate?: string;
  fullSummary?: string;
  accessibility?: AccessibilityFeatureValue[];
  accessibilitySummary?: string;
  familyFacilities?: FamilyFacilityValue[];
  familyFacilitiesSummary?: string;
  petFriendly?: PetFriendlyFeatureValue[];
  petFriendlySummary?: string;
  googlePlaceId?: string;
  userRatingsTotal?: number;
  lat?: number;
  lng?: number;
  facetSnapshot?: {
    categories: string[];
    venueTypes: string[];
    foodTypes: string[];
    kidFriendlySignals: string[];
    accessibilitySignals: string[];
    indoorOutdoorSignals: string[];
    reportConfidence: Record<string, number>;
  };
  ownerStatus?: 'none' | 'pending' | 'verified';
  ownerTier?: OwnerTier;
  ownerIds?: string[];
  ownerContent?: OwnerContent;
  promotedUntil?: string;
}

export type ActivityType = 'restaurant' | 'outdoor' | 'indoor' | 'active' | 'hike' | 'wine' | 'golf' | 'kids' | 'all';
export type ExploreIntent =
  | 'all'
  | 'eat_drink'
  | 'play_kids'
  | 'outdoors'
  | 'things_to_do'
  | 'sport_active'
  | 'indoor';

export interface VisitedPlace {
  placeId: string;
  placeName: string;
  placeType: ActivityType;
  imageUrl?: string;
  visitedAt: string;
  notes: string;
  rating?: number;
  isFavorite: boolean;
}

export interface UserReview {
  id: string;
  placeId: string;
  placeName: string;
  userName: string;
  rating: number;
  comment: string;
  isPublic: boolean;
  date: string;
}

export interface Memory {
  id: string;
  placeId?: string;
  placeName: string;
  photoUrl?: string;
  photoUrls?: string[];
  photoThumbUrl?: string;
  photoThumbUrls?: string[];
  caption: string;
  taggedFriends: string[];
  date: string;
  sharedWithPartner?: boolean;
  circleIds?: string[];
  geo?: { lat: number; lng: number };
}

export interface FavoriteData {
  placeId: string;
  notes: string;
  costEstimate: string;
  menuPhotos: string[];
  lastVisited?: string;
  activities?: string[];
  customTags?: string[];
}

export interface SavedPlace {
  placeId: string;
  name: string;
  address?: string;
  imageUrl?: string;
  mapsUrl?: string;
  rating?: number;
  priceLevel?: '$' | '$$' | '$$$' | '$$$$';
  tags?: string[];
  type?: ActivityType;
  description?: string;
  savedAt?: Timestamp;
}

export const ACTIVITY_OPTIONS = {
  'Kids & Family': [
    'Jumping castle', 'Outdoor play area', 'Indoor play area', 'Jungle gym',
    'Water features', 'Pool', 'Petting zoo', 'Animal encounters',
    'Kid-friendly menu', 'High chair available', 'Changing facilities',
    'Pram friendly', 'Shaded seating', 'Safe parking', 'Birthday party friendly'
  ],
  'Nature & Outdoors': [
    'Hike', 'Easy walk', 'Trail running', 'Picnic spot', 'Beach', 'Dam/lake', 'Farm visit'
  ],
  'Food & Drink': [
    'Coffee spot', 'Breakfast', 'Lunch', 'Dinner', 'Wine tasting', 'Beer tasting', 'Craft gin tasting'
  ],
  'Logistics & Vibes': [
    'Free entry', 'Paid entry', 'Booking required', 'Dog friendly', 'Step-free entrance', 'Quiet', 'Busy/noisy'
  ]
} as const;

export const FOOD_PREFERENCES = [
  'Vegetarian', 'Halal', 'Kosher', 'Gluten-free'
] as const;

export const ALLERGY_OPTIONS = [
  'Nuts', 'Peanuts', 'Tree nuts', 'Dairy', 'Eggs', 'Wheat/Gluten', 
  'Soy', 'Fish', 'Shellfish', 'Sesame', 'Bee stings'
] as const;

export const ACCESSIBILITY_OPTIONS = [
  'Wheelchair user', 'Limited mobility', 'Visual impairment', 
  'Hearing impairment', 'Autism-friendly needed', 'Sensory sensitivities',
  'Service animal', 'Stroller/pram required'
] as const;

export const ACTIVITY_PREFERENCES = [
  'Active/energetic', 'Calm/relaxed', 'Educational', 'Creative/arts',
  'Nature/outdoors', 'Water activities', 'Animals', 'Sports',
  'Indoor play', 'Music/performance', 'Food experiences'
] as const;

export interface Preferences {
  foodPreferences: string[];
  allergies: string[];
  accessibility: string[];
  activityPreferences: string[];
  notes?: string;
}

export interface Child {
  id: string;
  name: string;
  age: number;
  preferences?: Preferences;
}

export type PetType = 'dog' | 'cat' | 'bird' | 'rabbit' | 'other';

export const PET_TYPE_OPTIONS: { value: PetType; label: string; icon: string }[] = [
  { value: 'dog', label: 'Dog', icon: '🐕' },
  { value: 'cat', label: 'Cat', icon: '🐱' },
  { value: 'bird', label: 'Bird', icon: '🐦' },
  { value: 'rabbit', label: 'Rabbit', icon: '🐰' },
  { value: 'other', label: 'Other', icon: '🐾' },
];

export const PET_SIZE_OPTIONS = ['Small', 'Medium', 'Large'] as const;
export type PetSize = typeof PET_SIZE_OPTIONS[number];

export interface Pet {
  id: string;
  name: string;
  type: PetType;
  size?: PetSize;
}

export interface FamilyGroup {
  id: string;
  name: string;
  type: 'partner' | 'family' | 'friends';
  members: string[];
  memberEmails: string[];
  inviteCode: string;
  whatsappLink?: string;
  sharedFavorites: string[];
  sharedNotes: Record<string, string>;
  createdAt: string;
  createdBy: string;
}

export interface PartnerLink {
  partnerEmail?: string;
  partnerName?: string;
  partnerPhotoURL?: string;
  partnerUserId?: string;
  linkedAt: string;
  status: 'pending' | 'accepted';
  inviteCode?: string;
}

export interface GroupMember {
  userId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface GroupPlace {
  placeId: string;
  placeName: string;
  imageUrl?: string;
  placeType?: ActivityType;
  addedBy: string;
  addedByName: string;
  addedAt: string;
  note?: string;
}

export interface GroupPlan {
  id: string;
  placeId: string;
  placeName: string;
  date: string;
  time?: string;
  note?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface FriendCircle {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  members: GroupMember[];
  sharedPlaces: GroupPlace[];
  plans: GroupPlan[];
  inviteCode: string;
  createdAt: string;
}

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export type PlanTier = 'free' | 'pro' | 'family' | 'lifetime';
export type PlanStatus = 'active' | 'cancelled' | 'expired';
export type EntitlementSource = 'paystack' | 'apple' | 'google' | 'play' | 'admin' | null;
export type SubscriptionTier = 'free' | 'pro' | 'admin';
export type SubscriptionStatus = 'active' | 'inactive' | 'pending' | 'grace_period' | 'cancelled_active' | 'billing_retry' | 'expired';
export type SubscriptionSource = 'apple' | 'google' | 'play' | 'admin' | null;

export interface Entitlement {
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus;
  subscription_source: SubscriptionSource;
  gemini_credits_used: number;
  gemini_credits_limit: number;
  usage_reset_month: string;
  plan_tier: PlanTier;
  plan_status: PlanStatus;
  entitlement_source: EntitlementSource;
  entitlement_start_date: string | null;
  entitlement_end_date: string | null;
  paystack_customer_code?: string;
  paystack_subscription_code?: string;
  paystack_email_token?: string | null;
  last_payment_reference?: string;
  play_product_id?: string | null;
  play_purchase_token_hash?: string | null;
  play_last_order_id?: string | null;
  play_auto_renewing?: boolean;
  play_state?: string | null;
  last_verified_at?: string | null;
  ai_requests_this_month: number;
  ai_requests_reset_date: string;
}

export interface ProfileInfo {
  displayName?: string | null;
  age?: number | null;
}

export const PLAN_LIMITS = {
  free: {
    savedPlaces: 10,
    notebookEntries: 10,
    memories: 15,
    circles: 1,
    aiRequestsPerMonth: 5,
    preferencesPerCategory: 3,
    partnerFavorites: 3,
    partnerMemories: 3,
  },
  pro: {
    savedPlaces: Infinity,
    notebookEntries: Infinity,
    memories: Infinity,
    circles: Infinity,
    aiRequestsPerMonth: 100,
    preferencesPerCategory: Infinity,
    partnerFavorites: Infinity,
    partnerMemories: Infinity,
  },
} as const;

export const PLAN_PRICES = {
  pro: { amount: 3999, currency: 'ZAR', label: 'R39.99/month' },
} as const;

export const GOOGLE_PLAY_SUBSCRIPTION_URL = 'https://play.google.com/store/apps/details?id=co.fampal.app';

export const GOOGLE_PLAY_PRICING = {
  'ZA': { price: 'R39.99', currency: 'ZAR' },
  'US': { price: '$2.99', currency: 'USD' },
  'GB': { price: '£2.49', currency: 'GBP' },
  'AU': { price: 'A$4.49', currency: 'AUD' },
  'CA': { price: 'C$3.99', currency: 'CAD' },
  'NZ': { price: 'NZ$4.99', currency: 'NZD' },
  'IE': { price: '€2.99', currency: 'EUR' },
  'NG': { price: '₦1,499', currency: 'NGN' },
  'KE': { price: 'KSh 299', currency: 'KES' },
  'GH': { price: 'GH₵19.99', currency: 'GHS' },
  'IN': { price: '₹149', currency: 'INR' },
  'SG': { price: 'S$3.99', currency: 'SGD' },
  'PH': { price: '₱149', currency: 'PHP' },
  'UG': { price: 'USh 4,999', currency: 'UGX' },
  'TZ': { price: 'TSh 4,999', currency: 'TZS' },
  'ZM': { price: 'ZMW 29.99', currency: 'ZMW' },
  'BW': { price: 'P39.99', currency: 'BWP' },
  'NA': { price: 'N$39.99', currency: 'NAD' },
  'RW': { price: 'RWF 1,999', currency: 'RWF' },
  'MW': { price: 'MWK 2,499', currency: 'MWK' },
  'JM': { price: 'J$449', currency: 'JMD' },
  'TT': { price: 'TT$19.99', currency: 'TTD' },
  'MT': { price: '€2.99', currency: 'EUR' },
  'CY': { price: '€2.99', currency: 'EUR' },
  'DE': { price: '€2.99', currency: 'EUR' },
  'FR': { price: '€2.99', currency: 'EUR' },
  'NL': { price: '€2.99', currency: 'EUR' },
  'ES': { price: '€2.99', currency: 'EUR' },
  'IT': { price: '€2.99', currency: 'EUR' },
  'PT': { price: '€2.99', currency: 'EUR' },
  'AT': { price: '€2.99', currency: 'EUR' },
  'BE': { price: '€2.99', currency: 'EUR' },
  'FI': { price: '€2.99', currency: 'EUR' },
  'GR': { price: '€2.99', currency: 'EUR' },
  'SE': { price: '29 kr', currency: 'SEK' },
  'NO': { price: '29 kr', currency: 'NOK' },
  'DK': { price: '19.99 kr', currency: 'DKK' },
  'CH': { price: 'CHF 2.99', currency: 'CHF' },
  'PL': { price: '9.99 zł', currency: 'PLN' },
} as const;

export function getDefaultEntitlement(): Entitlement {
  const now = new Date();
  const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const usageResetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    subscription_tier: 'free',
    subscription_status: 'inactive',
    subscription_source: null,
    gemini_credits_used: 0,
    gemini_credits_limit: 5,
    usage_reset_month: usageResetMonth,
    plan_tier: 'free',
    plan_status: 'active',
    entitlement_source: null,
    entitlement_start_date: null,
    entitlement_end_date: null,
    ai_requests_this_month: 0,
    ai_requests_reset_date: resetDate.toISOString(),
  };
}

export interface SavedLocation {
  lat: number;
  lng: number;
  label: string;
}

export interface UserPreferences {
  lastLocation?: SavedLocation;
  lastRadius?: number;
  lastCategory?: ExploreIntent;
  activeCircleId?: string;
}

export interface AppState {
  isAuthenticated: boolean;
  user: User | null;
  profileInfo?: ProfileInfo;
  favorites: string[]; 
  favoriteDetails: Record<string, FavoriteData>;
  savedPlaces: SavedPlace[];
  savedPlacesMigratedAt?: Timestamp;
  onboardingCompletedAt?: Timestamp;
  profileCompletionRequired?: boolean;
  familyPool?: {
    ai_requests_this_month?: number;
    ai_requests_reset_date?: string;
  };
  visited: string[];
  visitedPlaces: VisitedPlace[];
  reviews: UserReview[];
  memories: Memory[];
  children: Child[];
  pets: Pet[];
  preferences?: Preferences;
  accessibilityNeeds?: UserAccessibilityNeeds;
  userPreferences?: UserPreferences;
  spouseName?: string;
  linkedEmail?: string;
  partnerLink?: PartnerLink;
  partnerSharedPlaces: GroupPlace[];
  groups: FamilyGroup[];
  friendCircles: FriendCircle[];
  entitlement: Entitlement;
  aiRequestsUsed: number;
}
