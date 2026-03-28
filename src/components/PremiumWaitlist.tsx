import React, { useState } from 'react';
import { Sparkles, Check, X } from 'lucide-react';

interface PremiumWaitlistProps {
  onClose: () => void;
}

const PREMIUM_FEATURES = [
  'Unlimited AI-powered search',
  'Unlimited saved places',
  'Multiple Circles',
  'Personalised family recommendations',
  'Early access to new features',
];

export const PremiumWaitlist: React.FC<PremiumWaitlistProps> = ({ onClose }) => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const upgradeUrl = import.meta.env.VITE_UPGRADE_URL;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);

    if (upgradeUrl) {
      window.open(`${upgradeUrl}?email=${encodeURIComponent(email)}`, '_blank');
      setSubmitted(true);
    } else {
      // Fallback: mailto waitlist
      window.location.href = `mailto:hello@fampal.co.za?subject=FamPal Premium Waitlist&body=Please add me to the FamPal Premium waitlist.%0A%0AEmail: ${encodeURIComponent(email)}`;
      setSubmitted(true);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-t-[28px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[rgba(24,0,82,0.12)]" />
        </div>

        <div className="px-6 pb-10 pt-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[#0052ff]/10 flex items-center justify-center">
                  <Sparkles size={16} className="text-[#0052ff]" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#0052ff]">FamPal Premium</span>
              </div>
              <h2 className="text-2xl font-bold text-[#180052]">
                {submitted ? 'You\'re on the list!' : 'Unlock the full experience'}
              </h2>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-[#f3faff] flex items-center justify-center">
              <X size={18} className="text-[#180052]" />
            </button>
          </div>

          {submitted ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <Check size={28} className="text-green-500" />
              </div>
              <p className="text-[#4a5568] text-sm leading-relaxed">We'll let you know as soon as Premium launches. Thanks for being an early supporter of FamPal.</p>
              <button onClick={onClose} className="mt-6 bg-[#0052ff] text-white font-bold rounded-full px-8 py-3 text-sm shadow-[0_4px_20px_rgba(0,82,255,0.28)] active:scale-95 transition-all">
                Back to exploring
              </button>
            </div>
          ) : (
            <>
              {/* Feature list */}
              <div className="space-y-3 mb-6">
                {PREMIUM_FEATURES.map(f => (
                  <div key={f} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[#0052ff]/10 flex items-center justify-center shrink-0">
                      <Check size={12} className="text-[#0052ff]" strokeWidth={3} />
                    </div>
                    <span className="text-sm font-medium text-[#180052]">{f}</span>
                  </div>
                ))}
              </div>

              {/* Price teaser */}
              <div className="bg-[#f3faff] rounded-[20px] p-4 mb-6 text-center">
                <p className="text-xs text-[#4a5568] mb-1">Launching soon at</p>
                <p className="text-3xl font-bold text-[#180052]">R49<span className="text-sm font-normal text-[#4a5568]">/month</span></p>
                <p className="text-xs text-[#4a5568] mt-1">Join the waitlist for a founding member discount</p>
              </div>

              {/* Email form */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-5 py-3.5 rounded-full bg-[#f3faff] border border-[rgba(0,82,255,0.12)] text-sm text-[#180052] placeholder-[#94a3b8] outline-none focus:border-[#0052ff] transition-colors"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0052ff] text-white font-bold rounded-full py-3.5 text-sm shadow-[0_4px_20px_rgba(0,82,255,0.28)] active:scale-95 transition-all disabled:opacity-60"
                >
                  {loading ? 'Joining...' : 'Join the waitlist'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
