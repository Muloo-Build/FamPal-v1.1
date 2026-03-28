
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Place, FavoriteData, ACTIVITY_OPTIONS, Memory, Entitlement, PartnerLink, GroupPlace, AccessibilityFeatureValue, FamilyFacilityValue, PetFriendlyFeatureValue } from '../types';
import { askAboutPlace, generateFamilySummary } from '../geminiService';
import { getPlaceDetails, PlaceDetails, PlaceReview } from '../placesService';
import { canUseAI } from '../lib/entitlements';
// import MemoryCreate from './MemoryCreate';

// Stub for missing component
const MemoryCreate = (): null => null;

import { CircleDoc } from '../lib/circles';
import PlaceAccessibilitySection from '../src/components/PlaceAccessibilitySection';
import { getAccessibilityHintsFromGoogle } from '../src/utils/accessibilityHints';
import PlaceFamilyFacilitiesSection from '../src/components/PlaceFamilyFacilitiesSection';
import { getFamilyFacilitiesHintsFromGoogle } from '../src/utils/familyFacilitiesHints';
import PlacePetFriendlySection from '../src/components/PlacePetFriendlySection';
import { getPetFriendlyHintsFromGoogle } from '../src/utils/petFriendlyHints';
import { getPublicHints } from '../src/utils/publicHints';
import { fetchOsmVenueData, OsmVenueData } from '../src/utils/osmService';

import { formatPriceLevel } from '../src/utils/priceLevel';
import type { AggregatedReportSignals, AggregatedSignal } from '../src/services/communityReports';
import ClaimPlaceModal from '../src/components/ClaimPlaceModal';
import OwnerDashboard from '../src/components/OwnerDashboard';
import { fetchPlaceClaim } from '../lib/placeOwner';
import type { PlaceClaim } from '../src/types/placeOwner';
import ReportContentModal from './ReportContentModal';
import { createUgcReport, type UgcReportReason } from '../src/services/ugcReports';

function getNavigationUrls(place: Place, placeDetails?: PlaceDetails | null) {
 const lat = (place as any).lat || placeDetails?.lat;
 const lng = (place as any).lng || placeDetails?.lng;

 if (lat && lng) {
 return {
 google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
 apple: `https://maps.apple.com/?daddr=${lat},${lng}`,
 waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
 };
 }

 const address = encodeURIComponent(place.address || place.name);
 return {
 google: `https://www.google.com/maps/dir/?api=1&destination=${address}`,
 apple: `https://maps.apple.com/?daddr=${address}`,
 waze: `https://waze.com/ul?q=${address}&navigate=yes`,
 };
}

interface CombinedPreferences {
 allergies: string[];
 accessibility: string[];
 foodPreferences: string[];
 activityPreferences: string[];
 includesPartner: boolean;
 includesChildren: boolean;
}

interface VenueProfileProps {
 place: Place;
 isFavorite: boolean;
 isVisited: boolean;
 memories?: Memory[];
 memoryCount?: number;
 favoriteData?: FavoriteData;
 childrenAges?: number[];
 isGuest?: boolean;
 entitlement?: Entitlement;
 familyPool?: { ai_requests_this_month?: number; ai_requests_reset_date?: string };
 circles?: CircleDoc[];
 partnerLink?: PartnerLink;
 userName?: string;
 userId?: string;
 tripContext?: CombinedPreferences;
 onClose: () => void;
 onToggleFavorite: () => void;
 onMarkVisited: () => void;
 onUpdateDetails: (data: Partial<FavoriteData>) => void;
 onIncrementAiRequests?: () => void;
 onAddToCircle?: (circleId: string, place: GroupPlace) => void;
 onAddMemory?: (memory: Omit<Memory, 'id'>) => void;
 onTagMemoryToCircle?: (circleId: string, memory: Omit<Memory, 'id'>) => void;
 onSubmitAccessibilityContribution?: (payload: { features: AccessibilityFeatureValue[]; comment?: string }) => void | Promise<void>;
 isSubmittingAccessibilityContribution?: boolean;
 onSubmitFamilyFacilitiesContribution?: (payload: { features: FamilyFacilityValue[]; comment?: string }) => void | Promise<void>;
 isSubmittingFamilyFacilitiesContribution?: boolean;
 onSubmitPetFriendlyContribution?: (payload: { features: PetFriendlyFeatureValue[]; comment?: string }) => void | Promise<void>;
 isSubmittingPetFriendlyContribution?: boolean;
 communityTrust?: AggregatedReportSignals | null;
}

