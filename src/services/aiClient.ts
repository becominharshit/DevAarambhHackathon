import { hashRequestPayload } from '../lib/geminiRequestManager';
import { normalizeYouTubeCacheKey, verifyCitations } from '../lib/studyLogic';
import {
  Citation,
  DocumentAnalysis,
  FlashcardItem,
  GeminiModelOption,
  MindMapData,
  MistakeInsight,
  OnePageRevisionSheet,
  QuizQuestion,
  QuizQuestionResult,
  StickyNote,
  StudyMaterial,
  StudyPage,
  TopicInfo,
  TutorResponseStyle,
  TutorSourceMode,
  YouTubeAnalysisJobState,
  YouTubeProcessingMode,
  YouTubeRecommendation,
} from '../types/study';
import {
  getCurrentAuthenticatedUid,
  getCurrentUserAuthToken,
} from './firebaseService';
import { storageService } from './storageService';

const clientInFlight = new Map<string, Promise<any>>();
const activeAbortControllers = new Map<string, AbortController>();

/**
 * Cancels all pending user-specific in-flight AI requests on logout or account switch.
 */
export function cancelAllClientRequests(): void {
  activeAbortControllers.forEach((controller) => {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  });
  activeAbortControllers.clear();
  clientInFlight.clear();
}

/**
 * Cancels in-flight requests matching a specific operation prefix (e.g. 'youtube_analyze', 'quick_notes', 'ask_tutor').
 */
export function cancelOperationRequests(operationPrefix: string): void {
  for (const [key, controller] of activeAbortControllers.entries()) {
    if (key.includes(operationPrefix)) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
      activeAbortControllers.delete(key);
      clientInFlight.delete(key);
    }
  }
}

async function postJsonDeduplicated<T>(
  operation: string,
  url: string,
  body: Record<string, unknown>
): Promise<T> {
  const uid = getCurrentAuthenticatedUid() || 'anonymous';
  const dedupeKey = hashRequestPayload(`${uid}::${operation}`, body);
  const existing = clientInFlight.get(dedupeKey);
  if (existing) {
    return existing as Promise<T>;
  }

  const controller = new AbortController();
  activeAbortControllers.set(dedupeKey, controller);

  const requestPromise = (async (): Promise<T> => {
    const idToken = await getCurrentUserAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(
        data?.error || `Request failed with status ${response.status}`
      );
      err.status = response.status;
      err.category = data?.category;
      err.retryable = Boolean(data?.retryable);
      err.jobId = data?.jobId;
      throw err;
    }
    return data as T;
  })();

  clientInFlight.set(dedupeKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    clientInFlight.delete(dedupeKey);
    activeAbortControllers.delete(dedupeKey);
  }
}

/**
 * Analyzes a study material via server-side Gemini Flash and caches the result locally under the user's UID.
 */
export async function analyzeMaterial(
  material: StudyMaterial,
  forceRefresh = false,
  model?: GeminiModelOption
): Promise<DocumentAnalysis> {
  const cached = storageService.getDocumentAnalysis(material.id);
  if (!forceRefresh && cached) {
    return cached;
  }

  const analysis = await postJsonDeduplicated<DocumentAnalysis>(
    'analyze_material',
    '/api/ai/analyze',
    {
      materialId: material.id,
      title: material.title,
      pages: material.pages,
      model,
      forceRefresh,
    }
  );

  storageService.saveDocumentAnalysis(analysis);
  return analysis;
}

/**
 * Queries the hybrid context-aware AI Study Tutor and verifies returned citations against actual material pages.
 */
export async function askStudyTutor(params: {
  material?: StudyMaterial | null;
  question: string;
  history: Array<{ role: string; content: string }>;
  currentPage?: number;
  currentTopic?: string;
  weakTopics?: string[];
  recentScore?: number;
  responseStyle?: TutorResponseStyle;
  model?: GeminiModelOption;
  onPartialAnswer?: (partialText: string) => void;
  onStageUpdate?: (stageMessage: string) => void;
}): Promise<{
  supported: boolean;
  sourceMode: TutorSourceMode;
  answer: string;
  citations: Citation[];
  followUpQuestions: string[];
}> {
  const pages = params.material?.pages || [];
  const savedAnalysis = params.material
    ? storageService.getDocumentAnalysis(params.material.id)
    : null;

  // Use progressive SSE stream when onPartialAnswer callback is supplied
  if (params.onPartialAnswer) {
    try {
      return await askStudyTutorStream({
        ...params,
        savedAnalysis,
      });
    } catch (streamErr: any) {
      if (streamErr?.name === 'AbortError') throw streamErr;
      // Fallback to standard JSON endpoint if SSE fails for any non-abort reason
    }
  }

  const raw = await postJsonDeduplicated<{
    supported: boolean;
    sourceMode?: TutorSourceMode;
    answer: string;
    citations: Citation[];
    followUpQuestions: string[];
  }>('ask_tutor', '/api/ai/tutor', {
    question: params.question,
    pages,
    analysis: savedAnalysis,
    currentPage: params.currentPage,
    history: params.history,
    materialTitle: params.material?.title,
    currentTopic: params.currentTopic,
    weakTopics: params.weakTopics,
    recentScore: params.recentScore,
    responseStyle: params.responseStyle || 'concise',
    model: params.model,
  });

  const verified =
    raw.supported && pages.length > 0
      ? verifyCitations(raw.citations, pages)
      : [];

  return {
    supported: raw.supported,
    sourceMode: raw.sourceMode || (raw.supported ? 'material' : 'general'),
    answer: raw.answer,
    citations: verified,
    followUpQuestions: raw.followUpQuestions || [],
  };
}

