// Launch-show audio. Everything runs through Web Audio (decoded buffers + gain automation) so fades
// work on iOS too, where HTMLAudioElement.volume is read-only.
// The launch soundtrack is supplied by the gym; the clock and fireworks recordings are public domain.
const MEDIA = '/launch-media/';
const SAMPLES = ['clock', 'boom1', 'boom2', 'boom3', 'boom4', 'boom5', 'crackle', 'music'] as const;
type Sample = (typeof SAMPLES)[number];

export class LaunchSound {
    private ctx: AudioContext;
    private master: GainNode;
    private echo: GainNode;
    private buffers: Partial<Record<Sample, AudioBuffer>> = {};
    private clock?: { source: AudioBufferSourceNode; gain: GainNode };
    private crackle?: { source: AudioBufferSourceNode; gain: GainNode };
    private music?: { source: AudioBufferSourceNode; gain: GainNode };
    private musicVolume = 0.3;
    readonly ready: Promise<void>;

    constructor() {
        const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        // iOS 17+: play through the silent switch like a video would.
        const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (session) session.type = 'playback';
        this.ctx = new Context();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);

        // Short dark hall echo: gives the clock its heavy "doomsday" tail.
        const delay = this.ctx.createDelay(1);
        delay.delayTime.value = 0.24;
        const feedback = this.ctx.createGain();
        feedback.gain.value = 0.32;
        const tone = this.ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 1600;
        this.echo = this.ctx.createGain();
        this.echo.gain.value = 0.55;
        this.echo.connect(delay);
        delay.connect(tone);
        tone.connect(feedback);
        feedback.connect(delay);
        tone.connect(this.master);

        this.ready = Promise.all(SAMPLES.map(async (name) => {
            const file = name === 'music' ? 'launch-theme.mp3' : name === 'clock' ? 'doomsday-clock.mp3?v=2' : `${name}.mp3`;
            const response = await fetch(`${MEDIA}${file}`);
            if (!response.ok) throw new Error(`Unable to load launch audio: ${file}`);
            const data = await response.arrayBuffer();
            this.buffers[name] = await this.ctx.decodeAudioData(data);
        })).then(() => undefined);
    }

    /** Must be called from a user gesture (tap/click) the first time. */
    resume() { return this.ctx.resume(); }

    /** Current music level, so callers can stop ramping once the show bed is loud enough. */
    get level() { return this.musicVolume; }

    setMuted(muted: boolean) {
        this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }

    private play(name: Sample, { rate = 1, volume = 1, pan = 0, echo = false } = {}) {
        const buffer = this.buffers[name];
        if (!buffer) return;
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        const gain = this.ctx.createGain();
        gain.gain.value = volume;
        source.connect(gain);
        let out: AudioNode = gain;
        if (pan && this.ctx.createStereoPanner) {
            const panner = this.ctx.createStereoPanner();
            panner.pan.value = Math.max(-1, Math.min(1, pan));
            gain.connect(panner);
            out = panner;
        }
        out.connect(this.master);
        if (echo) out.connect(this.echo);
        source.start();
    }

    private thump(from: number, volume: number, length: number) {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.frequency.setValueAtTime(from, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + length);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(now);
        osc.stop(now + length + 0.05);
    }

    startClock() {
        this.stopClock(0.1);
        this.clock = this.loopSource('clock', 0.72, 0.35);
        if (this.clock) this.clock.source.loop = true;
    }

    stopClock(seconds = 0.5) {
        this.fadeOut(this.clock, seconds);
        this.clock = undefined;
    }

    boom(pan: number, big: boolean) {
        const name = (['boom1', 'boom2', 'boom3', 'boom4', 'boom5'] as const)[Math.floor(Math.random() * 5)];
        this.play(name, { rate: 0.8 + Math.random() * 0.35, volume: (big ? 1 : 0.75) * (0.8 + Math.random() * 0.2), pan: pan * 0.8 });
        if (big) this.thump(90, 0.4, 0.45);
    }

    private loopSource(name: Sample, volume: number, fadeIn: number, offset = 0) {
        const buffer = this.buffers[name];
        if (!buffer) return undefined;
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        const gain = this.ctx.createGain();
        const now = this.ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume, now + fadeIn);
        source.connect(gain);
        gain.connect(this.master);
        source.start(now, offset);
        return { source, gain };
    }

    private fadeOut(node: { source: AudioBufferSourceNode; gain: GainNode } | undefined, seconds: number) {
        if (!node) return;
        const now = this.ctx.currentTime;
        node.gain.gain.cancelScheduledValues(now);
        node.gain.gain.setValueAtTime(Math.max(0.0001, node.gain.gain.value), now);
        node.gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
        node.source.stop(now + seconds + 0.05);
    }

    startCrackle() {
        this.fadeOut(this.crackle, 0.2);
        this.crackle = this.loopSource('crackle', 0.52, 1);
    }

    stopCrackle(seconds = 2) {
        this.fadeOut(this.crackle, seconds);
        this.crackle = undefined;
    }

    startMusic(offset = 0) {
        this.fadeOut(this.music, 0.3);
        this.musicVolume = 0.3;
        this.music = this.loopSource('music', this.musicVolume, offset ? 1.2 : 0.4, offset);
    }

    raiseMusic() {
        this.musicTo(Math.min(1, this.musicVolume + 0.1), 0.8);
    }

    /** Lower (duck) the music, e.g. while the logo video plays its own soundtrack. */
    musicTo(volume: number, seconds: number) {
        if (!this.music) return;
        this.musicVolume = Math.max(0.01, Math.min(1, volume));
        const now = this.ctx.currentTime;
        this.music.gain.gain.cancelScheduledValues(now);
        this.music.gain.gain.setValueAtTime(Math.max(0.0001, this.music.gain.gain.value), now);
        this.music.gain.gain.exponentialRampToValueAtTime(this.musicVolume, now + seconds);
    }

    stopMusic(seconds = 3) {
        this.fadeOut(this.music, seconds);
        this.music = undefined;
    }

    close() {
        void this.ctx.close();
    }
}
