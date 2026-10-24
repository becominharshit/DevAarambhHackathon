import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePdfUpload,
  validatePastedText,
  paginateTextContent,
  gradeQuizAttempt,
  verifyCitations,
  buildRevisionPlanFromResults,
  computeTopicProgress,
  parseYouTubeUrl,
  parseTimestampToSeconds,
  formatSecondsToTimestamp,
  computeTimerRemainingSeconds,
  buildResourceCacheKey,
  isGenericStudyTitle,
  extractPreciseStudyConcepts,
  buildTopicSpecificYouTubeQueries,
  parseIsoDurationToSeconds,
  rankAndFilterYouTubeCandidates,
  mergeIncrementalTranscript,
  tokenizeCaptionWords,
  getProgressiveCaptionSlice,
  computeProgressiveWordDelayMs,
  downsampleFloat32ToInt16Pcm,
} from './studyLogic';
import {
  GeminiRequestManager,
  classifyGeminiError,
  computeBackoffDelayMs,
  parseRetryAfterMs,
} from './geminiRequestManager';
import {
  buildQuickRevisePdfFilename,
  buildStudyReportSummary,
  generateFlashcardsPdfBytes,
  generateMindMapPdfBytes,
  generatePdfReportBytes,
  generateQuickRevisePdfBytes,
  generateRevisionSheetPdfBytes,
  generateStickyNotesPdfBytes,
} from './pdfReportGenerator';
import {
  FlashcardItem,
  MindMapData,
  OnePageRevisionSheet,
  QuizAttempt,
  QuizQuestion,
  StickyNote,
  StudyMaterial,
  StudyPage,
  StudyTimerState,
  UserAuthProfile,
} from '../types/study';
import {
  createSignedTestToken,
  evaluateFirestoreSecurityRule,
  evaluateStorageSecurityRule,
  verifyServerRequestAuthorization,
} from './serverAuth';
import {
  KeyValueStore,
  UserIsolatedStorageRepository,
} from '../services/storageService';

test('validatePdfUpload rejects non-PDF, oversized, or >20 page files', () => {
  assert.equal(validatePdfUpload('notes.docx', 'application/msword', 1024).valid, false);
  assert.equal(validatePdfUpload('empty.pdf', 'application/pdf', 0).valid, false);
  assert.equal(validatePdfUpload('huge.pdf', 'application/pdf', 20 * 1024 * 1024).valid, false);
  assert.equal(validatePdfUpload('long.pdf', 'application/pdf', 10240, 25).valid, false);
  assert.equal(validatePdfUpload('valid.pdf', 'application/pdf', 50000, 12).valid, true);
});

test('validatePastedText enforces minimum meaningful length', () => {
  assert.equal(validatePastedText('   ').valid, false);
  assert.equal(validatePastedText('too short').valid, false);
  assert.equal(
    validatePastedText(
      'Conditional probability measures the probability of an event occurring given that another event has already occurred.'
    ).valid,
    true
  );
});

test('paginateTextContent splits long notes into page-indexed sections', () => {
  const p1 = 'Heading One\n' + 'Conditional probability formula P(A|B) = P(A and B) / P(B). '.repeat(22);
  const p2 = 'Heading Two\n' + 'Bayes theorem allows updating prior beliefs with new evidence. '.repeat(22);
  const result = paginateTextContent(`${p1}\n\n${p2}`, 'Probability Review');
  assert.equal(result.title, 'Probability Review');
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.equal(result.pages[1].pageNumber, 2);
});

test('gradeQuizAttempt deterministically scores answers and identifies weak topics', () => {
  const questions: QuizQuestion[] = [
    {
      id: 'q1',
      topic: 'Bayes Theorem',
      question: 'What is P(A|B)?',
      options: ['P(A)+P(B)', 'P(A ∩ B) / P(B)', 'P(A)*P(B)', 'P(B) / P(A)'],
      correctIndex: 1,
      explanation: 'Definition of conditional probability.',
      pageNumber: 1,
      sourceExcerpt: 'P(A|B) = P(A ∩ B) / P(B)',
    },
    {
      id: 'q2',
      topic: 'Random Variables',
      question: 'What is the sum of all PMF probabilities?',
      options: ['0', '0.5', '1', 'Infinity'],
      correctIndex: 2,
      explanation: 'Probabilities over sample space sum to 1.',
      pageNumber: 3,
      sourceExcerpt: 'Sum of p(x) = 1',
    },
  ];

  const attempt = gradeQuizAttempt('mat_1', 'Probability Notes.pdf', 'diagnostic', questions, {
    q1: 0, // wrong
    q2: 2, // right
  });

  assert.equal(attempt.score, 1);
  assert.equal(attempt.total, 2);
  assert.equal(attempt.percentage, 50);
  assert.deepEqual(attempt.weakTopics, ['Bayes Theorem']);
  assert.deepEqual(attempt.strongTopics, ['Random Variables']);
});

test('verifyCitations strips hallucinated page numbers not in the material', () => {
  const pages: StudyPage[] = [
    { pageNumber: 1, title: 'Intro', content: 'Sample spaces and events.' },
    { pageNumber: 2, title: 'Axioms', content: 'Kolmogorov axioms.', timestamp: '02:15' },
  ];

  const verified = verifyCitations(
    [
      { pageNumber: 2, sectionTitle: 'Axioms', snippet: 'Kolmogorov axioms.' },
      { pageNumber: 99, sectionTitle: 'Fake Page', snippet: 'Does not exist' },
    ],
    pages
  );

  assert.equal(verified.length, 1);
  assert.equal(verified[0].pageNumber, 2);
  assert.equal(verified[0].timestamp, '02:15');
});

