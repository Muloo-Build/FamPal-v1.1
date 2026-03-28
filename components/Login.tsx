import React, { useState } from 'react';
import Logo from './Logo';

type LoginProps = {
  onLogin: () => Promise<void>;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (email: string, password: string, displayName: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<boolean | undefined>;
  onGuestLogin: () => void;
  error: string | null;
};

type AuthMode = 'main' | 'email-signin' | 'email-signup' | 'forgot-password';

const Login: React.FC<LoginProps> = ({ onLogin, onEmailSignIn, onEmailSignUp, onForgotPassword, onGuestLogin, error }) => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('main');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleGoogleLogin = () => {
    setIsLoggingIn(true);
    onLogin().finally(() => setIsLoggingIn(false));
  };

  const handleEmailSignIn = async () => {
    if (!email.trim()) { setLocalError('Please enter your email.'); return; }
    if (!password) { setLocalError('Please enter your password.'); return; }
    setLocalError(null);
    setIsLoggingIn(true);
    await onEmailSignIn(email.trim(), password);
    setIsLoggingIn(false);
  };

  const handleEmailSignUp = async () => {
    if (!displayName.trim()) { setLocalError('Please enter your name.'); return; }
    if (!email.trim()) { setLocalError('Please enter your email.'); return; }
    if (!password) { setLocalError('Please enter a password.'); return; }
    if (password.length < 6) { setLocalError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setLocalError('Passwords do not match.'); return; }
    setLocalError(null);
    setIsLoggingIn(true);
    await onEmailSignUp(email.trim(), password, displayName.trim());
    setIsLoggingIn(false);
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setLocalError('Please enter your email address.'); return; }
    setLocalError(null);
    setIsLoggingIn(true);
    const success = await onForgotPassword(email.trim());
    setIsLoggingIn(false);
    if (success) setResetSent(true);
  };

  const switchMode = (mode: AuthMode) => {
    setAuthMode(mode);
    setLocalError(null);
    setResetSent(false);
    setShowPassword(false);
  };

  const clearErrors = () => { if (localError) setLocalError(null); };
  const displayError = localError || error;
  const inputClass = 'stitch-input w-full h-14 px-4 placeholder:text-slate-400 transition-colors text-sm';
  const primaryBtnClass = 'stitch-pill-button w-full h-14 font-bold flex items-center justify-center gap-3 active:scale-95 transition-all text-sm disabled:opacity-50';
  const secondaryBtnClass = 'stitch-pill-button-secondary w-full h-14 font-bold active:scale-95 transition-all text-sm hover:bg-white/90';

  return (
    <div className="min-h-screen w-full stitch-shell flex items-center justify-center px-5 py-8 relative overflow-hidden">
      <div className="stitch-hero-orb top-[-4rem] right-[-2rem] h-44 w-44 bg-[#ffb04d]/60"></div>
      <div className="stitch-hero-orb bottom-[-5rem] left-[-2rem] h-56 w-56 bg-[#5b88ff]/35"></div>
      <div className="w-full max-w-md relative z-10">
        <div className="stitch-card-soft overflow-hidden p-5 sm:p-7">
          <div className="rounded-[2rem] bg-[linear-gradient(135deg,#003ec7_0%,#0052ff_58%,#2f74ff_100%)] px-5 py-6 text-white relative overflow-hidden">
            <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/12"></div>
            <div className="absolute right-8 bottom-[-1.75rem] h-20 w-20 rounded-full bg-[#ff8c00]/30"></div>
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-[1.25rem] bg-white/12 p-2.5 backdrop-blur-sm">
                <Logo size={42} variant="light" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.32em] text-white/70 font-bold">Modern Family Concierge</p>
                <h1 className="text-[2rem] font-black tracking-[-0.04em] leading-none">FamPal</h1>
              </div>
            </div>
            <p className="max-w-xs text-sm leading-6 text-white/88 font-medium">
              Discover thoughtful family venues with an airy, editorial guide built for weekends that actually work.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-semibold">Discovery-first</span>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-semibold">Kid & pet friendly</span>
              <span className="rounded-full bg-[#ff8c00]/22 px-3 py-1 text-[11px] font-semibold">Curated for parents</span>
            </div>
          </div>

          <div className="pt-6">
            <div className="mb-5">
              <p className="text-[11px] uppercase tracking-[0.26em] text-slate-400 font-bold">Welcome Back</p>
              <p className="mt-2 stitch-muted text-sm leading-6">
                Sign in to sync saved places, partner plans, circles and family preferences across devices.
              </p>
            </div>

            <div className="w-full space-y-3 relative z-10">
              {displayError && (
                <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700 shadow-[0_12px_24px_rgba(239,68,68,0.08)]" role="alert">
                  <span>{displayError}</span>
                </div>
              )}

              {authMode === 'main' && (
                <>
                  <button onClick={handleGoogleLogin} disabled={isLoggingIn} className={primaryBtnClass}>
                    {isLoggingIn ? 'Signing in...' : (
                      <>
                        <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="" />
                        Sign in with Google
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-slate-200"></div>
                    <span className="text-slate-400 text-xs font-semibold uppercase tracking-[0.24em]">or</span>
                    <div className="flex-1 h-px bg-slate-200"></div>
                  </div>

                  <button onClick={() => switchMode('email-signin')} className={secondaryBtnClass}>
                    <svg className="w-4 h-4 inline mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>
                    Sign in with Email
                  </button>

                  <button onClick={() => switchMode('email-signup')} className="w-full text-slate-500 text-xs font-medium py-2 hover:text-[#0052FF] transition-colors">
                    Don't have an account? <span className="underline font-bold text-[#180052]">Create one</span>
                  </button>

                  <button onClick={onGuestLogin} className="w-full text-slate-400 text-[11px] font-medium py-1 hover:text-slate-600 transition-colors">
                    Continue as Guest
                  </button>
                </>
              )}

              {authMode === 'email-signin' && (
                <>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={e => { setEmail(e.target.value); clearErrors(); }}
                    className={inputClass}
                    autoComplete="email"
                    autoFocus
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Password"
                      value={password}
                      onChange={e => { setPassword(e.target.value); clearErrors(); }}
                      className={inputClass}
                      autoComplete="current-password"
                      onKeyDown={e => e.key === 'Enter' && handleEmailSignIn()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                    >
                      {showPassword ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>

                  <button onClick={handleEmailSignIn} disabled={isLoggingIn} className={primaryBtnClass}>
                    {isLoggingIn ? 'Signing in...' : 'Sign In'}
                  </button>

                  <div className="flex justify-between items-center">
                    <button onClick={() => switchMode('forgot-password')} className="text-slate-500 text-xs hover:text-[#0052FF] transition-colors">
                      Forgot password?
                    </button>
                    <button onClick={() => switchMode('email-signup')} className="text-slate-500 text-xs hover:text-[#0052FF] transition-colors">
                      Create account
                    </button>
                  </div>

                  <button onClick={() => switchMode('main')} className="w-full text-slate-500 text-xs font-medium py-2 hover:text-[#0052FF] transition-colors flex items-center justify-center gap-1">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Back to login options
                  </button>
                </>
              )}

              {authMode === 'email-signup' && (
                <>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={displayName}
                    onChange={e => { setDisplayName(e.target.value); clearErrors(); }}
                    className={inputClass}
                    autoComplete="name"
                    autoFocus
                  />
                  <input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={e => { setEmail(e.target.value); clearErrors(); }}
                    className={inputClass}
                    autoComplete="email"
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Password (min 6 characters)"
                      value={password}
                      onChange={e => { setPassword(e.target.value); clearErrors(); }}
                      className={inputClass}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                    >
                      {showPassword ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); clearErrors(); }}
                    className={inputClass}
                    autoComplete="new-password"
                    onKeyDown={e => e.key === 'Enter' && handleEmailSignUp()}
                  />

                  <button onClick={handleEmailSignUp} disabled={isLoggingIn} className={primaryBtnClass}>
                    {isLoggingIn ? 'Creating account...' : 'Create Account'}
                  </button>

                  <button onClick={() => switchMode('email-signin')} className="w-full text-slate-500 text-xs font-medium py-2 hover:text-[#0052FF] transition-colors">
                    Already have an account? <span className="underline font-bold text-[#180052]">Sign in</span>
                  </button>

                  <button onClick={() => switchMode('main')} className="w-full text-slate-500 text-xs font-medium py-1 hover:text-[#0052FF] transition-colors flex items-center justify-center gap-1">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Back to login options
                  </button>
                </>
              )}

              {authMode === 'forgot-password' && (
                <>
                  {resetSent ? (
                    <div className="rounded-2xl bg-emerald-50 px-4 py-4 text-sm text-center text-emerald-700">
                      <p className="font-bold mb-1">Reset email sent!</p>
                      <p className="text-xs">Check your inbox for a password reset link.</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-slate-500 text-sm text-center mb-1">
                        Enter your email and we'll send you a link to reset your password.
                      </p>
                      <input
                        type="email"
                        placeholder="Email address"
                        value={email}
                        onChange={e => { setEmail(e.target.value); clearErrors(); }}
                        className={inputClass}
                        autoComplete="email"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleForgotPassword()}
                      />
                      <button onClick={handleForgotPassword} disabled={isLoggingIn} className={primaryBtnClass}>
                        {isLoggingIn ? 'Sending...' : 'Send Reset Link'}
                      </button>
                    </>
                  )}

                  <button onClick={() => switchMode('email-signin')} className="w-full text-slate-500 text-xs font-medium py-2 hover:text-[#0052FF] transition-colors flex items-center justify-center gap-1">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Back to sign in
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="absolute bottom-6 text-slate-400 text-[9px] font-black uppercase tracking-[0.3em]">
        Kinship Modern Discovery
      </p>
    </div>
  );
};

export default Login;
