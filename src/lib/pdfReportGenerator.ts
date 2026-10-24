import {
  FlashcardItem,
  MindMapData,
  MindMapNode,
  OnePageRevisionSheet,
  QuizAttempt,
  StickyNote,
  StickyNoteColor,
  StudyMaterial,
  TopicProgress,
} from '../types/study';
import { computeTopicProgress } from './studyLogic';

export interface StudyReportSummary {
  generatedAt: string;
  filterTitle: string;
  materialsCount: number;
  totalAttempts: number;
  averageAccuracyPct: number;
  firstScorePct: number;
  latestScorePct: number;
  netImprovementPct: number;
  topicProgress: TopicProgress[];
  attempts: QuizAttempt[];
}

export type QuickReviseExportMode =
  | 'sticky_notes'
  | 'flashcards'
  | 'mind_map'
  | 'revision_sheet';

export function buildStudyReportSummary(params: {
  attempts: QuizAttempt[];
  materials: StudyMaterial[];
  selectedMaterialId?: string;
}): StudyReportSummary {
  const { attempts, materials, selectedMaterialId = 'all' } = params;

  const filteredAttempts =
    selectedMaterialId === 'all'
      ? attempts
      : attempts.filter((a) => a.materialId === selectedMaterialId);

  const chronological = [...filteredAttempts].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );

  const selectedMaterial =
    selectedMaterialId === 'all'
      ? undefined
      : materials.find((m) => m.id === selectedMaterialId);

  const filterTitle = selectedMaterial
    ? selectedMaterial.title
    : `All Study Materials (${materials.length} saved)`;

  const totalAttempts = chronological.length;
  const averageAccuracyPct =
    totalAttempts > 0
      ? Math.round(chronological.reduce((acc, a) => acc + a.percentage, 0) / totalAttempts)
      : 0;

  const firstScorePct = chronological[0]?.percentage ?? 0;
  const latestScorePct = chronological[chronological.length - 1]?.percentage ?? 0;
  const netImprovementPct = totalAttempts >= 2 ? latestScorePct - firstScorePct : 0;

  const topicProgress = computeTopicProgress(chronological);

  return {
    generatedAt: new Date().toISOString(),
    filterTitle,
    materialsCount: materials.length,
    totalAttempts,
    averageAccuracyPct,
    firstScorePct,
    latestScorePct,
    netImprovementPct,
    topicProgress,
    attempts: chronological,
  };
}

// ============================================================================
// TRUE A4 PDF 1.4 VECTOR & TYPOGRAPHY ENGINE
// ============================================================================

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
const PAGE_MARGIN_X = 40;
const PAGE_TOP_MARGIN = 44;
const PAGE_BOTTOM_MARGIN = 46;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN_X * 2; // 515.28 pt

type PdfFontId = '/F1' | '/F2' | '/F3' | '/F4' | '/F5';
type RgbColor = [number, number, number];

// Map mathematical and Greek characters to Adobe Standard Symbol font (/F5) octal codes
const SYMBOL_FONT_OCTAL_MAP: Record<string, string> = {
  '∪': '\\310', // union
  '∩': '\\307', // intersection
  '∅': '\\306', // empty set
  '≥': '\\263', // greater than or equal
  '≤': '\\243', // less than or equal
  '≠': '\\271', // not equal
  '≈': '\\273', // approximately equal
  '∑': '\\345', // summation (U+2211)
  'Σ': '\\345', // Greek capital Sigma (U+03A3)
  '∏': '\\325', // product
  'Π': '\\325', // Greek capital Pi
  '√': '\\326', // square root
  '∞': '\\245', // infinity
  '∈': '\\316', // element of
  '∉': '\\317', // not an element of
  '⊂': '\\314', // proper subset
  '⊆': '\\315', // subset or equal
  '→': '\\256', // right arrow
  '←': '\\254', // left arrow
  '⇒': '\\336', // implies
  '⇔': '\\333', // if and only if
  'Ω': '\\127', // Omega
  'Δ': '\\104', // Delta
  'α': '\\141', // alpha
  'β': '\\142', // beta
  'γ': '\\147', // gamma
  'θ': '\\161', // theta
  'λ': '\\154', // lambda
  'μ': '\\155', // mu
  'π': '\\160', // pi
  'σ': '\\163', // sigma
  'τ': '\\164', // tau
  'φ': '\\146', // phi
};

// Map Unicode subscripts and superscripts to readable ASCII / WinAnsi characters
const SUB_SUP_MAP: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₊': '+',
  '₋': '-',
  '₌': '=',
  '₍': '(',
  '₎': ')',
  'ᵢ': 'i',
  'ⱼ': 'j',
  'ₖ': 'k',
  'ₙ': 'n',
  'ₘ': 'm',
  'ₐ': 'a',
  'ₑ': 'e',
  'ₒ': 'o',
  'ₓ': 'x',
  '⁰': '^0',
  '¹': '^1',
  '⁴': '^4',
  '⁵': '^5',
  '⁶': '^6',
  '⁷': '^7',
  '⁸': '^8',
  '⁹': '^9',
  'ⁿ': '^n',
};

// Map common WinAnsi typographic characters to 7-bit ASCII octal escapes for /F1-/F4
const WIN_ANSI_OCTAL_MAP: Record<string, string> = {
  '•': '\\225',
  '·': '\\267',
  '—': '\\227',
  '–': '\\226',
  '‘': '\\221',
  '’': '\\222',
  '“': '\\223',
  '”': '\\224',
  '±': '\\261',
  '×': '\\327',
  '÷': '\\367',
  '²': '\\262',
  '³': '\\263',
  '°': '\\260',
};

function escapeWinAnsiSegment(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\') {
      out += '\\\\';
    } else if (ch === '(') {
      out += '\\(';
    } else if (ch === ')') {
      out += '\\)';
    } else if (SUB_SUP_MAP[ch]) {
      out += SUB_SUP_MAP[ch];
    } else if (WIN_ANSI_OCTAL_MAP[ch]) {
      out += WIN_ANSI_OCTAL_MAP[ch];
    } else {
      const code = ch.charCodeAt(0);
      if (code >= 0x20 && code <= 0x7e) {
        out += ch;
      } else {
        out += ' ';
      }
    }
  }
  return out;
}

/**
 * Builds a single PDF `BT ... ET` text command that seamlessly switches between
 * the requested primary font (`/F1`-`/F4`) and the Adobe `/Symbol` font (`/F5`)
 * whenever mathematical or Greek symbols (`∪`, `∩`, `≥`, `≤`, `≠`, `∑`, `→`, `λ`, `μ`, `σ`, `Ω`, etc.) appear.
 */
