# LearnMate Firestore & Storage Security Specification

## 1. Data Invariants
1. **Strict Multi-User Isolation**: Every document under `/users/{userId}` and all its subcollections (`materials`, `quizAttempts`, `revisionPlans`, `flashcards`, `notes`, `conversations`, `progress`, `studySessions`, plus legacy `attempts`, `revisionStates`, `learningTools`) is strictly private to the authenticated, email-verified user whose `request.auth.uid == userId`.
2. **Master Gate & Relational Integrity**: Every subcollection operation requires `userExists(userId)` (`exists(/databases/$(database)/documents/users/$(userId))`) and `ownerId == request.auth.uid && ownerId == userId`. Creating child records (`quizAttempts`, `revisionPlans`, `flashcards`, `notes`, `conversations`, `progress`, `studySessions`) requires that the parent material `/users/$(userId)/materials/$(incoming().materialId)` exists.
3. **Immutable History Records**: `QuizAttemptRecord` (`quizAttempts`, `attempts`) and `StudySessionRecord` (`studySessions`) are immutable history entries once created (`allow update: if false;`).
4. **Temporal & Identity Immutability**: Server timestamps (`createdAt`, `updatedAt`, `lastActiveAt`) must equal `request.time` on write, and `createdAt`, `ownerId`, `uid`, `id`, and `materialId` are strictly immutable on update.
5. **PII Isolation**: `/users/{userId}` contains `email` and `photoURL`; `allow list: if false;` and `allow get: if isOwner(userId) && isValidId(userId);` prevent any cross-user profile or PII reads.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: Writing to `/users/user_a` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Writing to `/users/user_a` with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Cross-User Profile Read (PII Leak)**: `user_b` reading `/users/user_a` -> `PERMISSION_DENIED`.
4. **Cross-User Subcollection Read/Write**: `user_b` reading or writing `/users/user_a/materials/mat_1` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection**: Writing `{"uid": "user_a", ..., "isAdmin": true}` to `/users/user_a` -> `PERMISSION_DENIED` via `hasOnly`.
6. **Owner Spoofing in Subcollection**: `user_a` creating `/users/user_a/materials/mat_1` with `ownerId: "user_b"` -> `PERMISSION_DENIED`.
7. **Orphan Subcollection Creation**: Creating `/users/user_no_profile/materials/mat_1` when `/users/user_no_profile` does not exist -> `PERMISSION_DENIED`.
8. **Orphan Child Material Reference**: Creating `/users/user_a/quizAttempts/att_1` referencing a non-existent `materialId` -> `PERMISSION_DENIED`.
9. **ID Poisoning**: Creating a document with an ID containing spaces/slashes or >128 chars -> `PERMISSION_DENIED` via `isValidId`.
10. **Oversized String Payload (Denial of Wallet)**: Creating a `MaterialRecord` with `title.size() > 200` -> `PERMISSION_DENIED`.
11. **Client Timestamp Forgery**: Setting `createdAt` or `updatedAt` to a client-supplied past/future timestamp instead of `request.time` -> `PERMISSION_DENIED`.
12. **Cross-User List Scraping**: `user_b` listing `/users/user_a/materials` or `/users/user_a/quizAttempts` -> `PERMISSION_DENIED` via `isOwner(userId) && existing().ownerId == request.auth.uid`.
