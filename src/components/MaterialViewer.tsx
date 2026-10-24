import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Search,
  Sparkles,
  Eye,
  AlignLeft,
  Play,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { StudyMaterial } from '../types/study';
import { renderPdfPageToDataUrl } from '../services/pdfService';
import { parseTimestampToSeconds } from '../lib/studyLogic';

interface MaterialViewerProps {
  material: StudyMaterial;
  currentPage: number;
  highlightedSnippet?: string | null;
  onSelectPage: (pageNumber: number) => void;
  onClearHighlight?: () => void;
}

export const MaterialViewer: React.FC<MaterialViewerProps> = ({
  material,
  currentPage,
  highlightedSnippet,
  onSelectPage,
  onClearHighlight,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'text' | 'pdf'>('text');
  const [renderedPageImage, setRenderedPageImage] = useState<string | null>(null);
  const [isRenderingPage, setIsRenderingPage] = useState(false);
  const [youtubeSeekSeconds, setYoutubeSeekSeconds] = useState<number>(0);

  const totalPages = material.pages.length;
  const activePageData =
    material.pages.find((p) => p.pageNumber === currentPage) ||
    material.pages[0];

  useEffect(() => {
    if (material.sourceType === 'youtube' && activePageData?.timestamp) {
      const secs =
        activePageData.timestampSeconds ??
        parseTimestampToSeconds(activePageData.timestamp);
      setYoutubeSeekSeconds(secs);
    }
  }, [material.sourceType, activePageData]);

  useEffect(() => {
    let cancelled = false;
    if (viewMode === 'pdf' && material.pdfDataUrl) {
      setIsRenderingPage(true);
      renderPdfPageToDataUrl(material.pdfDataUrl, activePageData.pageNumber)
        .then((img) => {
          if (!cancelled) setRenderedPageImage(img);
        })
        .finally(() => {
          if (!cancelled) setIsRenderingPage(false);
        });
    } else {
      setRenderedPageImage(null);
    }
    return () => {
      cancelled = true;
    };
  }, [viewMode, material.pdfDataUrl, activePageData.pageNumber]);

  const matchingPages = searchQuery.trim()
    ? material.pages.filter(
        (p) =>
          p.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const renderHighlightedContent = (content: string) => {
    const target = highlightedSnippet?.trim();
    if (!target || target.length < 6) {
      return content;
    }

    const cleanSnippet = target.replace(/\.\.\.$/, '').trim().slice(0, 60);
    if (!cleanSnippet) return content;

    const index = content.toLowerCase().indexOf(cleanSnippet.toLowerCase());
    if (index === -1) return content;

    const before = content.slice(0, index);
    const match = content.slice(index, index + cleanSnippet.length);
    const after = content.slice(index + cleanSnippet.length);

    return (
      <>
        {before}
        <mark className="bg-[#FEF08A] text-[#0F172A] px-1 py-0.5 rounded font-medium ring-2 ring-[#FACC15]">
          {match}
        </mark>
        {after}
      </>
    );
  };

  const isYouTube = material.sourceType === 'youtube';

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_6px_30px_rgba(15,23,42,0.04)] flex flex-col h-[calc(100vh-12rem)] min-h-[540px] overflow-hidden">
      {/* Top Header Bar */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              isYouTube
                ? 'bg-[#FEE2E2] text-[#EA4335]'
                : 'bg-[#DBEAFE] text-[#2563EB]'
            }`}
          >
            {isYouTube ? (
              <Play className="w-4 h-4" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-sm text-[#0F172A] truncate">
              {material.title}
            </h2>
            <p className="text-xs text-slate-500">
              {isYouTube ? (
                <>
                  Segment{' '}
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {activePageData.pageNumber}
                  </span>{' '}
                  of{' '}
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {totalPages}
                  </span>
                  {activePageData.timestamp
                    ? ` · Timestamp ${activePageData.timestamp}`
                    : ''}
                </>
              ) : (
                <>
                  Page{' '}
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {activePageData.pageNumber}
                  </span>{' '}
                  of{' '}
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {totalPages}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Page / Segment Navigation Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {material.pdfDataUrl && (
            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 mr-1">
              <button
                type="button"
                onClick={() => setViewMode('text')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                  viewMode === 'text'
                    ? 'bg-[#DBEAFE] text-[#1D4ED8]'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
                title="Indexed Text View"
              >
                <AlignLeft className="w-3 h-3" />
                <span>Text</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('pdf')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                  viewMode === 'pdf'
                    ? 'bg-[#DBEAFE] text-[#1D4ED8]'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
                title="Rendered PDF Canvas View"
              >
                <Eye className="w-3 h-3" />
                <span>PDF</span>
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={activePageData.pageNumber <= 1}
            onClick={() =>
              onSelectPage(Math.max(1, activePageData.pageNumber - 1))
            }
            aria-label="Previous page"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <select
            aria-label="Jump to page"
            value={activePageData.pageNumber}
            onChange={(e) => onSelectPage(Number(e.target.value))}
            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-mono text-xs font-semibold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#4285F4]"
          >
            {material.pages.map((p) => (
              <option key={p.pageNumber} value={p.pageNumber}>
                {isYouTube && p.timestamp
                  ? `${p.timestamp} (${p.pageNumber})`
                  : `Page ${p.pageNumber}`}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={activePageData.pageNumber >= totalPages}
            onClick={() =>
              onSelectPage(Math.min(totalPages, activePageData.pageNumber + 1))
            }
            aria-label="Next page"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Embedded YouTube Player when sourceType === 'youtube' */}
      {isYouTube && material.youtubeVideoId && (
        <div className="border-b border-slate-100 bg-slate-950">
          <div className="aspect-video w-full">
            <iframe
              key={`${material.youtubeVideoId}_${youtubeSeekSeconds}`}
              src={`https://www.youtube.com/embed/${material.youtubeVideoId}?start=${youtubeSeekSeconds}&rel=0`}
              title={material.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          </div>
          <div className="px-4 py-2 bg-slate-900 text-white flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <Clock className="w-3.5 h-3.5 text-[#FBBC05] shrink-0" />
              {material.pages.map((p) => (
                <button
                  key={p.pageNumber}
                  type="button"
                  onClick={() => onSelectPage(p.pageNumber)}
                  className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                    p.pageNumber === activePageData.pageNumber
                      ? 'bg-[#EA4335] text-white'
                      : 'bg-white/10 text-slate-200 hover:bg-white/20'
                  }`}
                >
                  {p.timestamp || `Seg ${p.pageNumber}`}
                </button>
              ))}
            </div>
            {material.youtubeUrl && (
              <a
                href={`${material.youtubeUrl}${
                  youtubeSeekSeconds > 0 ? `&t=${youtubeSeekSeconds}s` : ''
                }`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-300 hover:text-white shrink-0"
              >
                <span>YouTube</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Search within Document */}
      <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2 bg-white">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search concept or keyword across pages..."
          aria-label="Search within material"
          className="w-full text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {/* Search Matches Pill Bar */}
      {matchingPages.length > 0 && (
        <div className="px-5 py-2 bg-blue-50/70 border-b border-blue-100 flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-semibold text-[#2563EB] shrink-0">
            Found on:
          </span>
          {matchingPages.map((mp) => (
            <button
              key={mp.pageNumber}
              type="button"
              onClick={() => onSelectPage(mp.pageNumber)}
              className={`px-2 py-0.5 rounded-md text-xs font-mono font-semibold transition-colors cursor-pointer ${
                mp.pageNumber === activePageData.pageNumber
                  ? 'bg-[#2563EB] text-white'
                  : 'bg-white text-[#2563EB] border border-blue-200 hover:bg-blue-100'
              }`}
            >
              {isYouTube && mp.timestamp
                ? mp.timestamp
                : `Page ${mp.pageNumber}`}
            </button>
          ))}
        </div>
      )}

      {/* Active Citation Highlight Banner */}
      {highlightedSnippet && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-amber-900 truncate">
            <Sparkles className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
            <span className="font-semibold">
              Verified Citation on{' '}
              {isYouTube && activePageData.timestamp
                ? `Timestamp ${activePageData.timestamp}`
                : `Page ${activePageData.pageNumber}`}
            </span>
          </div>
          {onClearHighlight && (
            <button
              type="button"
              onClick={onClearHighlight}
              className="text-xs font-semibold text-amber-800 hover:underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Document Page Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[#2563EB]">
            {isYouTube && activePageData.timestamp
              ? `Timestamp ${activePageData.timestamp} — ${activePageData.title}`
              : `Page ${activePageData.pageNumber} — ${activePageData.title}`}
          </span>
        </div>

        {viewMode === 'pdf' && material.pdfDataUrl ? (
          <div className="flex flex-col items-center justify-center min-h-[360px] bg-slate-50 rounded-2xl border border-slate-200/70 p-3">
            {isRenderingPage ? (
              <p className="text-xs text-slate-500 py-12">
                Rendering PDF Page {activePageData.pageNumber}...
              </p>
            ) : renderedPageImage ? (
              <img
                src={renderedPageImage}
                alt={`Rendered Page ${activePageData.pageNumber}`}
                className="max-w-full h-auto rounded-lg shadow-sm border border-slate-200"
              />
            ) : (
              <div className="text-sm text-[#0F172A] leading-relaxed whitespace-pre-wrap font-sans w-full">
                {renderHighlightedContent(activePageData.content)}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-[#0F172A] leading-relaxed whitespace-pre-wrap font-sans selection:bg-blue-100">
            {renderHighlightedContent(activePageData.content)}
          </div>
        )}
      </div>

      {/* Bottom Page Pill Strip */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center gap-1.5 overflow-x-auto">
        {material.pages.map((p) => {
          const isCurrent = p.pageNumber === activePageData.pageNumber;
          return (
            <button
              key={p.pageNumber}
              type="button"
              onClick={() => onSelectPage(p.pageNumber)}
              className={`px-2.5 py-1 rounded-lg font-mono text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                isCurrent
                  ? 'bg-[#4285F4] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {isYouTube && p.timestamp ? p.timestamp : `P.${p.pageNumber}`}
            </button>
          );
        })}
      </div>
    </div>
  );
};
