import React, { useEffect, useState } from 'react';

export type BuddyAvatarState =
  | 'idle'
  | 'connecting'
  | 'requesting_permission'
  | 'listening'
  | 'thinking'
  | 'speaking';

interface LearnMateBuddyAvatarProps {
  state: BuddyAvatarState;
  /** Real-time normalized output audio energy (0..1) from Web Audio AnalyserNode */
  outputAudioLevel?: number;
  /** Real-time normalized microphone input energy (0..1) */
  micAudioLevel?: number;
  isMicMuted?: boolean;
  isMuted?: boolean;
  isTutorAudioMuted?: boolean;
}

export const LearnMateBuddyAvatar: React.FC<LearnMateBuddyAvatarProps> = ({
  state,
  outputAudioLevel = 0,
  micAudioLevel = 0,
  isMicMuted = false,
  isMuted = false,
  isTutorAudioMuted = false,
}) => {
  const effectiveMicMuted = isMicMuted || isMuted;
  const [isBlinking, setIsBlinking] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Gentle natural blinking every ~3.6 seconds unless reduced motion is enabled
  useEffect(() => {
    if (prefersReducedMotion) return;
    const interval = setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 150);
    }, 3600);
    return () => clearInterval(interval);
  }, [prefersReducedMotion]);

  // Mouth openness strictly driven by real-time output audio energy when speaking
  const activeMouthLevel =
    state === 'speaking' && !isTutorAudioMuted
      ? Math.min(1, Math.max(0.08, outputAudioLevel * 2.8))
      : 0;

  const mouthHeight = 3 + Math.round(activeMouthLevel * 18);
  const mouthWidth = 22 + Math.round(activeMouthLevel * 8);

  // Listening ring scale driven by real-time mic level
  const activeMicRingScale =
    state === 'listening' && !isMicMuted && !prefersReducedMotion
      ? 1 + Math.min(0.18, micAudioLevel * 0.45)
      : 1;

  // Eye pupil offsets by state
  const pupilOffsetX = state === 'thinking' ? 2.5 : state === 'listening' ? -1 : 0;
  const pupilOffsetY = state === 'thinking' ? -3 : state === 'listening' ? 0.5 : 0;

  const stateBadgeConfig: Record<
    BuddyAvatarState,
    { label: string; dotColor: string; ringColor: string }
  > = {
    idle: {
      label: 'Ready to Study',
      dotColor: 'bg-slate-400',
      ringColor: 'border-slate-200/80',
    },
    connecting: {
      label: 'Connecting...',
      dotColor: 'bg-[#FBBC05] animate-pulse',
      ringColor: 'border-[#FBBC05]/60',
    },
    requesting_permission: {
      label: 'Requesting Mic Access...',
      dotColor: 'bg-[#FBBC05] animate-pulse',
      ringColor: 'border-[#FBBC05]/60',
    },
    listening: {
      label: effectiveMicMuted ? 'Mic Muted' : 'Listening to You',
      dotColor: effectiveMicMuted ? 'bg-[#EA4335]' : 'bg-[#34A853] animate-pulse',
      ringColor: effectiveMicMuted ? 'border-[#EA4335]/40' : 'border-[#34A853]/70',
    },
    thinking: {
      label: 'Thinking...',
      dotColor: 'bg-[#FBBC05] animate-bounce',
      ringColor: 'border-[#FBBC05]/70',
    },
    speaking: {
      label: isTutorAudioMuted ? 'Speaking (Audio Muted)' : 'LearnMate Buddy Speaking',
      dotColor: 'bg-[#4285F4] animate-ping',
      ringColor: 'border-[#4285F4]/80',
    },
  };

  const badge = stateBadgeConfig[state];

  return (
    <div
      className="flex flex-col items-center justify-center select-none"
      data-testid="learnmate-buddy-avatar"
      data-avatar-state={state}
    >
      <div className="relative w-36 h-36 sm:w-40 sm:h-40 flex items-center justify-center">
        {/* Outer reactive aura ring */}
        <div
          style={{
            transform: `scale(${
              state === 'speaking' && !prefersReducedMotion
                ? 1 + activeMouthLevel * 0.14
                : activeMicRingScale
            })`,
          }}
          className={`absolute inset-1 rounded-full border-2 transition-transform duration-100 ${badge.ringColor} ${
            state === 'speaking'
              ? 'bg-[#4285F4]/10 shadow-[0_0_30px_rgba(66,133,244,0.22)]'
              : state === 'listening' && !isMicMuted
                ? 'bg-[#34A853]/10 shadow-[0_0_24px_rgba(52,168,83,0.18)]'
                : state === 'thinking'
                  ? 'bg-[#FBBC05]/10'
                  : 'bg-slate-100/40'
          }`}
        />

        {/* Thinking orbital dots (shown ONLY in thinking state) */}
        {state === 'thinking' && (
          <div
            className="absolute -top-1 right-2 flex items-center gap-1 bg-white/95 border border-[#FDE68A] px-2.5 py-1 rounded-full shadow-sm z-10"
            aria-label="LearnMate Buddy is thinking"
          >
            <span className="w-2 h-2 rounded-full bg-[#4285F4] animate-bounce" />
            <span
              className="w-2 h-2 rounded-full bg-[#EA4335] animate-bounce"
              style={{ animationDelay: '120ms' }}
            />
            <span
              className="w-2 h-2 rounded-full bg-[#FBBC05] animate-bounce"
              style={{ animationDelay: '240ms' }}
            />
          </div>
        )}

        {/* 2D SVG Character — "LearnMate Buddy" */}
        <svg
          viewBox="0 0 160 160"
          className="w-32 h-32 sm:w-36 sm:h-36 relative z-0 drop-shadow-sm"
          role="img"
          aria-label={`LearnMate Buddy 2D AI Voice Tutor (${badge.label})`}
        >
          <defs>
            <linearGradient id="buddyFaceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#F0F6FF" />
            </linearGradient>
            <linearGradient id="buddyRimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4285F4" />
              <stop offset="35%" stopColor="#EA4335" />
              <stop offset="70%" stopColor="#FBBC05" />
              <stop offset="100%" stopColor="#34A853" />
            </linearGradient>
          </defs>

          {/* Left & Right Ear Headphones / Audio Pods */}
          <g
            transform={
              state === 'listening' && !prefersReducedMotion
                ? 'translate(0, -1.5)'
                : 'translate(0, 0)'
            }
          >
            <rect
              x="16"
              y="66"
              width="14"
              height="32"
              rx="7"
              fill={state === 'listening' && !isMicMuted ? '#34A853' : '#4285F4'}
            />
            <rect
              x="130"
              y="66"
              width="14"
              height="32"
              rx="7"
              fill={state === 'listening' && !isMicMuted ? '#34A853' : '#4285F4'}
            />
            {/* Sound wave ticks next to ear when listening */}
            {state === 'listening' && !isMicMuted && (
              <>
                <path
                  d="M 10 74 Q 5 82 10 90"
                  stroke="#34A853"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M 150 74 Q 155 82 150 90"
                  stroke="#34A853"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                />
              </>
            )}
          </g>

          {/* Main Head Circle */}
          <circle
            cx="80"
            cy="84"
            r="52"
            fill="url(#buddyFaceGrad)"
            stroke="url(#buddyRimGrad)"
            strokeWidth="3.5"
          />

          {/* Friendly Graduation Cap / Academic Crest */}
          <g transform="translate(0, -2)">
            <polygon
              points="80,16 124,32 80,46 36,32"
              fill="#172033"
              stroke="#4285F4"
              strokeWidth="1.5"
            />
            <path
              d="M 54 38 L 54 48 Q 80 55 106 48 L 106 38"
              fill="#1E293B"
            />
            {/* Google Yellow Tassel */}
            <path
              d="M 80 31 Q 108 34 114 50"
              stroke="#FBBC05"
              strokeWidth="2.5"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="114" cy="51" r="3.5" fill="#FBBC05" />
          </g>

          {/* Soft Cheek Blushes */}
          <ellipse cx="48" cy="95" rx="7" ry="4" fill="#EA4335" opacity="0.18" />
          <ellipse cx="112" cy="95" rx="7" ry="4" fill="#EA4335" opacity="0.18" />

          {/* Expressive Eyebrows */}
          <path
            d={
              state === 'thinking'
                ? 'M 50 64 Q 58 59 66 63'
                : state === 'speaking'
                  ? 'M 50 63 Q 58 58 66 63'
                  : 'M 50 65 Q 58 62 66 65'
            }
            stroke="#172033"
            strokeWidth="2.8"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d={
              state === 'thinking'
                ? 'M 94 61 Q 102 56 110 61'
                : state === 'speaking'
                  ? 'M 94 63 Q 102 58 110 63'
                  : 'M 94 65 Q 102 62 110 65'
            }
            stroke="#172033"
            strokeWidth="2.8"
            strokeLinecap="round"
            fill="none"
          />

          {/* Eyes (Blink or Open with dynamic pupil offset) */}
          {isBlinking ? (
            <>
              <path
                d="M 49 78 Q 58 82 67 78"
                stroke="#172033"
                strokeWidth="3.2"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 93 78 Q 102 82 111 78"
                stroke="#172033"
                strokeWidth="3.2"
                strokeLinecap="round"
                fill="none"
              />
            </>
          ) : (
            <>
              <g transform={`translate(${pupilOffsetX}, ${pupilOffsetY})`}>
                <circle cx="58" cy="78" r="7.5" fill="#172033" />
                <circle cx="55.5" cy="75.5" r="2.5" fill="#FFFFFF" />
              </g>
              <g transform={`translate(${pupilOffsetX}, ${pupilOffsetY})`}>
                <circle cx="102" cy="78" r="7.5" fill="#172033" />
                <circle cx="99.5" cy="75.5" r="2.5" fill="#FFFFFF" />
              </g>
            </>
          )}

          {/* Mouth — Lip-Synced to Real Output Audio Energy when Speaking */}
          {state === 'speaking' && activeMouthLevel > 0.05 ? (
            <g>
              <rect
                x={80 - mouthWidth / 2}
                y={104 - mouthHeight / 2}
                width={mouthWidth}
                height={mouthHeight}
                rx={mouthHeight / 2}
                fill="#172033"
              />
              {mouthHeight >= 9 && (
                <path
                  d={`M ${80 - mouthWidth / 3} ${104 + mouthHeight / 4} Q 80 ${
                    104 + mouthHeight / 2
                  } ${80 + mouthWidth / 3} ${104 + mouthHeight / 4}`}
                  fill="#EA4335"
                />
              )}
            </g>
          ) : state === 'thinking' ? (
            <ellipse cx="83" cy="105" rx="5.5" ry="4" fill="#172033" />
          ) : (
            <path
              d="M 66 102 Q 80 112 94 102"
              stroke="#172033"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </svg>
      </div>

      {/* State Pill Badge */}
      <div className="mt-1.5 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200/90 shadow-2xs">
        <span className={`w-2 h-2 rounded-full ${badge.dotColor}`} />
        <span className="text-[11px] font-bold text-[#172033] tracking-wide">
          {badge.label}
        </span>
      </div>
    </div>
  );
};
