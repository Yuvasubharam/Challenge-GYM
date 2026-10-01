import type { CSSProperties, ReactNode } from 'react';
import {
    Award,
    CalendarCheck,
    ChevronRight,
    Dumbbell,
    Flame,
    House,
    LineChart,
    Play,
    QrCode,
    Sparkles,
    User,
    Utensils,
} from 'lucide-react';
import type { LaunchFeature } from './features';
import { useCountUp, qrMatrix, usePrefersReducedMotion } from './motion';

const css = (vars: Record<string, string | number>) => vars as CSSProperties;

const NAV_ITEMS = [
    { label: 'Home', icon: House },
    { label: 'Diet', icon: Utensils },
    { label: 'Train', icon: Dumbbell },
    { label: 'Progress', icon: LineChart },
    { label: 'Me', icon: User },
];

/* ------------------------------------------------------------------ parts */

function Ring({ value, size = 92, stroke = 9, tone = 'lime', delay = 0, children }: {
    value: number;
    size?: number;
    stroke?: number;
    tone?: 'lime' | 'info' | 'warn' | 'bad';
    delay?: number;
    children?: ReactNode;
}) {
    const shown = useCountUp(value, 1250, delay);
    const filled = Math.max(0, Math.min(100, shown)) / 100;
    return (
        <div className={`launch-ring is-${tone}`} style={{ width: size, height: size }}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
                <circle className="launch-ring-track" cx="50" cy="50" r="44" pathLength={100} strokeWidth={stroke} />
                <circle
                    className="launch-ring-value"
                    cx="50"
                    cy="50"
                    r="44"
                    pathLength={100}
                    strokeWidth={stroke}
                    strokeDasharray={100}
                    strokeDashoffset={100 * (1 - filled)}
                />
            </svg>
            <div className="launch-ring-core">{children}</div>
        </div>
    );
}

function Bar({ value, tone = 'lime', delay = 0, height = 5 }: { value: number; tone?: string; delay?: number; height?: number }) {
    const shown = useCountUp(value, 1000, delay);
    return (
        <span className="launch-bar" style={{ height }}>
            <i
                className={`launch-bar-fill is-${tone}`}
                style={{ transform: `scaleX(${Math.max(0, Math.min(1, shown / 100))})` }}
            />
        </span>
    );
}

function Stat({ label, value, unit, tone = 'lime', delay = 0, decimals = 0, sign = '' }: {
    label: string;
    value: number;
    unit?: string;
    tone?: string;
    delay?: number;
    decimals?: number;
    sign?: string;
}) {
    const shown = useCountUp(value, 1150, delay);
    return (
        <span className={`launch-stat is-${tone}`}>
            <span className="launch-stat-value">
                {sign}{shown.toFixed(decimals)}<em>{unit}</em>
            </span>
            <span className="launch-stat-label">{label}</span>
        </span>
    );
}

function Head({ kicker, aside }: { kicker: string; aside?: ReactNode }) {
    return (
        <div className="launch-app-head-row">
            <span className="launch-app-kicker">{kicker}</span>
            {aside}
        </div>
    );
}

function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
    return <section className={`launch-app-card ${className}`} style={style}>{children}</section>;
}

function Barbell() {
    return (
        <svg viewBox="0 0 120 80" className="launch-barbell" aria-hidden="true">
            <rect x="30" y="30" width="7" height="32" rx="2" />
            <rect x="83" y="30" width="7" height="32" rx="2" />
            <rect x="37" y="43" width="46" height="6" rx="3" />
            <rect x="6" y="36" width="24" height="20" rx="3" />
            <rect x="90" y="36" width="24" height="20" rx="3" />
        </svg>
    );
}

/* ----------------------------------------------------------------- screens */

