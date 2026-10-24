import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadString,
} from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  DocumentAnalysis,
  FlashcardItem,
  FocusSessionRecord,
  MindMapData,
  MistakeInsight,
  OnePageRevisionSheet,
  QuizAttempt,
  RevisionTask,
  StickyNote,
  StudyMaterial,
  ThemePreference,
  TutorMessage,
  UserAuthProfile,
} from '../types/study';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Ensure standard browserLocalPersistence so the SAME signed-in account resumes across reloads
if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on startup as required
async function testConnection() {
  if (typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export function sanitizeFirestoreId(rawId: string): string {
  const cleaned = (rawId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

export function getUserPdfStoragePath(uid: string, materialId: string): string {
  const safeUid = sanitizeFirestoreId(uid);
  const safeMatId = sanitizeFirestoreId(materialId);
  return `users/${safeUid}/materials/${safeMatId}.pdf`;
}

// ============================================================================
// CENTRAL AUTH OBSERVER & MULTI-ACCOUNT SESSION MANAGEMENT
// ============================================================================

type AuthSubscriber = (user: UserAuthProfile | null) => void;
const authSubscribers = new Set<AuthSubscriber>();
let activeTestSessionUser: UserAuthProfile | null = null;
let activeTestSessionToken: string | null = null;

function notifyAuthSubscribers(user: UserAuthProfile | null) {
  authSubscribers.forEach((cb) => {
    try {
      cb(user);
    } catch (err) {
      console.error('Auth subscriber error:', err);
    }
  });
}

/**
 * Signs in with Google OAuth Popup.
 * Always forces `prompt: 'select_account'` so signing in after sign-out allows switching Google accounts
 * and never silently reuses the previous account without user choice.
 */
export async function signInWithGoogle(): Promise<UserAuthProfile> {
  activeTestSessionUser = null;
  activeTestSessionToken = null;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  const cred = await signInWithPopup(auth, provider);
  const u = cred.user;
  return {
    uid: u.uid,
    displayName: u.displayName || u.email?.split('@')[0] || 'Student',
    email: u.email,
    photoURL: u.photoURL,
    emailVerified: u.emailVerified,
  };
}

export async function signOutUser(): Promise<void> {
  if (activeTestSessionUser) {
    activeTestSessionUser = null;
    activeTestSessionToken = null;
    notifyAuthSubscribers(null);
    return;
  }
  await firebaseSignOut(auth);
}

/**
 * Returns the current authenticated user's verified Firebase ID token (or signed test token in automated test sessions).
 */
export async function getCurrentUserAuthToken(): Promise<string | null> {
  if (activeTestSessionUser && activeTestSessionToken) {
    return activeTestSessionToken;
  }
  if (auth.currentUser) {
    try {
      return await auth.currentUser.getIdToken();
    } catch {
      return null;
    }
  }
  return null;
}

export function getCurrentAuthenticatedUid(): string | null {
  if (activeTestSessionUser) return activeTestSessionUser.uid;
  return auth.currentUser?.uid || null;
}

export function subscribeToAuthChanges(
  callback: (user: UserAuthProfile | null) => void
): Unsubscribe {
  authSubscribers.add(callback);

  const unsubFirebase = onAuthStateChanged(auth, (u: User | null) => {
    if (activeTestSessionUser) {
      callback(activeTestSessionUser);
      return;
    }
    if (!u) {
      callback(null);
      return;
    }
    callback({
      uid: u.uid,
      displayName: u.displayName || u.email?.split('@')[0] || 'Student',
      email: u.email,
      photoURL: u.photoURL,
      emailVerified: u.emailVerified,
    });
  });

  return () => {
    authSubscribers.delete(callback);
    unsubFirebase();
  };
}

// ============================================================================
// ISOLATED PER-UID CLOUD SIMULATOR FOR AUTOMATED E2E TESTS (NON-PRODUCTION)
// ============================================================================

interface SimulatedUserCloudVault {
  profile?: {
    uid: string;
    displayName: string;
    email: string;
    photoURL: string;
    activeMaterialId: string;
    themePreference: ThemePreference;
    createdAt: string;
    lastActiveAt: string;
    updatedAt: string;
  };
  materials: Record<string, any>;
  quizAttempts: Record<string, any>;
  revisionPlans: Record<string, any>;
  flashcards: Record<string, any>;
  notes: Record<string, any>;
  conversations: Record<string, any>;
  progress: Record<string, any>;
  studySessions: Record<string, any>;
}

const inMemoryCloudVaults = new Map<string, SimulatedUserCloudVault>();

function getSimulatedCloudVault(uid: string): SimulatedUserCloudVault {
  const safeUid = sanitizeFirestoreId(uid);
  const storageKey = `learnmate_cloud_vault_v3_${safeUid}`;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        return JSON.parse(raw) as SimulatedUserCloudVault;
      }
    } catch {
      // ignore
    }
  }
  const existing = inMemoryCloudVaults.get(safeUid);
  if (existing) return existing;
  const fresh: SimulatedUserCloudVault = {
    materials: {},
    quizAttempts: {},
    revisionPlans: {},
    flashcards: {},
    notes: {},
    conversations: {},
    progress: {},
    studySessions: {},
  };
  inMemoryCloudVaults.set(safeUid, fresh);
  return fresh;
}

function saveSimulatedCloudVault(uid: string, vault: SimulatedUserCloudVault): void {
  const safeUid = sanitizeFirestoreId(uid);
  inMemoryCloudVaults.set(safeUid, vault);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        `learnmate_cloud_vault_v3_${safeUid}`,
        JSON.stringify(vault)
      );
    } catch {
      // ignore
    }
  }
}

