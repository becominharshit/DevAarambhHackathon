import crypto from 'crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase Admin SDK with the project ID from firebase-applet-config.json.
// verifyIdToken() validates RS256 signatures against Google's public securetoken certificates.
const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        projectId: firebaseConfig.projectId,
      });

export const adminAuth = getAuth(adminApp);

// Per-process HMAC secret used strictly for non-production automated browser/integration test tokens
const LOCAL_TEST_HMAC_SECRET = crypto.randomBytes(32).toString('hex');

export interface VerifiedAuthResult {
  authorized: boolean;
  status: number;
  httpStatus: number;
  uid?: string;
  email?: string;
  error?: string;
  code?: string;
}

export function createSignedTestToken(
  uidOrOpts: string | { uid: string; email?: string; name?: string; expiresInMs?: number },
  emailArg?: string,
  expiresInMsArg = 60 * 60 * 1000
): string {
  const uid = typeof uidOrOpts === 'string' ? uidOrOpts : uidOrOpts.uid;
  const email =
    typeof uidOrOpts === 'string'
      ? emailArg || `${uid}@example.com`
      : uidOrOpts.email || `${uid}@example.com`;
  const expiresInMs =
    typeof uidOrOpts === 'string'
      ? expiresInMsArg
      : uidOrOpts.expiresInMs ?? 60 * 60 * 1000;

  const payload = {
    uid,
    email,
    email_verified: true,
    exp: Date.now() + expiresInMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', LOCAL_TEST_HMAC_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return `lm_test_v1.${payloadB64}.${sig}`;
}

export function verifySignedTestToken(token: string): {
  valid: boolean;
  uid?: string;
  email?: string;
  error?: string;
} {
  if (!token.startsWith('lm_test_v1.')) {
    return { valid: false, error: 'Not a signed test token.' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed test token structure.' };
  }
  const [, payloadB64, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', LOCAL_TEST_HMAC_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, error: 'Invalid token cryptographic signature.' };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!parsed.uid || typeof parsed.uid !== 'string') {
      return { valid: false, error: 'Token missing uid.' };
    }
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return { valid: false, error: 'Token has expired.' };
    }
    return {
      valid: true,
      uid: parsed.uid,
      email: parsed.email,
    };
  } catch {
    return { valid: false, error: 'Invalid token payload encoding.' };
  }
}

/**
 * Verifies the Authorization Bearer token using Firebase Admin SDK (or HMAC test token in non-production)
 * and enforces that any client-supplied userId/ownerId/uid in the body matches the verified token UID.
 */
export async function verifyServerRequestAuthorization(params: {
  authorizationHeader?: string;
  body?: Record<string, any> | null;
  suppliedUserId?: string | null;
  allowTestTokens?: boolean;
}): Promise<VerifiedAuthResult> {
  const {
    authorizationHeader,
    body,
    suppliedUserId,
    allowTestTokens = process.env.NODE_ENV !== 'production',
  } = params;

  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return {
      authorized: false,
      status: 401,
      httpStatus: 401,
      code: 'MISSING_AUTH_HEADER',
      error: 'Authentication required: missing Authorization Bearer token.',
    };
  }

  const trimmed = authorizationHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return {
      authorized: false,
      status: 401,
      httpStatus: 401,
      code: 'INVALID_AUTH_SCHEME',
      error: 'Authentication required: Authorization header must use Bearer scheme.',
    };
  }

  const rawToken = trimmed.slice(7).trim();
  if (!rawToken) {
    return {
      authorized: false,
      status: 401,
      httpStatus: 401,
      code: 'EMPTY_TOKEN',
      error: 'Authentication required: empty Bearer token.',
    };
  }

  let verifiedUid: string | undefined;
  let verifiedEmail: string | undefined;

  if (allowTestTokens && rawToken.startsWith('lm_test_v1.')) {
    const testRes = verifySignedTestToken(rawToken);
    if (!testRes.valid || !testRes.uid) {
      return {
        authorized: false,
        status: 401,
        httpStatus: 401,
        code: 'INVALID_TEST_TOKEN',
        error: testRes.error || 'Invalid or expired authentication token.',
      };
    }
    verifiedUid = testRes.uid;
    verifiedEmail = testRes.email;
  } else {
    try {
      const decoded = await adminAuth.verifyIdToken(rawToken, false);
      verifiedUid = decoded.uid;
      verifiedEmail = decoded.email;
    } catch {
      return {
        authorized: false,
        status: 401,
        httpStatus: 401,
        code: 'INVALID_ID_TOKEN',
        error: 'Invalid or expired Firebase ID token.',
      };
    }
  }

  if (!verifiedUid) {
    return {
      authorized: false,
      status: 401,
      httpStatus: 401,
      code: 'MISSING_UID',
      error: 'Could not derive user UID from authentication token.',
    };
  }

  // Enforce strict anti-spoofing: if the client payload includes userId, uid, or ownerId,
  // it MUST match the UID derived from the verified token.
  const claimedUserId =
    suppliedUserId ??
    (body && typeof body === 'object' ? body.userId ?? body.uid ?? body.ownerId : undefined);
  if (
    typeof claimedUserId === 'string' &&
    claimedUserId.trim().length > 0 &&
    claimedUserId.trim() !== verifiedUid
  ) {
    return {
      authorized: false,
      status: 403,
      httpStatus: 403,
      code: 'UID_MISMATCH',
      error:
        'Cross-account access denied: client-supplied userId does not match verified token UID.',
    };
  }

  return {
    authorized: true,
    status: 200,
    httpStatus: 200,
    code: 'OK',
    uid: verifiedUid,
    email: verifiedEmail,
  };
}

