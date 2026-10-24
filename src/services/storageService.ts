import {
  CloudSyncState,
  DocumentAnalysis,
  FlashcardItem,
  FocusSessionRecord,
  LegacyBackupSummary,
  MindMapData,
  MistakeInsight,
  OnePageRevisionSheet,
  QuizAttempt,
  RevisionTask,
  StickyNote,
  StudyMaterial,
  StudyTimerState,
  ThemePreference,
  TutorMessage,
  UserAuthProfile,
  YouTubeRecommendation,
} from '../types/study';
import {
  ensureUserProfileInFirestore,
  fetchAllCloudStudyData,
  sanitizeFirestoreId,
  syncConversationToFirestore,
  syncFlashcardsToFirestore,
  syncMaterialToFirestore,
  syncNotesToFirestore,
  syncProgressToFirestore,
  syncQuizAttemptToFirestore,
  syncRevisionPlanToFirestore,
  syncStudySessionToFirestore,
  uploadPdfToUserStorage,
} from './firebaseService';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageRepository {
  getActiveUser(): UserAuthProfile | null;
  getCloudSyncState(): CloudSyncState;
  getSyncState(): CloudSyncState;
  subscribeToSyncState(listener: (state: CloudSyncState) => void): () => void;
  getLegacyBackupSummary(): LegacyBackupSummary;
  importUnclaimedLegacyData(): Promise<number>;
  importQuarantinedLegacyDataToCurrentUser(): Promise<{
    importedMaterials: number;
    importedAttempts: number;
  }>;
  dismissUnclaimedLegacyData(): void;
  dismissQuarantinedLegacyData(): void;
  loadSampleStudyMaterial(): StudyMaterial | null;
  getMaterials(): StudyMaterial[];
  getMaterialById(id: string): StudyMaterial | undefined;
  saveMaterial(material: StudyMaterial): void;
  getActiveMaterialId(): string | null;
  setActiveMaterialId(id: string): void;
  getDocumentAnalysis(materialId: string): DocumentAnalysis | null;
  saveDocumentAnalysis(analysis: DocumentAnalysis): void;
  getTutorHistory(materialId: string): TutorMessage[];
  saveTutorHistory(materialId: string, messages: TutorMessage[]): void;
  getQuizAttempts(materialId?: string): QuizAttempt[];
  saveQuizAttempt(attempt: QuizAttempt): void;
  getMistakeInsights(materialId: string): MistakeInsight[];
  saveMistakeInsights(materialId: string, insights: MistakeInsight[]): void;
  getRevisionPlan(materialId: string): RevisionTask[];
  saveRevisionPlan(materialId: string, tasks: RevisionTask[]): void;
  getStickyNotes(materialId: string): StickyNote[];
  saveStickyNotes(materialId: string, notes: StickyNote[]): void;
  getFlashcards(materialId: string): FlashcardItem[];
  saveFlashcards(materialId: string, cards: FlashcardItem[]): void;
  getMindMap(materialId: string): MindMapData | null;
  saveMindMap(materialId: string, mindMap: MindMapData): void;
  getRevisionSheet(materialId: string): OnePageRevisionSheet | null;
  saveRevisionSheet(materialId: string, sheet: OnePageRevisionSheet): void;
  getYouTubeRecommendations(materialId: string, query: string): YouTubeRecommendation[];
  saveYouTubeRecommendations(
    materialId: string,
    query: string,
    videos: YouTubeRecommendation[]
  ): void;
  getStudyTimerState(): StudyTimerState;
  saveStudyTimerState(state: StudyTimerState): void;
  getFocusSessions(materialId?: string): FocusSessionRecord[];
  saveFocusSession(session: FocusSessionRecord): void;
  getThemePreference(): ThemePreference;
  saveThemePreference(theme: ThemePreference): void;
  getStudiedPages(materialId: string): number[];
  markPageStudied(materialId: string, pageNumber: number): number[];
  clearProgressData(): void;
  resetUserSessionData(): void;
  syncWithCloudUser(user: UserAuthProfile | null): Promise<void>;
}

// Legacy unscoped keys that previously caused cross-account data leakage
const LEGACY_UNSCOPED_KEYS = {
  MATERIALS: 'learnmate_materials_v2',
  ACTIVE_MATERIAL_ID: 'learnmate_active_material_v2',
  ANALYSES: 'learnmate_analyses_v2',
  TUTOR_HISTORY: 'learnmate_tutor_history_v2',
  QUIZ_ATTEMPTS: 'learnmate_quiz_attempts_v2',
  MISTAKE_DNA: 'learnmate_mistake_dna_v2',
  REVISION_PLANS: 'learnmate_revision_plans_v2',
  STICKY_NOTES: 'learnmate_sticky_notes_v1',
  FLASHCARDS: 'learnmate_flashcards_v1',
  MIND_MAPS: 'learnmate_mind_maps_v1',
  REVISION_SHEETS: 'learnmate_revision_sheets_v1',
  YOUTUBE_RECS: 'learnmate_youtube_recs_v1',
  FOCUS_SESSIONS: 'learnmate_focus_sessions_v1',
  STUDIED_PAGES: 'learnmate_studied_pages_v1',
};

const GLOBAL_KEYS = {
  STUDY_TIMER: 'learnmate_study_timer_v1',
  THEME: 'learnmate_theme_v1',
  LEGACY_BACKUP_QUARANTINE: 'learnmate_legacy_unowned_backup_v1',
  LEGACY_MIGRATION_DONE: 'learnmate_legacy_quarantine_done_v1',
};

const BUILTIN_STARTER_IDS = new Set([
  'mat_probability_notes',
  'mat_sets_relations',
  'mat_statistics_ch3',
]);

function userScopedKey(uid: string, resource: string): string {
  const safeUid = sanitizeFirestoreId(uid);
  return `learnmate_u_${safeUid}_${resource}_v3`;
}