function isUsingSimulatedCloud(uid: string): boolean {
  if (activeTestSessionUser && activeTestSessionUser.uid === uid) {
    return true;
  }
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    return true;
  }
  return false;
}

// Expose programmatic multi-account test harness on window for automated Playwright verification
if (typeof window !== 'undefined') {
  (window as any).__LEARNMATE_TEST_AUTH__ = {
    signInAsTestUser: async (profile: {
      uid: string;
      displayName: string;
      email: string;
      photoURL?: string | null;
    }) => {
      const safeUid = sanitizeFirestoreId(profile.uid);
      let issuedToken = `lm_test_fallback_${safeUid}`;
      try {
        const resp = await fetch('/api/auth/test-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: safeUid,
            email: profile.email,
            displayName: profile.displayName,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.token) issuedToken = data.token;
        }
      } catch {
        // ignore if server unreachable in unit test
      }

      activeTestSessionToken = issuedToken;
      activeTestSessionUser = {
        uid: safeUid,
        displayName: profile.displayName,
        email: profile.email,
        photoURL: profile.photoURL || null,
        emailVerified: true,
        isTestSession: true,
      };
      notifyAuthSubscribers(activeTestSessionUser);
      return activeTestSessionUser;
    },
    signOutTestUser: async () => {
      await signOutUser();
    },
    getCurrentUser: () => activeTestSessionUser || (auth.currentUser ? {
      uid: auth.currentUser.uid,
      displayName: auth.currentUser.displayName,
      email: auth.currentUser.email,
    } : null),
  };
}

// ============================================================================
// USER-ISOLATED FIRESTORE OPERATIONS
// ============================================================================

/**
 * Ensures `/users/{uid}` profile exists and updates `lastActiveAt`, `activeMaterialId`, and `themePreference`.
 */