function buildPdfTextCommand(params: {
  x: number;
  y: number;
  text: string;
  font: PdfFontId;
  size: number;
  color: RgbColor;
}): string {
  const { x, y, text, font, size, color } = params;
  if (!text || text.trim().length === 0) return '';

  const [r, g, b] = color;
  const segments: Array<{ isSymbol: boolean; value: string }> = [];
  let currentNormal = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const symOctal = SYMBOL_FONT_OCTAL_MAP[ch];
    if (symOctal) {
      if (currentNormal.length > 0) {
        segments.push({ isSymbol: false, value: escapeWinAnsiSegment(currentNormal) });
        currentNormal = '';
      }
      segments.push({ isSymbol: true, value: symOctal });
    } else {
      currentNormal += ch;
    }
  }
  if (currentNormal.length > 0) {
    segments.push({ isSymbol: false, value: escapeWinAnsiSegment(currentNormal) });
  }

  let cmd = `BT ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td `;
  let activeFont: PdfFontId | null = null;

  for (const seg of segments) {
    const targetFont: PdfFontId = seg.isSymbol ? '/F5' : font;
    if (activeFont !== targetFont) {
      cmd += `${targetFont} ${size.toFixed(1)} Tf `;
      activeFont = targetFont;
    }
    cmd += `(${seg.value}) Tj `;
  }

  cmd += 'ET';
  return cmd;
}

export function wrapLines(text: string, maxChars: number): string[] {
  const normalized = (text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [''];

  const paragraphs = normalized.split('\n');
  const result: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      result.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      if (current.length + 1 + word.length <= maxChars) {
        current += ' ' + word;
      } else {
        result.push(current);
        current = word;
      }
    }
    result.push(current);
  }

  return result.length > 0 ? result : [''];
}

class PdfA4Builder {
  private pages: string[][] = [[]];
  public cursorY: number = A4_HEIGHT - PAGE_TOP_MARGIN;
  private docTitle: string;
  private docSubtitle: string;

  constructor(docTitle: string, docSubtitle: string) {
    this.docTitle = docTitle;
    this.docSubtitle = docSubtitle;
    this.drawPageHeader(true);
  }

  private currentStream(): string[] {
    return this.pages[this.pages.length - 1];
  }

  public addRawCommand(cmd: string): void {
    if (cmd) {
      this.currentStream().push(cmd);
    }
  }

  public drawFilledRect(
    x: number,
    yBottom: number,
    width: number,
    height: number,
    fill: RgbColor,
    stroke?: RgbColor,
    lineWidth = 1
  ): void {
    const [fr, fg, fb] = fill;
    if (stroke) {
      const [sr, sg, sb] = stroke;
      this.addRawCommand(
        `q ${lineWidth.toFixed(2)} w ${fr.toFixed(3)} ${fg.toFixed(3)} ${fb.toFixed(3)} rg ${sr.toFixed(3)} ${sg.toFixed(3)} ${sb.toFixed(3)} RG ${x.toFixed(2)} ${yBottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re B Q`
      );
    } else {
      this.addRawCommand(
        `q ${fr.toFixed(3)} ${fg.toFixed(3)} ${fb.toFixed(3)} rg ${x.toFixed(2)} ${yBottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q`
      );
    }
  }

  public drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: RgbColor,
    lineWidth = 1.2,
    dashed = false
  ): void {
    const [sr, sg, sb] = stroke;
    const dashCmd = dashed ? '[4 3] 0 d ' : '';
    this.addRawCommand(
      `q ${lineWidth.toFixed(2)} w ${dashCmd}${sr.toFixed(3)} ${sg.toFixed(3)} ${sb.toFixed(3)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`
    );
  }

  public drawText(params: {
    x: number;
    y: number;
    text: string;
    font?: PdfFontId;
    size?: number;
    color?: RgbColor;
  }): void {
    const cmd = buildPdfTextCommand({
      x: params.x,
      y: params.y,
      text: params.text,
      font: params.font || '/F1',
      size: params.size || 10,
      color: params.color || [0.09, 0.13, 0.24],
    });
    this.addRawCommand(cmd);
  }

  private drawPageHeader(isFirstPage: boolean): void {
    const topBarY = A4_HEIGHT - 34;
    const segW = CONTENT_WIDTH / 4;
    // Google 4-color top accent bar
    this.drawFilledRect(PAGE_MARGIN_X, topBarY, segW, 3.5, [0.259, 0.522, 0.957]);
    this.drawFilledRect(PAGE_MARGIN_X + segW, topBarY, segW, 3.5, [0.918, 0.263, 0.208]);
    this.drawFilledRect(PAGE_MARGIN_X + segW * 2, topBarY, segW, 3.5, [0.984, 0.737, 0.02]);
    this.drawFilledRect(PAGE_MARGIN_X + segW * 3, topBarY, segW, 3.5, [0.204, 0.659, 0.325]);

    if (isFirstPage) {
      this.cursorY = topBarY - 22;
      this.drawText({
        x: PAGE_MARGIN_X,
        y: this.cursorY,
        text: this.docTitle,
        font: '/F2',
        size: 16,
        color: [0.09, 0.13, 0.24],
      });
      this.cursorY -= 15;
      this.drawText({
        x: PAGE_MARGIN_X,
        y: this.cursorY,
        text: this.docSubtitle,
        font: '/F1',
        size: 9.5,
        color: [0.36, 0.42, 0.5],
      });
      this.cursorY -= 10;
      this.drawLine(
        PAGE_MARGIN_X,
        this.cursorY,
        A4_WIDTH - PAGE_MARGIN_X,
        this.cursorY,
        [0.86, 0.89, 0.94],
        0.8
      );
      this.cursorY -= 16;
    } else {
      this.cursorY = topBarY - 16;
      this.drawText({
        x: PAGE_MARGIN_X,
        y: this.cursorY,
        text: `${this.docTitle}  |  ${this.docSubtitle}`,
        font: '/F2',
        size: 8.5,
        color: [0.4, 0.46, 0.55],
      });
      this.cursorY -= 14;
    }
  }

  public ensureSpace(neededHeight: number): void {
    if (this.cursorY - neededHeight < PAGE_BOTTOM_MARGIN) {
      this.startNewPage();
    }
  }

  public startNewPage(): void {
    this.pages.push([]);
    this.drawPageHeader(false);
  }

  public compile(): Uint8Array {
    const totalPages = this.pages.length;

    // Add page footers to every page
    for (let i = 0; i < totalPages; i++) {
      const footerY = 24;
      const footerLineCmd = `q 0.60 w 0.880 0.900 0.940 RG ${PAGE_MARGIN_X.toFixed(2)} ${(footerY + 11).toFixed(2)} m ${(A4_WIDTH - PAGE_MARGIN_X).toFixed(2)} ${(footerY + 11).toFixed(2)} l S Q`;
      const leftFooter = buildPdfTextCommand({
        x: PAGE_MARGIN_X,
        y: footerY,
        text: 'LearnMate Quick Revise  •  A4 Study Export',
        font: '/F1',
        size: 8,
        color: [0.45, 0.51, 0.6],
      });
      const rightFooter = buildPdfTextCommand({
        x: A4_WIDTH - PAGE_MARGIN_X - 58,
        y: footerY,
        text: `Page ${i + 1} of ${totalPages}`,
        font: '/F2',
        size: 8,
        color: [0.35, 0.41, 0.5],
      });
      this.pages[i].push(footerLineCmd, leftFooter, rightFooter);
    }

    // Object IDs:
    // 1: Catalog
    // 2: Pages
    // 3: /F1 Helvetica (WinAnsiEncoding)
    // 4: /F2 Helvetica-Bold (WinAnsiEncoding)
    // 5: /F3 Courier-Bold (WinAnsiEncoding)
    // 6: /F4 Helvetica-Oblique (WinAnsiEncoding)
    // 7: /F5 Symbol
    const objects: string[] = [];
    const pageObjIds: number[] = [];
    const firstPageObjId = 8;

    for (let i = 0; i < totalPages; i++) {
      const pageObjId = firstPageObjId + i * 2;
      const contentObjId = firstPageObjId + i * 2 + 1;
      pageObjIds.push(pageObjId);

      const streamContent = this.pages[i].join('\n');
      objects[pageObjId] =
        `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH.toFixed(2)} ${A4_HEIGHT.toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R >> >> ` +
        `/Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`;

      objects[contentObjId] =
        `${contentObjId} 0 obj\n` +
        `<< /Length ${streamContent.length} >>\n` +
        `stream\n${streamContent}\nendstream\n` +
        `endobj\n`;
    }

    objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
    objects[2] =
      `2 0 obj\n` +
      `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>\n` +
      `endobj\n`;
    objects[3] =
      `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
    objects[4] =
      `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;
    objects[5] =
      `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;
    objects[6] =
      `6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>\nendobj\n`;
    objects[7] = `7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>\nendobj\n`;

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];

    const totalObjects = objects.length - 1;
    for (let id = 1; id <= totalObjects; id++) {
      offsets[id] = pdf.length;
      pdf += objects[id];
    }

    const xrefStart = pdf.length;
    pdf += `xref\n0 ${totalObjects + 1}\n`;
    pdf += `0000000000 65535 f \n`;
    for (let id = 1; id <= totalObjects; id++) {
      const offsetStr = String(offsets[id]).padStart(10, '0');
      pdf += `${offsetStr} 00000 n \n`;
    }

    pdf +=
      `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;

    return new TextEncoder().encode(pdf);
  }
}

