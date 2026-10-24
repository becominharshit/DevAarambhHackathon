import React, { useState } from 'react';
import {
  Home,
  BookOpen,
  BarChart2,
  Search,
  Bell,
  LogIn,
  LogOut,
  Cloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  UserPlus,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import {
  CloudSyncState,
  ThemePreference,
  UserAuthProfile,
} from '../types/study';

export type NavTab = 'home' | 'study' | 'progress';

interface NavbarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenSearch: () => void;
  activeMaterialTitle?: string;
  user: UserAuthProfile | null;
  onSignIn: () => void;
  onSwitchAccount?: () => void;
  onSignOut: () => void;
  isAuthLoading?: boolean;
  cloudSyncState?: CloudSyncState;
  themePreference: ThemePreference;
  onChangeTheme: (theme: ThemePreference) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenSearch,
  activeMaterialTitle,
  user,
  onSignIn,
  onSwitchAccount,
  onSignOut,
  isAuthLoading = false,
  cloudSyncState,
  themePreference,
  onChangeTheme,
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const avatarInitial = user?.displayName
    ? user.displayName.charAt(0).toUpperCase()
    : user?.email
      ? user.email.charAt(0).toUpperCase()
      : 'G';

  const renderSyncBadge = () => {
    const status = cloudSyncState?.status || 'synced';
    if (status === 'syncing') {
      return (
        <div
          data-testid="cloud-sync-badge"
          className="flex items-center gap-1.5 text-[11px] font-semibold text-[#1967D2] bg-[#E8F0FE] px-2.5 py-1.5 rounded-lg"
        >
          <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
          <span>Syncing with Cloud Firestore...</span>
        </div>
      );
    }
    if (status === 'error') {
      return (
        <div
          data-testid="cloud-sync-badge"
          className="flex items-center gap-1.5 text-[11px] font-semibold text-[#B45309] bg-[#FEF3C7] px-2.5 py-1.5 rounded-lg"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {cloudSyncState?.errorMessage || 'Saved locally · Cloud sync pending'}
          </span>
        </div>
      );
    }
    return (
      <div
        data-testid="cloud-sync-badge"
        className="flex items-center gap-1.5 text-[11px] font-semibold text-[#15803D] bg-[#F1FAF4] px-2.5 py-1.5 rounded-lg"
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>Synced with Firebase Firestore</span>
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-30 w-full bg-white/95 backdrop-blur-md border-b border-slate-200/70">
      <div className="max-w-[1380px] mx-auto px-2.5 sm:px-8 h-16 flex items-center justify-between gap-1.5 sm:gap-4">
        {/* Brand Logo matching approved reference */}
        <button
          type="button"
          onClick={() => onSelectTab('home')}
          className="flex items-center gap-1.5 sm:gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4285F4] rounded-xl py-1 shrink-0 cursor-pointer"
          aria-label="LearnMate Home"
        >
          <svg
            width="28"
            height="26"
            viewBox="0 0 36 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="shrink-0 sm:w-[30px] sm:h-[28px]"
          >
            <path d="M18 3L31 9.5L18 16L5 9.5L18 3Z" fill="#4285F4" />
            <path
              d="M6 13.5C6 12.6716 6.67157 12 7.5 12H17V26.5C13.5 25 9.5 24.5 6 25V13.5Z"
              fill="#34A853"
            />
            <path
              d="M30 13.5C30 12.6716 29.3284 12 28.5 12H19V26.5C22.5 25 26.5 24.5 30 25V13.5Z"
              fill="#EA4335"
            />
            <path
              d="M5 25.5C10 24.2 15 25 18 27C21 25 26 24.2 31 25.5V27.5C26 26.3 21 27 18 29C15 27 10 26.3 5 27.5V25.5Z"
              fill="#FBBC05"
            />
          </svg>
          <span className="font-display text-base sm:text-[22px] font-bold tracking-tight whitespace-nowrap">
            <span className="text-[#172033]">Learn</span>
            <span className="text-[#4285F4]">Mate</span>
          </span>
        </button>

        {/* Primary Navigation Destinations: Home, Study, Progress */}
        <nav aria-label="Main Navigation" className="flex items-center gap-0.5 sm:gap-2">
          <button
            type="button"
            onClick={() => onSelectTab('home')}
            className={`flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'home'
                ? 'bg-[#E8F0FE] text-[#4285F4]'
                : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/80'
            }`}
          >
            <Home className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Home</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('study')}
            className={`flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'study'
                ? 'bg-[#E8F0FE] text-[#4285F4]'
                : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/80'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Study</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('progress')}
            className={`flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'progress'
                ? 'bg-[#E8F0FE] text-[#4285F4]'
                : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/80'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Progress</span>
          </button>
        </nav>

        {/* Right: Search Input Pill, Status Bell, and User Auth / Profile + Theme */}
        <div className="flex items-center gap-1 sm:gap-3 shrink-0 relative">
          {/* Desktop Search Pill matching Image 2 */}
          <button
            type="button"
            onClick={onOpenSearch}
            className="hidden md:flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-[#F4F7FC] hover:bg-[#EBF1FA] border border-slate-200/80 text-xs text-[#64748B] w-56 transition-colors cursor-pointer"
            aria-label="Search your study materials"
          >
            <Search className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
            <span className="truncate">Search your materials...</span>
          </button>

          {/* Mobile Search Icon */}
          <button
            type="button"
            onClick={onOpenSearch}
            className="md:hidden p-1.5 rounded-full text-[#64748B] hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Search study materials"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Notification / Active Material Indicator */}
          <button
            type="button"
            onClick={() => onSelectTab('study')}
            title={
              activeMaterialTitle
                ? `Currently studying: ${activeMaterialTitle}`
                : 'Open Study Dashboard'
            }
            aria-label="Active study session notification"
            className="hidden sm:flex relative p-2 rounded-full text-[#64748B] hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {activeMaterialTitle && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#EA4335] ring-2 ring-white" />
            )}
          </button>

          {/* Quick Sign In CTA when logged out */}
          {!user && (
            <button
              type="button"
              disabled={isAuthLoading}
              onClick={onSignIn}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-60 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{isAuthLoading ? 'Signing in...' : 'Sign in'}</span>
            </button>
          )}

          {/* Profile Avatar & Cloud Auth + Theme Menu */}
          <div className="relative">
            <button
              type="button"
              data-testid="navbar-profile-button"
              onClick={() => setShowProfileMenu((prev) => !prev)}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full bg-[#E8F0FE] text-[#1967D2] border border-[#BFDBFE] font-display font-bold text-xs hover:ring-2 hover:ring-[#4285F4]/30 transition-all cursor-pointer"
              aria-label="Account, theme, and cloud sync menu"
              title={
                user
                  ? `Signed in as ${user.displayName} (${user.email || user.uid})`
                  : 'Appearance & Cloud Sync Settings'
              }
            >
              <div className="w-7 h-7 rounded-full bg-white text-[#1967D2] flex items-center justify-center overflow-hidden shrink-0">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  avatarInitial
                )}
              </div>
              <span className="hidden sm:inline max-w-[110px] truncate text-[#172033]">
                {user ? user.displayName : 'Guest'}
              </span>
            </button>

            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-76 rounded-2xl bg-white shadow-xl border border-slate-200/90 p-4 z-50 space-y-3.5">
                {/* Appearance / Theme Switcher: Light | Dark | System */}
                <div className="space-y-1.5 pb-3 border-b border-slate-100">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    Appearance Theme
                  </span>
                  <div
                    role="group"
                    aria-label="Theme preference"
                    className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#F4F7FC] border border-slate-200/80"
                  >
                    {(
                      [
                        { id: 'light', label: 'Light', Icon: Sun },
                        { id: 'dark', label: 'Dark', Icon: Moon },
                        { id: 'system', label: 'System', Icon: Monitor },
                      ] as const
                    ).map(({ id, label, Icon }) => {
                      const active = themePreference === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onChangeTheme(id)}
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            active
                              ? 'bg-white text-[#4285F4] shadow-xs'
                              : 'text-[#64748B] hover:text-[#172033]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {user ? (
                  <>
                    <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-100">
                      <div className="w-9 h-9 rounded-full bg-[#E8F0FE] text-[#1967D2] font-bold flex items-center justify-center text-sm shrink-0">
                        {avatarInitial}
                      </div>
                      <div className="min-w-0">
                        <p
                          data-testid="active-user-name"
                          className="text-xs font-bold text-[#172033] truncate"
                        >
                          {user.displayName}
                        </p>
                        <p
                          data-testid="active-user-email"
                          className="text-[11px] text-[#64748B] truncate"
                        >
                          {user.email || 'Private Student Account'}
                        </p>
                      </div>
                    </div>

                    {renderSyncBadge()}

                    <button
                      type="button"
                      onClick={() => {
                        setShowProfileMenu(false);
                        onSelectTab('progress');
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-[#172033] hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      View Learning Progress &amp; PDF Report
                    </button>

                    {onSwitchAccount && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowProfileMenu(false);
                          onSwitchAccount();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#1967D2] hover:bg-[#E8F0FE]/60 transition-colors cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Switch Google Account</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setShowProfileMenu(false);
                        onSignOut();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#EA4335] hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#172033]">
                        <Cloud className="w-4 h-4 text-[#4285F4]" />
                        <span>Private Student Workspace</span>
                      </div>
                      <p className="text-[11px] text-[#64748B] leading-relaxed">
                        Sign in with Google so your uploaded materials, quizzes, sticky notes, and revision plans are isolated and saved to your private account.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isAuthLoading}
                      onClick={() => {
                        setShowProfileMenu(false);
                        onSignIn();
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#4285F4] hover:bg-[#2563EB] text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>{isAuthLoading ? 'Signing in...' : 'Sign in with Google'}</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
