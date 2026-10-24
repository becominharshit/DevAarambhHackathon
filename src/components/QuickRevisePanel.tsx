import React, { useEffect, useRef, useState } from 'react';
import {
  StickyNote as StickyNoteIcon,
  Layers,
  Network,
  FileSpreadsheet,
  Sparkles,
  RefreshCw,
  Printer,
  Download,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Copy,
  ArrowRight,
} from 'lucide-react';
import {
  FlashcardItem,
  GeminiModelOption,
  MindMapData,
  MindMapNode,
  OnePageRevisionSheet,
  StickyNote,
  StickyNoteColor,
  StudyMaterial,
} from '../types/study';
import {
  generateMindMapForMaterial,
  generateQuickNotesAndFlashcards,
  generateRevisionSheetForMaterial,
} from '../services/aiClient';
import { storageService } from '../services/storageService';
import { downloadQuickRevisePdf } from '../lib/pdfReportGenerator';

export type QuickReviseMode =
  | 'sticky_notes'
  | 'flashcards'
  | 'mind_map'
  | 'revision_sheet';

interface QuickRevisePanelProps {
  material: StudyMaterial;
  selectedModel?: GeminiModelOption;
  onJumpToCitation: (pageNumber: number, snippet?: string) => void;
  initialMode?: QuickReviseMode;
  onAskTutorAboutConcept?: (conceptPrompt: string) => void;
}

const NOTE_COLORS: StickyNoteColor[] = [
  'yellow',
  'pink',
  'blue',
  'green',
  'lavender',
];

const SUBSCRIPT_CHAR_MAP: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  'ᵢ': 'i',
  'ⱼ': 'j',
  'ₖ': 'k',
  'ₙ': 'n',
};