// ============================================================================
// 1. STICKY NOTES A4 PDF GENERATOR (2-Column Pastel Card Layout)
// ============================================================================

function getStickyNotePdfPalette(color: StickyNoteColor): {
  fill: RgbColor;
  border: RgbColor;
  badgeFill: RgbColor;
  badgeText: RgbColor;
} {
  switch (color) {
    case 'pink':
      return {
        fill: [0.992, 0.949, 0.973], // #FDF2F8
        border: [0.957, 0.447, 0.714], // #F472B6
        badgeFill: [0.988, 0.906, 0.953],
        badgeText: [0.616, 0.09, 0.302],
      };
    case 'blue':
      return {
        fill: [0.941, 0.976, 1.0], // #F0F9FF
        border: [0.22, 0.741, 0.973], // #38BDF8
        badgeFill: [0.878, 0.949, 0.996],
        badgeText: [0.012, 0.412, 0.631],
      };
    case 'green':
      return {
        fill: [0.941, 0.992, 0.957], // #F0FDF4
        border: [0.29, 0.871, 0.502], // #4ADE80
        badgeFill: [0.863, 0.988, 0.906],
        badgeText: [0.082, 0.502, 0.239],
      };
    case 'lavender':
      return {
        fill: [0.961, 0.953, 1.0], // #F5F3FF
        border: [0.655, 0.545, 0.98], // #A78BFA
        badgeFill: [0.929, 0.914, 0.996],
        badgeText: [0.357, 0.129, 0.714],
      };
    case 'yellow':
    default:
      return {
        fill: [1.0, 0.984, 0.922], // #FFFBEB
        border: [0.984, 0.749, 0.141], // #FBBF24
        badgeFill: [0.996, 0.953, 0.78],
        badgeText: [0.573, 0.251, 0.055],
      };
  }
}