async function askStudyTutorStream(params: {
  material?: StudyMaterial | null;
  savedAnalysis?: DocumentAnalysis | null;
  question: string;
  history: Array<{ role: string; content: string }>;
  currentPage?: number;
  currentTopic?: string;
  weakTopics?: string[];
  recentScore?: number;
  responseStyle?: TutorResponseStyle;
  model?: GeminiModelOption;
  onPartialAnswer?: (partialText: string) => void;
  onStageUpdate?: (stageMessage: string) => void;
}): Promise<{
  supported: boolean;
  sourceMode: TutorSourceMode;
  answer: string;
  citations: Citation[];
  followUpQuestions: string[];
}> {
  const pages = params.material?.pages || [];
  const uid = getCurrentAuthenticatedUid() || 'anonymous';
  const streamKey = `${uid}::ask_tutor_stream::${Date.now()}`;
  const controller = new AbortController();
  activeAbortControllers.set(streamKey, controller);

  try {
    const idToken = await getCurrentUserAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }

    const response = await fetch('/api/ai/tutor/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: params.question,
        pages,
        analysis: params.savedAnalysis,
        currentPage: params.currentPage,
        history: params.history,
        materialTitle: params.material?.title,
        currentTopic: params.currentTopic,
        weakTopics: params.weakTopics,
        recentScore: params.recentScore,
        responseStyle: params.responseStyle || 'concise',
        model: params.model,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const errData = await response.json().catch(() => ({}));
      const err: any = new Error(
        errData?.error || `Tutor request failed with status ${response.status}`
      );
      err.status = response.status;
      err.category = errData?.category;
      err.retryable = Boolean(errData?.retryable);
      throw err;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload: any = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const evtBlock of events) {
        const lines = evtBlock.split('\n');
        let eventName = 'message';
        let dataJson = '';
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataJson += line.slice(5).trim();
          }
        }
        if (!dataJson) continue;
        const parsed = JSON.parse(dataJson);
        if (eventName === 'stage' && parsed.message) {
          params.onStageUpdate?.(parsed.message);
        } else if (eventName === 'chunk' && typeof parsed.text === 'string') {
          params.onPartialAnswer?.(parsed.text);
        } else if (eventName === 'done') {
          finalPayload = parsed;
        } else if (eventName === 'error') {
          const err: any = new Error(parsed.error || 'Tutor generation failed.');
          err.category = parsed.category;
          err.retryable = Boolean(parsed.retryable);
          throw err;
        }
      }
    }

    if (!finalPayload) {
      throw new Error('Incomplete tutor stream response.');
    }

    const verified =
      finalPayload.supported && pages.length > 0
        ? verifyCitations(finalPayload.citations, pages)
        : [];

    return {
      supported: Boolean(finalPayload.supported),
      sourceMode: finalPayload.sourceMode || (finalPayload.supported ? 'material' : 'general'),
      answer: finalPayload.answer,
      citations: verified,
      followUpQuestions: finalPayload.followUpQuestions || [],
    };
  } finally {
    activeAbortControllers.delete(streamKey);
  }
}

/**
 * Generates a 5–8 question grounded MCQ quiz (either diagnostic or adaptive on weak topics).
 * Reuses saved Stage A DocumentAnalysis to slice relevant pages.
 */
export async function generateGroundedQuiz(params: {
  material: StudyMaterial;
  mode: 'diagnostic' | 'adaptive';
  focusTopics?: string[];
  count?: number;
  model?: GeminiModelOption;
}): Promise<QuizQuestion[]> {
  const savedAnalysis = storageService.getDocumentAnalysis(params.material.id);
  const response = await postJsonDeduplicated<{ questions: QuizQuestion[] }>(
    `quiz_${params.mode}`,
    '/api/ai/quiz',
    {
      pages: params.material.pages,
      analysis: savedAnalysis,
      mode: params.mode,
      focusTopics: params.focusTopics,
      count: params.count ?? 6,
      model: params.model,
    }
  );

  return response.questions;
}

