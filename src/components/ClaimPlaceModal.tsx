import React, { useState } from 'react';
import { submitPlaceClaim } from '../../lib/placeOwner';
import type { Place } from '../../types';

interface ClaimPlaceModalProps {
 place: Place;
 onClose: () => void;
 onSuccess: () => void;
}

export default function ClaimPlaceModal({ place, onClose, onSuccess }: ClaimPlaceModalProps) {
 const [businessRole, setBusinessRole] = useState('');
 const [businessEmail, setBusinessEmail] = useState('');
 const [description, setDescription] = useState('');
 const [isAuthorised, setIsAuthorised] = useState(false);
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState('');

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!businessRole || !businessEmail || !description || !isAuthorised) {
 setError('Please fill in all required fields');
 return;
 }
 setSubmitting(true);
 setError('');
 try {
 await submitPlaceClaim({
 placeId: place.id,
 placeName: place.name,
 businessRole,
 businessEmail,
 verificationMethod: 'email',
 verificationEvidence: description,
 });
 onSuccess();
 } catch (err: any) {
 setError(err.message || 'Failed to submit claim');
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center">
 <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
 <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-[28px] sm:rounded-2xl shadow-2xl" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
 {/* Handle */}
 <div className="flex justify-center pt-3 pb-1">
 <div className="w-10 h-1 rounded-full bg-[rgba(24,0,82,0.12)]" />
 </div>

 <div className="px-6 pt-4 pb-6 space-y-4">
 <div className="flex items-center justify-between mb-4">
 <h2 className="text-xl font-bold text-[#180052]">Claim This Place</h2>
 <button onClick={onClose} className="w-9 h-9 rounded-full bg-[#f3faff] flex items-center justify-center">
 <svg className="w-5 h-5 text-[#180052]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
 </button>
 </div>

 {error && (
 <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">
 {error}
 </div>
 )}

 <form onSubmit={handleSubmit} className="space-y-4">
 <div>
 <label className="block text-xs font-black uppercase tracking-widest text-[#0052ff] mb-2">
 Your Role
 </label>
 <select
 value={businessRole}
 onChange={(e) => setBusinessRole(e.target.value)}
 className="w-full px-4 py-3 rounded-[16px] border border-[rgba(24,0,82,0.08)] bg-[#f3faff] text-[#180052] text-sm focus:outline-none focus:border-[#0052ff]"
 required
 >
 <option value="">Select your role...</option>
 <option value="owner">Owner</option>
 <option value="manager">Manager</option>
 <option value="marketing">Marketing Manager</option>
 </select>
 </div>

 <div>
 <label className="block text-xs font-black uppercase tracking-widest text-[#0052ff] mb-2">
 Business Email
 </label>
 <input
 type="email"
 value={businessEmail}
 onChange={(e) => setBusinessEmail(e.target.value)}
 placeholder="info@yourbusiness.co.za"
 className="w-full px-4 py-3 rounded-[16px] border border-[rgba(24,0,82,0.08)] bg-[#f3faff] text-[#180052] text-sm focus:outline-none focus:border-[#0052ff]"
 required
 />
 </div>

 <div>
 <label className="block text-xs font-black uppercase tracking-widest text-[#0052ff] mb-2">
 Brief Description (280 chars max)
 </label>
 <textarea
 value={description}
 onChange={(e) => setDescription(e.target.value.slice(0, 280))}
 placeholder="Tell us about your venue and how you're connected to it..."
 rows={3}
 className="w-full px-4 py-3 rounded-[16px] border border-[rgba(24,0,82,0.08)] bg-[#f3faff] text-[#180052] text-sm focus:outline-none focus:border-[#0052ff] resize-none"
 required
 />
 <p className="text-xs text-[#4a5568] mt-1">{description.length}/280</p>
 </div>

 <label className="flex items-center gap-3 py-3">
 <input
 type="checkbox"
 checked={isAuthorised}
 onChange={(e) => setIsAuthorised(e.target.checked)}
 className="w-5 h-5 accent-[#0052ff]"
 required
 />
 <span className="text-xs text-[#4a5568]">I confirm I am authorised to manage this listing</span>
 </label>

 <button
 type="submit"
 disabled={submitting || !businessRole || !businessEmail || !description || !isAuthorised}
 className="w-full py-3.5 px-4 rounded-full font-bold text-white bg-[#0052ff] shadow-[0_4px_20px_rgba(0,82,255,0.28)] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
 >
 {submitting ? 'Submitting...' : 'Submit Claim'}
 </button>
 </form>
 </div>
 </div>
 </div>
 );
}