export function generateStickyNotesPdfBytes(
  materialTitle: string,
  notes: StickyNote[]
): Uint8Array {
  const dateStr = new Date().toLocaleDateString();
  const builder = new PdfA4Builder(
    `LearnMate Quick Revision — Sticky Notes`,
    `Material: ${materialTitle}   |   ${notes.length} Sticky Notes   |   Exported ${dateStr}`
  );

  if (notes.length === 0) {
    builder.drawText({
      x: PAGE_MARGIN_X,
      y: builder.cursorY - 20,
      text: 'No sticky notes available for this study material yet.',
      font: '/F1',
      size: 11,
      color: [0.4, 0.45, 0.55],
    });
    return builder.compile();
  }

  const colGap = 15.28;
  const colWidth = (CONTENT_WIDTH - colGap) / 2; // 250 pt each

  for (let i = 0; i < notes.length; i += 2) {
    const pair = notes.slice(i, i + 2);

    const preparedCards = pair.map((note) => {
      const titleLines = wrapLines(note.title, 28);
      const bodyLines = wrapLines(note.content, 40);
      const formulaLines = note.formula ? wrapLines(note.formula, 34) : [];

      const titleHeight = titleLines.length * 14;
      const bodyHeight = bodyLines.length * 13.5;
      const formulaHeight =
        formulaLines.length > 0 ? formulaLines.length * 12.5 + 14 : 0;

      const totalHeight = Math.max(
        128,
        24 + titleHeight + 8 + bodyHeight + (formulaHeight > 0 ? 10 + formulaHeight : 0) + 16
      );

      return {
        note,
        titleLines,
        bodyLines,
        formulaLines,
        formulaHeight,
        totalHeight,
      };
    });

    const rowHeight = Math.max(...preparedCards.map((c) => c.totalHeight));
    builder.ensureSpace(rowHeight + 14);

    const rowTopY = builder.cursorY;
    const rowBottomY = rowTopY - rowHeight;

    preparedCards.forEach((card, colIdx) => {
      const cardX = PAGE_MARGIN_X + colIdx * (colWidth + colGap);
      const palette = getStickyNotePdfPalette(card.note.color);

      // Pastel note background and colored border
      builder.drawFilledRect(
        cardX,
        rowBottomY,
        colWidth,
        rowHeight,
        palette.fill,
        palette.border,
        1.4
      );

      // Source reference badge in top-right corner
      const refText = card.note.sourceReference || `Page ${card.note.pageNumber}`;
      const badgeW = Math.min(76, Math.max(46, refText.length * 5.2 + 12));
      const badgeX = cardX + colWidth - badgeW - 10;
      const badgeY = rowTopY - 24;
      builder.drawFilledRect(
        badgeX,
        badgeY,
        badgeW,
        15,
        palette.badgeFill,
        palette.border,
        0.7
      );
      builder.drawText({
        x: badgeX + 6,
        y: badgeY + 4.2,
        text: refText.slice(0, 14),
        font: '/F2',
        size: 7.8,
        color: palette.badgeText,
      });

      // Concept Title
      let textY = rowTopY - 20;
      for (const tLine of card.titleLines) {
        builder.drawText({
          x: cardX + 12,
          y: textY,
          text: tLine,
          font: '/F2',
          size: 11,
          color: [0.09, 0.13, 0.24],
        });
        textY -= 14;
      }

      textY -= 4;

      // Handwritten-style explanation body
      for (const bLine of card.bodyLines) {
        builder.drawText({
          x: cardX + 12,
          y: textY,
          text: bLine,
          font: '/F4',
          size: 9.8,
          color: [0.15, 0.2, 0.3],
        });
        textY -= 13.5;
      }

      // Highlighted Formula Box at bottom of card
      if (card.formulaLines.length > 0) {
        const fBoxHeight = card.formulaHeight;
        const fBoxBottomY = rowBottomY + 12;
        builder.drawFilledRect(
          cardX + 10,
          fBoxBottomY,
          colWidth - 20,
          fBoxHeight,
          [1.0, 1.0, 1.0],
          palette.border,
          0.9
        );

        let fTextY = fBoxBottomY + fBoxHeight - 12;
        for (const fLine of card.formulaLines) {
          builder.drawText({
            x: cardX + 16,
            y: fTextY,
            text: fLine,
            font: '/F3',
            size: 8.8,
            color: [0.07, 0.11, 0.22],
          });
          fTextY -= 12.5;
        }
      }
    });

    builder.cursorY = rowBottomY - 14;
  }

  return builder.compile();
}

// ============================================================================
// 2. FLASHCARDS A4 PDF GENERATOR (Printable Question & Answer Cards)
// ============================================================================

export function generateFlashcardsPdfBytes(
  materialTitle: string,
  flashcards: FlashcardItem[]
): Uint8Array {
  const masteredCount = flashcards.filter((c) => c.status === 'know_it').length;
  const dateStr = new Date().toLocaleDateString();
  const builder = new PdfA4Builder(
    `LearnMate Quick Revision — Active-Recall Flashcards`,
    `Material: ${materialTitle}   |   ${flashcards.length} Cards (${masteredCount} Mastered)   |   Exported ${dateStr}`
  );

  if (flashcards.length === 0) {
    builder.drawText({
      x: PAGE_MARGIN_X,
      y: builder.cursorY - 20,
      text: 'No flashcards available for this study material yet.',
      font: '/F1',
      size: 11,
      color: [0.4, 0.45, 0.55],
    });
    return builder.compile();
  }

  flashcards.forEach((card, idx) => {
    const qLines = wrapLines(card.frontPrompt, 82);
    const aLines = wrapLines(card.backExplanation, 84);
    const fLines = card.formula ? wrapLines(`Formula: ${card.formula}`, 76) : [];

    const qHeight = qLines.length * 13.5;
    const aHeight = aLines.length * 13;
    const fHeight = fLines.length > 0 ? fLines.length * 12 + 12 : 0;
    const cardHeight = 32 + qHeight + 14 + aHeight + (fHeight > 0 ? 8 + fHeight : 0) + 14;

    builder.ensureSpace(cardHeight + 12);

    const topY = builder.cursorY;
    const bottomY = topY - cardHeight;

    // Outer card shell
    builder.drawFilledRect(
      PAGE_MARGIN_X,
      bottomY,
      CONTENT_WIDTH,
      cardHeight,
      [0.992, 0.996, 1.0],
      [0.78, 0.84, 0.94],
      1.1
    );

    // Top metadata bar
    builder.drawFilledRect(
      PAGE_MARGIN_X,
      topY - 22,
      CONTENT_WIDTH,
      22,
      [0.91, 0.941, 0.996],
      [0.78, 0.84, 0.94],
      0.8
    );

    const statusLabel =
      card.status === 'know_it'
        ? 'KNOW IT'
        : card.status === 'review_again'
          ? 'REVIEW AGAIN'
          : 'UNREVIEWED';

    builder.drawText({
      x: PAGE_MARGIN_X + 12,
      y: topY - 14.5,
      text: `CARD #${idx + 1}  •  ${card.topic}`,
      font: '/F2',
      size: 9,
      color: [0.1, 0.35, 0.82],
    });

    const rightMeta = `${card.sourceReference || `Page ${card.pageNumber}`}  |  ${statusLabel}`;
    builder.drawText({
      x: A4_WIDTH - PAGE_MARGIN_X - Math.min(200, rightMeta.length * 4.8 + 14),
      y: topY - 14.5,
      text: rightMeta,
      font: '/F2',
      size: 8.2,
      color: card.status === 'know_it' ? [0.08, 0.5, 0.24] : [0.35, 0.42, 0.52],
    });

    // Question (Front)
    let curY = topY - 37;
    builder.drawText({
      x: PAGE_MARGIN_X + 12,
      y: curY,
      text: 'Q (Front Prompt):',
      font: '/F2',
      size: 8.5,
      color: [0.25, 0.52, 0.96],
    });
    curY -= 13;

    for (const qLine of qLines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 14,
        y: curY,
        text: qLine,
        font: '/F2',
        size: 10.2,
        color: [0.09, 0.13, 0.24],
      });
      curY -= 13.5;
    }

    // Divider between Front & Back
    curY -= 2;
    builder.drawLine(
      PAGE_MARGIN_X + 12,
      curY + 4,
      A4_WIDTH - PAGE_MARGIN_X - 12,
      curY + 4,
      [0.85, 0.89, 0.95],
      0.7,
      true
    );
    curY -= 9;

    // Answer (Back)
    builder.drawText({
      x: PAGE_MARGIN_X + 12,
      y: curY,
      text: 'A (Back Answer & Explanation):',
      font: '/F2',
      size: 8.5,
      color: [0.09, 0.52, 0.26],
    });
    curY -= 12.5;

    for (const aLine of aLines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 14,
        y: curY,
        text: aLine,
        font: '/F1',
        size: 9.5,
        color: [0.16, 0.22, 0.32],
      });
      curY -= 13;
    }

    // Formula Box if present
    if (fLines.length > 0) {
      const fBoxBottom = bottomY + 8;
      builder.drawFilledRect(
        PAGE_MARGIN_X + 14,
        fBoxBottom,
        CONTENT_WIDTH - 28,
        fHeight,
        [1.0, 1.0, 1.0],
        [0.58, 0.77, 0.99],
        0.9
      );
      let fy = fBoxBottom + fHeight - 11;
      for (const fLine of fLines) {
        builder.drawText({
          x: PAGE_MARGIN_X + 20,
          y: fy,
          text: fLine,
          font: '/F3',
          size: 8.8,
          color: [0.11, 0.31, 0.85],
        });
        fy -= 12;
      }
    }

    builder.cursorY = bottomY - 12;
  });

  return builder.compile();
}

