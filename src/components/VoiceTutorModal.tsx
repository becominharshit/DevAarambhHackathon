import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  X,
  Volume2,
  Sparkles,
  Loader2,
  Send,
  AlertCircle,
  UserCheck,
} from 'lucide-react';
import { DocumentAnalysis, StudyMaterial } from '../types/study';
import { LearnMateBuddyAvatar } from './LearnMateBuddyAvatar';
import { getCurrentUserAuthToken } from '../services/firebaseService';
import { askStudyTutor } from '../services/aiClient';
import {
  computeProgressiveWordDelayMs,
  getProgressiveCaptionSlice,
  mergeIncrementalTranscript,
  tokenizeCaptionWords,
} from '../lib/studyLogic';

interface VoiceTutorModalProps {
  isOpen: boolean;
  onClose: () => void;
  material: StudyMaterial;
  analysis: DocumentAnalysis | null;
  weakTopics: string[];
}

type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'text_only_ready'
  | 'thinking'
  | 'speaking'
  | 'error';

interface TranscriptTurn {
  id: string;
  role: 'user' | 'tutor';
  text: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

function base64ToInt16Array(base64: string): Int16Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function useProgressiveCaptions(
  initialCaption: string,
  getRemainingAudioSeconds: () => number
) {
  const [liveCaption, setLiveCaptionState] = useState<string>(initialCaption);
  const targetTextRef = useRef<string>('');
  const revealedWordsRef = useRef<number>(0);
  const turnFinishedRef = useRef<boolean>(false);
  const timerRef = useRef<number | null>(null);
  const getAudioRemainingRef = useRef(getRemainingAudioSeconds);

  useEffect(() => {
    getAudioRemainingRef.current = getRemainingAudioSeconds;
  }, [getRemainingAudioSeconds]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  const scheduleNextWord = () => {
    if (timerRef.current !== null) return;
    const words = tokenizeCaptionWords(targetTextRef.current);
    const remainingWords = words.length - revealedWordsRef.current;
    if (remainingWords <= 0) return;

    const remainingAudioSec = getAudioRemainingRef.current();
    const delayMs = computeProgressiveWordDelayMs(
      remainingWords,
      remainingAudioSec
    );

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const currentWords = tokenizeCaptionWords(targetTextRef.current);
      if (currentWords.length === 0) return;
      revealedWordsRef.current = Math.min(
        currentWords.length,
        revealedWordsRef.current + 1
      );
      const slice = getProgressiveCaptionSlice(
        targetTextRef.current,
        revealedWordsRef.current
      );
      setLiveCaptionState(slice.displayedText);
      if (!slice.isComplete) {
        scheduleNextWord();
      }
    }, delayMs);
  };

  const setImmediateCaption = (text: string) => {
    clearTimer();
    targetTextRef.current = '';
    revealedWordsRef.current = 0;
    turnFinishedRef.current = false;
    setLiveCaptionState(text);
  };

  const appendTutorTranscript = (chunk: string): string => {
    if (!chunk || !chunk.trim()) return targetTextRef.current;

    if (turnFinishedRef.current) {
      clearTimer();
      turnFinishedRef.current = false;
      targetTextRef.current = chunk.trim();
      revealedWordsRef.current = 1;
      const slice = getProgressiveCaptionSlice(targetTextRef.current, 1);
      setLiveCaptionState(slice.displayedText);
      if (!slice.isComplete) {
        scheduleNextWord();
      }
      return targetTextRef.current;
    }

    const wasEmpty = targetTextRef.current.length === 0;
    targetTextRef.current = mergeIncrementalTranscript(
      targetTextRef.current,
      chunk
    );
    const words = tokenizeCaptionWords(targetTextRef.current);

    if (wasEmpty && words.length > 0) {
      revealedWordsRef.current = 1;
      setLiveCaptionState(words.slice(0, 1).join(' '));
    } else if (revealedWordsRef.current > 0) {
      setLiveCaptionState(words.slice(0, revealedWordsRef.current).join(' '));
    }

    if (revealedWordsRef.current < words.length) {
      scheduleNextWord();
    }

    return targetTextRef.current;
  };

  const markTurnComplete = () => {
    turnFinishedRef.current = true;
  };