function renderMathSymbols(text: string): React.ReactNode {
  if (!text) return null;
  return text
    .split(/([∪∩∅₀₁₂₃₄₅₆₇₈₉ᵢⱼₖₙ]+)/g)
    .map((part, idx) => {
      if (part === '∪') {
        return (
          <svg
            key={idx}
            viewBox="0 0 10 10"
            className="inline-block w-2.5 h-2.5 mx-0.5 -mt-0.5"
            aria-label="union"
          >
            <path
              d="M2 1.5v4a3 3 0 0 0 6 0v-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        );
      }
      if (part === '∩') {
        return (
          <svg
            key={idx}
            viewBox="0 0 10 10"
            className="inline-block w-2.5 h-2.5 mx-0.5 -mt-0.5"
            aria-label="intersection"
          >
            <path
              d="M2 8.5v-4a3 3 0 0 1 6 0v4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        );
      }
      if (part === '∅') {
        return (
          <svg
            key={idx}
            viewBox="0 0 10 10"
            className="inline-block w-2.5 h-2.5 mx-0.5 -mt-0.5"
            aria-label="empty set"
          >
            <circle
              cx="5"
              cy="5"
              r="3.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="2"
              y1="8"
              x2="8"
              y2="2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        );
      }
      if (/^[₀₁₂₃₄₅₆₇₈₉ᵢⱼₖₙ]+$/.test(part)) {
        const subText = Array.from(part)
          .map((ch) => SUBSCRIPT_CHAR_MAP[ch] ?? ch)
          .join('');
        return (
          <sub key={idx} className="text-[0.76em] leading-none font-semibold">
            {subText}
          </sub>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
}

export const QuickRevisePanel: React.FC<QuickRevisePanelProps> = ({
  material,
  selectedModel,
  onJumpToCitation,
  initialMode = 'sticky_notes',
  onAskTutorAboutConcept,
}) => {
  const [mode, setMode] = useState<QuickReviseMode>(initialMode);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Sticky Notes & Flashcards state
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);
  const [flashcards, setFlashcards] = useState<FlashcardItem[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  // Sticky Note editing / creation / copy state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editFormula, setEditFormula] = useState('');
  const [editColor, setEditColor] = useState<StickyNoteColor>('yellow');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [copiedNoteId, setCopiedNoteId] = useState<string | null>(null);
  const [activeNoteDot, setActiveNoteDot] = useState(0);

  const notesCarouselRef = useRef<HTMLDivElement | null>(null);

  // Flashcards interactive viewer state
  const [cardIndex, setCardIndex] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [flashcardFilter, setFlashcardFilter] = useState<'all' | 'review_again'>('all');

  // Mind Map state
  const [mindMap, setMindMap] = useState<MindMapData | null>(null);
  const [selectedNode, setSelectedNode] = useState<MindMapNode | null>(null);
  const [isLoadingMindMap, setIsLoadingMindMap] = useState(false);
  const [mindMapError, setMindMapError] = useState<string | null>(null);

  // One-Page Revision Sheet state
  const [revisionSheet, setRevisionSheet] = useState<OnePageRevisionSheet | null>(null);
  const [isLoadingSheet, setIsLoadingSheet] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [revealedRecallIndices, setRevealedRecallIndices] = useState<
    Record<number, boolean>
  >({});

  // PDF Export & Print feedback state
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportStatusMessage, setExportStatusMessage] = useState<string | null>(null);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);

  // Load cached data whenever material changes
  useEffect(() => {
    const cachedNotes = storageService.getStickyNotes(material.id);
    const cachedCards = storageService.getFlashcards(material.id);
    const cachedMap = storageService.getMindMap(material.id);
    const cachedSheet = storageService.getRevisionSheet(material.id);

    setStickyNotes(cachedNotes);
    setFlashcards(cachedCards);
    setMindMap(cachedMap);
    setSelectedNode(cachedMap?.nodes?.[0] || null);
    setRevisionSheet(cachedSheet);
    setCardIndex(0);
    setIsCardFlipped(false);
    setNotesError(null);
    setMindMapError(null);
    setSheetError(null);
    setEditingNoteId(null);
    setIsAddingNote(false);
    setActiveNoteDot(0);
    setExportStatusMessage(null);
    setExportErrorMessage(null);
  }, [material.id]);

  // Flashcard status update
  const filteredFlashcards =
    flashcardFilter === 'review_again'
      ? flashcards.filter((c) => c.status === 'review_again')
      : flashcards;

  const activeFlashcard =
    filteredFlashcards[cardIndex] || filteredFlashcards[0] || null;

  // Keyboard navigation for Flashcards (Space to flip, Left/Right arrows)
  useEffect(() => {
    if (mode !== 'flashcards' || filteredFlashcards.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsCardFlipped((prev) => !prev);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setIsCardFlipped(false);
        setCardIndex((prev) => (prev + 1) % filteredFlashcards.length);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setIsCardFlipped(false);
        setCardIndex(
          (prev) =>
            (prev - 1 + filteredFlashcards.length) % filteredFlashcards.length
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleGenerateNotesAndCards = async (forceRefresh = false) => {
    setIsLoadingNotes(true);
    setNotesError(null);
    try {
      const res = await generateQuickNotesAndFlashcards({
        material,
        forceRefresh,
        model: selectedModel,
      });
      const coloredNotes = res.stickyNotes.map((n, idx) => ({
        ...n,
        color:
          idx === 4 ? 'lavender' : n.color || NOTE_COLORS[idx % NOTE_COLORS.length],
      }));
      storageService.saveStickyNotes(material.id, coloredNotes);
      setStickyNotes(coloredNotes);
      setFlashcards(res.flashcards);
      setCardIndex(0);
      setIsCardFlipped(false);
      return { stickyNotes: coloredNotes, flashcards: res.flashcards };
    } catch (err: any) {
      setNotesError(
        err?.message || 'Unable to generate Sticky Notes and Flashcards right now.'
      );
      return null;
    } finally {
      setIsLoadingNotes(false);
    }
  };

  const handleGenerateMindMap = async (forceRefresh = false) => {
    setIsLoadingMindMap(true);
    setMindMapError(null);
    try {
      const map = await generateMindMapForMaterial({
        material,
        forceRefresh,
        model: selectedModel,
      });
      setMindMap(map);
      setSelectedNode(map.nodes[0] || null);
      return map;
    } catch (err: any) {
      setMindMapError(err?.message || 'Unable to generate Mind Map right now.');
      return null;
    } finally {
      setIsLoadingMindMap(false);
    }
  };

  const handleGenerateRevisionSheet = async (forceRefresh = false) => {
    setIsLoadingSheet(true);
    setSheetError(null);
    try {
      const sheet = await generateRevisionSheetForMaterial({
        material,
        forceRefresh,
        model: selectedModel,
      });
      setRevisionSheet(sheet);
      return sheet;
    } catch (err: any) {
      setSheetError(
        err?.message || 'Unable to generate One-Page Revision Sheet right now.'
      );
      return null;
    } finally {
      setIsLoadingSheet(false);
    }
  };

  // Sticky Note CRUD operations
  const startEditingNote = (note: StickyNote) => {
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditFormula(note.formula || '');
    setEditColor(note.color);
    setIsAddingNote(false);
  };

  const saveEditedNote = (noteId: string) => {
    const updated = stickyNotes.map((n) =>
      n.id === noteId
        ? {
            ...n,
            title: editTitle.trim() || n.title,
            content: editContent.trim() || n.content,
            formula: editFormula.trim() || undefined,
            color: editColor,
          }
        : n
    );
    setStickyNotes(updated);
    storageService.saveStickyNotes(material.id, updated);
    setEditingNoteId(null);
  };

  const handleAddCustomNote = () => {
    if (!editTitle.trim() || !editContent.trim()) return;
    const newNote: StickyNote = {
      id: `sn_custom_${Date.now()}`,
      materialId: material.id,
      title: editTitle.trim(),
      content: editContent.trim(),
      formula: editFormula.trim() || undefined,
      color: editColor,
      pageNumber: 1,
      sourceReference: material.pages[0]?.timestamp
        ? `${material.pages[0].timestamp}`
        : 'Page 1',
      timestamp: material.pages[0]?.timestamp,
    };
    const updated = [newNote, ...stickyNotes];
    setStickyNotes(updated);
    storageService.saveStickyNotes(material.id, updated);
    setIsAddingNote(false);
    setEditTitle('');
    setEditContent('');
    setEditFormula('');
  };

  const handleDeleteNote = (noteId: string) => {
    const updated = stickyNotes.filter((n) => n.id !== noteId);
    setStickyNotes(updated);
    storageService.saveStickyNotes(material.id, updated);
  };

  const handleCopyNote = (note: StickyNote) => {
    const text = `${note.title} (${note.sourceReference})\n${note.content}${
      note.formula ? `\nFormula: ${note.formula}` : ''
    }`;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedNoteId(note.id);
    setTimeout(() => {
      setCopiedNoteId((prev) => (prev === note.id ? null : prev));
    }, 2000);
  };

  const scrollNotesCarousel = (direction: 'left' | 'right') => {
    const el = notesCarouselRef.current;
    if (!el) return;
    const step = 280;
    el.scrollBy({
      left: direction === 'left' ? -step : step,
      behavior: 'smooth',
    });
    setActiveNoteDot((prev) =>
      direction === 'left'
        ? Math.max(0, prev - 1)
        : Math.min(Math.max(0, stickyNotes.length - 1), prev + 1)
    );
  };

  const handleMarkFlashcard = (status: 'know_it' | 'review_again') => {
    if (!activeFlashcard) return;
    const updated = flashcards.map((c) =>
      c.id === activeFlashcard.id ? { ...c, status } : c
    );
    setFlashcards(updated);
    storageService.saveFlashcards(material.id, updated);
    setIsCardFlipped(false);
    if (filteredFlashcards.length > 1) {
      setCardIndex((prev) => (prev + 1) % filteredFlashcards.length);
    }
  };

  // ==========================================================================
  // BUG 1 FIX: NATIVE BROWSER PRINT DIALOG WITH CLEAN A4 REVISION LAYOUT
  // ==========================================================================
  const handlePrintCurrentView = async (targetMode: QuickReviseMode = mode) => {
    setExportErrorMessage(null);
    setExportStatusMessage(null);

    try {
      // Ensure the target mode's data is loaded before opening the print dialog
      if (targetMode === 'sticky_notes' && stickyNotes.length === 0) {
        const res = await handleGenerateNotesAndCards(false);
        if (!res || res.stickyNotes.length === 0) {
          setExportErrorMessage('Please generate Sticky Notes first before printing.');
          return;
        }
      } else if (targetMode === 'flashcards' && flashcards.length === 0) {
        const res = await handleGenerateNotesAndCards(false);
        if (!res || res.flashcards.length === 0) {
          setExportErrorMessage('Please generate Flashcards first before printing.');
          return;
        }
      } else if (targetMode === 'mind_map' && !mindMap) {
        const map = await handleGenerateMindMap(false);
        if (!map) {
          setExportErrorMessage('Please generate the Mind Map first before printing.');
          return;
        }
      } else if (targetMode === 'revision_sheet' && !revisionSheet) {
        const sheet = await handleGenerateRevisionSheet(false);
        if (!sheet) {
          setExportErrorMessage(
            'Please generate the One-Page Revision Sheet first before printing.'
          );
          return;
        }
      }

      document.body.classList.add('printing-quick-revise');

      const cleanupPrintClass = () => {
        document.body.classList.remove('printing-quick-revise');
        window.removeEventListener('afterprint', cleanupPrintClass);
      };
      window.addEventListener('afterprint', cleanupPrintClass);

      // Give React a frame to ensure the A4 print layout is committed in the DOM
      await new Promise((resolve) => setTimeout(resolve, 60));

      try {
        window.focus();
      } catch {
        // ignore focus restriction in embedded contexts
      }
      window.print();

      setTimeout(cleanupPrintClass, 1500);
    } catch (err: any) {
      document.body.classList.remove('printing-quick-revise');
      setExportErrorMessage(
        err?.message || 'Unable to open the browser print dialog.'
      );
    }
  };

  // ==========================================================================
  // BUG 2 FIX: GENUINE BINARY A4 PDF DOWNLOAD ACROSS ALL 4 QUICK REVISE VIEWS
  // ==========================================================================
  const handleDownloadCurrentPdf = async (targetMode: QuickReviseMode = mode) => {
    setIsExportingPdf(true);
    setExportErrorMessage(null);
    setExportStatusMessage(null);

    try {
      let currentNotes = stickyNotes;
      let currentCards = flashcards;
      let currentMap = mindMap;
      let currentSheet = revisionSheet;

      if (targetMode === 'sticky_notes' && currentNotes.length === 0) {
        const generated = await handleGenerateNotesAndCards(false);
        if (!generated || generated.stickyNotes.length === 0) {
          throw new Error('Could not generate Sticky Notes for PDF download.');
        }
        currentNotes = generated.stickyNotes;
      } else if (targetMode === 'flashcards' && currentCards.length === 0) {
        const generated = await handleGenerateNotesAndCards(false);
        if (!generated || generated.flashcards.length === 0) {
          throw new Error('Could not generate Flashcards for PDF download.');
        }
        currentCards = generated.flashcards;
      } else if (targetMode === 'mind_map' && !currentMap) {
        const generated = await handleGenerateMindMap(false);
        if (!generated) {
          throw new Error('Could not generate Mind Map for PDF download.');
        }
        currentMap = generated;
      } else if (targetMode === 'revision_sheet' && !currentSheet) {
        const generated = await handleGenerateRevisionSheet(false);
        if (!generated) {
          throw new Error(
            'Could not generate One-Page Revision Sheet for PDF download.'
          );
        }
        currentSheet = generated;
      }

      const downloadedFilename = downloadQuickRevisePdf({
        mode: targetMode,
        materialTitle: material.title,
        stickyNotes: currentNotes,
        flashcards: currentCards,
        mindMap: currentMap,
        revisionSheet: currentSheet,
      });

      setExportStatusMessage(`Downloaded ${downloadedFilename}`);
      setTimeout(() => {
        setExportStatusMessage((prev) =>
          prev === `Downloaded ${downloadedFilename}` ? null : prev
        );
      }, 5000);
    } catch (err: any) {
      setExportErrorMessage(
        err?.message || 'Unable to generate PDF file right now.'
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const getColorClass = (color: StickyNoteColor) => {
    switch (color) {
      case 'pink':
        return 'sticky-note-pink';
      case 'blue':
        return 'sticky-note-blue';
      case 'green':
        return 'sticky-note-green';
      case 'lavender':
        return 'sticky-note-lavender';
      case 'yellow':
      default:
        return 'sticky-note-yellow';
    }
  };

  const getBranchStrokeColor = (c: MindMapNode['branchColor']) => {
    switch (c) {
      case 'red':
        return '#EA4335';
      case 'yellow':
        return '#D97706';
      case 'green':
        return '#34A853';
      case 'blue':
      default:
        return '#4285F4';
    }
  };

  const getBranchFillColor = (c: MindMapNode['branchColor']) => {
    switch (c) {
      case 'red':
        return '#FEE2E2';
      case 'yellow':
        return '#FEF3C7';
      case 'green':
        return '#DCFCE7';
      case 'blue':
      default:
        return '#E8F0FE';
    }
  };

  // Render SVG diagram for Mind Map (reused in both interactive view and A4 print sheet)
  const renderMindMapSvg = (isForPrint = false) => {
    if (!mindMap || mindMap.nodes.length === 0) return null;

    const centerNode =
      mindMap.nodes.find((n) => n.category === 'central') || mindMap.nodes[0];
    const branchNodes = mindMap.nodes.filter((n) => n.id !== centerNode.id);

    const cx = 400;
    const cy = 225;
    const rx = 235;
    const ry = 138;

    const positionedBranches = branchNodes.map((node, idx) => {
      const angle =
        (idx / Math.max(1, branchNodes.length)) * 2 * Math.PI - Math.PI / 2;
      return {
        node,
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
      };
    });

    return (
      <svg
        viewBox="0 0 800 450"
        className={
          isForPrint
            ? 'w-full h-auto max-h-[340px]'
            : 'w-full h-auto min-w-[540px] select-none'
        }
        role="img"
        aria-label={`Interactive mind map for ${mindMap.centralTopic}`}
      >
        {/* Connecting Edges */}
        {positionedBranches.map(({ node, x, y }) => {
          const edge = mindMap.edges.find(
            (e) =>
              (e.from === centerNode.id && e.to === node.id) ||
              (e.to === centerNode.id && e.from === node.id)
          );
          const midX = (cx + x) / 2;
          const midY = (cy + y) / 2;
          return (
            <g key={`edge_${node.id}`}>
              <path
                d={`M ${cx} ${cy} Q ${midX} ${cy} ${x} ${y}`}
                fill="none"
                stroke={getBranchStrokeColor(node.branchColor)}
                strokeWidth="2.5"
                strokeDasharray={node.category === 'leaf' ? '5 4' : undefined}
                opacity="0.75"
              />
              {edge?.relationLabel && (
                <g transform={`translate(${midX}, ${midY})`}>
                  <rect
                    x="-42"
                    y="-10"
                    width="84"
                    height="20"
                    rx="10"
                    fill="#FFFFFF"
                    stroke="#E2E8F0"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fontSize="10"
                    fill="#64748B"
                    fontWeight="600"
                  >
                    {edge.relationLabel.slice(0, 16)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Central Node */}
        <g
          onClick={isForPrint ? undefined : () => setSelectedNode(centerNode)}
          className={isForPrint ? '' : 'cursor-pointer'}
        >
          <rect
            x={cx - 95}
            y={cy - 32}
            width="190"
            height="64"
            rx="20"
            fill="#17223C"
            stroke={
              !isForPrint && selectedNode?.id === centerNode.id
                ? '#4285F4'
                : '#334155'
            }
            strokeWidth="3"
          />
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="13"
            fontWeight="700"
          >
            {centerNode.label.slice(0, 24)}
          </text>
          <text
            x={cx}
            y={cy + 15}
            textAnchor="middle"
            fill="#93C5FD"
            fontSize="10"
            fontWeight="600"
          >
            Central Theme · {centerNode.sourceReference}
          </text>
        </g>

        {/* Branch Nodes */}
        {positionedBranches.map(({ node, x, y }) => {
          const isSelected = !isForPrint && selectedNode?.id === node.id;
          const stroke = getBranchStrokeColor(node.branchColor);
          const fill = getBranchFillColor(node.branchColor);
          return (
            <g
              key={node.id}
              onClick={isForPrint ? undefined : () => setSelectedNode(node)}
              className={isForPrint ? '' : 'cursor-pointer transition-transform'}
            >
              <rect
                x={x - 84}
                y={y - 28}
                width="168"
                height="56"
                rx="16"
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected ? '3' : '1.75'}
              />
              <text
                x={x}
                y={y - 3}
                textAnchor="middle"
                fill="#0F172A"
                fontSize="12"
                fontWeight="700"
              >
                {node.label.length > 22
                  ? `${node.label.slice(0, 20)}…`
                  : node.label}
              </text>
              <text
                x={x}
                y={y + 14}
                textAnchor="middle"
                fill={stroke}
                fontSize="10"
                fontWeight="700"
              >
                {node.sourceReference}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  // Render interactive radial SVG Mind Map + Node Inspector
  const renderMindMapCanvas = () => {
    if (!mindMap || mindMap.nodes.length === 0) return null;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 bg-[#F8FAFF] rounded-3xl border border-slate-200/80 p-3 overflow-x-auto">
          {renderMindMapSvg(false)}
        </div>

        {/* Selected Node Details Inspector */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-200/80 p-5 space-y-3.5 shadow-2xs">
          {selectedNode ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#4285F4]">
                    {selectedNode.category === 'central'
                      ? 'Central Concept'
                      : 'Connected Concept Node'}
                  </span>
                  <h4 className="font-display font-bold text-base text-[#17223C] mt-0.5">
                    {selectedNode.label}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => onJumpToCitation(selectedNode.pageNumber)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1D4ED8] text-xs font-semibold shrink-0 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>{selectedNode.sourceReference}</span>
                </button>
              </div>

              <p className="text-xs sm:text-sm text-[#5D6A80] leading-relaxed">
                {renderMathSymbols(selectedNode.summary)}
              </p>

              {selectedNode.formula && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 font-mono text-xs text-[#17223C] font-semibold">
                  {renderMathSymbols(selectedNode.formula)}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onJumpToCitation(selectedNode.pageNumber)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-[#17223C] hover:bg-slate-50 cursor-pointer"
                >
                  Inspect {selectedNode.sourceReference}
                </button>
                {onAskTutorAboutConcept && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskTutorAboutConcept(
                        `Explain "${selectedNode.label}" and how it connects to ${mindMap.centralTopic}.`
                      )
                    }
                    className="px-3.5 py-1.5 rounded-xl bg-[#4285F4] hover:bg-[#2563EB] text-white text-xs font-semibold cursor-pointer"
                  >
                    Ask AI Tutor
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-[#5D6A80]">
              Click any node in the mind map to view its concise explanation, formula, and source page reference.
            </p>
          )}
        </div>
      </div>
    );
  };

  const modeDisplayLabel =
    mode === 'sticky_notes'
      ? 'Sticky Notes'
      : mode === 'flashcards'
        ? 'Active-Recall Flashcards'
        : mode === 'mind_map'
          ? 'Concept Mind Map'
          : 'One-Page Revision Sheet';

  return (
    <div className="google-gradient-panel rounded-[28px] p-6 sm:p-8 flex flex-col space-y-6">
      {/* Top Sub-Navigation Header matching Image 6 */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-slate-200/70 no-print">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706] flex items-center justify-center shrink-0 shadow-2xs">
            <StickyNoteIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display font-extrabold text-xl sm:text-2xl text-[#17223C]">
              Quick Revise
            </h2>
            <p className="text-xs sm:text-sm text-[#5D6A80]">
              Handwritten-style sticky notes, active-recall flashcards, mind maps & printable revision sheets
            </p>
          </div>
        </div>

        {/* Segmented Sub-Tool Pills matching Image 6 */}
        <div
          className="inline-flex flex-wrap items-center gap-1.5 bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/70 self-start xl:self-auto"
          role="tablist"
          aria-label="Quick Revise Tools"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sticky_notes'}
            onClick={() => setMode('sticky_notes')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              mode === 'sticky_notes'
                ? 'bg-white text-[#D97706] shadow-xs'
                : 'text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <StickyNoteIcon className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>Sticky Notes</span>
            {stickyNotes.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-md bg-[#FEF3C7] text-[#B45309] text-[11px] font-extrabold tabular-nums">
                {stickyNotes.length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'flashcards'}
            onClick={() => setMode('flashcards')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              mode === 'flashcards'
                ? 'bg-white text-[#1967D2] shadow-xs'
                : 'text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#4285F4]" />
            <span>Flashcards</span>
            {flashcards.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-md bg-[#E8F0FE] text-[#1967D2] text-[11px] font-extrabold tabular-nums">
                {flashcards.length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'mind_map'}
            onClick={() => setMode('mind_map')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              mode === 'mind_map'
                ? 'bg-white text-[#15803D] shadow-xs'
                : 'text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <Network className="w-3.5 h-3.5 text-[#34A853]" />
            <span>Mind Map</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'revision_sheet'}
            onClick={() => setMode('revision_sheet')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              mode === 'revision_sheet'
                ? 'bg-white text-[#DC2626] shadow-xs'
                : 'text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#EA4335]" />
            <span>One-Page Revision</span>
          </button>
        </div>
      </div>

      {/* Export / Print Feedback Banner (Screen Only) */}
      {exportStatusMessage && (
        <div
          role="status"
          className="no-print flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-[#F1FAF4] border border-[#BBF7D0] text-xs font-semibold text-[#15803D]"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{exportStatusMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportStatusMessage(null)}
            aria-label="Dismiss export notification"
            className="p-1 rounded-lg hover:bg-white/60 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {exportErrorMessage && (
        <div
          role="alert"
          className="no-print flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#DC2626]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{exportErrorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportErrorMessage(null)}
            aria-label="Dismiss export error"
            className="p-1 rounded-lg hover:bg-white/60 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* INTERACTIVE SCREEN CONTENT AREA (Hidden during A4 Print)             */}
      {/* ==================================================================== */}
      <div className="quick-revise-screen-only space-y-5">
        {/* ================================================================ */}
        {/* SUB-TOOL 1: HANDWRITTEN STICKY NOTES                             */}
        {/* ================================================================ */}
        {mode === 'sticky_notes' && (
          <>
            {/* Secondary Action Bar matching Image 6 */}
            <div className="flex flex-wrap items-center justify-between gap-3 no-print">
              <p className="text-xs sm:text-sm text-[#5D6A80]">
                Handwritten-style sticky notes generated from{' '}
                <strong className="text-[#17223C]">{material.title}</strong>. Click any page badge to jump to the source.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNote(true);
                    setEditingNoteId(null);
                    setEditTitle('');
                    setEditContent('');
                    setEditFormula('');
                    setEditColor('yellow');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-bold text-[#17223C] shadow-2xs transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#17223C]" />
                  <span>Add Note</span>
                </button>

                {stickyNotes.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handlePrintCurrentView('sticky_notes')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-bold text-[#17223C] shadow-2xs transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#4285F4]" />
                      <span>Print Notes</span>
                    </button>

                    <button
                      type="button"
                      disabled={isExportingPdf}
                      onClick={() => handleDownloadCurrentPdf('sticky_notes')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-bold text-[#1967D2] shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {isExportingPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4285F4]" />
                      ) : (
                        <Download className="w-3.5 h-3.5 text-[#4285F4]" />
                      )}
                      <span>Download PDF</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  disabled={isLoadingNotes}
                  onClick={() => handleGenerateNotesAndCards(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FEF3C7]/90 hover:bg-[#FDE68A] border border-[#FDE68A] text-xs font-bold text-[#92400E] shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isLoadingNotes ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {stickyNotes.length > 0 ? 'Regenerate' : 'Generate Sticky Notes'}
                  </span>
                </button>
              </div>
            </div>

            {/* Add Custom Sticky Note Form */}
            {isAddingNote && (
              <div className="rounded-3xl border border-amber-300 bg-[#FFFBEB] p-5 space-y-3 no-print">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#92400E]">
                    New Custom Sticky Note
                  </span>
                  <div className="flex items-center gap-1.5">
                    {NOTE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditColor(c)}
                        aria-label={`Select ${c} sticky note color`}
                        className={`w-5 h-5 rounded-full border ${getColorClass(c)} ${
                          editColor === c ? 'ring-2 ring-slate-800' : ''
                        } cursor-pointer`}
                      />
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Concept Title (e.g., Bayes' Theorem)"
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm font-bold text-[#17223C]"
                />
                <textarea
                  rows={2}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Write a short memory-friendly takeaway (1-3 lines)..."
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm font-handwriting text-[#17223C]"
                />
                <input
                  type="text"
                  value={editFormula}
                  onChange={(e) => setEditFormula(e.target.value)}
                  placeholder="Optional key formula (e.g., P(B|A) = P(A|B)P(B)/P(A))"
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-mono text-[#17223C]"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddingNote(false)}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-white/60 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddCustomNote}
                    className="px-4 py-1.5 rounded-xl bg-[#17223C] text-white text-xs font-semibold cursor-pointer"
                  >
                    Save Sticky Note
                  </button>
                </div>
              </div>
            )}

            {isLoadingNotes ? (
              <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#F59E0B]" />
                <h3 className="font-display font-bold text-base text-[#17223C]">
                  Crafting Handwritten Sticky Notes & Flashcards...
                </h3>
                <p className="text-xs text-[#5D6A80] max-w-sm">
                  Distilling key definitions, formulas, and exam takeaways from {material.title}.
                </p>
              </div>
            ) : notesError ? (
              <div className="p-6 rounded-3xl bg-red-50 border border-red-200 text-center space-y-3">
                <p className="text-sm font-semibold text-[#DC2626]">{notesError}</p>
                <button
                  type="button"
                  onClick={() => handleGenerateNotesAndCards(true)}
                  className="px-5 py-2 rounded-full bg-[#EA4335] text-white text-xs font-semibold cursor-pointer"
                >
                  Try Again
                </button>
              </div>
            ) : stickyNotes.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center">
                  <StickyNoteIcon className="w-7 h-7" />
                </div>
                <div className="max-w-md space-y-1.5">
                  <h3 className="font-display font-bold text-lg text-[#17223C]">
                    Generate Bite-Sized Sticky Notes
                  </h3>
                  <p className="text-xs sm:text-sm text-[#5D6A80]">
                    Create 6 color-coded, handwritten-style sticky notes and 4 paired active-recall flashcards strictly grounded in{' '}
                    <span className="font-semibold text-[#17223C]">{material.title}</span>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerateNotesAndCards(false)}
                  className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#F59E0B] hover:bg-[#D97706] text-white font-display font-semibold text-sm shadow-sm transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Sticky Notes & Flashcards</span>
                </button>
              </div>
            ) : (
              <div className="relative">
                {/* Left Circular Navigation Button matching Image 6 */}
                <button
                  type="button"
                  onClick={() => scrollNotesCarousel('left')}
                  aria-label="Scroll sticky notes left"
                  className="hidden sm:flex absolute -left-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 shadow-md items-center justify-center text-[#17223C] transition-transform active:scale-95 cursor-pointer no-print"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* Horizontally Scrollable Sticky Notes Row matching Image 6 */}
                <div
                  ref={notesCarouselRef}
                  className="flex gap-4 overflow-x-auto no-scrollbar pb-3 pt-1 px-1 scroll-smooth snap-x snap-mandatory sticky-note-print-grid"
                >
                  {stickyNotes.map((note) => {
                    const isEditing = editingNoteId === note.id;
                    return (
                      <div
                        key={note.id}
                        className={`snap-start shrink-0 w-[260px] sm:w-[268px] rounded-[24px] border-2 p-5 transition-all shadow-[0_6px_20px_rgba(15,23,42,0.04)] hover:shadow-[0_10px_26px_rgba(15,23,42,0.08)] flex flex-col justify-between min-h-[268px] print-card ${getColorClass(
                          note.color
                        )}`}
                      >
                        {isEditing ? (
                          <div className="space-y-2.5 no-print">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white/90 border border-slate-300 text-xs font-bold text-slate-900"
                            />
                            <textarea
                              rows={3}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white/90 border border-slate-300 text-xs font-handwriting text-slate-900"
                            />
                            <input
                              type="text"
                              value={editFormula}
                              onChange={(e) => setEditFormula(e.target.value)}
                              placeholder="Formula (optional)"
                              className="w-full px-2.5 py-1 rounded-lg bg-white/90 border border-slate-300 text-[11px] font-mono text-slate-900"
                            />
                            <div className="flex items-center justify-between pt-1">
                              <div className="flex items-center gap-1">
                                {NOTE_COLORS.map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => setEditColor(c)}
                                    className={`w-4 h-4 rounded-full border ${getColorClass(
                                      c
                                    )} ${
                                      editColor === c ? 'ring-2 ring-slate-900' : ''
                                    } cursor-pointer`}
                                  />
                                ))}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditingNoteId(null)}
                                  className="p-1 rounded bg-white/80 text-slate-700 cursor-pointer"
                                  aria-label="Cancel edit"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => saveEditedNote(note.id)}
                                  className="p-1 rounded bg-slate-900 text-white cursor-pointer"
                                  aria-label="Save note"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-3">
                              {/* Note Header: Concept Title + Clickable Page Badge */}
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="font-display font-extrabold text-[15px] leading-snug tracking-tight">
                                  {note.title}
                                </h3>
                                <button
                                  type="button"
                                  onClick={() => onJumpToCitation(note.pageNumber)}
                                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/85 hover:bg-white text-[11px] font-bold text-slate-800 border border-black/10 shrink-0 shadow-2xs cursor-pointer"
                                  title={`Open ${note.sourceReference}`}
                                >
                                  <span>{note.sourceReference}</span>
                                </button>
                              </div>

                              {/* Handwritten Body Text (Kalam) */}
                              <p className="font-handwriting text-[15px] leading-relaxed">
                                {renderMathSymbols(note.content)}
                              </p>

                              {/* Highlighted Formula Box matching Image 6 */}
                              {note.formula && (
                                <div className="px-3 py-2 rounded-xl bg-white/85 border border-black/10 font-sans text-xs font-bold text-slate-900 tracking-tight break-words shadow-2xs">
                                  {renderMathSymbols(note.formula)}
                                </div>
                              )}
                            </div>

                            {/* Bottom Utility Toolbar matching Image 6 */}
                            <div className="pt-3 mt-3 border-t border-black/10 flex items-center justify-between no-print">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => startEditingNote(note)}
                                  className="p-1.5 rounded-lg hover:bg-white/70 text-slate-700 transition-colors cursor-pointer"
                                  aria-label={`Edit ${note.title}`}
                                  title="Edit note"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyNote(note)}
                                  className="p-1.5 rounded-lg hover:bg-white/70 text-slate-700 transition-colors cursor-pointer"
                                  aria-label={`Copy ${note.title}`}
                                  title="Copy note text"
                                >
                                  {copiedNoteId === note.id ? (
                                    <Check className="w-3.5 h-3.5 text-[#15803D]" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteNote(note.id)}
                                  className="p-1.5 rounded-lg hover:bg-white/70 text-slate-700 hover:text-red-600 transition-colors cursor-pointer"
                                  aria-label={`Delete ${note.title}`}
                                  title="Delete note"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => setMode('flashcards')}
                                className="inline-flex items-center gap-1 text-[11px] font-extrabold text-slate-800 hover:underline cursor-pointer"
                              >
                                <span>Practice Card</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Right Circular Navigation Button matching Image 6 */}
                <button
                  type="button"
                  onClick={() => scrollNotesCarousel('right')}
                  aria-label="Scroll sticky notes right"
                  className="hidden sm:flex absolute -right-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 shadow-md items-center justify-center text-[#17223C] transition-transform active:scale-95 cursor-pointer no-print"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                {/* Bottom Carousel Pagination Dots matching Image 6 */}
                {stickyNotes.length > 1 && (
                  <div className="flex items-center justify-center gap-1.5 pt-2 no-print">
                    {stickyNotes.map((n, idx) => (
                      <button
                        key={n.id}
                        type="button"
                        aria-label={`Go to sticky note ${idx + 1}`}
                        onClick={() => {
                          setActiveNoteDot(idx);
                          notesCarouselRef.current?.scrollTo({
                            left: idx * 270,
                            behavior: 'smooth',
                          });
                        }}
                        className={`h-2 rounded-full transition-all cursor-pointer ${
                          idx === activeNoteDot
                            ? 'w-5 bg-[#4285F4]'
                            : 'w-2 bg-slate-300 hover:bg-slate-400'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ================================================================ */}
        {/* SUB-TOOL 2: INTERACTIVE FLASHCARDS                               */}
        {/* ================================================================ */}
        {mode === 'flashcards' && (
          <>
            {/* Flashcards Action Bar with Print & Download PDF */}
            <div className="flex flex-wrap items-center justify-between gap-3 no-print">
              <p className="text-xs sm:text-sm text-[#5D6A80]">
                Active-recall flashcards generated from{' '}
                <strong className="text-[#17223C]">{material.title}</strong>. Click card or press Spacebar to flip.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {flashcards.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handlePrintCurrentView('flashcards')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-bold text-[#17223C] shadow-2xs transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#4285F4]" />
                      <span>Print Flashcards</span>
                    </button>

                    <button
                      type="button"
                      disabled={isExportingPdf}
                      onClick={() => handleDownloadCurrentPdf('flashcards')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-bold text-[#1967D2] shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {isExportingPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4285F4]" />
                      ) : (
                        <Download className="w-3.5 h-3.5 text-[#4285F4]" />
                      )}
                      <span>Download PDF</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  disabled={isLoadingNotes}
                  onClick={() => handleGenerateNotesAndCards(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#E8F0FE] hover:bg-[#D2E3FC] border border-[#BFDBFE] text-xs font-bold text-[#1967D2] shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isLoadingNotes ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {flashcards.length > 0 ? 'Regenerate' : 'Generate Flashcards'}
                  </span>
                </button>
              </div>
            </div>

            {isLoadingNotes ? (
              <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#4285F4]" />
                <h3 className="font-display font-bold text-base text-[#17223C]">
                  Generating Active-Recall Flashcards...
                </h3>
              </div>
            ) : flashcards.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-[#E8F0FE] text-[#4285F4] flex items-center justify-center">
                  <Layers className="w-7 h-7" />
                </div>
                <div className="max-w-md space-y-1.5">
                  <h3 className="font-display font-bold text-lg text-[#17223C]">
                    Active-Recall Flashcards
                  </h3>
                  <p className="text-xs sm:text-sm text-[#5D6A80]">
                    Generate interactive flip cards from{' '}
                    <span className="font-semibold text-[#17223C]">{material.title}</span>{' '}
                    to test definitions, formulas, and conceptual intuition.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerateNotesAndCards(false)}
                  className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-semibold text-sm shadow-sm cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Flashcards</span>
                </button>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-5">
                {/* Filter & Progress Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFlashcardFilter('all');
                        setCardIndex(0);
                        setIsCardFlipped(false);
                      }}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                        flashcardFilter === 'all'
                          ? 'bg-[#17223C] text-white'
                          : 'bg-slate-100 text-[#5D6A80]'
                      }`}
                    >
                      All Cards ({flashcards.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFlashcardFilter('review_again');
                        setCardIndex(0);
                        setIsCardFlipped(false);
                      }}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                        flashcardFilter === 'review_again'
                          ? 'bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A]'
                          : 'bg-slate-100 text-[#5D6A80]'
                      }`}
                    >
                      Review Again (
                      {flashcards.filter((c) => c.status === 'review_again').length})
                    </button>
                  </div>

                  <span className="text-xs font-semibold text-[#5D6A80] tabular-nums">
                    Mastered:{' '}
                    <strong className="text-[#34A853]">
                      {flashcards.filter((c) => c.status === 'know_it').length}
                    </strong>{' '}
                    / {flashcards.length}
                  </span>
                </div>

                {filteredFlashcards.length === 0 ? (
                  <div className="p-8 rounded-3xl bg-[#F1FAF4] border border-[#BBF7D0] text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-[#16A34A] mx-auto" />
                    <h4 className="font-display font-bold text-sm text-[#17223C]">
                      No cards marked "Review Again"!
                    </h4>
                    <button
                      type="button"
                      onClick={() => setFlashcardFilter('all')}
                      className="text-xs font-semibold text-[#1967D2] underline cursor-pointer"
                    >
                      Show all flashcards
                    </button>
                  </div>
                ) : (
                  activeFlashcard && (
                    <div className="space-y-4">
                      {/* Interactive Flip Card */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setIsCardFlipped((f) => !f)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsCardFlipped((f) => !f);
                          }
                        }}
                        aria-label="Flashcard. Click or press Space to flip."
                        className={`w-full min-h-[250px] rounded-3xl border-2 p-6 sm:p-8 flex flex-col justify-between transition-all cursor-pointer select-none shadow-sm ${
                          isCardFlipped
                            ? 'bg-gradient-to-br from-[#F3F8FF] via-white to-[#F1FAF4] border-[#4285F4]'
                            : 'bg-white border-slate-200/90 hover:border-[#93C5FD]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span
                            className={`font-bold uppercase tracking-wider ${
                              isCardFlipped ? 'text-[#34A853]' : 'text-[#4285F4]'
                            }`}
                          >
                            {isCardFlipped
                              ? 'Back · Answer & Explanation'
                              : `Card ${cardIndex + 1} of ${filteredFlashcards.length} · ${activeFlashcard.topic}`}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onJumpToCitation(activeFlashcard.pageNumber);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E8F0FE] text-[#1D4ED8] font-semibold cursor-pointer"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>{activeFlashcard.sourceReference}</span>
                          </button>
                        </div>

                        <div className="my-auto py-5 text-center space-y-3">
                          {!isCardFlipped ? (
                            <h3 className="font-display font-bold text-lg sm:text-xl text-[#17223C] leading-snug">
                              {renderMathSymbols(activeFlashcard.frontPrompt)}
                            </h3>
                          ) : (
                            <>
                              <p className="text-sm sm:text-base text-[#17223C] leading-relaxed">
                                {renderMathSymbols(activeFlashcard.backExplanation)}
                              </p>
                              {activeFlashcard.formula && (
                                <div className="inline-block px-4 py-2 rounded-xl bg-white border border-blue-200 font-mono text-xs sm:text-sm font-bold text-[#1D4ED8]">
                                  {renderMathSymbols(activeFlashcard.formula)}
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-[#5D6A80]">
                          <span>
                            Status:{' '}
                            <strong className="text-[#17223C]">
                              {activeFlashcard.status === 'know_it'
                                ? 'Know it'
                                : activeFlashcard.status === 'review_again'
                                  ? 'Review again'
                                  : 'Unreviewed'}
                            </strong>
                          </span>
                          <span>Click card or press Spacebar to flip</span>
                        </div>
                      </div>

                      {/* Controls Row */}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setIsCardFlipped(false);
                            setCardIndex(
                              (i) =>
                                (i - 1 + filteredFlashcards.length) %
                                filteredFlashcards.length
                            );
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-[#17223C] hover:bg-slate-50 cursor-pointer"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          <span>Previous</span>
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleMarkFlashcard('review_again')}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FEF9EC] hover:bg-[#FDE68A] text-[#B45309] text-xs font-bold border border-[#FDE68A] transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Review Again</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkFlashcard('know_it')}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#34A853] hover:bg-[#16A34A] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Know It</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setIsCardFlipped(false);
                            setCardIndex((i) => (i + 1) % filteredFlashcards.length);
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-[#17223C] hover:bg-slate-50 cursor-pointer"
                        >
                          <span>Next</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </>
        )}

        {/* ================================================================ */}
        {/* SUB-TOOL 3: INTERACTIVE MIND MAP                                 */}
        {/* ================================================================ */}
        {mode === 'mind_map' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 no-print">
              <p className="text-xs sm:text-sm text-[#5D6A80]">
                Interactive concept graph for{' '}
                <strong className="text-[#17223C]">{material.title}</strong>. Click any node to inspect its formula and jump to the source page.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {mindMap && (
                  <>
                    <button
                      type="button"
                      onClick={() => handlePrintCurrentView('mind_map')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-bold text-[#17223C] shadow-2xs transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#4285F4]" />
                      <span>Print Mind Map</span>
                    </button>

                    <button
                      type="button"
                      disabled={isExportingPdf}
                      onClick={() => handleDownloadCurrentPdf('mind_map')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-bold text-[#1967D2] shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {isExportingPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4285F4]" />
                      ) : (
                        <Download className="w-3.5 h-3.5 text-[#4285F4]" />
                      )}
                      <span>Download PDF</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  disabled={isLoadingMindMap}
                  onClick={() => handleGenerateMindMap(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#DCFCE7] hover:bg-[#BBF7D0] text-[#15803D] text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isLoadingMindMap ? 'animate-spin' : ''}`}
                  />
                  <span>{mindMap ? 'Regenerate Map' : 'Generate Mind Map'}</span>
                </button>
              </div>
            </div>

            {isLoadingMindMap ? (
              <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#34A853]" />
                <h3 className="font-display font-bold text-base text-[#17223C]">
                  Mapping Chapter Concept Relationships...
                </h3>
                <p className="text-xs text-[#5D6A80] max-w-sm">
                  Gemini is extracting central concepts, branches, child sub-topics, and verified source references from {material.title}.
                </p>
              </div>
            ) : mindMapError ? (
              <div className="p-6 rounded-2xl bg-red-50 border border-red-200 text-center space-y-3">
                <p className="text-sm font-semibold text-[#DC2626]">{mindMapError}</p>
                <button
                  type="button"
                  onClick={() => handleGenerateMindMap(true)}
                  className="px-5 py-2 rounded-full bg-[#34A853] text-white text-xs font-semibold cursor-pointer"
                >
                  Try Again
                </button>
              </div>
            ) : !mindMap ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-[#DCFCE7] text-[#34A853] flex items-center justify-center">
                  <Network className="w-7 h-7" />
                </div>
                <div className="max-w-md space-y-1.5">
                  <h3 className="font-display font-bold text-lg text-[#17223C]">
                    Interactive Visual Mind Map
                  </h3>
                  <p className="text-xs sm:text-sm text-[#5D6A80]">
                    Visualize how concepts, formulas, and theorems in{' '}
                    <span className="font-semibold text-[#17223C]">{material.title}</span>{' '}
                    connect to one another.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerateMindMap(false)}
                  className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#34A853] hover:bg-[#16A34A] text-white font-display font-semibold text-sm shadow-sm cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Mind Map</span>
                </button>
              </div>
            ) : (
              renderMindMapCanvas()
            )}
          </>
        )}

        {/* ================================================================ */}
        {/* SUB-TOOL 4: ONE-PAGE REVISION SHEET                              */}
        {/* ================================================================ */}
        {mode === 'revision_sheet' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 no-print">
              <p className="text-xs sm:text-sm text-[#5D6A80]">
                Distilled one-page exam revision sheet for{' '}
                <strong className="text-[#17223C]">{material.title}</strong>.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {revisionSheet && (
                  <>
                    <button
                      type="button"
                      onClick={() => handlePrintCurrentView('revision_sheet')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-[#17223C] shadow-2xs cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#4285F4]" />
                      <span>Print Sheet</span>
                    </button>

                    <button
                      type="button"
                      disabled={isExportingPdf}
                      onClick={() => handleDownloadCurrentPdf('revision_sheet')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-[#1967D2] shadow-2xs disabled:opacity-50 cursor-pointer"
                    >
                      {isExportingPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4285F4]" />
                      ) : (
                        <Download className="w-3.5 h-3.5 text-[#4285F4]" />
                      )}
                      <span>Download PDF</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={isLoadingSheet}
                  onClick={() => handleGenerateRevisionSheet(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FEE2E2] hover:bg-[#FECACA] text-[#DC2626] text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isLoadingSheet ? 'animate-spin' : ''}`}
                  />
                  <span>{revisionSheet ? 'Regenerate Sheet' : 'Generate Sheet'}</span>
                </button>
              </div>
            </div>

            {isLoadingSheet ? (
              <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#EA4335]" />
                <h3 className="font-display font-bold text-base text-[#17223C]">
                  Compiling One-Page Exam Revision Sheet...
                </h3>
                <p className="text-xs text-[#5D6A80] max-w-sm">
                  Distilling essential concepts, formulas, relationships, common mistakes, and recall questions from {material.title}.
                </p>
              </div>
            ) : sheetError ? (
              <div className="p-6 rounded-2xl bg-red-50 border border-red-200 text-center space-y-3">
                <p className="text-sm font-semibold text-[#DC2626]">{sheetError}</p>
                <button
                  type="button"
                  onClick={() => handleGenerateRevisionSheet(true)}
                  className="px-5 py-2 rounded-full bg-[#EA4335] text-white text-xs font-semibold cursor-pointer"
                >
                  Try Again
                </button>
              </div>
            ) : !revisionSheet ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-[#FEE2E2] text-[#EA4335] flex items-center justify-center">
                  <FileSpreadsheet className="w-7 h-7" />
                </div>
                <div className="max-w-md space-y-1.5">
                  <h3 className="font-display font-bold text-lg text-[#17223C]">
                    One-Page Exam Revision Sheet
                  </h3>
                  <p className="text-xs sm:text-sm text-[#5D6A80]">
                    Generate a clean, A4-printable summary sheet for{' '}
                    <span className="font-semibold text-[#17223C]">{material.title}</span>{' '}
                    with essential concepts, key formulas, common traps, and rapid self-check recall questions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerateRevisionSheet(false)}
                  className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#EA4335] hover:bg-[#DC2626] text-white font-display font-semibold text-sm shadow-sm cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate One-Page Revision</span>
                </button>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xs space-y-6 print-card">
                <div className="border-b-2 border-[#4285F4] pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#4285F4]">
                      LearnMate One-Page Revision Sheet
                    </span>
                    <h3 className="font-display text-xl sm:text-2xl font-bold text-[#17223C] mt-0.5">
                      {revisionSheet.chapterTitle}
                    </h3>
                  </div>
                  <span className="text-xs text-[#5D6A80]">
                    Updated {new Date(revisionSheet.generatedAt).toLocaleDateString()}
                  </span>
                </div>

                <p className="text-xs sm:text-sm text-[#17223C] leading-relaxed bg-[#F8FAFF] rounded-2xl p-4 border border-[#DCE8FC]">
                  {renderMathSymbols(revisionSheet.overview)}
                </p>

                {/* 1. Essential Concepts */}
                <div className="space-y-3">
                  <h4 className="font-display font-bold text-sm uppercase tracking-wider text-[#4285F4]">
                    1. Essential Concepts
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {revisionSheet.essentialConcepts.map((c, idx) => (
                      <div
                        key={idx}
                        className="rounded-2xl border border-slate-200/80 p-3.5 bg-slate-50/50 space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h5 className="font-display font-bold text-xs sm:text-sm text-[#17223C]">
                            {c.title}
                          </h5>
                          <button
                            type="button"
                            onClick={() => onJumpToCitation(c.pageNumber)}
                            className="px-2 py-0.5 rounded bg-[#E8F0FE] text-[#1D4ED8] text-[10px] font-bold shrink-0 cursor-pointer"
                          >
                            {c.sourceReference}
                          </button>
                        </div>
                        <p className="text-xs text-[#5D6A80] leading-relaxed">
                          {renderMathSymbols(c.explanation)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Important Formulas & Definitions */}
                <div className="space-y-3">
                  <h4 className="font-display font-bold text-sm uppercase tracking-wider text-[#34A853]">
                    2. Key Formulas & Definitions
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {revisionSheet.formulasAndDefinitions.map((f, idx) => (
                      <div
                        key={idx}
                        className="rounded-2xl border border-emerald-200/80 bg-[#F1FAF4]/60 p-3.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display font-bold text-xs text-[#17223C]">
                            {f.term}
                          </span>
                          <button
                            type="button"
                            onClick={() => onJumpToCitation(f.pageNumber)}
                            className="text-[10px] font-bold text-[#15803D] underline cursor-pointer"
                          >
                            Page {f.pageNumber}
                          </button>
                        </div>
                        <p className="font-mono text-xs font-bold text-[#15803D] bg-white/90 px-2.5 py-1.5 rounded-lg border border-emerald-100">
                          {renderMathSymbols(f.formulaOrDefinition)}
                        </p>
                        <p className="text-[11px] text-[#5D6A80]">
                          <strong>When to use:</strong> {renderMathSymbols(f.whenToUse)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Key Relationships & Common Mistakes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-blue-200/80 bg-[#F3F7FE]/70 p-4 space-y-2">
                    <h4 className="font-display font-bold text-xs uppercase tracking-wider text-[#1D4ED8]">
                      3. Key Concept Relationships
                    </h4>
                    <ul className="space-y-1.5 text-xs text-[#17223C]">
                      {revisionSheet.keyRelationships.map((rel, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-[#4285F4] font-bold">•</span>
                          <span>{renderMathSymbols(rel)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-amber-200/90 bg-[#FEF9EC]/80 p-4 space-y-2">
                    <h4 className="font-display font-bold text-xs uppercase tracking-wider text-[#B45309] flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>4. Common Mistakes to Avoid</span>
                    </h4>
                    <ul className="space-y-1.5 text-xs text-[#17223C]">
                      {revisionSheet.commonMistakesToAvoid.map((m, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-[#EA4335] font-bold">!</span>
                          <span>{renderMathSymbols(m)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* 5. Rapid Recall Self-Check Questions */}
                <div className="space-y-2.5">
                  <h4 className="font-display font-bold text-sm uppercase tracking-wider text-[#EA4335]">
                    5. Rapid Self-Check Recall Questions
                  </h4>
                  <div className="space-y-2">
                    {revisionSheet.shortRecallQuestions.map((rq, idx) => {
                      const isShown = Boolean(revealedRecallIndices[idx]);
                      return (
                        <div
                          key={idx}
                          className="rounded-2xl border border-slate-200 p-3.5 bg-white space-y-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-xs sm:text-sm font-bold text-[#17223C]">
                              Q{idx + 1}. {renderMathSymbols(rq.question)}
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => onJumpToCitation(rq.pageNumber)}
                                className="text-[11px] font-semibold text-[#4285F4] hover:underline cursor-pointer"
                              >
                                Page {rq.pageNumber}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedRecallIndices((prev) => ({
                                    ...prev,
                                    [idx]: !prev[idx],
                                  }))
                                }
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-[#17223C] no-print cursor-pointer"
                              >
                                {isShown ? 'Hide Answer' : 'Show Answer'}
                              </button>
                            </div>
                          </div>
                          {isShown && (
                            <p className="text-xs text-[#15803D] font-semibold bg-[#F1FAF4] px-3 py-2 rounded-xl border border-[#BBF7D0]">
                              {renderMathSymbols(rq.shortAnswer)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ==================================================================== */}
      {/* DEDICATED A4 PRINT LAYOUT (Visible ONLY during @media print)         */}
      {/* ==================================================================== */}
      <div
        id="quick-revise-print-sheet"
        className="quick-revise-print-only space-y-5 text-[#0F172A]"
      >
        {/* Top Google 4-color accent bar + A4 Document Header */}
        <div className="border-b-2 border-slate-200 pb-3">
          <div className="grid grid-cols-4 h-1.5 w-full mb-3 rounded-full overflow-hidden">
            <div className="bg-[#4285F4]" />
            <div className="bg-[#EA4335]" />
            <div className="bg-[#FBBC05]" />
            <div className="bg-[#34A853]" />
          </div>

          <div className="flex items-end justify-between gap-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#4285F4]">
                LearnMate Quick Revision · A4 Print Edition
              </span>
              <h1 className="font-display font-extrabold text-xl text-[#0F172A]">
                {material.title} — {modeDisplayLabel}
              </h1>
            </div>
            <div className="text-right text-[11px] text-slate-600 font-medium">
              <div>Printed {new Date().toLocaleDateString()}</div>
              <div>
                {mode === 'sticky_notes' && `${stickyNotes.length} Sticky Notes`}
                {mode === 'flashcards' && `${flashcards.length} Flashcards`}
                {mode === 'mind_map' &&
                  `${mindMap?.nodes?.length || 0} Concept Nodes`}
                {mode === 'revision_sheet' && 'One-Page Exam Summary'}
              </div>
            </div>
          </div>
        </div>

        {/* 1. PRINT LAYOUT FOR STICKY NOTES */}
        {mode === 'sticky_notes' && (
          <div className="grid grid-cols-2 gap-4">
            {stickyNotes.map((note) => (
              <div
                key={`print_sn_${note.id}`}
                className={`rounded-2xl border-2 p-4 flex flex-col justify-between space-y-3 print-avoid-break ${getColorClass(
                  note.color
                )}`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display font-extrabold text-sm text-[#0F172A]">
                      {note.title}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-white/90 border border-black/15 text-[10px] font-bold text-[#0F172A] shrink-0">
                      {note.sourceReference}
                    </span>
                  </div>
                  <p className="font-handwriting text-sm leading-relaxed text-[#1E293B]">
                    {renderMathSymbols(note.content)}
                  </p>
                </div>

                {note.formula && (
                  <div className="px-3 py-1.5 rounded-xl bg-white border border-black/15 font-sans text-xs font-bold text-[#0F172A]">
                    {renderMathSymbols(note.formula)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 2. PRINT LAYOUT FOR FLASHCARDS (All Front & Back Cards) */}
        {mode === 'flashcards' && (
          <div className="grid grid-cols-2 gap-4">
            {flashcards.map((card, idx) => (
              <div
                key={`print_fc_${card.id}`}
                className="rounded-2xl border border-slate-300 bg-white p-4 space-y-2.5 print-avoid-break"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#1967D2]">
                    Card #{idx + 1} · {card.topic}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#E8F0FE] text-[#1D4ED8] text-[10px] font-bold">
                    {card.sourceReference}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-slate-500">
                    Question (Front):
                  </span>
                  <p className="font-display font-bold text-xs text-[#0F172A]">
                    {renderMathSymbols(card.frontPrompt)}
                  </p>
                </div>

                <div className="space-y-1 pt-1 border-t border-dashed border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-[#15803D]">
                    Answer & Explanation (Back):
                  </span>
                  <p className="text-xs text-[#1E293B] leading-relaxed">
                    {renderMathSymbols(card.backExplanation)}
                  </p>
                </div>

                {card.formula && (
                  <div className="px-2.5 py-1.5 rounded-lg bg-[#F8FAFF] border border-blue-200 font-mono text-[11px] font-bold text-[#1D4ED8]">
                    {renderMathSymbols(card.formula)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 3. PRINT LAYOUT FOR MIND MAP (Scaled Visual Diagram + All Node Summaries) */}
        {mode === 'mind_map' && mindMap && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-300 bg-[#F8FAFF] p-3 print-avoid-break">
              {renderMindMapSvg(true)}
            </div>

            <div className="space-y-2.5">
              <h3 className="font-display font-bold text-sm uppercase tracking-wider text-[#0F172A]">
                Concept Nodes & Formula Reference
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {mindMap.nodes.map((node) => (
                  <div
                    key={`print_mm_${node.id}`}
                    className="rounded-xl border border-slate-300 bg-white p-3 space-y-1.5 print-avoid-break"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-display font-bold text-xs text-[#0F172A]">
                        {node.label}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-700 shrink-0">
                        {node.sourceReference}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-700 leading-relaxed">
                      {renderMathSymbols(node.summary)}
                    </p>
                    {node.formula && (
                      <div className="px-2 py-1 rounded bg-slate-50 border border-slate-200 font-mono text-[10px] font-bold text-[#0F172A]">
                        {renderMathSymbols(node.formula)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. PRINT LAYOUT FOR ONE-PAGE REVISION SHEET (With All Recall Answers Visible) */}
        {mode === 'revision_sheet' && revisionSheet && (
          <div className="space-y-4">
            <p className="text-xs text-[#0F172A] leading-relaxed bg-[#F8FAFF] rounded-xl p-3.5 border border-[#DCE8FC] print-avoid-break">
              {renderMathSymbols(revisionSheet.overview)}
            </p>

            {/* 1. Essential Concepts */}
            <div className="space-y-2">
              <h3 className="font-display font-bold text-xs uppercase tracking-wider text-[#1967D2]">
                1. Essential Concepts
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {revisionSheet.essentialConcepts.map((c, idx) => (
                  <div
                    key={`print_ec_${idx}`}
                    className="rounded-xl border border-slate-300 p-3 bg-white space-y-1 print-avoid-break"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-display font-bold text-xs text-[#0F172A]">
                        {c.title}
                      </h4>
                      <span className="px-1.5 py-0.5 rounded bg-[#E8F0FE] text-[#1D4ED8] text-[10px] font-bold shrink-0">
                        {c.sourceReference}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-700 leading-relaxed">
                      {renderMathSymbols(c.explanation)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Key Formulas & Definitions */}
            <div className="space-y-2">
              <h3 className="font-display font-bold text-xs uppercase tracking-wider text-[#15803D]">
                2. Key Formulas & Definitions
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {revisionSheet.formulasAndDefinitions.map((f, idx) => (
                  <div
                    key={`print_fd_${idx}`}
                    className="rounded-xl border border-emerald-300 bg-[#F1FAF4] p-3 space-y-1 print-avoid-break"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display font-bold text-xs text-[#0F172A]">
                        {f.term}
                      </span>
                      <span className="text-[10px] font-bold text-[#15803D]">
                        Page {f.pageNumber}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] font-bold text-[#15803D] bg-white px-2 py-1 rounded border border-emerald-200">
                      {renderMathSymbols(f.formulaOrDefinition)}
                    </p>
                    <p className="text-[10px] text-slate-700">
                      <strong>When to use:</strong> {renderMathSymbols(f.whenToUse)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Key Relationships & 4. Common Mistakes */}
            <div className="grid grid-cols-2 gap-3 print-avoid-break">
              <div className="rounded-xl border border-blue-200 bg-[#F3F7FE] p-3 space-y-1.5">
                <h3 className="font-display font-bold text-xs uppercase tracking-wider text-[#1D4ED8]">
                  3. Key Concept Relationships
                </h3>
                <ul className="space-y-1 text-[11px] text-[#0F172A]">
                  {revisionSheet.keyRelationships.map((rel, idx) => (
                    <li key={`print_rel_${idx}`} className="flex items-start gap-1.5">
                      <span className="text-[#4285F4] font-bold">•</span>
                      <span>{renderMathSymbols(rel)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-amber-300 bg-[#FEF9EC] p-3 space-y-1.5">
                <h3 className="font-display font-bold text-xs uppercase tracking-wider text-[#B45309]">
                  4. Common Mistakes to Avoid
                </h3>
                <ul className="space-y-1 text-[11px] text-[#0F172A]">
                  {revisionSheet.commonMistakesToAvoid.map((m, idx) => (
                    <li key={`print_mis_${idx}`} className="flex items-start gap-1.5">
                      <span className="text-[#EA4335] font-bold">!</span>
                      <span>{renderMathSymbols(m)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* 5. Rapid Self-Check Recall Questions (Answers Always Visible in Print) */}
            <div className="space-y-2">
              <h3 className="font-display font-bold text-xs uppercase tracking-wider text-[#DC2626]">
                5. Rapid Self-Check Recall Questions & Answers
              </h3>
              <div className="space-y-2">
                {revisionSheet.shortRecallQuestions.map((rq, idx) => (
                  <div
                    key={`print_rq_${idx}`}
                    className="rounded-xl border border-slate-300 p-3 bg-white space-y-1 print-avoid-break"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-[#0F172A]">
                        Q{idx + 1}. {renderMathSymbols(rq.question)}
                      </p>
                      <span className="text-[10px] font-bold text-[#1967D2] shrink-0">
                        Page {rq.pageNumber}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#15803D] font-semibold bg-[#F1FAF4] px-2.5 py-1.5 rounded-lg border border-[#BBF7D0]">
                      Answer: {renderMathSymbols(rq.shortAnswer)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
