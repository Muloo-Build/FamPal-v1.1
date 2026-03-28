import React from 'react';
import type { AccessibilityFeature, AccessibilityFeatureValue } from '../types/place';
import { ACCESSIBILITY_FEATURE_LABELS } from '../types/place';

interface AccessibilityBadgesProps {
  accessibility?: AccessibilityFeatureValue[];
  noConfirmedFallbackClass?: string;
}

const PRIORITY_FEATURES: AccessibilityFeature[] = [
  'step_free_entry',
  'accessible_toilet',
  'accessible_parking',
  'paved_paths',
  'ramp_access',
  'lift_available',
];

const AccessibilityBadges: React.FC<AccessibilityBadgesProps> = ({ accessibility, noConfirmedFallbackClass }) => {
  const fallbackClass = noConfirmedFallbackClass ?? 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500';

  if (!accessibility || accessibility.length === 0) {
    return (
      <span className={fallbackClass}>
        no confirmed accessibility info yet
      </span>
    );
  }

  const trueFeatures = PRIORITY_FEATURES.filter((feature) =>
    accessibility.some((item) => item.feature === feature && item.value === true && item.confidence !== 'unknown')
  );

  if (trueFeatures.length === 0) {
    return (
      <span className={fallbackClass}>
        no confirmed accessibility info yet
      </span>
    );
  }

  const visible = trueFeatures.slice(0, 2);
  const hiddenCount = trueFeatures.length - visible.length;

  return (
    <>
      {visible.map((feature) => (
        <span key={feature} className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">
          {ACCESSIBILITY_FEATURE_LABELS[feature]}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">
          +{hiddenCount}
        </span>
      )}
    </>
  );
};

export default AccessibilityBadges;