/**
 * Analyzes incorrect quiz answers using Gemini Flash to produce Mistake DNA insights.
 * Sends only the targeted pages where mistakes occurred plus the saved Stage A digest.
 */
export async function analyzeMistakeDNA(params: {
  material: StudyMaterial;
  results: QuizQuestionResult[];
  model?: GeminiModelOption;
}): Promise<MistakeInsight[]> {
  const wrongOnly = params.results.filter((r) => !r.isCorrect);
  if (wrongOnly.length === 0) {
    return [];
  }

  const savedAnalysis = storageService.getDocumentAnalysis(params.material.id);
  const response = await postJsonDeduplicated<{ insights: MistakeInsight[] }>(
    'mistake_dna',
    '/api/ai/mistake-dna',
    {
      pages: params.material.pages,
      analysis: savedAnalysis,
      results: params.results,
      model: params.model,
    }
  );

  storageService.saveMistakeInsights(params.material.id, response.insights);
  return response.insights;
}

/**
 * Stage B: Generates Sticky Notes and paired Flashcards on demand reusing Stage A analysis.
 */
export async function generateQuickNotesAndFlashcards(params: {
  material: StudyMaterial;
  forceRefresh?: boolean;
  model?: GeminiModelOption;
}): Promise<{ stickyNotes: StickyNote[]; flashcards: FlashcardItem[] }> {
  const { material, forceRefresh = false, model } = params;
  if (!forceRefresh) {
    const existingNotes = storageService.getStickyNotes(material.id);
    const existingCards = storageService.getFlashcards(material.id);
    if (existingNotes.length > 0 && existingCards.length > 0) {
      return { stickyNotes: existingNotes, flashcards: existingCards };
    }
  }

  const savedAnalysis = storageService.getDocumentAnalysis(material.id);
  const result = await postJsonDeduplicated<{
    stickyNotes: StickyNote[];
    flashcards: FlashcardItem[];
  }>('quick_notes', '/api/ai/quick-notes', {
    materialId: material.id,
    title: material.title,
    pages: material.pages,
    analysis: savedAnalysis,
    sourceType: material.sourceType,
    model,
    forceRefresh,
  });

  storageService.saveStickyNotes(material.id, result.stickyNotes);
  storageService.saveFlashcards(material.id, result.flashcards);
  return result;
}

/**
 * Stage B: Generates an interactive Mind Map on demand reusing Stage A analysis.
 */
export async function generateMindMapForMaterial(params: {
  material: StudyMaterial;
  forceRefresh?: boolean;
  model?: GeminiModelOption;
}): Promise<MindMapData> {
  const { material, forceRefresh = false, model } = params;
  if (!forceRefresh) {
    const cached = storageService.getMindMap(material.id);
    if (cached && cached.nodes.length > 0) {
      return cached;
    }
  }

  const savedAnalysis = storageService.getDocumentAnalysis(material.id);
  const mindMap = await postJsonDeduplicated<MindMapData>(
    'mind_map',
    '/api/ai/mind-map',
    {
      materialId: material.id,
      title: material.title,
      pages: material.pages,
      analysis: savedAnalysis,
      sourceType: material.sourceType,
      model,
      forceRefresh,
    }
  );

  storageService.saveMindMap(material.id, mindMap);
  return mindMap;
}

/**
 * Stage B: Generates a One-Page Revision Sheet on demand reusing Stage A analysis.
 */
export async function generateRevisionSheetForMaterial(params: {
  material: StudyMaterial;
  forceRefresh?: boolean;
  model?: GeminiModelOption;
}): Promise<OnePageRevisionSheet> {
  const { material, forceRefresh = false, model } = params;
  if (!forceRefresh) {
    const cached = storageService.getRevisionSheet(material.id);
    if (cached) {
      return cached;
    }
  }

  const savedAnalysis = storageService.getDocumentAnalysis(material.id);
  const sheet = await postJsonDeduplicated<OnePageRevisionSheet>(
    'revision_sheet',
    '/api/ai/revision-sheet',
    {
      materialId: material.id,
      title: material.title,
      pages: material.pages,
      analysis: savedAnalysis,
      sourceType: material.sourceType,
      model,
      forceRefresh,
    }
  );

  storageService.saveRevisionSheet(material.id, sheet);
  return sheet;
}

const YOUTUBE_STAGE_A_LOCAL_CACHE_PREFIX = 'learnmate_yt_stage_a_v2::';

/**
 * Stage A: Analyzes a public YouTube educational video via Gemini Flash and returns fast initial understanding
 * (video title, main topics, core concepts, short overview, and meaningful timestamped segments).
 * Caches by normalized videoId + model + processingMode so the same video is never reprocessed unnecessarily.
 */