const VenueProfile: React.FC<VenueProfileProps> = ({ 
 place, 
 isFavorite, 
 isVisited,
 memories = [],
 memoryCount = 0,
 favoriteData, 
 childrenAges = [],
 isGuest = false,
 entitlement,
 familyPool,
 circles = [],
 partnerLink,
 userName = 'You',
 userId = '',
 tripContext,
 onClose, 
 onToggleFavorite,
 onMarkVisited,
 onUpdateDetails,
 onIncrementAiRequests,
 onAddToCircle,
 onAddMemory,
 onTagMemoryToCircle,
 onSubmitAccessibilityContribution,
 isSubmittingAccessibilityContribution = false,
 onSubmitFamilyFacilitiesContribution,
 isSubmittingFamilyFacilitiesContribution = false,
 onSubmitPetFriendlyContribution,
 isSubmittingPetFriendlyContribution = false,
 communityTrust
}) => {
 const aiInfo = canUseAI(entitlement, familyPool, userId);
 const venueMemories = memories.filter(m => m.placeId === place.id);
 const [activeTab, setActiveTab] = useState<'info' | 'parent'>('info');
 const [aiQuestion, setAiQuestion] = useState('');
 const [aiAnswer, setAiAnswer] = useState('');
 const [aiLoading, setAiLoading] = useState(false);
 const [showAiPanel, setShowAiPanel] = useState(false);
 const [lastAiQuestion, setLastAiQuestion] = useState('');
 const [aiCached, setAiCached] = useState(false);
 const [serverLimitReached, setServerLimitReached] = useState(false);
 const [serverLimitValue, setServerLimitValue] = useState<number | null>(null);
 const [showNavOptions, setShowNavOptions] = useState(false);
 
 const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
 const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
 const lightboxSwipeStartX = useRef(0);

 
 // Fetch place details from Google Places for reviews and extra info
 const [placeDetails, setPlaceDetails] = useState<PlaceDetails | null>(null);
 const [loadingDetails, setLoadingDetails] = useState(false);
 const [showAccessibilityModal, setShowAccessibilityModal] = useState(false);
 const [showFamilyFacilitiesModal, setShowFamilyFacilitiesModal] = useState(false);
 const [accessibilityModalScrollTarget, setAccessibilityModalScrollTarget] = useState<'suggested' | 'manual'>('manual');
 const [accessibilityHighlightedSuggested, setAccessibilityHighlightedSuggested] = useState<AccessibilityFeatureValue['feature'][]>([]);
 const [familyModalScrollTarget, setFamilyModalScrollTarget] = useState<'suggested' | 'manual'>('manual');
 const [familyHighlightedSuggested, setFamilyHighlightedSuggested] = useState<FamilyFacilityValue['feature'][]>([]);
 const [showPetFriendlyModal, setShowPetFriendlyModal] = useState(false);
 const [petFriendlyModalScrollTarget, setPetFriendlyModalScrollTarget] = useState<'suggested' | 'manual'>('manual');
 const [petFriendlyHighlightedSuggested, setPetFriendlyHighlightedSuggested] = useState<PetFriendlyFeatureValue['feature'][]>([]);
 const [accessibilityToast, setAccessibilityToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
 const [familyToast, setFamilyToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
 const [petFriendlyToast, setPetFriendlyToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
 const [osmData, setOsmData] = useState<OsmVenueData | null>(null);
 const [activitiesExpanded, setActivitiesExpanded] = useState(false);
 const [costExpanded, setCostExpanded] = useState(false);
 const [showClaimModal, setShowClaimModal] = useState(false);
 const [showOwnerDashboard, setShowOwnerDashboard] = useState(false);
 const [myClaim, setMyClaim] = useState<PlaceClaim | null>(null);
 const [claimLoaded, setClaimLoaded] = useState(false);
 const [reportModalOpen, setReportModalOpen] = useState(false);
 const [reportSubmitting, setReportSubmitting] = useState(false);
 const [selectedReviewReport, setSelectedReviewReport] = useState<{ reviewId: string; reportedUserId: string } | null>(null);

 useEffect(() => {
 if (userId && place.id) {
 fetchPlaceClaim(place.id).then(claim => {
 setMyClaim(claim);
 setClaimLoaded(true);
 }).catch(() => setClaimLoaded(true));
 } else {
 setClaimLoaded(true);
 }
 }, [userId, place.id]);
 
 useEffect(() => {
 let cancelled = false;
 if (place.id) {
 setLoadingDetails(true);
 setOsmData(null);
 getPlaceDetails(place.id)
 .then(details => {
 if (cancelled) return;
 setPlaceDetails(details);
 if (details?.lat && details?.lng) {
 fetchOsmVenueData(details.lat, details.lng, details.name || place.name)
 .then(osm => { if (!cancelled) setOsmData(osm); })
 .catch(() => {});
 }
 })
 .finally(() => { if (!cancelled) setLoadingDetails(false); });
 }
 return () => { cancelled = true; };
 }, [place]);

 useEffect(() => {
 setAccessibilityToast(null);
 setFamilyToast(null);
 setAccessibilityModalScrollTarget('manual');
 setAccessibilityHighlightedSuggested([]);
 setFamilyModalScrollTarget('manual');
 setFamilyHighlightedSuggested([]);
 }, [place.id]);

 const quickQuestions = [
 "Is this good for toddlers?",
 "What should we bring?",
 "Is it stroller friendly?",
 "Best time to visit?"
 ];

 const aiLimitReached = serverLimitReached || !aiInfo.allowed;

 const buildReviewId = (review: PlaceReview, idx: number): string => {
 const author = (review.authorName || 'unknown').toLowerCase().replace(/\s+/g, '_');
 const when = (review.relativeTimeDescription || 'unknown').toLowerCase().replace(/\s+/g, '_');
 return `${place.id}_r${idx}_${author}_${when}`;
 };

 const openReviewReport = (review: PlaceReview, idx: number) => {
 const reviewId = buildReviewId(review, idx);
 const reportedUserId = review.authorName?.trim() || 'unknown_google_user';
 setSelectedReviewReport({ reviewId, reportedUserId });
 setReportModalOpen(true);
 };

 const handleSubmitReviewReport = async (reason: UgcReportReason) => {
 if (!selectedReviewReport) return;
 setReportSubmitting(true);
 try {
 await createUgcReport({
 reported_content_type: 'review',
 reported_content_id: selectedReviewReport.reviewId,
 reported_user_id: selectedReviewReport.reportedUserId,
 reason,
 });
 setReportModalOpen(false);
 setSelectedReviewReport(null);
 window.alert('Report submitted. Thank you.');
 } catch (err) {
 console.error('Failed to submit review report:', err);
 window.alert('Could not submit report. Please try again.');
 } finally {
 setReportSubmitting(false);
 }
 };
 
 const handleAskAI = async (question: string, forceRefresh: boolean = false) => {
 if (!question.trim()) return;
 if (isGuest) return;
 if (aiLimitReached) return;
 
 setAiLoading(true);
 setAiAnswer('');
 setAiCached(false);
 setLastAiQuestion(question);
 try {
 const answer = await askAboutPlace(place, question, { 
 childrenAges,
 tripContext: tripContext ? {
 allergies: tripContext.allergies,
 accessibility: tripContext.accessibility,
 foodPreferences: tripContext.foodPreferences,
 activityPreferences: tripContext.activityPreferences,
 includesPartner: tripContext.includesPartner,
 includesChildren: tripContext.includesChildren,
 } : undefined
 }, {
 userId,
 featureName: 'place_ai_qna',
 forceRefresh,
 onUsage: ({ cached }) => {
 setAiCached(cached);
 },
 });
 setAiAnswer(answer);
 } catch (error: any) {
 if (error?.code === 'rate_limited' || error?.message === 'rate_limited') {
 setAiAnswer('Give us a second...');
 setAiLoading(false);
 return;
 }
 if (error?.code === 'limit_reached' || error?.message === 'limit_reached') {
 setServerLimitReached(true);
 setServerLimitValue(typeof error?.limit === 'number' ? error.limit : null);
 setAiAnswer("You've reached your monthly smart insights limit.");
 setAiLoading(false);
 return;
 }
 setAiAnswer(error.message || 'Failed to get response. Please try again.');
 }
 setAiLoading(false);
 };
 
 const [summarySaved, setSummarySaved] = useState(false);
 
 const handleSaveSummary = () => {
 if (!aiAnswer) return;
 const currentNotes = favoriteData?.notes || '';
 const timestamp = new Date().toLocaleDateString();
 const newNote = `\n\n--- Smart Insight (${timestamp}) ---\n${aiAnswer}`;
 const updatedNotes = currentNotes + newNote;
 onUpdateDetails({ notes: updatedNotes.trim() });
 setSummarySaved(true);
 setTimeout(() => setSummarySaved(false), 2000);
 };

 const handleSubmitAccessibility = async (payload: { features: AccessibilityFeatureValue[]; comment?: string }) => {
 if (!onSubmitAccessibilityContribution) return;
 if (payload.features.length === 0) return;
 try {
 await onSubmitAccessibilityContribution(payload);
 setAccessibilityToast({ type: 'success', message: 'Thanks! Your update helps other families.' });
 setShowAccessibilityModal(false);
 setTimeout(() => setAccessibilityToast(null), 2200);
 } catch (err) {
 setAccessibilityToast({ type: 'error', message: "Couldn't save. Please try again." });
 setTimeout(() => setAccessibilityToast(null), 2200);
 }
 };

 const handleSubmitFamilyFacilities = async (payload: { features: FamilyFacilityValue[]; comment?: string }) => {
 if (!onSubmitFamilyFacilitiesContribution) return;
 if (payload.features.length === 0) return;
 try {
 await onSubmitFamilyFacilitiesContribution(payload);
 setFamilyToast({ type: 'success', message: 'Thanks! Your update helps other families.' });
 setShowFamilyFacilitiesModal(false);
 setTimeout(() => setFamilyToast(null), 2200);
 } catch (err) {
 setFamilyToast({ type: 'error', message: "Couldn't save. Please try again." });
 setTimeout(() => setFamilyToast(null), 2200);
 }
 };

 const handleSubmitPetFriendly = async (payload: { features: PetFriendlyFeatureValue[]; comment?: string }) => {
 if (!onSubmitPetFriendlyContribution) return;
 if (payload.features.length === 0) return;
 try {
 await onSubmitPetFriendlyContribution(payload);
 setPetFriendlyToast({ type: 'success', message: 'Thanks! Your update helps other pet owners.' });
 setShowPetFriendlyModal(false);
 setTimeout(() => setPetFriendlyToast(null), 2200);
 } catch (err) {
 setPetFriendlyToast({ type: 'error', message: "Couldn't save. Please try again." });
 setTimeout(() => setPetFriendlyToast(null), 2200);
 }
 };

 const reviewInsights = React.useMemo(() => {
 if (!placeDetails?.reviews || placeDetails.reviews.length === 0) return null;
 const allText = placeDetails.reviews.map(r => r.text).join(' ').toLowerCase();
 const familyMentions: string[] = [];
 const keywords: [string, string][] = [
 ['playground', 'Has playground'],
 ['play area', 'Play area'],
 ['kids menu', "Kids' menu"],
 ['children.s menu', "Kids' menu"],
 ['kid friendly', 'Kid friendly'],
 ['child friendly', 'Child friendly'],
 ['family friendly', 'Family friendly'],
 ['stroller', 'Stroller accessible'],
 ['pram', 'Pram friendly'],
 ['high chair', 'High chairs'],
 ['highchair', 'High chairs'],
 ['baby change', 'Baby changing'],
 ['nappy change', 'Nappy changing'],
 ['diaper', 'Diaper facilities'],
 ['nursing', 'Nursing area'],
 ['breastfeed', 'Breastfeeding friendly'],
 ['jungle gym', 'Jungle gym'],
 ['jumping castle', 'Jumping castle'],
 ['trampoline', 'Trampoline'],
 ['sandpit', 'Sandpit'],
 ['splash pad', 'Splash pad'],
 ['water play', 'Water play'],
 ['face paint', 'Face painting'],
 ['petting zoo', 'Petting zoo'],
 ['pony ride', 'Pony rides'],
 ['safe.* for kids', 'Safe for kids'],
 ['toddler', 'Toddler friendly'],
 ['baby friendly', 'Baby friendly'],
 ];
 const seen = new Set<string>();
 for (const [pattern, label] of keywords) {
 if (new RegExp(pattern, 'i').test(allText) && !seen.has(label)) {
 seen.add(label);
 familyMentions.push(label);
 }
 }
 let highlightQuote: string | null = null;
 const familyPatterns = /(?:kids?|children|family|families|toddler|baby|babies|little ones)[^.!?]*[.!?]/gi;
 for (const review of placeDetails.reviews) {
 const matches = review.text.match(familyPatterns);
 if (matches) {
 const best = matches.reduce((a, b) => b.length > a.length ? b : a, '');
 if (best.length >= 20 && best.length <= 200) {
 highlightQuote = best.trim();
 break;
 }
 }
 }
 if (familyMentions.length === 0 && !highlightQuote) return null;
 return { familyMentions: familyMentions.slice(0, 6), highlightQuote };
 }, [placeDetails]);

 const confirmedAccessibility = (place.accessibility || []).filter(
 (item) => item.value === true && (item.confidence === 'reported' || item.confidence === 'verified')
 );
 const suggestedGoogleHints = React.useMemo(() => {
 const googleHints = getAccessibilityHintsFromGoogle(placeDetails);
 const osmHints = osmData?.accessibilityHints || [];
 const combined = new Set([...googleHints, ...osmHints]);
 return [...combined].filter(
 (feature) => !confirmedAccessibility.some((confirmed) => confirmed.feature === feature)
 );
 }, [placeDetails, osmData, confirmedAccessibility]);
 const confirmedFamilyFacilities = (place.familyFacilities || []).filter(
 (item) => item.value === true && (item.confidence === 'reported' || item.confidence === 'verified')
 );
 const suggestedFamilyHints = React.useMemo(() => {
 const googleHints = getFamilyFacilitiesHintsFromGoogle(placeDetails);
 const osmHints = osmData?.familyFacilityHints || [];
 const combined = new Set([...googleHints, ...osmHints]);
 return [...combined].filter(
 (feature) => !confirmedFamilyFacilities.some((confirmed) => confirmed.feature === feature)
 );
 }, [placeDetails, osmData, confirmedFamilyFacilities]);
 const confirmedPetFriendly = (place.petFriendly || []).filter(
 (item) => item.value === true && (item.confidence === 'reported' || item.confidence === 'verified')
 );
 const suggestedPetFriendlyHints = React.useMemo(() => {
 const googleHints = getPetFriendlyHintsFromGoogle(placeDetails);
 const osmHints = osmData?.petFriendlyHints || [];
 const combined = new Set([...googleHints, ...osmHints]);
 return [...combined].filter(
 (feature) => !confirmedPetFriendly.some((confirmed) => confirmed.feature === feature)
 );
 }, [placeDetails, osmData, confirmedPetFriendly]);
 const publicHints = getPublicHints(placeDetails);
 const confirmedStrollerFromFamily = confirmedFamilyFacilities.some((item) => item.feature === 'stroller_friendly');
 const confirmedStrollerFromAccessibility = confirmedAccessibility.some((item) => item.feature === 'step_free_entry');
 const strollerFriendlyConfirmed = confirmedStrollerFromFamily || confirmedStrollerFromAccessibility;
 const strollerFriendlySuggested = !strollerFriendlyConfirmed && publicHints.strollerFriendlySuggested;

 useEffect(() => {
 window.scrollTo(0, 0);
 }, [place.id]);

 return (
 <div 
 className="min-h-screen bg-[#F8FAFC] overflow-x-hidden pb-32"
 style={{ maxWidth: '100vw' }}
 >
 <div className="relative h-56 sm:h-64">
 <button
 className="w-full h-full block"
 onClick={() => { setPhotoViewerIndex(0); setPhotoViewerOpen(true); lightboxSwipeStartX.current = 0; }}
 aria-label="View full photo"
 >
 <img src={place.imageUrl} className="w-full h-full object-cover" alt={place.name} />
 </button>
 <div className="absolute inset-0 bg-gradient-to-t from-white via-white/40 to-black/20 pointer-events-none"></div>
 <button onClick={onClose} className="absolute top-4 left-4 w-11 h-11 bg-white/20 backdrop-blur-xl rounded-xl text-white flex items-center justify-center border border-white/20 safe-area-top">
 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
 </button>
 <button onClick={onToggleFavorite} className="absolute top-4 right-4 w-11 h-11 bg-white/20 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/20 safe-area-top">
 <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
 </button>
 <div className="absolute bottom-6 left-5 right-5">
 <div className="flex gap-1.5 mb-2 flex-wrap">
 {place.tags.slice(0, 3).map(t => <span key={t} className="px-2 py-0.5 bg-white/80 backdrop-blur rounded-lg text-[8px] font-bold text-sky-900 uppercase tracking-wide">{t}</span>)}
 </div>
 <h1 className="text-xl sm:text-2xl font-black text-[#1E293B] tracking-tight leading-tight break-words drop-shadow-[0_2px_4px_rgba(255,255,255,0.9)] flex items-center gap-1.5 flex-wrap" style={{ textShadow: '0 1px 3px rgba(255,255,255,0.9), 0 2px 8px rgba(255,255,255,0.7)' }}>
 {place.name}
 {place.ownerStatus === 'verified' && (
 <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-600 text-white text-[9px] font-bold rounded-full shadow-sm whitespace-nowrap" title="Verified Owner">
 <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
 Verified
 </span>
 )}
 </h1>
 <p className="text-xs font-bold text-slate-600 mt-1 drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)]" style={{ textShadow: '0 1px 2px rgba(255,255,255,0.9), 0 1px 4px rgba(255,255,255,0.7)' }}>{place.address}</p>
 </div>
 </div>

 <div className="flex px-5 gap-4">
 <TabBtn active={activeTab === 'info'} onClick={() => setActiveTab('info')} label="Information" />
 <TabBtn active={activeTab === 'parent'} onClick={() => setActiveTab('parent')} label="Notebook" />
 </div>

 {/* Status bar - Save/Visited toggle */}
 {!isGuest && (
 <div className="px-5 pt-4">
 <div className="flex gap-3">
 <button 
 onClick={onToggleFavorite}
 className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm shadow-sm transition-all ${
 isFavorite 
 ? 'bg-purple-500 text-white shadow-purple-200' 
 : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
 }`}
 >
 <svg className="w-4 h-4" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
 <span>{isFavorite ? 'Saved' : 'Save Place'}</span>
 </button>
 <button 
 onClick={onMarkVisited}
 className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm shadow-sm transition-all ${
 isVisited 
 ? 'bg-green-500 text-white shadow-green-200' 
 : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
 }`}
 >
 <svg className="w-4 h-4" viewBox="0 0 24 24" fill={isVisited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
 <span>{isVisited ? 'Visited' : 'Mark Visited'}</span>
 </button>
 </div>
 </div>
 )}

 {/* Quick action buttons */}
 {!isGuest && (
 <div className="px-5 pt-3 space-y-2">
 {partnerLink?.status === 'accepted' && (
 <button
 onClick={() => {
 if (onAddToCircle) {
 const note = window.prompt('Why are we saving this?') || '';
 const partnerPlace: GroupPlace = {
 placeId: place.id,
 placeName: place.name,
 imageUrl: place.imageUrl,
 placeType: place.type,
 addedBy: userId,
 addedByName: userName,
 addedAt: new Date().toISOString(),
 note: note.trim(),
 };
 onAddToCircle('partner', partnerPlace);
 }
 }}
 className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white py-3 rounded-2xl font-bold text-sm shadow-lg"
 >
 <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
 <span>Add to Partner Plans</span>
 </button>
 )}
 
 {circles.length > 0 && (
 <div className="flex gap-2 overflow-x-auto pb-1">
 {circles.map(circle => (
 <button
 key={circle.id}
 onClick={() => {
 if (onAddToCircle) {
 const groupPlace: GroupPlace = {
 placeId: place.id,
 placeName: place.name,
 addedBy: userId,
 addedByName: userName,
 addedAt: new Date().toISOString(),
 };
 onAddToCircle(circle.id, groupPlace);
 }
 }}
 className="flex items-center gap-2 bg-purple-50 text-purple-700 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap hover:bg-purple-100"
 >
 <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
 <span>Add to {circle.name}</span>
 </button>
 ))}
 </div>
 )}
 </div>
 )}

 <div className="p-6 space-y-8 pb-40">
 {activeTab === 'info' ? (
 <>
 {(placeDetails?.editorialSummary || placeDetails?.reviewSummary || reviewInsights) && (
 <section className="space-y-3">
 {(placeDetails?.editorialSummary || placeDetails?.reviewSummary) && (
 <div className="bg-gradient-to-br from-sky-50 to-blue-50 rounded-2xl border border-sky-100 p-4 space-y-2">
 <div className="flex items-center gap-2">
 <svg className="w-4 h-4 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
 <span className="text-xs font-bold text-sky-700 uppercase tracking-wide">About this place</span>
 </div>
 {placeDetails?.editorialSummary && (
 <p className="text-sm text-slate-700 leading-relaxed">{placeDetails.editorialSummary}</p>
 )}
 {placeDetails?.reviewSummary && placeDetails.reviewSummary !== placeDetails.editorialSummary && (
 <p className="text-sm text-slate-600 leading-relaxed">{placeDetails.reviewSummary}</p>
 )}
 <p className="text-[10px] text-slate-400">Source: Google</p>
 </div>
 )}
 {reviewInsights && (
 <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-100 p-4 space-y-2">
 <div className="flex items-center gap-2">
 <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
 <span className="text-xs font-bold text-amber-700 uppercase tracking-wide">What visitors say</span>
 </div>
 {reviewInsights.familyMentions.length > 0 && (
 <div className="flex flex-wrap gap-1.5">
 {reviewInsights.familyMentions.map((mention, i) => (
 <span key={i} className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">{mention}</span>
 ))}
 </div>
 )}
 {reviewInsights.highlightQuote && (
 <p className="text-xs text-slate-600 italic leading-relaxed">"{reviewInsights.highlightQuote}"</p>
 )}
 <p className="text-[10px] text-slate-400">Based on {placeDetails?.userRatingsTotal || 'visitor'} reviews</p>
 </div>
 )}
 </section>
 )}

 {place.ownerContent && Object.keys(place.ownerContent).length > 0 && (
 <section className="space-y-3">
 <div className="flex items-center gap-2 mb-1">
 <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
 <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">From the Owner</span>
 {place.ownerTier === 'business_pro' && (
 <span className="px-1.5 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[8px] font-bold rounded-full">PRO</span>
 )}
 </div>
 <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-4 space-y-3">
 {place.ownerContent.headline && (
 <p className="text-sm font-semibold text-gray-900 ">{place.ownerContent.headline}</p>
 )}
 {place.ownerContent.aboutUs && (
 <p className="text-sm text-gray-700 leading-relaxed">{place.ownerContent.aboutUs}</p>
 )}
 {place.ownerContent.operatingHours && Object.values(place.ownerContent.operatingHours).some(v => v) && (
 <div>
 <p className="text-xs font-bold text-gray-600 uppercase mb-1">Hours</p>
 <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600 ">
 {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map(day => 
 place.ownerContent?.operatingHours?.[day] ? (
 <div key={day} className="flex justify-between">
 <span className="capitalize font-medium">{day.slice(0, 3)}</span>
 <span>{place.ownerContent.operatingHours[day]}</span>
 </div>
 ) : null
 )}
 </div>
 </div>
 )}
 {place.ownerContent.amenities && place.ownerContent.amenities.length > 0 && (
 <div className="flex flex-wrap gap-1.5">
 {place.ownerContent.amenities.map((a, i) => (
 <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-semibold rounded-full">{a}</span>
 ))}
 </div>
 )}
 {place.ownerContent.specialOffers && place.ownerContent.specialOffers.length > 0 && (
 <div>
 <p className="text-xs font-bold text-amber-600 uppercase mb-1">Special Offers</p>
 {place.ownerContent.specialOffers.filter(o => o.isActive).map(offer => (
 <div key={offer.id} className="bg-amber-50 rounded-lg p-2 mb-1">
 <p className="text-xs font-semibold text-gray-900 ">{offer.title}</p>
 <p className="text-xs text-gray-600 ">{offer.description}</p>
 </div>
 ))}
 </div>
 )}
 {place.ownerContent.bookingUrl && (
 <a href={place.ownerContent.bookingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors">
 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
 Book Now
 </a>
 )}
 </div>
 </section>
 )}

 {!isGuest && claimLoaded && (
 <section>
 {place.ownerStatus === 'verified' && place.ownerIds?.includes(userId) ? (
 <button
 onClick={() => setShowOwnerDashboard(true)}
 className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors flex items-center justify-center gap-2"
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
 Manage Your Place
 </button>
 ) : myClaim?.status === 'pending' ? (
 <div className="py-2.5 px-4 rounded-xl text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 text-center">
 Ownership claim under review
 </div>
 ) : myClaim?.status === 'rejected' ? (
 <div className="space-y-2">
 <div className="py-2 px-4 rounded-xl text-sm text-red-700 bg-red-50 border border-red-200 text-center">
 Claim was not approved{myClaim.rejectionReason ? `: ${myClaim.rejectionReason}` : ''}
 </div>
 <button
 onClick={() => setShowClaimModal(true)}
 className="w-full py-2 px-4 rounded-xl text-xs font-medium text-gray-600 hover:text-gray-800 transition-colors"
 >
 Submit new claim
 </button>
 </div>
 ) : place.ownerStatus !== 'verified' ? (
 <button
 onClick={() => setShowClaimModal(true)}
 className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors flex items-center justify-center gap-2"
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
 Own this place? Claim it
 </button>
 ) : null}
 </section>
 )}

 <section className="space-y-4">
 <h3 className="text-base font-bold text-[#1E293B]">Family Review</h3>
 {place.fullSummary ? (
 <p className="text-slate-500 leading-relaxed text-sm font-medium">{place.fullSummary}</p>
 ) : placeDetails?.editorialSummary ? (
 <p className="text-slate-500 leading-relaxed text-sm font-medium">{placeDetails.editorialSummary}</p>
 ) : placeDetails?.reviews && placeDetails.reviews.length > 0 ? (
 <p className="text-slate-500 leading-relaxed text-sm font-medium">
 Based on {placeDetails.userRatingsTotal || placeDetails.reviews.length} reviews, this {place.description || 'place'} has a {place.rating ? `${place.rating}/5 rating` : 'solid reputation'}.{reviewInsights && reviewInsights.familyMentions.length > 0 ? ` Visitors mention: ${reviewInsights.familyMentions.slice(0, 3).join(', ').toLowerCase()}.` : ' Use Smart Insights below to ask about family-friendliness.'}
 </p>
 ) : (
 <p className="text-slate-400 leading-relaxed text-sm italic">
 No family review yet. Visit this place and share your experience!
 </p>
 )}
 {strollerFriendlyConfirmed && (
 <p className="text-xs font-medium text-slate-500">
 Reported by the FamPal community: stroller friendly access.
 </p>
 )}
 {strollerFriendlySuggested && (
 <p className="text-xs font-medium text-slate-500">
 Suggested by public sources (not yet confirmed): stroller friendly access.
 </p>
 )}
 </section>

 {communityTrust && communityTrust.reportCount > 0 && (
 <section className="space-y-2">
 <div className="flex items-center gap-2">
 <svg className="w-4 h-4 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
 <h3 className="font-bold text-sm text-slate-800">Family Verdict</h3>
 <span className="text-[10px] font-semibold bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">
 {communityTrust.reportCount} {communityTrust.reportCount === 1 ? 'family' : 'families'} reported
 </span>
 </div>
 <div className="flex flex-wrap gap-1.5">
 {Object.entries(communityTrust.kidPrefs).filter(([, v]) => (v as AggregatedSignal).positive).map(([key, signal]) => (
 <span key={key} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200 min-h-[32px] flex items-center gap-1">
 <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
 {key.replace(/_/g, ' ')}
 </span>
 ))}
 {Object.entries(communityTrust.accessibility).filter(([, v]) => (v as AggregatedSignal).positive).map(([key, signal]) => (
 <span key={key} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 min-h-[32px] flex items-center gap-1">
 <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
 {key.replace(/_/g, ' ')}
 </span>
 ))}
 </div>
 </section>
 )}

 <PlaceFamilyFacilitiesSection
 familyFacilities={place.familyFacilities}
 familyFacilitiesSummary={place.familyFacilitiesSummary}
 suggestedFeatures={suggestedFamilyHints}
 onAddFamilyInfo={(options) => {
 setFamilyModalScrollTarget(options?.focusSection || 'manual');
 setFamilyHighlightedSuggested(options?.highlightedSuggestedFeatures || []);
 setShowFamilyFacilitiesModal(true);
 }}
 />

 <PlaceAccessibilitySection
 accessibility={place.accessibility}
 accessibilitySummary={place.accessibilitySummary}
 suggestedFeatures={suggestedGoogleHints}
 onAddAccessibilityInfo={(options) => {
 setAccessibilityModalScrollTarget(options?.focusSection || 'manual');
 setAccessibilityHighlightedSuggested(options?.highlightedSuggestedFeatures || []);
 setShowAccessibilityModal(true);
 }}
 />

 <PlacePetFriendlySection
 petFriendly={place.petFriendly}
 petFriendlySummary={place.petFriendlySummary}
 suggestedFeatures={suggestedPetFriendlyHints}
 onAddPetFriendlyInfo={(options) => {
 setPetFriendlyModalScrollTarget(options?.focusSection || 'manual');
 setPetFriendlyHighlightedSuggested(options?.highlightedSuggestedFeatures || []);
 setShowPetFriendlyModal(true);
 }}
 />

 <section className="grid grid-cols-2 gap-4">
 <InfoTile label="Pricing" value={formatPriceLevel(place.priceLevel)} icon={<svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>} />
 <InfoTile label="Age Group" value={place.ageAppropriate || 'All ages'} icon={<svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>} />
 <InfoTile label="Distance" value={place.distance || '—'} icon={<svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>} />
 <InfoTile label="Rating" value={place.rating ? `${place.rating} / 5` : '—'} icon={<svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>} />
 </section>

 <section className="space-y-4">
 {isGuest ? (
 <div className="relative">
 <button 
 disabled
 className="w-full h-16 bg-gradient-to-r from-slate-300 to-slate-400 text-white rounded-3xl font-extrabold shadow-lg flex items-center justify-center gap-3 opacity-60 cursor-not-allowed"
 >
 <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
 Smart Insights for This Place
 </button>
 <div className="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
 <p className="text-sm font-bold text-amber-700">Sign in to unlock smart insights</p>
 <p className="text-xs text-amber-600 mt-1">Get personalized recommendations for your family</p>
 </div>
 </div>
 ) : (
 <>
 <button 
 onClick={() => setShowAiPanel(!showAiPanel)}
 className="w-full h-14 bg-white border-2 border-violet-200 text-violet-700 rounded-2xl font-bold flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all"
 >
 <svg className="w-5 h-5 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
 <span className="text-sm">Smart Insights</span>
 {aiInfo.limit !== -1 && aiInfo.limit !== Infinity && (
 <span className="text-[10px] font-semibold bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">
 {aiInfo.remaining}/{aiInfo.limit}
 </span>
 )}
 <svg className={`w-4 h-4 text-violet-400 transition-transform ${showAiPanel ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 9l-7 7-7-7" /></svg>
 </button>
 
 {showAiPanel && (
 <div className="bg-white rounded-2xl p-5 space-y-4 border border-slate-100 shadow-sm animate-slide-up">
 {aiLimitReached ? (
 <div className="text-center py-3">
 <p className="text-base font-bold text-slate-700">Monthly Limit Reached</p>
 <p className="text-sm text-slate-500 mt-2">
 {aiInfo.limit === 5
 ? "You've used your 5 free insights this month. Upgrade to Pro for 100/month."
 : `You've used all ${(serverLimitValue ?? aiInfo.limit)} insights this month.`}
 </p>
 {aiInfo.limit === 5 && (
 <button className="mt-4 px-6 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-all">
 Upgrade to Pro
 </button>
 )}
 </div>
 ) : (
 <>
 {aiInfo.limit === 100 && aiInfo.remaining <= 20 && (
 <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
 {aiInfo.remaining} insights remaining this month
 </p>
 )}
 <p className="text-xs text-slate-400 font-medium">Quick questions</p>
 <div className="flex flex-wrap gap-2">
 {quickQuestions.map(q => (
 <button 
 key={q}
 onClick={() => { setAiQuestion(q); handleAskAI(q); }}
 className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 active:bg-violet-50 active:border-violet-200 active:text-violet-700 transition-colors"
 >
 {q}
 </button>
 ))}
 </div>
 
 <div className="flex gap-2">
 <input 
 type="text"
 value={aiQuestion}
 onChange={(e) => setAiQuestion(e.target.value)}
 onKeyDown={(e) => e.key === 'Enter' && handleAskAI(aiQuestion)}
 placeholder="Ask about this place..."
 className="flex-1 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium focus:ring-2 focus:ring-violet-300 focus:border-violet-300 outline-none"
 />
 <button 
 onClick={() => handleAskAI(aiQuestion)}
 disabled={aiLoading || !aiQuestion.trim()}
 className="px-5 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-40 active:scale-95 transition-all"
 >
 {aiLoading ? '...' : 'Ask'}
 </button>
 </div>
 </>
 )}
 
 {aiAnswer && (
 <div className="bg-violet-50 rounded-xl p-4 space-y-3 border border-violet-100">
 <p className="text-sm text-slate-700 leading-relaxed">{aiAnswer}</p>
 {aiCached && (
 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Cached response</p>
 )}
 <button 
 onClick={handleSaveSummary}
 disabled={summarySaved}
 className={`w-full py-2.5 rounded-xl text-xs font-bold transition-colors ${
 summarySaved 
 ? 'bg-green-100 text-green-600 border border-green-200' 
 : 'bg-white text-violet-600 border border-violet-200 active:bg-violet-50'
 }`}
 >
 {summarySaved ? 'Saved!' : 'Save Insight to Notes'}
 </button>
 <button
 onClick={() => handleAskAI(lastAiQuestion || aiQuestion, true)}
 disabled={aiLoading || !(lastAiQuestion || aiQuestion)}
 className="w-full py-2.5 rounded-xl text-xs font-bold bg-white text-slate-500 border border-slate-200 active:bg-slate-50 disabled:opacity-40"
 >
 Refresh Insight
 </button>
 </div>
 )}
 </div>
 )}
 </>
 )}
 </section>

 <section className="space-y-4">
 <h3 className="text-xl font-extrabold text-[#1E293B]">Contact Details</h3>
 <div className="grid grid-cols-1 gap-3">
 {(place.phone || placeDetails?.phone) && (
 <a href={`tel:${place.phone || placeDetails?.phone}`} className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 hover:bg-sky-50 transition-colors">
 <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center"><svg className="w-5 h-5 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" /></svg></div>
 <div>
 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Phone</p>
 <p className="text-sm font-bold text-sky-600">{place.phone || placeDetails?.phone}</p>
 </div>
 </a>
 )}
 {(place.website || placeDetails?.website) && (() => {
 const siteUrl = place.website || placeDetails?.website || '';
 return (
 <a href={siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 hover:bg-sky-50 transition-colors">
 <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center"><svg className="w-5 h-5 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg></div>
 <div>
 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Website</p>
 <p className="text-sm font-bold text-sky-600 truncate max-w-[200px]">{siteUrl.replace(/^https?:\/\//, '')}</p>
 </div>
 </a>
 );
 })()}
 {!place.phone && !placeDetails?.phone && !place.website && !placeDetails?.website && !loadingDetails && (
 <p className="text-sm text-slate-400 italic">Contact details not available</p>
 )}
 {loadingDetails && !place.phone && !place.website && (
 <p className="text-sm text-slate-400 italic">Loading contact details...</p>
 )}
 {!showNavOptions ? (
 <button 
 onClick={() => setShowNavOptions(true)} 
 className="w-full h-16 bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white rounded-3xl font-extrabold mt-4 shadow-xl shadow-purple-200 flex items-center justify-center gap-2 active:scale-95 transition-all"
 >
 <svg className="w-5 h-5 inline -mt-0.5 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>Navigate
 </button>
 ) : (
 <div className="mt-4 space-y-3">
 <div className="flex items-center justify-between mb-2">
 <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Open with</p>
 <button onClick={() => setShowNavOptions(false)} className="text-xs text-slate-400 font-bold">Close</button>
 </div>
 {(() => {
 const urls = getNavigationUrls(place, placeDetails);
 return (
 <>
 <a
 href={urls.google}
 target="_blank"
 rel="noopener noreferrer"
 className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 active:scale-95 transition-all"
 >
 <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
 <img src="/icons/google-maps.png" alt="Google Maps" width="40" height="40" className="rounded-lg" />
 </div>
 <span className="font-bold text-[#1E293B]">Google Maps</span>
 </a>
 <a
 href={urls.apple}
 target="_blank"
 rel="noopener noreferrer"
 className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 active:scale-95 transition-all"
 >
 <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
 <img src="/icons/apple-maps.png" alt="Apple Maps" width="40" height="40" className="rounded-lg" />
 </div>
 <span className="font-bold text-[#1E293B]">Apple Maps</span>
 </a>
 <a
 href={urls.waze}
 target="_blank"
 rel="noopener noreferrer"
 className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 active:scale-95 transition-all"
 >
 <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
 <img src="/icons/waze.png" alt="Waze" width="40" height="40" className="rounded-lg" />
 </div>
 <span className="font-bold text-[#1E293B]">Waze</span>
 </a>
 </>
 );
 })()}
 </div>
 )}
 
 <div className="grid grid-cols-2 gap-3 mt-4">
 <button 
 onClick={() => {
 const text = `Check out ${place.name}! ${place.address}\n${place.rating} rating\n${place.description}\n\n${place.mapsUrl}`;
 const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
 window.open(whatsappUrl, '_blank');
 }}
 className="h-14 bg-[#25D366] text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg"
 >
 <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
 Share
 </button>
 <button 
 onClick={() => {
 const title = `Visit: ${place.name}`;
 const details = `${place.description}\n\nAddress: ${place.address}\nRating: ⭐ ${place.rating}\nPrice: ${place.priceLevel}\n\n${place.mapsUrl}`;
 const now = new Date();
 const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
 startDate.setHours(10, 0, 0, 0);
 const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
 
 const formatDate = (d: Date) => d.toISOString().replace(/-|:|\.\d{3}/g, '').slice(0, 15) + 'Z';
 const calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(place.address)}&dates=${formatDate(startDate)}/${formatDate(endDate)}`;
 window.open(calUrl, '_blank');
 }}
 className="h-14 bg-white text-sky-600 border-2 border-sky-200 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-sky-50"
 >
 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
 Plan This
 </button>
 </div>
 </div>
 </section>

 {/* Photo Gallery */}
 {placeDetails?.photos && placeDetails.photos.length > 1 && (
 <section className="space-y-4">
 <h3 className="text-xl font-extrabold text-[#1E293B] flex items-center gap-2">
 <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
 Photos
 <span className="text-sm font-bold text-slate-400">({placeDetails.photos.length})</span>
 </h3>
 <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 snap-x snap-mandatory scrollbar-hide">
 {placeDetails.photos.map((photoUrl, idx) => (
 <button
 key={idx}
 onClick={() => { setPhotoViewerIndex(idx); setPhotoViewerOpen(true); }}
 className="flex-shrink-0 w-36 h-28 rounded-2xl overflow-hidden shadow-sm border border-slate-100 snap-start active:scale-95 transition-transform"
 >
 <img src={photoUrl} alt={`${place.name} photo ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
 </button>
 ))}
 </div>
 </section>
 )}

 {/* Google Reviews Section */}
 {placeDetails?.reviews && placeDetails.reviews.length > 0 && (
 <section className="space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="text-xl font-extrabold text-[#1E293B] flex items-center gap-2">
 <svg className="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg> Reviews
 <span className="text-sm font-bold text-slate-400">
 ({placeDetails.userRatingsTotal || placeDetails.reviews.length} on Google)
 </span>
 </h3>
 <a 
 href={placeDetails.mapsUrl || place.mapsUrl} 
 target="_blank" 
 rel="noopener noreferrer"
 className="text-xs font-bold text-purple-500 hover:underline"
 >
 See all on Google
 </a>
 </div>
 <div className="space-y-3">
 {placeDetails.reviews.slice(0, 3).map((review, idx) => (
 <div key={idx} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
 <div className="flex items-start gap-3">
 {review.profilePhotoUrl ? (
 <img src={review.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
 ) : (
 <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-sm">
 {review.authorName.charAt(0)}
 </div>
 )}
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-2 mb-1">
 <div className="flex items-center gap-2 min-w-0">
 <span className="font-bold text-sm text-slate-700 truncate">{review.authorName}</span>
 <span className="text-xs text-slate-400">{review.relativeTimeDescription}</span>
 </div>
 {!isGuest && (
 <button
 type="button"
 onClick={() => openReviewReport(review, idx)}
 className="text-[11px] font-bold text-rose-500 hover:text-rose-600"
 >
 Report
 </button>
 )}
 </div>
 <div className="flex gap-0.5 mb-2">
 {[...Array(5)].map((_, i) => (
 <span key={i} className={`text-sm ${i < review.rating ? 'text-amber-400' : 'text-slate-200'}`}>★</span>
 ))}
 </div>
 <p className="text-sm text-slate-600 line-clamp-3">{review.text}</p>
 </div>
 </div>
 </div>
 ))}
 </div>
 <a 
 href={placeDetails.mapsUrl || place.mapsUrl} 
 target="_blank" 
 rel="noopener noreferrer"
 className="block text-center text-sm font-bold text-purple-500 hover:underline py-2"
 >
 Read more reviews on Google →
 </a>
 </section>
 )}

 {venueMemories.length > 0 && (
 <section className="space-y-4">
 <h3 className="text-xl font-extrabold text-[#1E293B] flex items-center gap-2">
 <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg> Your Memories
 </h3>
 <div className="space-y-3">
 {venueMemories.map(memory => {
 const photos = memory.photoThumbUrls || memory.photoUrls || (memory.photoThumbUrl ? [memory.photoThumbUrl] : (memory.photoUrl ? [memory.photoUrl] : []));
 return (
 <div key={memory.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">
 <div className="flex gap-3 p-4">
 {photos.length > 0 && (
 <div className="flex gap-2 shrink-0">
 {photos.slice(0, 3).map((url, idx) => (
 <div key={idx} className="w-16 h-16 rounded-xl overflow-hidden">
 <img src={url} className="w-full h-full object-cover" alt="" />
 </div>
 ))}
 </div>
 )}
 <div className="flex-1 min-w-0">
 <p className="text-sm font-bold text-slate-700">{memory.caption}</p>
 <p className="text-xs text-slate-400 mt-2">
 {new Date(memory.date).toLocaleDateString('en-US', { 
 month: 'short', 
 day: 'numeric', 
 year: 'numeric' 
 })}
 </p>
 </div>
 </div>
 </div>
 );
 })}
 </div>
 </section>
 )}
 </>
 ) : (
 <div className="animate-slide-up space-y-8">
 {!isFavorite && !isVisited ? (
 <div className="py-16 text-center space-y-4 bg-sky-50 rounded-[40px] p-8 border border-sky-100">
 <div className="w-16 h-16 bg-white rounded-3xl mx-auto flex items-center justify-center shadow-sm"><svg className="w-8 h-8 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg></div>
 <h3 className="font-black text-sky-900 text-xl">Unlock the Notebook</h3>
 <p className="text-xs text-sky-700/70 font-bold leading-relaxed">Save or mark this place as visited to keep notes, photos, and memories.</p>
 <div className="flex gap-3 justify-center">
 <button onClick={onToggleFavorite} className="px-6 h-12 bg-purple-500 text-white rounded-2xl font-black text-sm shadow-lg shadow-purple-200">Save Place</button>
 <button onClick={onMarkVisited} className="px-6 h-12 bg-green-500 text-white rounded-2xl font-black text-sm shadow-lg shadow-green-200">Mark Visited</button>
 </div>
 </div>
 ) : (
 <>
 <div className="space-y-4">
 <h3 className="text-xl font-extrabold text-sky-900 flex items-center gap-2">
 <svg className="w-4 h-4 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg> Private Notes
 </h3>
 <textarea 
 className="w-full p-6 bg-white rounded-3xl border-none text-sm font-bold text-slate-600 shadow-sm focus:ring-2 focus:ring-sky-500 outline-none placeholder:text-slate-300"
 rows={4}
 placeholder="Leo loved the blueberry pancakes. Ask for Table 4 near the play area next time..."
 value={favoriteData?.notes || ''}
 onChange={(e) => onUpdateDetails({ notes: e.target.value })}
 />
 </div>

 <div className="space-y-3">
 <button
 onClick={() => setActivitiesExpanded(!activitiesExpanded)}
 className="w-full flex items-center justify-between py-2"
 >
 <h3 className="text-xl font-extrabold text-sky-900 flex items-center gap-2">
 <svg className="w-4 h-4 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg> Activities & Features
 {(favoriteData?.activities?.length || 0) > 0 && (
 <span className="text-xs font-bold bg-sky-100 text-sky-600 px-2 py-0.5 rounded-full">{favoriteData!.activities!.length} tagged</span>
 )}
 </h3>
 <svg className={`w-5 h-5 text-slate-400 transition-transform ${activitiesExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
 </button>
 {activitiesExpanded && (
 <div className="space-y-3">
 <p className="text-xs text-slate-500">Tag what's available at this spot for quick reference</p>
 {Object.entries(ACTIVITY_OPTIONS).map(([category, activities]) => (
 <div key={category} className="bg-white rounded-2xl p-4 shadow-sm">
 <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">{category}</h4>
 <div className="flex flex-wrap gap-2">
 {activities.map((activity) => {
 const isSelected = favoriteData?.activities?.includes(activity);
 return (
 <button
 key={activity}
 onClick={() => {
 const currentActivities = favoriteData?.activities || [];
 const newActivities = isSelected
 ? currentActivities.filter(a => a !== activity)
 : [...currentActivities, activity];
 onUpdateDetails({ activities: newActivities });
 }}
 className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
 isSelected
 ? 'bg-purple-500 text-white shadow-sm'
 : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
 }`}
 >
 {activity}
 </button>
 );
 })}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 <div className="space-y-3">
 <button
 onClick={() => setCostExpanded(!costExpanded)}
 className="w-full flex items-center justify-between py-2"
 >
 <h3 className="text-xl font-extrabold text-sky-900 flex items-center gap-2">
 Actual Cost Paid
 {favoriteData?.costEstimate && (
 <span className="text-xs font-bold bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">{favoriteData.costEstimate}</span>
 )}
 </h3>
 <svg className={`w-5 h-5 text-slate-400 transition-transform ${costExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
 </button>
 {costExpanded && (
 <div className="flex gap-2 bg-white p-2 rounded-3xl shadow-sm">
 {['$', '$$', '$$$', '$$$$'].map(price => (
 <button 
 key={price}
 onClick={() => onUpdateDetails({ costEstimate: price })}
 className={`flex-1 h-12 rounded-2xl font-black text-xs transition-all ${favoriteData?.costEstimate === price ? 'bg-purple-500 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-50'}`}
 >
 {price}
 </button>
 ))}
 </div>
 )}
 </div>

 {/* Add Memory Section */}
 <div className="space-y-4">
 <MemoryCreate
 entitlement={entitlement}
 currentCount={memoryCount}
 fixedPlace={place}
 onCreate={(memory) => {
 if (onAddMemory) {
 onAddMemory(memory);
 }
 }}
 onUpgradePrompt={() => {
 alert('Memory limit reached. Upgrade to Pro for unlimited memories!');
 }}
 enablePartnerShare={partnerLink?.status === 'accepted'}
 circleOptions={circles.map(circle => ({ id: circle.id, name: circle.name }))}
 onTagCircle={onTagMemoryToCircle}
 title="Add Memory"
 toggleLabels={{ closed: 'New +', open: 'Cancel' }}
 showToggle={true}
 />
 {/* Show venue memories */}
 {venueMemories.length > 0 && (
 <div className="space-y-3">
 <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Your Memories Here</p>
 <div className="grid grid-cols-2 gap-3">
 {venueMemories.map(memory => {
 const photos = memory.photoThumbUrls || memory.photoUrls || (memory.photoThumbUrl ? [memory.photoThumbUrl] : (memory.photoUrl ? [memory.photoUrl] : []));
 const mainPhoto = photos[0] || memory.photoThumbUrl || memory.photoUrl;
 return (
 <div key={memory.id} className="bg-white rounded-2xl overflow-hidden shadow-sm">
 <div className="relative">
 {mainPhoto ? (
 <img src={mainPhoto} className="w-full aspect-square object-cover" alt="" />
 ) : (
 <div className="w-full aspect-square bg-slate-100 flex items-center justify-center text-slate-400 text-[10px] font-bold">
 Text Memory
 </div>
 )}
 {photos.length > 1 && (
 <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
 +{photos.length - 1}
 </div>
 )}
 </div>
 <div className="p-3">
 <p className="text-xs font-semibold text-slate-700 line-clamp-2">{memory.caption}</p>
 <p className="text-[10px] text-slate-400 mt-1">{new Date(memory.date).toLocaleDateString()}</p>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 )}
 </div>
 </>
 )}
 </div>
 )}
 </div>
 
 {/* Floating Home Button removed from here — rendered globally in App.tsx */}
 {accessibilityToast && (
 <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40">
 <div
 className={`px-4 py-2 text-xs font-semibold rounded-full shadow-lg ${
 accessibilityToast.type === 'success'
 ? 'bg-emerald-600 text-white shadow-emerald-700/30'
 : 'bg-rose-600 text-white shadow-rose-700/30'
 }`}
 >
 {accessibilityToast.message}
 </div>
 </div>
 )}
 {familyToast && (
 <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-40">
 <div
 className={`px-4 py-2 text-xs font-semibold rounded-full shadow-lg ${
 familyToast.type === 'success'
 ? 'bg-emerald-600 text-white shadow-emerald-700/30'
 : 'bg-rose-600 text-white shadow-rose-700/30'
 }`}
 >
 {familyToast.message}
 </div>
 </div>
 )}
 {petFriendlyToast && (
 <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
 <div
 className={`px-4 py-2 text-xs font-semibold rounded-full shadow-lg ${
 petFriendlyToast.type === 'success'
 ? 'bg-emerald-600 text-white shadow-emerald-700/30'
 : 'bg-rose-600 text-white shadow-rose-700/30'
 }`}
 >
 {petFriendlyToast.message}
 </div>
 </div>
 )}

 {showClaimModal && (
 <ClaimPlaceModal
 place={place}
 onClose={() => setShowClaimModal(false)}
 onSuccess={() => {
 setShowClaimModal(false);
 setMyClaim({ status: 'pending' } as PlaceClaim);
 }}
 />
 )}

 {showOwnerDashboard && (
 <OwnerDashboard
 place={place}
 userId={userId}
 userEmail={(place as any).userEmail || ''}
 onClose={() => setShowOwnerDashboard(false)}
 />
 )}

 {photoViewerOpen && (() => {
 const allPhotos = placeDetails?.photos && placeDetails.photos.length > 0
 ? placeDetails.photos
 : place.imageUrl ? [place.imageUrl] : [];
 if (allPhotos.length === 0) return null;
 const safeIndex = Math.min(photoViewerIndex, allPhotos.length - 1);
 const handleSwipeStart = (e: React.TouchEvent) => { lightboxSwipeStartX.current = e.touches[0].clientX; };
 const handleSwipeEnd = (e: React.TouchEvent) => {
 const diff = lightboxSwipeStartX.current - e.changedTouches[0].clientX;
 if (Math.abs(diff) > 50) {
 if (diff > 0 && safeIndex < allPhotos.length - 1) setPhotoViewerIndex(safeIndex + 1);
 if (diff < 0 && safeIndex > 0) setPhotoViewerIndex(safeIndex - 1);
 }
 };
 if (typeof document === 'undefined') return null;
 return ReactDOM.createPortal(
 <div
 className="fixed inset-0 z-[9999] bg-black flex flex-col"
 style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100dvh' }}
 onClick={() => setPhotoViewerOpen(false)}
 onTouchStart={handleSwipeStart}
 onTouchEnd={handleSwipeEnd}
 >
 <div className="flex items-center justify-between px-4 pt-4 pb-2" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
 <span className="text-white/70 text-sm font-bold">{safeIndex + 1} / {allPhotos.length}</span>
 <button onClick={(e) => { e.stopPropagation(); setPhotoViewerOpen(false); }} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
 <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
 </button>
 </div>
 <div className="flex-1 flex items-center justify-center px-2" onClick={(e) => e.stopPropagation()}>
 <img
 src={allPhotos[safeIndex]}
 alt={`${place.name} photo ${safeIndex + 1}`}
 className="max-w-full max-h-[80vh] object-contain select-none"
 draggable={false}
 />
 </div>
 {allPhotos.length > 1 && (
 <div className="flex items-center justify-center gap-4 pb-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
 <button
 onClick={(e) => { e.stopPropagation(); setPhotoViewerIndex(Math.max(0, safeIndex - 1)); }}
 disabled={safeIndex === 0}
 className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center disabled:opacity-30"
 >
 <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
 </button>
 <div className="flex gap-1.5 max-w-[200px] flex-wrap justify-center">
 {allPhotos.length <= 10 ? allPhotos.map((_, idx) => (
 <button
 key={idx}
 onClick={(e) => { e.stopPropagation(); setPhotoViewerIndex(idx); }}
 className={`w-2 h-2 rounded-full transition-all ${idx === safeIndex ? 'bg-white scale-125' : 'bg-white/30'}`}
 />
 )) : (
 <span className="text-white/50 text-xs font-bold">{safeIndex + 1} of {allPhotos.length}</span>
 )}
 </div>
 <button
 onClick={(e) => { e.stopPropagation(); setPhotoViewerIndex(Math.min(allPhotos.length - 1, safeIndex + 1)); }}
 disabled={safeIndex === allPhotos.length - 1}
 className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center disabled:opacity-30"
 >
 <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
 </button>
 </div>
 )}
 </div>,
 document.body
 );
 })()}

 <ReportContentModal
 isOpen={reportModalOpen}
 targetLabel="this review"
 submitting={reportSubmitting}
 onClose={() => {
 if (reportSubmitting) return;
 setReportModalOpen(false);
 setSelectedReviewReport(null);
 }}
 onSubmit={handleSubmitReviewReport}
 />
 </div>
 );
};

const TabBtn = ({ active, onClick, label }: any) => (
 <button 
 onClick={onClick}
 className={`px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${
 active ? 'bg-purple-500 text-white shadow-lg shadow-purple-100' : 'text-slate-400 bg-white shadow-sm'
 }`}
 >
 {label}
 </button>
);

const InfoTile = ({ label, value, icon }: any) => (
 <div className="bg-white p-5 rounded-[32px] shadow-sm border border-slate-50">
 <div className="flex items-center gap-2 mb-1">
 {icon}
 <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
 </div>
 <p className="text-sm font-black text-[#1E293B]">{value}</p>
 </div>
);

const ContactLink = ({ icon, label, value, link }: any) => (
 <div onClick={() => link && window.open(link, '_blank')} className="flex items-center gap-4 p-5 bg-white border border-slate-100 rounded-3xl cursor-pointer hover:bg-sky-50/50 transition-colors group">
 <div className="w-10 h-10 bg-slate-50 rounded-2xl flex items-center justify-center text-xl group-hover:bg-white transition-colors">
 {icon}
 </div>
 <div className="flex-1">
 <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{label}</p>
 <p className="text-sm font-black text-[#1E293B] leading-none">{value}</p>
 </div>
 <span className="text-slate-200 group-hover:text-purple-500 transition-colors">→</span>
 </div>
);

export default VenueProfile;