// ============================================================================
// 3. MIND MAP A4 PDF GENERATOR (Vector Diagram + Concept Node Directory)
// ============================================================================

function getMindMapBranchColors(branchColor: MindMapNode['branchColor']): {
  fill: RgbColor;
  stroke: RgbColor;
} {
  switch (branchColor) {
    case 'red':
      return { fill: [0.996, 0.886, 0.886], stroke: [0.918, 0.263, 0.208] };
    case 'yellow':
      return { fill: [0.996, 0.953, 0.78], stroke: [0.851, 0.467, 0.024] };
    case 'green':
      return { fill: [0.863, 0.988, 0.906], stroke: [0.204, 0.659, 0.325] };
    case 'blue':
    default:
      return { fill: [0.91, 0.941, 0.996], stroke: [0.259, 0.522, 0.957] };
  }
}

export function generateMindMapPdfBytes(
  materialTitle: string,
  mindMap: MindMapData
): Uint8Array {
  const dateStr = new Date().toLocaleDateString();
  const builder = new PdfA4Builder(
    `LearnMate Quick Revision — Concept Mind Map`,
    `Material: ${materialTitle}   |   Central Topic: ${mindMap.centralTopic}   |   Exported ${dateStr}`
  );

  if (!mindMap || mindMap.nodes.length === 0) {
    builder.drawText({
      x: PAGE_MARGIN_X,
      y: builder.cursorY - 20,
      text: 'No mind map nodes available for this study material yet.',
      font: '/F1',
      size: 11,
      color: [0.4, 0.45, 0.55],
    });
    return builder.compile();
  }

  // 1. Draw Scaled Visual Radial Mind Map Diagram Box
  const diagramHeight = 250;
  builder.ensureSpace(diagramHeight + 20);
  const boxTopY = builder.cursorY;
  const boxBottomY = boxTopY - diagramHeight;

  builder.drawFilledRect(
    PAGE_MARGIN_X,
    boxBottomY,
    CONTENT_WIDTH,
    diagramHeight,
    [0.973, 0.984, 1.0],
    [0.82, 0.87, 0.95],
    1.0
  );

  const centerNode =
    mindMap.nodes.find((n) => n.category === 'central') || mindMap.nodes[0];
  const branchNodes = mindMap.nodes.filter((n) => n.id !== centerNode.id);

  const cx = PAGE_MARGIN_X + CONTENT_WIDTH / 2;
  const cy = boxBottomY + diagramHeight / 2;
  const rx = 165;
  const ry = 86;

  const positioned = branchNodes.map((node, idx) => {
    const angle =
      (idx / Math.max(1, branchNodes.length)) * 2 * Math.PI - Math.PI / 2;
    return {
      node,
      x: cx + Math.cos(angle) * rx,
      y: cy - Math.sin(angle) * ry,
    };
  });

  // Connecting edges
  for (const { node, x, y } of positioned) {
    const palette = getMindMapBranchColors(node.branchColor);
    builder.drawLine(
      cx,
      cy,
      x,
      y,
      palette.stroke,
      1.6,
      node.category === 'leaf'
    );
  }

  // Central Node Box
  const centerW = 132;
  const centerH = 38;
  builder.drawFilledRect(
    cx - centerW / 2,
    cy - centerH / 2,
    centerW,
    centerH,
    [0.09, 0.13, 0.24],
    [0.259, 0.522, 0.957],
    1.8
  );
  builder.drawText({
    x: cx - centerW / 2 + 8,
    y: cy + 2,
    text: centerNode.label.slice(0, 22),
    font: '/F2',
    size: 9,
    color: [1.0, 1.0, 1.0],
  });
  builder.drawText({
    x: cx - centerW / 2 + 8,
    y: cy - 10,
    text: `Central • ${centerNode.sourceReference}`,
    font: '/F1',
    size: 7.5,
    color: [0.58, 0.77, 0.99],
  });

  // Branch Node Boxes
  const branchW = 116;
  const branchH = 34;
  for (const { node, x, y } of positioned) {
    const palette = getMindMapBranchColors(node.branchColor);
    builder.drawFilledRect(
      x - branchW / 2,
      y - branchH / 2,
      branchW,
      branchH,
      palette.fill,
      palette.stroke,
      1.3
    );
    builder.drawText({
      x: x - branchW / 2 + 7,
      y: y + 2,
      text: node.label.slice(0, 20),
      font: '/F2',
      size: 8.2,
      color: [0.09, 0.13, 0.24],
    });
    builder.drawText({
      x: x - branchW / 2 + 7,
      y: y - 9.5,
      text: node.sourceReference || `Page ${node.pageNumber}`,
      font: '/F2',
      size: 7.2,
      color: palette.stroke,
    });
  }

  builder.cursorY = boxBottomY - 18;

  // 2. Concept Node Directory below the visual diagram
  builder.ensureSpace(30);
  builder.drawText({
    x: PAGE_MARGIN_X,
    y: builder.cursorY,
    text: 'Concept Node Reference & Formula Breakdown',
    font: '/F2',
    size: 12.5,
    color: [0.09, 0.13, 0.24],
  });
  builder.cursorY -= 14;

  for (const node of mindMap.nodes) {
    const palette = getMindMapBranchColors(node.branchColor);
    const summaryLines = wrapLines(node.summary, 84);
    const formulaLines = node.formula ? wrapLines(`Formula: ${node.formula}`, 76) : [];
    const cardH =
      26 +
      summaryLines.length * 12.5 +
      (formulaLines.length > 0 ? formulaLines.length * 12 + 10 : 0) +
      10;

    builder.ensureSpace(cardH + 10);
    const topY = builder.cursorY;
    const bottomY = topY - cardH;

    builder.drawFilledRect(
      PAGE_MARGIN_X,
      bottomY,
      CONTENT_WIDTH,
      cardH,
      [1.0, 1.0, 1.0],
      palette.stroke,
      1.0
    );

    builder.drawText({
      x: PAGE_MARGIN_X + 12,
      y: topY - 16,
      text: `${node.label}  (${node.category.toUpperCase()})`,
      font: '/F2',
      size: 10,
      color: [0.09, 0.13, 0.24],
    });

    builder.drawText({
      x: A4_WIDTH - PAGE_MARGIN_X - 75,
      y: topY - 16,
      text: node.sourceReference || `Page ${node.pageNumber}`,
      font: '/F2',
      size: 8.5,
      color: palette.stroke,
    });

    let cyText = topY - 31;
    for (const sLine of summaryLines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 12,
        y: cyText,
        text: sLine,
        font: '/F1',
        size: 9.2,
        color: [0.22, 0.28, 0.38],
      });
      cyText -= 12.5;
    }

    if (formulaLines.length > 0) {
      const fBoxH = formulaLines.length * 12 + 6;
      builder.drawFilledRect(
        PAGE_MARGIN_X + 12,
        bottomY + 7,
        CONTENT_WIDTH - 24,
        fBoxH,
        palette.fill,
        palette.stroke,
        0.7
      );
      let fy = bottomY + 7 + fBoxH - 10.5;
      for (const fLine of formulaLines) {
        builder.drawText({
          x: PAGE_MARGIN_X + 18,
          y: fy,
          text: fLine,
          font: '/F3',
          size: 8.6,
          color: [0.09, 0.13, 0.24],
        });
        fy -= 12;
      }
    }

    builder.cursorY = bottomY - 9;
  }

  return builder.compile();
}

