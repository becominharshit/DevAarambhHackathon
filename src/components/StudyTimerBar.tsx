import React, { useEffect, useState } from 'react';
import {
  Timer,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Focus,
  CheckCircle2,
} from 'lucide-react';
import { FocusSessionRecord, StudyMaterial, StudyTimerState } from '../types/study';
import {
  computeTimerRemainingSeconds,
  formatSecondsToTimestamp,
} from '../lib/studyLogic';
import { storageService } from '../services/storageService';

interface StudyTimerBarProps {
  activeMaterial: StudyMaterial;
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
}

function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.14);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + idx * 0.14 + 0.35
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.14);
      osc.stop(ctx.currentTime + idx * 0.14 + 0.36);
    });
  } catch {
    // ignore audio block
  }
}

export const StudyTimerBar: React.FC<StudyTimerBarProps> = ({
  activeMaterial,
  isFocusMode,
  onToggleFocusMode,
}) => {
  const [timer, setTimer] = useState<StudyTimerState>(() =>
    storageService.getStudyTimerState()
  );
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    computeTimerRemainingSeconds(storageService.getStudyTimerState())
  );
  const [showSettings, setShowSettings] = useState(false);
  const [sessionToast, setSessionToast] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const rem = computeTimerRemainingSeconds(timer, now);
      setRemainingSeconds(rem);

      if (timer.isRunning && rem <= 0) {
        if (timer.soundEnabled) {
          playCompletionChime();
        }

        if (timer.phase === 'study') {
          const completedSession: FocusSessionRecord = {
            id: `focus_${Date.now()}`,
            materialId: activeMaterial.id,
            materialTitle: activeMaterial.title,
            durationMinutes: timer.studyDurationMinutes,
            completedAt: new Date().toISOString(),
          };
          storageService.saveFocusSession(completedSession);
          const breakSecs = timer.breakDurationMinutes * 60;
          const nextState: StudyTimerState = {
            ...timer,
            phase: 'break',
            isRunning: false,
            remainingSecondsWhenPaused: breakSecs,
            targetEndTimeMs: null,
            completedSessionsCount: timer.completedSessionsCount + 1,
          };
          setTimer(nextState);
          storageService.saveStudyTimerState(nextState);
          setRemainingSeconds(breakSecs);
          setSessionToast(
            `Focus session complete (${timer.studyDurationMinutes}m)! Ready for a ${timer.breakDurationMinutes}m break.`
          );
          setTimeout(() => setSessionToast(null), 5000);
        } else {
          const studySecs = timer.studyDurationMinutes * 60;
          const nextState: StudyTimerState = {
            ...timer,
            phase: 'study',
            isRunning: false,
            remainingSecondsWhenPaused: studySecs,
            targetEndTimeMs: null,
          };
          setTimer(nextState);
          storageService.saveStudyTimerState(nextState);
          setRemainingSeconds(studySecs);
          setSessionToast('Break finished! Ready for your next study session.');
          setTimeout(() => setSessionToast(null), 5000);
        }
      }
    };

    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [timer, activeMaterial]);

  const updateAndPersist = (next: StudyTimerState) => {
    setTimer(next);
    storageService.saveStudyTimerState(next);
    setRemainingSeconds(computeTimerRemainingSeconds(next));
  };

  const handleToggleStartPause = () => {
    const now = Date.now();
    if (timer.isRunning) {
      const rem = computeTimerRemainingSeconds(timer, now);
      updateAndPersist({
        ...timer,
        isRunning: false,
        remainingSecondsWhenPaused: rem,
        targetEndTimeMs: null,
      });
    } else {
      const baseRem =
        remainingSeconds > 0
          ? remainingSeconds
          : (timer.phase === 'study'
              ? timer.studyDurationMinutes
              : timer.breakDurationMinutes) * 60;
      updateAndPersist({
        ...timer,
        isRunning: true,
        remainingSecondsWhenPaused: baseRem,
        targetEndTimeMs: now + baseRem * 1000,
      });
    }
  };

  const handleReset = () => {
    const secs =
      (timer.phase === 'study'
        ? timer.studyDurationMinutes
        : timer.breakDurationMinutes) * 60;
    updateAndPersist({
      ...timer,
      isRunning: false,
      remainingSecondsWhenPaused: secs,
      targetEndTimeMs: null,
    });
  };

  const handleSkipPhase = () => {
    const nextPhase = timer.phase === 'study' ? 'break' : 'study';
    const nextSecs =
      (nextPhase === 'study'
        ? timer.studyDurationMinutes
        : timer.breakDurationMinutes) * 60;
    updateAndPersist({
      ...timer,
      phase: nextPhase,
      isRunning: false,
      remainingSecondsWhenPaused: nextSecs,
      targetEndTimeMs: null,
    });
  };

  const handleSetDurations = (studyMins: number, breakMins: number) => {
    const safeStudy = Math.min(120, Math.max(1, studyMins));
    const safeBreak = Math.min(60, Math.max(1, breakMins));
    const nextSecs = (timer.phase === 'study' ? safeStudy : safeBreak) * 60;
    updateAndPersist({
      ...timer,
      studyDurationMinutes: safeStudy,
      breakDurationMinutes: safeBreak,
      isRunning: false,
      remainingSecondsWhenPaused: nextSecs,
      targetEndTimeMs: null,
    });
    setShowSettings(false);
  };

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore if restricted by iframe
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {/* Compact Pomodoro Study Timer Pill */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-[#F4F7FC] border border-slate-200/80 text-xs">
        <div
          className={`flex items-center gap-1.5 font-display font-bold ${
            timer.phase === 'study' ? 'text-[#4285F4]' : 'text-[#34A853]'
          }`}
        >
          <Timer className="w-3.5 h-3.5 shrink-0" />
          <span className="uppercase tracking-wider text-[10px]">
            {timer.phase === 'study' ? 'Study' : 'Break'}
          </span>
        </div>

        <span
          aria-label="Study timer countdown"
          className="font-mono font-bold text-sm text-[#172033] tabular-nums px-1"
        >
          {formatSecondsToTimestamp(remainingSeconds)}
        </span>

        <button
          type="button"
          onClick={handleToggleStartPause}
          aria-label={timer.isRunning ? 'Pause study timer' : 'Start study timer'}
          title={timer.isRunning ? 'Pause Timer' : 'Start / Resume Timer'}
          className={`p-1 rounded-lg text-white transition-colors cursor-pointer ${
            timer.isRunning
              ? 'bg-[#EA4335] hover:bg-[#DC2626]'
              : 'bg-[#4285F4] hover:bg-[#2563EB]'
          }`}
        >
          {timer.isRunning ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={handleReset}
          aria-label="Reset study timer"
          title="Reset Timer"
          className="p-1 rounded-lg text-[#64748B] hover:text-[#172033] hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleSkipPhase}
          aria-label={
            timer.phase === 'study' ? 'Skip to break' : 'Skip break to study'
          }
          title={
            timer.phase === 'study' ? 'Switch to Break' : 'Skip Break'
          }
          className="p-1 rounded-lg text-[#64748B] hover:text-[#172033] hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setShowSettings((prev) => !prev)}
          aria-label="Timer settings"
          title="Customize timer durations & sound"
          className="p-1 rounded-lg text-[#64748B] hover:text-[#172033] hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>

        {timer.completedSessionsCount > 0 && (
          <span
            title="Completed focus sessions"
            className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#E8F0FE] text-[#1967D2] text-[10px] font-bold tabular-nums"
          >
            {timer.completedSessionsCount}x
          </span>
        )}
      </div>

      {/* Distraction-Free Focus Mode Button */}
      <button
        type="button"
        onClick={onToggleFocusMode}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-semibold border transition-all cursor-pointer ${
          isFocusMode
            ? 'bg-[#172033] text-white border-[#172033] shadow-xs'
            : 'bg-white hover:bg-slate-50 text-[#172033] border-slate-200/80'
        }`}
      >
        <Focus className="w-3.5 h-3.5 text-[#4285F4]" />
        <span>{isFocusMode ? 'Exit Focus' : 'Focus Mode'}</span>
      </button>

      {isFocusMode && (
        <button
          type="button"
          onClick={handleToggleFullscreen}
          className="p-1.5 rounded-xl bg-white border border-slate-200 text-[#64748B] hover:text-[#172033] transition-colors cursor-pointer"
          aria-label={isFullscreen ? 'Exit browser fullscreen' : 'Enter browser fullscreen'}
          title={isFullscreen ? 'Exit Fullscreen' : 'Browser Fullscreen'}
        >
          {isFullscreen ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
        </button>
      )}

      {/* Timer Settings Popover */}
      {showSettings && (
        <div className="absolute right-0 top-11 z-40 w-64 rounded-2xl bg-white shadow-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-display font-bold text-xs text-[#172033]">
              Study Timer Settings
            </span>
            <button
              type="button"
              onClick={() =>
                updateAndPersist({
                  ...timer,
                  soundEnabled: !timer.soundEnabled,
                })
              }
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4285F4] cursor-pointer"
            >
              {timer.soundEnabled ? (
                <>
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Sound On</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5" />
                  <span>Muted</span>
                </>
              )}
            </button>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-[#64748B]">
              Presets (Study / Break)
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: '25 / 5m', s: 25, b: 5 },
                { label: '45 / 10m', s: 45, b: 10 },
                { label: '15 / 3m', s: 15, b: 3 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleSetDurations(preset.s, preset.b)}
                  className={`px-2 py-1.5 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                    timer.studyDurationMinutes === preset.s &&
                    timer.breakDurationMinutes === preset.b
                      ? 'bg-[#E8F0FE] border-[#4285F4] text-[#1967D2]'
                      : 'border-slate-200 text-[#172033] hover:bg-slate-50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[11px] text-[#64748B]">
            <span>Completed Sessions:</span>
            <span className="font-bold text-[#172033] tabular-nums">
              {timer.completedSessionsCount}
            </span>
          </div>
        </div>
      )}

      {/* Completion Toast */}
      {sessionToast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#172033] text-white text-xs font-semibold shadow-xl border border-slate-700"
        >
          <CheckCircle2 className="w-4 h-4 text-[#34A853] shrink-0" />
          <span>{sessionToast}</span>
        </div>
      )}
    </div>
  );
};