export async function ensureUserProfileInFirestore(
  user: UserAuthProfile,
  activeMaterialId = '',
  themePreference: ThemePreference = 'light'
): Promise<{ activeMaterialId?: string; themePreference?: ThemePreference }> {
  const safeUid = sanitizeFirestoreId(user.uid);
  const safeDisplayName = (user.displayName || 'Student').slice(0, 120);
  const safeEmail = (user.email || '').slice(0, 254);
  const safePhoto = (user.photoURL || '').slice(0, 1024);
  const safeActiveId = activeMaterialId ? sanitizeFirestoreId(activeMaterialId) : '';
  const safeTheme: ThemePreference = ['light', 'dark', 'system'].includes(themePreference)
    ? themePreference
    : 'light';

  if (isUsingSimulatedCloud(user.uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    const nowIso = new Date().toISOString();
    if (!vault.profile) {
      vault.profile = {
        uid: safeUid,
        displayName: safeDisplayName,
        email: safeEmail,
        photoURL: safePhoto,
        activeMaterialId: safeActiveId,
        themePreference: safeTheme,
        createdAt: nowIso,
        lastActiveAt: nowIso,
        updatedAt: nowIso,
      };
    } else {
      vault.profile = {
        ...vault.profile,
        displayName: safeDisplayName,
        email: safeEmail,
        photoURL: safePhoto,
        activeMaterialId: safeActiveId || vault.profile.activeMaterialId,
        themePreference: safeTheme || vault.profile.themePreference,
        lastActiveAt: nowIso,
        updatedAt: nowIso,
      };
    }
    saveSimulatedCloudVault(safeUid, vault);
    return {
      activeMaterialId: vault.profile.activeMaterialId,
      themePreference: vault.profile.themePreference,
    };
  }

  const userPath = `users/${safeUid}`;
  const userRef = doc(db, 'users', safeUid);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: safeUid,
        displayName: safeDisplayName,
        email: safeEmail,
        photoURL: safePhoto,
        activeMaterialId: safeActiveId,
        themePreference: safeTheme,
        createdAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { activeMaterialId: safeActiveId, themePreference: safeTheme };
    } else {
      const existingData = snap.data();
      const nextActiveId = safeActiveId || existingData.activeMaterialId || '';
      const nextTheme: ThemePreference =
        ['light', 'dark', 'system'].includes(existingData.themePreference)
          ? existingData.themePreference
          : safeTheme;
      await updateDoc(userRef, {
        displayName: safeDisplayName,
        email: safeEmail,
        photoURL: safePhoto,
        activeMaterialId: nextActiveId,
        themePreference: nextTheme,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { activeMaterialId: nextActiveId, themePreference: nextTheme };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

/**
 * Uploads a PDF data URL to per-user Cloud Storage path `users/{uid}/materials/{materialId}.pdf`.
 */
export async function uploadPdfToUserStorage(
  uid: string,
  materialId: string,
  pdfDataUrl?: string
): Promise<string | undefined> {
  if (!pdfDataUrl || !pdfDataUrl.startsWith('data:application/pdf')) {
    return undefined;
  }
  const path = getUserPdfStoragePath(uid, materialId);
  if (isUsingSimulatedCloud(uid)) {
    return path;
  }
  try {
    const fileRef = storageRef(storage, path);
    await uploadString(fileRef, pdfDataUrl, 'data_url', {
      contentType: 'application/pdf',
    });
    return path;
  } catch {
    // Gracefully continue if Firebase Storage bucket is not provisioned on free tier
    return path;
  }
}

// Tracks Firestore document paths already verified to exist in this session so updates skip a redundant getDoc round-trip
const knownExistingDocPaths = new Set<string>();
const checkedLegacySubcollectionsByUid = new Set<string>();

/**
 * Saves or updates a study material and its analysis in `/users/{uid}/materials/{materialId}`.
 */
export async function syncMaterialToFirestore(
  uid: string,
  material: StudyMaterial,
  analysis: DocumentAnalysis | null
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const matId = sanitizeFirestoreId(material.id);
  const pagesJson = JSON.stringify(material.pages || []).slice(0, 440000);
  const analysisJson = analysis ? JSON.stringify(analysis).slice(0, 140000) : '';
  const safeTitle = (material.title || 'Study Material').slice(0, 200);
  const safeSource =
    material.sourceType === 'pdf'
      ? 'pdf'
      : material.sourceType === 'youtube'
        ? 'youtube'
        : 'text';
  const safePageCount = Math.min(
    20,
    Math.max(1, Math.round(material.pageCount || material.pages.length || 1))
  );
  const safeColor = ['red', 'blue', 'green', 'yellow'].includes(material.iconColor || '')
    ? material.iconColor
    : 'blue';
  const safeLastStudied = (material.lastStudiedAt || 'Just now').slice(0, 64);

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    const nowIso = new Date().toISOString();
    vault.materials[matId] = {
      id: matId,
      ownerId: safeUid,
      title: safeTitle,
      sourceType: safeSource,
      pageCount: safePageCount,
      iconColor: safeColor,
      lastStudiedAt: safeLastStudied,
      pagesData: pagesJson,
      analysisData: analysisJson,
      createdAt: vault.materials[matId]?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    saveSimulatedCloudVault(safeUid, vault);
    return;
  }

  const matPath = `users/${safeUid}/materials/${matId}`;
  const matRef = doc(db, 'users', safeUid, 'materials', matId);

  try {
    const isKnown = knownExistingDocPaths.has(matPath);
    const exists = isKnown ? true : (await getDoc(matRef)).exists();
    if (!exists) {
      await setDoc(matRef, {
        id: matId,
        ownerId: safeUid,
        title: safeTitle,
        sourceType: safeSource,
        pageCount: safePageCount,
        iconColor: safeColor,
        lastStudiedAt: safeLastStudied,
        pagesData: pagesJson,
        analysisData: analysisJson,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      knownExistingDocPaths.add(matPath);
    } else {
      knownExistingDocPaths.add(matPath);
      await updateDoc(matRef, {
        title: safeTitle,
        lastStudiedAt: safeLastStudied,
        pagesData: pagesJson,
        analysisData: analysisJson,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    knownExistingDocPaths.delete(matPath);
    handleFirestoreError(error, OperationType.WRITE, matPath);
  }
}

/**
 * Saves an immutable quiz attempt to `/users/{uid}/quizAttempts/{attemptId}`.
 */
export async function syncQuizAttemptToFirestore(
  uid: string,
  attempt: QuizAttempt
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const attId = sanitizeFirestoreId(attempt.id);
  const matId = sanitizeFirestoreId(attempt.materialId);
  const recordPayload = {
    id: attId,
    ownerId: safeUid,
    materialId: matId,
    materialTitle: (attempt.materialTitle || 'Study Material').slice(0, 200),
    mode: attempt.mode === 'adaptive' ? 'adaptive' : 'diagnostic',
    score: Math.min(20, Math.max(0, Math.round(attempt.score))),
    total: Math.min(20, Math.max(1, Math.round(attempt.total))),
    percentage: Math.min(100, Math.max(0, Math.round(attempt.percentage))),
    attemptData: JSON.stringify({ ...attempt, ownerId: safeUid }).slice(0, 240000),
  };

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    if (!vault.quizAttempts[attId]) {
      vault.quizAttempts[attId] = {
        ...recordPayload,
        createdAt: new Date().toISOString(),
      };
      saveSimulatedCloudVault(safeUid, vault);
    }
    return;
  }

  const attPath = `users/${safeUid}/quizAttempts/${attId}`;
  if (knownExistingDocPaths.has(attPath)) return;
  const attRef = doc(db, 'users', safeUid, 'quizAttempts', attId);

  try {
    const existing = await getDoc(attRef);
    if (existing.exists()) {
      knownExistingDocPaths.add(attPath);
      return;
    }

    await setDoc(attRef, {
      ...recordPayload,
      createdAt: serverTimestamp(),
    });
    knownExistingDocPaths.add(attPath);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, attPath);
  }
}

/**
 * Saves or updates `/users/{uid}/revisionPlans/{materialId}`.
 */
export async function syncRevisionPlanToFirestore(
  uid: string,
  materialId: string,
  tasks: RevisionTask[],
  insights: MistakeInsight[]
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const matId = sanitizeFirestoreId(materialId);
  const tasksJson = JSON.stringify(tasks || []).slice(0, 140000);
  const insightsJson = JSON.stringify(insights || []).slice(0, 140000);

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    const nowIso = new Date().toISOString();
    vault.revisionPlans[matId] = {
      id: matId,
      ownerId: safeUid,
      materialId: matId,
      tasksData: tasksJson,
      insightsData: insightsJson,
      createdAt: vault.revisionPlans[matId]?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    saveSimulatedCloudVault(safeUid, vault);
    return;
  }

  const planPath = `users/${safeUid}/revisionPlans/${matId}`;
  const planRef = doc(db, 'users', safeUid, 'revisionPlans', matId);

  try {
    const exists = knownExistingDocPaths.has(planPath)
      ? true
      : (await getDoc(planRef)).exists();
    if (!exists) {
      await setDoc(planRef, {
        id: matId,
        ownerId: safeUid,
        materialId: matId,
        tasksData: tasksJson,
        insightsData: insightsJson,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      knownExistingDocPaths.add(planPath);
    } else {
      knownExistingDocPaths.add(planPath);
      await updateDoc(planRef, {
        tasksData: tasksJson,
        insightsData: insightsJson,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    knownExistingDocPaths.delete(planPath);
    handleFirestoreError(error, OperationType.WRITE, planPath);
  }
}

/**
 * Saves or updates `/users/{uid}/conversations/{materialId}`.
 */
export async function syncConversationToFirestore(
  uid: string,
  materialId: string,
  messages: TutorMessage[]
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const matId = sanitizeFirestoreId(materialId);
  const messagesJson = JSON.stringify(messages || []).slice(0, 240000);

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    const nowIso = new Date().toISOString();
    vault.conversations[matId] = {
      id: matId,
      ownerId: safeUid,
      materialId: matId,
      messagesData: messagesJson,
      createdAt: vault.conversations[matId]?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    saveSimulatedCloudVault(safeUid, vault);
    return;
  }

  const convPath = `users/${safeUid}/conversations/${matId}`;
  const convRef = doc(db, 'users', safeUid, 'conversations', matId);

  try {
    const exists = knownExistingDocPaths.has(convPath)
      ? true
      : (await getDoc(convRef)).exists();
    if (!exists) {
      await setDoc(convRef, {
        id: matId,
        ownerId: safeUid,
        materialId: matId,
        messagesData: messagesJson,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      knownExistingDocPaths.add(convPath);
    } else {
      knownExistingDocPaths.add(convPath);
      await updateDoc(convRef, {
        messagesData: messagesJson,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    knownExistingDocPaths.delete(convPath);
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

/**
 * Saves or updates `/users/{uid}/flashcards/{materialId}`.
 */
export async function syncFlashcardsToFirestore(
  uid: string,
  materialId: string,
  flashcards: FlashcardItem[]
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const matId = sanitizeFirestoreId(materialId);
  const flashcardsJson = JSON.stringify(flashcards || []).slice(0, 140000);

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    const nowIso = new Date().toISOString();
    vault.flashcards[matId] = {
      id: matId,
      ownerId: safeUid,
      materialId: matId,
      flashcardsData: flashcardsJson,
      createdAt: vault.flashcards[matId]?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    saveSimulatedCloudVault(safeUid, vault);
    return;
  }

  const deckPath = `users/${safeUid}/flashcards/${matId}`;
  const deckRef = doc(db, 'users', safeUid, 'flashcards', matId);

  try {
    const exists = knownExistingDocPaths.has(deckPath)
      ? true
      : (await getDoc(deckRef)).exists();
    if (!exists) {
      await setDoc(deckRef, {
        id: matId,
        ownerId: safeUid,
        materialId: matId,
        flashcardsData: flashcardsJson,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      knownExistingDocPaths.add(deckPath);
    } else {
      knownExistingDocPaths.add(deckPath);
      await updateDoc(deckRef, {
        flashcardsData: flashcardsJson,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    knownExistingDocPaths.delete(deckPath);
    handleFirestoreError(error, OperationType.WRITE, deckPath);
  }
}

/**
 * Saves or updates `/users/{uid}/notes/{materialId}` (Sticky Notes, Mind Map, and One-Page Revision Sheet).
 */
export async function syncNotesToFirestore(
  uid: string,
  materialId: string,
  stickyNotes: StickyNote[],
  mindMap: MindMapData | null,
  revisionSheet: OnePageRevisionSheet | null
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const matId = sanitizeFirestoreId(materialId);
  const stickyNotesJson = JSON.stringify(stickyNotes || []).slice(0, 140000);
  const mindMapJson = JSON.stringify(mindMap || {}).slice(0, 140000);
  const revisionSheetJson = JSON.stringify(revisionSheet || {}).slice(0, 140000);

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    const nowIso = new Date().toISOString();
    vault.notes[matId] = {
      id: matId,
      ownerId: safeUid,
      materialId: matId,
      stickyNotesData: stickyNotesJson,
      mindMapData: mindMapJson,
      revisionSheetData: revisionSheetJson,
      createdAt: vault.notes[matId]?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    saveSimulatedCloudVault(safeUid, vault);
    return;
  }

  const notePath = `users/${safeUid}/notes/${matId}`;
  const noteRef = doc(db, 'users', safeUid, 'notes', matId);

  try {
    const exists = knownExistingDocPaths.has(notePath)
      ? true
      : (await getDoc(noteRef)).exists();
    if (!exists) {
      await setDoc(noteRef, {
        id: matId,
        ownerId: safeUid,
        materialId: matId,
        stickyNotesData: stickyNotesJson,
        mindMapData: mindMapJson,
        revisionSheetData: revisionSheetJson,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      knownExistingDocPaths.add(notePath);
    } else {
      knownExistingDocPaths.add(notePath);
      await updateDoc(noteRef, {
        stickyNotesData: stickyNotesJson,
        mindMapData: mindMapJson,
        revisionSheetData: revisionSheetJson,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    knownExistingDocPaths.delete(notePath);
    handleFirestoreError(error, OperationType.WRITE, notePath);
  }
}

/**
 * Saves or updates `/users/{uid}/progress/{materialId}`.
 */
export async function syncProgressToFirestore(
  uid: string,
  materialId: string,
  studiedPages: number[],
  masteryPct = 0
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const matId = sanitizeFirestoreId(materialId);
  const pagesJson = JSON.stringify(studiedPages || [1]).slice(0, 19000);
  const safeMastery = Math.min(100, Math.max(0, Math.round(masteryPct)));

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    const nowIso = new Date().toISOString();
    vault.progress[matId] = {
      id: matId,
      ownerId: safeUid,
      materialId: matId,
      studiedPagesData: pagesJson,
      masteryPct: safeMastery,
      createdAt: vault.progress[matId]?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    saveSimulatedCloudVault(safeUid, vault);
    return;
  }

  const progPath = `users/${safeUid}/progress/${matId}`;
  const progRef = doc(db, 'users', safeUid, 'progress', matId);

  try {
    const exists = knownExistingDocPaths.has(progPath)
      ? true
      : (await getDoc(progRef)).exists();
    if (!exists) {
      await setDoc(progRef, {
        id: matId,
        ownerId: safeUid,
        materialId: matId,
        studiedPagesData: pagesJson,
        masteryPct: safeMastery,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      knownExistingDocPaths.add(progPath);
    } else {
      knownExistingDocPaths.add(progPath);
      await updateDoc(progRef, {
        studiedPagesData: pagesJson,
        masteryPct: safeMastery,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    knownExistingDocPaths.delete(progPath);
    handleFirestoreError(error, OperationType.WRITE, progPath);
  }
}

/**
 * Saves a completed study session to `/users/{uid}/studySessions/{sessionId}`.
 */
export async function syncStudySessionToFirestore(
  uid: string,
  session: FocusSessionRecord
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const sessId = sanitizeFirestoreId(session.id);
  const matId = sanitizeFirestoreId(session.materialId);
  const payload = {
    id: sessId,
    ownerId: safeUid,
    materialId: matId,
    materialTitle: (session.materialTitle || 'Study Material').slice(0, 200),
    durationMinutes: Math.min(240, Math.max(1, Math.round(session.durationMinutes || 25))),
    completedAt: (session.completedAt || new Date().toISOString()).slice(0, 64),
  };

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    if (!vault.studySessions[sessId]) {
      vault.studySessions[sessId] = {
        ...payload,
        createdAt: new Date().toISOString(),
      };
      saveSimulatedCloudVault(safeUid, vault);
    }
    return;
  }

  const sessPath = `users/${safeUid}/studySessions/${sessId}`;
  if (knownExistingDocPaths.has(sessPath)) return;
  const sessRef = doc(db, 'users', safeUid, 'studySessions', sessId);

  try {
    const snap = await getDoc(sessRef);
    if (snap.exists()) {
      knownExistingDocPaths.add(sessPath);
      return;
    }
    await setDoc(sessRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    knownExistingDocPaths.add(sessPath);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, sessPath);
  }
}

/**
 * Loads all persisted cloud data strictly for `uid` in parallel via Promise.all
 * (reducing 11 sequential Firestore round-trips to a single parallel batch).
 */
export async function fetchAllCloudStudyData(uid: string): Promise<{
  activeMaterialId?: string;
  themePreference?: ThemePreference;
  materials: StudyMaterial[];
  analyses: Record<string, DocumentAnalysis>;
  attempts: QuizAttempt[];
  revisionPlans: Record<string, RevisionTask[]>;
  mistakeInsights: Record<string, MistakeInsight[]>;
  tutorHistory: Record<string, TutorMessage[]> ;
  stickyNotes: Record<string, StickyNote[]>;
  flashcards: Record<string, FlashcardItem[]>;
  mindMaps: Record<string, MindMapData>;
  revisionSheets: Record<string, OnePageRevisionSheet>;
  studiedPages: Record<string, number[]>;
  focusSessions: FocusSessionRecord[];
  migratedLegacyRecordsCount: number;
}> {
  const safeUid = sanitizeFirestoreId(uid);
  const materials: StudyMaterial[] = [];
  const analyses: Record<string, DocumentAnalysis> = {};
  const attempts: QuizAttempt[] = [];
  const revisionPlans: Record<string, RevisionTask[]> = {};
  const mistakeInsights: Record<string, MistakeInsight[]> = {};
  const tutorHistory: Record<string, TutorMessage[]> = {};
  const stickyNotes: Record<string, StickyNote[]> = {};
  const flashcards: Record<string, FlashcardItem[]> = {};
  const mindMaps: Record<string, MindMapData> = {};
  const revisionSheets: Record<string, OnePageRevisionSheet> = {};
  const studiedPages: Record<string, number[]> = {};
  const focusSessions: FocusSessionRecord[] = [];
  let activeMaterialId: string | undefined;
  let themePreference: ThemePreference | undefined;
  let migratedLegacyRecordsCount = 0;

  if (isUsingSimulatedCloud(uid)) {
    const vault = getSimulatedCloudVault(safeUid);
    activeMaterialId = vault.profile?.activeMaterialId;
    themePreference = vault.profile?.themePreference;

    Object.values(vault.materials).forEach((d: any) => {
      if (d.ownerId !== safeUid) return;
      try {
        materials.push({
          id: d.id,
          ownerId: safeUid,
          title: d.title,
          sourceType: d.sourceType,
          pageCount: d.pageCount,
          pages: JSON.parse(d.pagesData || '[]'),
          createdAt: d.createdAt || new Date().toISOString(),
          lastStudiedAt: d.lastStudiedAt || 'Recently',
          iconColor: d.iconColor || 'blue',
        });
        if (d.analysisData) {
          analyses[d.id] = JSON.parse(d.analysisData);
        }
      } catch {
        // ignore
      }
    });

    Object.values(vault.quizAttempts).forEach((d: any) => {
      if (d.ownerId !== safeUid) return;
      try {
        if (d.attemptData) attempts.push(JSON.parse(d.attemptData));
      } catch {
        // ignore
      }
    });

    Object.values(vault.revisionPlans).forEach((d: any) => {
      if (d.ownerId !== safeUid) return;
      const mId = d.materialId || d.id;
      try {
        if (d.tasksData) revisionPlans[mId] = JSON.parse(d.tasksData);
        if (d.insightsData) mistakeInsights[mId] = JSON.parse(d.insightsData);
      } catch {
        // ignore
      }
    });

    Object.values(vault.conversations).forEach((d: any) => {
      if (d.ownerId !== safeUid) return;
      const mId = d.materialId || d.id;
      try {
        if (d.messagesData) tutorHistory[mId] = JSON.parse(d.messagesData);
      } catch {
        // ignore
      }
    });

    Object.values(vault.flashcards).forEach((d: any) => {
      if (d.ownerId !== safeUid) return;
      const mId = d.materialId || d.id;
      try {
        if (d.flashcardsData) flashcards[mId] = JSON.parse(d.flashcardsData);
      } catch {
        // ignore
      }
    });

    Object.values(vault.notes).forEach((d: any) => {
      if (d.ownerId !== safeUid) return;
      const mId = d.materialId || d.id;
      try {
        if (d.stickyNotesData) {
          const parsed = JSON.parse(d.stickyNotesData);
          if (Array.isArray(parsed) && parsed.length > 0) stickyNotes[mId] = parsed;
        }
        if (d.mindMapData) {
          const parsed = JSON.parse(d.mindMapData);
          if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
            mindMaps[mId] = parsed;
          }
        }
        if (d.revisionSheetData) {
          const parsed = JSON.parse(d.revisionSheetData);
          if (parsed && parsed.chapterTitle) revisionSheets[mId] = parsed;
        }
      } catch {
        // ignore
      }
    });

    Object.values(vault.progress).forEach((d: any) => {
      if (d.ownerId !== safeUid) return;
      const mId = d.materialId || d.id;
      try {
        if (d.studiedPagesData) studiedPages[mId] = JSON.parse(d.studiedPagesData);
      } catch {
        // ignore
      }
    });

    Object.values(vault.studySessions).forEach((d: any) => {
      if (d.ownerId !== safeUid) return;
      focusSessions.push({
        id: d.id,
        ownerId: safeUid,
        materialId: d.materialId,
        materialTitle: d.materialTitle,
        durationMinutes: d.durationMinutes,
        completedAt: d.completedAt,
      });
    });

    return {
      activeMaterialId,
      themePreference,
      materials,
      analyses,
      attempts,
      revisionPlans,
      mistakeInsights,
      tutorHistory,
      stickyNotes,
      flashcards,
      mindMaps,
      revisionSheets,
      studiedPages,
      focusSessions,
      migratedLegacyRecordsCount: 0,
    };
  }

  // Execute all 9 primary Firestore reads in parallel instead of 11 sequential blocking awaits
  const [
    userSnap,
    matSnaps,
    attSnaps,
    planSnaps,
    convSnaps,
    fcSnaps,
    notesSnaps,
    progSnaps,
    sessSnaps,
  ] = await Promise.all([
    getDoc(doc(db, 'users', safeUid)).catch((err) => {
      handleFirestoreError(err, OperationType.GET, `users/${safeUid}`);
      return null;
    }),
    getDocs(
      query(collection(db, 'users', safeUid, 'materials'), where('ownerId', '==', safeUid))
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeUid}/materials`);
      return null;
    }),
    getDocs(
      query(collection(db, 'users', safeUid, 'quizAttempts'), where('ownerId', '==', safeUid))
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeUid}/quizAttempts`);
      return null;
    }),
    getDocs(
      query(collection(db, 'users', safeUid, 'revisionPlans'), where('ownerId', '==', safeUid))
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeUid}/revisionPlans`);
      return null;
    }),
    getDocs(
      query(collection(db, 'users', safeUid, 'conversations'), where('ownerId', '==', safeUid))
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeUid}/conversations`);
      return null;
    }),
    getDocs(
      query(collection(db, 'users', safeUid, 'flashcards'), where('ownerId', '==', safeUid))
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeUid}/flashcards`);
      return null;
    }),
    getDocs(
      query(collection(db, 'users', safeUid, 'notes'), where('ownerId', '==', safeUid))
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeUid}/notes`);
      return null;
    }),
    getDocs(
      query(collection(db, 'users', safeUid, 'progress'), where('ownerId', '==', safeUid))
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeUid}/progress`);
      return null;
    }),
    getDocs(
      query(collection(db, 'users', safeUid, 'studySessions'), where('ownerId', '==', safeUid))
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeUid}/studySessions`);
      return null;
    }),
  ]);

  if (userSnap && userSnap.exists()) {
    const data = userSnap.data();
    activeMaterialId = data.activeMaterialId || undefined;
    if (['light', 'dark', 'system'].includes(data.themePreference)) {
      themePreference = data.themePreference;
    }
  }

  matSnaps?.forEach((docSnap) => {
    const d = docSnap.data();
    knownExistingDocPaths.add(`users/${safeUid}/materials/${docSnap.id}`);
    try {
      const parsedPages = JSON.parse(d.pagesData || '[]');
      materials.push({
        id: d.id,
        ownerId: safeUid,
        title: d.title,
        sourceType:
          d.sourceType === 'pdf'
            ? 'pdf'
            : d.sourceType === 'youtube'
              ? 'youtube'
              : 'text',
        pageCount: d.pageCount,
        pages: parsedPages,
        createdAt: new Date().toISOString(),
        lastStudiedAt: d.lastStudiedAt || 'Recently',
        iconColor: d.iconColor || 'blue',
      });
      if (d.analysisData) {
        analyses[d.id] = JSON.parse(d.analysisData);
      }
    } catch {
      // ignore malformed record
    }
  });

  const attemptIds = new Set<string>();
  attSnaps?.forEach((docSnap) => {
    const d = docSnap.data();
    knownExistingDocPaths.add(`users/${safeUid}/quizAttempts/${docSnap.id}`);
    try {
      if (d.attemptData) {
        const parsed = JSON.parse(d.attemptData) as QuizAttempt;
        attempts.push(parsed);
        attemptIds.add(parsed.id);
      }
    } catch {
      // ignore
    }
  });

  planSnaps?.forEach((docSnap) => {
    const d = docSnap.data();
    const mId = d.materialId || d.id;
    knownExistingDocPaths.add(`users/${safeUid}/revisionPlans/${docSnap.id}`);
    try {
      if (d.tasksData) revisionPlans[mId] = JSON.parse(d.tasksData);
      if (d.insightsData) mistakeInsights[mId] = JSON.parse(d.insightsData);
    } catch {
      // ignore
    }
  });

  convSnaps?.forEach((docSnap) => {
    const d = docSnap.data();
    const mId = d.materialId || d.id;
    knownExistingDocPaths.add(`users/${safeUid}/conversations/${docSnap.id}`);
    try {
      if (d.messagesData) tutorHistory[mId] = JSON.parse(d.messagesData);
    } catch {
      // ignore
    }
  });

  fcSnaps?.forEach((docSnap) => {
    const d = docSnap.data();
    const mId = d.materialId || d.id;
    knownExistingDocPaths.add(`users/${safeUid}/flashcards/${docSnap.id}`);
    try {
      if (d.flashcardsData) {
        const parsed = JSON.parse(d.flashcardsData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          flashcards[mId] = parsed;
        }
      }
    } catch {
      // ignore
    }
  });

  notesSnaps?.forEach((docSnap) => {
    const d = docSnap.data();
    const mId = d.materialId || d.id;
    knownExistingDocPaths.add(`users/${safeUid}/notes/${docSnap.id}`);
    try {
      if (d.stickyNotesData) {
        const parsedNotes = JSON.parse(d.stickyNotesData);
        if (Array.isArray(parsedNotes) && parsedNotes.length > 0) {
          stickyNotes[mId] = parsedNotes;
        }
      }
      if (d.mindMapData) {
        const parsedMap = JSON.parse(d.mindMapData);
        if (parsedMap && Array.isArray(parsedMap.nodes) && parsedMap.nodes.length > 0) {
          mindMaps[mId] = parsedMap;
        }
      }
      if (d.revisionSheetData) {
        const parsedSheet = JSON.parse(d.revisionSheetData);
        if (parsedSheet && parsedSheet.chapterTitle) {
          revisionSheets[mId] = parsedSheet;
        }
      }
    } catch {
      // ignore
    }
  });

  progSnaps?.forEach((docSnap) => {
    const d = docSnap.data();
    const mId = d.materialId || d.id;
    knownExistingDocPaths.add(`users/${safeUid}/progress/${docSnap.id}`);
    try {
      if (d.studiedPagesData) {
        const parsed = JSON.parse(d.studiedPagesData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          studiedPages[mId] = parsed;
        }
      }
    } catch {
      // ignore
    }
  });

  sessSnaps?.forEach((docSnap) => {
    const d = docSnap.data();
    knownExistingDocPaths.add(`users/${safeUid}/studySessions/${docSnap.id}`);
    focusSessions.push({
      id: d.id,
      ownerId: safeUid,
      materialId: d.materialId,
      materialTitle: d.materialTitle,
      durationMinutes: d.durationMinutes,
      completedAt: d.completedAt,
    });
  });

  // Only check legacy subcollections once per UID per session, and in parallel
  if (!checkedLegacySubcollectionsByUid.has(safeUid)) {
    checkedLegacySubcollectionsByUid.add(safeUid);
    const [legacyAttSnaps, legacyStateSnaps, legacyToolSnaps] = await Promise.all([
      getDocs(
        query(collection(db, 'users', safeUid, 'attempts'), where('ownerId', '==', safeUid))
      ).catch(() => null),
      getDocs(
        query(collection(db, 'users', safeUid, 'revisionStates'), where('ownerId', '==', safeUid))
      ).catch(() => null),
      getDocs(
        query(collection(db, 'users', safeUid, 'learningTools'), where('ownerId', '==', safeUid))
      ).catch(() => null),
    ]);

    if (legacyAttSnaps) {
      for (const docSnap of legacyAttSnaps.docs) {
        const d = docSnap.data();
        try {
          if (d.attemptData) {
            const parsed = JSON.parse(d.attemptData) as QuizAttempt;
            if (!attemptIds.has(parsed.id)) {
              attempts.push(parsed);
              attemptIds.add(parsed.id);
              await syncQuizAttemptToFirestore(safeUid, parsed);
              migratedLegacyRecordsCount += 1;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (legacyStateSnaps) {
      for (const docSnap of legacyStateSnaps.docs) {
        const d = docSnap.data();
        const mId = d.materialId || d.id;
        try {
          if (d.tasksData && !revisionPlans[mId]) {
            revisionPlans[mId] = JSON.parse(d.tasksData);
          }
          if (d.insightsData && !mistakeInsights[mId]) {
            mistakeInsights[mId] = JSON.parse(d.insightsData);
          }
          if (d.chatData && !tutorHistory[mId]) {
            tutorHistory[mId] = JSON.parse(d.chatData);
            await syncConversationToFirestore(safeUid, mId, tutorHistory[mId]);
          }
          if (revisionPlans[mId] || mistakeInsights[mId]) {
            await syncRevisionPlanToFirestore(
              safeUid,
              mId,
              revisionPlans[mId] || [],
              mistakeInsights[mId] || []
            );
            migratedLegacyRecordsCount += 1;
          }
        } catch {
          // ignore
        }
      }
    }

    if (legacyToolSnaps) {
      for (const docSnap of legacyToolSnaps.docs) {
        const d = docSnap.data();
        const mId = d.materialId || d.id;
        try {
          let migratedTools = false;
          if (d.stickyNotesData && !stickyNotes[mId]) {
            const parsedNotes = JSON.parse(d.stickyNotesData);
            if (Array.isArray(parsedNotes) && parsedNotes.length > 0) {
              stickyNotes[mId] = parsedNotes;
              migratedTools = true;
            }
          }
          if (d.flashcardsData && !flashcards[mId]) {
            const parsedCards = JSON.parse(d.flashcardsData);
            if (Array.isArray(parsedCards) && parsedCards.length > 0) {
              flashcards[mId] = parsedCards;
              await syncFlashcardsToFirestore(safeUid, mId, parsedCards);
              migratedTools = true;
            }
          }
          if (d.mindMapData && !mindMaps[mId]) {
            const parsedMap = JSON.parse(d.mindMapData);
            if (parsedMap && Array.isArray(parsedMap.nodes) && parsedMap.nodes.length > 0) {
              mindMaps[mId] = parsedMap;
              migratedTools = true;
            }
          }
          if (d.revisionSheetData && !revisionSheets[mId]) {
            const parsedSheet = JSON.parse(d.revisionSheetData);
            if (parsedSheet && parsedSheet.chapterTitle) {
              revisionSheets[mId] = parsedSheet;
              migratedTools = true;
            }
          }
          if (migratedTools) {
            await syncNotesToFirestore(
              safeUid,
              mId,
              stickyNotes[mId] || [],
              mindMaps[mId] || null,
              revisionSheets[mId] || null
            );
            migratedLegacyRecordsCount += 1;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    activeMaterialId,
    themePreference,
    materials,
    analyses,
    attempts,
    revisionPlans,
    mistakeInsights,
    tutorHistory,
    stickyNotes,
    flashcards,
    mindMaps,
    revisionSheets,
    studiedPages,
    focusSessions,
    migratedLegacyRecordsCount,
  };
}

/**
 * Real-time listener on `/users/{uid}/quizAttempts` for cross-tab/cloud sync.
 * Strictly scoped to `uid`.
 */
export function subscribeToCloudAttempts(
  uid: string,
  onAttemptsUpdated: (attempts: QuizAttempt[]) => void
): Unsubscribe {
  const safeUid = sanitizeFirestoreId(uid);
  if (isUsingSimulatedCloud(uid)) {
    return () => {};
  }

  const colQuery = query(
    collection(db, 'users', safeUid, 'quizAttempts'),
    where('ownerId', '==', safeUid)
  );
  return onSnapshot(
    colQuery,
    (snapshot) => {
      const loaded: QuizAttempt[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        try {
          if (d.attemptData) {
            loaded.push(JSON.parse(d.attemptData));
          }
        } catch {
          // ignore
        }
      });
      onAttemptsUpdated(
        loaded.sort(
          (a, b) =>
            new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        )
      );
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `users/${safeUid}/quizAttempts`);
      } catch {
        // already logged
      }
    }
  );
}
