import React from 'react';
import {
  ShieldCheck,
  Sparkles,
  BookOpen,
  ClipboardCheck,
  BarChart2,
  LogIn,
  ArrowLeft,
  AlertCircle,
  Loader2,
  Lock,
} from 'lucide-react';

interface AuthGateViewProps {
  onSignIn: () => void;
  onBackToHome: () => void;
  isAuthLoading?: boolean;
  authError?: string | null;
  featureContext?: string;
}

export const AuthGateView: React.FC<AuthGateViewProps> = ({
  onSignIn,
  onBackToHome,
  isAuthLoading = false,
  authError,
  featureContext = 'your personal study workspace',
}) => {
  return (
    <div className="relative overflow-hidden min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      {/* Ambient Google 4-color background aura */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-24 top-20 w-80 h-80 rounded-full bg-gradient-to-tr from-[#4285F4]/18 via-[#34A853]/14 to-transparent blur-3xl" />
        <div className="absolute -right-24 bottom-16 w-80 h-80 rounded-full bg-gradient-to-bl from-[#EA4335]/16 via-[#FBBC05]/16 to-transparent blur-3xl" />
      </div>

      <div className="relative z-10 max-w-xl w-full bg-white rounded-[28px] border border-slate-200/90 shadow-[0_24px_60px_-15px_rgba(30,64,175,0.14)] p-6 sm:p-10 space-y-6">
        {/* Top Badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E8F0FE] text-[#1967D2] text-xs font-semibold">
            <Lock className="w-3.5 h-3.5" />
            <span>Private Student Workspace</span>
          </div>
          <button
            type="button"
            onClick={onBackToHome}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#64748B] hover:text-[#172033] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Public Home</span>
          </button>
        </div>

        {/* Heading & Copy */}
        <div className="space-y-2.5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#172033] tracking-tight">
            Sign in to access{' '}
            <span className="text-[#4285F4]">{featureContext}</span>
          </h1>
          <p className="text-sm text-[#64748B] leading-relaxed">
            LearnMate keeps every student&apos;s uploaded PDFs, AI Tutor conversations, diagnostic quizzes, Mistake DNA, flashcards, and progress isolated under your own Google account.
          </p>
        </div>

        {/* Feature Isolation Highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-[#F3F7FE] border border-[#E3ECFA] p-3.5 space-y-1.5">
            <div className="w-8 h-8 rounded-xl bg-[#DCE8FC] text-[#4285F4] flex items-center justify-center">
              <BookOpen className="w-4 h-4" />
            </div>
            <p className="font-display font-bold text-xs text-[#172033]">
              Isolated Materials
            </p>
            <p className="text-[11px] text-[#64748B] leading-snug">
              Your PDFs, notes, and YouTube lectures are private to your UID.
            </p>
          </div>

          <div className="rounded-2xl bg-[#FDF3F2] border border-[#F9E0DE] p-3.5 space-y-1.5">
            <div className="w-8 h-8 rounded-xl bg-[#FCDAD7] text-[#EA4335] flex items-center justify-center">
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <p className="font-display font-bold text-xs text-[#172033]">
              Personal Quizzes
            </p>
            <p className="text-[11px] text-[#64748B] leading-snug">
              Diagnostic scores, Mistake DNA, and revision tasks stay in your account.
            </p>
          </div>

          <div className="rounded-2xl bg-[#F1FAF4] border border-[#DCF2E3] p-3.5 space-y-1.5">
            <div className="w-8 h-8 rounded-xl bg-[#D1F2DC] text-[#34A853] flex items-center justify-center">
              <BarChart2 className="w-4 h-4" />
            </div>
            <p className="font-display font-bold text-xs text-[#172033]">
              Cloud Synced
            </p>
            <p className="text-[11px] text-[#64748B] leading-snug">
              Sign in from any device to resume your exact study history.
            </p>
          </div>
        </div>

        {authError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-[#DC2626]"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        {/* Primary Google Sign-In CTA */}
        <div className="space-y-3 pt-1">
          <button
            type="button"
            disabled={isAuthLoading}
            onClick={onSignIn}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-full bg-gradient-to-b from-[#4285F4] to-[#1D6AE5] hover:from-[#2563EB] hover:to-[#1D4ED8] text-white font-display font-semibold text-sm shadow-[0_10px_25px_rgba(66,133,244,0.32)] transition-all disabled:opacity-60 cursor-pointer"
          >
            {isAuthLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Connecting to Google...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign in with Google to Get Started</span>
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-2 text-[11px] text-[#64748B]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#34A853] shrink-0" />
            <span>
              Protected by Firebase Authentication &amp; per-user Firestore Security Rules
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
