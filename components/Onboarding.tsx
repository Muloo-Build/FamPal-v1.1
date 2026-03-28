import React, { useState, useCallback } from 'react';
import type { UserPreferences, Preferences, Child, ProfileInfo } from '../types';

interface OnboardingProps {
  userName?: string | null;
  initialProfileInfo?: ProfileInfo;
  initialUserPreferences?: UserPreferences;
  initialPreferences?: Preferences;
  initialChildren?: Child[];
  onComplete: (result: {
    profileInfo?: ProfileInfo | null;
    preferences?: Preferences | null;
    children?: Child[] | null;
    skipped: boolean;
  }) => void;
}

const getDefaultPreferences = (): Preferences => ({
  foodPreferences: [],
  allergies: [],
  accessibility: [],
  activityPreferences: [],
});

const STEP_GRADIENTS = [
  'from-purple-400 via-fuchsia-500 to-pink-500',
  'from-emerald-400 via-teal-500 to-cyan-600',
  'from-pink-400 via-rose-500 to-orange-400',
];

const CHILD_AGE_GROUPS = [
  { label: '0–2', min: 0, max: 2 },
  { label: '3–5', min: 3, max: 5 },
  { label: '6–9', min: 6, max: 9 },
  { label: '10–13', min: 10, max: 13 },
  { label: '14–17', min: 14, max: 17 },
];

const ACCESSIBILITY_OPTIONS = [
  { key: 'usesPushchair', label: 'Pram/pushchair' },
  { key: 'usesWheelchair', label: 'Wheelchair access' },
  { key: 'needsStepFree', label: 'Step-free paths' },
  { key: 'prefersPavedPaths', label: 'Quiet spaces' },
];