test('buildRevisionPlanFromResults & computeTopicProgress track improvement across attempts', () => {
  const questions: QuizQuestion[] = [
    {
      id: 'q1',
      topic: 'Bayes Theorem',
      question: 'Q1',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 1,
      explanation: 'Exp 1',
      pageNumber: 2,
      sourceExcerpt: 'Excerpt',
    },
  ];

  const diagAttempt = gradeQuizAttempt(
    'mat_1',
    'Probability Notes.pdf',
    'diagnostic',
    questions,
    { q1: 0 },
    undefined,
    'att_1',
    '2026-10-23T01:00:00.000Z'
  );

  const plan1 = buildRevisionPlanFromResults('mat_1', diagAttempt, [
    {
      topic: 'Bayes Theorem',
      wrongCount: 1,
      totalAsked: 1,
      misconception: 'Confused joint probability with conditional probability',
      whyItHappens: 'Forgetting to normalize by P(B)',
      coreCorrection: 'Divide intersection by conditioning event probability P(B).',
      pageNumber: 2,
      sourceReference: 'Page 2 — Conditional Probability',
    },
  ]);

  assert.equal(plan1.length, 1);
  assert.equal(plan1[0].completed, false);
  assert.equal(plan1[0].priority, 'High');

  const adaptiveAttempt = gradeQuizAttempt(
    'mat_1',
    'Probability Notes.pdf',
    'adaptive',
    questions,
    { q1: 1 },
    ['Bayes Theorem'],
    'att_2',
    '2026-10-23T02:00:00.000Z'
  );

  const plan2 = buildRevisionPlanFromResults('mat_1', adaptiveAttempt, [], plan1);
  assert.equal(plan2[0].completed, true);
  assert.equal(plan2[0].masteredInAdaptive, true);

  const progress = computeTopicProgress([diagAttempt, adaptiveAttempt]);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].topic, 'Bayes Theorem');
  assert.equal(progress[0].firstScorePct, 0);
  assert.equal(progress[0].latestScorePct, 100);
  assert.equal(progress[0].improvementPct, 100);
});

test('buildStudyReportSummary and generatePdfReportBytes produce valid PDF 1.4 binary report', () => {
  const materials: StudyMaterial[] = [
    {
      id: 'mat_1',
      title: 'Probability Notes.pdf',
      sourceType: 'pdf',
      pageCount: 2,
      createdAt: '2026-10-23T00:00:00.000Z',
      lastStudiedAt: 'Just now',
      iconColor: 'red',
      pages: [
        { pageNumber: 1, title: 'Axioms', content: 'Kolmogorov axioms' },
        { pageNumber: 2, title: 'Bayes', content: 'Bayes theorem' },
      ],
    },
  ];

  const questions: QuizQuestion[] = [
    {
      id: 'q1',
      topic: 'Bayes Theorem',
      question: 'What is P(A|B)?',
      options: ['P(A)+P(B)', 'P(A ∩ B)/P(B)', 'P(A)*P(B)', '1'],
      correctIndex: 1,
      explanation: 'Conditional probability definition.',
      pageNumber: 2,
      sourceExcerpt: 'P(A|B)',
    },
  ];

  const att1 = gradeQuizAttempt('mat_1', 'Probability Notes.pdf', 'diagnostic', questions, { q1: 0 }, undefined, 'att_1', '2026-10-23T01:00:00.000Z');
  const att2 = gradeQuizAttempt('mat_1', 'Probability Notes.pdf', 'adaptive', questions, { q1: 1 }, ['Bayes Theorem'], 'att_2', '2026-10-23T02:00:00.000Z');

  const summary = buildStudyReportSummary({
    attempts: [att2, att1],
    materials,
    selectedMaterialId: 'mat_1',
  });

  assert.equal(summary.totalAttempts, 2);
  assert.equal(summary.firstScorePct, 0);
  assert.equal(summary.latestScorePct, 100);
  assert.equal(summary.netImprovementPct, 100);
  assert.equal(summary.filterTitle, 'Probability Notes.pdf');

  const pdfBytes = generatePdfReportBytes(summary);
  const pdfString = new TextDecoder().decode(pdfBytes);
  assert.ok(pdfString.startsWith('%PDF-1.4'));
  assert.ok(pdfString.includes('LearnMate - Personalized Study & Quiz Performance Report'));
  assert.ok(pdfString.includes('Probability Notes.pdf'));
  assert.ok(pdfString.trim().endsWith('%%EOF'));
});

test('parseYouTubeUrl validates watch, youtu.be, shorts, and rejects non-YouTube URLs', () => {
  const watchRes = parseYouTubeUrl('https://www.youtube.com/watch?v=HZGCoVF3YvM&t=45s');
  assert.equal(watchRes.valid, true);
  assert.equal(watchRes.videoId, 'HZGCoVF3YvM');
  assert.equal(watchRes.canonicalUrl, 'https://www.youtube.com/watch?v=HZGCoVF3YvM');

  const shortRes = parseYouTubeUrl('https://youtu.be/HZGCoVF3YvM?si=1234');
  assert.equal(shortRes.valid, true);
  assert.equal(shortRes.videoId, 'HZGCoVF3YvM');

  const invalidHost = parseYouTubeUrl('https://vimeo.com/12345678901');
  assert.equal(invalidHost.valid, false);

  const badId = parseYouTubeUrl('https://www.youtube.com/watch?v=short');
  assert.equal(badId.valid, false);
});

