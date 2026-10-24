import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  Target,
  ListChecks,
  Zap,
  RefreshCw,
  ExternalLink,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  Mic,
  StickyNote,
  Layers,
  Network,
  FileText,
  Youtube,
  Maximize2,
  Minimize2,
  Cpu,
  LayoutDashboard,
  Bot,
  Copy,
  ThumbsUp,
  Clock,
  HelpCircle,
  Award,
  Lightbulb,
} from 'lucide-react';
import {
  Citation,
  DocumentAnalysis,
  GeminiModelOption,
  MistakeInsight,
  QuizAttempt,
  QuizQuestion,
  RevisionTask,
  StudyMaterial,
  TutorMessage,
  TutorResponseStyle,
  UserAuthProfile,
} from '../types/study';
import { StudySubTab } from './HomeView';
import { MaterialViewer } from './MaterialViewer';
import { QuickReviseMode, QuickRevisePanel } from './QuickRevisePanel';
import { ExploreFurtherPanel } from './ExploreFurtherPanel';
import { StudyTimerBar } from './StudyTimerBar';
import { VoiceTutorModal } from './VoiceTutorModal';
import { storageService } from '../services/storageService';
import {
  analyzeMaterial,
  analyzeMistakeDNA,
  askStudyTutor,
  generateGroundedQuiz,
} from '../services/aiClient';
import {
  buildRevisionPlanFromResults,
  computeTopicProgress,
  gradeQuizAttempt,
} from '../lib/studyLogic';

interface StudyViewProps {
  materials: StudyMaterial[];
  activeMaterial: StudyMaterial;
  activeSubTab: StudySubTab;
  onChangeSubTab: (tab: StudySubTab) => void;
  onSelectMaterial: (material: StudyMaterial) => void;
  onAddNewMaterial?: () => void;
  onAttemptSaved?: () => void;
  onQuizCompleted?: () => void;
  onOpenProgressView?: () => void;
  onMaterialReady?: (material: StudyMaterial, initialSubTab?: StudySubTab) => void;
  initialQuestion?: string | null;
  onClearInitialQuestion?: () => void;
  user?: UserAuthProfile | null;
  userDisplayName?: string | null;
  onSignIn?: () => void;
}

