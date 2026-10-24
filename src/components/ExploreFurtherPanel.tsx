import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Youtube,
  ExternalLink,
  Search,
  RefreshCw,
  Loader2,
  Play,
  Sparkles,
  AlertCircle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Plus,
  X,
} from 'lucide-react';
import {
  DocumentAnalysis,
  GeminiModelOption,
  StudyMaterial,
  YouTubeRecommendation,
} from '../types/study';
import {
  analyzeYouTubeLecture,
  fetchYouTubeRecommendations,
} from '../services/aiClient';
import { parseYouTubeUrl } from '../lib/studyLogic';
import { storageService } from '../services/storageService';

interface ExploreFurtherPanelProps {
  material: StudyMaterial;
  analysis: DocumentAnalysis | null;
  weakTopics?: string[];
  selectedModel?: GeminiModelOption;
  onMaterialImported?: (newMaterial: StudyMaterial) => void;
}

const GENERIC_TITLE_PATTERN =
  /^(pasted[\s_-]*study[\s_-]*notes?|study[\s_-]*notes?|untitled(\s+document|\s+notes?)?|notes?|document|chapter\s*\d*|lecture\s*\d*|page\s*\d*|material|pdf|text)$/i;

function decodeHtmlEntities(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function deriveSpecificTopicChips(
  material: StudyMaterial,
  analysis: DocumentAnalysis | null,
  weakTopics: string[] = []
): string[] {
  const candidates: string[] = [];

  for (const wt of weakTopics) {
    if (wt && wt.trim().length > 2 && !GENERIC_TITLE_PATTERN.test(wt.trim())) {
      candidates.push(wt.trim());
    }
  }

  if (analysis?.keyTopics) {
    for (const kt of analysis.keyTopics) {
      if (
        kt.name &&
        kt.name.trim().length > 2 &&
        !GENERIC_TITLE_PATTERN.test(kt.name.trim())
      ) {
        candidates.push(kt.name.trim());
      }
      for (const term of kt.keyTerms || []) {
        if (
          term &&
          term.trim().length > 2 &&
          !GENERIC_TITLE_PATTERN.test(term.trim())
        ) {
          candidates.push(term.trim());
        }
      }
    }
  }

  for (const page of material.pages || []) {
    if (
      page.title &&
      page.title.trim().length > 3 &&
      !GENERIC_TITLE_PATTERN.test(page.title.trim())
    ) {
      candidates.push(page.title.trim());
    }
  }

  const cleanedMatTitle = material.title
    .replace(/\.(pdf|txt|md)$/i, '')
    .replace(/\s*\(YouTube\)\s*/i, '')
    .trim();
  if (
    cleanedMatTitle.length > 3 &&
    !GENERIC_TITLE_PATTERN.test(cleanedMatTitle)
  ) {
    candidates.push(cleanedMatTitle);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of candidates) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
    if (unique.length >= 6) break;
  }

  return unique.length > 0 ? unique : ['Conditional Probability', 'Bayes Theorem', 'Random Variables'];
}