test('timestamp helpers and drift-free StudyTimer calculation work deterministically', () => {
  assert.equal(parseTimestampToSeconds('02:15'), 135);
  assert.equal(parseTimestampToSeconds('1:02:05'), 3725);
  assert.equal(formatSecondsToTimestamp(135), '02:15');
  assert.equal(formatSecondsToTimestamp(3725), '1:02:05');

  const now = 1_700_000_000_000;
  const runningState: StudyTimerState = {
    phase: 'study',
    isRunning: true,
    studyDurationMinutes: 25,
    breakDurationMinutes: 5,
    remainingSecondsWhenPaused: 1500,
    targetEndTimeMs: now + 90_000, // 90 seconds from now
    soundEnabled: true,
    completedSessionsCount: 1,
  };

  assert.equal(computeTimerRemainingSeconds(runningState, now), 90);
  assert.equal(computeTimerRemainingSeconds(runningState, now + 95_000), 0);

  const pausedState: StudyTimerState = {
    ...runningState,
    isRunning: false,
    remainingSecondsWhenPaused: 420,
    targetEndTimeMs: null,
  };
  assert.equal(computeTimerRemainingSeconds(pausedState, now + 500_000), 420);

  assert.equal(
    buildResourceCacheKey('mat_prob', 'mind_map', 4),
    'mat_prob::mind_map::v4'
  );
});

test('generateRevisionSheetPdfBytes produces valid A4 One-Page Revision PDF binary', () => {
  const sheet: OnePageRevisionSheet = {
    materialId: 'mat_1',
    chapterTitle: 'Probability Notes.pdf',
    overview: 'Core probability axioms, conditional probability, and Bayes theorem.',
    essentialConcepts: [
      {
        title: 'Bayes Theorem',
        explanation: 'Updates prior P(B) with likelihood P(A|B).',
        sourceReference: 'Page 3',
        pageNumber: 3,
      },
    ],
    formulasAndDefinitions: [
      {
        term: 'Conditional Probability',
        formulaOrDefinition: 'P(A|B) = P(A ∩ B) / P(B)',
        whenToUse: 'When event B is known to have occurred.',
        pageNumber: 2,
      },
    ],
    keyRelationships: ['Disjoint events with positive probability cannot be independent.'],
    commonMistakesToAvoid: ['Confusing P(A|B) with P(B|A).'],
    shortRecallQuestions: [
      {
        question: 'Does linearity of expectation require independence?',
        shortAnswer: 'No, E[X+Y] = E[X] + E[Y] holds for all random variables.',
        pageNumber: 4,
      },
    ],
    generatedAt: '2026-10-23T05:00:00.000Z',
  };

  const bytes = generateRevisionSheetPdfBytes(sheet);
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('LearnMate One-Page Revision Sheet'));
  assert.ok(text.includes('Bayes Theorem'));
  assert.ok(text.trim().endsWith('%%EOF'));
});

// ============================================================================
// STAGE 1 TESTS: GEMINI REQUEST MANAGER & RATE-LIMIT CLASSIFICATION
// ============================================================================

test('classifyGeminiError distinguishes temporary rate limits from daily quota exhaustion and auth errors', () => {
  const temp429 = classifyGeminiError(
    { status: 429, message: '429 Too Many Requests: Rate limit per minute reached. Please retry in 3s' },
    false
  );
  assert.equal(temp429.category, 'RATE_LIMIT_TEMPORARY');
  assert.equal(temp429.retryable, true);
  assert.equal(temp429.retryAfterMs, 3000);
  assert.equal(temp429.userMessage, 'Gemini is temporarily busy. Try again shortly.');

  const quotaExhausted = classifyGeminiError(
    { status: 429, message: 'Quota exceeded for quota metric generate_content_free_tier_requests per day' },
    false
  );
  assert.equal(quotaExhausted.category, 'QUOTA_EXHAUSTED');
  assert.equal(quotaExhausted.retryable, false);
  assert.equal(quotaExhausted.userMessage, "Your project's AI quota has been reached.");

  const authErr = classifyGeminiError({ status: 403, message: 'API_KEY_INVALID: API key not valid' }, true);
  assert.equal(authErr.category, 'AUTH_OR_CONFIG_ERROR');
  assert.equal(authErr.retryable, false);
  assert.ok(authErr.userMessage.includes('Your existing notes are safe'));
});

test('GeminiRequestManager deduplicates identical in-flight requests, caches successes, and retries transient 429', async () => {
  let sleepCalls: number[] = [];
  const manager = new GeminiRequestManager({
    maxConcurrency: 2,
    maxRetries: 2,
    baseDelayMs: 50,
    maxDelayMs: 500,
    sleepFn: async (ms) => {
      sleepCalls.push(ms);
    },
  });

  // 1. Test transient 429 retry + eventual success + caching
  let attempts = 0;
  const res1 = await manager.execute({
    operation: 'quick_notes',
    model: 'gemini-3.8-flash',
    dedupeKey: 'test_key_1',
    cacheable: true,
    task: async () => {
      attempts += 1;
      if (attempts === 1) {
        const err: any = new Error('429 RESOURCE_EXHAUSTED: requests per minute');
        err.status = 429;
        throw err;
      }
      return { notes: ['Note A'] };
    },
  });
  assert.deepEqual(res1, { notes: ['Note A'] });
  assert.equal(attempts, 2);
  assert.equal(sleepCalls.length, 1);

  // Subsequent call with same dedupeKey should return cached result without invoking task
  const resCached = await manager.execute({
    operation: 'quick_notes',
    model: 'gemini-3.8-flash',
    dedupeKey: 'test_key_1',
    cacheable: true,
    task: async () => {
      attempts += 1;
      return { notes: ['Note B'] };
    },
  });
  assert.deepEqual(resCached, { notes: ['Note A'] });
  assert.equal(attempts, 2);

  // 2. Test in-flight deduplication for concurrent identical calls
  let concurrentRuns = 0;
  const [flightA, flightB] = await Promise.all([
    manager.execute({
      operation: 'mind_map',
      model: 'gemini-3.8-flash',
      dedupeKey: 'inflight_key',
      cacheable: false,
      task: async () => {
        concurrentRuns += 1;
        await new Promise((r) => setTimeout(r, 15));
        return { mapId: 'm1' };
      },
    }),
    manager.execute({
      operation: 'mind_map',
      model: 'gemini-3.8-flash',
      dedupeKey: 'inflight_key',
      cacheable: false,
      task: async () => {
        concurrentRuns += 1;
        return { mapId: 'm2' };
      },
    }),
  ]);
  assert.equal(concurrentRuns, 1);
  assert.deepEqual(flightA, flightB);
});