// ============================================================================
// 4. ONE-PAGE REVISION SHEET A4 PDF GENERATOR
// ============================================================================

export function generateRevisionSheetPdfBytes(
  sheet: OnePageRevisionSheet
): Uint8Array {
  const dateStr = new Date(sheet.generatedAt || Date.now()).toLocaleDateString();
  const builder = new PdfA4Builder(
    `LearnMate One-Page Revision Sheet: ${sheet.chapterTitle}`,
    `Distilled Exam Summary, Key Formulas, Traps & Recall Checks   |   Updated ${dateStr}`
  );

  // Overview Callout Box
  const overviewLines = wrapLines(sheet.overview, 86);
  const overviewH = overviewLines.length * 13 + 16;
  builder.ensureSpace(overviewH + 12);
  const ovTop = builder.cursorY;
  const ovBottom = ovTop - overviewH;
  builder.drawFilledRect(
    PAGE_MARGIN_X,
    ovBottom,
    CONTENT_WIDTH,
    overviewH,
    [0.957, 0.973, 1.0],
    [0.74, 0.84, 0.98],
    1.0
  );
  let ovy = ovTop - 14;
  for (const line of overviewLines) {
    builder.drawText({
      x: PAGE_MARGIN_X + 12,
      y: ovy,
      text: line,
      font: '/F1',
      size: 9.5,
      color: [0.12, 0.18, 0.3],
    });
    ovy -= 13;
  }
  builder.cursorY = ovBottom - 14;

  // Section 1: Essential Concepts
  builder.ensureSpace(26);
  builder.drawText({
    x: PAGE_MARGIN_X,
    y: builder.cursorY,
    text: '1. Essential Concepts & Source References',
    font: '/F2',
    size: 12,
    color: [0.1, 0.35, 0.82],
  });
  builder.cursorY -= 12;

  for (const c of sheet.essentialConcepts) {
    const expLines = wrapLines(c.explanation, 84);
    const boxH = 22 + expLines.length * 12.5 + 8;
    builder.ensureSpace(boxH + 8);
    const topY = builder.cursorY;
    const bottomY = topY - boxH;

    builder.drawFilledRect(
      PAGE_MARGIN_X,
      bottomY,
      CONTENT_WIDTH,
      boxH,
      [0.988, 0.992, 0.998],
      [0.85, 0.89, 0.94],
      0.8
    );

    builder.drawText({
      x: PAGE_MARGIN_X + 10,
      y: topY - 14,
      text: `${c.title} (${c.sourceReference})`,
      font: '/F2',
      size: 9.8,
      color: [0.09, 0.13, 0.24],
    });

    let ey = topY - 27;
    for (const line of expLines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 12,
        y: ey,
        text: line,
        font: '/F1',
        size: 9,
        color: [0.24, 0.3, 0.4],
      });
      ey -= 12.5;
    }

    builder.cursorY = bottomY - 7;
  }

  builder.cursorY -= 6;

  // Section 2: Important Formulas & Definitions
  builder.ensureSpace(26);
  builder.drawText({
    x: PAGE_MARGIN_X,
    y: builder.cursorY,
    text: '2. Important Formulas & Definitions',
    font: '/F2',
    size: 12,
    color: [0.08, 0.5, 0.24],
  });
  builder.cursorY -= 12;

  for (const f of sheet.formulasAndDefinitions) {
    const fLines = wrapLines(f.formulaOrDefinition, 76);
    const useLines = wrapLines(`When to use: ${f.whenToUse}`, 84);
    const boxH = 22 + fLines.length * 12.5 + useLines.length * 12 + 12;
    builder.ensureSpace(boxH + 8);
    const topY = builder.cursorY;
    const bottomY = topY - boxH;

    builder.drawFilledRect(
      PAGE_MARGIN_X,
      bottomY,
      CONTENT_WIDTH,
      boxH,
      [0.945, 0.988, 0.961],
      [0.68, 0.92, 0.76],
      0.9
    );

    builder.drawText({
      x: PAGE_MARGIN_X + 10,
      y: topY - 14,
      text: `${f.term}  [Page ${f.pageNumber}]`,
      font: '/F2',
      size: 9.8,
      color: [0.07, 0.4, 0.2],
    });

    let fy = topY - 27;
    for (const line of fLines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 12,
        y: fy,
        text: line,
        font: '/F3',
        size: 9,
        color: [0.06, 0.32, 0.16],
      });
      fy -= 12.5;
    }

    for (const line of useLines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 12,
        y: fy,
        text: line,
        font: '/F1',
        size: 8.8,
        color: [0.25, 0.33, 0.42],
      });
      fy -= 12;
    }

    builder.cursorY = bottomY - 7;
  }

  builder.cursorY -= 6;

  // Section 3: Key Relationships & Common Mistakes to Avoid
  builder.ensureSpace(26);
  builder.drawText({
    x: PAGE_MARGIN_X,
    y: builder.cursorY,
    text: '3. Key Relationships & Common Mistakes to Avoid',
    font: '/F2',
    size: 12,
    color: [0.7, 0.32, 0.04],
  });
  builder.cursorY -= 14;

  for (const rel of sheet.keyRelationships) {
    const lines = wrapLines(`• Relationship: ${rel}`, 86);
    builder.ensureSpace(lines.length * 13 + 4);
    for (const line of lines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 8,
        y: builder.cursorY,
        text: line,
        font: '/F1',
        size: 9.2,
        color: [0.12, 0.2, 0.35],
      });
      builder.cursorY -= 12.5;
    }
    builder.cursorY -= 2;
  }

  for (const mistake of sheet.commonMistakesToAvoid) {
    const lines = wrapLines(`! Avoid Trap: ${mistake}`, 86);
    builder.ensureSpace(lines.length * 13 + 4);
    for (const line of lines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 8,
        y: builder.cursorY,
        text: line,
        font: '/F2',
        size: 9.2,
        color: [0.75, 0.16, 0.15],
      });
      builder.cursorY -= 12.5;
    }
    builder.cursorY -= 2;
  }

  builder.cursorY -= 8;

  // Section 4: Rapid Self-Check Recall Questions
  builder.ensureSpace(26);
  builder.drawText({
    x: PAGE_MARGIN_X,
    y: builder.cursorY,
    text: '4. Rapid Self-Check Recall Questions & Answers',
    font: '/F2',
    size: 12,
    color: [0.82, 0.18, 0.16],
  });
  builder.cursorY -= 14;

  sheet.shortRecallQuestions.forEach((rq, idx) => {
    const qLines = wrapLines(`Q${idx + 1} (Page ${rq.pageNumber}): ${rq.question}`, 86);
    const aLines = wrapLines(`Answer: ${rq.shortAnswer}`, 84);
    builder.ensureSpace((qLines.length + aLines.length) * 13 + 10);

    for (const line of qLines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 8,
        y: builder.cursorY,
        text: line,
        font: '/F2',
        size: 9.2,
        color: [0.09, 0.13, 0.24],
      });
      builder.cursorY -= 12.5;
    }
    for (const line of aLines) {
      builder.drawText({
        x: PAGE_MARGIN_X + 16,
        y: builder.cursorY,
        text: line,
        font: '/F1',
        size: 9,
        color: [0.08, 0.48, 0.23],
      });
      builder.cursorY -= 12.5;
    }
    builder.cursorY -= 5;
  });

  return builder.compile();
}

