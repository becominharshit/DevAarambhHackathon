import React, { useRef, useState } from 'react';
import {
  BookOpen,
  ClipboardCheck,
  Target,
  BarChart2,
  ArrowRight,
  FileText,
  ChevronRight,
  AlertCircle,
  Loader2,
  Maximize2,
  X,
  Sparkles,
  Mic,
  ShieldCheck,
  Play,
  Link2,
  LogIn,
  DatabaseBackup,
  PlusCircle,
} from 'lucide-react';
import {
  DocumentAnalysis,
  LegacyBackupSummary,
  StudyMaterial,
  UserAuthProfile,
} from '../types/study';
import { extractPdfPages } from '../services/pdfService';
import {
  paginateTextContent,
  parseYouTubeUrl,
  validatePastedText,
} from '../lib/studyLogic';
import { analyzeYouTubeLecture } from '../services/aiClient';
import {
  createOptionalSampleMaterial,
  storageService,
} from '../services/storageService';

export type StudySubTab =
  | 'tutor'
  | 'quiz'
  | 'mistakes'
  | 'revision'
  | 'adaptive'
  | 'quick_revise'
  | 'sticky_notes'
  | 'flashcards'
  | 'mind_map'
  | 'revision_sheet'
  | 'explore';

interface HomeViewProps {
  materials: StudyMaterial[];
  activeMaterial?: StudyMaterial;
  onMaterialReady: (material: StudyMaterial, initialTab?: StudySubTab) => void;
  onNavigateFeature: (target: 'tutor' | 'quiz' | 'mistakes' | 'progress') => void;
  user?: UserAuthProfile | null;
  onSignIn?: () => void;
  legacyBackupSummary?: LegacyBackupSummary;
  onImportLegacyData?: () => void;
  onDismissLegacyData?: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  materials,
  activeMaterial,
  onMaterialReady,
  onNavigateFeature,
  user,
  onSignIn,
  legacyBackupSummary,
  onImportLegacyData,
  onDismissLegacyData,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadSourceMode, setUploadSourceMode] = useState<
    'pdf' | 'paste' | 'youtube'
  >('pdf');
  const [pasteText, setPasteText] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [youtubeCustomTitle, setYoutubeCustomTitle] = useState('');
  const [showExpandedPaste, setShowExpandedPaste] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAllRecent, setShowAllRecent] = useState(false);

  const ensureAuthenticatedOrPrompt = (): boolean => {
    if (!user) {
      setErrorMessage(
        'Please sign in with your Google account first so your study materials and progress are saved privately to your account.'
      );
      return false;
    }
    return true;
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!ensureAuthenticatedOrPrompt()) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setErrorMessage(null);
    setIsProcessing(true);

    try {
      const extracted = await extractPdfPages(file);
      const colors: Array<'red' | 'blue' | 'green' | 'yellow'> = [
        'red',
        'blue',
        'green',
        'yellow',
      ];
      const newMaterial: StudyMaterial = {
        id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ownerId: user?.uid,
        title: extracted.title,
        sourceType: 'pdf',
        pageCount: extracted.pageCount,
        pages: extracted.pages,
        createdAt: new Date().toISOString(),
        lastStudiedAt: 'Just now',
        iconColor: colors[materials.length % colors.length],
        pdfDataUrl: extracted.pdfDataUrl,
      };
      onMaterialReady(newMaterial, 'tutor');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Unable to process this PDF file.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePasteSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!ensureAuthenticatedOrPrompt()) return;
    setErrorMessage(null);

    const validation = validatePastedText(pasteText);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Please paste valid study notes.');
      return;
    }

    const { title, pages } = paginateTextContent(pasteText, customTitle);
    const colors: Array<'red' | 'blue' | 'green' | 'yellow'> = [
      'blue',
      'green',
      'red',
      'yellow',
    ];
    const newMaterial: StudyMaterial = {
      id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ownerId: user?.uid,
      title,
      sourceType: 'text',
      pageCount: pages.length,
      pages,
      createdAt: new Date().toISOString(),
      lastStudiedAt: 'Just now',
      iconColor: colors[materials.length % colors.length],
    };

    setPasteText('');
    setCustomTitle('');
    setShowExpandedPaste(false);
    onMaterialReady(newMaterial, 'tutor');
  };

  const handleYouTubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ensureAuthenticatedOrPrompt()) return;
    setErrorMessage(null);

    const parsed = parseYouTubeUrl(youtubeUrlInput);
    if (!parsed.valid || !parsed.videoId || !parsed.canonicalUrl) {
      setErrorMessage(
        parsed.error || 'Please enter a valid public YouTube URL.'
      );
      return;
    }

    setIsProcessing(true);
    try {
      const analyzed = await analyzeYouTubeLecture({
        youtubeUrl: parsed.canonicalUrl,
        videoId: parsed.videoId,
        customTitle: youtubeCustomTitle,
      });

      const matId = `mat_yt_${parsed.videoId}_${Date.now().toString(36)}`;
      const newMaterial: StudyMaterial = {
        id: matId,
        ownerId: user?.uid,
        title: analyzed.title,
        sourceType: 'youtube',
        pageCount: analyzed.pages.length,
        pages: analyzed.pages,
        createdAt: new Date().toISOString(),
        lastStudiedAt: 'Just now',
        iconColor: 'red',
        youtubeUrl: parsed.canonicalUrl,
        youtubeVideoId: parsed.videoId,
      };

      const analysisRecord: DocumentAnalysis = {
        materialId: matId,
        overview: analyzed.overview,
        keyTopics: analyzed.keyTopics,
        suggestedQuestions: analyzed.suggestedQuestions,
      };
      storageService.saveDocumentAnalysis(analysisRecord);

      setYoutubeUrlInput('');
      setYoutubeCustomTitle('');
      onMaterialReady(newMaterial, 'tutor');
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          'Unable to analyze this YouTube video. Please try another public educational link or paste the transcript.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadSampleChapter = () => {
    if (!ensureAuthenticatedOrPrompt()) return;
    const sample = createOptionalSampleMaterial();
    sample.ownerId = user?.uid;
    onMaterialReady(sample, 'tutor');
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      await handleFileSelected(droppedFile);
    }
  };

  const visibleMaterials = showAllRecent ? materials : materials.slice(0, 3);

  return (
    <div className="relative overflow-hidden min-h-[calc(100vh-4rem)] pb-14">
      {/* Ambient Google 4-color blended background artwork matching Image 1 */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-24 top-32 w-80 h-80 rounded-full bg-gradient-to-tr from-[#34A853]/20 via-[#FBBC05]/18 to-transparent blur-3xl" />

        {/* Left glossy Google-blue sphere */}
        <div
          className="hidden md:block absolute -left-28 top-[310px] w-[290px] h-[290px] rounded-full opacity-90"
          style={{
            background:
              'radial-gradient(circle at 68% 32%, #93C5FD 0%, #4285F4 48%, #1D4ED8 88%)',
            filter: 'blur(2px)',
            boxShadow: '0 25px 70px rgba(66, 133, 244, 0.32)',
          }}
        />

        {/* Right top multicolor aura behind floating document artwork */}
        <div className="absolute right-[2%] top-6 w-[500px] h-[420px] rounded-full bg-gradient-to-br from-[#4285F4]/18 via-[#EA4335]/14 to-[#34A853]/18 blur-3xl" />

        {/* Bottom-right warm yellow/red sphere */}
        <div
          className="hidden md:block absolute -right-24 top-[420px] w-[330px] h-[330px] rounded-full opacity-90"
          style={{
            background:
              'radial-gradient(circle at 35% 25%, #FDE047 0%, #FB923C 42%, #EA4335 85%)',
            filter: 'blur(3px)',
            boxShadow: '0 20px 60px rgba(234, 67, 53, 0.24)',
          }}
        />
      </div>

      <div className="relative z-10 max-w-[1220px] mx-auto px-4 sm:px-8 pt-5 sm:pt-7">
        {/* Safe Unclaimed Legacy Data Quarantine Banner (requires explicit user decision) */}
        {user && legacyBackupSummary?.hasUnclaimedData && (
          <div
            role="region"
            aria-label="Unclaimed local study data notice"
            className="mb-5 rounded-2xl bg-[#FEF9EC] border border-[#FDE68A] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#FDEBB6] text-[#B45309] flex items-center justify-center shrink-0">
                <DatabaseBackup className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-xs sm:text-sm text-[#172033]">
                  Previous Local Browser Data Found ({legacyBackupSummary.materialCount} material
                  {legacyBackupSummary.materialCount === 1 ? '' : 's'}, {legacyBackupSummary.attemptCount} quiz attempt
                  {legacyBackupSummary.attemptCount === 1 ? '' : 's'})
                </h3>
                <p className="text-xs text-[#64748B] mt-0.5">
                  To protect multi-user privacy, LearnMate did not automatically copy unowned browser data into{' '}
                  <span className="font-semibold text-[#172033]">{user.email || user.displayName}</span>. Would you like to import it into this account?
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onImportLegacyData && (
                <button
                  type="button"
                  onClick={onImportLegacyData}
                  className="px-3.5 py-1.5 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Import to My Account
                </button>
              )}
              {onDismissLegacyData && (
                <button
                  type="button"
                  onClick={onDismissLegacyData}
                  className="px-3 py-1.5 rounded-full bg-white hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-[#64748B] transition-colors cursor-pointer"
                >
                  Keep Separate
                </button>
              )}
            </div>
          </div>
        )}

        {/* Hero Split Row matching Image 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left Hero Copy */}
          <div className="lg:col-span-6 space-y-3.5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#FEF7E0] border border-[#FDE68A]/70 text-xs sm:text-[13px] font-semibold text-[#172033]">
              <Sparkles className="w-3.5 h-3.5 text-[#4285F4]" />
              <span>AI-Powered Personalized Learning</span>
            </div>

            <h1 className="font-display text-4xl sm:text-[46px] lg:text-[50px] font-bold tracking-tight leading-[1.08] text-balance">
              <span className="text-[#172033]">Upload. </span>
              <span className="text-[#4285F4]">Learn.</span>
              <br />
              <span className="text-[#EA4335]">Practice. </span>
              <span className="text-[#34A853]">Improve.</span>
            </h1>

            <p className="text-sm sm:text-base text-[#64748B] max-w-md leading-relaxed">
              Turn your study material into a personalized learning and revision experience with AI.
            </p>
          </div>

          {/* Right Hero Translucent Floating-Document Artwork + 3 Callout Pills matching Image 1 */}
          <div
            aria-hidden="true"
            className="hidden lg:flex lg:col-span-6 justify-between items-center relative h-[230px]"
          >
            {/* Floating Document Stack */}
            <div className="relative w-[240px] h-full flex items-center justify-center">
              <div className="w-34 h-44 rounded-2xl bg-white/60 backdrop-blur-md border border-white/80 shadow-[0_15px_35px_rgba(66,133,244,0.12)] transform rotate-12 translate-x-7 -translate-y-3 p-3.5 flex flex-col justify-between">
                <div className="space-y-2 mt-2">
                  <div className="h-2 w-3/4 rounded-full bg-slate-300/60" />
                  <div className="h-2 w-full rounded-full bg-slate-300/50" />
                  <div className="h-2 w-5/6 rounded-full bg-slate-300/50" />
                </div>
                <div className="h-11 rounded-xl bg-blue-100/55" />
              </div>

              <div className="absolute w-36 h-48 rounded-2xl bg-white/85 backdrop-blur-xl border border-white shadow-[0_20px_50px_rgba(30,64,175,0.16)] transform -rotate-10 -translate-x-5 translate-y-1 p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-md bg-[#EA4335] text-white font-display font-bold text-xs tracking-wide shadow-xs">
                    PDF
                  </span>
                  <div className="w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-[#4285F4]/50" />
                  </div>
                </div>
                <div className="space-y-2 my-auto">
                  <div className="h-2 w-4/5 rounded-full bg-slate-300/70" />
                  <div className="h-2 w-full rounded-full bg-slate-200/90" />
                  <div className="h-2 w-11/12 rounded-full bg-slate-200/80" />
                  <div className="h-2 w-2/3 rounded-full bg-slate-200/70" />
                </div>
                <div className="h-2 w-1/2 rounded-full bg-blue-200/60" />
              </div>

              <div className="absolute right-4 bottom-3 w-20 h-20 rounded-2xl bg-white/90 backdrop-blur-xl border border-white shadow-[0_12px_30px_rgba(66,133,244,0.2)] transform rotate-6 flex items-center justify-center p-2">
                <div className="w-full h-full rounded-xl bg-gradient-to-br from-[#60A5FA] to-[#3B82F6] flex flex-col items-center justify-center relative overflow-hidden">
                  <div className="w-2.5 h-2.5 rounded-full bg-white/90 absolute top-2 left-2.5" />
                  <svg viewBox="0 0 64 40" className="w-full h-8 mt-4" fill="none">
                    <path d="M4 40L22 18L36 32L46 22L60 40H4Z" fill="rgba(255,255,255,0.85)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* 3 Floating Feature Pills on the right of Image 1 */}
            <div className="flex flex-col gap-2.5 pr-2">
              <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white/90 backdrop-blur-md border border-blue-100 shadow-[0_8px_24px_rgba(66,133,244,0.12)] text-xs font-semibold text-[#172033]">
                <div className="w-6 h-6 rounded-lg bg-[#E8F0FE] text-[#4285F4] flex items-center justify-center shrink-0">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <span>Ask anything with Gemini</span>
              </div>

              <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white/90 backdrop-blur-md border border-emerald-100 shadow-[0_8px_24px_rgba(52,168,83,0.12)] text-xs font-semibold text-[#172033]">
                <div className="w-6 h-6 rounded-lg bg-[#DCFCE7] text-[#34A853] flex items-center justify-center shrink-0">
                  <Mic className="w-3.5 h-3.5" />
                </div>
                <span>Learn with voice tutoring</span>
              </div>

              <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white/90 backdrop-blur-md border border-amber-100 shadow-[0_8px_24px_rgba(251,188,5,0.14)] text-xs font-semibold text-[#172033]">
                <div className="w-6 h-6 rounded-lg bg-[#FEF3C7] text-[#D97706] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </div>
                <span>Your progress is saved securely</span>
              </div>
            </div>
          </div>
        </div>

        {/* Central PDF Upload, Paste Notes, and YouTube Lecture Card */}
        <div className="relative max-w-[640px] mx-auto -mt-1 sm:-mt-3">
          {/* Top Floating Multicolor Cloud Upload Icon */}
          <div className="relative z-20 mx-auto -mb-6 w-18 h-14 rounded-t-full bg-white flex items-center justify-center pt-1.5">
            <svg width="50" height="38" viewBox="0 0 64 48" fill="none" aria-hidden="true">
              <path
                d="M18 38H14C7.92487 38 3 33.0751 3 27C3 21.4667 7.08759 16.8891 12.4057 16.1157C14.6873 9.08531 21.2896 4 29 4C37.8203 4 45.1436 10.536 46.322 19.0332C52.3137 19.6745 57 24.7568 57 30.9C57 34.8212 53.8212 38 49.9 38H44"
                stroke="url(#cloud_rainbow_home)"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
              <path
                d="M30 42V22M30 22L22 30M30 22L38 30"
                stroke="#4285F4"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient
                  id="cloud_rainbow_home"
                  x1="3"
                  y1="21"
                  x2="57"
                  y2="21"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0" stopColor="#FBBC05" />
                  <stop offset="0.32" stopColor="#EA4335" />
                  <stop offset="0.68" stopColor="#4285F4" />
                  <stop offset="1" stopColor="#34A853" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`bg-white rounded-[26px] p-3 shadow-[0_20px_60px_-15px_rgba(30,64,175,0.12)] border transition-all ${
              isDragging ? 'border-[#4285F4] ring-4 ring-[#4285F4]/15' : 'border-white'
            }`}
          >
            <div className="border border-dashed border-[#B8D0F8] rounded-[20px] bg-gradient-to-b from-white via-[#FBFDFF] to-[#F4F8FF] px-5 sm:px-8 pt-6 pb-5 text-center">
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#172033]">
                Upload your study material
              </h2>
              <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
                PDF (up to 20 pages), paste text, or import a public YouTube lecture
              </p>

              {/* Clean Segmented Source Selector: Upload PDF | Paste Notes | YouTube Link */}
              <div
                role="tablist"
                aria-label="Study material source type"
                className="inline-flex items-center gap-1 p-1 rounded-full bg-[#EEF3FB] border border-[#DCE8FC] mt-3"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={uploadSourceMode === 'pdf'}
                  onClick={() => {
                    setUploadSourceMode('pdf');
                    setErrorMessage(null);
                  }}
                  className={`px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    uploadSourceMode === 'pdf'
                      ? 'bg-white text-[#4285F4] shadow-xs'
                      : 'text-[#64748B] hover:text-[#172033]'
                  }`}
                >
                  Upload PDF
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={uploadSourceMode === 'paste'}
                  onClick={() => {
                    setUploadSourceMode('paste');
                    setErrorMessage(null);
                  }}
                  className={`px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    uploadSourceMode === 'paste'
                      ? 'bg-white text-[#4285F4] shadow-xs'
                      : 'text-[#64748B] hover:text-[#172033]'
                  }`}
                >
                  Paste Notes
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={uploadSourceMode === 'youtube'}
                  onClick={() => {
                    setUploadSourceMode('youtube');
                    setErrorMessage(null);
                  }}
                  className={`inline-flex items-center gap-1 px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    uploadSourceMode === 'youtube'
                      ? 'bg-white text-[#EA4335] shadow-xs'
                      : 'text-[#64748B] hover:text-[#172033]'
                  }`}
                >
                  <Play className="w-3 h-3" />
                  <span>YouTube Link</span>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => handleFileSelected(e.target.files?.[0])}
                className="hidden"
                aria-label="Upload PDF file"
              />

              {uploadSourceMode === 'youtube' ? (
                <form
                  onSubmit={handleYouTubeSubmit}
                  className="mt-4 max-w-lg mx-auto space-y-2.5 text-left"
                >
                  <div className="flex items-center bg-[#F3F6FC] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#EA4335]/35 border border-[#E2E8F5] rounded-full pl-4 pr-1.5 py-1 transition-all">
                    <Link2 className="w-4 h-4 text-[#EA4335] shrink-0 mr-2.5" />
                    <input
                      type="url"
                      value={youtubeUrlInput}
                      onChange={(e) => {
                        setYoutubeUrlInput(e.target.value);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="https://www.youtube.com/watch?v=..."
                      aria-label="Paste public YouTube lecture link"
                      className="w-full bg-transparent text-xs sm:text-sm text-[#172033] placeholder-[#64748B] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isProcessing}
                      aria-label="Analyze YouTube lecture"
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#EA4335] hover:bg-[#DC2626] text-white text-xs font-semibold transition-colors shrink-0 disabled:opacity-60 cursor-pointer"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Analyzing...</span>
                        </>
                      ) : (
                        <>
                          <span>Analyze Video</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#64748B] text-center">
                    Gemini extracts timestamped study notes, key topics, flashcards, mind maps, and quizzes from public educational videos.
                  </p>
                </form>
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => {
                        if (!ensureAuthenticatedOrPrompt()) return;
                        fileInputRef.current?.click();
                      }}
                      className="inline-flex items-center justify-center gap-2 px-7 py-2.5 rounded-full bg-gradient-to-b from-[#4285F4] to-[#1D6AE5] hover:from-[#2563EB] hover:to-[#1D4ED8] text-white font-display font-semibold text-sm shadow-[0_6px_18px_rgba(66,133,244,0.32)] transition-all disabled:opacity-60 cursor-pointer"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Extracting Pages...</span>
                        </>
                      ) : (
                        <>
                          <FileText className="w-4 h-4" />
                          <span>Upload PDF File</span>
                        </>
                      )}
                    </button>

                    {user && activeMaterial && (
                      <button
                        type="button"
                        onClick={() => onMaterialReady(activeMaterial, 'tutor')}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1967D2] font-display font-semibold text-xs sm:text-sm transition-colors cursor-pointer"
                      >
                        <span>Continue Learning</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {!user && onSignIn && (
                      <button
                        type="button"
                        onClick={onSignIn}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1967D2] font-display font-semibold text-xs sm:text-sm transition-colors cursor-pointer"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Sign in with Google</span>
                      </button>
                    )}
                  </div>

                  {/* Divider "or" */}
                  <div className="flex items-center gap-4 my-3 max-w-md mx-auto">
                    <div className="h-px flex-1 bg-slate-200/80" />
                    <span className="text-xs font-medium text-[#64748B]">or</span>
                    <div className="h-px flex-1 bg-slate-200/80" />
                  </div>

                  {/* Paste Notes Input Bar */}
                  <form onSubmit={handlePasteSubmit} className="relative max-w-lg mx-auto">
                    <div className="flex items-center bg-[#F3F6FC] hover:bg-[#EEF3FB] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#4285F4]/40 border border-[#E2E8F5] rounded-full pl-4 pr-1.5 py-1 transition-all">
                      <FileText className="w-4 h-4 text-[#64748B] shrink-0 mr-2.5" />
                      <input
                        type="text"
                        value={pasteText}
                        onChange={(e) => {
                          setPasteText(e.target.value);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        placeholder="Paste your notes here..."
                        aria-label="Paste your notes here"
                        className="w-full bg-transparent text-xs sm:text-sm text-[#172033] placeholder-[#64748B] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!ensureAuthenticatedOrPrompt()) return;
                          setShowExpandedPaste(true);
                        }}
                        className="p-1.5 text-[#64748B] hover:text-[#172033] transition-colors mr-1 cursor-pointer"
                        aria-label="Open full-screen note editor"
                        title="Open multi-line note editor"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="submit"
                        aria-label="Submit pasted study notes"
                        className="w-8 h-8 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </form>
                </>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="mt-3 inline-flex flex-wrap items-center justify-center gap-2 px-3.5 py-1.5 rounded-xl bg-red-50 border border-red-200 text-xs text-[#DC2626] text-left"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                  {!user && onSignIn && (
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="underline font-bold text-[#1967D2] ml-1 cursor-pointer"
                    >
                      Sign in now
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Four Compact Feature Cards matching Image 1 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <button
            type="button"
            onClick={() => onNavigateFeature('tutor')}
            className="group text-left rounded-2xl bg-[#F3F7FE]/95 hover:bg-[#EBF2FE] border border-[#E3ECFA] p-5 flex items-start gap-4 transition-all hover:shadow-sm cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#DCE8FC] text-[#4285F4] flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#172033] group-hover:text-[#1D4ED8] transition-colors">
                Understand
              </h3>
              <p className="text-xs sm:text-[13px] text-[#64748B] mt-1 leading-snug">
                Get simple explanations with source references
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateFeature('quiz')}
            className="group text-left rounded-2xl bg-[#FDF3F2]/95 hover:bg-[#FCEAE8] border border-[#F9E0DE] p-5 flex items-start gap-4 transition-all hover:shadow-sm cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#FCDAD7] text-[#EA4335] flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#172033] group-hover:text-[#DC2626] transition-colors">
                Practice
              </h3>
              <p className="text-xs sm:text-[13px] text-[#64748B] mt-1 leading-snug">
                Take diagnostic quizzes and targeted questions
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateFeature('mistakes')}
            className="group text-left rounded-2xl bg-[#FEF9EC]/95 hover:bg-[#FDF3D7] border border-[#FBF0CE] p-5 flex items-start gap-4 transition-all hover:shadow-sm cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#FDEBB6] text-[#D97706] flex items-center justify-center shrink-0">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#172033] group-hover:text-[#B45309] transition-colors">
                Find Gaps
              </h3>
              <p className="text-xs sm:text-[13px] text-[#64748B] mt-1 leading-snug">
                Identify weak topics instantly
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateFeature('progress')}
            className="group text-left rounded-2xl bg-[#F1FAF4]/95 hover:bg-[#E4F6EA] border border-[#DCF2E3] p-5 flex items-start gap-4 transition-all hover:shadow-sm cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#D1F2DC] text-[#34A853] flex items-center justify-center shrink-0">
              <BarChart2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#172033] group-hover:text-[#15803D] transition-colors">
                Track Progress
              </h3>
              <p className="text-xs sm:text-[13px] text-[#64748B] mt-1 leading-snug">
                See your improvement over time
              </p>
            </div>
          </button>
        </div>

        {/* Recent Materials / Personal Workspace Section */}
        <section className="mt-6" aria-labelledby="recent-material-heading">
          <div className="flex items-center justify-between mb-3">
            <h2
              id="recent-material-heading"
              className="font-display text-lg sm:text-xl font-bold text-[#172033]"
            >
              Recent Materials
            </h2>
            {materials.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllRecent((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#4285F4] hover:text-[#1D4ED8] transition-colors cursor-pointer"
              >
                <span>{showAllRecent ? 'Show Less' : 'View All'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {!user ? (
            <div
              data-testid="unauthenticated-materials-card"
              className="rounded-2xl bg-white/95 border border-slate-200/80 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs"
            >
              <div className="space-y-1">
                <h3 className="font-display font-bold text-sm sm:text-base text-[#172033]">
                  Sign in to access your private study library
                </h3>
                <p className="text-xs sm:text-sm text-[#64748B]">
                  Each Google account has its own isolated materials, AI Tutor history, quizzes, flashcards, and progress.
                </p>
              </div>
              {onSignIn && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-semibold text-xs sm:text-sm shadow-xs transition-colors shrink-0 cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Sign in with Google</span>
                </button>
              )}
            </div>
          ) : materials.length === 0 ? (
            <div
              data-testid="empty-workspace-card"
              className="rounded-2xl bg-white/95 border border-dashed border-[#B8D0F8] p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs"
            >
              <div className="space-y-1">
                <h3 className="font-display font-bold text-sm sm:text-base text-[#172033]">
                  Your personal study workspace is empty
                </h3>
                <p className="text-xs sm:text-sm text-[#64748B]">
                  Upload a PDF, paste lecture notes, or import a YouTube video above to start studying—or load an optional sample chapter.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLoadSampleChapter}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1967D2] font-display font-semibold text-xs sm:text-sm transition-colors shrink-0 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Load Sample Probability Chapter</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {visibleMaterials.map((mat) => {
                const iconColorStyles = {
                  red: 'bg-[#FEE2E2] text-[#EA4335]',
                  blue: 'bg-[#DBEAFE] text-[#4285F4]',
                  green: 'bg-[#DCFCE7] text-[#34A853]',
                  yellow: 'bg-[#FEF3C7] text-[#D97706]',
                }[mat.iconColor || 'blue'];

                return (
                  <button
                    key={mat.id}
                    type="button"
                    data-testid={`material-card-${mat.id}`}
                    onClick={() => onMaterialReady(mat, 'tutor')}
                    className="group bg-white hover:bg-slate-50/70 rounded-2xl border border-slate-200/80 px-4 py-4 flex items-center justify-between gap-3 text-left shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-[#93C5FD] transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconColorStyles}`}
                      >
                        {mat.sourceType === 'youtube' ? (
                          <Play className="w-5 h-5" />
                        ) : (
                          <FileText className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display font-bold text-sm sm:text-[15px] text-[#172033] truncate group-hover:text-[#4285F4] transition-colors">
                          {mat.title}
                        </h3>
                        <p className="text-xs text-[#64748B] mt-0.5 truncate">
                          Last studied · {mat.lastStudiedAt}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#94A3B8] group-hover:text-[#4285F4] shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Multi-line Paste Study Material Modal */}
      {showExpandedPaste && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="paste-modal-title"
        >
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 id="paste-modal-title" className="font-display text-xl font-bold text-[#172033]">
                  Paste Study Material
                </h2>
                <p className="text-xs sm:text-sm text-[#64748B]">
                  LearnMate automatically indexes your notes into pages for cited explanations and quizzes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowExpandedPaste(false)}
                className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="custom-note-title"
                  className="block text-xs font-semibold text-[#172033] mb-1"
                >
                  Document Title (optional)
                </label>
                <input
                  id="custom-note-title"
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g., Linear Algebra — Eigenvalues & Eigenvectors"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4285F4]"
                />
              </div>

              <div>
                <label
                  htmlFor="full-paste-textarea"
                  className="block text-xs font-semibold text-[#172033] mb-1"
                >
                  Study Notes Content
                </label>
                <textarea
                  id="full-paste-textarea"
                  rows={9}
                  value={pasteText}
                  onChange={(e) => {
                    setPasteText(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Paste lecture notes, textbook chapters, or study summaries here..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4285F4] leading-relaxed"
                />
              </div>

              {errorMessage && (
                <div className="flex items-center gap-2 text-xs text-[#DC2626] bg-red-50 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExpandedPaste(false)}
                  className="px-5 py-2.5 rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-full text-sm font-semibold bg-[#4285F4] hover:bg-[#2563EB] text-white shadow-sm cursor-pointer"
                >
                  Start Studying
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