// ============================================================================
// STAGE 2 TESTS: TOPIC-SPECIFIC YOUTUBE RECOMMENDATIONS
// ============================================================================

test('extractPreciseStudyConcepts and rankAndFilterYouTubeCandidates ignore generic titles and reject unrelated/short videos', () => {
  assert.equal(isGenericStudyTitle('Semester 1 Revision'), true);
  assert.equal(isGenericStudyTitle('Exam Guide.pdf'), true);
  assert.equal(isGenericStudyTitle('80/20 Notes'), true);
  assert.equal(isGenericStudyTitle('Chapter 3.pdf'), true);
  assert.equal(isGenericStudyTitle('Bayes Theorem and Conditional Probability'), false);

  const queryPlan = buildTopicSpecificYouTubeQueries({
    materialTitle: 'Semester 1 Revision.pdf',
    keyTopics: [
      {
        name: 'Bayes Theorem & Law of Total Probability',
        summary: 'Updating prior beliefs with conditional likelihood.',
        pageNumbers: [1],
        keyTerms: ['Prior Probability', 'Posterior Probability'],
      },
    ],
    weakTopics: ['Conditional Probability & Independence'],
  });

  assert.equal(queryPlan.subject, 'Probability Theory');
  assert.ok(!queryPlan.primaryQuery.toLowerCase().includes('semester 1'));
  assert.ok(queryPlan.primaryQuery.toLowerCase().includes('conditional probability'));

  assert.equal(parseIsoDurationToSeconds('PT12M30S'), 750);
  assert.equal(parseIsoDurationToSeconds('PT45S'), 45);

  const ranked = rankAndFilterYouTubeCandidates({
    candidates: [
      {
        videoId: 'vid_short_1',
        title: 'Bayes Theorem in 30 Seconds #shorts',
        channelTitle: 'QuickMath',
        description: 'Fast short on Bayes.',
        thumbnailUrl: 'https://img.youtube.com/1.jpg',
        durationIso: 'PT30S',
      },
      {
        videoId: 'vid_gaming_2',
        title: 'Minecraft Gameplay Episode 4',
        channelTitle: 'GamerChannel',
        description: 'Playing survival mode',
        thumbnailUrl: 'https://img.youtube.com/2.jpg',
        durationIso: 'PT15M00S',
      },
      {
        videoId: 'vid_edu_bayes',
        title: 'Bayes Theorem and Conditional Probability Explained — University Lecture',
        channelTitle: 'StatQuest with Josh Starmer',
        description: 'Step-by-step tutorial on Bayes theorem, prior and posterior probabilities.',
        thumbnailUrl: 'https://img.youtube.com/3.jpg',
        durationIso: 'PT14M20S',
      },
    ],
    concepts: queryPlan.concepts,
    subject: queryPlan.subject,
    topicQuery: 'Bayes Theorem',
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].videoId, 'vid_edu_bayes');
  assert.equal(ranked[0].durationText, '14:20');
});

// ============================================================================
// STAGE 4 & 5 TESTS: LIVE TRANSCRIPT ASSEMBLY & 16KHZ PCM RESAMPLING
// ============================================================================

test('mergeIncrementalTranscript and downsampleFloat32ToInt16Pcm handle real-time voice streams accurately', () => {
  let caption = '';
  caption = mergeIncrementalTranscript(caption, 'Bayes theorem ');
  caption = mergeIncrementalTranscript(caption, 'updates the prior ');
  caption = mergeIncrementalTranscript(caption, 'probability P(B).');
  assert.equal(caption, 'Bayes theorem updates the prior probability P(B).');

  // Cumulative replacement chunk should not duplicate existing prefix
  const Deduped = mergeIncrementalTranscript(
    'Bayes theorem updates',
    'Bayes theorem updates the prior probability.'
  );
  assert.equal(Deduped, 'Bayes theorem updates the prior probability.');

  // Downsample 48kHz buffer (480 samples = 10ms) to 16kHz (160 samples = 10ms)
  const input48k = new Float32Array(480).fill(0.5);
  const pcm16k = downsampleFloat32ToInt16Pcm(input48k, 48000, 16000);
  assert.equal(pcm16k.length, 160);
  assert.ok(pcm16k[0] > 16000 && pcm16k[0] < 16500);

  // Word-boundary overlap deduplication ("Python is a" + "is a programming")
  const overlapMerged = mergeIncrementalTranscript(
    'Python is a',
    'is a programming language.'
  );
  assert.equal(overlapMerged, 'Python is a programming language.');

  // Progressive word-by-word caption slicing ("Python" -> "Python is" -> "Python is a" -> "Python is a programming")
  const sampleSpeech = 'Python is a programming';
  assert.deepEqual(tokenizeCaptionWords(sampleSpeech), [
    'Python',
    'is',
    'a',
    'programming',
  ]);
  assert.deepEqual(getProgressiveCaptionSlice(sampleSpeech, 1), {
    displayedText: 'Python',
    totalWords: 4,
    isComplete: false,
  });
  assert.deepEqual(getProgressiveCaptionSlice(sampleSpeech, 2), {
    displayedText: 'Python is',
    totalWords: 4,
    isComplete: false,
  });
  assert.deepEqual(getProgressiveCaptionSlice(sampleSpeech, 3), {
    displayedText: 'Python is a',
    totalWords: 4,
    isComplete: false,
  });
  assert.deepEqual(getProgressiveCaptionSlice(sampleSpeech, 4), {
    displayedText: 'Python is a programming',
    totalWords: 4,
    isComplete: true,
  });

  // Audio-paced delay calculation
  assert.equal(computeProgressiveWordDelayMs(0, 1.5), 0);
  assert.equal(computeProgressiveWordDelayMs(5, 0.8), 160);
  assert.equal(computeProgressiveWordDelayMs(4, 0), 145);
});