const ALL_USER_RESOURCES = [
  'materials',
  'active_material_id',
  'analyses',
  'tutor_history',
  'quiz_attempts',
  'mistake_dna',
  'revision_plans',
  'sticky_notes',
  'flashcards',
  'mind_maps',
  'revision_sheets',
  'youtube_recs',
  'focus_sessions',
  'studied_pages',
  'theme',
];

const DEFAULT_TIMER_STATE: StudyTimerState = {
  phase: 'study',
  isRunning: false,
  studyDurationMinutes: 25,
  breakDurationMinutes: 5,
  remainingSecondsWhenPaused: 25 * 60,
  targetEndTimeMs: null,
  soundEnabled: true,
  completedSessionsCount: 0,
};

export const SAMPLE_PROBABILITY_MATERIAL: StudyMaterial = {
  id: 'mat_probability_notes',
  title: 'Probability Notes.pdf',
  sourceType: 'pdf',
  pageCount: 4,
  createdAt: new Date().toISOString(),
  lastStudiedAt: 'Just now',
  iconColor: 'red',
  pages: [
    {
      pageNumber: 1,
      title: 'Sample Spaces, Events & Kolmogorov Axioms',
      content: `1. Foundations of Probability Theory

A random experiment is a process with an uncertain outcome. The sample space (denoted S or Omega) is the set of all possible outcomes of a random experiment. An event E is any subset of the sample space S.

Kolmogorov's Three Axioms of Probability:
For any event A in the sample space S, a probability measure P assigns a real number P(A) satisfying:
1. Non-negativity: P(A) >= 0 for every event A.
2. Normalization (Certainty): P(S) = 1.
3. Countable Additivity: If A1, A2, ... are mutually exclusive (disjoint) events (meaning A1 and A2 have no outcomes in common, A1 ∩ A2 = empty set), then:
   P(A1 U A2 U ...) = P(A1) + P(A2) + ...

Key Consequences of the Axioms:
• Complement Rule: P(A') = 1 - P(A), where A' is the complement of A.
• Impossible Event: P(empty set) = 0.
• Inclusion-Exclusion Principle (for any two events A and B):
  P(A U B) = P(A) + P(B) - P(A ∩ B).`,
    },
    {
      pageNumber: 2,
      title: 'Conditional Probability & Independence',
      content: `2. Conditional Probability and Independent Events

Conditional probability measures the probability of an event A occurring given that another event B has already occurred.

Definition of Conditional Probability:
If P(B) > 0, the conditional probability of A given B is defined as:
P(A | B) = P(A ∩ B) / P(B)

Statistical Independence:
Two events A and B are independent if and only if knowing that B occurred gives no information about whether A occurred:
• P(A ∩ B) = P(A) * P(B)
• Equivalently, P(A | B) = P(A) (assuming P(B) > 0).`,
    },
    {
      pageNumber: 3,
      title: 'Law of Total Probability & Bayes Theorem',
      content: `3. Law of Total Probability and Bayes' Theorem

Bayes' Theorem flips conditional probabilities, allowing us to update the prior probability P(Bi) after observing evidence A:
P(Bi | A) = [ P(A | Bi) * P(Bi) ] / P(A)
where P(A) = Sum_j [ P(A | Bj) * P(Bj) ].`,
    },
    {
      pageNumber: 4,
      title: 'Discrete Random Variables, Expectation & Variance',
      content: `4. Discrete Random Variables, Expected Value & Variance

Expected Value (Mean):
E[X] = Sum [ x * p(x) ]
Linearity of Expectation:
E[aX + bY] = a * E[X] + b * E[Y]

Variance and Standard Deviation:
Var(X) = E[(X - mu)^2] = E[X^2] - (E[X])^2
Var(aX + b) = a^2 * Var(X).`,
    },
  ],
};

export const SAMPLE_PROBABILITY_ANALYSIS: DocumentAnalysis = {
  materialId: 'mat_probability_notes',
  overview:
    'Covers foundational probability axioms, conditional probability and statistical independence, Bayes’ Theorem with the Law of Total Probability, and discrete random variables (PMF, expectation, and variance).',
  keyTopics: [
    {
      name: 'Kolmogorov Axioms & Inclusion-Exclusion',
      summary:
        'Defines non-negativity, normalization P(S)=1, countable additivity, and P(A U B) = P(A) + P(B) - P(A ∩ B).',
      pageNumbers: [1],
      keyTerms: ['Sample Space S', 'Complement Rule', 'Inclusion-Exclusion'],
    },
    {
      name: 'Conditional Probability & Independence',
      summary:
        'Defines P(A|B) = P(A ∩ B)/P(B) and distinguishes statistical independence from mutually exclusive (disjoint) events.',
      pageNumbers: [2],
      keyTerms: ['P(A|B)', 'Multiplication Rule', 'Disjoint vs Independent'],
    },
    {
      name: 'Law of Total Probability & Bayes Theorem',
      summary:
        'Shows how to update prior beliefs P(Bi) into posterior probabilities P(Bi|A) and explains the base rate fallacy.',
      pageNumbers: [3],
      keyTerms: ['Prior', 'Likelihood', 'Posterior', 'Base Rate Fallacy'],
    },
    {
      name: 'Discrete Random Variables & Variance',
      summary:
        'Covers valid PMFs, linearity of expectation E[aX+bY], and variance scaling Var(aX+b) = a^2 Var(X).',
      pageNumbers: [4],
      keyTerms: ['PMF', 'Linearity of Expectation', 'Var(aX+b) = a^2 Var(X)'],
    },
  ],
  suggestedQuestions: [
    'Explain Bayes Theorem simply',
    'Give me an example problem',
    'Why can’t two mutually exclusive events with positive probability be independent?',
    'Does linearity of expectation require X and Y to be independent?',
  ],
};