export const ExploreFurtherPanel: React.FC<ExploreFurtherPanelProps> = ({
  material,
  analysis,
  weakTopics = [],
  selectedModel,
  onMaterialImported,
}) => {
  const topicChips = useMemo(
    () => deriveSpecificTopicChips(material, analysis, weakTopics),
    [material, analysis, weakTopics]
  );

  const defaultQuery = useMemo(() => topicChips[0] || 'Probability Theory', [topicChips]);

  const [searchQuery, setSearchQuery] = useState(defaultQuery);
  const [activeChip, setActiveChip] = useState(defaultQuery);
  const [videos, setVideos] = useState<YouTubeRecommendation[]>([]);
  const [isConfigured, setIsConfigured] = useState<boolean>(true);
  const [statusReason, setStatusReason] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [embeddedVideoId, setEmbeddedVideoId] = useState<string | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  // Direct YouTube URL ingestion state
  const [showDirectUrlBar, setShowDirectUrlBar] = useState(false);
  const [directYoutubeUrl, setDirectYoutubeUrl] = useState('');
  const [directYoutubeTitle, setDirectYoutubeTitle] = useState('');
  const [isImportingVideo, setIsImportingVideo] = useState(false);
  const [importingVideoId, setImportingVideoId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessTitle, setImportSuccessTitle] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSearchQuery(defaultQuery);
    setActiveChip(defaultQuery);
    setEmbeddedVideoId(null);
    loadVideos(defaultQuery, false);
  }, [material.id, defaultQuery]);

  const loadVideos = async (query: string, forceRefresh: boolean) => {
    setIsLoading(true);
    setStatusReason(undefined);
    try {
      const res = await fetchYouTubeRecommendations({
        materialId: material.id,
        query,
        materialTitle: material.title,
        keyTopics: analysis?.keyTopics || [],
        pages: material.pages,
        weakTopics,
        forceRefresh,
      });
      setIsConfigured(res.configured);
      setStatusReason(res.reason);
      setVideos(res.videos || []);
      setActiveSlideIndex(0);
    } catch {
      setIsConfigured(false);
      setStatusReason('Unable to load YouTube recommendations right now.');
      setVideos([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setActiveChip(searchQuery.trim());
    loadVideos(searchQuery.trim(), true);
  };

  const scrollCarousel = (direction: 'left' | 'right') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const cardWidth = 310;
    const delta = direction === 'left' ? -cardWidth : cardWidth;
    el.scrollBy({ left: delta, behavior: 'smooth' });
    setActiveSlideIndex((prev) =>
      direction === 'left'
        ? Math.max(0, prev - 1)
        : Math.min(Math.max(0, videos.length - 1), prev + 1)
    );
  };

  const handleImportYouTubeToLearnMate = async (
    youtubeUrlToUse: string,
    customTitleToUse?: string,
    videoIdIndicator?: string
  ) => {
    setImportError(null);
    setImportSuccessTitle(null);
    const parsed = parseYouTubeUrl(youtubeUrlToUse);
    if (!parsed.valid || !parsed.videoId) {
      setImportError(
        parsed.error ||
          'Please enter a valid public YouTube URL (e.g., https://www.youtube.com/watch?v=...).'
      );
      return;
    }
    const vid = parsed.videoId;

    setIsImportingVideo(true);
    setImportingVideoId(videoIdIndicator || vid);
    try {
      const normalizedUrl = `https://www.youtube.com/watch?v=${vid}`;
      const result = await analyzeYouTubeLecture({
        youtubeUrl: normalizedUrl,
        videoId: vid,
        customTitle: customTitleToUse?.trim() || undefined,
        model: selectedModel,
      });

      const newMat: StudyMaterial = {
        id: `mat_yt_${vid}_${Date.now()}`,
        title: result.title || customTitleToUse || `YouTube Lecture (${vid})`,
        sourceType: 'youtube',
        pageCount: result.pages.length,
        pages: result.pages,
        createdAt: new Date().toISOString(),
        lastStudiedAt: 'Just now',
        iconColor: 'red',
        youtubeUrl: normalizedUrl,
        youtubeVideoId: vid,
      };

      storageService.saveMaterial(newMat);
      storageService.saveDocumentAnalysis({
        materialId: newMat.id,
        overview: result.overview,
        keyTopics: result.keyTopics,
        suggestedQuestions: result.suggestedQuestions,
      });

      setDirectYoutubeUrl('');
      setDirectYoutubeTitle('');
      setShowDirectUrlBar(false);
      setImportSuccessTitle(newMat.title);

      if (onMaterialImported) {
        onMaterialImported(newMat);
      }
    } catch (err: any) {
      setImportError(
        err?.message || 'Failed to analyze YouTube lecture with Gemini.'
      );
    } finally {
      setIsImportingVideo(false);
      setImportingVideoId(null);
    }
  };

  const cardBorderStyles = [
    'border-[#93C5FD] bg-gradient-to-b from-white to-[#F5F9FF]',
    'border-[#FCA5A5] bg-gradient-to-b from-white to-[#FFF7F7]',
    'border-[#FDE68A] bg-gradient-to-b from-white to-[#FFFDF5]',
    'border-[#86EFAC] bg-gradient-to-b from-white to-[#F4FBF7]',
  ];

  return (
    <div className="google-gradient-panel rounded-[28px] p-6 sm:p-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-stretch">
        {/* Left Educational Illustration Column (matching Image 4) */}
        <div className="hidden lg:flex lg:col-span-3 rounded-3xl bg-gradient-to-br from-[#EEF5FF] via-[#FFF9F2] to-[#EEFBF3] border border-slate-200/70 p-5 flex-col justify-between relative overflow-hidden">
          <div className="space-y-1.5 relative z-10">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 border border-slate-200/80 text-[11px] font-bold text-[#EA4335] shadow-2xs">
              <Youtube className="w-3.5 h-3.5" />
              <span>Video Learning</span>
            </span>
            <h3 className="font-display font-bold text-base text-[#17223C] pt-1">
              Visual Concept Lectures
            </h3>
            <p className="text-xs text-[#5D6A80] leading-relaxed">
              Curated YouTube explanations matched directly to the concepts and formulas in{' '}
              <span className="font-semibold text-[#17223C]">{material.title}</span>.
            </p>
          </div>

          {/* Vector Educational Illustration */}
          <div className="my-4 flex items-center justify-center relative z-10">
            <svg
              viewBox="0 0 240 200"
              className="w-full max-w-[210px] h-auto drop-shadow-xs"
              aria-hidden="true"
            >
              {/* Soft background glow */}
              <circle cx="120" cy="100" r="76" fill="#FFFFFF" fillOpacity="0.75" />
              {/* Open Notebook / Textbook */}
              <rect
                x="24"
                y="120"
                width="95"
                height="56"
                rx="8"
                fill="#FFFFFF"
                stroke="#93C5FD"
                strokeWidth="2"
              />
              <line x1="36" y1="136" x2="96" y2="136" stroke="#4285F4" strokeWidth="3" strokeLinecap="round" />
              <line x1="36" y1="148" x2="104" y2="148" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="36" y1="160" x2="84" y2="160" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" />

              {/* Laptop / Video Player */}
              <rect
                x="72"
                y="42"
                width="136"
                height="90"
                rx="12"
                fill="#1E293B"
                stroke="#475569"
                strokeWidth="2"
              />
              <rect x="80" y="50" width="120" height="72" rx="6" fill="#F8FAFC" />
              {/* Play badge */}
              <rect x="120" y="70" width="40" height="28" rx="8" fill="#EA4335" />
              <polygon points="136,78 136,90 148,84" fill="#FFFFFF" />
              {/* Laptop Base */}
              <path
                d="M58 132 H222 L212 142 H68 Z"
                fill="#CBD5E1"
              />
              {/* Floating Formula / Science Badges */}
              <g transform="translate(26, 48)">
                <rect width="38" height="38" rx="10" fill="#FEF3C7" stroke="#FDE68A" strokeWidth="1.5" />
                <text x="19" y="24" textAnchor="middle" fill="#D97706" fontSize="13" fontWeight="bold" fontFamily="monospace">
                  P(A)
                </text>
              </g>
              <g transform="translate(182, 134)">
                <rect width="42" height="36" rx="10" fill="#DCFCE7" stroke="#86EFAC" strokeWidth="1.5" />
                <text x="21" y="23" textAnchor="middle" fill="#15803D" fontSize="12" fontWeight="bold" fontFamily="monospace">
                  Σx·p
                </text>
              </g>
            </svg>
          </div>

          <button
            type="button"
            onClick={() => setShowDirectUrlBar((v) => !v)}
            className="relative z-10 w-full py-2.5 px-3.5 rounded-xl bg-white/95 hover:bg-white border border-slate-200/90 text-xs font-bold text-[#17223C] flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#EA4335]" />
            <span>{showDirectUrlBar ? 'Hide URL Import' : 'Import YouTube URL'}</span>
          </button>
        </div>

        {/* Right Main Content Column (9 cols on desktop, full width on mobile) */}
        <div className="lg:col-span-9 flex flex-col justify-between space-y-5 min-w-0">
          {/* Header Row matching Image 4 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight text-[#17223C]">
                  Explore{' '}
                  <span className="bg-gradient-to-r from-[#EA4335] via-[#F59E0B] to-[#34A853] bg-clip-text text-transparent">
                    Further
                  </span>
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-[#5D6A80] mt-0.5">
                Discover topic-specific YouTube videos to deepen your understanding
              </p>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setShowDirectUrlBar((v) => !v)}
                className="lg:hidden inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white border border-slate-200/90 text-xs font-semibold text-[#17223C] shadow-2xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#EA4335]" />
                <span>Import URL</span>
              </button>

              <button
                type="button"
                disabled={isLoading}
                onClick={() => loadVideos(searchQuery, true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-semibold text-[#17223C] shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#4285F4] ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh Recommendations</span>
              </button>
            </div>
          </div>

          {/* Direct YouTube URL Ingestion Drawer (when toggled) */}
          {(showDirectUrlBar || importSuccessTitle || importError) && (
            <div className="rounded-2xl bg-[#F8FAFF] border border-[#DCE8FC] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#4285F4]" />
                  <h3 className="font-display font-bold text-xs sm:text-sm text-[#17223C]">
                    Import Any YouTube Lecture into LearnMate
                  </h3>
                </div>
                {showDirectUrlBar && (
                  <button
                    type="button"
                    onClick={() => setShowDirectUrlBar(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    aria-label="Close direct URL import"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {showDirectUrlBar && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleImportYouTubeToLearnMate(directYoutubeUrl, directYoutubeTitle);
                  }}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <input
                    type="url"
                    value={directYoutubeUrl}
                    onChange={(e) => setDirectYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    aria-label="YouTube lecture URL"
                    className="flex-1 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#17223C] focus:outline-none focus:border-[#4285F4]"
                  />
                  <input
                    type="text"
                    value={directYoutubeTitle}
                    onChange={(e) => setDirectYoutubeTitle(e.target.value)}
                    placeholder="Optional lecture title..."
                    aria-label="Optional lecture title"
                    className="sm:w-48 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#17223C] focus:outline-none focus:border-[#4285F4]"
                  />
                  <button
                    type="submit"
                    disabled={isImportingVideo || !directYoutubeUrl.trim()}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#EA4335] hover:bg-[#DC2626] text-white font-display font-semibold text-xs sm:text-sm disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {isImportingVideo ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Importing...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Analyze & Study</span>
                      </>
                    )}
                  </button>
                </form>
              )}

              {importError && (
                <div className="flex items-center gap-2 text-xs text-[#DC2626] bg-red-50 border border-red-200 px-3 py-2 rounded-xl">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {importSuccessTitle && (
                <div className="flex items-center gap-2 text-xs text-[#15803D] bg-[#F1FAF4] border border-[#BBF7D0] px-3 py-2 rounded-xl font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Imported "{importSuccessTitle}"! Timestamped study segments and AI tutor context are ready.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Full-width Search Bar + Popular Topics Chips (matching Image 4) */}
          <div className="space-y-3">
            <form
              onSubmit={handleSearchSubmit}
              className="flex items-center gap-2 bg-white rounded-full border border-slate-200/90 p-1.5 pl-4 shadow-2xs focus-within:border-[#4285F4] transition-colors"
            >
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search YouTube for ${material.title.replace(/\.pdf$/i, '')} topics...`}
                aria-label="Search educational YouTube videos by topic"
                className="flex-1 bg-transparent text-xs sm:text-sm text-[#17223C] focus:outline-none"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="px-6 py-2 rounded-full bg-[#17223C] hover:bg-slate-800 text-white font-display font-semibold text-xs sm:text-sm transition-colors cursor-pointer shrink-0"
              >
                Search
              </button>
            </form>

            {/* Popular Topics Chip Strip */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-[#5D6A80] mr-1">
                Popular Topics:
              </span>
              {topicChips.map((chip) => {
                const isSelected = activeChip.toLowerCase() === chip.toLowerCase();
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setSearchQuery(chip);
                      setActiveChip(chip);
                      loadVideos(chip, true);
                    }}
                    className={`px-3.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#E8F0FE] text-[#1967D2] border-[#93C5FD] shadow-2xs'
                        : 'bg-white hover:bg-slate-50 text-[#17223C] border-slate-200/90'
                    }`}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Embedded In-App Video Player (when Watch Here is clicked) */}
          {embeddedVideoId && (
            <div className="rounded-3xl overflow-hidden border border-slate-200 bg-slate-950 shadow-lg">
              <div className="px-4 py-2.5 bg-slate-900 flex items-center justify-between text-white text-xs">
                <span className="font-semibold flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 text-[#EA4335]" />
                  <span>Watching Educational Lecture</span>
                </span>
                <button
                  type="button"
                  onClick={() => setEmbeddedVideoId(null)}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Close Player
                </button>
              </div>
              <div className="aspect-video w-full">
                <iframe
                  title="YouTube Educational Video Player"
                  src={`https://www.youtube.com/embed/${embeddedVideoId}?autoplay=1`}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {/* Horizontally Scrollable Video Recommendations Carousel (matching Image 4) */}
          {isLoading ? (
            <div className="py-14 flex flex-col items-center justify-center text-center space-y-3 bg-white/70 rounded-3xl border border-slate-200/70">
              <Loader2 className="w-8 h-8 animate-spin text-[#EA4335]" />
              <h3 className="font-display font-bold text-base text-[#17223C]">
                Searching YouTube for "{searchQuery}"...
              </h3>
              <p className="text-xs text-[#5D6A80] max-w-md">
                Finding high-clarity academic lectures and worked problem walkthroughs matched to your study material.
              </p>
            </div>
          ) : !isConfigured ? (
            <div className="rounded-3xl bg-[#FFFBEB] border border-[#FDE68A] p-6 space-y-2.5">
              <h3 className="font-display font-bold text-sm text-[#17223C]">
                Live YouTube Search Unavailable
              </h3>
              <p className="text-xs text-[#5D6A80] leading-relaxed">
                {statusReason ||
                  'Add a valid YOUTUBE_API_KEY in AI Studio Secrets to enable live YouTube Data API v3 recommendations, or click "Import YouTube URL" to study any lecture directly with Gemini.'}
              </p>
            </div>
          ) : videos.length === 0 ? (
            <div className="py-12 text-center bg-white/80 rounded-3xl border border-slate-200/80 space-y-2">
              <p className="text-sm font-semibold text-[#17223C]">
                No video recommendations found for "{searchQuery}".
              </p>
              <p className="text-xs text-[#5D6A80]">
                Try clicking another topic chip above or searching for a broader concept.
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Left Circular Carousel Arrow */}
              {videos.length > 2 && (
                <button
                  type="button"
                  onClick={() => scrollCarousel('left')}
                  aria-label="Scroll video recommendations left"
                  className="hidden sm:flex absolute -left-3.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 shadow-md items-center justify-center text-[#17223C] transition-transform active:scale-95 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}

              {/* Horizontal Scroll Container */}
              <div
                ref={scrollContainerRef}
                className="flex gap-4 overflow-x-auto no-scrollbar pb-2 pt-1 scroll-smooth snap-x snap-mandatory"
              >
                {videos.map((video, idx) => {
                  const borderStyle = cardBorderStyles[idx % cardBorderStyles.length];
                  const isThisImporting =
                    isImportingVideo && importingVideoId === video.videoId;

                  return (
                    <div
                      key={video.videoId}
                      className={`snap-start shrink-0 w-[285px] sm:w-[295px] rounded-3xl border-2 ${borderStyle} overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md transition-all`}
                    >
                      <div>
                        {/* Video Thumbnail */}
                        <div className="relative aspect-video bg-slate-900 overflow-hidden group">
                          {video.thumbnailUrl ? (
                            <img
                              src={video.thumbnailUrl}
                              alt={video.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-500">
                              <Youtube className="w-10 h-10" />
                            </div>
                          )}

                          {/* Play Button Overlay */}
                          <button
                            type="button"
                            onClick={() => setEmbeddedVideoId(video.videoId)}
                            aria-label={`Play ${video.title}`}
                            className="absolute inset-0 bg-slate-900/20 group-hover:bg-slate-900/35 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <span className="w-11 h-8 rounded-xl bg-[#EA4335] text-white flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            </span>
                          </button>

                          {video.durationText && (
                            <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-slate-950/85 text-white font-mono text-[11px] font-semibold">
                              {video.durationText}
                            </span>
                          )}
                        </div>

                        {/* Card Details */}
                        <div className="p-4 space-y-1.5">
                          <h3 className="font-display font-bold text-sm text-[#17223C] line-clamp-2 leading-snug">
                            {decodeHtmlEntities(video.title)}
                          </h3>
                          <p className="text-[11px] font-semibold text-[#5D6A80] flex items-center gap-1">
                            <span className="truncate">
                              {decodeHtmlEntities(video.channelTitle)}
                            </span>
                            <CheckCircle2 className="w-3 h-3 text-[#4285F4] shrink-0" />
                          </p>
                          <p className="text-xs text-[#5D6A80] line-clamp-2 leading-relaxed">
                            {decodeHtmlEntities(
                              video.relevanceReason ||
                                video.description ||
                                `Covers ${video.matchedConcept || searchQuery} with step-by-step examples.`
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Bottom Action Buttons matching Image 4 (Watch Here + Import / Open) */}
                      <div className="px-4 pb-4 pt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEmbeddedVideoId(video.videoId)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-[#17223C] text-xs font-bold shadow-2xs transition-colors cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 text-[#EA4335] fill-current" />
                          <span>Watch Here</span>
                        </button>

                        <button
                          type="button"
                          disabled={isImportingVideo}
                          onClick={() =>
                            handleImportYouTubeToLearnMate(
                              video.url,
                              video.title,
                              video.videoId
                            )
                          }
                          className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-[#EEF4FF] hover:bg-[#DCE8FC] text-[#1967D2] text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                          title="Import into LearnMate to generate notes, flashcards & quiz"
                        >
                          {isThisImporting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <BookOpen className="w-3.5 h-3.5" />
                          )}
                          <span>Import</span>
                        </button>

                        <a
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${video.title} on YouTube`}
                          className="p-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-[#5D6A80] hover:text-[#17223C] transition-colors"
                          title="Open on YouTube"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Circular Carousel Arrow */}
              {videos.length > 2 && (
                <button
                  type="button"
                  onClick={() => scrollCarousel('right')}
                  aria-label="Scroll video recommendations right"
                  className="hidden sm:flex absolute -right-3.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 shadow-md items-center justify-center text-[#17223C] transition-transform active:scale-95 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}

              {/* Pagination Dots matching Image 4 */}
              {videos.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 pt-3">
                  {videos.map((v, i) => (
                    <button
                      key={v.videoId}
                      type="button"
                      aria-label={`Slide ${i + 1}`}
                      onClick={() => {
                        setActiveSlideIndex(i);
                        scrollContainerRef.current?.scrollTo({
                          left: i * 300,
                          behavior: 'smooth',
                        });
                      }}
                      className={`h-2 rounded-full transition-all cursor-pointer ${
                        i === activeSlideIndex
                          ? 'w-5 bg-[#4285F4]'
                          : 'w-2 bg-slate-300 hover:bg-slate-400'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