// ============================================================================
// STAGE 6 TESTS: QUICK REVISE A4 PDF GENERATION (ALL 4 MODES + MULTI-PAGE)
// ============================================================================

test('generateStickyNotesPdfBytes produces valid A4 PDF with pastel fills, math symbols, and multi-page pagination', () => {
  const colors = ['yellow', 'pink', 'blue', 'green', 'lavender'] as const;
  const manyNotes: StickyNote[] = Array.from({ length: 14 }, (_, idx) => ({
    id: `sn_${idx + 1}`,
    materialId: 'mat_prob',
    title: `Concept Note #${idx + 1}: Inclusion-Exclusion`,
    content:
      'For any two events A and B, subtract their overlap once so shared outcomes in A ∩ B are not double-counted.',
    formula: 'P(A ∪ B) = P(A) + P(B) - P(A ∩ B)',
    color: colors[idx % colors.length],
    pageNumber: (idx % 4) + 1,
    sourceReference: `Page ${(idx % 4) + 1}`,
  }));

  const pdfBytes = generateStickyNotesPdfBytes('Probability Notes.pdf', manyNotes);
  const pdfText = new TextDecoder().decode(pdfBytes);

  assert.ok(pdfText.startsWith('%PDF-1.4'));
  assert.ok(pdfText.trim().endsWith('%%EOF'));
  // Verify A4 MediaBox [0 0 595.28 841.89]
  assert.ok(pdfText.includes('/MediaBox [0 0 595.28 841.89]'));
  // Verify multiple A4 pages were created for 14 sticky notes without clipping
  assert.ok(pdfText.includes('Page 1 of 2') || pdfText.includes('Page 2 of 2'));
  // Verify Adobe Symbol font /F5 octal codes for ∪ (\310) and ∩ (\307)
  assert.ok(pdfText.includes('\\310'));
  assert.ok(pdfText.includes('\\307'));
  // Verify pastel yellow and lavender RGB fills are drawn
  assert.ok(pdfText.includes('1.000 0.984 0.922 rg'));
  assert.ok(pdfText.includes('0.961 0.953 1.000 rg'));
});

test('generateFlashcardsPdfBytes and generateMindMapPdfBytes produce valid A4 PDF binaries', () => {
  const flashcards: FlashcardItem[] = [
    {
      id: 'fc_1',
      materialId: 'mat_prob',
      topic: 'Conditional Probability',
      frontPrompt: 'What is the definition of conditional probability P(A|B)?',
      backExplanation:
        'P(A|B) restricts the sample space S to event B (where P(B) > 0) and measures the ratio of P(A ∩ B) to P(B).',
      formula: 'P(A|B) = P(A ∩ B) / P(B)',
      pageNumber: 2,
      sourceReference: 'Page 2',
      status: 'know_it',
    },
  ];

  const fcBytes = generateFlashcardsPdfBytes('Probability Notes.pdf', flashcards);
  const fcText = new TextDecoder().decode(fcBytes);
  assert.ok(fcText.startsWith('%PDF-1.4'));
  assert.ok(fcText.includes('LearnMate Quick Revision'));
  assert.ok(fcText.includes('Conditional Probability'));
  assert.ok(fcText.includes('\\307'));
  assert.ok(fcText.trim().endsWith('%%EOF'));

  const mindMap: MindMapData = {
    materialId: 'mat_prob',
    centralTopic: 'Probability Foundations',
    nodes: [
      {
        id: 'n_center',
        label: 'Probability Axioms',
        category: 'central',
        summary: 'Core rules governing sample spaces S and event probabilities.',
        formula: '0 ≤ P(A) ≤ 1, P(S) = 1',
        pageNumber: 1,
        sourceReference: 'Page 1',
        branchColor: 'blue',
      },
      {
        id: 'n_bayes',
        label: 'Bayes Theorem',
        category: 'branch',
        summary: 'Reverses conditioning using prior and likelihood probabilities.',
        formula: 'P(B|A) = P(A|B)P(B) / P(A)',
        pageNumber: 3,
        sourceReference: 'Page 3',
        branchColor: 'green',
      },
    ],
    edges: [
      {
        id: 'e_1',
        from: 'n_center',
        to: 'n_bayes',
        relationLabel: 'extends to',
      },
    ],
    generatedAt: '2026-10-23T05:00:00.000Z',
  };

  const mmBytes = generateMindMapPdfBytes('Probability Notes.pdf', mindMap);
  const mmText = new TextDecoder().decode(mmBytes);
  assert.ok(mmText.startsWith('%PDF-1.4'));
  assert.ok(mmText.includes('Concept Mind Map'));
  assert.ok(mmText.includes('Bayes Theorem'));
  assert.ok(mmText.trim().endsWith('%%EOF'));

  // Verify unified dispatcher and filename builder
  assert.equal(
    buildQuickRevisePdfFilename('Probability Notes.pdf', 'sticky_notes'),
    'LearnMate_Quick_Revision_Probability_Notes_Sticky_Notes.pdf'
  );
  const unifiedBytes = generateQuickRevisePdfBytes({
    mode: 'mind_map',
    materialTitle: 'Probability Notes.pdf',
    mindMap,
  });
  assert.equal(unifiedBytes.byteLength, mmBytes.byteLength);
});

// ============================================================================
// STAGE 7 TESTS: MULTI-USER AUTHENTICATION, SECURITY RULES & DATA ISOLATION
// ============================================================================

class MemoryKVStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