export const StudyView: React.FC<StudyViewProps> = ({
  materials,
  activeMaterial,
  activeSubTab,
  onChangeSubTab,
  onSelectMaterial,
  onAddNewMaterial,
  onAttemptSaved,
  onQuizCompleted,
  onOpenProgressView,
  onMaterialReady,
  initialQuestion,
  onClearInitialQuestion,
  user,
  userDisplayName,
}) => {
  // Workspace mode: 'dashboard' (Image 1 Study Dashboard) vs 'focused' (Active Learning Tab)
  const [layoutMode, setLayoutMode] = useState<'dashboard' | 'focused'>('dashboard');
  const [quickReviseMode, setQuickReviseMode] =
    useState<QuickReviseMode>('sticky_notes');

  // Focus Mode & Selected Gemini Model
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [selectedModel, setSelectedModel] =
    useState<GeminiModelOption>('gemini-3.8-flash');

  // Source viewer page & highlight state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [highlightedSnippet, setHighlightedSnippet] = useState<string | null>(
    null
  );
  const [isSourceModalOpen, setIsSourceModalOpen] = useState<boolean>(false);
  const [showMaterialPreviewStrip, setShowMaterialPreviewStrip] =
    useState<boolean>(false);

  // Studied pages tracking for real progress metrics
  const [studiedPages, setStudiedPages] = useState<number[]>(() =>
    storageService.getStudiedPages(activeMaterial.id)
  );

  // Voice Tutor Modal state
  const [isVoiceTutorOpen, setIsVoiceTutorOpen] = useState<boolean>(false);

  // Document analysis state
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // AI Tutor chat state
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
  const [questionInput, setQuestionInput] = useState<string>('');
  const [isAskingTutor, setIsAskingTutor] = useState<boolean>(false);
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [helpfulMsgIds, setHelpfulMsgIds] = useState<Record<string, boolean>>({});
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Contextual examples & understanding check horizontal carousel ref
  const examplesCarouselRef = useRef<HTMLDivElement | null>(null);
  const [revealedCheckIndices, setRevealedCheckIndices] = useState<
    Record<number, boolean>
  >({});

  // Diagnostic Quiz state
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>(
    {}
  );
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState<boolean>(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [submittedAttempt, setSubmittedAttempt] = useState<QuizAttempt | null>(
    null
  );

  // Mistake DNA state
  const [mistakeInsights, setMistakeInsights] = useState<MistakeInsight[]>([]);
  const [isAnalyzingMistakes, setIsAnalyzingMistakes] = useState<boolean>(false);
  const [mistakeError, setMistakeError] = useState<string | null>(null);

  // Revision Plan state
  const [revisionPlan, setRevisionPlan] = useState<RevisionTask[]>([]);

  // Adaptive Practice state
  const [adaptiveQuestions, setAdaptiveQuestions] = useState<QuizQuestion[]>([]);
  const [adaptiveIdx, setAdaptiveIdx] = useState<number>(0);
  const [adaptiveAnswers, setAdaptiveAnswers] = useState<Record<string, number>>(
    {}
  );
  const [isGeneratingAdaptive, setIsGeneratingAdaptive] =
    useState<boolean>(false);
  const [adaptiveError, setAdaptiveError] = useState<string | null>(null);
  const [submittedAdaptive, setSubmittedAdaptive] =
    useState<QuizAttempt | null>(null);

  // Sync sub-tab selection from parent (e.g., when navigating from HomeView shortcuts)
  useEffect(() => {
    if (
      activeSubTab === 'sticky_notes' ||
      activeSubTab === 'flashcards' ||
      activeSubTab === 'mind_map' ||
      activeSubTab === 'revision_sheet'
    ) {
      setQuickReviseMode(activeSubTab);
      setLayoutMode('focused');
    } else if (
      activeSubTab === 'quick_revise' ||
      activeSubTab === 'explore' ||
      activeSubTab === 'quiz' ||
      activeSubTab === 'mistakes' ||
      activeSubTab === 'revision' ||
      activeSubTab === 'adaptive'
    ) {
      setLayoutMode('focused');
    }
  }, [activeSubTab]);

  // Load cached state when activeMaterial changes
  useEffect(() => {
    setCurrentPage(1);
    setHighlightedSnippet(null);
    setTutorError(null);
    setQuizError(null);
    setAdaptiveError(null);
    setMistakeError(null);

    const pagesStudied = storageService.getStudiedPages(activeMaterial.id);
    setStudiedPages(pagesStudied);

    const cachedHistory = storageService.getTutorHistory(activeMaterial.id);
    setTutorMessages(cachedHistory);

    const cachedMistakes = storageService.getMistakeInsights(activeMaterial.id);
    setMistakeInsights(cachedMistakes);

    const cachedPlan = storageService.getRevisionPlan(activeMaterial.id);
    setRevisionPlan(cachedPlan);

    const attempts = storageService.getQuizAttempts(activeMaterial.id);
    const latestDiag =
      attempts.find((a) => a.mode === 'diagnostic') || attempts[0] || null;
    setSubmittedAttempt(latestDiag);
    setQuizQuestions([]);
    setSelectedAnswers({});
    setCurrentQuestionIdx(0);

    setAdaptiveQuestions([]);
    setAdaptiveAnswers({});
    setAdaptiveIdx(0);
    setSubmittedAdaptive(null);

    let cancelled = false;
    const loadAnalysis = async () => {
      const existing = storageService.getDocumentAnalysis(activeMaterial.id);
      if (existing) {
        setAnalysis(existing);
        return;
      }
      setIsAnalyzing(true);
      setAnalysisError(null);
      try {
        const result = await analyzeMaterial(activeMaterial, false, selectedModel);
        if (!cancelled) {
          setAnalysis(result);
        }
      } catch (err: any) {
        if (!cancelled) {
          setAnalysisError(
            err.message || 'Could not analyze study material with Gemini.'
          );
        }
      } finally {
        if (!cancelled) {
          setIsAnalyzing(false);
        }
      }
    };

    loadAnalysis();
    return () => {
      cancelled = true;
    };
  }, [activeMaterial.id]);

  // Handle initialQuestion passed from HomeView search/prompt bar
  useEffect(() => {
    if (initialQuestion && initialQuestion.trim()) {
      const q = initialQuestion.trim();
      if (onClearInitialQuestion) {
        onClearInitialQuestion();
      }
      setLayoutMode('focused');
      onChangeSubTab('tutor');
      handleAskQuestion(q);
    }
  }, [initialQuestion]);

  const handleSelectPageAndTrack = (pageNumber: number) => {
    const validPage = Math.max(
      1,
      Math.min(activeMaterial.pageCount, pageNumber)
    );
    setCurrentPage(validPage);
    const updated = storageService.markPageStudied(activeMaterial.id, validPage);
    setStudiedPages(updated);
  };

  const handleJumpToCitation = (pageNumber: number, snippet?: string) => {
    handleSelectPageAndTrack(pageNumber);
    if (snippet) {
      setHighlightedSnippet(snippet);
    }
    setIsSourceModalOpen(true);
  };

  // Ask AI Tutor
  const handleAskQuestion = async (
    customQuestion?: string,
    responseStyle: TutorResponseStyle = 'concise'
  ) => {
    const qText = (customQuestion ?? questionInput).trim();
    if (!qText || isAskingTutor) return;

    if (!customQuestion) {
      setQuestionInput('');
    }
    setTutorError(null);

    const userMsg: TutorMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: qText,
      timestamp: new Date().toISOString(),
    };

    const updatedWithUser = [...tutorMessages, userMsg];
    setTutorMessages(updatedWithUser);
    storageService.saveTutorHistory(activeMaterial.id, updatedWithUser);
    setIsAskingTutor(true);

    try {
      const historyPayload = updatedWithUser.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const currentTopicName =
        activeMaterial.pages.find((p) => p.pageNumber === currentPage)?.title ||
        analysis?.keyTopics[0]?.name;

      const response = await askStudyTutor({
        material: activeMaterial,
        question: qText,
        history: historyPayload,
        currentTopic: currentTopicName,
        weakTopics: adaptiveTopics,
        recentScore: submittedAttempt?.percentage,
        responseStyle,
        model: selectedModel,
      });

      const assistantMsg: TutorMessage = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        content: response.answer,
        supported: response.supported,
        sourceMode: response.sourceMode,
        citations: response.citations,
        followUpQuestions: response.followUpQuestions,
        timestamp: new Date().toISOString(),
      };

      const finalMessages = [...updatedWithUser, assistantMsg];
      setTutorMessages(finalMessages);
      storageService.saveTutorHistory(activeMaterial.id, finalMessages);

      if (response.citations.length > 0) {
        const firstCit = response.citations[0];
        handleSelectPageAndTrack(firstCit.pageNumber);
        setHighlightedSnippet(firstCit.snippet);
      }

      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      setTutorError(
        err.message ||
          'Failed to get response from AI Study Tutor. Please try again.'
      );
    } finally {
      setIsAskingTutor(false);
    }
  };

  // Generate Diagnostic Quiz (5–8 MCQs)
  const handleGenerateDiagnosticQuiz = async () => {
    setIsGeneratingQuiz(true);
    setQuizError(null);
    setSubmittedAttempt(null);
    setSelectedAnswers({});
    setCurrentQuestionIdx(0);

    try {
      const questions = await generateGroundedQuiz({
        material: activeMaterial,
        mode: 'diagnostic',
        count: 6,
        model: selectedModel,
      });
      setQuizQuestions(questions);
    } catch (err: any) {
      setQuizError(err.message || 'Failed to generate diagnostic quiz.');
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  // Submit Diagnostic Quiz & deterministically compute score + Mistake DNA + Revision Plan
  const handleSubmitDiagnosticQuiz = async () => {
    if (quizQuestions.length === 0) return;

    const attempt = gradeQuizAttempt(
      activeMaterial.id,
      activeMaterial.title,
      'diagnostic',
      quizQuestions,
      selectedAnswers
    );

    storageService.saveQuizAttempt(attempt);
    setSubmittedAttempt(attempt);
    onAttemptSaved?.();
    onQuizCompleted?.();

    const initialPlan = buildRevisionPlanFromResults(
      activeMaterial.id,
      attempt,
      [],
      revisionPlan
    );
    setRevisionPlan(initialPlan);
    storageService.saveRevisionPlan(activeMaterial.id, initialPlan);

    const wrongResults = attempt.results.filter((r) => !r.isCorrect);
    if (wrongResults.length > 0) {
      setIsAnalyzingMistakes(true);
      setMistakeError(null);
      try {
        const insights = await analyzeMistakeDNA({
          material: activeMaterial,
          results: attempt.results,
          model: selectedModel,
        });
        setMistakeInsights(insights);

        const enrichedPlan = buildRevisionPlanFromResults(
          activeMaterial.id,
          attempt,
          insights,
          initialPlan
        );
        setRevisionPlan(enrichedPlan);
        storageService.saveRevisionPlan(activeMaterial.id, enrichedPlan);
      } catch (err: any) {
        setMistakeError(
          err.message || 'Could not generate AI Mistake DNA insights.'
        );
      } finally {
        setIsAnalyzingMistakes(false);
      }
    } else {
      setMistakeInsights([]);
      storageService.saveMistakeInsights(activeMaterial.id, []);
    }
  };

  const handleToggleRevisionTask = (taskId: string) => {
    const updated = revisionPlan.map((t) =>
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );
    setRevisionPlan(updated);
    storageService.saveRevisionPlan(activeMaterial.id, updated);
  };

  const adaptiveTopics = useMemo(() => {
    const incompleteWeak = revisionPlan
      .filter((t) => !t.completed)
      .map((t) => t.topic);
    if (incompleteWeak.length > 0) return incompleteWeak;
    if (submittedAttempt && submittedAttempt.weakTopics.length > 0) {
      return submittedAttempt.weakTopics;
    }
    if (analysis && analysis.keyTopics.length > 0) {
      return analysis.keyTopics.slice(0, 2).map((k) => k.name);
    }
    return activeMaterial.pages.slice(0, 2).map((p) => p.title);
  }, [revisionPlan, submittedAttempt, analysis, activeMaterial]);

  const handleStartAdaptivePractice = async (customFocusTopics?: string[]) => {
    const topicsToFocus =
      customFocusTopics && customFocusTopics.length > 0
        ? customFocusTopics
        : adaptiveTopics;

    setLayoutMode('focused');
    onChangeSubTab('adaptive');
    setIsGeneratingAdaptive(true);
    setAdaptiveError(null);
    setSubmittedAdaptive(null);
    setAdaptiveAnswers({});
    setAdaptiveIdx(0);

    try {
      const questions = await generateGroundedQuiz({
        material: activeMaterial,
        mode: 'adaptive',
        focusTopics: topicsToFocus,
        count: 5,
        model: selectedModel,
      });
      setAdaptiveQuestions(questions);
    } catch (err: any) {
      setAdaptiveError(
        err.message || 'Failed to generate adaptive practice questions.'
      );
    } finally {
      setIsGeneratingAdaptive(false);
    }
  };

  const handleSubmitAdaptiveQuiz = () => {
    if (adaptiveQuestions.length === 0) return;

    const attempt = gradeQuizAttempt(
      activeMaterial.id,
      activeMaterial.title,
      'adaptive',
      adaptiveQuestions,
      adaptiveAnswers,
      adaptiveTopics
    );

    storageService.saveQuizAttempt(attempt);
    setSubmittedAdaptive(attempt);
    onAttemptSaved?.();
    onQuizCompleted?.();

    if (revisionPlan.length > 0) {
      const updatedPlan = buildRevisionPlanFromResults(
        activeMaterial.id,
        attempt,
        mistakeInsights,
        revisionPlan
      );
      setRevisionPlan(updatedPlan);
      storageService.saveRevisionPlan(activeMaterial.id, updatedPlan);
    }
  };

  const activeQuestion = quizQuestions[currentQuestionIdx];
  const answeredCount = Object.keys(selectedAnswers).length;
  const allDiagnosticAnswered =
    quizQuestions.length > 0 && answeredCount === quizQuestions.length;

  const activeAdaptiveQuestion = adaptiveQuestions[adaptiveIdx];
  const adaptiveAnsweredCount = Object.keys(adaptiveAnswers).length;
  const allAdaptiveAnswered =
    adaptiveQuestions.length > 0 &&
    adaptiveAnsweredCount === adaptiveQuestions.length;

  const completedTasksCount = revisionPlan.filter((t) => t.completed).length;

  // Real progress metrics for this material (Never fabricated)
  const allMaterialAttempts = storageService.getQuizAttempts(activeMaterial.id);
  const materialTopicProgress = computeTopicProgress(allMaterialAttempts);
  const materialFlashcards = storageService.getFlashcards(activeMaterial.id);
  const masteredCardsCount = materialFlashcards.filter(
    (c) => c.status === 'know_it'
  ).length;
  const focusSessions = storageService.getFocusSessions(activeMaterial.id);
  const totalStudyMinutes = focusSessions.reduce(
    (acc, s) => acc + (s.durationMinutes || 0),
    0
  );

  // Real overall progress calculation based on studied pages, flashcard mastery, and quiz score
  const pagesProgressRatio =
    activeMaterial.pageCount > 0
      ? Math.min(1, studiedPages.length / activeMaterial.pageCount)
      : 0;
  const cardsProgressRatio =
    materialFlashcards.length > 0
      ? masteredCardsCount / materialFlashcards.length
      : 0;
  const quizProgressRatio =
    allMaterialAttempts.length > 0
      ? allMaterialAttempts[0].percentage / 100
      : 0;

  const overallProgressPct = Math.round(
    allMaterialAttempts.length > 0
      ? pagesProgressRatio * 35 + cardsProgressRatio * 25 + quizProgressRatio * 40
      : pagesProgressRatio * 65 + cardsProgressRatio * 35
  );

  const currentPageObj =
    activeMaterial.pages.find((p) => p.pageNumber === currentPage) ||
    activeMaterial.pages[0];

  const isQuickReviseActive =
    layoutMode === 'focused' &&
    (activeSubTab === 'quick_revise' ||
      activeSubTab === 'sticky_notes' ||
      activeSubTab === 'flashcards' ||
      activeSubTab === 'mind_map' ||
      activeSubTab === 'revision_sheet');

  // Helper to format AI message content with clean formula callout blocks matching Image 7
  const renderFormattedMessageContent = (content: string) => {
    const paragraphs = content.split('\n\n');
    return (
      <div className="ai-explanation-prose space-y-3">
        {paragraphs.map((para, idx) => {
          const trimmed = para.trim();
          const looksLikeStandaloneFormula =
            trimmed.length > 4 &&
            trimmed.length < 110 &&
            !trimmed.endsWith('.') &&
            (trimmed.includes('=') ||
              trimmed.includes('∩') ||
              trimmed.includes('∪') ||
              trimmed.includes('Σ') ||
              /P\([A-Za-z0-9|∩∪]+\)/.test(trimmed));

          if (looksLikeStandaloneFormula) {
            return (
              <div
                key={idx}
                className="my-2.5 py-3 px-5 rounded-2xl bg-[#F8FAFF] border border-[#DCE8FC] text-center font-mono font-bold text-sm sm:text-base text-[#17223C] shadow-2xs"
              >
                {trimmed}
              </div>
            );
          }

          return (
            <p key={idx} className="whitespace-pre-wrap leading-relaxed">
              {para}
            </p>
          );
        })}
      </div>
    );
  };

  const handleCopyMessage = (msg: TutorMessage) => {
    navigator.clipboard?.writeText(msg.content).catch(() => {});
    setCopiedMsgId(msg.id);
    setTimeout(() => {
      setCopiedMsgId((prev) => (prev === msg.id ? null : prev));
    }, 2000);
  };

  const scrollExamplesCarousel = (direction: 'left' | 'right') => {
    const el = examplesCarouselRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction === 'left' ? -340 : 340,
      behavior: 'smooth',
    });
  };

  const studentGreetingName =
    (user?.displayName || userDisplayName)?.split(' ')[0] || 'Student';

  return (
    <div
      className={`mx-auto px-4 sm:px-8 py-5 space-y-6 transition-all ${
        isFocusMode ? 'max-w-[1440px]' : 'max-w-[1320px]'
      }`}
    >
      {/* ==================================================================== */}
      {/* SECONDARY STUDY NAVIGATION BAR (Frosted Glass + Soft Google Wash)    */}
      {/* ==================================================================== */}
      <div className="study-subtoolbar-glass rounded-[26px] p-3.5 sm:p-4 space-y-3 no-print">
        {/* Top Row: Active Material Selector + Reader Button + Model + Timer + Focus Mode */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Material Selector & Quick Reader Trigger */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 bg-white/95 px-3 py-1.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <BookOpen className="w-4 h-4 text-[#4285F4] shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#5D6A80] hidden sm:inline">
                Material:
              </span>
              <select
                aria-label="Select active study material"
                value={activeMaterial.id}
                onChange={(e) => {
                  const found = materials.find((m) => m.id === e.target.value);
                  if (found) onSelectMaterial(found);
                }}
                className="bg-transparent text-xs sm:text-sm font-bold text-[#17223C] focus:outline-none max-w-[190px] sm:max-w-[240px] truncate cursor-pointer"
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({m.pageCount}{' '}
                    {m.sourceType === 'youtube' ? 'segments' : 'pages'})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setIsSourceModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/95 hover:bg-white border border-slate-200/80 text-xs font-bold text-[#1967D2] shadow-2xs transition-colors cursor-pointer"
              title="Open Study Material Reader"
            >
              <FileText className="w-3.5 h-3.5 text-[#4285F4]" />
              <span>Reader (P.{currentPage})</span>
            </button>

            <button
              type="button"
              onClick={onAddNewMaterial}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/95 hover:bg-white border border-slate-200/80 text-xs font-semibold text-[#17223C] shadow-2xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#4285F4]" />
              <span className="hidden sm:inline">Add Material</span>
            </button>
          </div>

          {/* Right: Gemini Model Selector + Voice Tutor + Study Timer + Focus Mode */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/95 border border-slate-200/80 text-xs shadow-2xs">
              <Cpu className="w-3.5 h-3.5 text-[#4285F4]" />
              <select
                aria-label="Select Gemini AI Model"
                value={selectedModel}
                onChange={(e) =>
                  setSelectedModel(e.target.value as GeminiModelOption)
                }
                className="bg-transparent font-semibold text-[#17223C] focus:outline-none cursor-pointer text-xs"
              >
                <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
                <option value="gemini-3.1-flash-lite">
                  Gemini 3.1 Flash Lite
                </option>
                <option value="gemini-4-argon">Gemini 4 Argon</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setIsVoiceTutorOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/95 hover:bg-white border border-slate-200/80 text-xs font-bold text-[#15803D] shadow-2xs transition-colors cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 text-[#34A853]" />
              <span>Voice Tutor</span>
            </button>

            <StudyTimerBar
              activeMaterial={activeMaterial}
              isFocusMode={isFocusMode}
              onToggleFocusMode={() => setIsFocusMode((f) => !f)}
            />
          </div>
        </div>

        {/* Bottom Row: 8 Study Feature Navigation Tabs */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-slate-200/60"
          role="tablist"
          aria-label="Study Workspace Navigation"
        >
          <button
            type="button"
            role="tab"
            aria-selected={layoutMode === 'dashboard'}
            onClick={() => setLayoutMode('dashboard')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              layoutMode === 'dashboard'
                ? 'bg-[#17223C] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={layoutMode === 'focused' && activeSubTab === 'tutor'}
            onClick={() => {
              setLayoutMode('focused');
              onChangeSubTab('tutor');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              layoutMode === 'focused' && activeSubTab === 'tutor'
                ? 'bg-[#4285F4] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Learn · AI Tutor</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={isQuickReviseActive}
            onClick={() => {
              setLayoutMode('focused');
              onChangeSubTab('quick_revise');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              isQuickReviseActive
                ? 'bg-[#F59E0B] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <StickyNote className="w-3.5 h-3.5" />
            <span>Quick Revise</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={layoutMode === 'focused' && activeSubTab === 'quiz'}
            onClick={() => {
              setLayoutMode('focused');
              onChangeSubTab('quiz');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              layoutMode === 'focused' && activeSubTab === 'quiz'
                ? 'bg-[#EA4335] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Diagnostic Quiz</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={
              layoutMode === 'focused' && activeSubTab === 'mistakes'
            }
            onClick={() => {
              setLayoutMode('focused');
              onChangeSubTab('mistakes');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              layoutMode === 'focused' && activeSubTab === 'mistakes'
                ? 'bg-[#D97706] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            <span>Mistake DNA</span>
            {submittedAttempt && submittedAttempt.weakTopics.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 text-[10px] rounded-full bg-amber-100 text-amber-900">
                {submittedAttempt.weakTopics.length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={
              layoutMode === 'focused' && activeSubTab === 'revision'
            }
            onClick={() => {
              setLayoutMode('focused');
              onChangeSubTab('revision');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              layoutMode === 'focused' && activeSubTab === 'revision'
                ? 'bg-[#34A853] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <ListChecks className="w-3.5 h-3.5" />
            <span>Revision Plan</span>
            {revisionPlan.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 text-[10px] rounded-full bg-emerald-100 text-emerald-900">
                {completedTasksCount}/{revisionPlan.length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={
              layoutMode === 'focused' && activeSubTab === 'adaptive'
            }
            onClick={() => {
              setLayoutMode('focused');
              onChangeSubTab('adaptive');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              layoutMode === 'focused' && activeSubTab === 'adaptive'
                ? 'bg-[#1D4ED8] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Adaptive Practice</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={
              layoutMode === 'focused' && activeSubTab === 'explore'
            }
            onClick={() => {
              setLayoutMode('focused');
              onChangeSubTab('explore');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              layoutMode === 'focused' && activeSubTab === 'explore'
                ? 'bg-[#EA4335] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#5D6A80] hover:text-[#17223C]'
            }`}
          >
            <Youtube className="w-3.5 h-3.5" />
            <span>Explore Further</span>
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* VIEW 1: STUDY DASHBOARD (Image 1 Layout + Strict Content Rules)      */}
      {/* ==================================================================== */}
      {layoutMode === 'dashboard' ? (
        <div className="space-y-6">
          {/* Spacious Student Greeting Banner (NO AI promo tiles or marketing cards) */}
          <div className="google-gradient-panel rounded-[28px] p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8F0FE] text-[#1967D2] text-xs font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Active Study Workspace · {activeMaterial.title}</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#17223C]">
                Welcome back,{' '}
                <span className="bg-gradient-to-r from-[#4285F4] via-[#EA4335] to-[#34A853] bg-clip-text text-transparent">
                  {studentGreetingName}!
                </span>
              </h1>
              <p className="text-sm text-[#5D6A80] max-w-xl">
                Ready to continue your learning journey today? You are currently on{' '}
                <strong className="text-[#17223C]">
                  Page {currentPage} of {activeMaterial.pageCount}
                </strong>{' '}
                ({currentPageObj?.title}).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsSourceModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 text-xs sm:text-sm font-bold text-[#17223C] shadow-2xs transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4 text-[#EA4335]" />
                <span>Read Page {currentPage}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLayoutMode('focused');
                  onChangeSubTab('tutor');
                }}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-bold text-xs sm:text-sm shadow-[0_8px_20px_rgba(66,133,244,0.28)] transition-all cursor-pointer"
              >
                <span>Continue Learning</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Main 2-Column Dashboard Grid matching Image 1: Continue Learning + Your Progress */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* LEFT (7 cols): Continue Learning Card */}
            <div className="lg:col-span-7 google-gradient-card rounded-[28px] p-6 sm:p-7 flex flex-col justify-between space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display font-extrabold text-lg sm:text-xl text-[#17223C]">
                  Continue Learning
                </h2>
                <span className="text-xs font-medium text-[#5D6A80]">
                  Last studied {activeMaterial.lastStudiedAt}
                </span>
              </div>

              {/* Current Material Preview Card */}
              <div className="rounded-3xl bg-gradient-to-br from-[#F8FAFF] via-white to-[#F3F8FF] border border-slate-200/80 p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-2xs">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  {/* PDF / Document Thumbnail Badge */}
                  <div className="w-16 h-20 rounded-2xl bg-gradient-to-br from-[#FEE2E2] to-[#FECACA] border border-[#FCA5A5] flex flex-col items-center justify-center shrink-0 shadow-xs">
                    <FileText className="w-7 h-7 text-[#EA4335]" />
                    <span className="mt-1 px-1.5 py-0.2 rounded bg-[#EA4335] text-white text-[9px] font-extrabold uppercase tracking-wider">
                      {activeMaterial.sourceType}
                    </span>
                  </div>

                  <div className="space-y-2.5 min-w-0 flex-1">
                    <h3 className="font-display font-extrabold text-base sm:text-lg text-[#17223C] truncate">
                      {activeMaterial.title}
                    </h3>

                    {/* Page Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#5D6A80]">
                          Page {currentPage} of {activeMaterial.pageCount} (
                          {studiedPages.length} of {activeMaterial.pageCount}{' '}
                          studied)
                        </span>
                        <span className="font-bold text-[#4285F4] tabular-nums">
                          {Math.round(pagesProgressRatio * 100)}%
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-200/80 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#4285F4] to-[#34A853] transition-all duration-300"
                          style={{
                            width: `${Math.max(
                              12,
                              Math.round(pagesProgressRatio * 100)
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    <p className="text-xs text-[#5D6A80] truncate">
                      Current Section:{' '}
                      <strong className="text-[#17223C]">
                        {currentPageObj?.title}
                      </strong>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setLayoutMode('focused');
                    onChangeSubTab('tutor');
                  }}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-bold text-xs sm:text-sm shadow-xs transition-colors shrink-0 cursor-pointer"
                >
                  <span>Open Material</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Chapter / Page Reading Position Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#5D6A80]">
                    Jump to Chapter / Page Position:
                  </span>
                  <span className="text-[11px] text-[#5D6A80]">
                    Click a page to read or study
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeMaterial.pages.map((p) => {
                    const isCurrent = p.pageNumber === currentPage;
                    const isStudied = studiedPages.includes(p.pageNumber);
                    return (
                      <button
                        key={p.pageNumber}
                        type="button"
                        onClick={() => {
                          handleSelectPageAndTrack(p.pageNumber);
                          setIsSourceModalOpen(true);
                        }}
                        className={`text-left px-3.5 py-2.5 rounded-2xl border flex items-center justify-between gap-2 transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-[#E8F0FE]/70 border-[#4285F4] text-[#17223C]'
                            : 'bg-white hover:bg-slate-50 border-slate-200/80 text-[#17223C]'
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="text-[11px] font-extrabold text-[#4285F4] block">
                            Page {p.pageNumber}
                          </span>
                          <span className="text-xs font-semibold truncate block">
                            {p.title}
                          </span>
                        </div>
                        {isStudied ? (
                          <CheckCircle2 className="w-4 h-4 text-[#34A853] shrink-0" />
                        ) : (
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT (5 cols): Your Progress Card with Circular Progress Visualization (Image 1) */}
            <div className="lg:col-span-5 google-gradient-card rounded-[28px] p-6 sm:p-7 flex flex-col justify-between space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display font-extrabold text-lg sm:text-xl text-[#17223C]">
                  Your Progress
                </h2>
                {onOpenProgressView && (
                  <button
                    type="button"
                    onClick={onOpenProgressView}
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#4285F4] hover:underline cursor-pointer"
                  >
                    <span>View Details</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-6 my-auto py-2">
                {/* Circular Overall Progress Ring */}
                <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke="#E2E8F0"
                      strokeWidth="10"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke="url(#dashboardProgressGrad)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 50}
                      strokeDashoffset={
                        2 * Math.PI * 50 * (1 - overallProgressPct / 100)
                      }
                    />
                    <defs>
                      <linearGradient
                        id="dashboardProgressGrad"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="100%"
                      >
                        <stop offset="0%" stopColor="#4285F4" />
                        <stop offset="50%" stopColor="#FBBC05" />
                        <stop offset="100%" stopColor="#34A853" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="font-display font-extrabold text-2xl text-[#17223C] tabular-nums">
                      {overallProgressPct}%
                    </span>
                    <span className="text-[11px] font-semibold text-[#5D6A80]">
                      Overall
                    </span>
                  </div>
                </div>

                {/* Real Metric Rows matching Image 1 */}
                <div className="flex-1 w-full space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <span className="inline-flex items-center gap-2 font-semibold text-[#5D6A80]">
                      <CheckCircle2 className="w-4 h-4 text-[#34A853]" />
                      <span>Pages Studied</span>
                    </span>
                    <strong className="text-[#17223C] tabular-nums">
                      {studiedPages.length} / {activeMaterial.pageCount} pages
                    </strong>
                  </div>

                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <span className="inline-flex items-center gap-2 font-semibold text-[#5D6A80]">
                      <Layers className="w-4 h-4 text-[#4285F4]" />
                      <span>Practice Cards</span>
                    </span>
                    <strong className="text-[#17223C] tabular-nums">
                      {masteredCardsCount} / {materialFlashcards.length}{' '}
                      mastered
                    </strong>
                  </div>

                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <span className="inline-flex items-center gap-2 font-semibold text-[#5D6A80]">
                      <ClipboardCheck className="w-4 h-4 text-[#EA4335]" />
                      <span>Diagnostic Quiz</span>
                    </span>
                    <strong className="text-[#17223C] tabular-nums">
                      {submittedAttempt
                        ? `${submittedAttempt.score}/${submittedAttempt.total} (${submittedAttempt.percentage}%)`
                        : 'Not taken yet'}
                    </strong>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 font-semibold text-[#5D6A80]">
                      <Clock className="w-4 h-4 text-[#F59E0B]" />
                      <span>Study Time</span>
                    </span>
                    <strong className="text-[#17223C] tabular-nums">
                      {totalStudyMinutes > 0
                        ? `${totalStudyMinutes}m (${focusSessions.length} sessions)`
                        : 'Use timer above'}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-[#5D6A80]">
                <span>
                  Completed Quizzes:{' '}
                  <strong className="text-[#17223C]">
                    {allMaterialAttempts.length}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLayoutMode('focused');
                    onChangeSubTab('quiz');
                  }}
                  className="font-bold text-[#EA4335] hover:underline cursor-pointer"
                >
                  {submittedAttempt ? 'Retake Quiz →' : 'Take Diagnostic Quiz →'}
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Row: Real Topic Mastery & Recent Learning Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Topic Mastery Breakdown (7 cols) */}
            <div className="lg:col-span-7 google-gradient-card rounded-[28px] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-display font-bold text-base sm:text-lg text-[#17223C]">
                    Topic Mastery · {activeMaterial.title}
                  </h2>
                  <p className="text-xs text-[#5D6A80]">
                    {materialTopicProgress.length > 0
                      ? 'Measured from your completed Diagnostic Quiz and Adaptive Practice attempts'
                      : 'Key topics in this material — complete a quiz to measure topic accuracy'}
                  </p>
                </div>
                {submittedAttempt && submittedAttempt.weakTopics.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleStartAdaptivePractice()}
                    className="px-3.5 py-1.5 rounded-full bg-[#34A853] hover:bg-[#16A34A] text-white text-xs font-bold cursor-pointer"
                  >
                    Practice Weak Topics
                  </button>
                )}
              </div>

              {materialTopicProgress.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {materialTopicProgress.map((tp) => (
                    <div
                      key={tp.topic}
                      className="rounded-2xl bg-slate-50/80 border border-slate-200/80 p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[#17223C] truncate">
                          {tp.topic}
                        </span>
                        <span
                          className={`font-extrabold tabular-nums ${
                            tp.latestScorePct >= 80
                              ? 'text-[#15803D]'
                              : tp.latestScorePct >= 50
                                ? 'text-[#D97706]'
                                : 'text-[#DC2626]'
                          }`}
                        >
                          {tp.latestScorePct}%
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            tp.latestScorePct >= 80
                              ? 'bg-[#34A853]'
                              : tp.latestScorePct >= 50
                                ? 'bg-[#FBBC05]'
                                : 'bg-[#EA4335]'
                          }`}
                          style={{ width: `${tp.latestScorePct}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-[#5D6A80]">
                        {tp.totalCorrect}/{tp.totalAsked} correct across{' '}
                        {tp.attemptsCount}{' '}
                        {tp.attemptsCount === 1 ? 'attempt' : 'attempts'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(analysis?.keyTopics || []).map((kt, idx) => (
                    <div
                      key={idx}
                      className="rounded-2xl bg-slate-50/80 border border-slate-200/80 p-3.5 flex flex-col justify-between gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-display font-bold text-xs sm:text-sm text-[#17223C]">
                          {kt.name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleJumpToCitation(kt.pageNumbers[0] || 1)
                          }
                          className="px-2 py-0.5 rounded bg-[#E8F0FE] text-[#1967D2] text-[10px] font-bold shrink-0 cursor-pointer"
                        >
                          Page {kt.pageNumbers[0] || 1}
                        </button>
                      </div>
                      <p className="text-xs text-[#5D6A80] line-clamp-2">
                        {kt.summary}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Learning Activity (5 cols) */}
            <div className="lg:col-span-5 google-gradient-card rounded-[28px] p-6 flex flex-col justify-between space-y-4">
              <div>
                <h2 className="font-display font-bold text-base sm:text-lg text-[#17223C]">
                  Recent Learning Activity
                </h2>
                <p className="text-xs text-[#5D6A80]">
                  Real quiz attempts, tutor conversations, and revision tasks
                </p>
              </div>

              <div className="space-y-2.5 flex-1">
                {allMaterialAttempts.length > 0 ? (
                  allMaterialAttempts.slice(0, 3).map((att) => (
                    <div
                      key={att.id}
                      className="rounded-2xl bg-slate-50/80 border border-slate-200/80 p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-[#17223C] block truncate">
                          {att.mode === 'adaptive'
                            ? 'Adaptive Practice'
                            : 'Diagnostic Quiz'}{' '}
                          · {att.score}/{att.total} ({att.percentage}%)
                        </span>
                        <span className="text-[11px] text-[#5D6A80]">
                          {new Date(att.completedAt).toLocaleString()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLayoutMode('focused');
                          onChangeSubTab(
                            att.mode === 'adaptive' ? 'adaptive' : 'quiz'
                          );
                        }}
                        className="text-xs font-bold text-[#4285F4] hover:underline shrink-0 cursor-pointer"
                      >
                        Review
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-slate-50/80 border border-slate-200/80 p-4 text-xs text-[#5D6A80] space-y-1.5">
                    <p className="font-semibold text-[#17223C]">
                      No quiz attempts recorded for {activeMaterial.title} yet.
                    </p>
                    <p>
                      Ask the AI Study Tutor a question or take a 6-question Diagnostic Quiz to begin tracking your mastery.
                    </p>
                  </div>
                )}

                {tutorMessages.length > 0 && (
                  <div className="rounded-2xl bg-[#F3F8FF] border border-[#DCE8FC] p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-[#17223C] block truncate">
                        AI Tutor Conversation ({tutorMessages.length} messages)
                      </span>
                      <span className="text-[11px] text-[#5D6A80] truncate block">
                        Latest: "{tutorMessages[tutorMessages.length - 1]?.content.slice(0, 55)}..."
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLayoutMode('focused');
                        onChangeSubTab('tutor');
                      }}
                      className="text-xs font-bold text-[#1967D2] hover:underline shrink-0 cursor-pointer"
                    >
                      Resume
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ================================================================== */
        /* VIEW 2: FULL-WIDTH FOCUSED STUDY WORKSPACE (No Cramped PDF Sidebar) */
        /* ================================================================== */
        <div className="space-y-6">
          {/* ============================================================== */}
          {/* TAB A: LEARN · AI STUDY TUTOR (Image 7 + Section 2 Canvas)     */}
          {/* ============================================================== */}
          {activeSubTab === 'tutor' && (
            <div className="space-y-6">
              {/* 1. STUDY MATERIAL COMPACT READER BAR & COLLAPSIBLE PREVIEW */}
              <div className="google-gradient-card rounded-[24px] p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#FEE2E2] text-[#EA4335] flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold text-sm text-[#17223C] truncate">
                          {activeMaterial.title}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-[#E8F0FE] text-[#1967D2] text-[11px] font-bold shrink-0">
                          Page {currentPage} of {activeMaterial.pageCount}
                        </span>
                      </div>
                      <p className="text-xs text-[#5D6A80] truncate">
                        Current Section: {currentPageObj?.title}
                      </p>
                    </div>
                  </div>

                  {/* Page pills + Preview / Drawer triggers */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeMaterial.pages.map((p) => (
                      <button
                        key={p.pageNumber}
                        type="button"
                        onClick={() => handleSelectPageAndTrack(p.pageNumber)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          p.pageNumber === currentPage
                            ? 'bg-[#4285F4] text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-[#17223C]'
                        }`}
                      >
                        P.{p.pageNumber}
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => setShowMaterialPreviewStrip((s) => !s)}
                      className="px-3 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#17223C] cursor-pointer"
                    >
                      {showMaterialPreviewStrip ? 'Hide Excerpt' : 'Preview Page'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsSourceModalOpen(true)}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1967D2] text-xs font-bold cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open Reader</span>
                    </button>
                  </div>
                </div>

                {showMaterialPreviewStrip && currentPageObj && (
                  <div className="pt-3 border-t border-slate-200/70 bg-[#F8FAFF] rounded-2xl p-4 text-xs sm:text-sm text-[#17223C] leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                    <div className="flex items-center justify-between mb-1.5">
                      <strong className="font-display text-xs uppercase tracking-wider text-[#4285F4]">
                        Page {currentPageObj.pageNumber} · {currentPageObj.title}
                      </strong>
                      <button
                        type="button"
                        onClick={() =>
                          handleAskQuestion(
                            `Summarize Page ${currentPageObj.pageNumber} (${currentPageObj.title}) and explain the key formulas.`
                          )
                        }
                        className="text-xs font-bold text-[#1967D2] hover:underline cursor-pointer"
                      >
                        Ask Tutor to Explain This Page →
                      </button>
                    </div>
                    {currentPageObj.content}
                  </div>
                )}
              </div>

              {/* 2. CENTRAL FOCUS: AI STUDY TUTOR WORKSPACE (Matching Image 7) */}
              <div className="google-gradient-panel rounded-[28px] overflow-hidden flex flex-col">
                {/* Header matching Image 7 */}
                <div className="px-6 sm:px-8 py-5 border-b border-slate-200/70 bg-gradient-to-r from-[#F4F8FF] via-white to-[#FFF9F2] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-[#E8F0FE] border border-[#BFDBFE] text-[#4285F4] flex items-center justify-center shrink-0 shadow-2xs">
                      <Bot className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="font-display font-extrabold text-xl sm:text-2xl text-[#17223C]">
                        AI Study{' '}
                        <span className="bg-gradient-to-r from-[#EA4335] via-[#F59E0B] to-[#34A853] bg-clip-text text-transparent">
                          Tutor
                        </span>
                      </h2>
                      <p className="text-xs sm:text-sm text-[#5D6A80]">
                        Ask anything about your material or general concepts
                      </p>
                    </div>
                  </div>

                  {/* Right Header Illustration & Quick Actions */}
                  <div className="flex items-center gap-3 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setIsVoiceTutorOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#DCFCE7] hover:bg-[#BBF7D0] text-[#15803D] text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Mic className="w-3.5 h-3.5" />
                      <span>Live Voice Tutor</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeSubTab('quiz')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#EA4335] hover:bg-[#DC2626] text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>Diagnostic Quiz</span>
                    </button>
                  </div>
                </div>

                {/* Conversation Thread Area */}
                <div className="p-6 sm:p-8 space-y-6 min-h-[420px] max-h-[640px] overflow-y-auto bg-gradient-to-b from-white via-[#FAFCFF] to-[#F5F9FF]/60">
                  {tutorMessages.length === 0 ? (
                    <div className="space-y-5 max-w-4xl mx-auto">
                      {/* Initial Grounded Welcome Explanation Card matching Image 7 */}
                      <div className="flex items-start gap-3.5">
                        <div className="w-9 h-9 rounded-full bg-[#E8F0FE] text-[#4285F4] flex items-center justify-center shrink-0 mt-1">
                          <Bot className="w-5 h-5" />
                        </div>
                        <div className="flex-1 bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E8F0FE] text-[#1967D2] text-xs font-bold">
                              <BookOpen className="w-3.5 h-3.5" />
                              <span>
                                Grounded in {activeMaterial.title} · Page{' '}
                                {currentPage}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleJumpToCitation(currentPage)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#4285F4] hover:underline cursor-pointer"
                            >
                              <span>Inspect Page {currentPage}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="ai-explanation-prose space-y-3">
                            <p className="font-semibold text-[#17223C]">
                              {analysis?.overview ||
                                `We are studying ${activeMaterial.title}. Ask any question below for a step-by-step explanation with verified page citations.`}
                            </p>

                            {activeMaterial.id === 'mat_probability_notes' && (
                              <div className="my-3 py-3.5 px-5 rounded-2xl bg-[#F8FAFF] border border-[#DCE8FC] text-center font-mono font-bold text-sm sm:text-base text-[#17223C]">
                                P(B | A) = [ P(A | B) · P(B) ] / P(A)
                              </div>
                            )}
                          </div>

                          {/* Suggested Follow-Up Question Pills matching Image 7 */}
                          <div className="pt-2 flex flex-wrap items-center gap-2">
                            {(
                              analysis?.suggestedQuestions || [
                                "Explain Bayes' Theorem simply",
                                'Give an example problem',
                                'What is prior probability?',
                              ]
                            ).map((sq, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => handleAskQuestion(sq)}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#F8FAFF] hover:bg-[#E8F0FE] border border-slate-200/90 hover:border-[#93C5FD] text-xs sm:text-sm font-semibold text-[#17223C] transition-all cursor-pointer"
                              >
                                <span>{sq}</span>
                                <ArrowRight className="w-3.5 h-3.5 text-[#4285F4]" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5 max-w-4xl mx-auto">
                      {tutorMessages.map((msg) =>
                        msg.role === 'user' ? (
                          <div key={msg.id} className="flex justify-end">
                            <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-xs bg-[#4285F4] text-white px-5 py-3.5 text-sm sm:text-base font-medium shadow-xs">
                              {msg.content}
                            </div>
                          </div>
                        ) : (
                          <div
                            key={msg.id}
                            className="flex items-start gap-3.5"
                          >
                            <div className="w-9 h-9 rounded-full bg-[#E8F0FE] text-[#4285F4] flex items-center justify-center shrink-0 mt-1">
                              <Bot className="w-5 h-5" />
                            </div>

                            <div className="flex-1 bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
                              {/* Top Metadata + Copy / Helpful Actions matching Image 7 */}
                              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {(msg.sourceMode === 'material' ||
                                    (msg.supported && !msg.sourceMode)) && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D] text-[11px] font-bold">
                                      <CheckCircle2 className="w-3 h-3" />
                                      <span>From your material</span>
                                    </span>
                                  )}
                                  {msg.sourceMode === 'both' && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8F0FE] text-[#1D4ED8] text-[11px] font-bold">
                                      <Sparkles className="w-3 h-3" />
                                      <span>Material + General Knowledge</span>
                                    </span>
                                  )}
                                  {msg.sourceMode === 'general' && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-[#B45309] text-[11px] font-bold">
                                      <Sparkles className="w-3 h-3" />
                                      <span>General AI Knowledge</span>
                                    </span>
                                  )}

                                  {msg.citations?.map((cit: Citation, cIdx: number) => (
                                    <button
                                      key={cIdx}
                                      type="button"
                                      onClick={() =>
                                        handleJumpToCitation(
                                          cit.pageNumber,
                                          cit.snippet
                                        )
                                      }
                                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1967D2] text-[11px] font-bold transition-colors cursor-pointer"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      <span>Page {cit.pageNumber}</span>
                                    </button>
                                  ))}
                                </div>

                                {/* Copy & Helpful Buttons matching Image 7 */}
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleCopyMessage(msg)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-[11px] font-semibold text-[#5D6A80] hover:text-[#17223C] transition-colors cursor-pointer"
                                  >
                                    {copiedMsgId === msg.id ? (
                                      <>
                                        <Check className="w-3 h-3 text-[#15803D]" />
                                        <span>Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>Copy</span>
                                      </>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      setHelpfulMsgIds((prev) => ({
                                        ...prev,
                                        [msg.id]: !prev[msg.id],
                                      }))
                                    }
                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                                      helpfulMsgIds[msg.id]
                                        ? 'bg-[#DCFCE7] border-[#86EFAC] text-[#15803D]'
                                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 text-[#5D6A80] hover:text-[#17223C]'
                                    }`}
                                  >
                                    <ThumbsUp className="w-3 h-3" />
                                    <span>Helpful</span>
                                  </button>
                                </div>
                              </div>

                              {/* Formatted Explanation Body */}
                              {renderFormattedMessageContent(msg.content)}

                              {/* Simplify / Explain Deeper + Follow-up Question Pills */}
                              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={isAskingTutor}
                                  onClick={() =>
                                    handleAskQuestion(
                                      'Simplify your previous explanation with an everyday analogy.',
                                      'simplify'
                                    )
                                  }
                                  className="px-3 py-1.5 rounded-full bg-slate-50 hover:bg-[#E8F0FE] border border-slate-200 text-xs font-bold text-[#4285F4] transition-colors cursor-pointer"
                                >
                                  Simplify
                                </button>
                                <button
                                  type="button"
                                  disabled={isAskingTutor}
                                  onClick={() =>
                                    handleAskQuestion(
                                      'Explain that concept deeper with step-by-step details and a worked example.',
                                      'deeper'
                                    )
                                  }
                                  className="px-3 py-1.5 rounded-full bg-slate-50 hover:bg-[#E8F0FE] border border-slate-200 text-xs font-bold text-[#17223C] transition-colors cursor-pointer"
                                >
                                  Explain deeper
                                </button>

                                {msg.followUpQuestions?.map((fq, fIdx) => (
                                  <button
                                    key={fIdx}
                                    type="button"
                                    onClick={() => handleAskQuestion(fq)}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white hover:bg-[#F8FAFF] border border-slate-200 hover:border-[#4285F4] text-xs font-semibold text-[#17223C] transition-colors cursor-pointer"
                                  >
                                    <span>{fq}</span>
                                    <ArrowRight className="w-3 h-3 text-[#4285F4]" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {isAskingTutor && (
                    <div className="max-w-4xl mx-auto flex items-center gap-2.5 text-xs sm:text-sm text-[#5D6A80] pl-12">
                      <Loader2 className="w-4 h-4 animate-spin text-[#4285F4]" />
                      <span>
                        Gemini is preparing your cited explanation...
                      </span>
                    </div>
                  )}

                  {tutorError && (
                    <div
                      role="alert"
                      className="max-w-4xl mx-auto p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs sm:text-sm text-[#DC2626]"
                    >
                      {tutorError}
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Bottom Input Bar matching Image 7 */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAskQuestion();
                  }}
                  className="px-6 sm:px-8 py-4 border-t border-slate-200/80 bg-white flex items-center gap-3"
                >
                  <button
                    type="button"
                    onClick={() => setIsSourceModalOpen(true)}
                    className="p-2.5 rounded-full bg-slate-100 hover:bg-[#E8F0FE] text-[#5D6A80] hover:text-[#4285F4] transition-colors cursor-pointer shrink-0"
                    title="Open Study Material Reader"
                    aria-label="Open Study Material Reader"
                  >
                    <BookOpen className="w-4 h-4" />
                  </button>

                  <input
                    type="text"
                    value={questionInput}
                    onChange={(e) => setQuestionInput(e.target.value)}
                    placeholder="Ask a question about your study material..."
                    aria-label="Ask a question about your study material"
                    className="flex-1 px-5 py-3 rounded-full bg-[#F8FAFF] focus:bg-white border border-slate-200/90 focus:border-[#4285F4] text-sm text-[#17223C] focus:outline-none transition-all shadow-2xs"
                  />

                  <button
                    type="button"
                    onClick={() => setIsVoiceTutorOpen(true)}
                    className="p-2.5 rounded-full bg-slate-100 hover:bg-[#E8F0FE] text-[#5D6A80] hover:text-[#4285F4] transition-colors cursor-pointer shrink-0"
                    aria-label="Open Gemini Live Voice Tutor"
                    title="Speak with Gemini Live Voice Tutor"
                  >
                    <Mic className="w-4 h-4" />
                  </button>

                  <button
                    type="submit"
                    disabled={!questionInput.trim() || isAskingTutor}
                    aria-label="Send question"
                    className="w-11 h-11 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white flex items-center justify-center disabled:opacity-50 transition-colors shadow-xs shrink-0 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>

              {/* 3. CONTEXTUAL EXAMPLES & UNDERSTANDING CHECK (Horizontal Inner Card Navigation) */}
              <div className="google-gradient-card rounded-[28px] p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center">
                      <Lightbulb className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-base sm:text-lg text-[#17223C]">
                        Contextual Examples & Understanding Check
                      </h3>
                      <p className="text-xs text-[#5D6A80]">
                        Scroll horizontally through key concepts, formulas, and quick self-check prompts from {activeMaterial.title}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => scrollExamplesCarousel('left')}
                      aria-label="Previous concept card"
                      className="w-8 h-8 rounded-full bg-white hover:bg-slate-50 border border-slate-200 flex items-center justify-center text-[#17223C] cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollExamplesCarousel('right')}
                      aria-label="Next concept card"
                      className="w-8 h-8 rounded-full bg-white hover:bg-slate-50 border border-slate-200 flex items-center justify-center text-[#17223C] cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div
                  ref={examplesCarouselRef}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') scrollExamplesCarousel('right');
                    if (e.key === 'ArrowLeft') scrollExamplesCarousel('left');
                  }}
                  className="flex gap-4 overflow-x-auto no-scrollbar pb-1 scroll-smooth snap-x snap-mandatory focus:outline-none"
                >
                  {(analysis?.keyTopics || []).map((topic, idx) => {
                    const isCheckRevealed = Boolean(revealedCheckIndices[idx]);
                    return (
                      <div
                        key={idx}
                        className="snap-start shrink-0 w-[310px] sm:w-[340px] rounded-2xl bg-white border border-slate-200/90 p-5 flex flex-col justify-between gap-3 shadow-2xs"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#4285F4]">
                              Concept {idx + 1} of{' '}
                              {analysis?.keyTopics.length || 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleJumpToCitation(topic.pageNumbers[0] || 1)
                              }
                              className="px-2 py-0.5 rounded-md bg-[#E8F0FE] text-[#1967D2] text-[11px] font-bold cursor-pointer"
                            >
                              Page {topic.pageNumbers[0] || 1}
                            </button>
                          </div>

                          <h4 className="font-display font-bold text-sm sm:text-base text-[#17223C]">
                            {topic.name}
                          </h4>

                          <p className="text-xs text-[#5D6A80] leading-relaxed">
                            {topic.summary}
                          </p>

                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {topic.keyTerms.map((term, tIdx) => (
                              <span
                                key={tIdx}
                                className="px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-mono font-semibold text-[#17223C]"
                              >
                                {term}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-slate-100 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedCheckIndices((prev) => ({
                                  ...prev,
                                  [idx]: !prev[idx],
                                }))
                              }
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#15803D] hover:underline cursor-pointer"
                            >
                              <HelpCircle className="w-3.5 h-3.5" />
                              <span>
                                {isCheckRevealed
                                  ? 'Hide Self-Check'
                                  : 'Quick Self-Check'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleAskQuestion(
                                  `Walk me through a concrete worked example of "${topic.name}" from Page ${
                                    topic.pageNumbers[0] || 1
                                  }.`
                                )
                              }
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#4285F4] hover:underline cursor-pointer"
                            >
                              <span>Worked Example</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>

                          {isCheckRevealed && (
                            <div className="p-2.5 rounded-xl bg-[#F1FAF4] border border-[#BBF7D0] text-[11px] text-[#17223C]">
                              <strong>Check:</strong> Can you state how{' '}
                              <em>{topic.keyTerms[0] || topic.name}</em> applies
                              on Page {topic.pageNumbers[0] || 1}? Click "Worked
                              Example" to verify with the AI Tutor!
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 4. LEARNING INSIGHTS & NEXT STEPS STRIP */}
              <div className="google-gradient-card rounded-[24px] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#4285F4]" />
                    <h3 className="font-display font-bold text-sm sm:text-base text-[#17223C]">
                      Learning Insights & Study Continuity
                    </h3>
                  </div>
                  <p className="text-xs text-[#5D6A80]">
                    {submittedAttempt && submittedAttempt.weakTopics.length > 0
                      ? `Focus areas from your last quiz: ${submittedAttempt.weakTopics.join(', ')}. Review sticky notes or practice weak topics next.`
                      : `Ready to test your grasp of ${activeMaterial.title}? Review handwritten Sticky Notes or take the 6-question Diagnostic Quiz.`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickReviseMode('sticky_notes');
                      onChangeSubTab('quick_revise');
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FEF3C7] hover:bg-[#FDE68A] text-[#92400E] text-xs font-bold cursor-pointer"
                  >
                    <StickyNote className="w-3.5 h-3.5" />
                    <span>Open Sticky Notes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onChangeSubTab('quiz')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#EA4335] hover:bg-[#DC2626] text-white text-xs font-bold cursor-pointer"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    <span>Take Diagnostic Quiz</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB B: DIAGNOSTIC QUIZ (Matching Image 5 Canonical Design)     */}
          {/* ============================================================== */}
          {activeSubTab === 'quiz' && (
            <div className="google-gradient-panel rounded-[28px] p-6 sm:p-10 space-y-8">
              {/* Top Header Row matching Image 5 */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200/70">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-[#FEE2E2] border border-[#FECACA] text-[#EA4335] flex items-center justify-center shrink-0 shadow-2xs">
                    <ClipboardCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-display font-extrabold text-xl sm:text-2xl text-[#17223C]">
                      Diagnostic Quiz
                    </h2>
                    <p className="text-xs sm:text-sm text-[#5D6A80]">
                      Identify your topic strengths and learning gaps
                    </p>
                  </div>
                </div>

                {/* Top-right metadata pills matching Image 5 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-slate-200/90 text-xs font-bold text-[#17223C] shadow-2xs">
                    <HelpCircle className="w-3.5 h-3.5 text-[#EA4335]" />
                    <span>{quizQuestions.length || 6} Questions</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-slate-200/90 text-xs font-bold text-[#17223C] shadow-2xs">
                    <Sparkles className="w-3.5 h-3.5 text-[#F59E0B]" />
                    <span>Adaptive</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-slate-200/90 text-xs font-bold text-[#17223C] shadow-2xs">
                    <Clock className="w-3.5 h-3.5 text-[#4285F4]" />
                    <span>~10 Minutes</span>
                  </span>

                  {quizQuestions.length > 0 && !isGeneratingQuiz && (
                    <button
                      type="button"
                      onClick={handleGenerateDiagnosticQuiz}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] text-xs font-bold text-[#DC2626] transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>New Diagnostic Set</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Quiz Body */}
              {isGeneratingQuiz ? (
                <div className="py-20 flex flex-col items-center justify-center text-center space-y-3">
                  <Loader2 className="w-9 h-9 animate-spin text-[#EA4335]" />
                  <h3 className="font-display font-bold text-lg text-[#17223C]">
                    Generating Grounded Diagnostic Quiz...
                  </h3>
                  <p className="text-xs sm:text-sm text-[#5D6A80] max-w-md">
                    Gemini is crafting 6 multiple-choice questions with verified answer keys and page citations from {activeMaterial.title}.
                  </p>
                </div>
              ) : quizError ? (
                <div className="p-6 rounded-3xl bg-red-50 border border-red-200 text-center space-y-3">
                  <p className="text-sm font-semibold text-[#DC2626]">
                    {quizError}
                  </p>
                  <button
                    type="button"
                    onClick={handleGenerateDiagnosticQuiz}
                    className="px-6 py-2.5 rounded-full bg-[#EA4335] text-white text-xs font-bold cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              ) : quizQuestions.length === 0 ? (
                /* Canonical Diagnostic Quiz Intro Screen matching Image 5 */
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-4">
                  {/* Left Introductory Vector Illustration (5 cols) */}
                  <div className="lg:col-span-5 flex items-center justify-center">
                    <div className="w-full max-w-[300px] rounded-3xl bg-gradient-to-br from-[#EEF5FF] via-[#FFF8F6] to-[#F0FDF4] border border-slate-200/70 p-6 flex items-center justify-center shadow-2xs">
                      <svg
                        viewBox="0 0 260 220"
                        className="w-full h-auto drop-shadow-xs"
                        aria-hidden="true"
                      >
                        <circle
                          cx="130"
                          cy="110"
                          r="86"
                          fill="#FFFFFF"
                          fillOpacity="0.8"
                        />
                        {/* Clipboard Body */}
                        <rect
                          x="68"
                          y="34"
                          width="116"
                          height="152"
                          rx="16"
                          fill="#FFFFFF"
                          stroke="#93C5FD"
                          strokeWidth="3"
                        />
                        {/* Clipboard Top Clip */}
                        <rect
                          x="102"
                          y="22"
                          width="48"
                          height="20"
                          rx="8"
                          fill="#EA4335"
                        />
                        {/* Checkmark rows */}
                        <circle cx="94" cy="74" r="10" fill="#DCFCE7" />
                        <path
                          d="M90 74 L93 77 L99 71"
                          fill="none"
                          stroke="#16A34A"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        <line
                          x1="112"
                          y1="74"
                          x2="162"
                          y2="74"
                          stroke="#1E293B"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />

                        <circle cx="94" cy="108" r="10" fill="#E8F0FE" />
                        <path
                          d="M90 108 L93 111 L99 105"
                          fill="none"
                          stroke="#2563EB"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        <line
                          x1="112"
                          y1="108"
                          x2="156"
                          y2="108"
                          stroke="#1E293B"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />

                        <circle cx="94" cy="142" r="10" fill="#FEF3C7" />
                        <line
                          x1="112"
                          y1="142"
                          x2="148"
                          y2="142"
                          stroke="#94A3B8"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />

                        {/* A+ Badge */}
                        <g transform="translate(164, 42)">
                          <circle
                            cx="22"
                            cy="22"
                            r="22"
                            fill="#FEF2F2"
                            stroke="#FCA5A5"
                            strokeWidth="2"
                          />
                          <text
                            x="22"
                            y="27"
                            textAnchor="middle"
                            fill="#EA4335"
                            fontSize="15"
                            fontWeight="800"
                          >
                            A+
                          </text>
                        </g>
                      </svg>
                    </div>
                  </div>

                  {/* Right Content Column matching Image 5 (7 cols) */}
                  <div className="lg:col-span-7 space-y-6 text-left">
                    <div className="space-y-3">
                      <h3 className="font-display font-extrabold text-2xl sm:text-4xl tracking-tight text-[#17223C] leading-tight">
                        Ready to{' '}
                        <span className="text-[#4285F4]">test</span> your{' '}
                        <span className="bg-gradient-to-r from-[#EA4335] via-[#F59E0B] to-[#34A853] bg-clip-text text-transparent">
                          understanding?
                        </span>
                      </h3>
                      <p className="text-sm sm:text-base text-[#5D6A80] leading-relaxed max-w-xl">
                        Take a 6-question diagnostic quiz generated strictly from{' '}
                        <strong className="text-[#17223C]">
                          {activeMaterial.title}
                        </strong>
                        . LearnMate will grade your answers deterministically and build your{' '}
                        <strong className="text-[#17223C]">Mistake DNA</strong> &{' '}
                        <strong className="text-[#17223C]">Revision Plan</strong>.
                      </p>
                    </div>

                    {/* Three Benefit Items matching Image 5 */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div className="rounded-2xl bg-white border border-slate-200/90 p-3.5 flex items-start gap-3 shadow-2xs">
                        <div className="w-8 h-8 rounded-xl bg-[#E8F0FE] text-[#4285F4] flex items-center justify-center shrink-0 mt-0.5">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-display font-bold text-xs sm:text-sm text-[#17223C] block">
                            Topic-focused
                          </span>
                          <span className="text-[11px] text-[#5D6A80]">
                            Questions from your material
                          </span>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white border border-slate-200/90 p-3.5 flex items-start gap-3 shadow-2xs">
                        <div className="w-8 h-8 rounded-xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center shrink-0 mt-0.5">
                          <Target className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-display font-bold text-xs sm:text-sm text-[#17223C] block">
                            Find your gaps
                          </span>
                          <span className="text-[11px] text-[#5D6A80]">
                            Pinpoint weak areas
                          </span>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white border border-slate-200/90 p-3.5 flex items-start gap-3 shadow-2xs">
                        <div className="w-8 h-8 rounded-xl bg-[#DCFCE7] text-[#15803D] flex items-center justify-center shrink-0 mt-0.5">
                          <Award className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-display font-bold text-xs sm:text-sm text-[#17223C] block">
                            Personalized plan
                          </span>
                          <span className="text-[11px] text-[#5D6A80]">
                            Custom revision path
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Prominent Coral/Red Generate Button matching Image 5 */}
                    <div className="pt-1 flex flex-wrap items-center gap-4">
                      <button
                        type="button"
                        onClick={handleGenerateDiagnosticQuiz}
                        className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-gradient-to-r from-[#EA4335] to-[#F97316] hover:from-[#DC2626] hover:to-[#EA580C] text-white font-display font-bold text-sm sm:text-base shadow-[0_12px_28px_rgba(234,67,53,0.32)] transition-all active:scale-98 cursor-pointer"
                      >
                        <Sparkles className="w-5 h-5" />
                        <span>Generate Diagnostic Quiz</span>
                        <ArrowRight className="w-5 h-5" />
                      </button>

                      {submittedAttempt && (
                        <span className="text-xs font-semibold text-[#5D6A80]">
                          Last score:{' '}
                          <strong className="text-[#17223C]">
                            {submittedAttempt.score}/{submittedAttempt.total} (
                            {submittedAttempt.percentage}%)
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : submittedAttempt ? (
                /* Quiz Results Breakdown View */
                <div className="space-y-6 max-w-4xl mx-auto">
                  <div className="rounded-3xl bg-slate-50 border border-slate-200/90 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-[#5D6A80]">
                        Diagnostic Quiz Result
                      </span>
                      <div className="flex items-baseline gap-3 mt-1">
                        <span className="font-display text-3xl sm:text-4xl font-extrabold text-[#17223C] tabular-nums">
                          {submittedAttempt.score} / {submittedAttempt.total}
                        </span>
                        <span
                          className={`text-base font-extrabold tabular-nums ${
                            submittedAttempt.percentage >= 80
                              ? 'text-[#16A34A]'
                              : submittedAttempt.percentage >= 50
                                ? 'text-[#D97706]'
                                : 'text-[#DC2626]'
                          }`}
                        >
                          ({submittedAttempt.percentage}% Accuracy)
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-[#5D6A80] mt-1">
                        {submittedAttempt.weakTopics.length > 0
                          ? `Weak topics identified: ${submittedAttempt.weakTopics.join(' · ')}`
                          : 'Excellent! You answered every topic accurately.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => onChangeSubTab('mistakes')}
                        className="px-4 py-2.5 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-bold cursor-pointer"
                      >
                        View Mistake DNA
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeSubTab('revision')}
                        className="px-4 py-2.5 rounded-xl bg-[#34A853] hover:bg-[#16A34A] text-white text-xs font-bold cursor-pointer"
                      >
                        Open Revision Plan
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-display font-bold text-base text-[#17223C]">
                      Question-by-Question Breakdown
                    </h3>
                    {submittedAttempt.results.map((res, idx) => (
                      <div
                        key={res.questionId}
                        className={`rounded-3xl border p-5 space-y-2.5 ${
                          res.isCorrect
                            ? 'bg-[#F1FAF4]/60 border-[#BBF7D0]'
                            : 'bg-[#FDF3F2]/60 border-[#FECACA]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 text-xs font-bold">
                            {res.isCorrect ? (
                              <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
                            )}
                            <span className="text-[#17223C]">
                              Q{idx + 1}. {res.topic}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleJumpToCitation(res.pageNumber)}
                            className="text-xs font-bold text-[#1967D2] hover:underline shrink-0 cursor-pointer"
                          >
                            Source: Page {res.pageNumber}
                          </button>
                        </div>

                        <p className="text-sm sm:text-base font-bold text-[#17223C]">
                          {res.question}
                        </p>

                        <div className="text-xs sm:text-sm space-y-1">
                          <p
                            className={
                              res.isCorrect
                                ? 'text-[#15803D] font-semibold'
                                : 'text-[#DC2626] font-semibold'
                            }
                          >
                            Your Answer: {res.selectedOption}
                          </p>
                          {!res.isCorrect && (
                            <p className="text-[#15803D] font-semibold">
                              Correct Answer: {res.correctOption}
                            </p>
                          )}
                        </div>

                        <p className="text-xs sm:text-sm text-[#5D6A80] bg-white/90 rounded-2xl p-3.5 border border-slate-200/70 leading-relaxed">
                          <strong className="text-[#17223C]">
                            Explanation:{' '}
                          </strong>
                          {res.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Single-Question-At-A-Time Interactive Quiz Runner */
                activeQuestion && (
                  <div className="max-w-3xl mx-auto space-y-6">
                    {/* Question Progress Bar & Number Dots */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-[#EA4335] uppercase tracking-wider">
                          Question {currentQuestionIdx + 1} of{' '}
                          {quizQuestions.length} · {activeQuestion.topic}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {quizQuestions.map((q, idx) => {
                            const isAnswered =
                              selectedAnswers[q.id] !== undefined;
                            return (
                              <button
                                key={q.id}
                                type="button"
                                onClick={() => setCurrentQuestionIdx(idx)}
                                aria-label={`Go to question ${idx + 1}`}
                                className={`w-7 h-7 rounded-full text-xs font-bold tabular-nums transition-all cursor-pointer ${
                                  idx === currentQuestionIdx
                                    ? 'bg-[#EA4335] text-white ring-2 ring-[#EA4335]/30'
                                    : isAnswered
                                      ? 'bg-[#17223C] text-white'
                                      : 'bg-slate-100 text-[#5D6A80] hover:bg-slate-200'
                                }`}
                              >
                                {idx + 1}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#EA4335] to-[#F59E0B] transition-all duration-300"
                          style={{
                            width: `${Math.round(
                              ((currentQuestionIdx + 1) /
                                quizQuestions.length) *
                                100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-display font-bold text-lg sm:text-xl text-[#17223C] leading-snug">
                        {activeQuestion.question}
                      </h3>

                      <div className="space-y-3" role="radiogroup">
                        {activeQuestion.options.map((opt, optIdx) => {
                          const isSelected =
                            selectedAnswers[activeQuestion.id] === optIdx;
                          const optionLetter =
                            ['A', 'B', 'C', 'D'][optIdx] || 'A';
                          return (
                            <button
                              key={optIdx}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              onClick={() =>
                                setSelectedAnswers((prev) => ({
                                  ...prev,
                                  [activeQuestion.id]: optIdx,
                                }))
                              }
                              className={`w-full text-left p-4 sm:p-5 rounded-2xl border-2 flex items-start gap-4 transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-[#FEF2F2] border-[#EA4335] shadow-xs'
                                  : 'bg-white hover:bg-slate-50 border-slate-200/90'
                              }`}
                            >
                              <span
                                className={`w-8 h-8 rounded-xl font-display font-bold text-xs flex items-center justify-center shrink-0 ${
                                  isSelected
                                    ? 'bg-[#EA4335] text-white'
                                    : 'bg-slate-100 text-[#17223C]'
                                }`}
                              >
                                {optionLetter}
                              </span>
                              <span className="text-sm sm:text-base text-[#17223C] pt-0.5 leading-relaxed">
                                {opt}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-200/70 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        disabled={currentQuestionIdx === 0}
                        onClick={() =>
                          setCurrentQuestionIdx((i) => Math.max(0, i - 1))
                        }
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-[#17223C] hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>Previous</span>
                      </button>

                      <span className="text-xs font-semibold text-[#5D6A80] tabular-nums">
                        {answeredCount} of {quizQuestions.length} answered
                      </span>

                      {currentQuestionIdx < quizQuestions.length - 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentQuestionIdx((i) =>
                              Math.min(quizQuestions.length - 1, i + 1)
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#17223C] hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                        >
                          <span>Next Question</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!allDiagnosticAnswered}
                          onClick={handleSubmitDiagnosticQuiz}
                          className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#EA4335] hover:bg-[#DC2626] text-white font-display font-bold text-xs sm:text-sm shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                        >
                          <span>Submit & Grade Quiz</span>
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB C: MISTAKE DNA (Full-Width Google-Gradient Panel)          */}
          {/* ============================================================== */}
          {activeSubTab === 'mistakes' && (
            <div className="google-gradient-panel rounded-[28px] p-6 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/70">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-2xl bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706] flex items-center justify-center shrink-0">
                    <Target className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display font-extrabold text-xl sm:text-2xl text-[#17223C]">
                      Mistake DNA — Misconception Diagnosis
                    </h2>
                    <p className="text-xs sm:text-sm text-[#5D6A80]">
                      Pinpoints why errors happened and links directly to the source page to fix them
                    </p>
                  </div>
                </div>

                {submittedAttempt && submittedAttempt.weakTopics.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      handleStartAdaptivePractice(submittedAttempt.weakTopics)
                    }
                    className="px-4 py-2.5 rounded-full bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Practice Weak Topics →
                  </button>
                )}
              </div>

              <div>
                {!submittedAttempt ? (
                  <div className="py-14 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center">
                      <Target className="w-7 h-7" />
                    </div>
                    <div className="max-w-md space-y-1.5">
                      <h3 className="font-display font-bold text-lg text-[#17223C]">
                        Complete a Diagnostic Quiz First
                      </h3>
                      <p className="text-xs sm:text-sm text-[#5D6A80]">
                        Mistake DNA analyzes your actual quiz answers to uncover underlying misconceptions. Take a diagnostic quiz on{' '}
                        <strong className="text-[#17223C]">
                          {activeMaterial.title}
                        </strong>{' '}
                        to unlock your Mistake DNA profile.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChangeSubTab('quiz')}
                      className="px-7 py-3 rounded-full bg-[#D97706] hover:bg-[#B45309] text-white font-display font-bold text-sm cursor-pointer"
                    >
                      Go to Diagnostic Quiz
                    </button>
                  </div>
                ) : submittedAttempt.weakTopics.length === 0 ? (
                  <div className="rounded-3xl bg-[#F1FAF4] border border-[#BBF7D0] p-8 text-center space-y-3">
                    <CheckCircle2 className="w-10 h-10 text-[#16A34A] mx-auto" />
                    <h3 className="font-display font-bold text-lg text-[#17223C]">
                      Zero Misconceptions Detected!
                    </h3>
                    <p className="text-xs sm:text-sm text-[#5D6A80] max-w-md mx-auto">
                      You scored 100% ({submittedAttempt.score}/
                      {submittedAttempt.total}) on your diagnostic quiz. All tested topics are currently strong.
                    </p>
                  </div>
                ) : isAnalyzingMistakes ? (
                  <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-[#D97706]" />
                    <h3 className="font-display font-bold text-base text-[#17223C]">
                      Decoding Your Mistake DNA...
                    </h3>
                    <p className="text-xs text-[#5D6A80] max-w-sm">
                      Gemini is analyzing your incorrect choices to identify root conceptual misconceptions.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {mistakeError && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        {mistakeError}
                      </div>
                    )}

                    {(mistakeInsights.length > 0
                      ? mistakeInsights
                      : submittedAttempt.weakTopics.map((wt) => {
                          const wrongRes = submittedAttempt.results.find(
                            (r) => !r.isCorrect && r.topic === wt
                          );
                          return {
                            topic: wt,
                            wrongCount: 1,
                            totalAsked: 1,
                            misconception: `Selected "${wrongRes?.selectedOption}" instead of "${wrongRes?.correctOption}".`,
                            whyItHappens:
                              'Common conceptual mix-up when applying definitions under time pressure.',
                            coreCorrection:
                              wrongRes?.explanation ||
                              `Review the core rule for ${wt}.`,
                            pageNumber: wrongRes?.pageNumber || 1,
                            sourceReference: `Page ${wrongRes?.pageNumber || 1}`,
                          };
                        })
                    ).map((insight, idx) => (
                      <div
                        key={idx}
                        className="rounded-3xl border border-[#FDE68A] bg-[#FFFDF7] p-6 space-y-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#B45309]">
                              Weak Topic #{idx + 1} · Missed{' '}
                              {insight.wrongCount} of {insight.totalAsked}
                            </span>
                            <h3 className="font-display font-bold text-lg text-[#17223C] mt-0.5">
                              {insight.topic}
                            </h3>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleJumpToCitation(insight.pageNumber)
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1D4ED8] text-xs font-bold shrink-0 cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>{insight.sourceReference}</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs sm:text-sm">
                          <div className="bg-red-50/70 border border-red-100 rounded-2xl p-4 space-y-1">
                            <span className="font-bold text-[#DC2626]">
                              Likely Misconception:
                            </span>
                            <p className="text-[#17223C] leading-relaxed">
                              {insight.misconception}
                            </p>
                          </div>
                          <div className="bg-amber-50/70 border border-amber-100 rounded-2xl p-4 space-y-1">
                            <span className="font-bold text-[#B45309]">
                              Why Students Fall for This Trap:
                            </span>
                            <p className="text-[#17223C] leading-relaxed">
                              {insight.whyItHappens}
                            </p>
                          </div>
                        </div>

                        <div className="bg-[#F1FAF4] border border-[#BBF7D0] rounded-2xl p-4 text-xs sm:text-sm space-y-1">
                          <span className="font-bold text-[#15803D]">
                            Grounded Core Correction:
                          </span>
                          <p className="text-[#17223C] leading-relaxed">
                            {insight.coreCorrection}
                          </p>
                        </div>

                        <div className="flex items-center justify-end gap-2.5 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              onChangeSubTab('tutor');
                              handleAskQuestion(
                                `Help me overcome my misconception on "${insight.topic}": ${insight.misconception}`
                              );
                            }}
                            className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-[#17223C] cursor-pointer"
                          >
                            Ask AI Tutor to Clarify
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleStartAdaptivePractice([insight.topic])
                            }
                            className="px-4 py-2 rounded-xl bg-[#4285F4] hover:bg-[#2563EB] text-white text-xs font-bold cursor-pointer"
                          >
                            Practice "{insight.topic}" Now
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB D: PERSONALIZED REVISION PLAN (Full-Width Gradient Panel)  */}
          {/* ============================================================== */}
          {activeSubTab === 'revision' && (
            <div className="google-gradient-panel rounded-[28px] p-6 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/70">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-2xl bg-[#DCFCE7] border border-[#86EFAC] text-[#15803D] flex items-center justify-center shrink-0">
                    <ListChecks className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display font-extrabold text-xl sm:text-2xl text-[#17223C]">
                      Personalized Revision Plan
                    </h2>
                    <p className="text-xs sm:text-sm text-[#5D6A80]">
                      Prioritized study tasks generated from your quiz performance and updated as you improve
                    </p>
                  </div>
                </div>

                {revisionPlan.length > 0 && (
                  <span className="text-xs font-bold text-[#15803D] bg-[#F1FAF4] px-4 py-1.5 rounded-full border border-[#BBF7D0] tabular-nums self-start sm:self-auto">
                    {completedTasksCount} / {revisionPlan.length} Completed
                  </span>
                )}
              </div>

              <div>
                {revisionPlan.length === 0 ? (
                  <div className="py-14 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center">
                      <ListChecks className="w-7 h-7" />
                    </div>
                    <div className="max-w-md space-y-1.5">
                      <h3 className="font-display font-bold text-lg text-[#17223C]">
                        No Revision Plan Generated Yet
                      </h3>
                      <p className="text-xs sm:text-sm text-[#5D6A80]">
                        Complete a Diagnostic Quiz first so LearnMate can build a prioritized revision plan tailored to your weak topics.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChangeSubTab('quiz')}
                      className="px-7 py-3 rounded-full bg-[#34A853] hover:bg-[#16A34A] text-white font-display font-bold text-sm cursor-pointer"
                    >
                      Take Diagnostic Quiz
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {revisionPlan.map((task) => {
                      const priorityColors = {
                        High: 'bg-red-100 text-[#DC2626]',
                        Medium: 'bg-amber-100 text-[#B45309]',
                        Low: 'bg-emerald-100 text-[#15803D]',
                      }[task.priority];

                      return (
                        <div
                          key={task.id}
                          className={`rounded-3xl border p-5 transition-all space-y-3 ${
                            task.completed
                              ? 'bg-slate-50/70 border-slate-200 opacity-85'
                              : 'bg-white border-slate-200/90 shadow-2xs'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleRevisionTask(task.id)
                                }
                                aria-label={`Mark ${task.topic} as ${
                                  task.completed ? 'incomplete' : 'completed'
                                }`}
                                className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                                  task.completed
                                    ? 'bg-[#34A853] border-[#34A853] text-white'
                                    : 'border-slate-300 hover:border-[#34A853]'
                                }`}
                              >
                                {task.completed && (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3
                                    className={`font-display font-bold text-base ${
                                      task.completed
                                        ? 'line-through text-slate-500'
                                        : 'text-[#17223C]'
                                    }`}
                                  >
                                    {task.topic}
                                  </h3>
                                  <span
                                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${priorityColors}`}
                                  >
                                    {task.priority} Priority
                                  </span>
                                  {task.masteredInAdaptive && (
                                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-[#1D4ED8]">
                                      Mastered in Adaptive Practice
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs sm:text-sm text-[#5D6A80] mt-1">
                                  {task.recommendedAction}
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                handleJumpToCitation(task.pageNumber)
                              }
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1D4ED8] text-xs font-bold shrink-0 cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Page {task.pageNumber}</span>
                            </button>
                          </div>

                          <div className="pl-8 space-y-2.5">
                            <p className="text-xs sm:text-sm text-[#5D6A80] bg-slate-50 rounded-2xl p-3.5 border border-slate-200/70">
                              <strong className="text-[#17223C]">
                                Concept Focus:{' '}
                              </strong>
                              {task.conceptSummary}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleJumpToCitation(task.pageNumber)
                                }
                                className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-[#17223C] hover:bg-slate-50 cursor-pointer"
                              >
                                Read Source Page {task.pageNumber}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleStartAdaptivePractice([task.topic])
                                }
                                className="px-4 py-1.5 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-bold cursor-pointer"
                              >
                                Complete Practice Task
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB E: ADAPTIVE PRACTICE (Full-Width Google-Gradient Panel)    */}
          {/* ============================================================== */}
          {activeSubTab === 'adaptive' && (
            <div className="google-gradient-panel rounded-[28px] p-6 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/70">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-2xl bg-[#E8F0FE] border border-[#93C5FD] text-[#1D4ED8] flex items-center justify-center shrink-0">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display font-extrabold text-xl sm:text-2xl text-[#17223C]">
                      Adaptive Practice
                    </h2>
                    <p className="text-xs sm:text-sm text-[#5D6A80]">
                      Generates targeted questions on your weak topics and updates your Revision Plan automatically
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isGeneratingAdaptive}
                  onClick={() => handleStartAdaptivePractice()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-bold disabled:opacity-50 cursor-pointer self-start sm:self-auto"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>New Targeted Set</span>
                </button>
              </div>

              <div>
                {isGeneratingAdaptive ? (
                  <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-[#1D4ED8]" />
                    <h3 className="font-display font-bold text-base text-[#17223C]">
                      Generating Adaptive Practice Questions...
                    </h3>
                    <p className="text-xs text-[#5D6A80] max-w-sm">
                      Focusing specifically on: {adaptiveTopics.join(', ')}
                    </p>
                  </div>
                ) : adaptiveError ? (
                  <div className="p-6 rounded-2xl bg-red-50 border border-red-200 text-center space-y-3">
                    <p className="text-sm font-semibold text-[#DC2626]">
                      {adaptiveError}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleStartAdaptivePractice()}
                      className="px-5 py-2 rounded-full bg-[#1D4ED8] text-white text-xs font-bold cursor-pointer"
                    >
                      Retry Adaptive Practice
                    </button>
                  </div>
                ) : adaptiveQuestions.length === 0 ? (
                  <div className="py-14 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-[#DBEAFE] text-[#1D4ED8] flex items-center justify-center">
                      <Zap className="w-7 h-7" />
                    </div>
                    <div className="max-w-md space-y-1.5">
                      <h3 className="font-display font-bold text-lg text-[#17223C]">
                        Targeted Weak-Topic Practice
                      </h3>
                      <p className="text-xs sm:text-sm text-[#5D6A80]">
                        {adaptiveTopics.length > 0
                          ? `Ready to generate 5 new practice questions focused on: ${adaptiveTopics.join(', ')}.`
                          : 'Generate a targeted 5-question practice session to reinforce your mastery.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleStartAdaptivePractice()}
                      className="px-7 py-3 rounded-full bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-display font-bold text-sm shadow-sm cursor-pointer"
                    >
                      Start Adaptive Practice
                    </button>
                  </div>
                ) : submittedAdaptive ? (
                  <div className="space-y-6 max-w-4xl mx-auto">
                    <div className="rounded-3xl bg-[#F3F7FE] border border-[#BFDBFE] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-[#1D4ED8]">
                          Adaptive Practice Result
                        </span>
                        <div className="flex items-baseline gap-3 mt-1">
                          <span className="font-display text-3xl font-extrabold text-[#17223C] tabular-nums">
                            {submittedAdaptive.score} /{' '}
                            {submittedAdaptive.total}
                          </span>
                          <span className="text-sm font-bold text-[#16A34A] tabular-nums">
                            ({submittedAdaptive.percentage}% Accuracy)
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-[#5D6A80] mt-1">
                          {submittedAdaptive.strongTopics.length > 0
                            ? `Mastered & marked complete in your Revision Plan: ${submittedAdaptive.strongTopics.join(', ')}`
                            : 'Keep practicing to lock in mastery.'}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => onChangeSubTab('revision')}
                        className="px-4 py-2.5 rounded-xl bg-[#34A853] hover:bg-[#16A34A] text-white text-xs font-bold cursor-pointer"
                      >
                        View Updated Revision Plan
                      </button>
                    </div>

                    <div className="space-y-3">
                      {submittedAdaptive.results.map((res, idx) => (
                        <div
                          key={res.questionId}
                          className={`rounded-3xl border p-5 space-y-2 ${
                            res.isCorrect
                              ? 'bg-[#F1FAF4]/60 border-[#BBF7D0]'
                              : 'bg-[#FDF3F2]/60 border-[#FECACA]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs font-bold">
                            <span>
                              Q{idx + 1}. {res.topic}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleJumpToCitation(res.pageNumber)
                              }
                              className="text-[#2563EB] hover:underline cursor-pointer"
                            >
                              Page {res.pageNumber}
                            </button>
                          </div>
                          <p className="text-sm sm:text-base font-bold text-[#17223C]">
                            {res.question}
                          </p>
                          <p className="text-xs sm:text-sm text-[#5D6A80]">
                            <span className="font-semibold">Your Answer:</span>{' '}
                            {res.selectedOption}{' '}
                            {!res.isCorrect &&
                              `| Correct Answer: ${res.correctOption}`}
                          </p>
                          <p className="text-xs text-[#5D6A80]">
                            {res.explanation}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  activeAdaptiveQuestion && (
                    <div className="max-w-3xl mx-auto space-y-6">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#1D4ED8] uppercase tracking-wider">
                          Adaptive Question {adaptiveIdx + 1} of{' '}
                          {adaptiveQuestions.length} ·{' '}
                          {activeAdaptiveQuestion.topic}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {adaptiveQuestions.map((q, idx) => (
                            <button
                              key={q.id}
                              type="button"
                              onClick={() => setAdaptiveIdx(idx)}
                              className={`w-7 h-7 rounded-full text-xs font-bold tabular-nums cursor-pointer ${
                                idx === adaptiveIdx
                                  ? 'bg-[#1D4ED8] text-white'
                                  : adaptiveAnswers[q.id] !== undefined
                                    ? 'bg-[#17223C] text-white'
                                    : 'bg-slate-100 text-[#5D6A80]'
                              }`}
                            >
                              {idx + 1}
                            </button>
                          ))}
                        </div>
                      </div>

                      <h3 className="font-display font-bold text-lg sm:text-xl text-[#17223C]">
                        {activeAdaptiveQuestion.question}
                      </h3>

                      <div className="space-y-3">
                        {activeAdaptiveQuestion.options.map((opt, optIdx) => {
                          const isSelected =
                            adaptiveAnswers[activeAdaptiveQuestion.id] ===
                            optIdx;
                          const letter = ['A', 'B', 'C', 'D'][optIdx] || 'A';
                          return (
                            <button
                              key={optIdx}
                              type="button"
                              onClick={() =>
                                setAdaptiveAnswers((prev) => ({
                                  ...prev,
                                  [activeAdaptiveQuestion.id]: optIdx,
                                }))
                              }
                              className={`w-full text-left p-4 sm:p-5 rounded-2xl border-2 flex items-start gap-4 transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-[#EBF2FE] border-[#1D4ED8]'
                                  : 'bg-white hover:bg-slate-50 border-slate-200/90'
                              }`}
                            >
                              <span
                                className={`w-8 h-8 rounded-xl font-display font-bold text-xs flex items-center justify-center shrink-0 ${
                                  isSelected
                                    ? 'bg-[#1D4ED8] text-white'
                                    : 'bg-slate-100 text-[#17223C]'
                                }`}
                              >
                                {letter}
                              </span>
                              <span className="text-sm sm:text-base text-[#17223C] pt-0.5">
                                {opt}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="pt-4 border-t border-slate-200/70 flex items-center justify-between">
                        <button
                          type="button"
                          disabled={adaptiveIdx === 0}
                          onClick={() =>
                            setAdaptiveIdx((i) => Math.max(0, i - 1))
                          }
                          className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-[#17223C] disabled:opacity-40 cursor-pointer"
                        >
                          Previous
                        </button>

                        {adaptiveIdx < adaptiveQuestions.length - 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAdaptiveIdx((i) =>
                                Math.min(adaptiveQuestions.length - 1, i + 1)
                              )
                            }
                            className="px-5 py-2.5 rounded-xl bg-[#17223C] text-white text-xs font-bold cursor-pointer"
                          >
                            Next Question
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!allAdaptiveAnswered}
                            onClick={handleSubmitAdaptiveQuiz}
                            className="px-7 py-3 rounded-full bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-display font-bold text-xs sm:text-sm disabled:opacity-50 cursor-pointer"
                          >
                            Submit Adaptive Practice
                          </button>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB F: QUICK REVISE (Matching Image 6 Full-Width Panel)        */}
          {/* ============================================================== */}
          {isQuickReviseActive && (
            <QuickRevisePanel
              material={activeMaterial}
              selectedModel={selectedModel}
              onJumpToCitation={handleJumpToCitation}
              initialMode={quickReviseMode}
              onAskTutorAboutConcept={(prompt) => {
                onChangeSubTab('tutor');
                handleAskQuestion(prompt);
              }}
            />
          )}

          {/* ============================================================== */}
          {/* TAB G: EXPLORE FURTHER (Matching Image 4 Full-Width Panel)     */}
          {/* ============================================================== */}
          {activeSubTab === 'explore' && (
            <ExploreFurtherPanel
              material={activeMaterial}
              analysis={analysis}
              weakTopics={adaptiveTopics}
              selectedModel={selectedModel}
              onMaterialImported={(newMat: StudyMaterial) => {
                if (onMaterialReady) {
                  onMaterialReady(newMat, 'tutor');
                } else {
                  storageService.saveMaterial(newMat);
                  onSelectMaterial(newMat);
                }
              }}
            />
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* STUDY MATERIAL READER MODAL / DRAWER (On-demand when clicking P.X)   */}
      {/* ==================================================================== */}
      {isSourceModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Study Material Reader"
        >
          <div className="google-gradient-panel rounded-[32px] max-w-4xl w-full p-5 sm:p-6 shadow-2xl space-y-3 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <BookOpen className="w-5 h-5 text-[#4285F4]" />
                <h2 className="font-display font-bold text-base sm:text-lg text-[#17223C]">
                  Study Material Reader · {activeMaterial.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsSourceModalOpen(false)}
                className="px-4 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#17223C] cursor-pointer"
              >
                Close Reader
              </button>
            </div>
            <MaterialViewer
              material={activeMaterial}
              currentPage={currentPage}
              highlightedSnippet={highlightedSnippet}
              onSelectPage={(page) => {
                handleSelectPageAndTrack(page);
                setHighlightedSnippet(null);
              }}
              onClearHighlight={() => setHighlightedSnippet(null)}
            />
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* GEMINI LIVE VOICE TUTOR MODAL (Matching Image 3)                     */}
      {/* ==================================================================== */}
      <VoiceTutorModal
        isOpen={isVoiceTutorOpen}
        onClose={() => setIsVoiceTutorOpen(false)}
        material={activeMaterial}
        analysis={analysis}
        weakTopics={adaptiveTopics}
        messages={tutorMessages}
        onUpdateMessages={(updated) => setTutorMessages(updated)}
        onJumpToCitation={(pageNumber, snippet) => {
          setIsVoiceTutorOpen(false);
          handleJumpToCitation(pageNumber, snippet);
        }}
      />
    </div>
  );
};
