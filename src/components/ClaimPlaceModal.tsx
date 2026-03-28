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
 const [businessPhone, setBusinessPhone] = useState('');
 const [verificationEvidence, setVerificationEvidence] = useState('');
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState('');

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!businessRole || !verificationEvidence) {
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
 businessEmail: businessEmail || undefined,
 businessPhone: businessPhone || undefined,
 verificationMethod: 'manual',
 verificationEvidence,
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
 <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
 <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
 <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-3 border-b border-gray-100 ">
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-bold text-gray-900 ">Claim This Place</h2>
 <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
 </button>
 </div>
 <p className="text-sm text-gray-500 mt-1">
 Claim ownership of <span className="font-medium text-gray-700 ">{place.name}</span> to manage its profile on FamPals.
 </p>
 </div>

 <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
 {error && (
 <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">
 {error}
 </div>
 )}

 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Your Role <span className="text-red-500">*</span>
 </label>
 <select
 value={businessRole}
 onChange={(e) => setBusinessRole(e.target.value)}
 className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
 >
 <option value="">Select your role...</option>
 <option value="owner">Owner</option>
 <option value="manager">Manager</option>
 <option value="marketing">Marketing / Social Media Manager</option>
 <option value="authorized_rep">Authorised Representative</option>
 </select>
 </div>

 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Business Email
 </label>
 <input
 type="email"
 value={businessEmail}
 onChange={(e) => setBusinessEmail(e.target.value)}
 placeholder="info@yourbusiness.co.za"
 className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
 />
 </div>

 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Business Phone
 </label>
 <input
 type="tel"
 value={businessPhone}
 onChange={(e) => setBusinessPhone(e.target.value)}
 placeholder="+27 12 345 6789"
 className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
 />
 </div>

 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 How can we verify you? <span className="text-red-500">*</span>
 </label>
 <textarea
 value={verificationEvidence}
 onChange={(e) => setVerificationEvidence(e.target.value)}
 placeholder="Please describe how we can verify your connection to this business. For example: your business email matches the website domain, you can provide a CIPC registration document, you are listed as a contact on Google Maps, etc."
 rows={4}
 className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
 />
 </div>

 <div className="bg-blue-50 rounded-lg p-3">
 <h4 className="text-sm font-medium text-blue-800 mb-1">What happens next?</h4>
 <ul className="text-xs text-blue-700 space-y-1">
 <li>1. We'll review your claim (usually within 24-48 hours)</li>
 <li>2. We may contact you for additional verification</li>
 <li>3. Once verified, you can manage your place's profile</li>
 <li>4. Optional: Upgrade to Business Pro for premium features</li>
 </ul>
 </div>

 <button
 type="submit"
 disabled={submitting || !businessRole || !verificationEvidence}
 className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
 >
 {submitting ? (
 <span className="flex items-center justify-center gap-2">
 <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
 Submitting...
 </span>
 ) : 'Submit Claim'}
 </button>
 </form>
 </div>
 </div>
 );
}
