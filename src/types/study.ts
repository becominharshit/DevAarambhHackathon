export type ThemePreference = 'light' | 'dark' | 'system';

export type CloudSyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'error'
  | 'offline_local';

export interface CloudSyncState {
  status: CloudSyncStatus;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  pendingOperations: number;
}

export interface LegacyBackupSummary {
  hasUnclaimedData: boolean;
  materialCount: number;
  attemptCount: number;
  materialsCount: number;
  attemptsCount: number;
  notesCount: number;
  backedUpAt: string;
}

export interface StudyPage {
  pageNumber: number;
  title: string;
  content: string;
  timestamp?: string;
  timestampSeconds?: number;
}

export type MaterialIconColor = 'red' | 'blue' | 'green' | 'yellow';

export type YouTubeProcessingMode = 'static' | 'agentic';

export interface YouTubeAnalysisJobState {
  jobId: string;
  videoId: string;
  canonicalUrl: string;
  status: 'queued' | 'analyzing_stage_a' | 'completed' | 'failed';
  stageMessage: string;
  processingMode: YouTubeProcessingMode;
  model: string;
  startedAt: string;
  updatedAt: string;
  durationMs?: number;
  cached?: boolean;
  errorCategory?: string;
  errorMessage?: string;
  result?: {
    title: string;
    videoId: string;
    canonicalUrl: string;
    pages: StudyPage[];
    analysis: DocumentAnalysis;
    processingMode?: YouTubeProcessingMode;
    stageAPipeline?: boolean;
    cached?: boolean;
    durationMs?: number;
  };
}

export interface StudyMaterial {
  id: string;
  ownerId?: string;
  title: string;
  sourceType?: 'pdf' | 'text' | 'youtube';
  pageCount: number;
  pages: StudyPage[];
  createdAt: string;
  lastStudiedAt: string;
  iconColor?: MaterialIconColor;
  pdfDataUrl?: string;
  storagePath?: string;
  youtubeUrl?: string;
  youtubeVideoId?: string;
  pdfFingerprint?: string;
  youtubeProcessingMode?: YouTubeProcessingMode;
}

export interface TopicInfo {
  name: string;
  summary: string;
  pageNumbers: number[];
  keyTerms: string[];
}

export interface DocumentAnalysis {
  materialId: string;
  overview: string;
  keyTopics: TopicInfo[];
  suggestedQuestions: string[];
  coreConcepts?: string[];
  stageACompletedAt?: string;
  processingMode?: YouTubeProcessingMode;
}

export interface Citation {
  pageNumber: number;
  sectionTitle: string;
  snippet: string;
  timestamp?: string;
}

export type TutorSourceMode = 'material' | 'general' | 'both';
export type TutorResponseStyle = 'concise' | 'simplify' | 'deeper';
export type GeminiModelOption = 'gemini-3.8-flash' | 'gemini-3.1-flash-lite' | 'gemini-4-argon';

export type CaptionTextSize = 'small' | 'medium' | 'large';
export type CaptionSpeedMode = 'auto-sync' | 'comfortable';
export type SpeechPlaybackSpeed = 1 | 0.88;

export interface VoiceCaptionPreferences {
  textSize: CaptionTextSize;
  speedMode: CaptionSpeedMode;
  captionsEnabled: boolean;
  playbackSpeed: SpeechPlaybackSpeed;
}

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  supported?: boolean;
  sourceMode?: TutorSourceMode;
  citations?: Citation[];
  followUpQuestions?: string[];
  timestamp: string;
  modality?: 'text' | 'voice';
  interrupted?: boolean;
  turnId?: string;
}

export interface QuizQuestion {
  id: string;
  topic: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  pageNumber: number;
  sourceExcerpt: string;
}

export interface QuizQuestionResult {
  questionId: string;
  topic: string;
  selectedIndex: number;
  correctIndex: number;
  isCorrect: boolean;
  pageNumber: number;
  question: string;
  selectedOption: string;
  correctOption: string;
  explanation: string;
}