function GoalsScreen() {
    return (
        <>
            <Card className="is-goal">
                <Head kicker="TODAY'S TARGETS" aside={<span className="launch-app-pill is-lime">ON TRACK</span>} />
                <div className="launch-goal-row">
                    <Ring value={69} size={92}>
                        <b><Count value={1280} duration={1250} delay={120} /></b>
                        <span>kcal eaten</span>
                    </Ring>
                    <ul className="launch-mini-rows">
                        <li><span>Goal</span><b><Count value={1850} /></b></li>
                        <li><span>Left</span><b className="is-lime"><Count value={570} /></b></li>
                        <li><span>Burned</span><b className="is-warn"><Count value={312} /></b></li>
                    </ul>
                </div>
            </Card>

            <Card>
                <Head kicker="MACROS" />
                <MacroRow label="Protein" now={62} goal={110} unit="g" tone="lime" delay={200} />
                <MacroRow label="Carbs" now={148} goal={240} unit="g" tone="info" delay={320} />
                <MacroRow label="Fat" now={38} goal={65} unit="g" tone="warn" delay={440} />
            </Card>

            <Card className="is-split">
                <div className="launch-water">
                    <Head kicker="WATER" aside={<span className="launch-app-pill"><Count value={1250} /> / 2500 ml</span>} />
                    <div className="launch-glasses">
                        {Array.from({ length: 8 }, (_, index) => (
                            <span key={index} className={`launch-glass${index < 5 ? ' is-full' : ''}`} style={{ '--i': index } as CSSProperties} />
                        ))}
                    </div>
                </div>
                <div className="launch-streak">
                    <span className="launch-streak-pulse" />
                    <Flame className="launch-streak-icon" size={16} />
                    <b><Count value={12} /></b>
                    <span>DAY STREAK</span>
                </div>
            </Card>

            <QuickActions />
        </>
    );
}

function MacroRow({ label, now, goal, unit, tone, delay }: { label: string; now: number; goal: number; unit: string; tone: string; delay: number }) {
    return (
        <div className="launch-macro">
            <div className="launch-macro-head">
                <span>{label}</span>
                <b><Count value={now} delay={delay} /> / {goal}{unit}</b>
            </div>
            <Bar value={(now / goal) * 100} tone={tone} delay={delay} />
        </div>
    );
}

function Count({ value, duration = 1100, delay = 0, decimals = 0 }: { value: number; duration?: number; delay?: number; decimals?: number }) {
    const shown = useCountUp(value, duration, delay);
    return <>{Math.round(shown * 10 ** decimals).toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}</>;
}

const QUICK = [
    { label: 'Food', icon: Utensils },
    { label: 'Workout', icon: Dumbbell },
    { label: 'Water', icon: Sparkles },
    { label: 'BMI', icon: LineChart },
];

