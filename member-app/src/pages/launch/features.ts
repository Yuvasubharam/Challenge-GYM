import {
    BellRing,
    CalendarCheck,
    Images,
    Megaphone,
    QrCode,
    ShoppingBag,
    Smartphone,
    User,
    type LucideIcon,
} from 'lucide-react';

export type FeatureKey = 'goals' | 'food' | 'train' | 'progress' | 'plan';

export type LaunchFeature = {
    key: FeatureKey;
    title: string;
    detail: string;
    /** Screen name shown in the fake phone status bar. */
    screen: string;
    /** Index of the active bottom-nav tab, or -1 when the screen sits outside the nav. */
    nav: number;
    points: string[];
    /** Backdrop wash colour for this slide. */
    glow: string;
};

/** Time each feature holds on screen before the reel advances. */
export const FEATURE_HOLD_MS = 8800;
/** Time the "everything in one app" capability board holds on screen. */
export const SHOWCASE_HOLD_MS = 16000;

export const LAUNCH_FEATURES: LaunchFeature[] = [
    {
        key: 'goals',
        title: 'Goals that move with you.',
        detail: 'Answer a few questions and the app builds your targets. Every small win after that is counted for you.',
        screen: 'Your plan',
        nav: 0,
        points: ['BMI and daily kcal targets in 30 seconds', 'A weekly training target that follows you', 'Protein, water and streak goals on one card'],
        glow: 'rgba(200, 241, 53, .20)',
    },
    {
        key: 'food',
        title: 'Food that fuels your day.',
        detail: 'Log breakfast, lunch, dinner and snacks in seconds. Watch calories and macros move as you eat.',
        screen: 'Diet',
        nav: 1,
        points: ['Indian foods with real portion weights', 'Protein, carbs and fat updating live', 'One tap to repeat yesterday'],
        glow: 'rgba(245, 165, 36, .18)',
    },
    {
        key: 'train',
        title: 'A plan made for your next rep.',
        detail: '2,000+ exercises with photo guides, how-to steps in English and हिंदी, and a set logger that does the maths.',
        screen: 'Train',
        nav: 2,
        points: ['Sets, reps and kilos logged in seconds', 'Estimated 1RM and calories burned', 'Video demo for every movement'],
        glow: 'rgba(77, 163, 255, .18)',
    },
    {
        key: 'progress',
        title: 'Your progress, all in one place.',
        detail: 'Weight trend, calories, every gym visit and every personal record. The full story of your effort.',
        screen: 'Progress',
        nav: 3,
        points: ['Weight chart against your target line', 'Calories eaten vs burned over 30 days', 'Visit heat-map, streaks and 1RM records'],
        glow: 'rgba(179, 136, 255, .18)',
    },
    {
        key: 'plan',
        title: 'Your membership in your pocket.',
        detail: 'Renew in the app, pay by UPI from any UPI app, and keep every receipt you will ever need.',
        screen: 'Plan',
        nav: -1,
        points: ['UPI QR for GPay, PhonePe and Paytm', 'Dues and pending payments at a glance', 'Digital receipts you can share or print'],
        glow: 'rgba(255, 210, 122, .18)',
    },
];

export type Capability = {
    icon: LucideIcon;
    label: string;
    detail: string;
};

/** The "everything in one app" board that plays after the feature reel. */
export const CAPABILITIES: Capability[] = [
    { icon: CalendarCheck, label: 'Gym visits', detail: 'A monthly heat-map fed straight from the front-desk fingerprint machine.' },
    { icon: QrCode, label: 'Pay in app', detail: 'Pay in-app with UPI, cards and more, then track confirmation.' },
    { icon: BellRing, label: 'Push alerts', detail: 'Offers, events and notices land on your phone the day they go up.' },
    { icon: ShoppingBag, label: 'Gym shop', detail: 'Reserve supplements and gear, pay and collect at the desk.' },
    { icon: Megaphone, label: 'News & offers', detail: 'Notices, challenges and member-only offers in one feed.' },
    { icon: Images, label: 'Albums', detail: 'Every gym shoot and event, organised album by album.' },
    { icon: Smartphone, label: 'Installable', detail: 'Add it to your home screen. It opens fast and keeps working on a weak signal.' },
    { icon: User, label: 'Your profile', detail: 'Photo, goals, personal details, emergency contact and password.' },
];

export const CAPABILITY_CHIPS = [
    '2,000+ EXERCISES',
    '1,800+ INDIAN FOODS',
    'WEIGHT & BMI',
    'PAY IN APP',
    'VISIT HISTORY',
    'PUSH ALERTS',
    'SHOP & ALBUMS',
    'FREE FOR EVERY MEMBER',
];
