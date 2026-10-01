import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { FireworksEngine, type FireworksMode } from './launch/fireworks';
import { LaunchSound } from './launch/sound';
import { AppBoard } from './launch/appBoard';
import { AppInfographic } from './launch/appInfographic';
import { FEATURE_HOLD_MS, LAUNCH_FEATURES, SHOWCASE_HOLD_MS } from './launch/features';
import { useTimeline } from './launch/motion';
import './launch-event.css';

type Phase = 'waiting' | 'count-in' | 'features' | 'board' | 'video' | 'complete';
type Countdown = { days: number; hours: number; minutes: number; seconds: number };

const LAUNCH_AT = new Date('2026-10-02T09:09:00+05:30').getTime();
const FEATURE_COUNT = LAUNCH_FEATURES.length;
/** Music never climbs past this level during the show, so dialogue and the video stay audible. */
const MUSIC_CEILING = 0.58;
/** How long the final logo frame is held before the sign-off card takes over. */
const BRAND_HOLD_MS = 5000;
/** Safety net in case the reveal never reports `ended` (blocked autoplay, decode failure). */
const VIDEO_CEILING_MS = 20_000;

function getCountdown(milliseconds: number): Countdown {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    return {
        days: Math.floor(total / 86400),
        hours: Math.floor((total % 86400) / 3600),
        minutes: Math.floor((total % 3600) / 60),
        seconds: total % 60,
    };
}

function Fireworks({ mode, soundRef }: { mode: FireworksMode; soundRef: RefObject<LaunchSound | null> }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<FireworksEngine | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const engine = new FireworksEngine(canvas);
        engine.onBurst = (pan, big) => soundRef.current?.boom(pan, big);
        engineRef.current = engine;
        return () => {
            engine.destroy();
            engineRef.current = null;
        };
    }, [soundRef]);

    useEffect(() => engineRef.current?.setMode(mode), [mode]);

    return <canvas ref={canvasRef} className={`launch-fireworks${mode !== 'off' ? ' is-active' : ''}`} aria-hidden="true" />;
}

/** Sweeping playhead across the whole feature reel so viewers can see the show is moving. */
function ReelRail({ index, count }: { index: number; count: number }) {
    const progress = useTimeline(FEATURE_HOLD_MS * count, 0, true);
    return (
        <div className="launch-feature-progress" aria-hidden="true">
            <div className="launch-feature-rail">
                <i className="launch-feature-rail-fill" style={{ transform: `scaleX(${progress})` }} />
                {Array.from({ length: count }, (_, tick) => (
                    <b
                        key={tick}
                        className={`launch-feature-tick${tick <= index ? ' is-on' : ''}`}
                        style={{ left: `${((tick + 1) / count) * 100}%` }}
                    />
                ))}
                <span className="launch-feature-head" style={{ left: `${progress * 100}%` }} />
            </div>
            <div className="launch-feature-meta">
                <span>0{index + 1} / 0{count}</span>
                <span>{count} SCREENS · FREE FOR EVERY MEMBER</span>
            </div>
        </div>
    );
}