export function createOptionalSampleMaterial(): StudyMaterial {
  return {
    ...SAMPLE_PROBABILITY_MATERIAL,
    createdAt: new Date().toISOString(),
    lastStudiedAt: 'Just now',
  };
}

function getDefaultBrowserStore(): KeyValueStore | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

function readJsonFromStore<T>(
  store: KeyValueStore | null,
  key: string,
  fallback: T
): T {
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonToStore<T>(
  store: KeyValueStore | null,
  key: string,
  value: T
): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('localStorage write warning:', err);
  }
}

function removeKeyFromStore(store: KeyValueStore | null, key: string): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

interface QuarantinedLegacyPayload {
  backedUpAt: string;
  dismissed?: boolean;
  importedByUid?: string;
  materials: StudyMaterial[];
  analyses: Record<string, DocumentAnalysis>;
  attempts: QuizAttempt[];
  tutorHistory: Record<string, TutorMessage[]>;
  mistakeInsights: Record<string, MistakeInsight[]>;
  revisionPlans: Record<string, RevisionTask[]>;
  stickyNotes: Record<string, StickyNote[]>;
  flashcards: Record<string, FlashcardItem[]>;
  mindMaps: Record<string, MindMapData>;
  revisionSheets: Record<string, OnePageRevisionSheet>;
  focusSessions: FocusSessionRecord[];
  studiedPages: Record<string, number[]>;
}

/**
 * User-Isolated Storage Repository.
 * - Never reads or writes unscoped global keys for personal study data.
 * - Isolates all local caches strictly under `learnmate_u_${uid}_*`.
 * - Quarantines any pre-existing unowned legacy `localStorage` data into a safe backup
 *   so it is NEVER automatically copied into new accounts.
 * - Tracks real cloud persistence status (`idle` | `syncing` | `synced` | `error`).
 */
export class UserIsolatedStorageRepository implements StorageRepository {
  private activeUser: UserAuthProfile | null = null;
  private store: KeyValueStore | null;
  private cloudEnabled: boolean;
  private readonly memoryCache = new Map<string, any>();
  private syncState: CloudSyncState = {
    status: 'idle',
    lastSyncedAt: null,
    errorMessage: null,
    pendingOperations: 0,
  };
  private syncListeners = new Set<(state: CloudSyncState) => void>();

  constructor(customStore?: KeyValueStore | null, cloudOption?: unknown) {
    this.store =
      customStore !== undefined ? customStore : getDefaultBrowserStore();
    this.cloudEnabled = cloudOption !== null && cloudOption !== false;
    this.quarantineUnscopedLegacyData();
  }

