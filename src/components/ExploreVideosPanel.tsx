import React, { useEffect, useState } from 'react';
import {
  Compass,
  Play,
  ExternalLink,
  Search,
  Loader2,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Youtube,
} from 'lucide-react';
import {
  DocumentAnalysis,
  StudyMaterial,
  YouTubeRecommendation,
} from '../types/study';
import { fetchYouTubeRecommendations } from '../services/aiClient';

interface ExploreVideosPanelProps {
  material: StudyMaterial;
  analysis: DocumentAnalysis | null;
  weakTopics: string[];
  onImportYouTubeUrl?: (url: string, title?: string) => void;
}

export const ExploreVideosPanel: React.FC<ExploreVideosPanelProps> = ({
  material,
  analysis,
  weakTopics,
  onImportYouTubeUrl,
}) => {
  const defaultQuery =
    weakTopics[0] ||
    analysis?.keyTopics[0]?.name ||
    material.title.replace(/\.pdf$/i, '');

  const [queryInput, setQueryInput] = useState(defaultQuery);
  const [activeQuery, setActiveQuery] = useState(defaultQuery);
  const [videos, setVideos] = useState<YouTubeRecommendation[]>([]);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [configReason, setConfigReason] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const nextDefault =
      weakTopics[0] ||
      analysis?.keyTopics[0]?.name ||
      material.title.replace(/\.pdf$/i, '');
    setQueryInput(nextDefault);
    setActiveQuery(nextDefault);
    handleFetchRecommendations(nextDefault, false);
  }, [material.id]);

  const handleFetchRecommendations = async (
    targetQuery: string,
    forceRefresh = false
  ) => {
    const clean = targetQuery.trim();
    if (!clean) return;
    setActiveQuery(clean);
    setIsLoading(true);
    setConfigReason(null);

    try {
      const res = await fetchYouTubeRecommendations({
        materialId: material.id,
        query: clean,
        forceRefresh,
      });
      setIsConfigured(res.configured);
      setConfigReason(res.reason || null);
      setVideos(res.videos || []);
    } catch (err: any) {
      setIsConfigured(false);
      setConfigReason(
        err?.message || 'Unable to load YouTube recommendations.'
      );
      setVideos([]);
    } finally {
      setIsLoading(false);
    }
  };

  const suggestedTopicChips = Array.from(
    new Set([
      ...weakTopics,
      ...(analysis?.keyTopics.map((t) => t.name) || []),
    ])
  ).slice(0, 5);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-[#FDF3F2] via-white to-[#F8FAFF] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#FEE2E2] text-[#EA4335] flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display font-bold text-base text-[#172033]">
              Explore Further — YouTube Learning Recommendations
            </h2>
            <p className="text-xs text-[#64748B]">
              Real educational lectures fetched via official YouTube Data API v3 for your chapter & weak concepts
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={isLoading}
          onClick={() => handleFetchRecommendations(activeQuery, true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#172033] cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Topic Chips & Search Bar */}
      <div className="px-6 py-3.5 border-b border-slate-100 bg-slate-50/60 space-y-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleFetchRecommendations(queryInput, false);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search educational videos for any chapter concept..."
              aria-label="Search YouTube educational videos"
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#4285F4]"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !queryInput.trim()}
            className="px-4 py-2 rounded-xl bg-[#4285F4] hover:bg-[#2563EB] text-white text-xs sm:text-sm font-semibold disabled:opacity-50 cursor-pointer"
          >
            Find Videos
          </button>
        </form>

        {suggestedTopicChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[#64748B] mr-1">
              Recommended Topics:
            </span>
            {suggestedTopicChips.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => {
                  setQueryInput(topic);
                  handleFetchRecommendations(topic, false);
                }}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  activeQuery.toLowerCase() === topic.toLowerCase()
                    ? 'bg-[#E8F0FE] border-[#4285F4] text-[#1967D2]'
                    : 'bg-white border-slate-200 text-[#172033] hover:bg-slate-100'
                }`}
              >
                {topic}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-[#EA4335]" />
            <h3 className="font-display font-bold text-base text-[#172033]">
              Searching Official YouTube Data API v3...
            </h3>
            <p className="text-xs text-[#64748B]">
              Finding verified educational videos for "{activeQuery}"
            </p>
          </div>
        ) : isConfigured === false ? (
          <div className="max-w-xl mx-auto rounded-3xl border border-amber-200 bg-[#FEF9EC] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FDEBB6] text-[#D97706] flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display font-bold text-base text-[#172033]">
                  YouTube Data API v3 Key Required for Live Search
                </h3>
                <p className="text-xs text-[#64748B] leading-relaxed">
                  {configReason ||
                    'LearnMate never fabricates YouTube links. To fetch live video recommendations from the official YouTube Data API v3, add YOUTUBE_API_KEY in the Secrets panel.'}
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-white/90 border border-amber-200/80 p-4 text-xs space-y-2 text-[#172033]">
              <p className="font-bold">
                Tip: You can still study any public YouTube lecture right now!
              </p>
              <p className="text-[#64748B]">
                Go to <strong>Home → YouTube Link</strong> and paste any public YouTube lecture URL to analyze it directly with Gemini video understanding.
              </p>
            </div>
          </div>
        ) : videos.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <Youtube className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="font-display font-bold text-sm text-[#172033]">
              No videos matched "{activeQuery}"
            </p>
            <p className="text-xs text-[#64748B]">
              Try searching for a broader concept or select one of your chapter topics above.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {videos.slice(0, 3).map((vid) => (
              <div
                key={vid.videoId}
                className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {vid.thumbnailUrl ? (
                    <div className="relative aspect-video bg-slate-900 overflow-hidden">
                      <img
                        src={vid.thumbnailUrl}
                        alt={vid.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/75 text-white text-[10px] font-semibold">
                        {vid.topicQuery}
                      </span>
                    </div>
                  ) : null}

                  <div className="p-4 space-y-1.5">
                    <p className="text-[11px] font-bold text-[#EA4335] truncate">
                      {vid.channelTitle}
                    </p>
                    <h3 className="font-display font-bold text-sm text-[#172033] line-clamp-2 leading-snug">
                      {vid.title}
                    </h3>
                    {vid.description && (
                      <p className="text-xs text-[#64748B] line-clamp-2">
                        {vid.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-4 pt-0 flex flex-col gap-2">
                  <a
                    href={vid.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 px-3 rounded-xl bg-[#EA4335] hover:bg-[#DC2626] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Watch on YouTube</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  {onImportYouTubeUrl && (
                    <button
                      type="button"
                      onClick={() => onImportYouTubeUrl(vid.url, vid.title)}
                      className="w-full py-1.5 px-3 rounded-xl bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1967D2] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Study This Lecture in LearnMate</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