export interface QuizAttempt {
  id: string;
  ownerId?: string;
  materialId: string;
  materialTitle: string;
  mode: 'diagnostic' | 'adaptive';
  focusTopics?: string[];
  questions: QuizQuestion[];
  answers: Record<string, number>;
  results: QuizQuestionResult[];
  score: number;
  total: number;
  percentage: number;
  weakTopics: string[];
  strongTopics: string[];
  completedAt: string;
}

export interface MistakeInsight {
  topic: string;
  wrongCount: number;
  totalAsked: number;
  misconception: string;
  whyItHappens: string;
  coreCorrection: string;
  pageNumber: number;
  sourceReference: string;
}

export interface RevisionTask {
  id: string;
  materialId: string;
  topic: string;
  priority: 'High' | 'Medium' | 'Low';
  pageNumber: number;
  sourceReference: string;
  recommendedAction: string;
  conceptSummary: string;
  completed: boolean;
  masteredInAdaptive?: boolean;
}

export interface TopicProgress {
  topic: string;
  attemptsCount: number;
  firstScorePct: number;
  latestScorePct: number;
  improvementPct: number;
  totalCorrect: number;
  totalAsked: number;
}

export interface UserAuthProfile {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  emailVerified?: boolean;
  isTestSession?: boolean;
}

export type StickyNoteColor = 'yellow' | 'pink' | 'blue' | 'green' | 'lavender';

export interface StickyNote {
  id: string;
  materialId: string;
  title: string;
  content: string;
  formula?: string;
  color: StickyNoteColor;
  pageNumber: number;
  sourceReference: string;
  timestamp?: string;
}

export type FlashcardStatus = 'unreviewed' | 'know_it' | 'review_again';

export interface FlashcardItem {
  id: string;
  materialId: string;
  frontPrompt: string;
  backExplanation: string;
  formula?: string;
  topic: string;
  pageNumber: number;
  sourceReference: string;
  status: FlashcardStatus;
}

export interface MindMapNode {
  id: string;
  label: string;
  category: 'central' | 'branch' | 'leaf';
  branchColor: 'blue' | 'red' | 'yellow' | 'green';
  summary: string;
  formula?: string;
  pageNumber: number;
  sourceReference: string;
  parentId?: string;
}

export interface MindMapEdge {
  id: string;
  from: string;
  to: string;
  relationLabel: string;
}

export interface MindMapData {
  materialId: string;
  centralTopic: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  generatedAt: string;
}

export interface OnePageRevisionSheet {
  materialId: string;
  chapterTitle: string;
  overview: string;
  essentialConcepts: Array<{
    title: string;
    explanation: string;
    sourceReference: string;
    pageNumber: number;
  }>;
  formulasAndDefinitions: Array<{
    term: string;
    formulaOrDefinition: string;
    whenToUse: string;
    pageNumber: number;
  }>;
  keyRelationships: string[];
  commonMistakesToAvoid: string[];
  shortRecallQuestions: Array<{
    question: string;
    shortAnswer: string;
    pageNumber: number;
  }>;
  generatedAt: string;
}

export interface YouTubeRecommendation {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  publishedAt?: string;
  url: string;
  topicQuery: string;
  durationText?: string;
  matchedConcept?: string;
  relevanceReason?: string;
}

export interface FocusSessionRecord {
  id: string;
  ownerId?: string;
  materialId: string;
  materialTitle: string;
  durationMinutes: number;
  completedAt: string;
}

export interface StudyTimerState {
  phase: 'study' | 'break';
  isRunning: boolean;
  studyDurationMinutes: number;
  breakDurationMinutes: number;
  remainingSecondsWhenPaused: number;
  targetEndTimeMs: number | null;
  soundEnabled: boolean;
  completedSessionsCount: number;
}
