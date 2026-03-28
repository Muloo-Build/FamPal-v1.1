import React, { useState, useEffect } from 'react';
import { updateOwnerContent, initBusinessPayment, fetchPlaceOwnerInfo } from '../../lib/placeOwner';
import { getTemplateForType, BUSINESS_PRO_FEATURES, BUSINESS_PRO_PRICE } from '../types/placeOwner';
import type { OwnerContent, OwnerTier, OperatingHours, SpecialOffer, PlaceEvent } from '../types/placeOwner';
import type { Place } from '../../types';

interface OwnerDashboardProps {
  place: Place;
  userId: string;
  userEmail: string;
  onClose: () => void;
  onContentUpdated?: (content: OwnerContent) => void;
}

export default function OwnerDashboard({ place, userId, userEmail, onClose, onContentUpdated }: OwnerDashboardProps) {
  const [content, setContent] = useState<OwnerContent>(place.ownerContent || {});
  const [tier, setTier] = useState<OwnerTier>(place.ownerTier || 'free');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const template = getTemplateForType(place.type);

  useEffect(() => {
    fetchPlaceOwnerInfo(place.id).then(info => {
      if (info.ownerContent) setContent(info.ownerContent);
      if (info.ownerTier) setTier(info.ownerTier as OwnerTier);
      setLoadFailed(false);
    }).catch(() => {
      setLoadFailed(true);
    });
  }, [place.id]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await updateOwnerContent(place.id, content);
      setContent(result.ownerContent);
      onContentUpdated?.(result.ownerContent);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      const result = await initBusinessPayment(place.id, userEmail);
      window.location.href = result.authorization_url;
    } catch (err: any) {
      setError(err.message || 'Payment failed');
      setUpgrading(false);
    }
  };

  const updateField = <K extends keyof OwnerContent>(key: K, value: OwnerContent[K]) => {
    setContent(prev => ({ ...prev, [key]: value }));
  };

  const updateHours = (day: keyof OperatingHours, value: string) => {
    setContent(prev => ({
      ...prev,
      operatingHours: { ...prev.operatingHours, [day]: value },
    }));
  };

  const addOffer = () => {
    const offers = content.specialOffers || [];
    updateField('specialOffers', [
      ...offers,
      { id: Date.now().toString(), title: '', description: '', isActive: true },
    ]);
  };

  const removeOffer = (id: string) => {
    updateField('specialOffers', (content.specialOffers || []).filter(o => o.id !== id));
  };

  const updateOffer = (id: string, field: keyof SpecialOffer, value: any) => {
    updateField('specialOffers', (content.specialOffers || []).map(o =>
      o.id === id ? { ...o, [field]: value } : o
    ));
  };

  const addEvent = () => {
    const events = content.events || [];
    updateField('events', [
      ...events,
      { id: Date.now().toString(), title: '', description: '', date: '', isRecurring: false },
    ]);
  };

  const removeEvent = (id: string) => {
    updateField('events', (content.events || []).filter(e => e.id !== id));
  };

  const updateEvent = (id: string, field: keyof PlaceEvent, value: any) => {
    updateField('events', (content.events || []).map(e =>
      e.id === id ? { ...e, [field]: value } : e
    ));
  };

  const renderSection = (section: (typeof template.sections)[0]) => {
    if (section.proOnly && tier !== 'business_pro') {
      return (
        <div key={section.key} className="relative">
          <div className="opacity-50 pointer-events-none">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {section.label}
            </label>
            <div className="h-10 bg-gray-100 rounded-lg" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full shadow-lg">
              Business Pro
            </span>
          </div>
        </div>
      );
    }

    switch (section.type) {
      case 'text':
        return (
          <div key={section.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{section.label}</label>
            {section.description && <p className="text-xs text-gray-500 mb-1">{section.description}</p>}
            <input
              type="text"
              value={(content[section.key] as string) || ''}
              onChange={e => updateField(section.key, e.target.value as any)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        );

      case 'textarea':
        return (
          <div key={section.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{section.label}</label>
            {section.description && <p className="text-xs text-gray-500 mb-1">{section.description}</p>}
            <textarea
              value={(content[section.key] as string) || ''}
              onChange={e => updateField(section.key, e.target.value as any)}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
        );

      case 'boolean':
        return (
          <div key={section.key} className="flex items-center justify-between py-2">
            <label className="text-sm font-medium text-gray-700">{section.label}</label>
            <button
              type="button"
              onClick={() => updateField(section.key, !content[section.key] as any)}
              className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${content[section.key] ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${content[section.key] ? 'translate-x-5.5 ml-0.5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        );

      case 'hours':
        return (
          <div key={section.key}>
            <label className="block text-sm font-medium text-gray-700 mb-2">{section.label}</label>
            <div className="space-y-2">
              {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'publicHolidays'] as const).map(day => (
                <div key={day} className="flex items-center gap-2">
                  <span className="w-28 text-xs text-gray-600 capitalize">{day === 'publicHolidays' ? 'Public Hols' : day}</span>
                  <input
                    type="text"
                    value={content.operatingHours?.[day] || ''}
                    onChange={e => updateHours(day, e.target.value)}
                    placeholder="e.g. 08:00 - 17:00"
                    className="flex-1 px-2 py-1.5 rounded border border-gray-300 bg-white text-gray-900 text-xs focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>
        );

      case 'list':
        return (
          <div key={section.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{section.label}</label>
            {section.description && <p className="text-xs text-gray-500 mb-1">{section.description}</p>}
            <div className="flex flex-wrap gap-2 mb-2">
              {((content[section.key] as string[]) || []).map((item, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                  {item}
                  <button
                    type="button"
                    onClick={() => {
                      const list = [...((content[section.key] as string[]) || [])];
                      list.splice(i, 1);
                      updateField(section.key, list as any);
                    }}
                    className="hover:text-red-600"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add item..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      updateField(section.key, [...((content[section.key] as string[]) || []), val] as any);
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        );

      case 'offers':
        return (
          <div key={section.key}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">{section.label}</label>
              <button type="button" onClick={addOffer} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Offer</button>
            </div>
            <div className="space-y-3">
              {(content.specialOffers || []).map(offer => (
                <div key={offer.id} className="p-3 border border-gray-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      value={offer.title}
                      onChange={e => updateOffer(offer.id, 'title', e.target.value)}
                      placeholder="Offer title"
                      className="flex-1 px-2 py-1.5 rounded border border-gray-300 bg-white text-gray-900 text-xs"
                    />
                    <button type="button" onClick={() => removeOffer(offer.id)} className="ml-2 text-red-500 hover:text-red-700 text-xs">Remove</button>
                  </div>
                  <textarea
                    value={offer.description}
                    onChange={e => updateOffer(offer.id, 'description', e.target.value)}
                    placeholder="Describe the offer..."
                    rows={2}
                    className="w-full px-2 py-1.5 rounded border border-gray-300 bg-white text-gray-900 text-xs resize-none"
                  />
                  <div className="flex gap-2">
                    <input type="date" value={offer.validFrom || ''} onChange={e => updateOffer(offer.id, 'validFrom', e.target.value)} className="flex-1 px-2 py-1 rounded border border-gray-300 bg-white text-xs text-gray-900" />
                    <input type="date" value={offer.validUntil || ''} onChange={e => updateOffer(offer.id, 'validUntil', e.target.value)} className="flex-1 px-2 py-1 rounded border border-gray-300 bg-white text-xs text-gray-900" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'events':
        return (
          <div key={section.key}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">{section.label}</label>
              <button type="button" onClick={addEvent} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Event</button>
            </div>
            <div className="space-y-3">
              {(content.events || []).map(event => (
                <div key={event.id} className="p-3 border border-gray-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      value={event.title}
                      onChange={e => updateEvent(event.id, 'title', e.target.value)}
                      placeholder="Event title"
                      className="flex-1 px-2 py-1.5 rounded border border-gray-300 bg-white text-gray-900 text-xs"
                    />
                    <button type="button" onClick={() => removeEvent(event.id)} className="ml-2 text-red-500 hover:text-red-700 text-xs">Remove</button>
                  </div>
                  <textarea
                    value={event.description}
                    onChange={e => updateEvent(event.id, 'description', e.target.value)}
                    placeholder="Describe the event..."
                    rows={2}
                    className="w-full px-2 py-1.5 rounded border border-gray-300 bg-white text-gray-900 text-xs resize-none"
                  />
                  <div className="flex gap-2">
                    <input type="date" value={event.date} onChange={e => updateEvent(event.id, 'date', e.target.value)} className="flex-1 px-2 py-1 rounded border border-gray-300 bg-white text-xs text-gray-900" />
                    <input type="time" value={event.time || ''} onChange={e => updateEvent(event.id, 'time', e.target.value)} className="flex-1 px-2 py-1 rounded border border-gray-300 bg-white text-xs text-gray-900" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'social':
        return (
          <div key={section.key}>
            <label className="block text-sm font-medium text-gray-700 mb-2">{section.label}</label>
            <div className="space-y-2">
              {(['facebook', 'instagram', 'tiktok', 'website'] as const).map(platform => (
                <div key={platform} className="flex items-center gap-2">
                  <span className="w-20 text-xs text-gray-600 capitalize">{platform}</span>
                  <input
                    type="url"
                    value={content.socialMedia?.[platform] || ''}
                    onChange={e => setContent(prev => ({
                      ...prev,
                      socialMedia: { ...prev.socialMedia, [platform]: e.target.value },
                    }))}
                    placeholder={`https://${platform}.com/...`}
                    className="flex-1 px-2 py-1.5 rounded border border-gray-300 bg-white text-gray-900 text-xs focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>
        );

      case 'photos':
        return (
          <div key={section.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{section.label}</label>
            <p className="text-xs text-gray-500">Photo uploads coming soon. For now, contact us to add photos.</p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
        <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Manage Place</h2>
              <p className="text-sm text-gray-500">{place.name}</p>
            </div>
            <div className="flex items-center gap-2">
              {tier === 'business_pro' && (
                <span className="px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full">PRO</span>
              )}
              <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100:bg-gray-800 text-gray-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              {template.label}
            </span>
            {tier === 'free' && (
              <button onClick={() => setShowUpgrade(true)} className="px-2.5 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full hover:shadow-lg transition-shadow">
                Upgrade to Pro
              </button>
            )}
          </div>
        </div>

        <div className="px-6 py-4 space-y-5">
          {loadFailed && (
            <div className="p-3 bg-amber-50 text-amber-700 text-sm rounded-lg">Could not load latest data from server. Showing cached data — saving will overwrite.</div>
          )}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
          )}
          {saved && (
            <div className="p-3 bg-green-50 text-green-700 text-sm rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Changes saved successfully
            </div>
          )}

          {template.sections.map(section => renderSection(section))}

          <div className="pt-4 border-t border-gray-200">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-lg"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Saving...
                </span>
              ) : 'Save Changes'}
            </button>
          </div>
        </div>

        {showUpgrade && (
          <div className="absolute inset-0 bg-white z-20 overflow-y-auto rounded-2xl">
            <div className="px-6 pt-5 pb-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">Upgrade to Business Pro</h3>
                <button onClick={() => setShowUpgrade(false)} className="p-2 rounded-full hover:bg-gray-100:bg-gray-800 text-gray-500">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-5 mb-4">
                <div className="text-center mb-4">
                  <span className="text-3xl font-extrabold text-gray-900">{BUSINESS_PRO_PRICE.label}</span>
                </div>
                <ul className="space-y-2">
                  {BUSINESS_PRO_FEATURES.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-700">
                      <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={handleUpgrade}
                disabled={upgrading}
                className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 transition-all shadow-lg"
              >
                {upgrading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Processing...
                  </span>
                ) : `Upgrade for ${BUSINESS_PRO_PRICE.label}`}
              </button>

              <p className="text-xs text-gray-500 text-center mt-3">
                Cancel anytime. Billed monthly via Paystack.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