  private readJson<T>(key: string, fallback: T): T {
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key) as T;
    }
    const parsed = readJsonFromStore(this.store, key, fallback);
    this.memoryCache.set(key, parsed);
    return parsed;
  }

  private writeJson<T>(key: string, value: T): void {
    this.memoryCache.set(key, value);
    writeJsonToStore(this.store, key, value);
  }

  private removeKey(key: string): void {
    this.memoryCache.delete(key);
    removeKeyFromStore(this.store, key);
  }

  /**
   * Inspects legacy unscoped localStorage keys once, backs up any genuine user-created records
   * to `learnmate_legacy_unowned_backup_v1`, and purges the unscoped keys so they can never
   * leak across accounts.
   */
  public quarantineUnscopedLegacyData(): void {
    if (!this.store) return;

    const rawMaterials = this.readJson<StudyMaterial[]>(
      LEGACY_UNSCOPED_KEYS.MATERIALS,
      []
    );
    const customMaterials = rawMaterials.filter(
      (m) => !BUILTIN_STARTER_IDS.has(m.id)
    );
    const attempts = this.readJson<QuizAttempt[]>(
      LEGACY_UNSCOPED_KEYS.QUIZ_ATTEMPTS,
      []
    );
    const tutorHistory = this.readJson<Record<string, TutorMessage[]>>(
      LEGACY_UNSCOPED_KEYS.TUTOR_HISTORY,
      {}
    );
    const stickyNotes = this.readJson<Record<string, StickyNote[]>>(
      LEGACY_UNSCOPED_KEYS.STICKY_NOTES,
      {}
    );
    const flashcards = this.readJson<Record<string, FlashcardItem[]>>(
      LEGACY_UNSCOPED_KEYS.FLASHCARDS,
      {}
    );
    const mindMaps = this.readJson<Record<string, MindMapData>>(
      LEGACY_UNSCOPED_KEYS.MIND_MAPS,
      {}
    );
    const revisionSheets = this.readJson<Record<string, OnePageRevisionSheet>>(
      LEGACY_UNSCOPED_KEYS.REVISION_SHEETS,
      {}
    );
    const mistakeInsights = this.readJson<Record<string, MistakeInsight[]>>(
      LEGACY_UNSCOPED_KEYS.MISTAKE_DNA,
      {}
    );
    const revisionPlans = this.readJson<Record<string, RevisionTask[]>>(
      LEGACY_UNSCOPED_KEYS.REVISION_PLANS,
      {}
    );
    const analyses = this.readJson<Record<string, DocumentAnalysis>>(
      LEGACY_UNSCOPED_KEYS.ANALYSES,
      {}
    );
    const focusSessions = this.readJson<FocusSessionRecord[]>(
      LEGACY_UNSCOPED_KEYS.FOCUS_SESSIONS,
      []
    );
    const studiedPages = this.readJson<Record<string, number[]>>(
      LEGACY_UNSCOPED_KEYS.STUDIED_PAGES,
      {}
    );

    const hasUserCreatedData =
      customMaterials.length > 0 ||
      attempts.length > 0 ||
      Object.keys(tutorHistory).length > 0 ||
      Object.keys(stickyNotes).length > 0 ||
      Object.keys(flashcards).length > 0;

    if (hasUserCreatedData) {
      const existingBackup = this.readJson<QuarantinedLegacyPayload | null>(
        GLOBAL_KEYS.LEGACY_BACKUP_QUARANTINE,
        null
      );
      if (!existingBackup) {
        const materialsToBackup =
          customMaterials.length > 0 ? customMaterials : rawMaterials;
        const backupPayload: QuarantinedLegacyPayload = {
          backedUpAt: new Date().toISOString(),
          materials: materialsToBackup,
          analyses,
          attempts,
          tutorHistory,
          mistakeInsights,
          revisionPlans,
          stickyNotes,
          flashcards,
          mindMaps,
          revisionSheets,
          focusSessions: Array.isArray(focusSessions) ? focusSessions : [],
          studiedPages,
        };
        this.writeJson(GLOBAL_KEYS.LEGACY_BACKUP_QUARANTINE, backupPayload);
      }
    }

    // Always remove unscoped global keys so they never bleed into any student session
    Object.values(LEGACY_UNSCOPED_KEYS).forEach((k) => this.removeKey(k));
    try {
      this.store.setItem(GLOBAL_KEYS.LEGACY_MIGRATION_DONE, 'true');
    } catch {
      // ignore
    }
  }

  getActiveUser(): UserAuthProfile | null {
    return this.activeUser;
  }

  getCloudSyncState(): CloudSyncState {
    return this.syncState;
  }

  getSyncState(): CloudSyncState {
    return this.syncState;
  }

  subscribeToSyncState(listener: (state: CloudSyncState) => void): () => void {
    this.syncListeners.add(listener);
    listener(this.syncState);
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  private updateSyncState(partial: Partial<CloudSyncState>): void {
    this.syncState = { ...this.syncState, ...partial };
    this.syncListeners.forEach((cb) => {
      try {
        cb(this.syncState);
      } catch {
        // ignore
      }
    });
  }

  private trackCloudWrite(promiseFactory: () => Promise<unknown>): void {
    if (!this.activeUser || !this.cloudEnabled) return;
    const nextPending = this.syncState.pendingOperations + 1;
    this.updateSyncState({
      status: 'syncing',
      pendingOperations: nextPending,
      errorMessage: null,
    });

    promiseFactory()
      .then(() => {
        const rem = Math.max(0, this.syncState.pendingOperations - 1);
        this.updateSyncState({
          status: rem > 0 ? 'syncing' : 'synced',
          pendingOperations: rem,
          lastSyncedAt: new Date().toISOString(),
          errorMessage: null,
        });
      })
      .catch((err) => {
        const rem = Math.max(0, this.syncState.pendingOperations - 1);
        this.updateSyncState({
          status: 'error',
          pendingOperations: rem,
          errorMessage:
            err instanceof Error
              ? err.message
              : 'Cloud sync encountered an error.',
        });
      });
  }

  getLegacyBackupSummary(): LegacyBackupSummary {
    const emptySummary: LegacyBackupSummary = {
      hasUnclaimedData: false,
      materialCount: 0,
      attemptCount: 0,
      materialsCount: 0,
      attemptsCount: 0,
      notesCount: 0,
      backedUpAt: '',
    };
    const backup = this.readJson<QuarantinedLegacyPayload | null>(
      GLOBAL_KEYS.LEGACY_BACKUP_QUARANTINE,
      null
    );
    if (!backup || backup.dismissed || backup.importedByUid) {
      return emptySummary;
    }
    const notesCount = Object.values(backup.stickyNotes || {}).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0
    );
    const matCount = (backup.materials || []).length;
    const attCount = (backup.attempts || []).length;
    if (matCount === 0 && attCount === 0 && notesCount === 0) {
      return emptySummary;
    }
    return {
      hasUnclaimedData: true,
      materialCount: matCount,
      attemptCount: attCount,
      materialsCount: matCount,
      attemptsCount: attCount,
      notesCount,
      backedUpAt: backup.backedUpAt,
    };
  }

  async importQuarantinedLegacyDataToCurrentUser(): Promise<{
    importedMaterials: number;
    importedAttempts: number;
  }> {
    if (!this.activeUser) {
      return { importedMaterials: 0, importedAttempts: 0 };
    }
    const uid = this.activeUser.uid;
    const backup = this.readJson<QuarantinedLegacyPayload | null>(
      GLOBAL_KEYS.LEGACY_BACKUP_QUARANTINE,
      null
    );
    if (!backup || backup.dismissed || backup.importedByUid) {
      return { importedMaterials: 0, importedAttempts: 0 };
    }

    let importedMaterials = 0;
    let importedAttempts = 0;
    const currentMaterials = this.getMaterials();
    const existingIds = new Set(currentMaterials.map((m) => m.id));

    for (const mat of backup.materials || []) {
      if (!existingIds.has(mat.id)) {
        const ownedMat: StudyMaterial = { ...mat, ownerId: uid };
        this.saveMaterial(ownedMat);
        importedMaterials += 1;
      }
      if (backup.analyses?.[mat.id] && !this.getDocumentAnalysis(mat.id)) {
        this.saveDocumentAnalysis(backup.analyses[mat.id]);
      }
      if (
        backup.stickyNotes?.[mat.id]?.length &&
        this.getStickyNotes(mat.id).length === 0
      ) {
        this.saveStickyNotes(mat.id, backup.stickyNotes[mat.id]);
      }
      if (
        backup.flashcards?.[mat.id]?.length &&
        this.getFlashcards(mat.id).length === 0
      ) {
        this.saveFlashcards(mat.id, backup.flashcards[mat.id]);
      }
      if (backup.mindMaps?.[mat.id] && !this.getMindMap(mat.id)) {
        this.saveMindMap(mat.id, backup.mindMaps[mat.id]);
      }
      if (backup.revisionSheets?.[mat.id] && !this.getRevisionSheet(mat.id)) {
        this.saveRevisionSheet(mat.id, backup.revisionSheets[mat.id]);
      }
      if (
        backup.tutorHistory?.[mat.id]?.length &&
        this.getTutorHistory(mat.id).length === 0
      ) {
        this.saveTutorHistory(mat.id, backup.tutorHistory[mat.id]);
      }
      if (
        backup.revisionPlans?.[mat.id]?.length &&
        this.getRevisionPlan(mat.id).length === 0
      ) {
        this.saveRevisionPlan(mat.id, backup.revisionPlans[mat.id]);
      }
    }

    const existingAttemptIds = new Set(this.getQuizAttempts().map((a) => a.id));
    for (const att of backup.attempts || []) {
      if (!existingAttemptIds.has(att.id)) {
        this.saveQuizAttempt({ ...att, ownerId: uid });
        importedAttempts += 1;
      }
    }

    backup.importedByUid = uid;
    this.writeJson(GLOBAL_KEYS.LEGACY_BACKUP_QUARANTINE, backup);
    return { importedMaterials, importedAttempts };
  }

  async importUnclaimedLegacyData(): Promise<number> {
    const res = await this.importQuarantinedLegacyDataToCurrentUser();
    return res.importedMaterials + res.importedAttempts;
  }

  dismissQuarantinedLegacyData(): void {
    const backup = this.readJson<QuarantinedLegacyPayload | null>(
      GLOBAL_KEYS.LEGACY_BACKUP_QUARANTINE,
      null
    );
    if (!backup) return;
    backup.dismissed = true;
    this.writeJson(GLOBAL_KEYS.LEGACY_BACKUP_QUARANTINE, backup);
  }

  dismissUnclaimedLegacyData(): void {
    this.dismissQuarantinedLegacyData();
  }

  loadSampleStudyMaterial(): StudyMaterial | null {
    if (!this.activeUser) return null;
    const sampleMat: StudyMaterial = {
      ...SAMPLE_PROBABILITY_MATERIAL,
      ownerId: this.activeUser.uid,
      createdAt: new Date().toISOString(),
      lastStudiedAt: 'Just now',
    };
    this.saveDocumentAnalysis(SAMPLE_PROBABILITY_ANALYSIS);
    this.saveMaterial(sampleMat);
    return sampleMat;
  }

  getMaterials(): StudyMaterial[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'materials');
    return this.readJson<StudyMaterial[]>(key, []);
  }

  getMaterialById(id: string): StudyMaterial | undefined {
    return this.getMaterials().find((m) => m.id === id);
  }

  saveMaterial(material: StudyMaterial): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const ownedMaterial: StudyMaterial = {
      ...material,
      ownerId: uid,
    };
    const key = userScopedKey(uid, 'materials');
    const existing = this.getMaterials().filter(
      (m) => m.id !== ownedMaterial.id
    );
    const updated = [ownedMaterial, ...existing];
    this.writeJson(key, updated);
    this.setActiveMaterialId(ownedMaterial.id);

    const analysis = this.getDocumentAnalysis(ownedMaterial.id);
    this.trackCloudWrite(async () => {
      if (ownedMaterial.pdfDataUrl) {
        const storagePath = await uploadPdfToUserStorage(
          uid,
          ownedMaterial.id,
          ownedMaterial.pdfDataUrl
        );
        if (storagePath) {
          ownedMaterial.storagePath = storagePath;
        }
      }
      await syncMaterialToFirestore(uid, ownedMaterial, analysis);
    });
  }

  getActiveMaterialId(): string | null {
    if (!this.activeUser) return null;
    const key = userScopedKey(this.activeUser.uid, 'active_material_id');
    const id = this.store ? this.store.getItem(key) : null;
    if (id && this.getMaterialById(id)) {
      return id;
    }
    const materials = this.getMaterials();
    return materials[0]?.id || null;
  }

  setActiveMaterialId(id: string): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'active_material_id');
    if (this.store) {
      try {
        this.store.setItem(key, id);
      } catch {
        // ignore
      }
    }
    const currentUser = this.activeUser;
    this.trackCloudWrite(() =>
      ensureUserProfileInFirestore(
        currentUser,
        id,
        this.getThemePreference()
      )
    );
  }

  getDocumentAnalysis(materialId: string): DocumentAnalysis | null {
    if (!this.activeUser) return null;
    const key = userScopedKey(this.activeUser.uid, 'analyses');
    const map = this.readJson<Record<string, DocumentAnalysis>>(key, {});
    return map[materialId] || null;
  }

  saveDocumentAnalysis(analysis: DocumentAnalysis): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'analyses');
    const map = this.readJson<Record<string, DocumentAnalysis>>(key, {});
    map[analysis.materialId] = analysis;
    this.writeJson(key, map);

    const mat = this.getMaterialById(analysis.materialId);
    if (mat) {
      this.trackCloudWrite(() => syncMaterialToFirestore(uid, mat, analysis));
    }
  }

  getTutorHistory(materialId: string): TutorMessage[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'tutor_history');
    const map = this.readJson<Record<string, TutorMessage[]>>(key, {});
    return map[materialId] || [];
  }

  saveTutorHistory(materialId: string, messages: TutorMessage[]): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'tutor_history');
    const map = this.readJson<Record<string, TutorMessage[]>>(key, {});
    map[materialId] = messages;
    this.writeJson(key, map);

    this.trackCloudWrite(() =>
      syncConversationToFirestore(uid, materialId, messages)
    );
  }

  getQuizAttempts(materialId?: string): QuizAttempt[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'quiz_attempts');
    const all = this.readJson<QuizAttempt[]>(key, []);
    if (!materialId) return all;
    return all.filter((a) => a.materialId === materialId);
  }

  saveQuizAttempt(attempt: QuizAttempt): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const ownedAttempt: QuizAttempt = { ...attempt, ownerId: uid };
    const key = userScopedKey(uid, 'quiz_attempts');
    const all = this.readJson<QuizAttempt[]>(key, []);
    const updated = [
      ownedAttempt,
      ...all.filter((a) => a.id !== ownedAttempt.id),
    ];
    this.writeJson(key, updated);

    const mat = this.getMaterialById(ownedAttempt.materialId);
    this.trackCloudWrite(async () => {
      if (mat) {
        await syncMaterialToFirestore(
          uid,
          mat,
          this.getDocumentAnalysis(mat.id)
        );
      }
      await syncQuizAttemptToFirestore(uid, ownedAttempt);
      await syncProgressToFirestore(
        uid,
        ownedAttempt.materialId,
        this.getStudiedPages(ownedAttempt.materialId),
        ownedAttempt.percentage
      );
    });
  }

  getMistakeInsights(materialId: string): MistakeInsight[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'mistake_dna');
    const map = this.readJson<Record<string, MistakeInsight[]>>(key, {});
    return map[materialId] || [];
  }

  saveMistakeInsights(materialId: string, insights: MistakeInsight[]): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'mistake_dna');
    const map = this.readJson<Record<string, MistakeInsight[]>>(key, {});
    map[materialId] = insights;
    this.writeJson(key, map);

    this.trackCloudWrite(() =>
      syncRevisionPlanToFirestore(
        uid,
        materialId,
        this.getRevisionPlan(materialId),
        insights
      )
    );
  }

  getRevisionPlan(materialId: string): RevisionTask[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'revision_plans');
    const map = this.readJson<Record<string, RevisionTask[]>>(key, {});
    return map[materialId] || [];
  }

  saveRevisionPlan(materialId: string, tasks: RevisionTask[]): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'revision_plans');
    const map = this.readJson<Record<string, RevisionTask[]>>(key, {});
    map[materialId] = tasks;
    this.writeJson(key, map);

    this.trackCloudWrite(() =>
      syncRevisionPlanToFirestore(
        uid,
        materialId,
        tasks,
        this.getMistakeInsights(materialId)
      )
    );
  }

  getStickyNotes(materialId: string): StickyNote[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'sticky_notes');
    const map = this.readJson<Record<string, StickyNote[]>>(key, {});
    return map[materialId] || [];
  }

  saveStickyNotes(materialId: string, notes: StickyNote[]): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'sticky_notes');
    const map = this.readJson<Record<string, StickyNote[]>>(key, {});
    map[materialId] = notes;
    this.writeJson(key, map);

    this.trackCloudWrite(() =>
      syncNotesToFirestore(
        uid,
        materialId,
        notes,
        this.getMindMap(materialId),
        this.getRevisionSheet(materialId)
      )
    );
  }

  getFlashcards(materialId: string): FlashcardItem[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'flashcards');
    const map = this.readJson<Record<string, FlashcardItem[]>>(key, {});
    return map[materialId] || [];
  }

  saveFlashcards(materialId: string, cards: FlashcardItem[]): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'flashcards');
    const map = this.readJson<Record<string, FlashcardItem[]>>(key, {});
    map[materialId] = cards;
    this.writeJson(key, map);

    this.trackCloudWrite(() =>
      syncFlashcardsToFirestore(uid, materialId, cards)
    );
  }

  getMindMap(materialId: string): MindMapData | null {
    if (!this.activeUser) return null;
    const key = userScopedKey(this.activeUser.uid, 'mind_maps');
    const map = this.readJson<Record<string, MindMapData>>(key, {});
    return map[materialId] || null;
  }

  saveMindMap(materialId: string, mindMap: MindMapData): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'mind_maps');
    const map = this.readJson<Record<string, MindMapData>>(key, {});
    map[materialId] = mindMap;
    this.writeJson(key, map);

    this.trackCloudWrite(() =>
      syncNotesToFirestore(
        uid,
        materialId,
        this.getStickyNotes(materialId),
        mindMap,
        this.getRevisionSheet(materialId)
      )
    );
  }

  getRevisionSheet(materialId: string): OnePageRevisionSheet | null {
    if (!this.activeUser) return null;
    const key = userScopedKey(this.activeUser.uid, 'revision_sheets');
    const map = this.readJson<Record<string, OnePageRevisionSheet>>(key, {});
    return map[materialId] || null;
  }

  saveRevisionSheet(materialId: string, sheet: OnePageRevisionSheet): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'revision_sheets');
    const map = this.readJson<Record<string, OnePageRevisionSheet>>(key, {});
    map[materialId] = sheet;
    this.writeJson(key, map);

    this.trackCloudWrite(() =>
      syncNotesToFirestore(
        uid,
        materialId,
        this.getStickyNotes(materialId),
        this.getMindMap(materialId),
        sheet
      )
    );
  }

  getYouTubeRecommendations(
    materialId: string,
    query: string
  ): YouTubeRecommendation[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'youtube_recs');
    const map = this.readJson<Record<string, YouTubeRecommendation[]>>(key, {});
    const cacheKey = `${materialId}::${query.toLowerCase().trim()}`;
    return map[cacheKey] || [];
  }

  saveYouTubeRecommendations(
    materialId: string,
    query: string,
    videos: YouTubeRecommendation[]
  ): void {
    if (!this.activeUser) return;
    const key = userScopedKey(this.activeUser.uid, 'youtube_recs');
    const map = this.readJson<Record<string, YouTubeRecommendation[]>>(key, {});
    const cacheKey = `${materialId}::${query.toLowerCase().trim()}`;
    map[cacheKey] = videos;
    this.writeJson(key, map);
  }

  getStudyTimerState(): StudyTimerState {
    return this.readJson<StudyTimerState>(
      GLOBAL_KEYS.STUDY_TIMER,
      DEFAULT_TIMER_STATE
    );
  }

  saveStudyTimerState(state: StudyTimerState): void {
    this.writeJson(GLOBAL_KEYS.STUDY_TIMER, state);
  }

  getFocusSessions(materialId?: string): FocusSessionRecord[] {
    if (!this.activeUser) return [];
    const key = userScopedKey(this.activeUser.uid, 'focus_sessions');
    const all = this.readJson<FocusSessionRecord[]>(key, []);
    if (!materialId) return all;
    return all.filter((s) => s.materialId === materialId);
  }

  saveFocusSession(session: FocusSessionRecord): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    const ownedSession: FocusSessionRecord = { ...session, ownerId: uid };
    const key = userScopedKey(uid, 'focus_sessions');
    const all = this.readJson<FocusSessionRecord[]>(key, []);
    const updated = [
      ownedSession,
      ...all.filter((s) => s.id !== ownedSession.id),
    ];
    this.writeJson(key, updated);

    this.trackCloudWrite(() => syncStudySessionToFirestore(uid, ownedSession));
  }

  getThemePreference(): ThemePreference {
    if (this.activeUser && this.store) {
      const userThemeKey = userScopedKey(this.activeUser.uid, 'theme');
      const uVal = this.store.getItem(userThemeKey);
      if (uVal === 'light' || uVal === 'dark' || uVal === 'system') {
        return uVal;
      }
    }
    if (this.store) {
      try {
        const val = this.store.getItem(GLOBAL_KEYS.THEME);
        if (val === 'light' || val === 'dark' || val === 'system') {
          return val;
        }
      } catch {
        // ignore
      }
    }
    return 'light';
  }

  saveThemePreference(theme: ThemePreference): void {
    if (this.store) {
      try {
        this.store.setItem(GLOBAL_KEYS.THEME, theme);
        if (this.activeUser) {
          this.store.setItem(
            userScopedKey(this.activeUser.uid, 'theme'),
            theme
          );
        }
      } catch {
        // ignore
      }
    }
    if (this.activeUser) {
      const currentUser = this.activeUser;
      this.trackCloudWrite(() =>
        ensureUserProfileInFirestore(
          currentUser,
          this.getActiveMaterialId() || '',
          theme
        )
      );
    }
  }

  getStudiedPages(materialId: string): number[] {
    if (!this.activeUser) return [1];
    const key = userScopedKey(this.activeUser.uid, 'studied_pages');
    const map = this.readJson<Record<string, number[]>>(key, {});
    const pages = map[materialId];
    if (Array.isArray(pages) && pages.length > 0) {
      return pages;
    }
    return [1];
  }

  markPageStudied(materialId: string, pageNumber: number): number[] {
    if (!this.activeUser) return [1];
    const uid = this.activeUser.uid;
    const key = userScopedKey(uid, 'studied_pages');
    const map = this.readJson<Record<string, number[]>>(key, {});
    const current = Array.isArray(map[materialId]) ? map[materialId] : [1];
    if (!current.includes(pageNumber)) {
      const updated = [...current, pageNumber].sort((a, b) => a - b);
      map[materialId] = updated;
      this.writeJson(key, map);
      const attempts = this.getQuizAttempts(materialId);
      const latestMastery = attempts[0]?.percentage || 0;
      this.trackCloudWrite(() =>
        syncProgressToFirestore(uid, materialId, updated, latestMastery)
      );
      return updated;
    }
    return current;
  }

  clearProgressData(): void {
    if (!this.activeUser) return;
    const uid = this.activeUser.uid;
    this.removeKey(userScopedKey(uid, 'quiz_attempts'));
    this.removeKey(userScopedKey(uid, 'mistake_dna'));
    this.removeKey(userScopedKey(uid, 'revision_plans'));
    this.removeKey(userScopedKey(uid, 'tutor_history'));
    this.removeKey(userScopedKey(uid, 'sticky_notes'));
    this.removeKey(userScopedKey(uid, 'flashcards'));
    this.removeKey(userScopedKey(uid, 'mind_maps'));
    this.removeKey(userScopedKey(uid, 'revision_sheets'));
    this.removeKey(userScopedKey(uid, 'focus_sessions'));
    this.removeKey(userScopedKey(uid, 'studied_pages'));
  }

  private purgeUserBrowserCache(uid: string): void {
    for (const res of ALL_USER_RESOURCES) {
      this.removeKey(userScopedKey(uid, res));
    }
    this.memoryCache.clear();
  }

  resetUserSessionData(): void {
    if (this.activeUser) {
      this.purgeUserBrowserCache(this.activeUser.uid);
    } else {
      this.memoryCache.clear();
    }
  }

  /**
   * Synchronizes state strictly with the authenticated user's `/users/{uid}` Firestore documents.
   * Never merges unscoped data or another user's local cache into the signed-in account.
   */
  async syncWithCloudUser(user: UserAuthProfile | null): Promise<void> {
    if (!user) {
      this.activeUser = null;
      this.memoryCache.clear();
      this.updateSyncState({
        status: 'idle',
        lastSyncedAt: null,
        errorMessage: null,
        pendingOperations: 0,
      });
      return;
    }

    if (this.activeUser?.uid !== user.uid) {
      this.memoryCache.clear();
    }
    this.activeUser = user;
    if (!this.cloudEnabled) {
      this.updateSyncState({
        status: 'synced',
        lastSyncedAt: new Date().toISOString(),
        errorMessage: null,
        pendingOperations: 0,
      });
      return;
    }

    this.updateSyncState({
      status: 'syncing',
      errorMessage: null,
      pendingOperations: 1,
    });

    try {
      const uid = user.uid;
      const profileInfo = await ensureUserProfileInFirestore(
        user,
        this.getActiveMaterialId() || '',
        this.getThemePreference()
      );

      const cloud = await fetchAllCloudStudyData(uid);

      // Strictly scope to this UID's own records (cloud + any already-scoped local cache for this exact UID)
      const localMaterials = this.getMaterials().filter(
        (m) => !m.ownerId || m.ownerId === uid
      );
      const mergedMatMap = new Map<string, StudyMaterial>();
      for (const cm of cloud.materials) {
        mergedMatMap.set(cm.id, { ...cm, ownerId: uid });
      }
      for (const lm of localMaterials) {
        if (!mergedMatMap.has(lm.id)) {
          mergedMatMap.set(lm.id, { ...lm, ownerId: uid });
        }
      }
      const mergedMaterials = Array.from(mergedMatMap.values());
      this.writeJson(userScopedKey(uid, 'materials'), mergedMaterials);

      const resolvedActiveId =
        cloud.activeMaterialId ||
        profileInfo.activeMaterialId ||
        mergedMaterials[0]?.id ||
        '';
      if (resolvedActiveId && this.store) {
        this.store.setItem(
          userScopedKey(uid, 'active_material_id'),
          resolvedActiveId
        );
      }

      if (cloud.themePreference && this.store) {
        this.store.setItem(userScopedKey(uid, 'theme'), cloud.themePreference);
        this.store.setItem(GLOBAL_KEYS.THEME, cloud.themePreference);
      }

      // Analyses
      const localAnalyses = this.readJson<Record<string, DocumentAnalysis>>(
        userScopedKey(uid, 'analyses'),
        {}
      );
      const mergedAnalyses = { ...localAnalyses, ...cloud.analyses };
      this.writeJson(userScopedKey(uid, 'analyses'), mergedAnalyses);

      // Quiz attempts
      const localAttempts = this.getQuizAttempts().filter(
        (a) => !a.ownerId || a.ownerId === uid
      );
      const attMap = new Map<string, QuizAttempt>();
      for (const ca of cloud.attempts) attMap.set(ca.id, { ...ca, ownerId: uid });
      for (const la of localAttempts) {
        if (!attMap.has(la.id)) attMap.set(la.id, { ...la, ownerId: uid });
      }
      const mergedAttempts = Array.from(attMap.values()).sort(
        (a, b) =>
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
      );
      this.writeJson(userScopedKey(uid, 'quiz_attempts'), mergedAttempts);

      // Revision plans, mistake insights, tutor history
      const localPlans = this.readJson<Record<string, RevisionTask[]>>(
        userScopedKey(uid, 'revision_plans'),
        {}
      );
      const mergedPlans = { ...localPlans, ...cloud.revisionPlans };
      this.writeJson(userScopedKey(uid, 'revision_plans'), mergedPlans);

      const localInsights = this.readJson<Record<string, MistakeInsight[]>>(
        userScopedKey(uid, 'mistake_dna'),
        {}
      );
      const mergedInsights = { ...localInsights, ...cloud.mistakeInsights };
      this.writeJson(userScopedKey(uid, 'mistake_dna'), mergedInsights);

      const localChats = this.readJson<Record<string, TutorMessage[]>>(
        userScopedKey(uid, 'tutor_history'),
        {}
      );
      const mergedChats = { ...localChats, ...cloud.tutorHistory };
      this.writeJson(userScopedKey(uid, 'tutor_history'), mergedChats);

      // Sticky notes, flashcards, mind maps, revision sheets
      const localNotes = this.readJson<Record<string, StickyNote[]>>(
        userScopedKey(uid, 'sticky_notes'),
        {}
      );
      const mergedNotes = { ...localNotes, ...cloud.stickyNotes };
      this.writeJson(userScopedKey(uid, 'sticky_notes'), mergedNotes);

      const localCards = this.readJson<Record<string, FlashcardItem[]>>(
        userScopedKey(uid, 'flashcards'),
        {}
      );
      const mergedCards = { ...localCards, ...cloud.flashcards };
      this.writeJson(userScopedKey(uid, 'flashcards'), mergedCards);

      const localMaps = this.readJson<Record<string, MindMapData>>(
        userScopedKey(uid, 'mind_maps'),
        {}
      );
      const mergedMaps = { ...localMaps, ...cloud.mindMaps };
      this.writeJson(userScopedKey(uid, 'mind_maps'), mergedMaps);

      const localSheets = this.readJson<Record<string, OnePageRevisionSheet>>(
        userScopedKey(uid, 'revision_sheets'),
        {}
      );
      const mergedSheets = { ...localSheets, ...cloud.revisionSheets };
      this.writeJson(userScopedKey(uid, 'revision_sheets'), mergedSheets);

      // Studied pages & focus sessions
      const localStudied = this.readJson<Record<string, number[]>>(
        userScopedKey(uid, 'studied_pages'),
        {}
      );
      const mergedStudied = { ...localStudied, ...cloud.studiedPages };
      this.writeJson(userScopedKey(uid, 'studied_pages'), mergedStudied);

      const localSessions = this.readJson<FocusSessionRecord[]>(
        userScopedKey(uid, 'focus_sessions'),
        []
      );
      const sessMap = new Map<string, FocusSessionRecord>();
      for (const cs of cloud.focusSessions) sessMap.set(cs.id, cs);
      for (const ls of localSessions) {
        if (!sessMap.has(ls.id)) sessMap.set(ls.id, ls);
      }
      this.writeJson(
        userScopedKey(uid, 'focus_sessions'),
        Array.from(sessMap.values())
      );

      this.updateSyncState({
        status: 'synced',
        lastSyncedAt: new Date().toISOString(),
        errorMessage: null,
        pendingOperations: 0,
      });
    } catch (err) {
      this.updateSyncState({
        status: 'error',
        errorMessage:
          err instanceof Error
            ? err.message
            : 'Unable to synchronize with Cloud Firestore.',
        pendingOperations: 0,
      });
      throw err;
    }
  }
}

export const storageService: StorageRepository = new UserIsolatedStorageRepository();