export async function analyzeYouTubeLecture(params: {
  youtubeUrl: string;
  videoId: string;
  customTitle?: string;
  model?: GeminiModelOption;
  processingMode?: YouTubeProcessingMode | 'auto';
  estimatedDurationSeconds?: number;
  targetedQuestion?: string;
  forceRefresh?: boolean;
}): Promise<{
  title: string;
  videoId?: string;
  canonicalUrl?: string;
  jobId?: string;
  overview: string;
  coreConcepts?: string[];
  pages: StudyPage[];
  keyTopics: TopicInfo[];
  suggestedQuestions: string[];
  processingMode?: YouTubeProcessingMode;
  processingReason?: string;
  stageAPipeline?: boolean;
  cached?: boolean;
  durationMs?: number;
}> {
  const effectiveModel = params.model || 'gemini-3.1-flash-lite';
  const modeKey: YouTubeProcessingMode =
    params.processingMode === 'agentic' ? 'agentic' : 'static';
  const cacheKey = normalizeYouTubeCacheKey({
    videoId: params.videoId,
    model: effectiveModel,
    schemaVersion: 'stageA_v2',
    processingMode: modeKey,
  });

  if (!params.forceRefresh) {
    try {
      const localRaw = localStorage.getItem(`${YOUTUBE_STAGE_A_LOCAL_CACHE_PREFIX}${cacheKey}`);
      if (localRaw) {
        const parsed = JSON.parse(localRaw);
        if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          return {
            ...parsed,
            title: params.customTitle?.trim() || parsed.title,
            cached: true,
            durationMs: 1,
          };
        }
      }
    } catch {
      // ignore localStorage read errors
    }
  }

  const result = await postJsonDeduplicated<{
    title: string;
    videoId?: string;
    canonicalUrl?: string;
    jobId?: string;
    overview: string;
    coreConcepts?: string[];
    pages: StudyPage[];
    keyTopics: TopicInfo[];
    suggestedQuestions: string[];
    processingMode?: YouTubeProcessingMode;
    processingReason?: string;
    stageAPipeline?: boolean;
    cached?: boolean;
    durationMs?: number;
  }>('youtube_analyze', '/api/ai/youtube-analyze', {
    ...params,
  });

  try {
    localStorage.setItem(
      `${YOUTUBE_STAGE_A_LOCAL_CACHE_PREFIX}${cacheKey}`,
      JSON.stringify(result)
    );
  } catch {
    // ignore storage quota errors
  }

  return result;
}

/**
 * Checks the server-side status of an active or recently completed YouTube Stage A analysis job
 * so students can resume processing after a page refresh.
 */
export async function getYouTubeAnalysisJobByVideoId(
  videoId: string
): Promise<YouTubeAnalysisJobState | null> {
  try {
    const idToken = await getCurrentUserAuthToken();
    const headers: Record<string, string> = {};
    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }
    const resp = await fetch(`/api/ai/youtube-jobs/by-video/${encodeURIComponent(videoId)}`, {
      headers,
    });
    if (!resp.ok) return null;
    return (await resp.json()) as YouTubeAnalysisJobState;
  } catch {
    return null;
  }
}

/**
 * Fetches up to 3 topic-specific educational YouTube video recommendations using the official YouTube Data API v3.
 */
export async function fetchYouTubeRecommendations(params: {
  materialId: string;
  query: string;
  materialTitle?: string;
  keyTopics?: TopicInfo[];
  pages?: StudyPage[];
  weakTopics?: string[];
  forceRefresh?: boolean;
}): Promise<{
  configured: boolean;
  usedQuery?: string;
  extractedConcepts?: string[];
  reason?: string;
  videos: YouTubeRecommendation[];
}> {
  const {
    materialId,
    query,
    materialTitle,
    keyTopics = [],
    pages = [],
    weakTopics = [],
    forceRefresh = false,
  } = params;

  const cacheQueryKey = (query || materialTitle || 'default').toLowerCase().trim();
  if (!forceRefresh) {
    const cached = storageService.getYouTubeRecommendations(materialId, cacheQueryKey);
    if (cached && cached.length > 0) {
      return { configured: true, usedQuery: query, videos: cached };
    }
  }

  const data = await postJsonDeduplicated<{
    configured: boolean;
    usedQuery?: string;
    extractedConcepts?: string[];
    reason?: string;
    videos: YouTubeRecommendation[];
  }>('youtube_recs', '/api/youtube/recommendations', {
    query,
    materialTitle: materialTitle || query,
    keyTopics,
    pages: pages.slice(0, 5),
    weakTopics,
    forceRefresh,
  }).catch(() => ({
    configured: false,
    reason: 'Unable to reach YouTube recommendation service.',
    videos: [],
  }));

  if (data.configured && Array.isArray(data.videos) && data.videos.length > 0) {
    storageService.saveYouTubeRecommendations(materialId, cacheQueryKey, data.videos);
  }

  return data;
}