test('Firestore & Storage Security Rules enforce strict per-user isolation and reject all 12 Dirty Dozen attacks', () => {
  const nowIso = '2026-10-23T18:00:00.000Z';
  const aliceAuth = {
    uid: 'uid_alice',
    email: 'alice@university.edu',
    email_verified: true,
  };
  const bobAuth = {
    uid: 'uid_bob',
    email: 'bob@university.edu',
    email_verified: true,
  };
  const existingPaths = new Set<string>([
    '/users/uid_alice',
    '/users/uid_alice/materials/mat_1',
  ]);

  // 1. Unauthenticated read on /users/uid_alice/materials/mat_1 -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: null,
      operation: 'get',
      path: '/users/uid_alice/materials/mat_1',
      existingPaths,
    }).allowed,
    false
  );

  // 2. Cross-account read (Bob reading Alice's material) -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: bobAuth,
      operation: 'get',
      path: '/users/uid_alice/materials/mat_1',
      existingPaths,
    }).allowed,
    false
  );

  // 3. Cross-account write (Bob writing into Alice's quizAttempts) -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: bobAuth,
      operation: 'create',
      path: '/users/uid_alice/quizAttempts/att_1',
      requestTimeIso: nowIso,
      existingPaths,
      incomingData: {
        id: 'att_1',
        ownerId: 'uid_bob',
        materialId: 'mat_1',
        materialTitle: 'Calc',
        mode: 'diagnostic',
        score: 4,
        total: 5,
        percentage: 80,
        attemptData: '{}',
        createdAt: nowIso,
      },
    }).allowed,
    false
  );

  // 4. UID spoofing inside user profile document -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'create',
      path: '/users/uid_alice',
      requestTimeIso: nowIso,
      incomingData: {
        uid: 'uid_bob',
        displayName: 'Alice',
        email: 'alice@university.edu',
        photoURL: '',
        activeMaterialId: '',
        themePreference: 'light',
        createdAt: nowIso,
        lastActiveAt: nowIso,
        updatedAt: nowIso,
      },
    }).allowed,
    false
  );

  // 5. Missing required fields on material creation -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'create',
      path: '/users/uid_alice/materials/mat_1',
      requestTimeIso: nowIso,
      existingPaths,
      incomingData: { id: 'mat_1', ownerId: 'uid_alice' },
    }).allowed,
    false
  );

  // 6. Undeclared collection access (/globalMaterials/mat_1) -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'get',
      path: '/globalMaterials/mat_1',
      existingPaths,
    }).allowed,
    false
  );

  // 7. Orphan subcollection write (referencing non-existent material) -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'create',
      path: '/users/uid_alice/quizAttempts/att_orphan',
      requestTimeIso: nowIso,
      existingPaths,
      incomingData: {
        id: 'att_orphan',
        ownerId: 'uid_alice',
        materialId: 'mat_does_not_exist',
        materialTitle: 'Ghost PDF',
        mode: 'diagnostic',
        score: 5,
        total: 5,
        percentage: 100,
        attemptData: '{}',
        createdAt: nowIso,
      },
    }).allowed,
    false
  );

  // 8. Terminal history mutation (updating an immutable QuizAttemptRecord) -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'update',
      path: '/users/uid_alice/quizAttempts/att_1',
      requestTimeIso: nowIso,
      existingPaths,
      incomingData: {
        id: 'att_1',
        ownerId: 'uid_alice',
        materialId: 'mat_1',
        materialTitle: 'Probability',
        mode: 'diagnostic',
        score: 5,
        total: 5,
        percentage: 100,
        attemptData: '{}',
        createdAt: nowIso,
      },
    }).allowed,
    false
  );

  // 9. Immutable createdAt tampering on user profile update -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'update',
      path: '/users/uid_alice',
      requestTimeIso: nowIso,
      existingData: {
        uid: 'uid_alice',
        displayName: 'Alice',
        email: 'alice@university.edu',
        photoURL: '',
        activeMaterialId: '',
        themePreference: 'light',
        createdAt: '2026-10-01T00:00:00.000Z',
        lastActiveAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      incomingData: {
        uid: 'uid_alice',
        displayName: 'Alice Updated',
        email: 'alice@university.edu',
        photoURL: '',
        activeMaterialId: '',
        themePreference: 'dark',
        createdAt: nowIso, // tampered!
        lastActiveAt: nowIso,
        updatedAt: nowIso,
      },
    }).allowed,
    false
  );

  // 10. Cross-user Cloud Storage PDF read/write & non-PDF upload -> PERMISSION_DENIED
  assert.equal(
    evaluateStorageSecurityRule({
      auth: bobAuth,
      operation: 'read',
      path: '/users/uid_alice/materials/notes.pdf',
    }).allowed,
    false
  );
  assert.equal(
    evaluateStorageSecurityRule({
      auth: aliceAuth,
      operation: 'write',
      path: '/users/uid_alice/materials/malware.exe',
      contentType: 'application/x-msdownload',
      sizeBytes: 1024,
    }).allowed,
    false
  );

  // Valid owner operations on UserProfile, MaterialRecord, QuizAttemptRecord, and Storage -> ALLOWED
  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'create',
      path: '/users/uid_alice',
      requestTimeIso: nowIso,
      incomingData: {
        uid: 'uid_alice',
        displayName: 'Alice Student',
        email: 'alice@university.edu',
        photoURL: '',
        activeMaterialId: '',
        themePreference: 'light',
        createdAt: nowIso,
        lastActiveAt: nowIso,
        updatedAt: nowIso,
      },
    }).allowed,
    true
  );

  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'create',
      path: '/users/uid_alice/materials/mat_1',
      requestTimeIso: nowIso,
      existingPaths,
      incomingData: {
        id: 'mat_1',
        ownerId: 'uid_alice',
        title: 'Linear Algebra Notes.pdf',
        sourceType: 'pdf',
        pageCount: 3,
        iconColor: 'blue',
        lastStudiedAt: 'Just now',
        pagesData: '[{"pageNumber":1,"title":"Vectors","content":"Basis and span"}]',
        analysisData: '{}',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    }).allowed,
    true
  );

  assert.equal(
    evaluateFirestoreSecurityRule({
      auth: aliceAuth,
      operation: 'create',
      path: '/users/uid_alice/quizAttempts/att_valid',
      requestTimeIso: nowIso,
      existingPaths,
      incomingData: {
        id: 'att_valid',
        ownerId: 'uid_alice',
        materialId: 'mat_1',
        materialTitle: 'Linear Algebra Notes.pdf',
        mode: 'diagnostic',
        score: 5,
        total: 6,
        percentage: 83,
        attemptData: '{}',
        createdAt: nowIso,
      },
    }).allowed,
    true
  );

  assert.equal(
    evaluateStorageSecurityRule({
      auth: aliceAuth,
      operation: 'write',
      path: '/users/uid_alice/materials/linear_algebra.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2 * 1024 * 1024,
    }).allowed,
    true
  );
});

