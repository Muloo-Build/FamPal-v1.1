import React, { useState } from 'react';
import {
  signInWithGoogle,
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

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
      setLoading(false);
    }
  };

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
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 text-slate-800 font-semibold py-3.5 px-4 rounded-2xl shadow-sm active:scale-95 transition-all disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

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
