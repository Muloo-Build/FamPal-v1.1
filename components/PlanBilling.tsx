import { useEffect, useMemo, useState } from 'react';
import { AppState, PLAN_LIMITS, GOOGLE_PLAY_SUBSCRIPTION_URL } from '../types';
import { canUseAI, getPlanDisplayName, isPaidTier } from '../lib/entitlements';
import { getPlayProductIds, getPlayProducts, isPlayBillingAvailable, purchasePlaySubscription, syncPlayEntitlementWithServer } from '../lib/playBilling';
import { PremiumWaitlist } from '../src/components/PremiumWaitlist';

interface PlanBillingProps {
 state: AppState;
 onClose: () => void;
 onUpdateState: <K extends keyof AppState>(key: K, value: AppState[K]) => void;
}

export default function PlanBilling({ state, onClose, onUpdateState }: PlanBillingProps) {
 const entitlement = state.entitlement;
 const aiInfo = canUseAI(entitlement, state.familyPool);
 const aiUsed = entitlement?.gemini_credits_used ?? entitlement?.ai_requests_this_month ?? 0;
 const currentTier = entitlement?.subscription_tier || entitlement?.plan_tier || 'free';
 const isPaid = isPaidTier(entitlement);
 const [isNativeBillingAvailable, setIsNativeBillingAvailable] = useState(false);
 const [productPrice, setProductPrice] = useState<string | null>(null);
 const [selectedProductId, setSelectedProductId] = useState<string>(getPlayProductIds()[0] || 'fampal_pro_monthly');
 const [showWaitlist, setShowWaitlist] = useState(false);
 const [selectedOfferToken, setSelectedOfferToken] = useState<string | undefined>(undefined);
 const [busy, setBusy] = useState(false);
 const [syncMessage, setSyncMessage] = useState<string | null>(null);

 const statusLabel = useMemo(() => {
 if (currentTier === 'admin') return 'Admin tester access';
 if (entitlement?.subscription_status === 'pending') return 'Subscription pending confirmation';
 if (entitlement?.subscription_status === 'grace_period') return 'Payment issue: grace period active';
 if (entitlement?.subscription_status === 'billing_retry') return 'Payment retry needed in Google Play';
 if (entitlement?.subscription_status === 'cancelled_active') return 'Cancelled, still active until period end';
 if (currentTier === 'pro' || currentTier === 'family' || currentTier === 'lifetime') return 'Pro monthly entitlement';
 return 'Free tier';
 }, [currentTier, entitlement?.subscription_status]);

 const handleUpgradeToPlayStore = () => {
 window.open(GOOGLE_PLAY_SUBSCRIPTION_URL, '_blank', 'noopener,noreferrer');
 };

 useEffect(() => {
 (async () => {
 const available = await isPlayBillingAvailable();
 setIsNativeBillingAvailable(available);
 if (!available) return;
 const products = await getPlayProducts();
 const selected = products.find((product) => getPlayProductIds().includes(product.productId)) || products[0];
 if (!selected) return;
 setSelectedProductId(selected.productId);
 setSelectedOfferToken(selected.offerToken || selected.offers?.[0]?.offerToken);
 const firstOffer = selected.offers?.[0];
 setProductPrice(firstOffer?.formattedPrice || null);
 })();
 }, []);

 const syncEntitlement = async (messagePrefix: string) => {
 setBusy(true);
 setSyncMessage(null);
 try {
 const sync = await syncPlayEntitlementWithServer();
 if (sync?.entitlement) {
 onUpdateState('entitlement', sync.entitlement);
 }
 setSyncMessage(`${messagePrefix} complete.`);
 } catch (err: any) {
 setSyncMessage(err?.message || `${messagePrefix} failed.`);
 } finally {
 setBusy(false);
 }
 };

 const handleUpgrade = async () => {
 if (!isNativeBillingAvailable) {
 handleUpgradeToPlayStore();
 return;
 }
 setBusy(true);
 setSyncMessage(null);
 try {
 await purchasePlaySubscription(selectedProductId, selectedOfferToken);
 await syncEntitlement('Subscription sync');
 } catch (err: any) {
 setSyncMessage(err?.message || 'Purchase failed.');
 } finally {
 setBusy(false);
 }
 };

 return (
 <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
 <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto">
 <div className="sticky top-0 bg-white p-4 border-b border-slate-100 flex items-center justify-between">
 <h2 className="font-bold text-lg text-slate-800 ">Plans</h2>
 <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center" aria-label="Close plans">
 <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
 </button>
 </div>

 <div className="p-5 space-y-5">
 <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-2xl p-5 border border-purple-100 ">
 <h3 className="font-bold text-slate-800 ">{getPlanDisplayName(entitlement?.plan_tier || 'free')} Plan</h3>
 <p className="text-xs text-slate-500 mt-1">{statusLabel}</p>
 <div className="mt-4 pt-4 border-t border-purple-100 space-y-2 text-sm">
 <div className="flex justify-between">
 <span className="text-slate-600 ">Smart insights this month</span>
 <span className="font-semibold text-slate-800 ">{aiUsed} / {aiInfo.limit === -1 ? 'Unlimited' : aiInfo.limit}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-600 ">Remaining</span>
 <span className="font-semibold text-slate-800 ">{aiInfo.limit === -1 ? 'Unlimited' : aiInfo.remaining}</span>
 </div>
 </div>
 </div>

 <div className="bg-white border border-slate-200 rounded-2xl p-5">
 <h4 className="font-bold text-slate-800 ">Free</h4>
 <p className="text-xs text-slate-500 mt-1">Great for getting started.</p>
 <ul className="mt-3 space-y-2 text-sm text-slate-600 ">
 <li className="flex items-center gap-2">
 <svg className="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
 {PLAN_LIMITS.free.aiRequestsPerMonth} smart insights per month
 </li>
 <li className="flex items-center gap-2">
 <svg className="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
 Save up to {PLAN_LIMITS.free.savedPlaces} places
 </li>
 <li className="flex items-center gap-2">
 <svg className="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
 {PLAN_LIMITS.free.circles} Friend Circle
 </li>
 <li className="flex items-center gap-2">
 <svg className="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
 Browse and discover places
 </li>
 </ul>
 </div>

 <div className="bg-gradient-to-br from-purple-50 via-fuchsia-50 to-pink-50 border-2 border-purple-200 rounded-2xl p-5 relative overflow-hidden">
 <div className="absolute top-3 right-3 bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full">BEST VALUE</div>
 <h4 className="font-bold text-slate-800 ">Pro</h4>
 <p className="text-xs text-slate-500 mt-1">Unlock everything. Less than a coffee.</p>
 <ul className="mt-3 space-y-2 text-sm text-slate-600 ">
 <li className="flex items-center gap-2">
 <svg className="w-4 h-4 text-purple-500 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
 {PLAN_LIMITS.pro.aiRequestsPerMonth} smart insights per month
 </li>
 <li className="flex items-center gap-2">
 <svg className="w-4 h-4 text-purple-500 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
 Unlimited saved places
 </li>
 <li className="flex items-center gap-2">
 <svg className="w-4 h-4 text-purple-500 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
 Unlimited circles and memories
 </li>
 <li className="flex items-center gap-2">
 <svg className="w-4 h-4 text-purple-500 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
 Unlimited partner favourites
 </li>
 </ul>
 {isPaid ? (
 <p className="mt-4 text-xs font-semibold text-emerald-700 ">Pro is active on this account.</p>
 ) : (
 <div className="mt-4 space-y-2">
 {showWaitlist && <PremiumWaitlist onClose={() => setShowWaitlist(false)} />}
 <button
 onClick={() => setShowWaitlist(true)}
 className="w-full py-3.5 bg-[#0052ff] text-white rounded-full font-bold text-sm shadow-[0_4px_20px_rgba(0,82,255,0.28)] active:scale-[0.98] transition-all"
 >
 Join the Premium waitlist
 </button>
 <button
 onClick={() => syncEntitlement('Restore purchases')}
 disabled={busy}
 className="w-full py-2.5 bg-white/70 border border-purple-200 text-purple-700 rounded-xl font-semibold text-xs disabled:opacity-60"
 >
 Restore / Sync purchases
 </button>
 {syncMessage && (
 <p className="text-[11px] text-purple-700 ">{syncMessage}</p>
 )}
 </div>
 )}
 </div>

 <p className="text-xs text-slate-400 text-center">Subscriptions are managed through Google Play Store. Cancel anytime.</p>
 </div>
 </div>
 </div>
 );
}