  const interruptCaption = (): string => {
    clearTimer();
    turnFinishedRef.current = true;
    if (targetTextRef.current && revealedWordsRef.current > 0) {
      const spokenText = getProgressiveCaptionSlice(
        targetTextRef.current,
        revealedWordsRef.current
      ).displayedText;
      targetTextRef.current = spokenText;
      setLiveCaptionState(spokenText);
      return spokenText;
    }
    return targetTextRef.current;
  };

  return {
    liveCaption,
    setLiveCaption: setImmediateCaption,
    appendTutorTranscript,
    markTurnComplete,
    interruptCaption,
  };
}

export const VoiceTutorModal: React.FC<VoiceTutorModalProps> = ({
  isOpen,
  onClose,
  material,
  analysis,
  weakTopics,
}) => {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptTurn[]>([]);
  const [textFallbackInput, setTextFallbackInput] = useState('');
  const [visualMode, setVisualMode] = useState<'orb' | 'buddy'>('orb');
  const [showFullTranscript, setShowFullTranscript] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const isMutedRef = useRef<boolean>(false);
  const micDeniedRef = useRef<boolean>(false);
  const tutorTurnCompletedRef = useRef<boolean>(false);

  const {
    liveCaption,
    setLiveCaption,
    appendTutorTranscript,
    markTurnComplete,
    interruptCaption,
  } = useProgressiveCaptions(
    'Click "Start Voice Session" or type a question below to speak with your Gemini Live Voice Tutor.',
    () => {
      if (!audioCtxRef.current) return 0;
      return Math.max(
        0,
        nextPlayTimeRef.current - audioCtxRef.current.currentTime
      );
    }
  );

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    micDeniedRef.current = micPermissionDenied;
  }, [micPermissionDenied]);

  const stopSession = () => {
    interruptCaption();
    tutorTurnCompletedRef.current = true;
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    setStatus('idle');
  };

  useEffect(() => {
    if (!isOpen) {
      stopSession();
    }
    return () => {
      stopSession();
    };
  }, [isOpen]);

  const playPcm24kChunk = (base64Pcm: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const int16 = base64ToInt16Array(base64Pcm);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const sampleRate = 24000;
    const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + audioBuffer.duration;

    setStatus('speaking');
    source.onended = () => {
      if (ctx.currentTime >= nextPlayTimeRef.current - 0.05) {
        setStatus((prev) =>
          prev === 'speaking'
            ? micDeniedRef.current
              ? 'text_only_ready'
              : 'listening'
            : prev
        );
      }
    };
  };

  const startVoiceSession = async () => {
    stopSession();
    setErrorMessage(null);
    setMicPermissionDenied(false);
    micDeniedRef.current = false;
    setStatus('connecting');
    setLiveCaption('Connecting to Gemini Live Voice Tutor...');

    try {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioCtxRef.current = audioCtx;
      nextPlayTimeRef.current = audioCtx.currentTime;

      let stream: MediaStream | null = null;
      let micDenied = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        mediaStreamRef.current = stream;
      } catch {
        // Microphone denied or unavailable in headless browser; never report "Listening"
        micDenied = true;
        setMicPermissionDenied(true);
        micDeniedRef.current = true;
        setErrorMessage(
          'Microphone permission was denied or unavailable. Live audio output and text input below remain active.'
        );
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        const idToken = await getCurrentUserAuthToken();
        ws.send(
          JSON.stringify({
            type: 'setup',
            idToken: idToken || undefined,
            materialTitle: material.title,
            overview: analysis?.overview || '',
            weakTopics,
            pages: material.pages.slice(0, 6),
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ready') {
            if (micDeniedRef.current) {
              setStatus('text_only_ready');
              setLiveCaption(
                `Connected in Text + Audio Output mode for "${material.title}". Type any question below to hear your tutor respond.`
              );
            } else {
              setStatus('listening');
              setLiveCaption(
                `Listening... Ask anything about "${material.title}" or request a quick verbal quiz!`
              );
            }

            if (stream && audioCtxRef.current) {
              setupMicrophoneCapture(stream, audioCtxRef.current, ws);
            }
          } else if (msg.type === 'audio' && msg.data) {
            playPcm24kChunk(msg.data);
          } else if ((msg.type === 'transcript' || msg.type === 'text') && msg.text) {
            const role: 'user' | 'tutor' = msg.role === 'user' ? 'user' : 'tutor';
            if (role === 'tutor') {
              const startNewTurn = tutorTurnCompletedRef.current;
              tutorTurnCompletedRef.current = false;
              const mergedTutorText = appendTutorTranscript(msg.text);
              setTranscripts((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'tutor' && !startNewTurn) {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, text: mergedTutorText },
                  ];
                }
                return [
                  ...prev,
                  {
                    id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    role: 'tutor',
                    text: mergedTutorText,
                  },
                ];
              });
            } else {
              tutorTurnCompletedRef.current = true;
              markTurnComplete();
              setTranscripts((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'user') {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, text: mergeIncrementalTranscript(last.text, msg.text) },
                  ];
                }
                return [
                  ...prev,
                  {
                    id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    role: 'user',
                    text: msg.text.trim(),
                  },
                ];
              });
            }
          } else if (msg.type === 'interrupted') {
            tutorTurnCompletedRef.current = true;
            const spokenSoFar = interruptCaption();
            if (spokenSoFar) {
              setTranscripts((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'tutor') {
                  return [...prev.slice(0, -1), { ...last, text: spokenSoFar }];
                }
                return prev;
              });
            }
          } else if (msg.type === 'turnComplete' || msg.type === 'turn_complete') {
            tutorTurnCompletedRef.current = true;
            markTurnComplete();
            if (
              audioCtxRef.current &&
              audioCtxRef.current.currentTime >= nextPlayTimeRef.current - 0.05
            ) {
              setStatus(micDeniedRef.current ? 'text_only_ready' : 'listening');
            }
          } else if (msg.type === 'error') {
            setErrorMessage(msg.message || 'Live voice session encountered an error.');
            setLiveCaption(
              'Live audio stream unavailable right now. You can still ask questions using the text input below.'
            );
            setStatus('error');
          }
        } catch {
          // ignore malformed event
        }
      };

      ws.onerror = () => {
        setErrorMessage('WebSocket connection error while connecting to Gemini Live.');
        setLiveCaption(
          'Live voice connection could not be established. You can still use the text input below to ask your tutor.'
        );
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
      };
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not initialize Gemini Live Voice Tutor.');
      setLiveCaption(
        'Voice initialization encountered an issue. You can still type a question below.'
      );
      setStatus('error');
    }
  };

  const setupMicrophoneCapture = (
    stream: MediaStream,
    audioCtx: AudioContext,
    ws: WebSocket
  ) => {
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    const inputRate = audioCtx.sampleRate;
    const targetRate = 16000;

    processor.onaudioprocess = (e) => {
      if (isMutedRef.current || ws.readyState !== WebSocket.OPEN) return;
      const inputData = e.inputBuffer.getChannelData(0);

      const ratio = inputRate / targetRate;
      const outLength = Math.floor(inputData.length / ratio);
      const pcm16 = new Int16Array(outLength);

      for (let i = 0; i < outLength; i++) {
        const idx = Math.floor(i * ratio);
        const sample = Math.max(-1, Math.min(1, inputData[idx]));
        pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      const b64 = arrayBufferToBase64(pcm16.buffer);
      ws.send(
        JSON.stringify({
          type: 'audio',
          data: b64,
          mimeType: 'audio/pcm;rate=16000',
        })
      );
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
  };

  const handleSendTextToLive = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textFallbackInput.trim();
    if (!trimmed) return;

    tutorTurnCompletedRef.current = true;
    setTranscripts((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, role: 'user', text: trimmed },
    ]);
    setStatus('thinking');
    setLiveCaption(`Thinking about "${trimmed}"...`);
    setTextFallbackInput('');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed }));
      return;
    }

    // Fallback to grounded HTTP AI tutor endpoint if Live WebSocket isn't open
    try {
      const data = await askStudyTutor({
        material,
        question: trimmed,
        history: [],
      });
      const replyText =
        data.answer || 'Here is a summary based on your study material.';
      appendTutorTranscript(replyText);
      markTurnComplete();
      setTranscripts((prev) => [
        ...prev,
        { id: `t_${Date.now()}`, role: 'tutor', text: replyText },
      ]);
      setStatus(micDeniedRef.current ? 'text_only_ready' : 'idle');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Unable to reach AI Tutor right now.');
      setStatus('error');
    }
  };

  if (!isOpen) return null;

  const isSessionActive =
    status === 'connecting' ||
    status === 'listening' ||
    status === 'text_only_ready' ||
    status === 'thinking' ||
    status === 'speaking';

  // Accurate status pill that NEVER displays "Listening" when mic permission is denied or muted
  const renderStatusPill = () => {
    if (status === 'connecting') {
      return {
        label: 'Connecting...',
        dotClass: 'bg-[#4285F4] animate-ping',
        pillClass: 'bg-[#E8F0FE] text-[#1967D2] border-[#BFDBFE]',
      };
    }
    if (status === 'speaking') {
      return {
        label: 'Speaking',
        dotClass: 'bg-[#34A853] animate-pulse',
        pillClass: 'bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]',
      };
    }
    if (status === 'thinking') {
      return {
        label: 'Thinking...',
        dotClass: 'bg-[#FBBC05] animate-bounce',
        pillClass: 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]',
      };
    }
    if (status === 'error') {
      return {
        label: 'Connection Error',
        dotClass: 'bg-[#EA4335]',
        pillClass: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
      };
    }
    if (isSessionActive && micPermissionDenied) {
      return {
        label: 'Mic Blocked · Text Input Ready',
        dotClass: 'bg-[#F59E0B]',
        pillClass: 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]',
      };
    }
    if (isSessionActive && isMuted) {
      return {
        label: 'Microphone Muted',
        dotClass: 'bg-[#F59E0B]',
        pillClass: 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]',
      };
    }
    if (status === 'listening' && !micPermissionDenied) {
      return {
        label: 'Listening',
        dotClass: 'bg-[#34A853] animate-pulse',
        pillClass: 'bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]',
      };
    }
    return {
      label: 'Ready to Connect',
      dotClass: 'bg-slate-400',
      pillClass: 'bg-slate-100 text-slate-600 border-slate-200',
    };
  };

  const statusPill = renderStatusPill();

  const buddyState: 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' =
    status === 'speaking'
      ? 'speaking'
      : status === 'thinking'
        ? 'thinking'
        : status === 'connecting'
          ? 'connecting'
          : status === 'listening' && !isMuted && !micPermissionDenied
            ? 'listening'
            : 'idle';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-tutor-title"
    >
      <div className="google-gradient-panel rounded-[32px] max-w-3xl w-full overflow-hidden flex flex-col max-h-[92vh] relative">
        {/* Soft Pastel Background Waves & Floating Particles (matching Image 3) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden z-0"
        >
          <div className="absolute -top-20 -left-16 w-72 h-72 rounded-full bg-[#4285F4]/10 blur-3xl" />
          <div className="absolute top-1/4 -right-16 w-72 h-72 rounded-full bg-[#34A853]/10 blur-3xl" />
          <div className="absolute bottom-12 left-1/4 w-80 h-60 rounded-full bg-[#FBBC05]/10 blur-3xl" />
          <svg
            viewBox="0 0 800 320"
            className="absolute bottom-14 left-0 w-full h-56 opacity-45"
            preserveAspectRatio="none"
          >
            <path
              d="M0,192 C180,260 320,110 520,180 C660,230 740,150 800,175 L800,320 L0,320 Z"
              fill="url(#voiceWaveGrad1)"
            />
            <path
              d="M0,230 C220,150 410,270 610,195 C710,160 760,210 800,200 L800,320 L0,320 Z"
              fill="url(#voiceWaveGrad2)"
            />
            <defs>
              <linearGradient id="voiceWaveGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#4285F4" stopOpacity="0.16" />
                <stop offset="35%" stopColor="#EA4335" stopOpacity="0.12" />
                <stop offset="70%" stopColor="#FBBC05" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#34A853" stopOpacity="0.18" />
              </linearGradient>
              <linearGradient id="voiceWaveGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.2" />
                <stop offset="50%" stopColor="#FDE68A" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#86EFAC" stopOpacity="0.2" />
              </linearGradient>
            </defs>
          </svg>
          {/* Subtle decorative dots */}
          <span className="absolute left-12 top-1/2 w-2.5 h-2.5 rounded-full bg-[#FBBC05]/50" />
          <span className="absolute left-24 top-2/3 w-3 h-3 rounded-full bg-[#4285F4]/40" />
          <span className="absolute right-16 top-1/2 w-2.5 h-2.5 rounded-full bg-[#34A853]/50" />
          <span className="absolute right-28 bottom-1/3 w-2 h-2 rounded-full bg-[#EA4335]/40" />
        </div>

        {/* Header Bar */}
        <div className="relative z-10 px-6 py-4 border-b border-slate-200/70 flex items-center justify-between gap-3 bg-white/75 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#4285F4] via-[#EA4335] to-[#34A853] p-[2px] shrink-0 shadow-xs">
              <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
                <Volume2 className="w-5 h-5 text-[#4285F4]" />
              </div>
            </div>
            <div className="min-w-0">
              <h2
                id="voice-tutor-title"
                className="font-display font-bold text-base sm:text-lg text-[#17223C] truncate"
              >
                Gemini Live Voice Tutor
              </h2>
              <p className="text-xs text-[#5D6A80] truncate">
                Studying: <span className="font-medium text-[#17223C]">{material.title}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setVisualMode((v) => (v === 'orb' ? 'buddy' : 'orb'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100/90 hover:bg-slate-200/80 text-xs font-semibold text-[#17223C] transition-colors cursor-pointer"
              title="Switch between Central Microphone Orb and 2D Study Buddy Avatar"
            >
              <UserCheck className="w-3.5 h-3.5 text-[#4285F4]" />
              <span>{visualMode === 'orb' ? '2D Avatar' : 'Mic Orb'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                stopSession();
                onClose();
              }}
              aria-label="Close Voice Tutor"
              className="p-2 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Center Interactive Stage */}
        <div className="relative z-10 px-6 py-7 flex-1 overflow-y-auto flex flex-col items-center justify-between space-y-5">
          {/* Central Visual: Glowing Microphone Orb (Image 3) or 2D Buddy Avatar */}
          <div className="flex flex-col items-center justify-center pt-1 space-y-4">
            {visualMode === 'orb' ? (
              <div className="relative flex items-center justify-center my-2">
                {/* Outer ambient rings */}
                <div
                  className={`w-44 h-44 rounded-full flex items-center justify-center transition-all duration-500 ${
                    status === 'speaking'
                      ? 'bg-[#34A853]/12 scale-105'
                      : status === 'listening' && !micPermissionDenied && !isMuted
                        ? 'bg-[#4285F4]/12 scale-100'
                        : 'bg-[#4285F4]/8'
                  }`}
                >
                  <div
                    className={`w-34 h-34 rounded-full flex items-center justify-center border transition-all duration-500 ${
                      status === 'speaking'
                        ? 'bg-[#34A853]/18 border-[#34A853]/30'
                        : 'bg-[#4285F4]/15 border-[#4285F4]/25'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!isSessionActive) {
                          startVoiceSession();
                        } else if (!micPermissionDenied) {
                          setIsMuted((m) => !m);
                        }
                      }}
                      aria-label={
                        !isSessionActive
                          ? 'Start Voice Session'
                          : isMuted
                            ? 'Unmute Microphone'
                            : 'Mute Microphone'
                      }
                      className={`w-24 h-24 rounded-full text-white flex items-center justify-center shadow-[0_12px_32px_rgba(66,133,244,0.42)] transition-transform active:scale-95 cursor-pointer ${
                        status === 'speaking'
                          ? 'bg-gradient-to-b from-[#34A853] to-[#16A34A]'
                          : micPermissionDenied || isMuted
                            ? 'bg-gradient-to-b from-[#64748B] to-[#475569]'
                            : 'bg-gradient-to-b from-[#5B9BF8] to-[#2563EB]'
                      }`}
                    >
                      {status === 'connecting' ? (
                        <Loader2 className="w-10 h-10 animate-spin" />
                      ) : micPermissionDenied || isMuted ? (
                        <MicOff className="w-10 h-10" />
                      ) : (
                        <Mic className="w-10 h-10" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <LearnMateBuddyAvatar state={buddyState} isMuted={isMuted || micPermissionDenied} />
            )}

            {/* Accurate Status Indicator Pill */}
            <span
              className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border shadow-2xs ${statusPill.pillClass}`}
            >
              <span className={`w-2 h-2 rounded-full ${statusPill.dotClass}`} />
              <span>{statusPill.label}</span>
            </span>
          </div>

          {/* Primary Voice Controls (Mute Mic + End Conversation / Start Session) */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            {!isSessionActive ? (
              <button
                type="button"
                onClick={startVoiceSession}
                className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-semibold text-sm shadow-[0_8px_20px_rgba(66,133,244,0.3)] transition-all cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                <span>Start Live Voice Session</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={micPermissionDenied}
                  onClick={() => setIsMuted((m) => !m)}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isMuted
                      ? 'bg-[#FEF3C7] border-[#FDE68A] text-[#B45309]'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-[#17223C] shadow-2xs'
                  }`}
                >
                  {isMuted ? (
                    <>
                      <MicOff className="w-4 h-4" />
                      <span>Unmute Mic</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4 text-[#5D6A80]" />
                      <span>Mute Mic</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={stopSession}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#EA4335] hover:bg-[#DC2626] text-white font-display font-semibold text-xs sm:text-sm shadow-[0_6px_18px_rgba(234,67,53,0.28)] transition-all cursor-pointer"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>End Conversation</span>
                </button>
              </>
            )}
          </div>

          {/* Readable Live Conversation Caption Box */}
          <div className="w-full max-w-xl bg-white/90 border border-slate-200/80 rounded-2xl px-5 py-3.5 text-center shadow-2xs space-y-1.5">
            <p className="text-xs sm:text-sm text-[#17223C] leading-relaxed font-medium">
              {liveCaption}
            </p>
            {transcripts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowFullTranscript((s) => !s)}
                className="text-[11px] font-semibold text-[#4285F4] hover:underline cursor-pointer"
              >
                {showFullTranscript
                  ? 'Hide Conversation History'
                  : `Show Conversation History (${transcripts.length})`}
              </button>
            )}
          </div>

          {/* Honest Permission / Connection Notice Banner */}
          {errorMessage && (
            <div
              role="status"
              className="w-full max-w-xl px-4 py-2.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#DC2626] flex items-center justify-center gap-2 text-center"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Expandable Transcript Log */}
          {showFullTranscript && transcripts.length > 0 && (
            <div className="w-full max-w-xl max-h-36 overflow-y-auto space-y-2 bg-white/90 rounded-2xl p-3.5 border border-slate-200/80">
              {transcripts.map((t) => (
                <div
                  key={t.id}
                  className={`text-xs p-2.5 rounded-xl ${
                    t.role === 'user'
                      ? 'bg-[#E8F0FE] text-[#1967D2] ml-8'
                      : 'bg-slate-50 border border-slate-200/70 text-[#17223C] mr-8'
                  }`}
                >
                  <span className="font-bold uppercase text-[10px] block mb-0.5">
                    {t.role === 'user' ? 'You' : 'LearnMate Voice Tutor'}
                  </span>
                  {t.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Text Input Fallback with Speak Button (matching Image 3) */}
        <form
          onSubmit={handleSendTextToLive}
          className="relative z-10 px-6 py-4 border-t border-slate-200/70 bg-white/85 backdrop-blur-md flex items-center gap-2.5"
        >
          <input
            type="text"
            value={textFallbackInput}
            onChange={(e) => setTextFallbackInput(e.target.value)}
            placeholder="Or type a question for the Voice Tutor to speak..."
            aria-label="Type a question for the Voice Tutor to speak"
            className="flex-1 px-4 py-2.5 rounded-full bg-white border border-slate-200/90 focus:border-[#4285F4] text-xs sm:text-sm text-[#17223C] focus:outline-none shadow-2xs"
          />
          <button
            type="submit"
            disabled={!textFallbackInput.trim()}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#4285F4] hover:bg-[#2563EB] text-white font-display font-semibold text-xs sm:text-sm disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Speak</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