function QuickActions() {
    return (
        <div className="launch-quick">
            {QUICK.map((item, index) => (
                <span key={item.label} className="launch-quick-tile" style={{ '--i': index } as CSSProperties}>
                    <i className="launch-quick-shine" />
                    <item.icon size={14} />
                    <em>{item.label}</em>
                </span>
            ))}
        </div>
    );
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function WeekStrip({ active = 4 }: { active?: number }) {
    return (
        <div className="launch-week">
            {DAYS.map((day, index) => (
                <span key={index} className={`launch-day${index === active ? ' is-active' : ''}${index < active ? ' is-done' : ''}`} style={{ '--i': index } as CSSProperties}>
                    <em>{day}</em>
                    <b>{28 + index}</b>
                </span>
            ))}
        </div>
    );
}

const BREAKFAST = [
    { name: 'Paneer paratha', grams: '2 × 120 g', kcal: 540, p: 24 },
    { name: 'Milk', grams: '250 ml', kcal: 150, p: 8 },
];

const LUNCH = [
    { name: 'Dal, rice & salad', grams: '1 plate', kcal: 620, p: 28 },
    { name: 'Curd', grams: '150 g', kcal: 90, p: 5 },
];

function FoodScreen() {
    return (
        <>
            <WeekStrip />

            <Card className="is-goal">
                <Head kicker="CALORIES" aside={<span className="launch-app-pill is-lime">TODAY</span>} />
                <div className="launch-goal-row">
                    <Ring value={67} size={86} tone="warn">
                        <b><Count value={1240} /></b>
                        <span>of 1850</span>
                    </Ring>
                    <ul className="launch-mini-rows">
                        <li><span>Goal</span><b>1850</b></li>
                        <li><span>Food</span><b className="is-warn">1240</b></li>
                        <li><span>Exercise</span><b className="is-lime">+312</b></li>
                        <li><span>Left</span><b className="is-info">610</b></li>
                    </ul>
                </div>
                <div className="launch-macro-inline">
                    <MacroRow label="Protein" now={62} goal={110} unit="g" tone="lime" delay={180} />
                    <MacroRow label="Carbs" now={148} goal={240} unit="g" tone="info" delay={280} />
                    <MacroRow label="Fat" now={38} goal={65} unit="g" tone="warn" delay={380} />
                </div>
            </Card>

            <Meal title="BREAKFAST · 690 kcal" rows={BREAKFAST} tone="warn" />
            <Meal title="LUNCH · 710 kcal" rows={LUNCH} tone="info" repeat />
            <Card className="is-peek">
                <Head kicker="DINNER" aside={<span className="launch-app-add">+ ADD</span>} />
                <span className="launch-peek-line" />
            </Card>
        </>
    );
}

function Meal({ title, rows, tone, repeat }: { title: string; rows: Array<{ name: string; grams: string; kcal: number; p: number }>; tone: string; repeat?: boolean }) {
    return (
        <Card>
            <Head kicker={title} aside={repeat ? <span className="launch-app-pill is-ghost">SAME AS YESTERDAY</span> : undefined} />
            <ul className="launch-food-rows">
                {rows.map((row, index) => (
                    <li key={row.name} style={{ '--i': index } as CSSProperties}>
                        <span className={`launch-food-dot is-${tone}`} />
                        <span className="launch-food-name">{row.name}<em>{row.grams} · {row.p}g protein</em></span>
                        <b><Count value={row.kcal} /></b>
                    </li>
                ))}
            </ul>
        </Card>
    );
}

const SETS = [
    { reps: 12, load: '20 kg' },
    { reps: 10, load: '20 kg' },
    { reps: 8, load: '22.5 kg' },
];

function TrainScreen() {
    return (
        <>
            <div className="launch-seg">
                <span className="is-on">LOG</span>
                <span>EXERCISES</span>
                <i />
            </div>

            <div className="launch-train-stats">
                <Stat label="KCAL BURNED" value={312} tone="lime" />
                <Stat label="MINUTES" value={42} tone="info" />
                <Stat label="DAYS 3/4" value={3} tone="warn" />
            </div>

            <Card className="is-exercise">
                <div className="launch-media">
                    <span className="launch-media-frame launch-media-a"><Barbell /></span>
                    <span className="launch-media-frame launch-media-b"><Barbell /></span>
                    <span className="launch-media-label">START / END</span>
                    <span className="launch-media-play"><Play size={11} /></span>
                </div>
                <div className="launch-exercise-head">
                    <h4>Barbell Bench Press</h4>
                    <span className="launch-app-pill is-lime">LOGGED</span>
                </div>
                <div className="launch-chips">
                    <span>CHEST</span><span>BARBELL</span><span>INTERMEDIATE</span>
                </div>
                <ul className="launch-set-rows">
                    {SETS.map((set, index) => (
                        <li key={index} style={{ '--i': index } as CSSProperties}>
                            <em>{index + 1}</em>
                            <span>{set.reps} reps</span>
                            <b>{set.load}</b>
                        </li>
                    ))}
                </ul>
                <div className="launch-1rm">
                    <span>EST. 1RM</span>
                    <b><Count value={68} /> kg</b>
                    <Bar value={68} tone="lime" delay={700} height={4} />
                </div>
            </Card>

            <Card className="is-howto">
                <Head kicker="HOW TO DO IT" aside={<span className="launch-lang"><b className="is-on">EN</b><b>हिंदी</b></span>} />
                <ol className="launch-steps">
                    <li style={{ '--i': 0 } as CSSProperties}><em>1</em>Lie flat, feet planted, eyes under the bar.</li>
                    <li style={{ '--i': 1 } as CSSProperties}><em>2</em>Lower to the chest, then press back up.</li>
                </ol>
            </Card>
        </>
    );
}

const WEIGHT_PATH = 'M8,72 L42,66 L76,58 L110,52 L144,44 L178,38 L212,28 L248,22';
const EATEN = [58, 72, 64, 81, 69, 76, 88, 70, 84, 66, 78, 92];
const BURNED = [38, 52, 44, 61, 48, 55, 66, 50, 58, 63, 47, 57];
const VISITS = [1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0];

function ProgressScreen() {
    return (
        <>
            <Card className="is-weight">
                <Head kicker="WEIGHT" aside={<span className="launch-app-pill is-lime">−3.6 KG</span>} />
                <div className="launch-weight-row">
                    <span className="launch-weight-now"><Count value={78} /> <em>kg</em></span>
                    <span className="launch-weight-target">TARGET 72.0 kg</span>
                </div>
                <Bar value={64} tone="lime" delay={200} height={6} />
                <svg className="launch-chart" viewBox="0 0 260 84" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                        <linearGradient id="launchChartFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#c8f135" stopOpacity=".34" />
                            <stop offset="100%" stopColor="#c8f135" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <line className="launch-chart-target" x1="0" y1="16" x2="260" y2="16" />
                    <path className="launch-chart-area" d={`${WEIGHT_PATH} L248,84 L8,84 Z`} />
                    <path className="launch-chart-line" pathLength={100} d={WEIGHT_PATH} />
                    <circle className="launch-chart-dot" cx="248" cy="22" r="3.4" />
                </svg>
            </Card>

            <div className="launch-train-stats is-three">
                <Stat label="STREAK" value={12} unit="d" tone="lime" />
                <Stat label="WORKOUTS 7D" value={3} unit="/4" tone="info" />
                <Stat label="VISITS 30D" value={18} tone="warn" />
            </div>

            <Card>
                <Head kicker="CALORIES · LAST 30 DAYS" aside={<span className="launch-app-pill is-ghost">AVG 1,780</span>} />
                <div className="launch-bars">
                    {EATEN.map((value, index) => (
                        <span key={index} className="launch-bar-col" style={{ '--i': index } as CSSProperties}>
                            <i className="is-eaten" style={{ height: `${value}%` }} />
                            <i className="is-burned" style={{ height: `${BURNED[index]}%` }} />
                        </span>
                    ))}
                </div>
                <div className="launch-legend">
                    <span><i className="is-eaten" /> Eaten</span>
                    <span><i className="is-burned" /> Burned</span>
                </div>
            </Card>

            <Card className="is-visits">
                <Head kicker="GYM VISITS · OCTOBER" aside={<span className="launch-app-pill is-lime">18 DAYS</span>} />
                <div className="launch-heat">
                    {VISITS.map((on, index) => (
                        <span key={index} className={on ? 'is-on' : ''} style={{ '--i': index } as CSSProperties} />
                    ))}
                </div>
            </Card>
        </>
    );
}

const QR = qrMatrix();

function PlanScreen() {
    return (
        <>
            <Card className="is-plan">
                <Head kicker="CURRENT PLAN" aside={<span className="launch-app-pill is-lime">ACTIVE</span>} />
                <div className="launch-plan-name">GYM · 6 MONTH</div>
                <div className="launch-plan-meta">
                    <span>01 APR → 30 SEP 2026</span>
                    <b>₹7,200</b>
                </div>
                <div className="launch-plan-dues">
                    <span className="launch-plan-warn">DUES PENDING</span>
                    <b>₹2,400</b>
                    <span className="launch-plan-pay">PAY NOW</span>
                </div>
            </Card>

            <Card className="is-upi">
                <Head kicker="PAY BY UPI" aside={<QrCode size={11} />} />
                <div className="launch-qr">
                    <span className="launch-qr-code">
                        {QR.cells.map((on, index) => (
                            <i key={index} className={on ? 'is-on' : ''} style={{ '--i': index } as CSSProperties} />
                        ))}
                    </span>
                    <span className="launch-qr-scan" />
                    <span className="launch-qr-logo">CG</span>
                </div>
                <div className="launch-upi-apps">
                    <span>GPay</span><span>PhonePe</span><span>Paytm</span>
                </div>
                <p className="launch-upi-note">Scan or tap any UPI app, then enter the UTR to confirm.</p>
            </Card>

            <Card>
                <Head kicker="PAYMENTS" aside={<span className="launch-app-add">ALL 6</span>} />
                <ul className="launch-pay-rows">
                    {[
                        { label: '01 APR 2026', amount: '₹1,200', status: 'CONFIRMED' },
                        { label: '01 FEB 2026', amount: '₹1,200', status: 'CONFIRMED' },
                        { label: '01 DEC 2025', amount: '₹1,200', status: 'PENDING' },
                    ].map((row, index) => (
                        <li key={row.label} style={{ '--i': index } as CSSProperties}>
                            <span className={`launch-pay-dot${row.status === 'PENDING' ? ' is-pending' : ''}`} />
                            <span className="launch-pay-label">{row.label}<em>{row.status}</em></span>
                            <b>{row.amount}</b>
                            <ChevronRight size={12} />
                        </li>
                    ))}
                </ul>
            </Card>

            <Card className="is-peek is-award">
                <Head kicker="NEXT MILESTONE" />
                <div className="launch-award">
                    <Award size={18} />
                    <span><b>12-MONTH MEMBER</b><em>4 months to go</em></span>
                    <Bar value={68} tone="lime" height={4} delay={500} />
                </div>
            </Card>
        </>
    );
}

/* -------------------------------------------------------------------- shell */

const SCREENS: Record<LaunchFeature['key'], () => ReactNode> = {
    goals: GoalsScreen,
    food: FoodScreen,
    train: TrainScreen,
    progress: ProgressScreen,
    plan: PlanScreen,
};

export function AppInfographic({ feature }: { feature: LaunchFeature }) {
    const reduced = usePrefersReducedMotion();
    const Screen = SCREENS[feature.key];

    return (
        <div className="launch-phone" style={css({ '--launch-feature-glow': feature.glow })}>
            <span className="launch-phone-halo" aria-hidden="true" />
            <span className="launch-phone-orbit" aria-hidden="true" />
            <div className={`launch-phone-body${reduced ? ' is-reduced' : ''}`}>
                <div className="launch-phone-screen">
                    <div className="launch-phone-status">
                        <span>9:41</span>
                        <span className="launch-phone-island" />
                        <span className="launch-phone-status-right">
                            <i /><i /><i />
                            <span className="launch-phone-battery" />
                        </span>
                    </div>
                    <div className="launch-app" key={feature.key}>
                        <header className="launch-app-head">
                            <h3>{feature.screen}</h3>
                            <span className="launch-app-avatar" />
                        </header>
                        <div className="launch-app-body">
                            <Screen />
                            <span className="launch-app-fade" aria-hidden="true" />
                        </div>
                    </div>
                    <nav className="launch-app-nav" aria-hidden="true">
                        <span className="launch-app-nav-pill" style={{ transform: `translateX(${Math.max(0, feature.nav) * 100}%)`, opacity: feature.nav < 0 ? 0 : 1 }} />
                        {NAV_ITEMS.map((item, index) => (
                            <span key={item.label} className={`launch-app-nav-item${index === feature.nav ? ' is-active' : ''}`}>
                                <item.icon size={13} />
                                <em>{item.label}</em>
                            </span>
                        ))}
                    </nav>
                    <span className="launch-phone-gesture" aria-hidden="true" />
                </div>
            </div>
            <span className="launch-phone-shadow" aria-hidden="true" />
            <span className="launch-phone-ticket" aria-hidden="true">
                <CalendarCheck size={12} />
                <b>MEMBER ID CGA5</b>
            </span>
            <span className="launch-phone-caption" aria-hidden="true">{feature.key.toUpperCase()} · LIVE UI</span>
        </div>
    );
}
