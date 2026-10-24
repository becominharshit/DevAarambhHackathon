import {
  Citation,
  MistakeInsight,
  QuizAttempt,
  QuizQuestion,
  QuizQuestionResult,
  RevisionTask,
  StudyPage,
  StudyTimerState,
  TopicInfo,
  TopicProgress,
  YouTubeRecommendation,
} from '../types/study';

export const MAX_PDF_PAGES = 20;
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MIN_TEXT_LENGTH = 40;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface YouTubeUrlParseResult {
  valid: boolean;
  videoId?: string;
  canonicalUrl?: string;
  error?: string;
}

/**
 * Validates and parses a public YouTube URL into an 11-character video ID and canonical watch URL.
 */
export function parseYouTubeUrl(rawUrl: string): YouTubeUrlParseResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Please enter a public YouTube video link.',
    };
  }

  let candidateUrl = trimmed;
  if (!/^https?:\/\//i.test(candidateUrl)) {
    candidateUrl = 'https://' + candidateUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return {
      valid: false,
      error: 'Please enter a valid URL (e.g., https://www.youtube.com/watch?v=...).',
    };
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  let videoId = '';

  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
  } else if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v') || '';
    } else {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (
        parts.length >= 2 &&
        (parts[0] === 'embed' ||
          parts[0] === 'shorts' ||
          parts[0] === 'live' ||
          parts[0] === 'v')
      ) {
        videoId = parts[1];
      }
    }
  } else {
    return {
      valid: false,
      error: 'Only public YouTube URLs (youtube.com or youtu.be) are supported.',
    };
  }

  const cleanId = videoId.trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(cleanId)) {
    return {
      valid: false,
      error: 'Could not find a valid 11-character YouTube video ID in that link.',
    };
  }

  return {
    valid: true,
    videoId: cleanId,
    canonicalUrl: `https://www.youtube.com/watch?v=${cleanId}`,
  };
}

/**
 * Converts a timestamp string like "02:15" or "1:04:30" into seconds.
 */
export function parseTimestampToSeconds(timestamp?: string): number {
  if (!timestamp) return 0;
  const cleaned = timestamp.replace(/[^0-9:]/g, '').trim();
  if (!cleaned) return 0;
  const parts = cleaned.split(':').map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

/**
 * Formats seconds into MM:SS or HH:MM:SS.
 */
export function formatSecondsToTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs)}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Computes drift-free remaining seconds for the Study Timer using real timestamps.
 */
export function computeTimerRemainingSeconds(
  timer: StudyTimerState,
  nowMs: number = Date.now()
): number {
  if (!timer.isRunning || !timer.targetEndTimeMs) {
    return Math.max(0, Math.round(timer.remainingSecondsWhenPaused));
  }
  const diffSec = Math.ceil((timer.targetEndTimeMs - nowMs) / 1000);
  return Math.max(0, diffSec);
}

/**
 * Builds a deterministic cache key for on-demand learning resources.
 */
export function buildResourceCacheKey(
  materialId: string,
  resourceType: 'sticky_notes' | 'flashcards' | 'mind_map' | 'revision_sheet' | 'youtube_recs',
  pageCount = 1
): string {
  return `${materialId}::${resourceType}::v${pageCount}`;
}

/**
 * Validates PDF metadata before extraction.
 */
