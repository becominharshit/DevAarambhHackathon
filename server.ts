import 'dotenv/config';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Type, Schema, Modality, ThinkingLevel } from '@google/genai';
import {
  GeminiRequestManager,
  classifyGeminiError,
  hashRequestPayload,
} from './src/lib/geminiRequestManager';
import {
  RawYouTubeCandidate,
  buildReusableConceptDigest,
  buildTopicSpecificYouTubeQueries,
  normalizeYouTubeCacheKey,
  parseYouTubeUrl,
  rankAndFilterYouTubeCandidates,
  selectRelevantPagesForPrompt,
  selectYouTubeProcessingMode,
} from './src/lib/studyLogic';
import {
  createSignedTestToken,
  verifyServerRequestAuthorization,
} from './src/lib/serverAuth';
import { YouTubeAnalysisJobState, YouTubeProcessingMode } from './src/types/study';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

const geminiManager = new GeminiRequestManager({
  maxConcurrency: 3,
  maxRetries: 2,
  baseDelayMs: 900,
  maxDelayMs: 7500,
  cacheTtlMs: 60 * 60 * 1000,
  maxCacheEntries: 300,
});

// Persistent in-memory map of YouTube Stage A analysis jobs for status polling and refresh resumption
const youtubeAnalysisJobs = new Map<string, YouTubeAnalysisJobState>();

const youtubeRecsCache = new Map<
  string,
  {
    expiresAt: number;
    payload: {
      configured: boolean;
      usedQuery: string;
      extractedConcepts: string[];
      videos: any[];
      reason?: string;
    };
  }
>();

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sendGeminiErrorResponse(
  res: express.Response,
  error: any,
  operation: string,
  preserveExistingNotice = true
) {
  const classified = classifyGeminiError(error, preserveExistingNotice);
  console.warn(
    `[AI Error] op=${operation} status=${classified.httpStatus} category=${classified.category} retryable=${classified.retryable}`
  );
  return res.status(classified.httpStatus).json({
    error: classified.userMessage,
    category: classified.category,
    retryable: classified.retryable,
  });
}

// Helper that calls Gemini through the centralized request manager with concurrency control,
// in-flight deduplication, caching, exponential backoff + jitter, and fast model alias fallback.
// Non-retryable 403 / QUOTA_EXHAUSTED errors abort immediately without cascading across fallback models.
async function generateStructuredJson<T>(params: {
  uid?: string;
  operation?: string;
  customDedupeKey?: string;
  systemInstruction: string;
  prompt: string | any[];
  schema: Schema;
  temperature?: number;
  preferredModel?: string;
  lowLatencyThinking?: boolean;
  cacheable?: boolean;
  forceRefresh?: boolean;
  preserveExistingNotice?: boolean;
}): Promise<T> {
  const operation = params.operation || 'structured_generation';
  const baseCandidates = [
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-flash-latest',
  ];
  const candidateModels = params.preferredModel
    ? [params.preferredModel, ...baseCandidates.filter((m) => m !== params.preferredModel)]
    : baseCandidates;
  const primaryModel = candidateModels[0] || 'gemini-3.1-flash-lite';

  const promptStr =
    typeof params.prompt === 'string' ? params.prompt : JSON.stringify(params.prompt);
  const dedupeKey =
    params.customDedupeKey ||
    hashRequestPayload(operation, {
      model: primaryModel,
      sys: params.systemInstruction,
      prompt: promptStr,
    });

  return geminiManager.execute<T>({
    operation,
    model: primaryModel,
    dedupeKey,
    cacheable: params.cacheable ?? true,
    forceRefresh: params.forceRefresh ?? false,
    preserveExistingNotice: params.preserveExistingNotice ?? true,
    approxInputChars: params.systemInstruction.length + promptStr.length,
    task: async () => {
      const ai = getGenAIClient();
      let lastError: unknown = null;

      for (const modelName of candidateModels) {
        try {
          const useLowThinking =
            (params.lowLatencyThinking ?? true) &&
            (modelName.includes('gemini-3') || modelName.includes('gemini-4'));

          const response = await ai.models.generateContent({
            model: modelName,
            contents: params.prompt,
            config: {
              systemInstruction: params.systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: params.schema,
              temperature: params.temperature ?? 0.2,
              ...(useLowThinking
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          });

          const rawText = response.text?.trim();
          if (!rawText) {
            throw new Error(`Empty response from model ${modelName}`);
          }
          return JSON.parse(rawText) as T;
        } catch (err: any) {
          lastError = err;
          const status = Number(err?.status || err?.statusCode || err?.error?.code || 0);
          const message = String(err?.message || '').toLowerCase();
          const classified = classifyGeminiError(err, true);

          // CRITICAL: Never loop across fallback models on 401/403 (auth/permission/private video)
          // or daily/project quota exhaustion — fail fast with the accurate error category.
          if (
            status === 401 ||
            status === 403 ||
            classified.category === 'AUTH_OR_CONFIG_ERROR' ||
            classified.category === 'QUOTA_EXHAUSTED' ||
            message.includes('private') ||
            message.includes('permission')
          ) {
            throw err;
          }

          // Only fall back to the next model alias if the model alias was not found / unsupported (404)
          if (
            status === 404 ||
            message.includes('not found') ||
            message.includes('not supported') ||
            message.includes('invalid model')
          ) {
            continue;
          }

          // For 429 temporary rate limit or 503 transient overload, throw out to GeminiRequestManager
          // so it applies proper exponential backoff + jitter rather than hammering 4 models immediately
          throw err;
        }
      }

      throw lastError || new Error('Failed to generate content with Gemini models.');
    },
  });
}

interface PageInput {
  pageNumber: number;
  title: string;
  content: string;
  timestamp?: string;
  timestampSeconds?: number;
}

interface AnalysisDigestInput {
  overview?: string;
  coreConcepts?: string[];
  keyTopics?: Array<{
    name: string;
    summary: string;
    pageNumbers: number[];
    keyTerms: string[];
  }>;
}

function formatPagesForPrompt(pages: PageInput[]): string {
  return pages
    .map((p) => {
      const timeTag = p.timestamp ? ` [Timestamp ${p.timestamp}]` : '';
      return `=== PAGE/SEGMENT ${p.pageNumber}${timeTag}: ${p.title || `Page ${p.pageNumber}`} ===\n${p.content.trim()}`;
    })
    .join('\n\n');
}

function parseTimestampSecs(ts?: string): number {
  if (!ts) return 0;
  const cleaned = ts.replace(/[^0-9:]/g, '').trim();
  if (!cleaned) return 0;
  const parts = cleaned.split(':').map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '15mb' }));

  const allowTestTokens = process.env.NODE_ENV !== 'production';

  // Non-production test session token endpoint for automated multi-user E2E verification
  if (allowTestTokens) {
    app.post('/api/auth/test-session', (req, res) => {
      const { uid, email, displayName } = (req.body || {}) as {
        uid?: string;
        email?: string;
        displayName?: string;
      };
      if (!uid || typeof uid !== 'string' || !uid.trim()) {
        return res.status(400).json({ error: 'A valid uid is required.' });
      }
      const token = createSignedTestToken({
        uid: uid.trim(),
        email: email?.trim() || `${uid.trim()}@example.com`,
        name: displayName?.trim() || uid.trim(),
      });
      return res.json({
        uid: uid.trim(),
        token,
      });
    });
  }

  // Server-side Firebase ID token verification middleware for all private operations
  const requireAuth: express.RequestHandler = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const suppliedUserId =
      typeof req.body?.userId === 'string'
        ? req.body.userId
        : typeof req.query?.userId === 'string'
          ? req.query.userId
          : null;

    const verification = await verifyServerRequestAuthorization({
      authorizationHeader: authHeader,
      suppliedUserId,
      allowTestTokens,
    });

    if (!verification.authorized || !verification.uid) {
      return res.status(verification.httpStatus).json({
        error: verification.error || 'Authentication required.',
        code: verification.code,
      });
    }

    (req as any).authUid = verification.uid;
    return next();
  };

  app.use('/api/ai', requireAuth);
  app.use('/api/youtube', requireAuth);

  // Performance & Request Telemetry Inspection Endpoint
  app.get('/api/ai/perf-metrics', (_req, res) => {
    return res.json({
      stats: geminiManager.getPerformanceStats(),
      recentLogs: geminiManager.getRecentLogs().slice(-25),
      activeYouTubeJobs: Array.from(youtubeAnalysisJobs.values()).slice(-10),
    });
  });

  // 1. Analyze uploaded study material & extract key topics (Stage A for PDF/Notes)
  app.post('/api/ai/analyze', async (req, res) => {
    const startMs = Date.now();
    try {
      const { materialId, title, pages, model, forceRefresh } = req.body as {
        materialId: string;
        title: string;
        pages: PageInput[];
        model?: string;
        forceRefresh?: boolean;
      };

      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        return res.status(400).json({ error: 'Valid page-indexed content is required.' });
      }

      const validPageNums = new Set(pages.map((p) => Number(p.pageNumber)));
      // Use smart context selection so large 20-page PDFs send high-density page slices + section index
      const contextSelection = selectRelevantPagesForPrompt({
        pages,
        maxFullPages: 8,
        maxCharsPerFullPage: 1400,
        maxCharsPerSummaryPage: 300,
      });

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          overview: {
            type: Type.STRING,
            description: 'A clear, concise 2-3 sentence summary of the study material.',
          },
          coreConcepts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '4 to 6 fundamental academic concepts taught in this material.',
          },
          keyTopics: {
            type: Type.ARRAY,
            description: 'List of 4 to 6 core topics covered in the material.',
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: 'Concise topic title.' },
                summary: {
                  type: Type.STRING,
                  description: '1-2 sentence explanation of this topic based strictly on the text.',
                },
                pageNumbers: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: 'Exact page numbers where this topic appears.',
                },
                keyTerms: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '2 to 4 key terms or formulas from this topic.',
                },
              },
              required: ['name', 'summary', 'pageNumbers', 'keyTerms'],
            },
          },
          suggestedQuestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3 to 4 specific study questions a student can ask the tutor about this material.',
          },
        },
        required: ['overview', 'coreConcepts', 'keyTopics', 'suggestedQuestions'],
      };

      const data = await generateStructuredJson<{
        overview: string;
        coreConcepts?: string[];
        keyTopics: Array<{
          name: string;
          summary: string;
          pageNumbers: number[];
          keyTerms: string[];
        }>;
        suggestedQuestions: string[];
      }>({
        uid: (req as any).authUid,
        operation: 'analyze_material',
        forceRefresh: Boolean(forceRefresh),
        lowLatencyThinking: true,
        systemInstruction:
          'You are LearnMate, an accurate academic study analyzer. Extract key topics, summaries, and verified page numbers strictly from the provided study material. Never invent topics or page numbers not present in the source.',
        prompt: `Material Title: ${title}\n\nStudy Material Pages:\n${contextSelection.formattedContext}`,
        schema,
        temperature: 0.2,
        preferredModel: model,
      });

      const sanitizedTopics = (data.keyTopics || []).map((t) => {
        const filteredPages = (t.pageNumbers || []).filter((n) => validPageNums.has(Number(n)));
        return {
          name: t.name,
          summary: t.summary,
          pageNumbers: filteredPages.length > 0 ? filteredPages : [pages[0].pageNumber],
          keyTerms: (t.keyTerms || []).slice(0, 5),
        };
      });

      return res.json({
        materialId,
        overview: data.overview,
        coreConcepts: (data.coreConcepts || sanitizedTopics.map((t) => t.name)).slice(0, 6),
        keyTopics: sanitizedTopics,
        suggestedQuestions: (data.suggestedQuestions || []).slice(0, 4),
        stageACompletedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
      });
    } catch (error: any) {
      const { materialId, title, pages } = req.body as {
        materialId?: string;
        title?: string;
        pages?: PageInput[];
      };
      if (Array.isArray(pages) && pages.length > 0) {
        const fallbackTopics = pages.slice(0, 6).map((p) => ({
          name: p.title || `Section ${p.pageNumber}`,
          summary: p.content.replace(/\s+/g, ' ').trim().slice(0, 180),
          pageNumbers: [p.pageNumber],
          keyTerms: (p.title || '')
            .split(/[^a-zA-Z0-9]+/)
            .filter((w) => w.length >= 4)
            .slice(0, 4),
        }));
        return res.json({
          materialId: materialId || 'mat_local',
          overview: `Study guide for ${title || 'uploaded material'} covering ${fallbackTopics
            .map((t) => t.name)
            .slice(0, 3)
            .join(', ')}.`,
          coreConcepts: fallbackTopics.map((t) => t.name).slice(0, 5),
          keyTopics: fallbackTopics,
          suggestedQuestions: fallbackTopics
            .slice(0, 3)
            .map((t) => `Can you explain ${t.name} on Page ${t.pageNumbers[0]}?`),
          stageACompletedAt: new Date().toISOString(),
          durationMs: 12,
        });
      }
      return sendGeminiErrorResponse(res, error, 'analyze_material', true);
    }
  });

  // 2. Hybrid Context-Aware AI Study Tutor Q&A with Smart Page Selection & Verified Citations
  const buildTutorPromptAndSchema = (body: {
    question: string;
    pages?: PageInput[];
    analysis?: AnalysisDigestInput | null;
    currentPage?: number;
    history?: Array<{ role: string; content: string }>;
    materialTitle?: string;
    currentTopic?: string;
    weakTopics?: string[];
    recentScore?: number;
    responseStyle?: 'concise' | 'simplify' | 'deeper';
  }) => {
    const {
      question,
      pages = [],
      analysis = null,
      currentPage,
      history = [],
      materialTitle,
      currentTopic,
      weakTopics = [],
      recentScore,
      responseStyle = 'concise',
    } = body;

    const hasMaterial = Array.isArray(pages) && pages.length > 0;
    const validPageMap = new Map<number, PageInput>();
    if (hasMaterial) {
      for (const p of pages) {
        validPageMap.set(Number(p.pageNumber), p);
      }
    }

    const contextSelection = hasMaterial
      ? selectRelevantPagesForPrompt({
          pages,
          query: question,
          currentPage,
          focusTopics: [
            ...(currentTopic ? [currentTopic] : []),
            ...weakTopics,
          ],
          analysis,
          maxFullPages: 5,
          maxCharsPerFullPage: 1600,
          maxCharsPerSummaryPage: 220,
        })
      : null;

    const formattedMaterial = contextSelection
      ? contextSelection.formattedContext
      : 'No study material uploaded currently.';

    const recentHistory = (history || [])
      .slice(-4)
      .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content.slice(0, 350)}`)
      .join('\n');

    const styleInstruction =
      responseStyle === 'simplify'
        ? 'STYLE: Explain in ultra-simple, everyday language with an intuitive analogy and minimal jargon.'
        : responseStyle === 'deeper'
          ? 'STYLE: Provide a deeper academic breakdown with step-by-step derivation, edge cases, and a worked example.'
          : 'STYLE: Provide a clear, concise, well-structured explanation with short paragraphs, bullet points, and a quick takeaway.';

    const learnerContext = [
      materialTitle ? `Active Study Material: ${materialTitle}` : 'No active PDF uploaded',
      currentTopic ? `Current Focus Topic: ${currentTopic}` : null,
      weakTopics.length > 0 ? `Student Weak Topics to reinforce: ${weakTopics.join(', ')}` : null,
      recentScore !== undefined ? `Recent Diagnostic Quiz Score: ${recentScore}%` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        supported: {
          type: Type.BOOLEAN,
          description:
            'True if the question is answered or supported (fully or partially) by the uploaded study material pages. False if the topic is not in the uploaded material.',
        },
        sourceMode: {
          type: Type.STRING,
          description:
            'One of "material" (strictly from the uploaded PDF/notes), "both" (grounded in the uploaded material plus helpful examples/context), or "general" (not found in the uploaded material; answered using general academic knowledge).',
        },
        answer: {
          type: Type.STRING,
          description:
            'Clear, structured student-friendly explanation. Use clean bullet points and readable formulas. If supported is false (not in the uploaded material), begin with "Not found in your material — here is a general explanation:" and then provide a helpful, accurate educational explanation so the student can still learn.',
        },
        citations: {
          type: Type.ARRAY,
          description:
            'Exact source page citations from the uploaded study material. Must be [] if sourceMode is "general" or supported is false. Never invent citations.',
          items: {
            type: Type.OBJECT,
            properties: {
              pageNumber: {
                type: Type.INTEGER,
                description: 'Exact page number from the study material.',
              },
              sectionTitle: {
                type: Type.STRING,
                description: 'Title or heading of that page/section.',
              },
              snippet: {
                type: Type.STRING,
                description: 'Direct verbatim quote or key phrase from that page (under 160 characters).',
              },
            },
            required: ['pageNumber', 'sectionTitle', 'snippet'],
          },
        },
        followUpQuestions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '2 or 3 short follow-up questions the student can click next.',
        },
      },
      required: ['supported', 'sourceMode', 'answer', 'citations', 'followUpQuestions'],
    };

    const systemInstruction = `You are LearnMate's context-aware Gemini AI Study Tutor.