// ============================================================================
// 5. STUDY PERFORMANCE REPORT PDF GENERATOR
// ============================================================================

export function generatePdfReportBytes(summary: StudyReportSummary): Uint8Array {
  const builder = new PdfA4Builder(
    'LearnMate - Personalized Study & Quiz Performance Report',
    `Scope: ${summary.filterTitle}   |   Generated: ${new Date(summary.generatedAt).toLocaleString()}`
  );

  builder.ensureSpace(90);
  builder.drawText({
    x: PAGE_MARGIN_X,
    y: builder.cursorY,
    text: '1. Executive Performance Summary',
    font: '/F2',
    size: 13,
    color: [0.09, 0.13, 0.24],
  });
  builder.cursorY -= 16;

  const deltaStr =
    summary.totalAttempts >= 2
      ? `${summary.netImprovementPct >= 0 ? '+' : ''}${summary.netImprovementPct}% (from ${summary.firstScorePct}% to ${summary.latestScorePct}%)`
      : 'Baseline (complete a 2nd attempt to measure delta)';

  const execMetrics = [
    `• Completed Quiz & Practice Attempts: ${summary.totalAttempts}`,
    `• Average Quiz Accuracy: ${summary.averageAccuracyPct}%`,
    `• Latest Attempt Score: ${summary.latestScorePct}%`,
    `• Net Score Progression: ${deltaStr}`,
  ];

  for (const m of execMetrics) {
    builder.drawText({
      x: PAGE_MARGIN_X + 8,
      y: builder.cursorY,
      text: m,
      font: '/F1',
      size: 10,
      color: [0.15, 0.2, 0.3],
    });
    builder.cursorY -= 15;
  }

  builder.cursorY -= 8;
  builder.ensureSpace(40);
  builder.drawText({
    x: PAGE_MARGIN_X,
    y: builder.cursorY,
    text: '2. Topic-Level Mastery & Improvement',
    font: '/F2',
    size: 13,
    color: [0.09, 0.13, 0.24],
  });
  builder.cursorY -= 16;

  if (summary.topicProgress.length === 0) {
    builder.drawText({
      x: PAGE_MARGIN_X + 8,
      y: builder.cursorY,
      text: 'No topic mastery records yet. Complete a diagnostic quiz to populate topic metrics.',
      font: '/F1',
      size: 10,
      color: [0.35, 0.42, 0.52],
    });
    builder.cursorY -= 18;
  } else {
    for (const tp of summary.topicProgress) {
      builder.ensureSpace(18);
      const impLabel =
        tp.attemptsCount > 1
          ? `${tp.improvementPct >= 0 ? '+' : ''}${tp.improvementPct}% improvement`
          : 'Baseline (1 attempt)';
      builder.drawText({
        x: PAGE_MARGIN_X + 8,
        y: builder.cursorY,
        text: `• ${tp.topic}: ${tp.totalCorrect}/${tp.totalAsked} correct | First: ${tp.firstScorePct}% -> Latest: ${tp.latestScorePct}% (${impLabel})`,
        font: '/F1',
        size: 9.5,
        color: [0.15, 0.2, 0.3],
      });
      builder.cursorY -= 14;
    }
    builder.cursorY -= 8;
  }

  builder.ensureSpace(40);
  builder.drawText({
    x: PAGE_MARGIN_X,
    y: builder.cursorY,
    text: '3. Chronological Quiz & Adaptive Practice History',
    font: '/F2',
    size: 13,
    color: [0.09, 0.13, 0.24],
  });
  builder.cursorY -= 16;

  if (summary.attempts.length === 0) {
    builder.drawText({
      x: PAGE_MARGIN_X + 8,
      y: builder.cursorY,
      text: 'No quiz attempts recorded yet.',
      font: '/F1',
      size: 10,
      color: [0.35, 0.42, 0.52],
    });
    builder.cursorY -= 16;
  } else {
    summary.attempts.forEach((att, idx) => {
      builder.ensureSpace(42);
      const modeLabel =
        att.mode === 'adaptive' ? 'Adaptive Practice' : 'Diagnostic Quiz';
      const dateStr = new Date(att.completedAt).toLocaleString();

      builder.drawText({
        x: PAGE_MARGIN_X,
        y: builder.cursorY,
        text: `Attempt #${idx + 1}: ${att.materialTitle} [${modeLabel}] - Score: ${att.score}/${att.total} (${att.percentage}%) on ${dateStr}`,
        font: '/F2',
        size: 10,
        color: [0.09, 0.13, 0.24],
      });
      builder.cursorY -= 14;

      const weakStr =
        att.weakTopics.length > 0
          ? `Weak Topics: ${att.weakTopics.join(', ')}`
          : 'All tested topics mastered (100% accuracy)';

      builder.drawText({
        x: PAGE_MARGIN_X + 10,
        y: builder.cursorY,
        text: weakStr,
        font: '/F1',
        size: 9,
        color: [0.39, 0.45, 0.55],
      });
      builder.cursorY -= 14;

      att.results.forEach((res, qIdx) => {
        const statusTag = res.isCorrect ? '[CORRECT]' : '[MISSED]';
        const qLines = wrapLines(
          `Q${qIdx + 1} ${statusTag} (${res.topic}, Page ${res.pageNumber}): ${res.question}`,
          86
        );
        const ansLine = res.isCorrect
          ? `Selected: ${res.selectedOption}`
          : `Selected: ${res.selectedOption} | Correct Answer: ${res.correctOption}`;
        const ansLines = wrapLines(ansLine, 84);

        builder.ensureSpace((qLines.length + ansLines.length) * 13 + 6);

        for (const line of qLines) {
          builder.drawText({
            x: PAGE_MARGIN_X + 14,
            y: builder.cursorY,
            text: line,
            font: '/F1',
            size: 9,
            color: [0.15, 0.2, 0.3],
          });
          builder.cursorY -= 12.5;
        }

        for (const line of ansLines) {
          builder.drawText({
            x: PAGE_MARGIN_X + 20,
            y: builder.cursorY,
            text: line,
            font: '/F1',
            size: 8.5,
            color: res.isCorrect ? [0.09, 0.5, 0.24] : [0.78, 0.16, 0.16],
          });
          builder.cursorY -= 12;
        }
        builder.cursorY -= 3;
      });

      builder.cursorY -= 8;
    });
  }

  return builder.compile();
}

