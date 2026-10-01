// Canvas fireworks for the launch page: rockets rise, burst into coloured shells and leave fading trails.
export type FireworksMode = 'off' | 'ambient' | 'show' | 'finale' | 'celebrate';

const PALETTE = ['#ff3b5c', '#ff8a00', '#ffd60a', '#3cf07b', '#22d3ee', '#4d7cff', '#b86bff', '#ff5ec4', '#c8f135'];
const GOLD = ['#ffd27a', '#ffb347', '#fff1c1'];
const GRAVITY = 0.06;
const MAX_SPARKS = 3200;

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; drag: number; gravity: number; flicker: boolean };
type Rocket = { x: number; y: number; vx: number; vy: number; color: string };
type Flash = { x: number; y: number; life: number; color: string };
type Shell = 'peony' | 'ring' | 'willow' | 'multi' | 'double' | 'glitter';

// gap = ms between launches, salvo = rockets per launch, scale = shell size.
const SETTINGS: Record<Exclude<FireworksMode, 'off'>, { gap: [number, number]; salvo: [number, number]; scale: number }> = {
    ambient: { gap: [1800, 3400], salvo: [1, 1], scale: 0.65 },
    show: { gap: [480, 850], salvo: [1, 2], scale: 1 },
    finale: { gap: [110, 230], salvo: [1, 3], scale: 1.15 },
    celebrate: { gap: [650, 1150], salvo: [1, 2], scale: 0.95 },
};

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
const between = ([min, max]: [number, number]) => min + Math.random() * (max - min);

export class FireworksEngine {
    private ctx: CanvasRenderingContext2D;
    private width = 0;
    private height = 0;
    private density = 1;
    private sparks: Spark[] = [];
    private rockets: Rocket[] = [];
    private flashes: Flash[] = [];
    private mode: FireworksMode = 'off';
    private nextLaunch = 0;
    private last = 0;
    private frame = 0;
    /** Called on every shell burst with the stereo position (-1 left … 1 right). */
    onBurst?: (pan: number, big: boolean) => void;

    constructor(private canvas: HTMLCanvasElement) {
        this.ctx = canvas.getContext('2d')!;
        this.resize();
        window.addEventListener('resize', this.resize);
        this.frame = requestAnimationFrame(this.loop);
    }

    destroy() {
        cancelAnimationFrame(this.frame);
        window.removeEventListener('resize', this.resize);
    }

    setMode(mode: FireworksMode) {
        if (mode === this.mode) return;
        this.mode = mode;
        this.nextLaunch = 0;
    }

    private resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width * ratio;
        this.canvas.height = this.height * ratio;
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.density = this.width < 700 ? 0.6 : 1;
    };

    private launch() {
        const burstY = this.height * (0.1 + Math.random() * 0.36);
        this.rockets.push({
            x: this.width * (0.1 + Math.random() * 0.8),
            y: this.height + 8,
            vx: (Math.random() - 0.5) * 1.1,
            vy: -Math.sqrt(2 * GRAVITY * (this.height - burstY)), // apex lands at burstY
            color: pick(PALETTE),
        });
    }

    private explode(rocket: Rocket) {
        if (this.mode === 'off') return;
        const { scale } = SETTINGS[this.mode];
        const shell: Shell = pick(['peony', 'peony', 'ring', 'willow', 'multi', 'double', 'glitter'] as const);
        const big = this.mode === 'finale' || Math.random() < 0.3;
        const count = Math.round((big ? 130 : 90) * scale * this.density);
        const speed = (big ? 5.2 : 4.2) * scale * (0.9 + Math.random() * 0.3) * (this.width < 700 ? 0.8 : 1);
        const second = pick(PALETTE);
        for (let index = 0; index < count && this.sparks.length < MAX_SPARKS; index += 1) {
            const angle = (Math.PI * 2 * index) / count + Math.random() * 0.05;
            let velocity = speed * (0.4 + Math.random() * 0.6);
            let color = rocket.color;
            let life = 55 + Math.random() * 30;
            let drag = 0.975;
            let gravity = 0.045;
            let size = 1.3 + Math.random() * 1.1;
            let flicker = false;
            if (shell === 'ring') velocity = speed * (0.92 + Math.random() * 0.08);
            if (shell === 'multi') color = pick(PALETTE);
            if (shell === 'double' && index % 2) { velocity *= 0.5; color = second; }
            if (shell === 'willow') { color = pick(GOLD); life = 95 + Math.random() * 40; drag = 0.986; gravity = 0.03; size = 1.2; }
            if (shell === 'glitter') { color = Math.random() < 0.5 ? '#ffffff' : pick(GOLD); flicker = true; }
            this.sparks.push({ x: rocket.x, y: rocket.y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life, max: life, color, size, drag, gravity, flicker });
        }
        this.flashes.push({ x: rocket.x, y: rocket.y, life: 1, color: rocket.color });
        this.onBurst?.((rocket.x / this.width) * 2 - 1, big);
    }

    private loop = (time: number) => {
        const dt = Math.min(3, this.last ? (time - this.last) / 16.67 : 1);
        this.last = time;
        const { ctx } = this;

        // Fade what is already drawn instead of clearing, which leaves trails but keeps the canvas transparent.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0,0,0,${Math.min(1, 0.2 * dt)})`;
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.globalCompositeOperation = 'lighter';

        if (this.mode !== 'off' && time >= this.nextLaunch) {
            const settings = SETTINGS[this.mode];
            const salvo = Math.round(between(settings.salvo));
            for (let index = 0; index < salvo; index += 1) this.launch();
            this.nextLaunch = time + between(settings.gap);
        }

        this.rockets = this.rockets.filter((rocket) => {
            rocket.x += rocket.vx * dt;
            rocket.y += rocket.vy * dt;
            rocket.vy += GRAVITY * dt;
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#fff6d8';
            ctx.beginPath();
            ctx.arc(rocket.x, rocket.y, 1.8, 0, Math.PI * 2);
            ctx.fill();
            if (this.sparks.length < MAX_SPARKS && Math.random() < 0.7) {
                this.sparks.push({ x: rocket.x, y: rocket.y, vx: (Math.random() - 0.5) * 0.6, vy: Math.random() * 0.8, life: 18, max: 18, color: '#ffc46b', size: 1, drag: 0.95, gravity: 0.02, flicker: true });
            }
            if (rocket.vy >= -0.4) { this.explode(rocket); return false; }
            return true;
        });

        this.flashes = this.flashes.filter((flash) => {
            const radius = 90 * (1.2 - flash.life);
            const glow = ctx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, radius);
            glow.addColorStop(0, flash.color);
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = flash.life * 0.55;
            ctx.fillStyle = glow;
            ctx.fillRect(flash.x - radius, flash.y - radius, radius * 2, radius * 2);
            flash.life -= 0.12 * dt;
            return flash.life > 0;
        });

        this.sparks = this.sparks.filter((spark) => {
            spark.vx *= spark.drag;
            spark.vy = spark.vy * spark.drag + spark.gravity * dt;
            spark.x += spark.vx * dt;
            spark.y += spark.vy * dt;
            spark.life -= dt;
            if (spark.life <= 0) return false;
            if (spark.flicker && Math.random() < 0.4) return true;
            const left = spark.life / spark.max;
            ctx.globalAlpha = Math.min(1, left * 2.2);
            ctx.fillStyle = spark.color;
            ctx.beginPath();
            ctx.arc(spark.x, spark.y, spark.size * (0.55 + 0.45 * left), 0, Math.PI * 2);
            ctx.fill();
            return true;
        });

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        this.frame = requestAnimationFrame(this.loop);
    };
}