export default function LaunchEvent() {
    const [phase, setPhase] = useState<Phase>(() => (Date.now() >= LAUNCH_AT ? 'count-in' : 'waiting'));
    const [countIn, setCountIn] = useState(10);
    const [featureIndex, setFeatureIndex] = useState(0);
    const [countdown, setCountdown] = useState(() => getCountdown(LAUNCH_AT - Date.now()));
    const [soundOn, setSoundOn] = useState(true);
    const [brandHold, setBrandHold] = useState(false);
    const [burst, setBurst] = useState<FireworksMode>('off');
    const soundRef = useRef<LaunchSound | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const holdTimerRef = useRef<number | undefined>(undefined);
    const memberAppUrl = window.location.hostname === 'launch.challengegym.in' ? 'https://challengegym.in/' : '/';
    const feature = LAUNCH_FEATURES[featureIndex];

    const stopBurst = useCallback(() => {
        setBurst('off');
    }, []);

    useEffect(() => stopBurst, [stopBurst]);

    useEffect(() => {
        if (phase !== 'waiting') return;
        const update = () => {
            const next = LAUNCH_AT - Date.now();
            setCountdown(getCountdown(next));
            if (next <= 10_000) {
                setCountIn(10);
                setPhase('count-in');
            }
        };
        update();
        const interval = window.setInterval(update, 1000);
        return () => window.clearInterval(interval);
    }, [phase]);

    useEffect(() => {
        if (phase !== 'count-in') return;
        const timeout = window.setTimeout(() => {
            if (countIn <= 1) {
                stopBurst();
                soundRef.current?.stopCrackle(1.5);
                setFeatureIndex(0);
                setPhase('features');
            } else {
                setCountIn((value) => value - 1);
            }
        }, 1000);
        return () => window.clearTimeout(timeout);
    }, [phase, countIn, stopBurst]);

    useEffect(() => {
        if (phase !== 'count-in') return;
        if (countIn > 9) {
            stopBurst();
        } else if (countIn <= 5) {
            setBurst('finale');
        } else {
            setBurst('show');
        }
    }, [phase, countIn, stopBurst]);

    useEffect(() => {
        if (phase !== 'count-in' || !soundOn) return;
        const sound = soundRef.current;
        if (!sound) return;
        if (countIn === 9) {
            sound.startCrackle();
        }
    }, [phase, countIn, soundOn]);

    useEffect(() => {
        if (phase !== 'features' && phase !== 'board') return;
        const sound = soundRef.current;
        if (!sound || !soundOn) return;
        let cancelled = false;
        let ramp: number | undefined;
        void sound.ready.then(() => {
            if (cancelled) return;
            sound.startMusic();
            ramp = window.setInterval(() => {
                if (sound.level < MUSIC_CEILING) sound.raiseMusic();
            }, 1000);
        }).catch(() => undefined);
        return () => {
            cancelled = true;
            if (ramp !== undefined) window.clearInterval(ramp);
        };
    }, [phase, soundOn]);

    useEffect(() => {
        if (phase !== 'features') return;
        const timeout = window.setTimeout(() => {
            if (featureIndex >= FEATURE_COUNT - 1) {
                setPhase('board');
            } else {
                setFeatureIndex((value) => value + 1);
            }
        }, FEATURE_HOLD_MS);
        return () => window.clearTimeout(timeout);
    }, [phase, featureIndex]);

    useEffect(() => {
        if (phase !== 'board') return;
        const timeout = window.setTimeout(() => setPhase('video'), SHOWCASE_HOLD_MS);
        return () => window.clearTimeout(timeout);
    }, [phase]);

    /**
     * The reveal has finished (or bailed out). Pin the very last frame and hold it, so the
     * logo keeps brand presence for a beat instead of snapping straight to the sign-off card.
     */
    const settleVideo = useCallback(() => {
        const video = videoRef.current;
        if (video) {
            video.pause();
            if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
        }
        setBrandHold(true);
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = window.setTimeout(() => setPhase('complete'), BRAND_HOLD_MS);
    }, []);

    useEffect(() => () => window.clearTimeout(holdTimerRef.current), []);

    useEffect(() => {
        if (phase !== 'video') {
            setBrandHold(false);
            return;
        }
        const sound = soundRef.current;
        sound?.stopCrackle(0.5);
        // Duck the show track so the logo reveal plays with its own soundtrack.
        sound?.musicTo(0.1, 1.2);
        void videoRef.current?.play().catch(() => undefined);
        const ceiling = window.setTimeout(settleVideo, VIDEO_CEILING_MS);
        return () => window.clearTimeout(ceiling);
    }, [phase, settleVideo]);

    const replayLaunch = () => {
        window.clearTimeout(holdTimerRef.current);
        stopBurst();
        setBrandHold(false);
        setFeatureIndex(0);
        setCountIn(10);
        setPhase('count-in');
    };

    useEffect(() => {
        const sound = new LaunchSound();
        soundRef.current = sound;
        void sound.ready.catch(() => undefined);

        const unlockSound = () => {
            void sound.resume().then(() => setSoundOn(true)).catch(() => undefined);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'KeyR') {
                event.preventDefault();
                replayLaunch();
            }
            unlockSound();
        };
        void sound.resume().catch(() => undefined);
        window.addEventListener('pointerdown', unlockSound, { once: true });
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('pointerdown', unlockSound);
            window.removeEventListener('keydown', onKeyDown);
            sound.close();
            if (soundRef.current === sound) soundRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (phase !== 'waiting') return;
        const sound = soundRef.current;
        if (!sound) return;
        let cancelled = false;
        void sound.ready.then(() => {
            if (!cancelled) sound.startClock();
        }).catch(() => undefined);
        return () => {
            cancelled = true;
            sound.stopClock(0.5);
        };
    }, [phase]);

    const status = phase === 'waiting'
        ? 'COUNTING DOWN TO THE BIG MOMENT'
        : phase === 'count-in'
            ? 'TAKE YOUR PLACE'
            : phase === 'features'
                ? 'INTRODUCING THE CHALLENGE GYM APP'
                : phase === 'board'
                    ? 'ONE APP. YOUR WHOLE GYM LIFE.'
                    : 'THE GYM IS OPEN';
    const isShowing = phase === 'count-in' || phase === 'features' || phase === 'board' || phase === 'video' || phase === 'complete';
    const isFinale = burst === 'finale';

    return (
        <main className={`launch-page${isShowing ? ' is-showing' : ''}${phase === 'count-in' ? ' is-counting' : ''}${isFinale ? ' launch-page-finale' : ''}`}>
            <Fireworks mode={burst} soundRef={soundRef} />
            <div className="launch-grain" aria-hidden="true" />
            <header className="launch-header">
                <Link to={memberAppUrl} className="launch-brand" aria-label="Challenge Gym home">
                    <img src="/logo-transparent.png" alt="" />
                    <span>CHALLENGE <b>GYM</b></span>
                </Link>
                <div className="launch-header-right">
                    <span className="launch-live-dot" />
                    <span>THE NEXT CHAPTER</span>
                    <Link to={memberAppUrl} className="launch-sign-in">Member sign in <ArrowUpRight size={15} /></Link>
                </div>
            </header>

            <section className="launch-hero">
                <div className="launch-copy">
                    <p className="launch-eyebrow"><span /> A STRONGER ERA STARTS HERE</p>
                    <h1>Built for your<br /><em>next</em> level.</h1>
                    <p className="launch-description">A new home for every goal, every rep, every version of you. The next chapter of Challenge Gym begins together.</p>
                    <div className="launch-date"><span className="launch-date-rule" /> FRIDAY <b>02</b> OCTOBER 2026 <span className="launch-date-time">09:09 AM IST</span></div>
                </div>

                <div className="launch-clock" aria-live="polite" aria-atomic="true">
                    <div className="launch-clock-top"><span className="launch-status"><span />{status}</span><span className="launch-timezone">IST · UTC+5:30</span></div>
                    <div className="launch-countdown">
                        {([['days', countdown.days], ['hours', countdown.hours], ['minutes', countdown.minutes], ['seconds', countdown.seconds]] as const).map(([label, value]) => (
                            <div className="launch-time-unit" key={label}>
                                <span className="launch-time-number">{String(value).padStart(2, '0')}</span>
                                <span className="launch-time-label">{label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="launch-clock-footer"><span>ONE GYM. EVERY POSSIBILITY.</span><span>CG / 2026</span></div>
                </div>

            </section>

            {phase === 'count-in' && (
                <div className="launch-count-stage" aria-live="assertive" aria-atomic="true">
                    <span key={countIn} className="launch-count-number">{countIn}</span>
                </div>
            )}

            {phase === 'features' && (
                <section className="launch-feature-reel" aria-live="polite" aria-atomic="true">
                    <span key={feature.key} className="launch-reel-wash" style={{ background: `radial-gradient(ellipse at 74% 48%, ${feature.glow}, transparent 58%)` }} aria-hidden="true" />
                    <span className="launch-reel-grid" aria-hidden="true" />
                    <div className="launch-reel">
                        <div className="launch-reel-head">
                            <p className="launch-feature-kicker">FREE FOR EVERY MEMBER</p>
                            <h1>Challenge Gym<br /><em>in your hands.</em></h1>
                            <p className="launch-feature-intro">Your training life, together in one free app.</p>
                        </div>

                        <div className="launch-reel-copy" key={featureIndex}>
                            <span className="launch-feature-index">0{featureIndex + 1} / 0{FEATURE_COUNT}</span>
                            <h2>{feature.title}</h2>
                            <p>{feature.detail}</p>
                            <ul className="launch-feature-points">
                                {feature.points.map((point, index) => (
                                    <li key={point} style={{ '--i': index } as CSSProperties}><span />{point}</li>
                                ))}
                            </ul>
                        </div>

                        <ReelRail index={featureIndex} count={FEATURE_COUNT} />

                        <div className="launch-reel-stage">
                            <AppInfographic feature={feature} />
                        </div>
                    </div>
                </section>
            )}

            {phase === 'board' && <AppBoard />}

            {phase === 'video' && (
                <section className={`launch-video-stage${brandHold ? ' is-holding' : ''}`} aria-label="Challenge Gym logo reveal">
                    <video
                        ref={videoRef}
                        src="/launch-media/logo-reveal.mp4"
                        poster="/launch-media/logo-reveal-poster.jpg"
                        playsInline
                        preload="auto"
                        muted
                        onEnded={settleVideo}
                        onError={settleVideo}
                    />
                    {brandHold && (
                        <div className="launch-brand-hold" aria-hidden="true">
                            <span className="launch-brand-hold-tag">
                                <img src="/logo-transparent.png" alt="" />
                                <b>CHALLENGE <i>GYM</i></b>
                            </span>
                            <span className="launch-brand-hold-rail"><i /></span>
                        </div>
                    )}
                </section>
            )}

            {phase === 'complete' && (
                <section className="launch-afterglow">
                    <img src="/launch-media/logo-reveal-end.jpg" alt="Challenge Gym" />
                    <div className="launch-afterglow-copy">
                        <p className="launch-feature-kicker">YOUR NEXT CHAPTER STARTS NOW</p>
                        <h1>Show up.<br /><em>Level up.</em></h1>
                        <p>The Challenge Gym app is free for every member.</p>
                        <Link to={memberAppUrl} className="launch-join-link">Open the member app <ArrowUpRight size={16} /></Link>
                    </div>
                </section>
            )}

            {!isShowing && (
                <>
                    <div className="launch-marquee" aria-label="Stronger starts together">
                        <div className="launch-marquee-track">
                            {Array.from({ length: 4 }, (_, index) => <span key={index}>STRONGER STARTS TOGETHER <i>✳</i> YOUR NEXT CHAPTER <i>✳</i> CHALLENGE ACCEPTED <i>✳</i></span>)}
                        </div>
                    </div>
                    <footer className="launch-footer">
                        <span>SHOW UP. LEVEL UP. REPEAT.</span>
                        <span>CLOCK + FIREWORK EFFECTS · PUBLIC DOMAIN</span>
                    </footer>
                </>
            )}
        </main>
    );
}
