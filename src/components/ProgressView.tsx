import React, { useState } from 'react';
import {
  BarChart2,
  ClipboardCheck,
  TrendingUp,
  Award,
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Trash2,
  Download,
  Printer,
  FileText,
  CheckCircle2,
  X,
} from 'lucide-react';
import { QuizAttempt, StudyMaterial } from '../types/study';
import { computeTopicProgress } from '../lib/studyLogic';
import {
  buildStudyReportSummary,
  downloadStudyReportPdf,
} from '../lib/pdfReportGenerator';

interface ProgressViewProps {
  attempts: QuizAttempt[];
  materials: StudyMaterial[];
  onStartQuizForMaterial: (material: StudyMaterial) => void;
  onClearHistory: () => void;
}

export const ProgressView: React.FC<ProgressViewProps> = ({
  attempts,
  materials,
  onStartQuizForMaterial,
  onClearHistory,
}) => {
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('all');
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [exportStatusMessage, setExportStatusMessage] = useState<string | null>(
    null
  );

  const filteredAttempts =
    selectedMaterialId === 'all'
      ? attempts
      : attempts.filter((a) => a.materialId === selectedMaterialId);

  const chronological = [...filteredAttempts].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );

  const topicProgress = computeTopicProgress(filteredAttempts);

  const totalAttempts = filteredAttempts.length;
  const averagePct =
    totalAttempts > 0
      ? Math.round(
          filteredAttempts.reduce((acc, a) => acc + a.percentage, 0) /
            totalAttempts
        )
      : 0;
  const firstScore = chronological[0]?.percentage ?? 0;
  const latestScore = chronological[chronological.length - 1]?.percentage ?? 0;
  const overallDelta = totalAttempts >= 2 ? latestScore - firstScore : 0;

  const reportSummary = buildStudyReportSummary({
    attempts,
    materials,
    selectedMaterialId,
  });

  const handleDownloadPdf = () => {
    const dateTag = new Date().toISOString().slice(0, 10);
    const filename = `LearnMate_Study_Report_${dateTag}.pdf`;
    downloadStudyReportPdf(reportSummary, filename);
    setExportStatusMessage(`Downloaded ${filename}`);
    setTimeout(() => {
      setExportStatusMessage(null);
    }, 5000);
  };

  const handlePrintReport = () => {
    setShowReportPreview(true);
    setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignore in headless mode
      }
    }, 150);
  };

  return (
    <div className="max-w-[1220px] mx-auto px-4 sm:px-8 py-8 space-y-8">
      {/* Header Row + PDF Export Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#172033]">
            Learning Progress Dashboard
          </h1>
          <p className="text-sm text-[#64748B] mt-1">
            Real quiz results, attempt comparisons, topic-level improvement, and downloadable PDF study reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {attempts.length > 0 && (
            <select
              aria-label="Filter progress by study material"
              value={selectedMaterialId}
              onChange={(e) => setSelectedMaterialId(e.target.value)}
              className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm font-semibold text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#4285F4]"
            >
              <option value="all">
                All Study Materials ({attempts.length} attempts)
              </option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          )}

          {/* Printable Preview Button */}
          <button
            type="button"
            onClick={() => setShowReportPreview(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs sm:text-sm font-semibold text-[#172033] transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4 text-[#4285F4]" />
            <span>Printable Report</span>
          </button>

          {/* Direct Download PDF Report Button */}
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-semibold text-xs sm:text-sm shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export PDF Report</span>
          </button>

          {attempts.length > 0 &&
            (confirmClear ? (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl">
                <span className="text-xs font-semibold text-[#DC2626]">
                  Reset history?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onClearHistory();
                    setConfirmClear(false);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#DC2626] text-white text-xs font-bold cursor-pointer"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:text-[#DC2626] hover:bg-red-50/40 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset History</span>
              </button>
            ))}
        </div>
      </div>

      {/* Export Confirmation Banner */}
      {exportStatusMessage && (
        <div
          role="status"
          className="no-print flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-[#F1FAF4] border border-[#BBF7D0] text-xs sm:text-sm font-semibold text-[#15803D]"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{exportStatusMessage} — Ready for offline review or printing.</span>
          </div>
          <button
            type="button"
            onClick={() => setExportStatusMessage(null)}
            className="text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Honest Empty State when no attempts exist */}
      {filteredAttempts.length === 0 ? (
        <div className="google-gradient-panel rounded-[28px] p-10 sm:p-14 text-center max-w-2xl mx-auto space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-[#F1FAF4] text-[#34A853] flex items-center justify-center mx-auto">
            <BarChart2 className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-xl font-bold text-[#172033]">
              No Quiz or Practice Attempts Recorded Yet
            </h2>
            <p className="text-sm text-[#64748B] max-w-md mx-auto leading-relaxed">
              LearnMate never fabricates statistics. Complete your first Diagnostic Quiz or Adaptive Practice session to unlock real score comparisons, topic mastery tables, and full quiz performance PDF exports.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            {materials.slice(0, 2).map((mat) => (
              <button
                key={mat.id}
                type="button"
                onClick={() => onStartQuizForMaterial(mat)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-semibold text-xs sm:text-sm shadow-xs transition-colors cursor-pointer"
              >
                <span>Take Diagnostic Quiz: {mat.title}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="google-gradient-card rounded-2xl p-5 print-card">
              <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
                <span>Completed Quizzes</span>
                <ClipboardCheck className="w-4 h-4 text-[#4285F4]" />
              </div>
              <p className="font-display text-3xl font-extrabold text-[#172033] mt-2 tabular-nums">
                {totalAttempts}
              </p>
              <p className="text-xs text-[#64748B] mt-1">
                Diagnostic & adaptive sessions
              </p>
            </div>

            <div className="google-gradient-card rounded-2xl p-5 print-card">
              <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
                <span>Average Accuracy</span>
                <Award className="w-4 h-4 text-[#FBBC05]" />
              </div>
              <p className="font-display text-3xl font-extrabold text-[#172033] mt-2 tabular-nums">
                {averagePct}%
              </p>
              <p className="text-xs text-[#64748B] mt-1">
                Across all graded questions
              </p>
            </div>

            <div className="google-gradient-card rounded-2xl p-5 print-card">
              <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
                <span>Latest Attempt Score</span>
                <Clock className="w-4 h-4 text-[#EA4335]" />
              </div>
              <p className="font-display text-3xl font-extrabold text-[#172033] mt-2 tabular-nums">
                {latestScore}%
              </p>
              <p className="text-xs text-[#64748B] mt-1 truncate">
                {chronological[chronological.length - 1]?.materialTitle}
              </p>
            </div>

            <div className="google-gradient-card rounded-2xl p-5 print-card">
              <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
                <span>Net Score Change</span>
                <TrendingUp className="w-4 h-4 text-[#34A853]" />
              </div>
              <p
                className={`font-display text-3xl font-extrabold mt-2 tabular-nums ${
                  overallDelta > 0
                    ? 'text-[#16A34A]'
                    : overallDelta < 0
                      ? 'text-[#DC2626]'
                      : 'text-[#172033]'
                }`}
              >
                {totalAttempts >= 2
                  ? `${overallDelta >= 0 ? '+' : ''}${overallDelta}%`
                  : 'Baseline'}
              </p>
              <p className="text-xs text-[#64748B] mt-1">
                {totalAttempts >= 2
                  ? `From ${firstScore}% first attempt to ${latestScore}%`
                  : 'Complete a 2nd attempt to compare'}
              </p>
            </div>
          </div>

          {/* Attempt-over-Attempt Score Progression */}
          <div className="google-gradient-panel rounded-[28px] p-6 space-y-4 print-card">
            <div>
              <h2 className="font-display text-lg font-bold text-[#172033]">
                Attempt Score Comparison
              </h2>
              <p className="text-xs text-[#64748B]">
                Chronological comparison of your diagnostic quizzes and adaptive practice runs
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pt-2">
              {chronological.map((att, index) => (
                <div
                  key={att.id}
                  className="rounded-2xl border border-slate-200/80 p-4 bg-slate-50/60 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-700 tabular-nums">
                        Attempt #{index + 1}
                      </span>
                      <span
                        className={`font-semibold ${
                          att.mode === 'adaptive' ? 'text-[#2563EB]' : 'text-[#EA4335]'
                        }`}
                      >
                        {att.mode === 'adaptive' ? 'Adaptive' : 'Diagnostic'}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-[#172033] truncate">
                      {att.materialTitle}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-2xl font-extrabold text-[#172033] tabular-nums">
                        {att.percentage}%
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {att.score}/{att.total} correct
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          att.percentage >= 80
                            ? 'bg-[#34A853]'
                            : att.percentage >= 50
                              ? 'bg-[#FBBC05]'
                              : 'bg-[#EA4335]'
                        }`}
                        style={{ width: `${att.percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Topic-Level Mastery & Improvement Table */}
          <div className="google-gradient-panel rounded-[28px] p-6 space-y-4 print-card">
            <div>
              <h2 className="font-display text-lg font-bold text-[#172033]">
                Topic-Level Mastery & Improvement
              </h2>
              <p className="text-xs text-[#64748B]">
                Tracks your accuracy per topic from first diagnostic quiz to latest adaptive practice
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-3 pr-4">Topic</th>
                    <th className="py-3 px-4 text-right">Questions Answered</th>
                    <th className="py-3 px-4 text-right">First Score</th>
                    <th className="py-3 px-4 text-right">Latest Score</th>
                    <th className="py-3 pl-4 text-right">Improvement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {topicProgress.map((tp) => (
                    <tr key={tp.topic} className="hover:bg-slate-50/80">
                      <td className="py-3.5 pr-4 font-display font-bold text-[#172033]">
                        {tp.topic}
                      </td>
                      <td className="py-3.5 px-4 text-right text-xs text-slate-600 tabular-nums">
                        {tp.totalCorrect} / {tp.totalAsked} ({tp.attemptsCount}{' '}
                        {tp.attemptsCount === 1 ? 'attempt' : 'attempts'})
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                        {tp.firstScorePct}%
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs font-bold text-[#172033] tabular-nums">
                        {tp.latestScorePct}%
                      </td>
                      <td className="py-3.5 pl-4 text-right font-mono text-xs font-bold tabular-nums">
                        {tp.attemptsCount > 1 ? (
                          <span
                            className={
                              tp.improvementPct > 0
                                ? 'text-[#16A34A]'
                                : tp.improvementPct < 0
                                  ? 'text-[#DC2626]'
                                  : 'text-slate-500'
                            }
                          >
                            {tp.improvementPct >= 0
                              ? `+${tp.improvementPct}%`
                              : `${tp.improvementPct}%`}
                          </span>
                        ) : (
                          <span className="text-slate-400">Baseline</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Attempt History Log */}
          <div className="google-gradient-panel rounded-[28px] p-6 space-y-4 print-card">
            <h2 className="font-display text-lg font-bold text-[#172033]">
              Complete Attempt History
            </h2>

            <div className="space-y-3">
              {filteredAttempts.map((att) => {
                const isExpanded = expandedAttemptId === att.id;
                return (
                  <div
                    key={att.id}
                    className="rounded-2xl border border-slate-200/80 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedAttemptId(isExpanded ? null : att.id)
                      }
                      className="w-full px-5 py-4 bg-slate-50/70 hover:bg-slate-100/60 flex items-center justify-between gap-4 text-left transition-colors cursor-pointer"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-bold text-[#172033]">
                            {att.materialTitle}
                          </span>
                          <span>·</span>
                          <span>
                            {att.mode === 'adaptive'
                              ? 'Adaptive Practice'
                              : 'Diagnostic Quiz'}
                          </span>
                          <span>·</span>
                          <span>{new Date(att.completedAt).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-slate-600">
                          Score:{' '}
                          <strong className="tabular-nums">
                            {att.score}/{att.total} ({att.percentage}%)
                          </strong>
                          {att.weakTopics.length > 0
                            ? ` · Weak topics: ${att.weakTopics.join(', ')}`
                            : ' · All topics mastered'}
                        </p>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="p-5 bg-white border-t border-slate-100 space-y-3">
                        {att.results.map((r, i) => (
                          <div
                            key={r.questionId}
                            className="text-xs border-b border-slate-100 last:border-none pb-3 last:pb-0 space-y-1"
                          >
                            <p className="font-bold text-[#172033]">
                              Q{i + 1} ({r.topic} · Page {r.pageNumber}): {r.question}
                            </p>
                            <p
                              className={
                                r.isCorrect ? 'text-[#15803D]' : 'text-[#DC2626]'
                              }
                            >
                              Your Choice: {r.selectedOption}{' '}
                              {!r.isCorrect && `| Correct: ${r.correctOption}`}
                            </p>
                            <p className="text-slate-500">{r.explanation}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Printable & Downloadable Study Summary Report Modal */}
      {showReportPreview && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-preview-title"
        >
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-6 my-8 max-h-[90vh] overflow-y-auto">
            {/* Modal Action Bar (hidden when printing) */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 no-print">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#E8F0FE] text-[#4285F4] flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="report-preview-title"
                    className="font-display font-bold text-base text-[#172033]"
                  >
                    Study Summary & Quiz Performance Report
                  </h2>
                  <p className="text-xs text-[#64748B]">
                    Print this report or download as a standalone PDF file
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintReport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#172033] cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-[#4285F4]" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#4285F4] hover:bg-[#2563EB] text-white text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowReportPreview(false)}
                  className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                  aria-label="Close report preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Formatted Printable Document Content */}
            <div className="space-y-6 text-[#172033]">
              <div className="border-b-2 border-[#4285F4] pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#4285F4]">
                    LearnMate Official Study Report
                  </p>
                  <h3 className="font-display text-2xl font-bold mt-0.5">
                    {reportSummary.filterTitle}
                  </h3>
                </div>
                <p className="text-xs text-[#64748B]">
                  Generated: {new Date(reportSummary.generatedAt).toLocaleString()}
                </p>
              </div>

              {/* Executive Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-semibold text-[#64748B]">
                    Total Quizzes
                  </span>
                  <p className="font-display text-xl font-bold mt-0.5 tabular-nums">
                    {reportSummary.totalAttempts}
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-semibold text-[#64748B]">
                    Average Score
                  </span>
                  <p className="font-display text-xl font-bold mt-0.5 tabular-nums">
                    {reportSummary.averageAccuracyPct}%
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-semibold text-[#64748B]">
                    Latest Score
                  </span>
                  <p className="font-display text-xl font-bold mt-0.5 tabular-nums">
                    {reportSummary.latestScorePct}%
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-semibold text-[#64748B]">
                    Net Improvement
                  </span>
                  <p className="font-display text-xl font-bold mt-0.5 tabular-nums text-[#15803D]">
                    {reportSummary.totalAttempts >= 2
                      ? `${reportSummary.netImprovementPct >= 0 ? '+' : ''}${
                          reportSummary.netImprovementPct
                        }%`
                      : 'Baseline'}
                  </p>
                </div>
              </div>

              {/* Topic Mastery Section */}
              <div className="space-y-2">
                <h4 className="font-display font-bold text-sm uppercase tracking-wider text-[#64748B]">
                  Topic-Level Mastery Summary
                </h4>
                {reportSummary.topicProgress.length === 0 ? (
                  <p className="text-xs text-[#64748B]">
                    No quiz attempts recorded yet.
                  </p>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[#64748B]">
                        <th className="py-2 pr-3">Topic</th>
                        <th className="py-2 px-3 text-right">Correct / Total</th>
                        <th className="py-2 px-3 text-right">First Score</th>
                        <th className="py-2 pl-3 text-right">Latest Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportSummary.topicProgress.map((tp) => (
                        <tr key={tp.topic}>
                          <td className="py-2 pr-3 font-semibold">{tp.topic}</td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {tp.totalCorrect}/{tp.totalAsked}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {tp.firstScorePct}%
                          </td>
                          <td className="py-2 pl-3 text-right font-bold tabular-nums">
                            {tp.latestScorePct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Attempt History Summary */}
              {reportSummary.attempts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-display font-bold text-sm uppercase tracking-wider text-[#64748B]">
                    Recorded Quiz & Adaptive Practice Attempts
                  </h4>
                  <div className="space-y-2">
                    {reportSummary.attempts.map((att, idx) => (
                      <div
                        key={att.id}
                        className="p-3 rounded-xl border border-slate-200 text-xs flex items-center justify-between gap-3"
                      >
                        <div>
                          <p className="font-bold">
                            Attempt #{idx + 1}: {att.materialTitle} (
                            {att.mode === 'adaptive'
                              ? 'Adaptive Practice'
                              : 'Diagnostic Quiz'}
                            )
                          </p>
                          <p className="text-[#64748B]">
                            {att.weakTopics.length > 0
                              ? `Weak Topics: ${att.weakTopics.join(', ')}`
                              : 'All tested topics mastered'}
                          </p>
                        </div>
                        <span className="font-display font-bold text-sm tabular-nums">
                          {att.score}/{att.total} ({att.percentage}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
