import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { StudyPage } from '../types/study';
import {
  computePdfFingerprint,
  extractSectionTitle,
  MAX_PDF_PAGES,
  validatePdfUpload,
} from '../lib/studyLogic';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ExtractedPdfDocument {
  title: string;
  pageCount: number;
  pages: StudyPage[];
  pdfDataUrl?: string;
  fingerprint: string;
  extractionTimeMs: number;
  fromCache?: boolean;
}

export interface PdfExtractionProgress {
  stage: 'validating' | 'loading_document' | 'extracting_pages' | 'completed';
  completedPages: number;
  totalPages: number;
  message: string;
}

// In-memory LRU caches to eliminate repeated PDF parsing & canvas re-rendering
const extractedPdfCache = new Map<string, ExtractedPdfDocument>();
const loadedPdfProxyCache = new Map<string, Promise<pdfjsLib.PDFDocumentProxy>>();
const renderedPageImageCache = new Map<string, string>();

function hashPdfDataUrlKey(pdfDataUrl: string): string {
  const len = pdfDataUrl.length;
  const head = pdfDataUrl.slice(0, 64);
  const mid = pdfDataUrl.slice(Math.floor(len / 2), Math.floor(len / 2) + 64);
  const tail = pdfDataUrl.slice(Math.max(0, len - 64));
  let hash = 2166136261;
  const sample = `${len}:${head}:${mid}:${tail}`;
  for (let i = 0; i < sample.length; i++) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `pdfdoc_${(hash >>> 0).toString(16)}_${len}`;
}

async function getCachedPdfDocument(pdfDataUrl: string): Promise<pdfjsLib.PDFDocumentProxy> {
  const docKey = hashPdfDataUrlKey(pdfDataUrl);
  const existing = loadedPdfProxyCache.get(docKey);
  if (existing) {
    return existing;
  }

  const loadPromise = (async () => {
    const base64Idx = pdfDataUrl.indexOf(',');
    const base64 = base64Idx >= 0 ? pdfDataUrl.slice(base64Idx + 1) : pdfDataUrl;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    return loadingTask.promise;
  })();

  if (loadedPdfProxyCache.size >= 6) {
    const firstKey = loadedPdfProxyCache.keys().next().value;
    if (firstKey) loadedPdfProxyCache.delete(firstKey);
  }
  loadedPdfProxyCache.set(docKey, loadPromise);

  try {
    return await loadPromise;
  } catch (err) {
    loadedPdfProxyCache.delete(docKey);
    throw err;
  }
}

async function extractSinglePdfPage(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<StudyPage> {
  const page = await pdfDoc.getPage(pageNum);
  const textContent = await page.getTextContent();

  let lastY: number | null = null;
  const chunks: string[] = [];

  for (const item of textContent.items as any[]) {
    if (typeof item.str === 'string') {
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
        chunks.push('\n');
      } else if (chunks.length > 0 && !chunks[chunks.length - 1].endsWith('\n')) {
        chunks.push(' ');
      }
      chunks.push(item.str);
      if (y !== null) lastY = y;
    }
  }

  const pageText = chunks
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    pageNumber: pageNum,
    title: extractSectionTitle(pageText || `Page ${pageNum}`, pageNum),
    content:
      pageText ||
      `[Page ${pageNum} contains visual diagrams or scanned figures without selectable text.]`,
  };
}

/**
 * Validates and extracts page-indexed text from an uploaded PDF file (up to 20 pages).
 * Uses file fingerprint caching and non-blocking parallel batch extraction (4 pages per batch).
 */