// ============================================================================
// DETERMINISTIC FIRESTORE & STORAGE SECURITY RULE VERIFIER (FOR SECURITY TDD)
// ============================================================================

export interface SimulatedAuthContext {
  uid: string;
  email?: string;
  email_verified?: boolean;
}

export interface SimulatedRuleRequest {
  auth: SimulatedAuthContext | null;
  path: string; // e.g., "/users/uid_a" or "/users/uid_a/materials/mat_1"
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  requestTimeIso?: string;
  incomingData?: Record<string, any> | null;
  existingData?: Record<string, any> | null;
  existingPaths?: Set<string>;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function isValidRuleId(id: unknown): boolean {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= 128 &&
    VALID_ID_REGEX.test(id)
  );
}

function hasExactKeys(
  data: Record<string, any>,
  requiredKeys: string[],
  allowedKeys: string[]
): boolean {
  const keys = Object.keys(data);
  for (const req of requiredKeys) {
    if (!(req in data)) return false;
  }
  for (const k of keys) {
    if (!allowedKeys.includes(k)) return false;
  }
  return true;
}

/**
 * Evaluates a Firestore operation against LearnMate's exact security rule invariants.
 * Returns { allowed: boolean, reason: string }.
 */
export function evaluateFirestoreSecurityRule(req: SimulatedRuleRequest): {
  allowed: boolean;
  reason: string;
} {
  const {
    auth,
    path,
    operation,
    requestTimeIso = '2026-10-23T18:00:00.000Z',
    incomingData,
    existingData,
    existingPaths = new Set<string>(),
  } = req;

  const segments = path.replace(/^\/+|\/+$/g, '').split('/');

  // Global Default Deny unless under /users/{userId}
  if (segments[0] !== 'users' || segments.length < 2) {
    return { allowed: false, reason: 'PERMISSION_DENIED: Global default deny' };
  }

  if (!auth || !auth.uid) {
    return { allowed: false, reason: 'PERMISSION_DENIED: Unauthenticated request' };
  }

  const userId = segments[1];
  if (auth.uid !== userId) {
    return {
      allowed: false,
      reason: 'PERMISSION_DENIED: Cross-account access forbidden (request.auth.uid != userId)',
    };
  }

  // /users/{userId}
  if (segments.length === 2) {
    if (operation === 'list') {
      return { allowed: false, reason: 'PERMISSION_DENIED: Listing /users is forbidden' };
    }
    if (operation === 'delete') {
      return { allowed: false, reason: 'PERMISSION_DENIED: Deleting user profile is forbidden' };
    }
    if (!isValidRuleId(userId)) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Invalid userId path parameter' };
    }
    if (operation === 'get') {
      return { allowed: true, reason: 'ALLOWED: Owner profile get' };
    }
    if (auth.email_verified !== true) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Email not verified' };
    }
    if (!incomingData) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Missing incoming payload' };
    }
    const profileKeys = [
      'uid',
      'displayName',
      'email',
      'photoURL',
      'activeMaterialId',
      'themePreference',
      'createdAt',
      'lastActiveAt',
      'updatedAt',
    ];
    if (!hasExactKeys(incomingData, profileKeys, profileKeys)) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Invalid or shadow keys on UserProfile' };
    }
    if (incomingData.uid !== auth.uid || incomingData.uid !== userId || !isValidRuleId(incomingData.uid)) {
      return { allowed: false, reason: 'PERMISSION_DENIED: UserProfile uid mismatch' };
    }
    if (
      typeof incomingData.displayName !== 'string' ||
      incomingData.displayName.length < 1 ||
      incomingData.displayName.length > 120
    ) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Invalid displayName length' };
    }
    if (
      !['light', 'dark', 'system'].includes(incomingData.themePreference)
    ) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Invalid themePreference' };
    }
    if (operation === 'create') {
      if (
        incomingData.createdAt !== requestTimeIso ||
        incomingData.lastActiveAt !== requestTimeIso ||
        incomingData.updatedAt !== requestTimeIso
      ) {
        return { allowed: false, reason: 'PERMISSION_DENIED: Timestamp forgery on create' };
      }
      return { allowed: true, reason: 'ALLOWED: UserProfile create' };
    }
    if (operation === 'update') {
      if (!existingData) {
        return { allowed: false, reason: 'PERMISSION_DENIED: Missing existing document on update' };
      }
      if (
        incomingData.uid !== existingData.uid ||
        incomingData.createdAt !== existingData.createdAt ||
        incomingData.updatedAt !== requestTimeIso ||
        incomingData.lastActiveAt !== requestTimeIso
      ) {
        return { allowed: false, reason: 'PERMISSION_DENIED: Immutable field or timestamp violation on update' };
      }
      return { allowed: true, reason: 'ALLOWED: UserProfile update' };
    }
  }

  // Subcollections under /users/{userId}/{subcollection}/{docId}
  if (segments.length === 3 && operation === 'list') {
    const subcol = segments[2];
    const allowedSubcols = [
      'materials',
      'quizAttempts',
      'revisionPlans',
      'flashcards',
      'notes',
      'conversations',
      'progress',
      'studySessions',
      'attempts',
      'revisionStates',
      'learningTools',
    ];
    if (!allowedSubcols.includes(subcol)) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Unknown subcollection' };
    }
    if (!existingData || existingData.ownerId !== auth.uid) {
      return {
        allowed: false,
        reason: 'PERMISSION_DENIED: List query must filter by resource.data.ownerId == request.auth.uid',
      };
    }
    return { allowed: true, reason: 'ALLOWED: Owner list query' };
  }

  if (segments.length === 4) {
    const subcol = segments[2];
    const docId = segments[3];
    if (!isValidRuleId(userId) || !isValidRuleId(docId)) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Invalid path ID format or length' };
    }
    if (!existingPaths.has(`/users/${userId}`)) {
      return {
        allowed: false,
        reason: 'PERMISSION_DENIED: Master gate failed — parent /users/{userId} does not exist',
      };
    }
    if (operation === 'get') {
      return { allowed: true, reason: 'ALLOWED: Owner subcollection get' };
    }
    if (auth.email_verified !== true) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Email not verified' };
    }
    if (operation === 'delete') {
      return { allowed: true, reason: 'ALLOWED: Owner subcollection delete' };
    }
    if (!incomingData) {
      return { allowed: false, reason: 'PERMISSION_DENIED: Missing incoming data' };
    }
    if (incomingData.id !== docId || incomingData.ownerId !== auth.uid || incomingData.ownerId !== userId) {
      return {
        allowed: false,
        reason: 'PERMISSION_DENIED: Identity spoofing — id or ownerId mismatch',
      };
    }

    if (subcol === 'materials') {
      const matKeys = [
        'id',
        'ownerId',
        'title',
        'sourceType',
        'pageCount',
        'iconColor',
        'lastStudiedAt',
        'pagesData',
        'analysisData',
        'createdAt',
        'updatedAt',
      ];
      if (!hasExactKeys(incomingData, matKeys, matKeys)) {
        return { allowed: false, reason: 'PERMISSION_DENIED: Invalid keys on MaterialRecord' };
      }
      if (typeof incomingData.title !== 'string' || incomingData.title.length < 1 || incomingData.title.length > 200) {
        return { allowed: false, reason: 'PERMISSION_DENIED: Invalid MaterialRecord title size' };
      }
      if (operation === 'create') {
        if (incomingData.createdAt !== requestTimeIso || incomingData.updatedAt !== requestTimeIso) {
          return { allowed: false, reason: 'PERMISSION_DENIED: Timestamp forgery on MaterialRecord create' };
        }
        return { allowed: true, reason: 'ALLOWED: MaterialRecord create' };
      }
      if (operation === 'update') {
        if (
          !existingData ||
          incomingData.id !== existingData.id ||
          incomingData.ownerId !== existingData.ownerId ||
          incomingData.createdAt !== existingData.createdAt ||
          incomingData.updatedAt !== requestTimeIso
        ) {
          return { allowed: false, reason: 'PERMISSION_DENIED: Immutable field mutation on MaterialRecord update' };
        }
        return { allowed: true, reason: 'ALLOWED: MaterialRecord update' };
      }
    }

    if (subcol === 'quizAttempts' || subcol === 'attempts') {
      if (operation === 'update') {
        return {
          allowed: false,
          reason: 'PERMISSION_DENIED: Terminal history record QuizAttemptRecord cannot be updated',
        };
      }
      const attKeys = [
        'id',
        'ownerId',
        'materialId',
        'materialTitle',
        'mode',
        'score',
        'total',
        'percentage',
        'attemptData',
        'createdAt',
      ];
      if (!hasExactKeys(incomingData, attKeys, attKeys)) {
        return { allowed: false, reason: 'PERMISSION_DENIED: Invalid keys on QuizAttemptRecord' };
      }
      if (!existingPaths.has(`/users/${userId}/materials/${incomingData.materialId}`)) {
        return {
          allowed: false,
          reason: 'PERMISSION_DENIED: Orphan QuizAttemptRecord — referenced material does not exist',
        };
      }
      if (incomingData.createdAt !== requestTimeIso) {
        return { allowed: false, reason: 'PERMISSION_DENIED: Timestamp forgery on QuizAttemptRecord' };
      }
      return { allowed: true, reason: 'ALLOWED: QuizAttemptRecord create' };
    }

    // Other child collections (revisionPlans, flashcards, notes, conversations, progress, studySessions)
    const childSubcols = [
      'revisionPlans',
      'flashcards',
      'notes',
      'conversations',
      'progress',
      'studySessions',
    ];
    if (childSubcols.includes(subcol)) {
      if (subcol === 'studySessions' && operation === 'update') {
        return { allowed: false, reason: 'PERMISSION_DENIED: StudySessionRecord is immutable' };
      }
      if (
        operation === 'create' &&
        !existingPaths.has(`/users/${userId}/materials/${incomingData.materialId}`)
      ) {
        return {
          allowed: false,
          reason: `PERMISSION_DENIED: Orphan ${subcol} — referenced material does not exist`,
        };
      }
      if (operation === 'create' && incomingData.createdAt !== requestTimeIso) {
        return { allowed: false, reason: 'PERMISSION_DENIED: Timestamp forgery' };
      }
      return { allowed: true, reason: `ALLOWED: ${subcol} ${operation}` };
    }
  }

  return { allowed: false, reason: 'PERMISSION_DENIED: Unmatched path' };
}

