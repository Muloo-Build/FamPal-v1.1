import React, { useEffect, useState } from 'react';
import { 
  AccessibilityFeatureValue, 
  FamilyFacilityValue, 
  PetFriendlyFeatureValue,
  ACCESSIBILITY_FEATURE_LABELS,
  FAMILY_FACILITY_LABELS,
  PET_FRIENDLY_FEATURE_LABELS
} from '../types/place';
import type { AccessibilityFeature, FamilyFacility, PetFriendlyFeature } from '../types/place';

interface EditPlaceInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  confirmedAccessibility?: AccessibilityFeatureValue[];
  confirmedFamily?: FamilyFacilityValue[];
  confirmedPets?: PetFriendlyFeatureValue[];
  onSubmit: (payload: {
    accessibility: AccessibilityFeatureValue[];
    family: FamilyFacilityValue[];
    pets: PetFriendlyFeatureValue[];
  }) => Promise<void> | void;
}

const ALL_FAMILY_FEATURES: FamilyFacility[] = [
  'playground', 'baby_changing_table', 'stroller_friendly', 'high_chairs',
  'kids_menu', 'family_restroom', 'nursing_room', 'child_friendly_space'
];

const ALL_ACCESSIBILITY_FEATURES: AccessibilityFeature[] = [
  'step_free_entry', 'ramp_access', 'lift_available', 'wide_doorways',
  'paved_paths', 'smooth_surface', 'accessible_toilet', 'accessible_parking',
  'seating_available', 'table_service_space'
];

const ALL_PET_FEATURES: PetFriendlyFeature[] = [
  'dogs_allowed', 'cats_allowed', 'pet_friendly_patio', 'water_bowls',
  'off_leash_area', 'pet_menu', 'shaded_pet_area', 'pet_waste_stations', 'enclosed_garden'
];

export const EditPlaceInfoModal: React.FC<EditPlaceInfoModalProps> = ({
  isOpen,
  onClose,
  confirmedAccessibility = [],
  confirmedFamily = [],
  confirmedPets = [],
  onSubmit,
}) => {
  const [selectedFamily, setSelectedFamily] = useState<Record<string, boolean>>({});
  const [selectedAccessibility, setSelectedAccessibility] = useState<Record<string, boolean>>({});
  const [selectedPets, setSelectedPets] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // Pre-fill
      const f: Record<string, boolean> = {};
      confirmedFamily.forEach(c => { if (c.value) f[c.feature] = true; });
      setSelectedFamily(f);

      const a: Record<string, boolean> = {};
      confirmedAccessibility.forEach(c => { if (c.value) a[c.feature] = true; });
      setSelectedAccessibility(a);

      const p: Record<string, boolean> = {};
      confirmedPets.forEach(c => { if (c.value) p[c.feature] = true; });
      setSelectedPets(p);
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => { document.body.style.overflow = 'auto'; };
  }, [isOpen, confirmedFamily, confirmedAccessibility, confirmedPets]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const familyFeatures = Object.entries(selectedFamily)
        .filter(([, val]) => val)
        .map(([feature]) => ({
          feature: feature as FamilyFacility,
          value: true,
          confidence: 'reported' as const,
          updatedAt: new Date().toISOString()
        }));

      const accessibilityFeatures = Object.entries(selectedAccessibility)
        .filter(([, val]) => val)
        .map(([feature]) => ({
          feature: feature as AccessibilityFeature,
          value: true,
          confidence: 'reported' as const,
          updatedAt: new Date().toISOString()
        }));

      const petFeatures = Object.entries(selectedPets)
        .filter(([, val]) => val)
        .map(([feature]) => ({
          feature: feature as PetFriendlyFeature,
          value: true,
          confidence: 'reported' as const,
          updatedAt: new Date().toISOString()
        }));

      await onSubmit({
        family: familyFeatures,
        accessibility: accessibilityFeatures,
        pets: petFeatures
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl max-h-[90vh] flex flex-col shadow-2xl animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-shrink-0 px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Improve Information</h2>
            <p className="text-sm text-slate-500">Help other families by confirming what's here.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          <section>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-4">Family Facilities</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALL_FAMILY_FEATURES.map(feat => (
                <label key={feat} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    checked={!!selectedFamily[feat]}
                    onChange={(e) => setSelectedFamily(prev => ({...prev, [feat]: e.target.checked}))}
                  />
                  <span className="text-sm font-medium text-slate-700">{FAMILY_FACILITY_LABELS[feat]}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-4">Accessibility</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALL_ACCESSIBILITY_FEATURES.map(feat => (
                <label key={feat} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    checked={!!selectedAccessibility[feat]}
                    onChange={(e) => setSelectedAccessibility(prev => ({...prev, [feat]: e.target.checked}))}
                  />
                  <span className="text-sm font-medium text-slate-700">{ACCESSIBILITY_FEATURE_LABELS[feat]}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-4">Pet Friendly</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALL_PET_FEATURES.map(feat => (
                <label key={feat} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    checked={!!selectedPets[feat]}
                    onChange={(e) => setSelectedPets(prev => ({...prev, [feat]: e.target.checked}))}
                  />
                  <span className="text-sm font-medium text-slate-700">{PET_FRIENDLY_FEATURE_LABELS[feat]}</span>
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="flex-shrink-0 px-6 py-5 border-t border-slate-100 bg-slate-50 rounded-b-3xl">
          <button 
            type="button" 
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full fp-btn-primary py-3.5 justify-center rounded-xl"
          >
            {submitting ? 'Saving...' : 'Save Contributions'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditPlaceInfoModal;