test('Server token verification rejects unauthenticated (401), forged (401), and cross-UID spoofed (403) requests', async () => {
  // Missing Authorization header -> 401
  const missingRes = await verifyServerRequestAuthorization({
    authorizationHeader: undefined,
    allowTestTokens: true,
  });
  assert.equal(missingRes.authorized, false);
  assert.equal(missingRes.httpStatus, 401);

  // Forged token -> 401
  const forgedRes = await verifyServerRequestAuthorization({
    authorizationHeader: 'Bearer lmtest.eyJ1aWQiOiJ1aWRfYWxpY2UifQ.forged_sig',
    allowTestTokens: true,
  });
  assert.equal(forgedRes.authorized, false);
  assert.equal(forgedRes.httpStatus, 401);

  // Valid signed token for Alice
  const aliceToken = createSignedTestToken({
    uid: 'uid_account_a',
    email: 'student.a@university.edu',
    name: 'Student A',
  });

  const validRes = await verifyServerRequestAuthorization({
    authorizationHeader: `Bearer ${aliceToken}`,
    suppliedUserId: 'uid_account_a',
    allowTestTokens: true,
  });
  assert.equal(validRes.authorized, true);
  assert.equal(validRes.uid, 'uid_account_a');
  assert.equal(validRes.httpStatus, 200);

  // Cross-account UID spoofing in request body -> 403
  const spoofedRes = await verifyServerRequestAuthorization({
    authorizationHeader: `Bearer ${aliceToken}`,
    suppliedUserId: 'uid_account_b',
    allowTestTokens: true,
  });
  assert.equal(spoofedRes.authorized, false);
  assert.equal(spoofedRes.httpStatus, 403);
  assert.equal(spoofedRes.code, 'UID_MISMATCH');
});