const Onboarding: React.FC<OnboardingProps> = ({
  userName,
  initialProfileInfo,
  initialUserPreferences,
  initialPreferences,
  initialChildren,
  onComplete,
}) => {
  const [step, setStep] = useState(0);
  const [profileName, setProfileName] = useState(initialProfileInfo?.displayName || userName || '');
  const [children, setChildren] = useState<Child[]>(initialChildren || []);
  const [accessibility, setAccessibility] = useState<Record<string, boolean>>({
    usesPushchair: false,
    usesWheelchair: false,
    needsStepFree: false,
    prefersPavedPaths: false,
    ...(initialPreferences?.accessibility?.reduce((acc, key) => ({ ...acc, [key]: true }), {}) || {}),
  });

  const totalSteps = 3;
  const isLastStep = step === totalSteps - 1;

  const handleSkip = () => {
    const result = buildResult(true);
    onComplete(result);
  };

  const handleNext = () => {
    if (isLastStep) {
      const result = buildResult(false);
      onComplete(result);
      return;
    }
    setStep((prev) => Math.min(prev + 1, totalSteps - 1));
  };

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 0));
  };

  const toggleAccessibility = (key: string) => {
    setAccessibility(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const addChildByAgeGroup = (ageGroup: { label: string; min: number; max: number }) => {
    const midAge = Math.floor((ageGroup.min + ageGroup.max) / 2);
    const newChild: Child = {
      id: Date.now().toString(),
      name: ageGroup.label,
      age: midAge,
    };
    setChildren(prev => [...prev, newChild]);
  };

  const removeChild = (id: string) => {
    setChildren(prev => prev.filter(c => c.id !== id));
  };

  const buildResult = (skipped: boolean) => {
    const trimmedName = profileName.trim();
    const profileInfo: ProfileInfo | null = trimmedName
      ? { displayName: trimmedName }
      : null;

    const accessibilityKeys = Object.entries(accessibility)
      .filter(([_, value]) => value)
      .map(([key, _]) => key);

    const preferences: Preferences = {
      ...getDefaultPreferences(),
      accessibility: accessibilityKeys,
    };

    return {
      profileInfo,
      preferences,
      children,
      skipped,
    };
  };

  return (
    <div className="min-h-screen bg-white flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        <div className="flex items-center gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === step
                  ? 'w-8 bg-gradient-to-r ' + STEP_GRADIENTS[step]
                  : i < step
                  ? 'w-4 bg-slate-300'
                  : 'w-4 bg-slate-200'
              }`}
            />
          ))}
        </div>
        <button onClick={handleSkip} className="text-xs font-semibold text-slate-400 active:text-slate-600 px-2 py-1">
          {step === totalSteps - 1 ? 'Skip' : 'Skip'}
        </button>
      </div>

      <div className="flex-1 flex flex-col" key={step}>
        {step === 0 && (
          <div className="flex-1 flex flex-col px-6 pt-4 pb-2 overflow-y-auto">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center mb-6 shadow-xl shadow-purple-200/50">
                <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </div>
              <h1 className="text-2xl font-black text-slate-900 mb-2">
                What's your name?
              </h1>
              <p className="text-sm text-slate-500 max-w-xs">
                We'll use this to personalise your experience.
              </p>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-4">
              <input
                type="text"
                placeholder="Your name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 text-base font-medium placeholder-slate-400 focus:outline-none focus:border-purple-400 focus:bg-purple-50"
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex-1 flex flex-col px-6 pt-4 pb-2 overflow-y-auto">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-600 flex items-center justify-center mb-6 shadow-xl shadow-emerald-200/50">
                <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
              </div>
              <h1 className="text-2xl font-black text-slate-900 mb-2">
                Do you have kids?
              </h1>
              <p className="text-sm text-slate-500 max-w-xs">
                Select their age groups so we can find family-friendly places.
              </p>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-4">
              <div className="grid grid-cols-2 gap-3">
                {CHILD_AGE_GROUPS.map(group => (
                  <button
                    key={group.label}
                    onClick={() => addChildByAgeGroup(group)}
                    className="py-4 px-3 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 font-bold text-sm hover:bg-emerald-100 active:scale-95 transition-all"
                  >
                    {group.label}
                  </button>
                ))}
              </div>

              {children.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Children added</p>
                  <div className="space-y-2">
                    {children.map(child => (
                      <div key={child.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2">
                        <span className="text-sm font-semibold text-slate-700">{child.name}</span>
                        <button
                          onClick={() => removeChild(child.id)}
                          className="text-rose-500 hover:text-rose-600 font-bold text-lg"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex-1 flex flex-col px-6 pt-4 pb-2 overflow-y-auto">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-pink-400 to-orange-400 flex items-center justify-center mb-6 shadow-xl shadow-pink-200/50">
                <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18.364 5.636l-3.536 3.536m9.172-9.172a2 2 0 11-2.828 2.828l-3.536-3.536m0 9.172l9.172-9.172M9.172 9.172L5.636 5.636m3.536 9.172l-3.536 3.536M5.636 5.636a2 2 0 110 2.828l3.536 3.536" /></svg>
              </div>
              <h1 className="text-2xl font-black text-slate-900 mb-2">
                Accessibility needs
              </h1>
              <p className="text-sm text-slate-500 max-w-xs">
                Help us find places that work for your family.
              </p>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-4">
              <div className="space-y-2">
                {ACCESSIBILITY_OPTIONS.map(option => (
                  <button
                    key={option.key}
                    onClick={() => toggleAccessibility(option.key)}
                    className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all active:scale-95 ${
                      accessibility[option.key]
                        ? 'bg-pink-500 text-white'
                        : 'bg-slate-100 text-slate-700 border-2 border-slate-200'
                    }`}
                  >
                    {accessibility[option.key] ? '✓ ' : ''}{option.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => toggleAccessibility('none')}
                className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all active:scale-95 ${
                  Object.values(accessibility).every(v => !v)
                    ? 'bg-slate-500 text-white'
                    : 'bg-slate-100 text-slate-700 border-2 border-dashed border-slate-300'
                }`}
              >
                None of these
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 pb-8 pt-4">
        <div className="flex items-center gap-3">
          {step > 0 && (
            <button
              onClick={handleBack}
              className="h-14 w-14 flex items-center justify-center rounded-2xl border-2 border-slate-200 active:scale-95 transition-all"
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="text-slate-500">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <button
            onClick={handleNext}
            className={`flex-1 h-14 rounded-2xl text-sm font-bold text-white active:scale-[0.98] transition-all shadow-lg bg-gradient-to-r ${STEP_GRADIENTS[step]}`}
          >
            {isLastStep ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