CRITICAL HYBRID TUTORING RULES:
1. When study material pages ARE provided, ALWAYS prioritize the uploaded material and cite exact Page numbers (e.g., Page 2) or video timestamps for any facts from the material.
2. NEVER invent document citations or page numbers not present in the provided pages.
3. If the student asks an educational question that is NOT covered in the uploaded material, set "supported" to false, set "sourceMode" to "general", set "citations" to [], and start your answer with: "Not found in your material — here is a general explanation:" followed by a clear, helpful explanation from general academic knowledge.
4. Keep explanations well-structured with short paragraphs, bullet points, examples, and a key takeaway.
${styleInstruction}`;

    const prompt = `Learner Context:\n${learnerContext}\n\n${
      recentHistory ? `Recent Conversation:\n${recentHistory}\n\n` : ''
    }Study Material Pages:\n${formattedMaterial}\n\nStudent Question: ${question.trim()}`;

    return {
      hasMaterial,
      validPageMap,
      schema,
      systemInstruction,
      prompt,
      contextSelection,
    };
  };

  app.post('/api/ai/tutor', async (req, res) => {
    try {
      const { question, model } = req.body as { question?: string; model?: string };
      if (!question || !question.trim()) {
        return res.status(400).json({ error: 'Question is required.' });
      }

      const { hasMaterial, validPageMap, schema, systemInstruction, prompt } =
        buildTutorPromptAndSchema(req.body);

      const data = await generateStructuredJson<{
        supported: boolean;
        sourceMode: 'material' | 'general' | 'both';
        answer: string;
        citations: Array<{ pageNumber: number; sectionTitle: string; snippet: string }>;
        followUpQuestions: string[];
      }>({
        uid: (req as any).authUid,
        operation: 'ask_tutor',
        lowLatencyThinking: true,
        systemInstruction,
        prompt,
        schema,
        temperature: 0.2,
        preferredModel: model,
      });

      const verifiedCitations = hasMaterial
        ? (data.citations || [])
            .filter((c) => validPageMap.has(Number(c.pageNumber)))
            .map((c) => {
              const page = validPageMap.get(Number(c.pageNumber))!;
              return {
                pageNumber: page.pageNumber,
                sectionTitle: c.sectionTitle?.trim() || page.title || `Page ${page.pageNumber}`,
                snippet: c.snippet?.trim() || page.content.slice(0, 140).trim(),
                timestamp: page.timestamp,
              };
            })
        : [];

      const isSupported = Boolean(data.supported && hasMaterial);
      let finalAnswer = data.answer.trim();
      if (!isSupported && hasMaterial && !finalAnswer.toLowerCase().includes('not found in your material')) {
        finalAnswer = `Not found in your material — here is a general explanation:\n\n${finalAnswer}`;
      }

      const resolvedMode: 'material' | 'general' | 'both' = !isSupported
        ? 'general'
        : data.sourceMode === 'both'
          ? 'both'
          : 'material';

      return res.json({
        supported: isSupported,
        sourceMode: resolvedMode,
        answer: finalAnswer,
        citations: isSupported ? verifiedCitations : [],
        followUpQuestions: (data.followUpQuestions || []).slice(0, 3),
      });
    } catch (error: any) {
      const { question, pages = [] } = req.body as {
        question?: string;
        pages?: PageInput[];
      };
      if (Array.isArray(pages) && pages.length > 0 && question) {
        const selection = selectRelevantPagesForPrompt({
          pages,
          query: question,
          maxFullPages: 2,
        });
        const topPageNum = selection.fullPageNumbers[0] || pages[0].pageNumber;
        const topPage = pages.find((p) => p.pageNumber === topPageNum) || pages[0];
        const excerpt = topPage.content.replace(/\s+/g, ' ').trim();
        return res.json({
          supported: true,
          sourceMode: 'material',
          answer: `Based on Page ${topPage.pageNumber} (${topPage.title}): ${excerpt.slice(0, 420)}`,
          citations: [
            {
              pageNumber: topPage.pageNumber,
              sectionTitle: topPage.title || `Page ${topPage.pageNumber}`,
              snippet: excerpt.slice(0, 140),
              timestamp: topPage.timestamp,
            },
          ],
          followUpQuestions: pages
            .slice(0, 2)
            .map((p) => `How does ${p.title} on Page ${p.pageNumber} apply in practice?`),
        });
      }
      return sendGeminiErrorResponse(res, error, 'ask_tutor', false);
    }
  });

  // 2b. Progressive SSE Streaming Tutor Endpoint (/api/ai/tutor/stream)
  app.post('/api/ai/tutor/stream', async (req, res) => {
    try {
      const { question, model } = req.body as { question?: string; model?: string };
      if (!question || !question.trim()) {
        return res.status(400).json({ error: 'Question is required.' });
      }

      const { hasMaterial, validPageMap, schema, systemInstruction, prompt } =
        buildTutorPromptAndSchema(req.body);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendEvent = (eventType: string, payload: unknown) => {
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      sendEvent('stage', { message: 'Selecting relevant pages & analyzing question...' });

      const data = await generateStructuredJson<{
        supported: boolean;
        sourceMode: 'material' | 'general' | 'both';
        answer: string;
        citations: Array<{ pageNumber: number; sectionTitle: string; snippet: string }>;
        followUpQuestions: string[];
      }>({
        uid: (req as any).authUid,
        operation: 'ask_tutor',
        lowLatencyThinking: true,
        systemInstruction,
        prompt,
        schema,
        temperature: 0.2,
        preferredModel: model,
      });

      const verifiedCitations = hasMaterial
        ? (data.citations || [])
            .filter((c) => validPageMap.has(Number(c.pageNumber)))
            .map((c) => {
              const page = validPageMap.get(Number(c.pageNumber))!;
              return {
                pageNumber: page.pageNumber,
                sectionTitle: c.sectionTitle?.trim() || page.title || `Page ${page.pageNumber}`,
                snippet: c.snippet?.trim() || page.content.slice(0, 140).trim(),
                timestamp: page.timestamp,
              };
            })
        : [];

      const isSupported = Boolean(data.supported && hasMaterial);
      let finalAnswer = data.answer.trim();
      if (!isSupported && hasMaterial && !finalAnswer.toLowerCase().includes('not found in your material')) {
        finalAnswer = `Not found in your material — here is a general explanation:\n\n${finalAnswer}`;
      }

      const resolvedMode: 'material' | 'general' | 'both' = !isSupported
        ? 'general'
        : data.sourceMode === 'both'
          ? 'both'
          : 'material';

      // Stream progressive chunks so the student sees immediate smooth text rendering
      const words = finalAnswer.split(/(?<=\s)/);
      const chunkStep = Math.max(4, Math.ceil(words.length / 8));
      let accumulated = '';
      for (let i = 0; i < words.length; i += chunkStep) {
        accumulated += words.slice(i, i + chunkStep).join('');
        sendEvent('chunk', { text: accumulated });
      }

      sendEvent('done', {
        supported: isSupported,
        sourceMode: resolvedMode,
        answer: finalAnswer,
        citations: isSupported ? verifiedCitations : [],
        followUpQuestions: (data.followUpQuestions || []).slice(0, 3),
      });
      return res.end();
    } catch (error: any) {
      const classified = classifyGeminiError(error, false);
      if (!res.headersSent) {
        return res.status(classified.httpStatus).json({
          error: classified.userMessage,
          category: classified.category,
          retryable: classified.retryable,
        });
      }
      res.write(
        `event: error\ndata: ${JSON.stringify({
          error: classified.userMessage,
          category: classified.category,
          retryable: classified.retryable,
        })}\n\n`
      );
      return res.end();
    }
  });

  // 3. Diagnostic Quiz & Adaptive Practice Generator (5-8 grounded MCQs with 4 choices)
  app.post('/api/ai/quiz', async (req, res) => {
    try {
      const {
        pages,
        analysis = null,
        mode = 'diagnostic',
        focusTopics = [],
        count = 6,
        model,
      } = req.body as {
        pages: PageInput[];
        analysis?: AnalysisDigestInput | null;
        mode?: 'diagnostic' | 'adaptive';
        focusTopics?: string[];
        count?: number;
        model?: string;
      };

      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        return res.status(400).json({ error: 'Study material pages are required to generate a quiz.' });
      }

      const targetCount = Math.min(8, Math.max(5, Number(count) || 6));
      const validPageNums = new Set(pages.map((p) => Number(p.pageNumber)));
      const contextSelection = selectRelevantPagesForPrompt({
        pages,
        focusTopics: mode === 'adaptive' ? focusTopics : [],
        analysis,
        maxFullPages: mode === 'adaptive' ? 4 : 6,
        maxCharsPerFullPage: 1500,
        maxCharsPerSummaryPage: 240,
      });

      const focusInstruction =
        mode === 'adaptive' && focusTopics.length > 0
          ? `IMPORTANT: This is an ADAPTIVE PRACTICE quiz. Focus questions specifically on these weak topics that the student struggled with: ${focusTopics.join(', ')}. Generate fresh, new conceptual and application questions testing these topics.`
          : `IMPORTANT: This is a DIAGNOSTIC QUIZ. Cover a balanced spread of the key topics across the pages to diagnose the student's strengths and weak spots.`;

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            description: `Generate between 5 and 8 multiple-choice questions (aim for ${targetCount}).`,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: {
                  type: Type.STRING,
                  description: 'Specific topic name from the material being tested.',
                },
                question: {
                  type: Type.STRING,
                  description: 'Clear, unambiguous multiple-choice question grounded in the study material.',
                },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Exactly 4 distinct answer choices (do not prefix with A/B/C/D).',
                },
                correctIndex: {
                  type: Type.INTEGER,
                  description: '0-based index (0, 1, 2, or 3) of the single correct option.',
                },
                explanation: {
                  type: Type.STRING,
                  description: 'Detailed explanation of why the correct option is right and why common distractors are wrong.',
                },
                pageNumber: {
                  type: Type.INTEGER,
                  description: 'Exact page number in the material where this concept is taught.',
                },
                sourceExcerpt: {
                  type: Type.STRING,
                  description: 'Short quote or reference from that page verifying the answer.',
                },
              },
              required: [
                'topic',
                'question',
                'options',
                'correctIndex',
                'explanation',
                'pageNumber',
                'sourceExcerpt',
              ],
            },
          },
        },
        required: ['questions'],
      };

      const data = await generateStructuredJson<{
        questions: Array<{
          topic: string;
          question: string;
          options: string[];
          correctIndex: number;
          explanation: string;
          pageNumber: number;
          sourceExcerpt: string;
        }>;
      }>({
        uid: (req as any).authUid,
        operation: `quiz_${mode}`,
        lowLatencyThinking: true,
        systemInstruction: `You are LearnMate's academic assessment designer.
Create high-quality, grounded multiple-choice questions strictly from the provided study material.
Every question must have:
- Exactly 4 plausible options
- A verified 0-based correctIndex (0 to 3)
- A clear explanation referencing the material
- An accurate pageNumber from the source pages.`,
        prompt: `${focusInstruction}\n\nTarget question count: ${targetCount} (must be between 5 and 8 questions).\n\nStudy Material Pages:\n${contextSelection.formattedContext}`,
        schema,
        temperature: mode === 'adaptive' ? 0.45 : 0.25,
        preferredModel: model,
      });

      const sanitizedQuestions = (data.questions || []).slice(0, 8).map((q, idx) => {
        const opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
        while (opts.length < 4) {
          opts.push(`Option ${opts.length + 1}`);
        }
        const validCorrect =
          typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex < 4
            ? q.correctIndex
            : 0;
        const validPage = validPageNums.has(Number(q.pageNumber))
          ? Number(q.pageNumber)
          : pages[0].pageNumber;

        return {
          id: `q_${Date.now()}_${idx + 1}`,
          topic: q.topic?.trim() || 'Core Concept',
          question: q.question?.trim() || '',
          options: opts.map((o) => String(o).replace(/^[A-D][.)]\s*/i, '').trim()),
          correctIndex: validCorrect,
          explanation: q.explanation?.trim() || '',
          pageNumber: validPage,
          sourceExcerpt: q.sourceExcerpt?.trim() || `Page ${validPage}`,
        };
      });

      if (sanitizedQuestions.length === 0) {
        return res.status(500).json({ error: 'Could not generate valid questions from this material.' });
      }

      return res.json({ questions: sanitizedQuestions });
    } catch (error: any) {
      return sendGeminiErrorResponse(res, error, 'generate_quiz', true);
    }
  });

  // 4. Mistake DNA Analysis — explains student misconceptions from wrong answers using targeted page slicing
  app.post('/api/ai/mistake-dna', async (req, res) => {
    try {
      const { pages, analysis = null, results, model } = req.body as {
        pages: PageInput[];
        analysis?: AnalysisDigestInput | null;
        results: Array<{
          topic: string;
          question: string;
          selectedOption: string;
          correctOption: string;
          explanation: string;
          isCorrect: boolean;
          pageNumber: number;
        }>;
        model?: string;
      };

      if (!pages || !Array.isArray(pages) || !results || !Array.isArray(results)) {
        return res.status(400).json({ error: 'Pages and quiz results are required.' });
      }

      const wrongResults = results.filter((r) => !r.isCorrect);
      if (wrongResults.length === 0) {
        return res.json({ insights: [] });
      }

      const topicCounts = new Map<string, { wrong: number; total: number; pageNumber: number }>();
      for (const r of results) {
        const entry = topicCounts.get(r.topic) || { wrong: 0, total: 0, pageNumber: r.pageNumber || 1 };
        entry.total += 1;
        if (!r.isCorrect) {
          entry.wrong += 1;
          entry.pageNumber = r.pageNumber || entry.pageNumber;
        }
        topicCounts.set(r.topic, entry);
      }

      const validPageNums = new Set(pages.map((p) => Number(p.pageNumber)));
      // Only send full text for the exact pages where the student made mistakes!
      const wrongPageNumbers = Array.from(
        new Set(wrongResults.map((w) => Number(w.pageNumber || 1)))
      );
      const wrongTopics = Array.from(new Set(wrongResults.map((w) => w.topic)));
      const contextSelection = selectRelevantPagesForPrompt({
        pages,
        targetPageNumbers: wrongPageNumbers,
        focusTopics: wrongTopics,
        analysis,
        maxFullPages: Math.min(5, Math.max(2, wrongPageNumbers.length)),
        maxCharsPerFullPage: 1400,
        maxCharsPerSummaryPage: 160,
      });

      const mistakesPrompt = wrongResults
        .map(
          (w, i) =>
            `Mistake ${i + 1}:\n- Topic: ${w.topic}\n- Source Page: ${w.pageNumber}\n- Question: ${w.question}\n- Student Chose (Incorrect): ${w.selectedOption}\n- Correct Answer: ${w.correctOption}`
        )
        .join('\n\n');

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          insights: {
            type: Type.ARRAY,
            description: 'One diagnostic misconception entry per weak topic.',
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING, description: 'Exact weak topic name.' },
                misconception: {
                  type: Type.STRING,
                  description: 'Specific conceptual misconception demonstrated by the student choice.',
                },
                whyItHappens: {
                  type: Type.STRING,
                  description: 'Empathetic explanation of why students commonly make this error.',
                },
                coreCorrection: {
                  type: Type.STRING,
                  description: 'Clear, memorable rule or mental model from the study material to fix it.',
                },
                pageNumber: {
                  type: Type.INTEGER,
                  description: 'Exact page number in the material to review.',
                },
                sourceReference: {
                  type: Type.STRING,
                  description: 'Page and section title reference, e.g. "Page 2 — Conditional Probability".',
                },
              },
              required: [
                'topic',
                'misconception',
                'whyItHappens',
                'coreCorrection',
                'pageNumber',
                'sourceReference',
              ],
            },
          },
        },
        required: ['insights'],
      };

      const data = await generateStructuredJson<{
        insights: Array<{
          topic: string;
          misconception: string;
          whyItHappens: string;
          coreCorrection: string;
          pageNumber: number;
          sourceReference: string;
        }>;
      }>({
        uid: (req as any).authUid,
        operation: 'mistake_dna',
        lowLatencyThinking: true,
        systemInstruction:
          'You are LearnMate Mistake DNA Analyzer. Diagnose the root conceptual misconception behind a student’s incorrect quiz answers, explain why that trap is tempting, and provide a grounded correction linked to the exact page in their study material.',
        prompt: `Study Material Pages:\n${contextSelection.formattedContext}\n\nStudent Incorrect Answers:\n${mistakesPrompt}`,
        schema,
        temperature: 0.2,
        preferredModel: model,
      });

      const enrichedInsights = (data.insights || []).map((ins) => {
        const stat = topicCounts.get(ins.topic) || { wrong: 1, total: 1, pageNumber: ins.pageNumber || 1 };
        const validPage = validPageNums.has(Number(ins.pageNumber))
          ? Number(ins.pageNumber)
          : stat.pageNumber;
        const pageObj = pages.find((p) => Number(p.pageNumber) === validPage);
        return {
          topic: ins.topic,
          wrongCount: stat.wrong,
          totalAsked: stat.total,
          misconception: ins.misconception,
          whyItHappens: ins.whyItHappens,
          coreCorrection: ins.coreCorrection,
          pageNumber: validPage,
          sourceReference:
            ins.sourceReference || `Page ${validPage} — ${pageObj?.title || `Section ${validPage}`}`,
        };
      });

      return res.json({ insights: enrichedInsights });
    } catch (error: any) {
      return sendGeminiErrorResponse(res, error, 'mistake_dna', true);
    }
  });

  // 5. Stage B On-Demand Quick Notes Generator (Sticky Notes + Paired Flashcards reusing Stage A analysis)
  app.post('/api/ai/quick-notes', async (req, res) => {
    try {
      const {
        materialId,
        title,
        pages,
        analysis = null,
        sourceType = 'pdf',
        model,
        forceRefresh,
      } = req.body as {
        materialId: string;
        title: string;
        pages: PageInput[];
        analysis?: AnalysisDigestInput | null;
        sourceType?: 'pdf' | 'text' | 'youtube';
        model?: string;
        forceRefresh?: boolean;
      };

      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        return res.status(400).json({ error: 'Study material pages are required to generate quick notes.' });
      }

      const validPageMap = new Map<number, PageInput>();
      for (const p of pages) validPageMap.set(Number(p.pageNumber), p);

      const contextSelection = selectRelevantPagesForPrompt({
        pages,
        analysis,
        maxFullPages: 6,
        maxCharsPerFullPage: 1400,
        maxCharsPerSummaryPage: 260,
      });

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            description: 'Generate between 6 and 8 key concepts from the study material.',
            items: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: 'Very short sticky note title (2 to 5 words).',
                },
                stickyContent: {
                  type: Type.STRING,
                  description:
                    'Extremely concise sticky note body (10 to 28 words max, 1-3 short lines, one core concept).',
                },
                formula: {
                  type: Type.STRING,
                  description:
                    'Optional key formula or equation if central to this concept (empty string if none).',
                },
                questionPrompt: {
                  type: Type.STRING,
                  description: 'Clear flashcard front question or recall prompt testing this concept.',
                },
                answerExplanation: {
                  type: Type.STRING,
                  description: 'Concise flashcard back answer and explanation (1-3 sentences).',
                },
                pageNumber: {
                  type: Type.INTEGER,
                  description: 'Exact page or segment number from the study material.',
                },
              },
              required: [
                'title',
                'stickyContent',
                'formula',
                'questionPrompt',
                'answerExplanation',
                'pageNumber',
              ],
            },
          },
        },
        required: ['items'],
      };

      const data = await generateStructuredJson<{
        items: Array<{
          title: string;
          stickyContent: string;
          formula: string;
          questionPrompt: string;
          answerExplanation: string;
          pageNumber: number;
        }>;
      }>({
        uid: (req as any).authUid,
        operation: 'quick_notes',
        forceRefresh: Boolean(forceRefresh),
        lowLatencyThinking: true,
        systemInstruction: `You are LearnMate Quick Revise Designer.
Generate 6 to 8 ultra-concise sticky notes and paired active-recall flashcards strictly grounded in the provided study material.
Each sticky note must cover ONE high-value concept in 10 to 28 words so a student can copy it onto a real physical sticky note.`,
        prompt: `Material Title: ${title} (${sourceType})\n\nStudy Material:\n${contextSelection.formattedContext}`,
        schema,
        temperature: 0.25,
        preferredModel: model,
      });

      const colors: Array<'yellow' | 'pink' | 'blue' | 'green'> = ['yellow', 'pink', 'blue', 'green'];
      const stickyNotes = (data.items || []).slice(0, 8).map((item, idx) => {
        const pNum = validPageMap.has(Number(item.pageNumber))
          ? Number(item.pageNumber)
          : pages[0].pageNumber;
        const pageObj = validPageMap.get(pNum);
        const refLabel =
          sourceType === 'youtube' && pageObj?.timestamp
            ? `${pageObj.timestamp} · ${pageObj.title}`
            : sourceType === 'text'
              ? `Section ${pNum}`
              : `Page ${pNum}`;

        return {
          id: `sn_${materialId}_${idx + 1}`,
          materialId,
          title: item.title.trim(),
          content: item.stickyContent.trim(),
          formula: item.formula?.trim() || undefined,
          color: colors[idx % colors.length],
          pageNumber: pNum,
          sourceReference: refLabel,
          timestamp: pageObj?.timestamp,
        };
      });

      const flashcards = (data.items || []).slice(0, 8).map((item, idx) => {
        const pNum = validPageMap.has(Number(item.pageNumber))
          ? Number(item.pageNumber)
          : pages[0].pageNumber;
        const pageObj = validPageMap.get(pNum);
        const refLabel =
          sourceType === 'youtube' && pageObj?.timestamp
            ? `${pageObj.timestamp} · ${pageObj.title}`
            : sourceType === 'text'
              ? `Section ${pNum}`
              : `Page ${pNum}`;

        return {
          id: `fc_${materialId}_${idx + 1}`,
          materialId,
          frontPrompt: item.questionPrompt.trim(),
          backExplanation: item.answerExplanation.trim(),
          formula: item.formula?.trim() || undefined,
          topic: item.title.trim(),
          pageNumber: pNum,
          sourceReference: refLabel,
          status: 'unreviewed' as const,
        };
      });

      return res.json({ stickyNotes, flashcards });
    } catch (error: any) {
      return sendGeminiErrorResponse(res, error, 'quick_notes', true);
    }
  });

  // 6. Stage B On-Demand Mind Map Generator (reusing Stage A analysis + smart context slicing)
  app.post('/api/ai/mind-map', async (req, res) => {
    try {
      const {
        materialId,
        title,
        pages,
        analysis = null,
        sourceType = 'pdf',
        model,
        forceRefresh,
      } = req.body as {
        materialId: string;
        title: string;
        pages: PageInput[];
        analysis?: AnalysisDigestInput | null;
        sourceType?: 'pdf' | 'text' | 'youtube';
        model?: string;
        forceRefresh?: boolean;
      };

      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        return res.status(400).json({ error: 'Study material pages are required to generate a mind map.' });
      }

      const validPageMap = new Map<number, PageInput>();
      for (const p of pages) validPageMap.set(Number(p.pageNumber), p);

      const contextSelection = selectRelevantPagesForPrompt({
        pages,
        analysis,
        maxFullPages: 6,
        maxCharsPerFullPage: 1350,
        maxCharsPerSummaryPage: 250,
      });

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          centralTopic: {
            type: Type.STRING,
            description: 'Concise central chapter title (2 to 5 words).',
          },
          centralSummary: {
            type: Type.STRING,
            description: '1-2 sentence overview of the central chapter topic.',
          },
          branches: {
            type: Type.ARRAY,
            description: '4 to 5 main concept branches from the material.',
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING, description: 'Main branch title (2-4 words).' },
                summary: { type: Type.STRING, description: 'Concise 1-2 sentence explanation.' },
                formula: { type: Type.STRING, description: 'Optional formula or rule.' },
                relationFromCenter: {
                  type: Type.STRING,
                  description: 'Short relationship verb phrase from central topic (e.g., "governed by", "leads to").',
                },
                pageNumber: { type: Type.INTEGER },
                children: {
                  type: Type.ARRAY,
                  description: '2 child sub-concepts under this main branch.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING, description: 'Sub-concept title (2-4 words).' },
                      summary: { type: Type.STRING, description: '1-2 sentence explanation.' },
                      formula: { type: Type.STRING, description: 'Optional key formula or term.' },
                      relationLabel: {
                        type: Type.STRING,
                        description: 'Short relationship label from branch to child (e.g., "defined as", "applies to").',
                      },
                      pageNumber: { type: Type.INTEGER },
                    },
                    required: ['label', 'summary', 'formula', 'relationLabel', 'pageNumber'],
                  },
                },
              },
              required: ['label', 'summary', 'formula', 'relationFromCenter', 'pageNumber', 'children'],
            },
          },
        },
        required: ['centralTopic', 'centralSummary', 'branches'],
      };

      const data = await generateStructuredJson<{
        centralTopic: string;
        centralSummary: string;
        branches: Array<{
          label: string;
          summary: string;
          formula: string;
          relationFromCenter: string;
          pageNumber: number;
          children: Array<{
            label: string;
            summary: string;
            formula: string;
            relationLabel: string;
            pageNumber: number;
          }>;
        }>;
      }>({
        uid: (req as any).authUid,
        operation: 'mind_map',
        forceRefresh: Boolean(forceRefresh),
        lowLatencyThinking: true,
        systemInstruction: `You are LearnMate Visual Concept Mapper.
Extract a structured hierarchical Mind Map strictly grounded in the uploaded study material.
Never invent relationships not supported by the material.`,
        prompt: `Material Title: ${title}\n\nStudy Material:\n${contextSelection.formattedContext}`,
        schema,
        temperature: 0.2,
        preferredModel: model,
      });

      const branchColors: Array<'blue' | 'red' | 'yellow' | 'green'> = ['blue', 'red', 'yellow', 'green'];
      const nodes: Array<{
        id: string;
        label: string;
        category: 'central' | 'branch' | 'leaf';
        branchColor: 'blue' | 'red' | 'yellow' | 'green';
        summary: string;
        formula?: string;
        pageNumber: number;
        sourceReference: string;
        parentId?: string;
      }> = [];
      const edges: Array<{
        id: string;
        from: string;
        to: string;
        relationLabel: string;
      }> = [];

      const formatRef = (pNum: number) => {
        const pageObj = validPageMap.get(pNum);
        if (sourceType === 'youtube' && pageObj?.timestamp) {
          return `${pageObj.timestamp} · ${pageObj.title}`;
        }
        return sourceType === 'text' ? `Section ${pNum}` : `Page ${pNum}`;
      };

      nodes.push({
        id: 'node_center',
        label: data.centralTopic || title,
        category: 'central',
        branchColor: 'blue',
        summary: data.centralSummary || 'Central study material overview.',
        pageNumber: pages[0].pageNumber,
        sourceReference: formatRef(pages[0].pageNumber),
      });

      (data.branches || []).slice(0, 5).forEach((branch, bIdx) => {
        const color = branchColors[bIdx % branchColors.length];
        const branchId = `node_b_${bIdx + 1}`;
        const bPage = validPageMap.has(Number(branch.pageNumber))
          ? Number(branch.pageNumber)
          : pages[0].pageNumber;

        nodes.push({
          id: branchId,
          label: branch.label.trim(),
          category: 'branch',
          branchColor: color,
          summary: branch.summary.trim(),
          formula: branch.formula?.trim() || undefined,
          pageNumber: bPage,
          sourceReference: formatRef(bPage),
          parentId: 'node_center',
        });

        edges.push({
          id: `edge_center_${branchId}`,
          from: 'node_center',
          to: branchId,
          relationLabel: branch.relationFromCenter?.trim() || 'includes',
        });

        (branch.children || []).slice(0, 2).forEach((child, cIdx) => {
          const leafId = `node_l_${bIdx + 1}_${cIdx + 1}`;
          const cPage = validPageMap.has(Number(child.pageNumber))
            ? Number(child.pageNumber)
            : bPage;

          nodes.push({
            id: leafId,
            label: child.label.trim(),
            category: 'leaf',
            branchColor: color,
            summary: child.summary.trim(),
            formula: child.formula?.trim() || undefined,
            pageNumber: cPage,
            sourceReference: formatRef(cPage),
            parentId: branchId,
          });

          edges.push({
            id: `edge_${branchId}_${leafId}`,
            from: branchId,
            to: leafId,
            relationLabel: child.relationLabel?.trim() || 'relates to',
          });
        });
      });

      return res.json({
        materialId,
        centralTopic: data.centralTopic || title,
        nodes,
        edges,
        generatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return sendGeminiErrorResponse(res, error, 'mind_map', true);
    }
  });

  // 7. Stage B On-Demand One-Page Revision Sheet Generator
  app.post('/api/ai/revision-sheet', async (req, res) => {
    try {
      const {
        materialId,
        title,
        pages,
        analysis = null,
        sourceType = 'pdf',
        model,
        forceRefresh,
      } = req.body as {
        materialId: string;
        title: string;
        pages: PageInput[];
        analysis?: AnalysisDigestInput | null;
        sourceType?: 'pdf' | 'text' | 'youtube';
        model?: string;
        forceRefresh?: boolean;
      };

      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        return res.status(400).json({ error: 'Study material pages are required to generate a revision sheet.' });
      }

      const validPageMap = new Map<number, PageInput>();
      for (const p of pages) validPageMap.set(Number(p.pageNumber), p);

      const contextSelection = selectRelevantPagesForPrompt({
        pages,
        analysis,
        maxFullPages: 6,
        maxCharsPerFullPage: 1400,
        maxCharsPerSummaryPage: 250,
      });

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          chapterTitle: { type: Type.STRING },
          overview: { type: Type.STRING, description: 'Concise 2-sentence executive summary.' },
          essentialConcepts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                explanation: { type: Type.STRING },
                pageNumber: { type: Type.INTEGER },
              },
              required: ['title', 'explanation', 'pageNumber'],
            },
          },
          formulasAndDefinitions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING },
                formulaOrDefinition: { type: Type.STRING },
                whenToUse: { type: Type.STRING },
                pageNumber: { type: Type.INTEGER },
              },
              required: ['term', 'formulaOrDefinition', 'whenToUse', 'pageNumber'],
            },
          },
          keyRelationships: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          commonMistakesToAvoid: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          shortRecallQuestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                shortAnswer: { type: Type.STRING },
                pageNumber: { type: Type.INTEGER },
              },
              required: ['question', 'shortAnswer', 'pageNumber'],
            },
          },
        },
        required: [
          'chapterTitle',
          'overview',
          'essentialConcepts',
          'formulasAndDefinitions',
          'keyRelationships',
          'commonMistakesToAvoid',
          'shortRecallQuestions',
        ],
      };

      const data = await generateStructuredJson<{
        chapterTitle: string;
        overview: string;
        essentialConcepts: Array<{ title: string; explanation: string; pageNumber: number }>;
        formulasAndDefinitions: Array<{
          term: string;
          formulaOrDefinition: string;
          whenToUse: string;
          pageNumber: number;
        }>;
        keyRelationships: string[];
        commonMistakesToAvoid: string[];
        shortRecallQuestions: Array<{ question: string; shortAnswer: string; pageNumber: number }>;
      }>({
        uid: (req as any).authUid,
        operation: 'revision_sheet',
        forceRefresh: Boolean(forceRefresh),
        lowLatencyThinking: true,
        systemInstruction: `You are LearnMate Exam Revision Architect.
Create a high-density, print-ready One-Page Revision Sheet strictly grounded in the provided study material.
Include essential concepts, key formulas/definitions, conceptual relationships, common student traps/mistakes, and 3-4 rapid recall check questions.`,
        prompt: `Material Title: ${title}\n\nStudy Material:\n${contextSelection.formattedContext}`,
        schema,
        temperature: 0.2,
        preferredModel: model,
      });

      const formatRef = (pNum: number) => {
        const safeP = validPageMap.has(Number(pNum)) ? Number(pNum) : pages[0].pageNumber;
        const pageObj = validPageMap.get(safeP);
        if (sourceType === 'youtube' && pageObj?.timestamp) {
          return `${pageObj.timestamp} · ${pageObj.title}`;
        }
        return sourceType === 'text' ? `Section ${safeP}` : `Page ${safeP}`;
      };

      return res.json({
        materialId,
        chapterTitle: data.chapterTitle || title,
        overview: data.overview,
        essentialConcepts: (data.essentialConcepts || []).slice(0, 6).map((c) => {
          const safeP = validPageMap.has(Number(c.pageNumber)) ? Number(c.pageNumber) : pages[0].pageNumber;
          return {
            title: c.title,
            explanation: c.explanation,
            pageNumber: safeP,
            sourceReference: formatRef(safeP),
          };
        }),
        formulasAndDefinitions: (data.formulasAndDefinitions || []).slice(0, 6).map((f) => {
          const safeP = validPageMap.has(Number(f.pageNumber)) ? Number(f.pageNumber) : pages[0].pageNumber;
          return {
            term: f.term,
            formulaOrDefinition: f.formulaOrDefinition,
            whenToUse: f.whenToUse,
            pageNumber: safeP,
          };
        }),
        keyRelationships: (data.keyRelationships || []).slice(0, 5),
        commonMistakesToAvoid: (data.commonMistakesToAvoid || []).slice(0, 4),
        shortRecallQuestions: (data.shortRecallQuestions || []).slice(0, 4).map((q) => {
          const safeP = validPageMap.has(Number(q.pageNumber)) ? Number(q.pageNumber) : pages[0].pageNumber;
          return {
            question: q.question,
            shortAnswer: q.shortAnswer,
            pageNumber: safeP,
          };
        }),
        generatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return sendGeminiErrorResponse(res, error, 'revision_sheet', true);
    }
  });

  // 8. Two-Stage YouTube Lecture Pipeline (Stage A Fast Initial Understanding + Stable Job Polling)
  app.get('/api/ai/youtube-jobs/:jobId', (req, res) => {
    const job = youtubeAnalysisJobs.get(String(req.params.jobId || ''));
    if (!job) {
      return res.status(404).json({ error: 'YouTube analysis job not found.' });
    }
    return res.json(job);
  });

  app.get('/api/ai/youtube-jobs/by-video/:videoId', (req, res) => {
    const cleanId = String(req.params.videoId || '').trim();
    const matching = Array.from(youtubeAnalysisJobs.values())
      .filter((j) => j.videoId === cleanId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (matching.length === 0) {
      return res.status(404).json({ error: 'No active or completed job for this video.' });
    }
    return res.json(matching[0]);
  });

  app.post('/api/ai/youtube-analyze', async (req, res) => {
    const startMs = Date.now();
    const {
      youtubeUrl,
      videoId: rawVideoId,
      customTitle,
      model,
      processingMode: requestedMode,
      estimatedDurationSeconds,
      targetedQuestion,
      forceRefresh = false,
    } = req.body as {
      youtubeUrl: string;
      videoId?: string;
      customTitle?: string;
      model?: string;
      processingMode?: 'static' | 'agentic' | 'auto';
      estimatedDurationSeconds?: number;
      targetedQuestion?: string;
      forceRefresh?: boolean;
    };

    const parsedUrl = parseYouTubeUrl(youtubeUrl || rawVideoId || '');
    const cleanVideoId = parsedUrl.valid && parsedUrl.videoId ? parsedUrl.videoId : (rawVideoId || '').trim();
    const canonicalUrl =
      parsedUrl.valid && parsedUrl.canonicalUrl
        ? parsedUrl.canonicalUrl
        : `https://www.youtube.com/watch?v=${cleanVideoId}`;

    if (!cleanVideoId || !/^[a-zA-Z0-9_-]{11}$/.test(cleanVideoId)) {
      return res.status(400).json({ error: 'A valid public 11-character YouTube video link is required.' });
    }

    const modeDecision = selectYouTubeProcessingMode({
      customTitle,
      estimatedDurationSeconds,
      targetedQuestion,
      requestedMode,
    });
    const processingMode: YouTubeProcessingMode = modeDecision.mode;
    const effectiveModel = model || 'gemini-3.1-flash-lite';
    const normalizedCacheKey = normalizeYouTubeCacheKey({
      videoId: cleanVideoId,
      model: effectiveModel,
      schemaVersion: 'stageA_v2',
      processingMode,
    });
    const jobId = `ytjob_${cleanVideoId}_${processingMode}`;

    // Check normalized server cache first so identical videos are never reprocessed unnecessarily
    if (!forceRefresh) {
      const cachedPayload = geminiManager.getCachedValue<any>(normalizedCacheKey);
      if (cachedPayload && Array.isArray(cachedPayload.pages) && cachedPayload.pages.length > 0) {
        const finalTitle =
          customTitle?.trim() || cachedPayload.title || `YouTube Lecture (${cleanVideoId})`;
        const responsePayload = {
          ...cachedPayload,
          title: finalTitle,
          videoId: cleanVideoId,
          canonicalUrl,
          jobId,
          processingMode,
          processingReason: modeDecision.reason,
          stageAPipeline: true,
          cached: true,
          durationMs: Date.now() - startMs,
        };
        youtubeAnalysisJobs.set(jobId, {
          jobId,
          videoId: cleanVideoId,
          canonicalUrl,
          status: 'completed',
          stageMessage: 'Loaded verified video analysis from cache.',
          processingMode,
          model: effectiveModel,
          startedAt: new Date(startMs).toISOString(),
          updatedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          cached: true,
          result: responsePayload,
        });
        return res.json(responsePayload);
      }
    }

    youtubeAnalysisJobs.set(jobId, {
      jobId,
      videoId: cleanVideoId,
      canonicalUrl,
      status: 'analyzing_stage_a',
      stageMessage:
        processingMode === 'agentic'
          ? 'Stage A: Extracting high-signal concept timestamps from long lecture...'
          : 'Stage A: Fast initial video understanding & topic mapping...',
      processingMode,
      model: effectiveModel,
      startedAt: new Date(startMs).toISOString(),
      updatedAt: new Date().toISOString(),
    });

    try {
      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          videoTitle: {
            type: Type.STRING,
            description: 'Clear, accurate title of the educational lecture or video.',
          },
          overview: {
            type: Type.STRING,
            description: 'Concise 2-3 sentence summary of what the video teaches.',
          },
          coreConcepts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '4 to 6 core concepts taught in the video.',
          },
          segments: {
            type: Type.ARRAY,
            description:
              processingMode === 'agentic'
                ? '5 to 7 high-signal timestamped concept segments targeting the key derivations and definitions.'
                : '4 to 6 chronological timestamped segments from the video.',
            items: {
              type: Type.OBJECT,
              properties: {
                timestamp: {
                  type: Type.STRING,
                  description: 'Start timestamp in MM:SS format (e.g., "00:00", "02:15", "06:40").',
                },
                title: {
                  type: Type.STRING,
                  description: 'Concise heading for this video segment.',
                },
                content: {
                  type: Type.STRING,
                  description:
                    'Concise, structured study notes, key definitions, formulas, and examples taught in this segment (3-5 bullet points or sentences).',
                },
              },
              required: ['timestamp', 'title', 'content'],
            },
          },
          keyTopics: {
            type: Type.ARRAY,
            description: '4 to 5 main topics mapped to segment numbers.',
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                summary: { type: Type.STRING },
                segmentNumbers: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: '1-based segment indices where this topic is explained.',
                },
                keyTerms: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['name', 'summary', 'segmentNumbers', 'keyTerms'],
            },
          },
          suggestedQuestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3 specific questions a student can ask about this lecture.',
          },
        },
        required: [
          'videoTitle',
          'overview',
          'coreConcepts',
          'segments',
          'keyTopics',
          'suggestedQuestions',
        ],
      };

      const modeInstruction =
        processingMode === 'agentic'
          ? `AGENTIC SELECTIVE MODE: Focus on extracting the 5-7 highest-value conceptual transitions, formulas, and worked examples${
              targetedQuestion ? ` with special focus on: "${targetedQuestion}"` : ''
            }.`
          : `STATIC FAST STAGE-A MODE: Produce a fast, source-grounded Stage A overview with 4-6 clear timestamped segments, main topics, and core concepts so the student can begin studying immediately.`;

      const promptParts = [
        {
          fileData: {
            fileUri: canonicalUrl,
            mimeType: 'video/mp4',
          },
        },
        {
          text: `Analyze this public YouTube educational video (${canonicalUrl})${
            customTitle ? ` titled "${customTitle}"` : ''
          }.\n${modeInstruction}\nPreserve accurate MM:SS timestamps and never invent content from metadata alone if the video is inaccessible.`,
        },
      ];

      const data = await generateStructuredJson<{
        videoTitle: string;
        overview: string;
        coreConcepts?: string[];
        segments: Array<{
          timestamp: string;
          title: string;
          content: string;
        }>;
        keyTopics: Array<{
          name: string;
          summary: string;
          segmentNumbers: number[];
          keyTerms: string[];
        }>;
        suggestedQuestions: string[];
      }>({
        uid: (req as any).authUid,
        operation: 'youtube_analyze_stage_a',
        customDedupeKey: normalizedCacheKey,
        forceRefresh: Boolean(forceRefresh),
        lowLatencyThinking: true,
        systemInstruction:
          'You are LearnMate YouTube Stage-A Lecture Analyzer. Use native Gemini video understanding to produce a fast, source-grounded structured breakdown with accurate timestamps, main topics, and core concepts. Never fabricate content if the video is unavailable.',
        prompt: promptParts,
        schema,
        temperature: 0.15,
        preferredModel: effectiveModel,
      });

      if (!data.segments || data.segments.length === 0) {
        youtubeAnalysisJobs.set(jobId, {
          jobId,
          videoId: cleanVideoId,
          canonicalUrl,
          status: 'failed',
          stageMessage: 'Could not extract educational segments from this video.',
          processingMode,
          model: effectiveModel,
          startedAt: new Date(startMs).toISOString(),
          updatedAt: new Date().toISOString(),
          errorCategory: 'UNSUPPORTED_VIDEO',
          errorMessage:
            'Could not extract educational segments from this YouTube video. Please verify the video is public and contains educational content.',
        });
        return res.status(422).json({
          error:
            'Could not extract educational segments from this YouTube video. Please verify the video is public and contains educational content.',
          category: 'UNSUPPORTED_VIDEO',
          retryable: false,
          jobId,
        });
      }

      const pages: PageInput[] = data.segments.slice(0, 10).map((seg, idx) => {
        const ts = seg.timestamp?.trim() || '00:00';
        return {
          pageNumber: idx + 1,
          title: seg.title?.trim() || `Segment ${idx + 1}`,
          content: seg.content?.trim() || '',
          timestamp: ts,
          timestampSeconds: parseTimestampSecs(ts),
        };
      });

      const validNums = new Set(pages.map((p) => p.pageNumber));
      const keyTopics = (data.keyTopics || []).map((t) => {
        const nums = (t.segmentNumbers || []).filter((n) => validNums.has(Number(n)));
        return {
          name: t.name,
          summary: t.summary,
          pageNumbers: nums.length > 0 ? nums : [1],
          keyTerms: (t.keyTerms || []).slice(0, 5),
        };
      });

      const finalTitle =
        customTitle?.trim() || data.videoTitle?.trim() || `YouTube Lecture (${cleanVideoId})`;
      const coreConcepts = (
        data.coreConcepts && data.coreConcepts.length > 0
          ? data.coreConcepts
          : keyTopics.map((t) => t.name)
      ).slice(0, 6);

      const durationMs = Date.now() - startMs;
      const resultPayload = {
        title: finalTitle,
        videoId: cleanVideoId,
        canonicalUrl,
        jobId,
        overview: data.overview,
        coreConcepts,
        pages,
        keyTopics,
        suggestedQuestions: (data.suggestedQuestions || []).slice(0, 4),
        processingMode,
        processingReason: modeDecision.reason,
        stageAPipeline: true,
        cached: false,
        durationMs,
      };

      geminiManager.setCachedValue(normalizedCacheKey, resultPayload, 2 * 60 * 60 * 1000);

      youtubeAnalysisJobs.set(jobId, {
        jobId,
        videoId: cleanVideoId,
        canonicalUrl,
        status: 'completed',
        stageMessage: `Stage A complete (${pages.length} timestamped segments extracted in ${(
          durationMs / 1000
        ).toFixed(1)}s).`,
        processingMode,
        model: effectiveModel,
        startedAt: new Date(startMs).toISOString(),
        updatedAt: new Date().toISOString(),
        durationMs,
        cached: false,
        result: {
          title: finalTitle,
          videoId: cleanVideoId,
          canonicalUrl,
          pages,
          analysis: {
            materialId: `yt_${cleanVideoId}`,
            overview: data.overview,
            coreConcepts,
            keyTopics,
            suggestedQuestions: (data.suggestedQuestions || []).slice(0, 4),
            stageACompletedAt: new Date().toISOString(),
            processingMode,
          },
          processingMode,
          stageAPipeline: true,
          cached: false,
          durationMs,
        },
      });

      return res.json(resultPayload);
    } catch (error: any) {
      const rawMsg = String(error?.rawReason || error?.message || '');
      const classified = classifyGeminiError(error, true);

      if (
        rawMsg.toLowerCase().includes('permission') ||
        rawMsg.toLowerCase().includes('private') ||
        rawMsg.includes('403') ||
        error?.status === 403
      ) {
        const msg =
          'This YouTube video is private, restricted (403), or unavailable for Gemini analysis. Please try another public educational video or paste the transcript.';
        youtubeAnalysisJobs.set(jobId, {
          jobId,
          videoId: cleanVideoId,
          canonicalUrl,
          status: 'failed',
          stageMessage: msg,
          processingMode,
          model: effectiveModel,
          startedAt: new Date(startMs).toISOString(),
          updatedAt: new Date().toISOString(),
          errorCategory: 'VIDEO_RESTRICTED_403',
          errorMessage: msg,
        });
        return res.status(403).json({
          error: msg,
          category: 'VIDEO_RESTRICTED_403',
          retryable: false,
          jobId,
        });
      }

      youtubeAnalysisJobs.set(jobId, {
        jobId,
        videoId: cleanVideoId,
        canonicalUrl,
        status: 'failed',
        stageMessage: classified.userMessage,
        processingMode,
        model: effectiveModel,
        startedAt: new Date(startMs).toISOString(),
        updatedAt: new Date().toISOString(),
        errorCategory: classified.category,
        errorMessage: classified.userMessage,
      });

      return sendGeminiErrorResponse(res, error, 'youtube_analyze_stage_a', true);
    }
  });

  // 9. Topic-Specific Official YouTube Data API v3 Recommendations (/api/youtube/recommendations)
  const handleYouTubeRecommendations = async (req: express.Request, res: express.Response) => {
    try {
      const isPost = req.method === 'POST';
      const rawQuery = String((isPost ? req.body?.query : req.query.q) || '').trim();
      const materialTitle = String((isPost ? req.body?.materialTitle : req.query.title) || '').trim();
      const keyTopics = isPost && Array.isArray(req.body?.keyTopics) ? req.body.keyTopics : [];
      const pages = isPost && Array.isArray(req.body?.pages) ? req.body.pages : [];
      const weakTopics = isPost && Array.isArray(req.body?.weakTopics) ? req.body.weakTopics : [];
      const forceRefresh = Boolean(isPost ? req.body?.forceRefresh : req.query.force === '1');

      const { primaryQuery, fallbackQuery, concepts, subject } = buildTopicSpecificYouTubeQueries({
        materialTitle: materialTitle || rawQuery,
        keyTopics,
        pages,
        weakTopics,
        customTopic: rawQuery || undefined,
      });

      const effectiveQuery = primaryQuery || `${rawQuery || 'University'} lecture explanation`;
      const authUid = String((req as any).authUid || 'auth_user');
      const cacheKey = `${authUid}::${effectiveQuery.toLowerCase()}::${concepts.join('|').toLowerCase()}`;

      if (!forceRefresh) {
        const cached = youtubeRecsCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          return res.json(cached.payload);
        }
      }

      const ytApiKey = process.env.YOUTUBE_API_KEY;
      if (!ytApiKey || ytApiKey === 'MY_YOUTUBE_API_KEY') {
        return res.json({
          configured: false,
          usedQuery: effectiveQuery,
          extractedConcepts: concepts,
          reason:
            'YOUTUBE_API_KEY is not configured in server secrets. Add a valid YouTube Data API v3 key in the Secrets panel to fetch live video recommendations.',
          videos: [],
        });
      }

      const fetchCandidatesForQuery = async (qStr: string): Promise<{
        ok: boolean;
        errorReason?: string;
        candidates: RawYouTubeCandidate[];
      }> => {
        const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
        searchUrl.searchParams.set('part', 'snippet');
        searchUrl.searchParams.set('type', 'video');
        searchUrl.searchParams.set('videoEmbeddable', 'true');
        searchUrl.searchParams.set('safeSearch', 'strict');
        searchUrl.searchParams.set('relevanceLanguage', 'en');
        searchUrl.searchParams.set('maxResults', '8');
        searchUrl.searchParams.set('q', qStr);
        searchUrl.searchParams.set('key', ytApiKey);

        const ytResp = await fetch(searchUrl.toString());
        const ytJson = (await ytResp.json().catch(() => ({}))) as any;

        if (!ytResp.ok) {
          const apiErrMsg =
            ytJson?.error?.message || `YouTube Data API returned status ${ytResp.status}.`;
          return { ok: false, errorReason: apiErrMsg, candidates: [] };
        }

        const items = Array.isArray(ytJson?.items) ? ytJson.items : [];
        const videoIds = items
          .map((item: any) => item?.id?.videoId)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

        // Fetch exact ISO durations via videos endpoint to filter out Shorts (<75s) and livestreams
        const durationMap = new Map<string, string>();
        if (videoIds.length > 0) {
          try {
            const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
            detailsUrl.searchParams.set('part', 'contentDetails');
            detailsUrl.searchParams.set('id', videoIds.join(','));
            detailsUrl.searchParams.set('key', ytApiKey);
            const detailsResp = await fetch(detailsUrl.toString());
            if (detailsResp.ok) {
              const detailsJson = (await detailsResp.json().catch(() => ({}))) as any;
              for (const vItem of detailsJson?.items || []) {
                if (vItem?.id && vItem?.contentDetails?.duration) {
                  durationMap.set(vItem.id, vItem.contentDetails.duration);
                }
              }
            }
          } catch {
            // Optional enrichment — continue if videos endpoint fails
          }
        }

        const candidates: RawYouTubeCandidate[] = items
          .map((item: any) => {
            const vid = item?.id?.videoId;
            const snippet = item?.snippet;
            if (!vid || !snippet) return null;
            return {
              videoId: vid,
              title: snippet.title || 'Educational Video',
              channelTitle: snippet.channelTitle || 'YouTube Educator',
              description: snippet.description || '',
              thumbnailUrl:
                snippet?.thumbnails?.high?.url ||
                snippet?.thumbnails?.medium?.url ||
                snippet?.thumbnails?.default?.url ||
                '',
              publishedAt: snippet.publishedAt,
              durationIso: durationMap.get(vid),
            };
          })
          .filter(Boolean) as RawYouTubeCandidate[];

        return { ok: true, candidates };
      };

      const firstPass = await fetchCandidatesForQuery(effectiveQuery);
      if (!firstPass.ok) {
        return res.json({
          configured: false,
          usedQuery: effectiveQuery,
          extractedConcepts: concepts,
          reason: firstPass.errorReason,
          videos: [],
        });
      }

      let ranked = rankAndFilterYouTubeCandidates({
        candidates: firstPass.candidates,
        concepts: concepts.length > 0 ? concepts : [rawQuery || materialTitle || 'Lecture'],
        subject,
        topicQuery: rawQuery || concepts[0] || materialTitle || 'Study Topic',
      });

      // If primary query yielded fewer than 2 strongly relevant videos and fallbackQuery differs, try fallback
      if (ranked.length < 2 && fallbackQuery && fallbackQuery !== effectiveQuery) {
        const secondPass = await fetchCandidatesForQuery(fallbackQuery);
        if (secondPass.ok && secondPass.candidates.length > 0) {
          ranked = rankAndFilterYouTubeCandidates({
            candidates: [...firstPass.candidates, ...secondPass.candidates],
            concepts: concepts.length > 0 ? concepts : [rawQuery || materialTitle || 'Lecture'],
            subject,
            topicQuery: rawQuery || concepts[0] || materialTitle || 'Study Topic',
          });
        }
      }

      const payload = {
        configured: true,
        usedQuery: effectiveQuery,
        extractedConcepts: concepts,
        videos: ranked.slice(0, 3),
      };

      youtubeRecsCache.set(cacheKey, {
        expiresAt: Date.now() + 30 * 60 * 1000,
        payload,
      });

      return res.json(payload);
    } catch (error: any) {
      console.error('Error in /api/youtube/recommendations:', error);
      return res.status(500).json({
        configured: false,
        reason: error?.message || 'Failed to reach YouTube Data API v3.',
        videos: [],
      });
    }
  };

  app.get('/api/youtube/recommendations', handleYouTubeRecommendations);
  app.post('/api/youtube/recommendations', handleYouTubeRecommendations);

  // 10. Gemini Live Voice Tutor WebSocket Bridge (/live)
  const wss = new WebSocketServer({ server: httpServer, path: '/live' });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSession: any = null;
    let isClosing = false;

    const sendToClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    clientWs.on('message', async (rawBuffer) => {
      try {
        const msg = JSON.parse(rawBuffer.toString());

        if (msg.type === 'setup') {
          const authCheck = await verifyServerRequestAuthorization({
            authorizationHeader: msg.idToken ? `Bearer ${msg.idToken}` : undefined,
            suppliedUserId: typeof msg.userId === 'string' ? msg.userId : null,
            allowTestTokens,
          });
          if (!authCheck.authorized || !authCheck.uid) {
            sendToClient({
              type: 'error',
              message: authCheck.error || 'Authentication required for Gemini Live Voice Tutor.',
            });
            clientWs.close();
            return;
          }

          const ai = getGenAIClient();
          const materialTitle = msg.materialTitle || 'Current Study Material';
          const overview = msg.overview || '';
          const weakTopics = Array.isArray(msg.weakTopics) ? msg.weakTopics.join(', ') : '';
          const pagesSnippet = Array.isArray(msg.pages)
            ? msg.pages
                .slice(0, 6)
                .map((p: PageInput) => `Page ${p.pageNumber} (${p.title}): ${p.content.slice(0, 500)}`)
                .join('\n\n')
            : '';

          const systemInstruction = `You are LearnMate Buddy, a friendly, concise, encouraging 2D AI Voice Tutor companion inside LearnMate.
Active Study Material: ${materialTitle}
${overview ? `Summary: ${overview}` : ''}
${weakTopics ? `Student Weak Topics to reinforce: ${weakTopics}` : ''}
${pagesSnippet ? `Material Excerpts:\n${pagesSnippet}` : ''}
Speak naturally, warmly, and clearly in 2 to 4 sentences per turn. Reference specific page numbers or timestamps when explaining concepts from the material, and ask quick check-for-understanding questions.`;

          let turnCounter = 1;
          let activeUserTurnId = `live_u_${Date.now()}_${turnCounter}`;
          let activeAssistantTurnId = `live_a_${Date.now()}_${turnCounter}`;
          let assistantTurnStarted = false;

          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            callbacks: {
              onopen: () => {
                sendToClient({ type: 'ready' });
              },
              onmessage: (serverMsg: any) => {
                const inputTranscript =
                  serverMsg?.serverContent?.inputTranscription?.text;
                if (inputTranscript) {
                  // If the assistant had already started speaking and new user speech arrives, start a new user turn ID
                  if (assistantTurnStarted) {
                    turnCounter += 1;
                    activeUserTurnId = `live_u_${Date.now()}_${turnCounter}`;
                    activeAssistantTurnId = `live_a_${Date.now()}_${turnCounter}`;
                    assistantTurnStarted = false;
                  }
                  sendToClient({
                    type: 'transcript',
                    role: 'user',
                    turnId: activeUserTurnId,
                    text: inputTranscript,
                  });
                }

                const parts = serverMsg?.serverContent?.modelTurn?.parts || [];
                for (const part of parts) {
                  if (part?.thought) {
                    continue;
                  }
                  if (part?.inlineData?.data) {
                    assistantTurnStarted = true;
                    sendToClient({
                      type: 'audio',
                      turnId: activeAssistantTurnId,
                      data: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                    });
                  }
                  if (part?.text && !part?.thought) {
                    assistantTurnStarted = true;
                    sendToClient({
                      type: 'model_text_fallback',
                      role: 'assistant',
                      turnId: activeAssistantTurnId,
                      text: part.text,
                    });
                  }
                }

                const outputTranscript =
                  serverMsg?.serverContent?.outputTranscription?.text;
                if (outputTranscript) {
                  assistantTurnStarted = true;
                  sendToClient({
                    type: 'transcript',
                    role: 'assistant',
                    turnId: activeAssistantTurnId,
                    text: outputTranscript,
                  });
                }

                if (serverMsg?.serverContent?.interrupted) {
                  sendToClient({
                    type: 'interrupted',
                    turnId: activeAssistantTurnId,
                  });
                  turnCounter += 1;
                  activeUserTurnId = `live_u_${Date.now()}_${turnCounter}`;
                  activeAssistantTurnId = `live_a_${Date.now()}_${turnCounter}`;
                  assistantTurnStarted = false;
                }

                if (serverMsg?.serverContent?.turnComplete) {
                  sendToClient({
                    type: 'turnComplete',
                    turnId: activeAssistantTurnId,
                  });
                  turnCounter += 1;
                  activeUserTurnId = `live_u_${Date.now()}_${turnCounter}`;
                  activeAssistantTurnId = `live_a_${Date.now()}_${turnCounter}`;
                  assistantTurnStarted = false;
                }
              },
              onerror: (err: any) => {
                const classified = classifyGeminiError(err, false);
                sendToClient({
                  type: 'error',
                  message:
                    classified.category === 'RATE_LIMIT_TEMPORARY' ||
                    classified.category === 'QUOTA_EXHAUSTED'
                      ? classified.userMessage
                      : err?.message || 'Gemini Live voice session encountered an error.',
                });
              },
              onclose: () => {
                if (!isClosing) {
                  sendToClient({ type: 'closed' });
                }
              },
            },
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Puck' },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
          });
        } else if (msg.type === 'audio' && liveSession) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: msg.mimeType || 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'text' && liveSession && msg.text) {
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: String(msg.text) }] }],
            turnComplete: true,
          });
        }
      } catch (err: any) {
        const classified = classifyGeminiError(err, false);
        sendToClient({
          type: 'error',
          message:
            classified.category === 'RATE_LIMIT_TEMPORARY' ||
            classified.category === 'QUOTA_EXHAUSTED'
              ? classified.userMessage
              : err?.message || 'Unable to establish Gemini Live voice session.',
        });
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`LearnMate server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