export async function extractPdfPages(
  file: File,
  onProgress?: (progress: PdfExtractionProgress) => void
): Promise<ExtractedPdfDocument> {
  const startMs = performance.now();
  onProgress?.({
    stage: 'validating',
    completedPages: 0,
    totalPages: 0,
    message: 'Validating PDF file...',
  });

  const initialCheck = validatePdfUpload(file.name, file.type, file.size);
  if (!initialCheck.valid) {
    throw new Error(initialCheck.error);
  }

  const fingerprint = computePdfFingerprint(file.name, file.size, file.lastModified);
  const cachedResult = extractedPdfCache.get(fingerprint);
  if (cachedResult) {
    onProgress?.({
      stage: 'completed',
      completedPages: cachedResult.pages.length,
      totalPages: cachedResult.pages.length,
      message: `Loaded ${cachedResult.pages.length} pages from instant cache.`,
    });
    return {
      ...cachedResult,
      extractionTimeMs: Math.round(performance.now() - startMs),
      fromCache: true,
    };
  }

  onProgress?.({
    stage: 'loading_document',
    completedPages: 0,
    totalPages: 0,
    message: 'Opening PDF structure...',
  });

  // Start reading data URL in parallel if file is <= 3.5MB
  const dataUrlPromise =
    file.size <= 3.5 * 1024 * 1024 ? fileToDataUrl(file) : Promise.resolve(undefined);

  const arrayBuffer = await file.arrayBuffer();
  let pdfDoc: pdfjsLib.PDFDocumentProxy;
  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdfDoc = await loadingTask.promise;
  } catch {
    throw new Error('Could not parse this PDF file. Please ensure it is a valid, unencrypted PDF.');
  }

  const numPages = pdfDoc.numPages;
  const pageCheck = validatePdfUpload(file.name, file.type, file.size, numPages);
  if (!pageCheck.valid) {
    throw new Error(pageCheck.error);
  }

  const targetPageCount = Math.min(numPages, MAX_PDF_PAGES);
  const pages: StudyPage[] = new Array(targetPageCount);
  const BATCH_SIZE = 4;
  let completedCount = 0;

  for (let batchStart = 1; batchStart <= targetPageCount; batchStart += BATCH_SIZE) {
    const batchPageNumbers: number[] = [];
    for (
      let p = batchStart;
      p < batchStart + BATCH_SIZE && p <= targetPageCount;
      p++
    ) {
      batchPageNumbers.push(p);
    }

    const batchResults = await Promise.all(
      batchPageNumbers.map((pageNum) => extractSinglePdfPage(pdfDoc, pageNum))
    );

    for (const extracted of batchResults) {
      pages[extracted.pageNumber - 1] = extracted;
      completedCount += 1;
    }

    onProgress?.({
      stage: 'extracting_pages',
      completedPages: completedCount,
      totalPages: targetPageCount,
      message: `Extracting text (${completedCount}/${targetPageCount} pages)...`,
    });

    // Yield briefly to keep UI animations responsive on multi-page PDFs
    if (batchStart + BATCH_SIZE <= targetPageCount) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const totalExtractedChars = pages.reduce((acc, p) => acc + p.content.length, 0);
  if (totalExtractedChars < 20) {
    throw new Error(
      'This PDF appears to contain only scanned images without selectable text. Please upload a text-based PDF or paste your notes.'
    );
  }

  const pdfDataUrl = await dataUrlPromise;
  const extractionTimeMs = Math.round(performance.now() - startMs);

  const extractedDoc: ExtractedPdfDocument = {
    title: file.name,
    pageCount: numPages,
    pages,
    pdfDataUrl,
    fingerprint,
    extractionTimeMs,
    fromCache: false,
  };

  if (extractedPdfCache.size >= 15) {
    const oldestKey = extractedPdfCache.keys().next().value;
    if (oldestKey) extractedPdfCache.delete(oldestKey);
  }
  extractedPdfCache.set(fingerprint, extractedDoc);

  onProgress?.({
    stage: 'completed',
    completedPages: targetPageCount,
    totalPages: targetPageCount,
    message: `Extracted ${targetPageCount} pages in ${extractionTimeMs}ms.`,
  });

  return extractedDoc;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file data'));
    reader.readAsDataURL(file);
  });
}

/**
 * Renders a specific page of a PDF data URL onto a target HTMLCanvasElement,
 * reusing the cached PDFDocumentProxy so page turns do not re-parse the PDF binary.
 */
export async function renderPdfPageToCanvas(
  pdfDataUrl: string,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.35
): Promise<void> {
  const pdf = await getCachedPdfDocument(pdfDataUrl);
  const clampedPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
  const page = await pdf.getPage(clampedPage);
  const viewport = page.getViewport({ scale });

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  }).promise;
}

/**
 * Renders a specific page of a PDF data URL to a PNG data URL string with in-memory LRU caching.
 */
export async function renderPdfPageToDataUrl(
  pdfDataUrl: string,
  pageNumber: number,
  scale = 1.35
): Promise<string | null> {
  try {
    const cacheKey = `${hashPdfDataUrlKey(pdfDataUrl)}::p${pageNumber}::s${scale}`;
    const cachedPng = renderedPageImageCache.get(cacheKey);
    if (cachedPng) {
      return cachedPng;
    }

    const canvas = document.createElement('canvas');
    await renderPdfPageToCanvas(pdfDataUrl, pageNumber, canvas, scale);
    const pngDataUrl = canvas.toDataURL('image/png');

    if (renderedPageImageCache.size >= 40) {
      const oldestKey = renderedPageImageCache.keys().next().value;
      if (oldestKey) renderedPageImageCache.delete(oldestKey);
    }
    renderedPageImageCache.set(cacheKey, pngDataUrl);
    return pngDataUrl;
  } catch {
    return null;
  }
}