export function validatePdfUpload(
  fileName: string,
  mimeType: string,
  fileSizeBytes: number,
  pageCount?: number
): ValidationResult {
  const isPdfName = fileName.toLowerCase().endsWith('.pdf');
  const isPdfMime = mimeType === 'application/pdf' || mimeType === '';
  if (!isPdfName || !isPdfMime) {
    return {
      valid: false,
      error: 'Please upload a valid PDF file (.pdf).',
    };
  }

  if (fileSizeBytes <= 0) {
    return {
      valid: false,
      error: 'The uploaded PDF file is empty.',
    };
  }

  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: 'File size exceeds the 15 MB limit. Please upload a smaller PDF.',
    };
  }

  if (pageCount !== undefined) {
    if (pageCount <= 0) {
      return {
        valid: false,
        error: 'The PDF contains no readable pages.',
      };
    }
    if (pageCount > MAX_PDF_PAGES) {
      return {
        valid: false,
        error: `This PDF has ${pageCount} pages. LearnMate supports PDFs up to ${MAX_PDF_PAGES} pages.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validates pasted study notes.
 */
export function validatePastedText(rawText: string): ValidationResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Please enter or paste your study notes before continuing.',
    };
  }
  if (trimmed.length < MIN_TEXT_LENGTH) {
    return {
      valid: false,
      error: `Please provide at least ${MIN_TEXT_LENGTH} characters of study notes so LearnMate can analyze key concepts and generate questions.`,
    };
  }
  return { valid: true };
}

/**
 * Splits raw pasted text into logical page-indexed sections (up to 20 pages).
 */
export function paginateTextContent(rawText: string, customTitle?: string): {
  title: string;
  pages: StudyPage[];
} {
  const cleanText = rawText.replace(/\r\n/g, '\n').trim();
  const lines = cleanText.split('\n');
  const firstNonEmpty = lines.find((l) => l.trim().length > 0)?.replace(/^#+\s*/, '').trim() || 'Study Notes';
  const inferredTitle =
    customTitle && customTitle.trim().length > 0
      ? customTitle.trim()
      : firstNonEmpty.length <= 65
        ? firstNonEmpty
        : firstNonEmpty.slice(0, 62).trim() + '...';

  const paragraphs = cleanText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pages: StudyPage[] = [];
  let currentChunk: string[] = [];
  let currentLen = 0;
  const TARGET_PAGE_CHARS = 1100;

  for (const para of paragraphs) {
    if (
      currentLen > 0 &&
      currentLen + para.length > TARGET_PAGE_CHARS &&
      pages.length < MAX_PDF_PAGES - 1
    ) {
      const pageNum = pages.length + 1;
      const chunkText = currentChunk.join('\n\n');
      pages.push({
        pageNumber: pageNum,
        title: extractSectionTitle(chunkText, pageNum),
        content: chunkText,
      });
      currentChunk = [para];
      currentLen = para.length;
    } else {
      currentChunk.push(para);
      currentLen += para.length;
    }
  }

  if (currentChunk.length > 0) {
    const pageNum = pages.length + 1;
    const chunkText = currentChunk.join('\n\n');
    pages.push({
      pageNumber: pageNum,
      title: extractSectionTitle(chunkText, pageNum),
      content: chunkText,
    });
  }

  return {
    title: inferredTitle,
    pages: pages.length > 0 ? pages : [{ pageNumber: 1, title: 'Section 1', content: cleanText }],
  };
}

export function extractSectionTitle(text: string, pageNumber: number): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return `Page ${pageNumber}`;
  const first = lines[0].replace(/^#+\s*/, '').replace(/^[0-9]+(\.[0-9]+)*\s*[-:.)]?\s*/, '').trim();
  if (first.length >= 3 && first.length <= 70) {
    return first;
  }
  return `Page ${pageNumber} — ${first.slice(0, 42).trim()}...`;
}

/**
 * Deterministically grades a quiz submission using the validated answer key.
 */
export function gradeQuizAttempt(
  materialId: string,
  materialTitle: string,
  mode: 'diagnostic' | 'adaptive',
  questions: QuizQuestion[],
  answers: Record<string, number>,
  focusTopics?: string[],
  attemptId?: string,
  completedAt?: string
): QuizAttempt {
  const results: QuizQuestionResult[] = [];
  let score = 0;

  const topicStats = new Map<string, { correct: number; total: number }>();

  for (const q of questions) {
    const selectedIndex = answers[q.id] ?? -1;
    const isCorrect = selectedIndex === q.correctIndex;
    if (isCorrect) {
      score += 1;
    }

    const currentTopicStat = topicStats.get(q.topic) || { correct: 0, total: 0 };
    currentTopicStat.total += 1;
    if (isCorrect) currentTopicStat.correct += 1;
    topicStats.set(q.topic, currentTopicStat);

    results.push({
      questionId: q.id,
      topic: q.topic,
      selectedIndex,
      correctIndex: q.correctIndex,
      isCorrect,
      pageNumber: q.pageNumber,
      question: q.question,
      selectedOption: selectedIndex >= 0 && selectedIndex < q.options.length ? q.options[selectedIndex] : 'Unanswered',
      correctOption: q.options[q.correctIndex] ?? '',
      explanation: q.explanation,
    });
  }

  const weakTopics: string[] = [];
  const strongTopics: string[] = [];

  for (const [topic, stat] of topicStats.entries()) {
    if (stat.correct < stat.total) {
      weakTopics.push(topic);
    } else {
      strongTopics.push(topic);
    }
  }

  const total = questions.length;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  return {
    id: attemptId || `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    materialId,
    materialTitle,
    mode,
    focusTopics,
    questions,
    answers,
    results,
    score,
    total,
    percentage,
    weakTopics,
    strongTopics,
    completedAt: completedAt || new Date().toISOString(),
  };
}

/**
 * Filters and validates citations so that only real page numbers from the document are kept.
 */
export function verifyCitations(citations: Citation[] | undefined, pages: StudyPage[]): Citation[] {
  if (!citations || !Array.isArray(citations)) return [];
  const validPageMap = new Map<number, StudyPage>();
  for (const p of pages) {
    validPageMap.set(p.pageNumber, p);
  }

  const verified: Citation[] = [];
  const seenPages = new Set<number>();

  for (const cit of citations) {
    const page = validPageMap.get(Number(cit.pageNumber));
    if (page && !seenPages.has(page.pageNumber)) {
      seenPages.add(page.pageNumber);
      verified.push({
        pageNumber: page.pageNumber,
        sectionTitle: cit.sectionTitle?.trim() || page.title || `Page ${page.pageNumber}`,
        snippet: cit.snippet?.trim() || page.content.slice(0, 140).trim() + '...',
        timestamp: page.timestamp,
      });
    }
  }

  return verified;
}

/**
 * Builds or updates a personalized revision plan from quiz performance and Mistake DNA insights.
 */
export function buildRevisionPlanFromResults(
  materialId: string,
  attempt: QuizAttempt,
  insights: MistakeInsight[],
  existingPlan: RevisionTask[] = []
): RevisionTask[] {
  const existingByTopic = new Map<string, RevisionTask>();
  for (const task of existingPlan) {
    existingByTopic.set(task.topic.toLowerCase(), task);
  }

  if (attempt.mode === 'adaptive') {
    const updatedPlan = existingPlan.map((task) => {
      const isStrongNow = attempt.strongTopics.some(
        (t) => t.toLowerCase() === task.topic.toLowerCase()
      );
      if (isStrongNow) {
        return {
          ...task,
          completed: true,
          masteredInAdaptive: true,
          priority: 'Low' as const,
        };
      }
      return task;
    });

    for (const weakTopic of attempt.weakTopics) {
      if (!existingByTopic.has(weakTopic.toLowerCase())) {
        const wrongQ = attempt.results.find((r) => !r.isCorrect && r.topic === weakTopic);
        updatedPlan.push({
          id: `rev_${materialId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          materialId,
          topic: weakTopic,
          priority: 'High',
          pageNumber: wrongQ?.pageNumber || 1,
          sourceReference: `Page ${wrongQ?.pageNumber || 1}`,
          recommendedAction: `Re-read Page ${wrongQ?.pageNumber || 1} and review the explanation for ${weakTopic}.`,
          conceptSummary: wrongQ?.explanation || `Focus on core principles of ${weakTopic}.`,
          completed: false,
        });
      }
    }

    return sortRevisionTasks(updatedPlan);
  }

  const tasks: RevisionTask[] = [];
  const processedTopics = new Set<string>();

  for (const insight of insights) {
    processedTopics.add(insight.topic.toLowerCase());
    const accuracyRatio =
      insight.totalAsked > 0 ? (insight.totalAsked - insight.wrongCount) / insight.totalAsked : 0;
    const priority: 'High' | 'Medium' | 'Low' =
      insight.wrongCount >= 2 || accuracyRatio === 0 ? 'High' : 'Medium';

    const previous = existingByTopic.get(insight.topic.toLowerCase());
    tasks.push({
      id: previous?.id || `rev_${materialId}_${Math.random().toString(36).slice(2, 8)}`,
      materialId,
      topic: insight.topic,
      priority,
      pageNumber: insight.pageNumber || 1,
      sourceReference: insight.sourceReference || `Page ${insight.pageNumber || 1}`,
      recommendedAction: `Review ${insight.sourceReference || `Page ${insight.pageNumber || 1}`} and address misconception: "${insight.misconception}"`,
      conceptSummary: insight.coreCorrection,
      completed: false,
      masteredInAdaptive: false,
    });
  }

  for (const weakTopic of attempt.weakTopics) {
    if (!processedTopics.has(weakTopic.toLowerCase())) {
      processedTopics.add(weakTopic.toLowerCase());
      const wrongQ = attempt.results.find((r) => !r.isCorrect && r.topic === weakTopic);
      tasks.push({
        id: `rev_${materialId}_${Math.random().toString(36).slice(2, 8)}`,
        materialId,
        topic: weakTopic,
        priority: 'High',
        pageNumber: wrongQ?.pageNumber || 1,
        sourceReference: `Page ${wrongQ?.pageNumber || 1}`,
        recommendedAction: `Study Page ${wrongQ?.pageNumber || 1} and complete an adaptive practice set on ${weakTopic}.`,
        conceptSummary: wrongQ?.explanation || `Verify core definitions and rules for ${weakTopic}.`,
        completed: false,
      });
    }
  }

  if (tasks.length === 0 && attempt.strongTopics.length > 0) {
    const firstTopic = attempt.strongTopics[0];
    const firstQ = attempt.results[0];
    tasks.push({
      id: `rev_${materialId}_mastery`,
      materialId,
      topic: firstTopic,
      priority: 'Low',
      pageNumber: firstQ?.pageNumber || 1,
      sourceReference: `Page ${firstQ?.pageNumber || 1}`,
      recommendedAction: 'Great accuracy! Do a quick synthesis review across all pages to lock in long-term retention.',
      conceptSummary: firstQ?.explanation || 'All diagnostic concepts answered accurately.',
      completed: false,
    });
  }

  return sortRevisionTasks(tasks);
}

function sortRevisionTasks(tasks: RevisionTask[]): RevisionTask[] {
  const rank: Record<'High' | 'Medium' | 'Low', number> = {
    High: 0,
    Medium: 1,
    Low: 2,
  };
  return [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return rank[a.priority] - rank[b.priority];
  });
}

/**
 * Computes real topic-level progress across chronological quiz attempts.
 * Never fabricates progress—returns an empty array if no attempts exist.
 */
export function computeTopicProgress(attempts: QuizAttempt[]): TopicProgress[] {
  if (!attempts || attempts.length === 0) return [];

  const sorted = [...attempts].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );

  const topicHistory = new Map<
    string,
    {
      scores: number[];
      totalCorrect: number;
      totalAsked: number;
    }
  >();

  for (const attempt of sorted) {
    const perAttemptTopic = new Map<string, { correct: number; asked: number }>();
    for (const res of attempt.results) {
      const entry = perAttemptTopic.get(res.topic) || { correct: 0, asked: 0 };
      entry.asked += 1;
      if (res.isCorrect) entry.correct += 1;
      perAttemptTopic.set(res.topic, entry);
    }

    for (const [topic, stat] of perAttemptTopic.entries()) {
      const pct = Math.round((stat.correct / stat.asked) * 100);
      const record = topicHistory.get(topic) || {
        scores: [],
        totalCorrect: 0,
        totalAsked: 0,
      };
      record.scores.push(pct);
      record.totalCorrect += stat.correct;
      record.totalAsked += stat.asked;
      topicHistory.set(topic, record);
    }
  }

  const progressList: TopicProgress[] = [];
  for (const [topic, data] of topicHistory.entries()) {
    const firstScorePct = data.scores[0] ?? 0;
    const latestScorePct = data.scores[data.scores.length - 1] ?? 0;
    progressList.push({
      topic,
      attemptsCount: data.scores.length,
      firstScorePct,
      latestScorePct,
      improvementPct: latestScorePct - firstScorePct,
      totalCorrect: data.totalCorrect,
      totalAsked: data.totalAsked,
    });
  }

  return progressList.sort((a, b) => b.improvementPct - a.improvementPct || a.latestScorePct - b.latestScorePct);
}

// ============================================================================
// STAGE 2: TOPIC-SPECIFIC YOUTUBE RECOMMENDATION LOGIC
// ============================================================================

const GENERIC_TITLE_PATTERNS = [
  /^semester\s*\d*/i,
  /^exam\s*(guide|prep|revision|notes|review)/i,
  /^80\s*\/\s*20\s*notes/i,
  /^chapter\s*\d+(\.pdf)?$/i,
  /^unit\s*\d+(\.pdf)?$/i,
  /^module\s*\d+(\.pdf)?$/i,
  /^lecture\s*\d*(\s*notes)?(\.pdf)?$/i,
  /^study\s*(notes|guide|material|sheet)(\.pdf)?$/i,
  /^revision\s*(notes|sheet|guide|summary)(\.pdf)?$/i,
  /^untitled/i,
  /^notes(\.pdf)?$/i,
  /^document(\.pdf)?$/i,
];

const GENERIC_NOISE_WORDS = new Set([
  'pdf',
  'doc',
  'docx',
  'txt',
  'notes',
  'chapter',
  'ch',
  'unit',
  'module',
  'semester',
  'revision',
  'exam',
  'guide',
  'summary',
  'lecture',
  'section',
  'page',
  'part',
  'study',
  'material',
  'handout',
  '80/20',
  '8020',
]);

/**
 * Returns true if a material title or heading is too generic to use as a YouTube search query
 * (e.g., "Semester 1 Revision", "Exam Guide", "80/20 Notes", "Chapter 3.pdf").
 */
export function isGenericStudyTitle(rawTitle: string): boolean {
  const cleaned = rawTitle
    .replace(/\.(pdf|docx?|txt|md)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 4) return true;

  for (const pattern of GENERIC_TITLE_PATTERNS) {
    if (pattern.test(cleaned)) return true;
  }

  // Check if after removing generic words + numbers there's no meaningful subject/concept left
  const meaningfulTokens = cleaned
    .toLowerCase()
    .split(/[^a-z0-9/]+/)
    .filter((tok) => tok.length > 2 && !/^\d+$/.test(tok) && !GENERIC_NOISE_WORDS.has(tok));

  return meaningfulTokens.length === 0;
}

/**
 * Cleans generic suffixes ("Chapter 3.pdf", "Notes.pdf", "Section 1") from a phrase while keeping academic terms.
 */
export function cleanAcademicPhrase(raw: string): string {
  return raw
    .replace(/\.(pdf|docx?|txt|md)$/i, '')
    .replace(/\b(chapter|ch|unit|module|section|page|part|semester)\s*\d+\b/gi, '')
    .replace(/\b(80\/20|revision|exam\s*guide|study\s*notes|notes)\b/gi, '')
    .replace(/^[0-9]+(\.[0-9]+)*\s*[-:.)]?\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Infers the academic subject/domain from the material's title, topics, and page content.
 */
export function inferAcademicSubject(params: {
  materialTitle?: string;
  keyTopics?: TopicInfo[];
  pages?: StudyPage[];
}): string {
  const combined = [
    cleanAcademicPhrase(params.materialTitle || ''),
    ...(params.keyTopics || []).map((t) => `${t.name} ${(t.keyTerms || []).join(' ')}`),
    ...(params.pages || []).slice(0, 4).map((p) => `${p.title} ${p.content.slice(0, 300)}`),
  ]
    .join(' ')
    .toLowerCase();

  if (
    /\b(probability|bayes|random variable|kolmogorov|variance|markov|poisson|binomial)\b/.test(
      combined
    )
  ) {
    return 'Probability Theory';
  }
  if (
    /\b(confidence interval|hypothesis test|p-value|central limit theorem|sampling distribution|t-distribution|anova|regression)\b/.test(
      combined
    )
  ) {
    return 'Statistics';
  }
  if (
    /\b(equivalence relation|partial order|poset|power set|cartesian product|de morgan|reflexive|transitive|bijection|graph theory)\b/.test(
      combined
    )
  ) {
    return 'Discrete Mathematics';
  }
  if (/\b(eigenvalue|eigenvector|matrix|determinant|vector space|linear transformation)\b/.test(combined)) {
    return 'Linear Algebra';
  }
  if (/\b(derivative|integral|taylor series|differential equation|limit|continuity|multivariable)\b/.test(combined)) {
    return 'Calculus';
  }
  if (/\b(algorithm|data structure|binary tree|dynamic programming|time complexity|big o|operating system|database|sql|network)\b/.test(combined)) {
    return 'Computer Science';
  }
  if (/\b(thermodynamics|electromagnetism|quantum|kinematics|newton|momentum|entropy|wave)\b/.test(combined)) {
    return 'Physics';
  }
  if (/\b(mitosis|meiosis|dna|rna|transcription|cellular respiration|photosynthesis|enzyme|genetics)\b/.test(combined)) {
    return 'Biology';
  }
  if (/\b(stoichiometry|covalent|thermochemistry|equilibrium|acid|base|orbital|organic chemistry)\b/.test(combined)) {
    return 'Chemistry';
  }

  const cleanedTitle = cleanAcademicPhrase(params.materialTitle || '');
  if (cleanedTitle && !isGenericStudyTitle(cleanedTitle)) {
    return cleanedTitle;
  }
  return '';
}

/**
 * Extracts 3 to 5 precise educational concepts from the current chapter:
 * Prioritizes weakTopics, analyzed keyTopics, and page section headings/technical terms,
 * while ignoring generic titles like "Semester 1 Revision", "Exam Guide", or "80/20 Notes".
 */
export function extractPreciseStudyConcepts(params: {
  materialTitle?: string;
  keyTopics?: TopicInfo[];
  pages?: StudyPage[];
  weakTopics?: string[];
  customTopic?: string;
}): {
  subject: string;
  concepts: string[];
} {
  const subject = inferAcademicSubject(params);
  const candidates: string[] = [];

  if (params.customTopic && !isGenericStudyTitle(params.customTopic)) {
    const cleanedCustom = cleanAcademicPhrase(params.customTopic);
    if (cleanedCustom.length >= 3) {
      candidates.push(cleanedCustom);
    }
  }

  for (const wt of params.weakTopics || []) {
    if (!isGenericStudyTitle(wt)) {
      const cleaned = cleanAcademicPhrase(wt);
      if (cleaned.length >= 3) candidates.push(cleaned);
    }
  }

  for (const kt of params.keyTopics || []) {
    if (kt.name && !isGenericStudyTitle(kt.name)) {
      const cleaned = cleanAcademicPhrase(kt.name);
      if (cleaned.length >= 3) candidates.push(cleaned);
    }
    for (const term of kt.keyTerms || []) {
      if (term && term.length >= 4 && !isGenericStudyTitle(term)) {
        candidates.push(term.trim());
      }
    }
  }

  for (const page of params.pages || []) {
    if (page.title && !isGenericStudyTitle(page.title)) {
      const cleaned = cleanAcademicPhrase(page.title);
      if (cleaned.length >= 4) {
        candidates.push(cleaned);
      }
    }
  }

  const uniqueConcepts: string[] = [];
  const seenNormalized = new Set<string>();

  for (const raw of candidates) {
    const norm = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!norm || norm.length < 3) continue;
    if (seenNormalized.has(norm)) continue;
    seenNormalized.add(norm);
    uniqueConcepts.push(raw);
    if (uniqueConcepts.length >= 5) break;
  }

  // Fallback if no analysis/headings exist yet: extract top technical phrases from page 1 content
  if (uniqueConcepts.length === 0 && params.pages && params.pages.length > 0) {
    const firstLines = params.pages[0].content
      .split('\n')
      .map((l) => cleanAcademicPhrase(l))
      .filter((l) => l.length >= 5 && l.length <= 75 && !isGenericStudyTitle(l));
    for (const line of firstLines.slice(0, 3)) {
      uniqueConcepts.push(line);
    }
  }

  return {
    subject,
    concepts: uniqueConcepts.slice(0, 5),
  };
}

/**
 * Builds specific educational YouTube search queries from extracted concepts and subject context.
 */
export function buildTopicSpecificYouTubeQueries(params: {
  materialTitle?: string;
  keyTopics?: TopicInfo[];
  pages?: StudyPage[];
  weakTopics?: string[];
  customTopic?: string;
}): {
  primaryQuery: string;
  fallbackQuery: string;
  concepts: string[];
  subject: string;
} {
  const { subject, concepts } = extractPreciseStudyConcepts(params);
  const topConcept = concepts[0] || subject || 'University Lecture';
  const secondConcept = concepts[1] || '';

  const topConceptLower = topConcept.toLowerCase();
  const subjectPrefix =
    subject && !topConceptLower.includes(subject.toLowerCase()) ? `${subject} ` : '';

  const primaryQuery = `${subjectPrefix}${topConcept} lecture explanation tutorial`.trim();
  const fallbackQuery = secondConcept
    ? `${subjectPrefix}${topConcept} ${secondConcept} explained`.trim()
    : `${topConcept} university tutorial examples`.trim();

  return {
    primaryQuery,
    fallbackQuery,
    concepts,
    subject,
  };
}

/**
 * Parses an ISO-8601 YouTube video duration (e.g. "PT14M32S", "PT1H2M10S", "PT45S") into seconds.
 */
export function parseIsoDurationToSeconds(isoDuration?: string): number {
  if (!isoDuration || typeof isoDuration !== 'string') return 0;
  const match = isoDuration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export interface RawYouTubeCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  publishedAt?: string;
  durationIso?: string;
  durationSeconds?: number;
}

const NON_EDUCATIONAL_REJECT_PATTERNS = [
  /#shorts\b/i,
  /\bofficial\s*(music\s*)?video\b/i,
  /\blyrics?\b/i,
  /\bfull\s*movie\b/i,
  /\bgaming\b/i,
  /\bgameplay\b/i,
  /\bminecraft\b/i,
  /\bfortnite\b/i,
  /\bvlog\b/i,
  /\bprank\b/i,
  /\breaction\b/i,
  /\basmr\b/i,
  /\bunboxing\b/i,
  /\btrailer\b/i,
];

const EDUCATIONAL_SIGNAL_WORDS = [
  'lecture',
  'tutorial',
  'explained',
  'explanation',
  'introduction',
  'course',
  'lesson',
  'example',
  'examples',
  'proof',
  'theorem',
  'formula',
  'derive',
  'derivation',
  'mit',
  'stanford',
  'harvard',
  'khan',
  'academy',
  'university',
  'professor',
  'prof',
  '3blue1brown',
  'statquest',
  'organic chemistry tutor',
  'nptel',
  'patrickjmt',
  'trevor bazett',
  'wrath of math',
  'numberphile',
  'computerphile',
  'crashcourse',
  'crash course',
];

/**
 * Ranks and filters candidate YouTube videos by topic relevance, educational usefulness, and duration.
 * Rejects shorts, entertainment/clickbait, and videos that do not match any concept tokens.
 * Returns at most 3 strongly relevant videos.
 */
export function rankAndFilterYouTubeCandidates(params: {
  candidates: RawYouTubeCandidate[];
  concepts: string[];
  subject?: string;
  topicQuery: string;
}): YouTubeRecommendation[] {
  const { candidates, concepts, subject = '', topicQuery } = params;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  // Build meaningful concept keywords (>= 3 chars)
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'into',
    'that',
    'this',
    'are',
    'was',
    'were',
    'how',
    'why',
    'what',
    'when',
    'where',
    'lecture',
    'tutorial',
    'explanation',
    'explained',
    'video',
    ...GENERIC_NOISE_WORDS,
  ]);

  const conceptPhrases = [
    ...concepts.map((c) => c.toLowerCase().trim()),
    ...(subject ? [subject.toLowerCase().trim()] : []),
    topicQuery.toLowerCase().trim(),
  ].filter(Boolean);

  const keywordSet = new Set<string>();
  for (const phrase of conceptPhrases) {
    for (const token of phrase.split(/[^a-z0-9]+/)) {
      if (token.length >= 3 && !stopWords.has(token)) {
        keywordSet.add(token);
      }
    }
  }
  const keywords = Array.from(keywordSet);

  const scored: Array<{
    score: number;
    recommendation: YouTubeRecommendation;
  }> = [];

  const seenIds = new Set<string>();

  for (const cand of candidates) {
    if (!cand || !cand.videoId || seenIds.has(cand.videoId)) continue;
    seenIds.add(cand.videoId);

    const title = (cand.title || '').trim();
    const desc = (cand.description || '').trim();
    const channel = (cand.channelTitle || '').trim();
    const combinedText = `${title} ${desc} ${channel}`;
    const titleLower = title.toLowerCase();
    const descLower = desc.toLowerCase();
    const channelLower = channel.toLowerCase();

    // 1. Reject obvious non-educational / clickbait / entertainment content
    if (NON_EDUCATIONAL_REJECT_PATTERNS.some((rx) => rx.test(combinedText))) {
      continue;
    }

    // 2. Check duration if provided: reject YouTube Shorts (< 75 seconds) or ultra-long livestreams (> 4 hours)
    const durationSec =
      cand.durationSeconds ??
      (cand.durationIso ? parseIsoDurationToSeconds(cand.durationIso) : 0);
    if (durationSec > 0 && (durationSec < 75 || durationSec > 4 * 3600)) {
      continue;
    }

    let score = 0;
    let matchedConcept = '';
    const matchedTokens: string[] = [];

    // 3. Exact or partial concept phrase match
    for (const concept of concepts) {
      const cLower = concept.toLowerCase().trim();
      if (cLower.length >= 4 && titleLower.includes(cLower)) {
        score += 30;
        if (!matchedConcept) matchedConcept = concept;
      } else if (cLower.length >= 4 && descLower.includes(cLower)) {
        score += 14;
        if (!matchedConcept) matchedConcept = concept;
      }
    }

    // 4. Token-level relevance scoring
    for (const kw of keywords) {
      if (titleLower.includes(kw)) {
        score += 12;
        matchedTokens.push(kw);
      } else if (descLower.includes(kw)) {
        score += 5;
        matchedTokens.push(kw);
      } else if (channelLower.includes(kw)) {
        score += 4;
      }
    }

    // Reject if zero concept/subject tokens matched anywhere
    if (matchedTokens.length === 0 && !matchedConcept) {
      continue;
    }

    // 5. Educational channel & teaching quality signals
    for (const sig of EDUCATIONAL_SIGNAL_WORDS) {
      if (channelLower.includes(sig)) {
        score += 10;
      } else if (titleLower.includes(sig) || descLower.includes(sig)) {
        score += 5;
      }
    }

    // 6. Duration sweet spot (3 min to 35 min lectures/tutorials)
    if (durationSec >= 180 && durationSec <= 2100) {
      score += 10;
    } else if (durationSec > 2100 && durationSec <= 5400) {
      score += 5;
    }

    // Require a minimum relevance threshold so unrelated videos are rejected
    if (score < 12) {
      continue;
    }

    const bestConceptLabel = matchedConcept || concepts[0] || topicQuery;
    const durationText =
      durationSec > 0 ? formatSecondsToTimestamp(durationSec) : undefined;

    scored.push({
      score,
      recommendation: {
        videoId: cand.videoId,
        title,
        channelTitle: channel || 'YouTube Educator',
        description: desc,
        thumbnailUrl: cand.thumbnailUrl,
        publishedAt: cand.publishedAt,
        url: `https://www.youtube.com/watch?v=${cand.videoId}`,
        topicQuery: bestConceptLabel,
        durationText,
        matchedConcept: bestConceptLabel,
        relevanceReason: `Matched chapter concept: ${bestConceptLabel}`,
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.recommendation);
}

// ============================================================================
// STAGE 4 & 5: LIVE VOICE TUTOR TRANSCRIPT ASSEMBLY & 16KHZ PCM RESAMPLING
// ============================================================================

/**
 * Merges incremental Gemini Live transcription chunks into a clean, readable utterance
 * without duplicating overlapping prefixes or dropping word boundaries.
 */
export function mergeIncrementalTranscript(existingText: string, incomingChunk: string): string {
  if (!incomingChunk) return existingText;
  if (!existingText) return incomingChunk.trimStart();

  const trimmedExisting = existingText.trimEnd();
  const trimmedIncoming = incomingChunk.trim();
  if (!trimmedIncoming) return existingText;

  // If the incoming chunk is a full cumulative replacement that starts with existingText
  if (trimmedIncoming.toLowerCase().startsWith(trimmedExisting.toLowerCase())) {
    return trimmedIncoming;
  }

  // If existingText already ends with the incoming chunk (duplicate event), ignore
  if (trimmedExisting.toLowerCase().endsWith(trimmedIncoming.toLowerCase())) {
    return existingText;
  }

  // Deduplicate overlapping word-boundary suffix/prefix windows (e.g. "Python is a" + "is a programming")
  const existingWords = trimmedExisting.split(/\s+/);
  const incomingWords = trimmedIncoming.split(/\s+/);
  const maxOverlap = Math.min(existingWords.length, incomingWords.length);
  for (let len = maxOverlap; len >= 1; len--) {
    const suffix = existingWords.slice(existingWords.length - len).join(' ').toLowerCase();
    const prefix = incomingWords.slice(0, len).join(' ').toLowerCase();
    if (suffix === prefix && (len >= 2 || suffix.length >= 4)) {
      const remainder = incomingWords.slice(len).join(' ');
      return remainder
        ? `${trimmedExisting} ${remainder}`.replace(/\s{2,}/g, ' ')
        : trimmedExisting;
    }
  }

  // Join cleanly respecting punctuation and leading/trailing spaces
  const startsWithPunctuation = /^[,.;:!?)]/.test(incomingChunk);
  const existingEndsWithSpace = /\s$/.test(existingText);
  const incomingStartsWithSpace = /^\s/.test(incomingChunk);

  if (startsWithPunctuation || existingEndsWithSpace || incomingStartsWithSpace) {
    return `${existingText}${incomingChunk}`.replace(/\s{2,}/g, ' ');
  }

  return `${existingText} ${incomingChunk}`.replace(/\s{2,}/g, ' ');
}

/**
 * Splits a transcript string into clean word tokens for progressive word-by-word captioning.
 */
export function tokenizeCaptionWords(text: string): string[] {
  if (!text || !text.trim()) return [];
  return text.trim().split(/\s+/);
}

/**
 * Returns the cumulative prefix of `revealedWordCount` words from `fullText` for word-by-word caption display.
 */
export function getProgressiveCaptionSlice(
  fullText: string,
  revealedWordCount: number
): {
  displayedText: string;
  totalWords: number;
  isComplete: boolean;
} {
  const words = tokenizeCaptionWords(fullText);
  const totalWords = words.length;
  if (totalWords === 0) {
    return { displayedText: '', totalWords: 0, isComplete: true };
  }
  const clampedCount = Math.max(0, Math.min(totalWords, revealedWordCount));
  return {
    displayedText: words.slice(0, clampedCount).join(' '),
    totalWords,
    isComplete: clampedCount >= totalWords,
  };
}

/**
 * Calculates the delay in milliseconds before revealing the next caption word,
 * paced against remaining scheduled audio playback duration when available.
 */
export function computeProgressiveWordDelayMs(
  remainingWords: number,
  remainingAudioSeconds = 0
): number {
  if (remainingWords <= 0) return 0;
  if (remainingAudioSeconds > 0.1) {
    const pacedMs = Math.round((remainingAudioSeconds * 1000) / remainingWords);
    return Math.max(70, Math.min(240, pacedMs));
  }
  if (remainingWords > 20) return 95;
  if (remainingWords > 8) return 120;
  return 145;
}

/**
 * Downsamples a Float32 mono audio buffer from any hardware AudioContext sample rate
 * (e.g., 44100 Hz or 48000 Hz) to 16000 Hz Int16 PCM required by Gemini Live API.
 */
export function downsampleFloat32ToInt16Pcm(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000
): Int16Array {
  if (!input || input.length === 0) {
    return new Int16Array(0);
  }

  const safeInRate = inputSampleRate > 0 ? inputSampleRate : targetSampleRate;
  if (safeInRate === targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = safeInRate / targetSampleRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Int16Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(
      input.length,
      Math.round((offsetResult + 1) * ratio)
    );
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count += 1;
    }
    const sample = count > 0 ? accum / count : input[Math.min(offsetBuffer, input.length - 1)] || 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

// ============================================================================
// STAGE 6: PERFORMANCE & CONTEXT OPTIMIZATION HELPERS
// ============================================================================

/**
 * Generates a deterministic fingerprint for an uploaded PDF file so identical files
 * are not re-parsed on repeated uploads or refreshes.
 */
export function computePdfFingerprint(
  fileName: string,
  fileSize: number,
  lastModified = 0
): string {
  const normalizedName = fileName.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
  return `pdf_fp::${normalizedName}::${fileSize}::${lastModified || 0}`;
}

/**
 * Builds a normalized, user-independent cache key for YouTube video analysis
 * using the 11-char videoId, model, schema version, and processing mode.
 */
export function normalizeYouTubeCacheKey(params: {
  videoId: string;
  model: string;
  schemaVersion?: string;
  processingMode?: 'static' | 'agentic';
}): string {
  const cleanId = params.videoId.trim();
  const model = (params.model || 'gemini-3.1-flash-lite').trim().toLowerCase();
  const schema = (params.schemaVersion || 'stageA_v2').trim();
  const mode = params.processingMode || 'static';
  return `yt_cache::${cleanId}::${model}::${mode}::${schema}`;
}

/**
 * Evaluates static vs agentic/selective video processing mode.
 * - Prefers 'static' for short/standard videos (< 25 minutes) where single-pass native
 *   multimodal understanding is faster and avoids multi-turn overhead.
 * - Selects 'agentic' for long lectures (>= 25 minutes) or targeted conceptual queries
 *   where selective timestamped extraction reduces unnecessary input processing.
 */
export function selectYouTubeProcessingMode(params: {
  customTitle?: string;
  estimatedDurationSeconds?: number;
  targetedQuestion?: string;
  requestedMode?: 'static' | 'agentic' | 'auto';
}): {
  mode: 'static' | 'agentic';
  reason: string;
} {
  if (params.requestedMode === 'static') {
    return {
      mode: 'static',
      reason: 'Explicitly selected static full-video pass for low-latency structured overview.',
    };
  }
  if (params.requestedMode === 'agentic') {
    return {
      mode: 'agentic',
      reason: 'Explicitly selected agentic selective segment extraction for targeted lecture analysis.',
    };
  }

  if (params.targetedQuestion && params.targetedQuestion.trim().length > 10) {
    return {
      mode: 'agentic',
      reason: 'Targeted question provided; selective segment analysis reduces unnecessary token processing.',
    };
  }

  const duration = params.estimatedDurationSeconds || 0;
  if (duration >= 25 * 60) {
    return {
      mode: 'agentic',
      reason: 'Long lecture (>= 25m); selective high-density concept segmentation optimizes latency.',
    };
  }

  const titleLower = (params.customTitle || '').toLowerCase();
  if (
    /\b(full\s*course|complete\s*lecture|2\s*hour|3\s*hour|marathon|bootcamp|full\s*lecture)\b/.test(
      titleLower
    )
  ) {
    return {
      mode: 'agentic',
      reason: 'Full-length lecture title detected; using selective concept-dense segment extraction.',
    };
  }

  return {
    mode: 'static',
    reason: 'Standard-length educational video; static single-pass Flash analysis is fastest.',
  };
}

/**
 * Builds a compact, reusable concept digest from an existing DocumentAnalysis (Stage A)
 * so Stage B on-demand tools (sticky notes, flashcards, mind map, revision sheet, quizzes)
 * reuse already-extracted topic structure instead of re-deriving from raw full-length pages.
 */
export function buildReusableConceptDigest(
  analysis?: {
    overview?: string;
    keyTopics?: TopicInfo[];
    coreConcepts?: string[];
  } | null,
  pages: StudyPage[] = []
): string {
  const parts: string[] = [];
  if (analysis?.overview) {
    parts.push(`OVERVIEW: ${analysis.overview.trim()}`);
  }
  if (analysis?.coreConcepts && analysis.coreConcepts.length > 0) {
    parts.push(`CORE CONCEPTS: ${analysis.coreConcepts.join(', ')}`);
  }
  if (analysis?.keyTopics && analysis.keyTopics.length > 0) {
    const topicLines = analysis.keyTopics.map((t) => {
      const pageRefs = (t.pageNumbers || []).map((n) => `P.${n}`).join(', ');
      const terms = (t.keyTerms || []).slice(0, 6).join(', ');
      return `- ${t.name} [${pageRefs || 'P.1'}]: ${t.summary}${terms ? ` (Terms: ${terms})` : ''}`;
    });
    parts.push(`KEY TOPICS MAP:\n${topicLines.join('\n')}`);
  } else if (pages.length > 0) {
    const quickIndex = pages
      .slice(0, 12)
      .map((p) => `- Page ${p.pageNumber}${p.timestamp ? ` (${p.timestamp})` : ''}: ${p.title}`)
      .join('\n');
    parts.push(`SECTION INDEX:\n${quickIndex}`);
  }
  return parts.join('\n\n');
}

export interface SmartContextSelectionResult {
  formattedContext: string;
  fullPageNumbers: number[];
  summaryPageNumbers: number[];
  originalChars: number;
  optimizedChars: number;
  reductionPct: number;
}

/**
 * Intelligently selects and formats study pages for Gemini prompts:
 * - Ranks pages by targetPageNumbers (e.g. wrong quiz pages), currentPage, focusTopics, and query keyword overlap.
 * - Includes the top N most relevant pages in full verbatim text (preserving exact formulas, definitions, and timestamps).
 * - Includes compact index summaries for remaining pages so Gemini still knows every page number and title in the material.
 * - Reduces prompt token count by 45-80% on multi-page documents without sacrificing citation accuracy.
 */
export function selectRelevantPagesForPrompt(params: {
  pages: StudyPage[];
  query?: string;
  currentPage?: number;
  targetPageNumbers?: number[];
  focusTopics?: string[];
  analysis?: {
    overview?: string;
    keyTopics?: TopicInfo[];
    coreConcepts?: string[];
  } | null;
  maxFullPages?: number;
  maxCharsPerFullPage?: number;
  maxCharsPerSummaryPage?: number;
}): SmartContextSelectionResult {
  const {
    pages,
    query = '',
    currentPage,
    targetPageNumbers = [],
    focusTopics = [],
    analysis,
    maxFullPages = 5,
    maxCharsPerFullPage = 1600,
    maxCharsPerSummaryPage = 240,
  } = params;

  if (!Array.isArray(pages) || pages.length === 0) {
    return {
      formattedContext: '',
      fullPageNumbers: [],
      summaryPageNumbers: [],
      originalChars: 0,
      optimizedChars: 0,
      reductionPct: 0,
    };
  }

  const originalFormatted = pages
    .map(
      (p) =>
        `=== PAGE ${p.pageNumber}${p.timestamp ? ` [TIMESTAMP ${p.timestamp}]` : ''}: ${p.title} ===\n${p.content}`
    )
    .join('\n\n');
  const originalChars = originalFormatted.length;

  // If the material is already very short (<= 3 pages and < 3200 chars), send all pages with digest
  if (pages.length <= 3 && originalChars <= 3200) {
    return {
      formattedContext: originalFormatted,
      fullPageNumbers: pages.map((p) => p.pageNumber),
      summaryPageNumbers: [],
      originalChars,
      optimizedChars: originalChars,
      reductionPct: 0,
    };
  }

  const targetSet = new Set<number>(targetPageNumbers.map(Number));
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'that',
    'this',
    'what',
    'where',
    'when',
    'which',
    'explain',
    'tell',
    'about',
    'page',
    'section',
    'how',
    'why',
    'does',
  ]);

  const searchPhrases = [
    query,
    ...focusTopics,
  ]
    .join(' ')
    .toLowerCase();

  const keywords = Array.from(
    new Set(
      searchPhrases
        .split(/[^a-z0-9]+/)
        .filter((tok) => tok.length >= 3 && !stopWords.has(tok))
    )
  );

  // Also map topic pageNumbers from saved DocumentAnalysis if any focusTopic or query matches a topic name
  const analysisMatchedPages = new Set<number>();
  if (analysis?.keyTopics) {
    for (const kt of analysis.keyTopics) {
      const ktLower = `${kt.name} ${(kt.keyTerms || []).join(' ')}`.toLowerCase();
      const matchesTopic =
        focusTopics.some((ft) => ktLower.includes(ft.toLowerCase()) || ft.toLowerCase().includes(kt.name.toLowerCase())) ||
        keywords.some((kw) => ktLower.includes(kw));
      if (matchesTopic) {
        for (const pNum of kt.pageNumbers || []) {
          analysisMatchedPages.add(Number(pNum));
        }
      }
    }
  }

  const scoredPages = pages.map((p, idx) => {
    let score = 0;
    const pNum = Number(p.pageNumber);
    if (targetSet.has(pNum)) {
      score += 100;
    }
    if (currentPage !== undefined && Number(currentPage) === pNum) {
      score += 65;
    }
    if (analysisMatchedPages.has(pNum)) {
      score += 45;
    }
    const titleLower = (p.title || '').toLowerCase();
    const contentLower = (p.content || '').toLowerCase();

    for (const ft of focusTopics) {
      const ftLower = ft.toLowerCase().trim();
      if (ftLower.length >= 3) {
        if (titleLower.includes(ftLower)) score += 40;
        else if (contentLower.includes(ftLower)) score += 25;
      }
    }

    for (const kw of keywords) {
      if (titleLower.includes(kw)) score += 18;
      if (contentLower.includes(kw)) score += 8;
    }

    // Slight preference for page 1 overview and evenly spaced coverage when no query is given
    if (idx === 0) score += 12;
    if (keywords.length === 0 && targetSet.size === 0) {
      score += Math.max(1, 10 - idx);
    }

    return { page: p, score };
  });

  const sortedByScore = [...scoredPages].sort(
    (a, b) => b.score - a.score || a.page.pageNumber - b.page.pageNumber
  );

  const selectedFullSet = new Set<number>(
    sortedByScore.slice(0, Math.min(maxFullPages, pages.length)).map((item) => item.page.pageNumber)
  );

  const fullPageNumbers: number[] = [];
  const summaryPageNumbers: number[] = [];
  const blocks: string[] = [];

  const digest = buildReusableConceptDigest(analysis, []);
  if (digest) {
    blocks.push(digest);
  }

  for (const p of pages) {
    const tsTag = p.timestamp ? ` [TIMESTAMP ${p.timestamp}]` : '';
    if (selectedFullSet.has(p.pageNumber)) {
      fullPageNumbers.push(p.pageNumber);
      const body =
        p.content.length > maxCharsPerFullPage
          ? `${p.content.slice(0, maxCharsPerFullPage).trim()}...`
          : p.content;
      blocks.push(`=== PAGE ${p.pageNumber}${tsTag}: ${p.title} (FULL SOURCE) ===\n${body}`);
    } else {
      summaryPageNumbers.push(p.pageNumber);
      const compactSnippet = p.content
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxCharsPerSummaryPage);
      blocks.push(
        `=== PAGE ${p.pageNumber}${tsTag}: ${p.title} (DIGEST) ===\n${compactSnippet}${
          p.content.length > maxCharsPerSummaryPage ? '...' : ''
        }`
      );
    }
  }

  const formattedContext = blocks.join('\n\n');
  const optimizedChars = formattedContext.length;
  const reductionPct =
    originalChars > 0
      ? Math.max(0, Math.round(((originalChars - optimizedChars) / originalChars) * 100))
      : 0;

  return {
    formattedContext,
    fullPageNumbers,
    summaryPageNumbers,
    originalChars,
    optimizedChars,
    reductionPct,
  };
}