export function evaluateStorageSecurityRule(params: {
  auth: SimulatedAuthContext | null;
  path: string; // e.g., "/users/uid_a/materials/mat_1.pdf"
  operation: 'read' | 'write';
  contentType?: string;
  sizeBytes?: number;
}): { allowed: boolean; reason: string } {
  const { auth, path, operation, contentType = 'application/pdf', sizeBytes = 1024 } = params;
  const segments = path.replace(/^\/+|\/+$/g, '').split('/');
  if (segments.length !== 4 || segments[0] !== 'users' || segments[2] !== 'materials') {
    return { allowed: false, reason: 'PERMISSION_DENIED: Default storage deny' };
  }
  const userId = segments[1];
  const fileName = segments[3];
  if (!auth || !auth.uid || auth.email_verified !== true) {
    return { allowed: false, reason: 'PERMISSION_DENIED: Unauthenticated or unverified storage access' };
  }
  if (auth.uid !== userId) {
    return { allowed: false, reason: 'PERMISSION_DENIED: Cross-user storage access forbidden' };
  }
  if (!/^[a-zA-Z0-9_\-.]+$/.test(fileName)) {
    return { allowed: false, reason: 'PERMISSION_DENIED: Invalid storage fileName' };
  }
  if (operation === 'write') {
    if (sizeBytes <= 0 || sizeBytes > 15 * 1024 * 1024 || contentType !== 'application/pdf') {
      return { allowed: false, reason: 'PERMISSION_DENIED: Invalid PDF size or content type' };
    }
  }
  return { allowed: true, reason: `ALLOWED: Storage ${operation}` };
}