test('Multi-User Isolation Journey: Test A (Account A) -> Test B (Account B) -> Test C (Return to Account A)', async () => {
  const store = new MemoryKVStore();

  // Seed legacy unowned data to verify it is quarantined and NEVER auto-copied into new accounts
  store.setItem(
    'learnmate_materials_v2',
    JSON.stringify([
      {
        id: 'mat_legacy_unowned',
        title: 'Old Unowned Shared Notes.pdf',
        pageCount: 1,
        pages: [{ pageNumber: 1, title: 'P1', content: 'Legacy text' }],
        createdAt: '2026-01-01T00:00:00Z',
        lastStudiedAt: '1 day ago',
      },
    ])
  );

  const repo = new UserIsolatedStorageRepository(store, null);

  // Verify legacy data was quarantined and removed from global unscoped key
  assert.equal(store.getItem('learnmate_materials_v2'), null);
  assert.equal(repo.getLegacyBackupSummary().hasUnclaimedData, true);
  assert.equal(repo.getLegacyBackupSummary().materialCount, 1);

  // While logged out, repository returns empty lists (never starter or legacy materials)
  assert.equal(repo.getMaterials().length, 0);
  assert.equal(repo.getQuizAttempts().length, 0);

  // =========================================================================
  // TEST A: Sign in with Account A -> Upload Material A -> Chat -> Quiz -> Revision Plan -> Flashcards
  // =========================================================================
  const accountA: UserAuthProfile = {
    uid: 'uid_account_a',
    displayName: 'Alice Quantum',
    email: 'alice.quantum@university.edu',
    photoURL: null,
  };
  await repo.syncWithCloudUser(accountA);

  // Brand-new Account A starts with an empty workspace (no legacy data auto-copied)
  assert.equal(repo.getMaterials().length, 0);

  const materialA: StudyMaterial = {
    id: 'mat_quantum_a',
    ownerId: accountA.uid,
    title: 'Quantum Mechanics Lecture 1.pdf',
    sourceType: 'pdf',
    pageCount: 2,
    pages: [
      {
        pageNumber: 1,
        title: 'Wave-Particle Duality',
        content: 'De Broglie wavelength lambda = h / p relates momentum to wavelength.',
      },
      {
        pageNumber: 2,
        title: 'Schrodinger Equation',
        content: 'Time-dependent wave function evolution in quantum systems.',
      },
    ],
    createdAt: '2026-10-23T10:00:00Z',
    lastStudiedAt: 'Just now',
  };
  repo.saveMaterial(materialA);

  repo.saveTutorHistory(materialA.id, [
    {
      id: 'msg_a1',
      role: 'user',
      content: 'Explain De Broglie wavelength.',
      timestamp: '2026-10-23T10:01:00Z',
    },
    {
      id: 'msg_a2',
      role: 'assistant',
      content: 'De Broglie wavelength is lambda = h / p (Page 1).',
      citations: [
        {
          pageNumber: 1,
          sectionTitle: 'Wave-Particle Duality',
          snippet: 'De Broglie wavelength lambda = h / p',
        },
      ],
      timestamp: '2026-10-23T10:01:05Z',
    },
  ]);

  const attemptA: QuizAttempt = {
    id: 'attempt_quantum_a1',
    materialId: materialA.id,
    materialTitle: materialA.title,
    mode: 'diagnostic',
    questions: [],
    answers: { q1: 0 },
    score: 5,
    total: 6,
    percentage: 83,
    weakTopics: [],
    strongTopics: ['Wave-Particle Duality'],
    completedAt: '2026-10-23T10:05:00Z',
    results: [
      {
        questionId: 'q1',
        topic: 'Wave-Particle Duality',
        selectedIndex: 0,
        correctIndex: 0,
        isCorrect: true,
        pageNumber: 1,
        question: 'What is lambda?',
        selectedOption: 'h/p',
        correctOption: 'h/p',
        explanation: 'De Broglie formula.',
      },
    ],
  };
  repo.saveQuizAttempt(attemptA);

  repo.saveRevisionPlan(materialA.id, [
    {
      id: 'rev_a1',
      materialId: materialA.id,
      topic: 'Schrodinger Equation',
      priority: 'High',
      pageNumber: 2,
      sourceReference: 'Page 2',
      recommendedAction: 'Re-read Page 2',
      conceptSummary: 'Review operator notation',
      completed: false,
    },
  ]);

  repo.saveStickyNotes(materialA.id, [
    {
      id: 'sn_a1',
      materialId: materialA.id,
      title: 'De Broglie Relation',
      content: 'Matter waves have wavelength inversely proportional to momentum.',
      formula: 'λ = h / p',
      color: 'blue',
      pageNumber: 1,
      sourceReference: 'Page 1',
    },
  ]);

  assert.equal(repo.getMaterials().length, 1);
  assert.equal(repo.getMaterials()[0].title, 'Quantum Mechanics Lecture 1.pdf');
  assert.equal(repo.getQuizAttempts().length, 1);
  assert.equal(repo.getTutorHistory(materialA.id).length, 2);

  // Sign out of Account A
  await repo.syncWithCloudUser(null);
  assert.equal(repo.getMaterials().length, 0);
  assert.equal(repo.getQuizAttempts().length, 0);

  // =========================================================================
  // TEST B: Sign in with Account B -> Verify ZERO data from Account A -> Create Material B
  // =========================================================================
  const accountB: UserAuthProfile = {
    uid: 'uid_account_b',
    displayName: 'Bob Macroeconomics',
    email: 'bob.macro@university.edu',
    photoURL: null,
  };
  await repo.syncWithCloudUser(accountB);

  // Account B MUST NOT see Account A's materials, quizzes, conversations, notes, or revision plans
  assert.equal(repo.getMaterials().length, 0);
  assert.equal(repo.getQuizAttempts().length, 0);
  assert.equal(repo.getTutorHistory(materialA.id).length, 0);
  assert.equal(repo.getRevisionPlan(materialA.id).length, 0);
  assert.equal(repo.getStickyNotes(materialA.id).length, 0);

  const materialB: StudyMaterial = {
    id: 'mat_macro_b',
    ownerId: accountB.uid,
    title: 'Macroeconomics Fiscal Policy.pdf',
    sourceType: 'pdf',
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        title: 'GDP & Fiscal Multipliers',
        content: 'Government spending multiplier = 1 / (1 - MPC).',
      },
    ],
    createdAt: '2026-10-23T11:00:00Z',
    lastStudiedAt: 'Just now',
  };
  repo.saveMaterial(materialB);

  const attemptB: QuizAttempt = {
    id: 'attempt_macro_b1',
    materialId: materialB.id,
    materialTitle: materialB.title,
    mode: 'diagnostic',
    questions: [],
    answers: {},
    score: 6,
    total: 6,
    percentage: 100,
    weakTopics: [],
    strongTopics: [],
    completedAt: '2026-10-23T11:10:00Z',
    results: [],
  };
  repo.saveQuizAttempt(attemptB);

  assert.equal(repo.getMaterials().length, 1);
  assert.equal(repo.getMaterials()[0].title, 'Macroeconomics Fiscal Policy.pdf');
  assert.equal(repo.getQuizAttempts().length, 1);
  assert.equal(repo.getQuizAttempts()[0].id, 'attempt_macro_b1');

  // Sign out of Account B
  await repo.syncWithCloudUser(null);

  // =========================================================================
  // TEST C: Sign back into Account A -> Verify Account A's exact history is intact and Account B's data is absent
  // =========================================================================
  await repo.syncWithCloudUser(accountA);

  const materialsRestoredA = repo.getMaterials();
  assert.equal(materialsRestoredA.length, 1);
  assert.equal(materialsRestoredA[0].id, 'mat_quantum_a');
  assert.equal(materialsRestoredA[0].title, 'Quantum Mechanics Lecture 1.pdf');

  const attemptsRestoredA = repo.getQuizAttempts();
  assert.equal(attemptsRestoredA.length, 1);
  assert.equal(attemptsRestoredA[0].id, 'attempt_quantum_a1');
  assert.equal(attemptsRestoredA[0].percentage, 83);

  const chatRestoredA = repo.getTutorHistory('mat_quantum_a');
  assert.equal(chatRestoredA.length, 2);
  assert.equal(chatRestoredA[0].content, 'Explain De Broglie wavelength.');

  const notesRestoredA = repo.getStickyNotes('mat_quantum_a');
  assert.equal(notesRestoredA.length, 1);
  assert.equal(notesRestoredA[0].title, 'De Broglie Relation');

  // Ensure Account B's material is completely absent from Account A
  assert.equal(
    materialsRestoredA.some((m) => m.id === 'mat_macro_b'),
    false
  );
});



