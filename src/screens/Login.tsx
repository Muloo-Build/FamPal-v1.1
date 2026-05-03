import React, { useState, useEffect, useRef } from 'react';
import {
  renderGoogleSignInButton,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  auth,
} from '../../lib/firebase';
import { MapPin, Mail, Lock, Eye, EyeOff, ArrowRight, User } from 'lucide-react';

interface Props {
  onGuest: () => void;
}

type Mode = 'welcome' | 'signin' | 'signup' | 'reset';

export default function LoginScreen({ onGuest }: Props) {
  const [mode, setMode] = useState<Mode>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Render Google's official button into the ref div — reliable on all browsers
  useEffect(() => {
    if (mode !== 'welcome') return;

    const tryRender = () => {
      const container = googleBtnRef.current;
      if (!container) return false;
      const g = (window as any).google;
      if (!g?.accounts?.id) return false;

      // Clear any previous render
      container.innerHTML = '';

      renderGoogleSignInButton(
        container,
        () => {
          // onSuccess — auth state will update via onAuthStateChanged
        },
        (err) => {
          setError(err.message || 'Google sign-in failed');
        },
      );
      return true;
    };

    // Try immediately; if Google script not ready yet, poll until it is
    if (!tryRender()) {
      const interval = setInterval(() => {
        if (tryRender()) clearInterval(interval);
      }, 200);
      return () => clearInterval(interval);
    }
  }, [mode]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      const code = err.message || '';
      if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
        setError('Invalid email or password.');
      } else {
        setError(err.message || 'Sign in failed.');
      }
      setLoading(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setError('');
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('email-already-in-use')) {
        setError('An account with this email already exists.');
      } else {
        setError(err.message || 'Sign up failed.');
      }
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-16 pb-8">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-2xl mb-4 shadow-lg shadow-teal-500/25">
            <MapPin size={28} className="text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">FamPals</h1>
          <p className="text-slate-500 mt-1.5 text-base">Family adventures, made easy</p>
        </div>

        {mode === 'welcome' && (
          <div className="w-full max-w-sm space-y-3 animate-fade-in">
            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            {/* Google Sign-In — rendered by Google Identity Services SDK */}
            <div className="flex justify-center">
              <div
                ref={googleBtnRef}
                style={{ minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              />
            </div>

            <button
              onClick={() => setMode('signin')}
              className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white font-semibold py-3.5 px-4 rounded-2xl shadow-lg shadow-teal-500/25 active:scale-95 transition-all"
            >
              <Mail size={18} />
              Continue with Email
            </button>

            <div className="relative flex items-center py-1">
              <div className="flex-1 border-t border-slate-200" />
              <span className="px-3 text-sm text-slate-400">or</span>
              <div className="flex-1 border-t border-slate-200" />
            </div>

            <button
              onClick={onGuest}
              className="w-full text-slate-500 font-medium py-3 text-sm active:text-slate-700 transition-colors"
            >
              Browse as guest
            </button>
          </div>
        )}

        {mode === 'signin' && (
          <form onSubmit={handleEmailSignIn} className="w-full max-w-sm space-y-3 animate-fade-in">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Sign in</h2>
            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}
            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-11 pr-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
              />
            </div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-11 pr-12 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white font-semibold py-3.5 rounded-2xl shadow-lg shadow-teal-500/25 active:scale-95 transition-all disabled:opacity-60"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>Sign in <ArrowRight size={18} /></>}
            </button>
            <div className="flex justify-between text-sm">
              <button type="button" onClick={() => { setMode('reset'); setError(''); }} className="text-teal-600 font-medium">Forgot password?</button>
              <button type="button" onClick={() => { setMode('signup'); setError(''); }} className="text-slate-500">Create account</button>
            </div>
            <button type="button" onClick={() => { setMode('welcome'); setError(''); }} className="w-full text-slate-400 text-sm pt-1">← Back</button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleEmailSignUp} className="w-full max-w-sm space-y-3 animate-fade-in">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Create account</h2>
            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}
            <div className="relative">
              <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-11 pr-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
              />
            </div>
            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-11 pr-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
              />
            </div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password (min 6 chars)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-11 pr-12 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white font-semibold py-3.5 rounded-2xl shadow-lg shadow-teal-500/25 active:scale-95 transition-all disabled:opacity-60"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>Create account <ArrowRight size={18} /></>}
            </button>
            <button type="button" onClick={() => { setMode('signin'); setError(''); }} className="w-full text-slate-500 text-sm">Already have an account? Sign in</button>
            <button type="button" onClick={() => { setMode('welcome'); setError(''); }} className="w-full text-slate-400 text-sm">← Back</button>
          </form>
        )}

        {mode === 'reset' && (
          <div className="w-full max-w-sm animate-fade-in">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Reset password</h2>
            <p className="text-slate-500 text-sm mb-4">We'll send a reset link to your email.</p>
            {resetSent ? (
              <div className="bg-teal-50 border border-teal-100 text-teal-700 px-4 py-3 rounded-xl text-sm">
                Reset email sent! Check your inbox.
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-3">
                {error && <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">{error}</div>}
                <div className="relative">
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-11 pr-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-teal-600 text-white font-semibold py-3.5 rounded-2xl shadow-lg shadow-teal-500/25 active:scale-95 transition-all disabled:opacity-60"
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>
            )}
            <button type="button" onClick={() => { setMode('signin'); setError(''); setResetSent(false); }} className="mt-4 w-full text-slate-400 text-sm">← Back to sign in</button>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-slate-400 pb-8 px-6">
        By continuing, you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}
