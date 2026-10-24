import React, { useEffect, useState } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { HomeView, StudySubTab } from './components/HomeView';
import { StudyView } from './components/StudyView';
import { ProgressView } from './components/ProgressView';
import { AuthGateView } from './components/AuthGateView';
import {
  createOptionalSampleMaterial,
  storageService,
} from './services/storageService';
import { cancelAllClientRequests } from './services/aiClient';
import {
  signInWithGoogle,
  signOutUser,
  subscribeToAuthChanges,
  subscribeToCloudAttempts,
} from './services/firebaseService';
import {
  CloudSyncState,
  LegacyBackupSummary,
  QuizAttempt,
  StudyMaterial,
  ThemePreference,
  UserAuthProfile,
} from './types/study';
import {
  FileText,
  Search,
  X,
  ArrowRight,
  Loader2,
  BookOpen,
  PlusCircle,
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activeSubTab, setActiveSubTab] = useState<StudySubTab>('tutor');
  const [materials, setMaterials] = useState<StudyMaterial[]>(() =>
    storageService.getMaterials()
  );
  const [activeMaterialId, setActiveMaterialId] = useState<string>(() => {
    const savedId = storageService.getActiveMaterialId();
    const list = storageService.getMaterials();
    return savedId || list[0]?.id || '';
  });
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>(() =>
    storageService.getQuizAttempts()
  );

  // Theme preference (Light | Dark | System)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    storageService.getThemePreference()
  );

  // Firebase Auth state (single reactive source of truth via onAuthStateChanged)
  const [user, setUser] = useState<UserAuthProfile | null>(null);
  const [isAuthInitializing, setIsAuthInitializing] = useState(true);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSessionVersion, setAuthSessionVersion] = useState(0);

  // Real cloud sync state & quarantined legacy data summary
  const [cloudSyncState, setCloudSyncState] = useState<CloudSyncState>(() =>
    storageService.getSyncState()
  );
  const [legacyBackupSummary, setLegacyBackupSummary] =
    useState<LegacyBackupSummary>(() =>
      storageService.getLegacyBackupSummary()
    );

  // Quick search modal state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      setActiveTab('study');
    }
  }, []);

  useEffect(() => {
    return storageService.subscribeToSyncState((state) => {
      setCloudSyncState(state);
    });
  }, []);

  // Apply theme preference and listen to OS system dark mode changes
  useEffect(() => {
    const applyThemeToDocument = (pref: ThemePreference) => {
      if (typeof document === 'undefined') return;
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = pref === 'dark' || (pref === 'system' && prefersDark);
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    };

    applyThemeToDocument(themePreference);
    if (themePreference !== 'system' || typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      applyThemeToDocument('system');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themePreference]);

  const handleChangeTheme = (pref: ThemePreference) => {
    setThemePreference(pref);
    storageService.saveThemePreference(pref);
  };

  // Subscribe to Firebase Auth & sync with Cloud Firestore reactively (no page reload needed)
  useEffect(() => {
    let unsubCloudAttempts: (() => void) | null = null;
    let isMounted = true;

    const unsubAuth = subscribeToAuthChanges(async (authUser) => {
      if (!isMounted) return;

      // 1. Always tear down previous user's Firestore listener first
      if (unsubCloudAttempts) {
        unsubCloudAttempts();
        unsubCloudAttempts = null;
      }

      // 2. Cancel any in-flight AI client requests from the previous session
      cancelAllClientRequests();

      // 3. Clear React state immediately before loading next user's workspace to prevent old account data flashing
      setMaterials([]);
      setActiveMaterialId('');
      setQuizAttempts([]);
      setUser(authUser);
      setAuthError(null);

      if (authUser) {
        try {
          await storageService.syncWithCloudUser(authUser);
          if (!isMounted) return;
          const nextMaterials = storageService.getMaterials();
          const nextActiveId =
            storageService.getActiveMaterialId() || nextMaterials[0]?.id || '';
          setMaterials(nextMaterials);
          setActiveMaterialId(nextActiveId);
          setQuizAttempts(storageService.getQuizAttempts());
          setThemePreference(storageService.getThemePreference());
          setLegacyBackupSummary(storageService.getLegacyBackupSummary());
          setAuthSessionVersion((v) => v + 1);

          unsubCloudAttempts = subscribeToCloudAttempts(
            authUser.uid,
            (cloudAttempts) => {
              if (!isMounted) return;
              setQuizAttempts(cloudAttempts);
            }
          );
        } catch (err) {
          console.warn('Cloud sync warning:', err);
        } finally {
          if (isMounted) setIsAuthInitializing(false);
        }
      } else {
        await storageService.syncWithCloudUser(null);
        if (!isMounted) return;
        setMaterials([]);
        setActiveMaterialId('');
        setQuizAttempts([]);
        setLegacyBackupSummary(storageService.getLegacyBackupSummary());
        setAuthSessionVersion((v) => v + 1);
        setIsAuthInitializing(false);
      }
    });

    return () => {
      isMounted = false;
      unsubAuth();
      if (unsubCloudAttempts) unsubCloudAttempts();
    };
  }, []);

  const handleSignIn = async () => {
    if (isAuthLoading) return;
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      const code = String(err?.code || '');
      if (!code.includes('popup-closed-by-user')) {
        setAuthError(
          err?.message || 'Unable to complete Google Sign-In. Please try again.'
        );
      }
      console.warn('Google sign-in closed or unavailable:', err);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (isAuthLoading) return;
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      cancelAllClientRequests();
      await signOutUser();
      setActiveTab('home');
    } catch (err) {
      console.warn('Sign-out error:', err);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleImportLegacyData = async () => {
    const result = await storageService.importQuarantinedLegacyDataToCurrentUser();
    if (result.importedMaterials > 0 || result.importedAttempts > 0) {
      const nextMaterials = storageService.getMaterials();
      setMaterials(nextMaterials);
      setActiveMaterialId(
        storageService.getActiveMaterialId() || nextMaterials[0]?.id || ''
      );
      setQuizAttempts(storageService.getQuizAttempts());
      setAuthSessionVersion((v) => v + 1);
    }
    setLegacyBackupSummary(storageService.getLegacyBackupSummary());
  };

  const handleDismissLegacyData = () => {
    storageService.dismissQuarantinedLegacyData();
    setLegacyBackupSummary(storageService.getLegacyBackupSummary());
  };

  const activeMaterial =
    materials.find((m) => m.id === activeMaterialId) || materials[0];

  const handleMaterialReady = (
    material: StudyMaterial,
    initialSubTab: StudySubTab = 'tutor'
  ) => {
    if (!user) {
      setActiveTab('study');
      return;
    }
    const updatedMaterial: StudyMaterial = {
      ...material,
      ownerId: user.uid,
      lastStudiedAt: 'Just now',
    };
    storageService.saveMaterial(updatedMaterial);
    setMaterials(storageService.getMaterials());
    setActiveMaterialId(updatedMaterial.id);
    setActiveSubTab(initialSubTab);
    setActiveTab('study');
  };

  const handleSelectMaterialInStudy = (material: StudyMaterial) => {
    storageService.setActiveMaterialId(material.id);
    setActiveMaterialId(material.id);
  };

  const handleNavigateFeature = (
    target: 'tutor' | 'quiz' | 'mistakes' | 'progress'
  ) => {
    if (target === 'progress') {
      setActiveTab('progress');
      return;
    }
    setActiveSubTab(target);
    setActiveTab('study');
  };

  const refreshAttempts = () => {
    setQuizAttempts(storageService.getQuizAttempts());
  };

  const handleClearHistory = () => {
    storageService.clearProgressData();
    setQuizAttempts([]);
    setAuthSessionVersion((v) => v + 1);
  };

  const matchingSearchMaterials = materials.filter(
    (m) =>
      m.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
      m.pages.some((p) =>
        p.content.toLowerCase().includes(searchFilter.toLowerCase())
      )
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#FBFCFF] text-[#172033] transition-colors">
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenSearch={() => {
          setSearchFilter('');
          setIsSearchOpen(true);
        }}
        activeMaterialTitle={activeMaterial?.title}
        user={user}
        onSignIn={handleSignIn}
        onSwitchAccount={handleSignIn}
        onSignOut={handleSignOut}
        isAuthLoading={isAuthLoading || isAuthInitializing}
        cloudSyncState={cloudSyncState}
        themePreference={themePreference}
        onChangeTheme={handleChangeTheme}
      />

      <main className="flex-1">
        {activeTab === 'home' && (
          <HomeView
            materials={materials}
            activeMaterial={activeMaterial}
            onMaterialReady={handleMaterialReady}
            onNavigateFeature={handleNavigateFeature}
            user={user}
            onSignIn={handleSignIn}
            legacyBackupSummary={legacyBackupSummary}
            onImportLegacyData={handleImportLegacyData}
            onDismissLegacyData={handleDismissLegacyData}
          />
        )}

        {activeTab !== 'home' && isAuthInitializing && (
          <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center p-8 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-[#4285F4] animate-spin" />
            <p className="font-display font-bold text-base text-[#172033]">
              Verifying your private student session...
            </p>
            <p className="text-xs text-[#64748B]">
              Loading your isolated Firebase workspace
            </p>
          </div>
        )}

        {activeTab !== 'home' && !isAuthInitializing && !user && (
          <AuthGateView
            onSignIn={handleSignIn}
            onBackToHome={() => setActiveTab('home')}
            isAuthLoading={isAuthLoading}
            authError={authError}
            featureContext={
              activeTab === 'progress'
                ? 'your learning progress & quiz history'
                : 'your private AI study workspace'
            }
          />
        )}

        {activeTab === 'study' && !isAuthInitializing && user && !activeMaterial && (
          <div
            data-testid="study-empty-workspace"
            className="max-w-xl mx-auto px-4 py-16 text-center space-y-5"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#E8F0FE] text-[#4285F4] flex items-center justify-center mx-auto">
              <BookOpen className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-bold text-[#172033]">
                Welcome, {user.displayName}! Your study workspace is ready.
              </h1>
              <p className="text-sm text-[#64748B] leading-relaxed">
                You don&apos;t have any study materials in your account yet. Upload a PDF, paste lecture notes, or import a YouTube lecture to begin.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('home')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-semibold text-sm shadow-sm transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>Upload or Paste Study Material</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const sample = createOptionalSampleMaterial();
                  handleMaterialReady(sample, 'tutor');
                }}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1967D2] font-display font-semibold text-sm transition-colors cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Load Sample Probability Chapter</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'study' && !isAuthInitializing && user && activeMaterial && (
          <StudyView
            key={`study_session_${user.uid}_${authSessionVersion}`}
            materials={materials}
            activeMaterial={activeMaterial}
            activeSubTab={activeSubTab}
            onChangeSubTab={setActiveSubTab}
            onSelectMaterial={handleSelectMaterialInStudy}
            onAddNewMaterial={() => setActiveTab('home')}
            onMaterialReady={handleMaterialReady}
            onQuizCompleted={refreshAttempts}
            onOpenProgressView={() => setActiveTab('progress')}
            user={user}
            onSignIn={handleSignIn}
          />
        )}

        {activeTab === 'progress' && !isAuthInitializing && user && (
          <ProgressView
            key={`progress_session_${user.uid}_${authSessionVersion}`}
            attempts={quizAttempts}
            materials={materials}
            onStartQuizForMaterial={(mat) => handleMaterialReady(mat, 'quiz')}
            onClearHistory={handleClearHistory}
          />
        )}
      </main>

      {/* Quick Search Study Materials Modal */}
      {isSearchOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-start justify-center pt-20 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-search-title"
        >
          <div className="bg-white rounded-3xl max-w-lg w-full p-5 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5 flex-1">
                <Search className="w-4 h-4 text-[#4285F4]" />
                <input
                  id="quick-search-title"
                  type="text"
                  autoFocus
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Search study materials or topics..."
                  aria-label="Search study materials or topics"
                  className="w-full text-sm text-[#172033] placeholder-slate-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsSearchOpen(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label="Close search"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2">
              {!user ? (
                <div className="text-center py-6 space-y-2">
                  <p className="text-xs text-[#64748B]">
                    Sign in with Google to search your personal study materials.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSearchOpen(false);
                      handleSignIn();
                    }}
                    className="px-4 py-1.5 rounded-full bg-[#4285F4] text-white text-xs font-semibold cursor-pointer"
                  >
                    Sign in with Google
                  </button>
                </div>
              ) : matchingSearchMaterials.length === 0 ? (
                <p className="text-xs text-[#64748B] text-center py-6">
                  {materials.length === 0
                    ? 'Your study library is currently empty.'
                    : `No materials match "${searchFilter}"`}
                </p>
              ) : (
                matchingSearchMaterials.map((mat) => (
                  <button
                    key={mat.id}
                    type="button"
                    onClick={() => {
                      setIsSearchOpen(false);
                      handleMaterialReady(mat, 'tutor');
                    }}
                    className="w-full text-left px-4 py-3 rounded-2xl hover:bg-[#F3F7FE] flex items-center justify-between gap-3 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="w-4 h-4 text-[#4285F4] shrink-0" />
                      <div className="min-w-0">
                        <p className="font-display font-bold text-sm text-[#172033] truncate">
                          {mat.title}
                        </p>
                        <p className="text-xs text-[#64748B]">
                          {mat.pages.length} pages · Last studied {mat.lastStudiedAt}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