// ============================================================================
// 6. UNIFIED QUICK REVISE PDF GENERATOR & CLIENT DOWNLOAD TRIGGERS
// ============================================================================

export function buildQuickRevisePdfFilename(
  materialTitle: string,
  mode?: QuickReviseExportMode
): string {
  const cleanedTitle = (materialTitle || 'Study_Material')
    .replace(/\.(pdf|txt|md)$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);

  const modeSuffix =
    mode === 'sticky_notes'
      ? 'Sticky_Notes'
      : mode === 'flashcards'
        ? 'Flashcards'
        : mode === 'mind_map'
          ? 'Mind_Map'
          : mode === 'revision_sheet'
            ? 'One_Page_Revision'
            : '';

  if (!cleanedTitle) {
    return 'LearnMate_Quick_Revision.pdf';
  }
  return modeSuffix
    ? `LearnMate_Quick_Revision_${cleanedTitle}_${modeSuffix}.pdf`
    : `LearnMate_Quick_Revision_${cleanedTitle}.pdf`;
}

export function generateQuickRevisePdfBytes(params: {
  mode: QuickReviseExportMode;
  materialTitle: string;
  stickyNotes?: StickyNote[];
  flashcards?: FlashcardItem[];
  mindMap?: MindMapData | null;
  revisionSheet?: OnePageRevisionSheet | null;
}): Uint8Array {
  const {
    mode,
    materialTitle,
    stickyNotes = [],
    flashcards = [],
    mindMap = null,
    revisionSheet = null,
  } = params;

  switch (mode) {
    case 'sticky_notes':
      return generateStickyNotesPdfBytes(materialTitle, stickyNotes);
    case 'flashcards':
      return generateFlashcardsPdfBytes(materialTitle, flashcards);
    case 'mind_map':
      if (!mindMap) {
        throw new Error('Generate the Mind Map first before downloading as PDF.');
      }
      return generateMindMapPdfBytes(materialTitle, mindMap);
    case 'revision_sheet':
      if (!revisionSheet) {
        throw new Error(
          'Generate the One-Page Revision Sheet first before downloading as PDF.'
        );
      }
      return generateRevisionSheetPdfBytes(revisionSheet);
  }
}

export function triggerBinaryPdfDownload(
  pdfBytes: Uint8Array,
  filename: string
): string {
  if (!pdfBytes || pdfBytes.byteLength < 64) {
    throw new Error('Generated PDF document is empty or invalid.');
  }
  const header = new TextDecoder().decode(pdfBytes.slice(0, 8));
  if (!header.startsWith('%PDF-')) {
    throw new Error('Invalid PDF header in generated binary.');
  }

  const normalizedFilename = filename.toLowerCase().endsWith('.pdf')
    ? filename
    : `${filename.replace(/\.[a-z0-9]+$/i, '')}.pdf`;

  const blob = new Blob([pdfBytes as unknown as BlobPart], {
    type: 'application/pdf',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = normalizedFilename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return normalizedFilename;
}

export function downloadStudyReportPdf(
  summary: StudyReportSummary,
  customFilename?: string
): string {
  const bytes = generatePdfReportBytes(summary);
  const dateTag = new Date().toISOString().slice(0, 10);
  const targetName = customFilename || `LearnMate_Study_Report_${dateTag}.pdf`;
  return triggerBinaryPdfDownload(bytes, targetName);
}

export function downloadRevisionSheetPdf(
  sheet: OnePageRevisionSheet,
  customFilename?: string
): string {
  const bytes = generateRevisionSheetPdfBytes(sheet);
  const targetName =
    customFilename ||
    buildQuickRevisePdfFilename(sheet.chapterTitle, 'revision_sheet');
  return triggerBinaryPdfDownload(bytes, targetName);
}

export function downloadQuickRevisePdf(params: {
  mode: QuickReviseExportMode;
  materialTitle: string;
  stickyNotes?: StickyNote[];
  flashcards?: FlashcardItem[];
  mindMap?: MindMapData | null;
  revisionSheet?: OnePageRevisionSheet | null;
  customFilename?: string;
}): string {
  const bytes = generateQuickRevisePdfBytes(params);
  const targetName =
    params.customFilename ||
    buildQuickRevisePdfFilename(params.materialTitle, params.mode);
  return triggerBinaryPdfDownload(bytes, targetName);
}
