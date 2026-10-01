import { useEffect, useState } from 'react';

export function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(() =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => setReduced(query.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    return reduced;
}

/**
 * Eases a number from 0 to `target` over `duration`, after an optional delay.
 * Used so KPIs, calorie rings and chart read-outs animate instead of snapping.
 */
export function useCountUp(target: number, duration = 1100, delay = 0) {
    const reduced = usePrefersReducedMotion();
    const [value, setValue] = useState(0);

    useEffect(() => {
        if (reduced || duration <= 0) {
            setValue(target);
            return;
        }
        let frame = 0;
        let origin = 0;
        const tick = (time: number) => {
            if (!origin) origin = time;
            const elapsed = time - origin - delay;
            if (elapsed < 0) {
                frame = requestAnimationFrame(tick);
                return;
            }
            const progress = Math.min(1, elapsed / duration);
            setValue(target * (1 - Math.pow(1 - progress, 3)));
            if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [target, duration, delay, reduced]);

    return reduced ? target : value;
}

/** 0 → 1 across `duration`; restarts whenever `resetKey` changes. */
export function useTimeline(duration: number, resetKey: string | number, active = true) {
    const reduced = usePrefersReducedMotion();
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        if (reduced || duration <= 0 || !active) return;
        setProgress(0);
        let frame = 0;
        const start = performance.now();
        const tick = (time: number) => {
            const next = Math.min(1, (time - start) / duration);
            setProgress(next);
            if (next < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [duration, resetKey, active, reduced]);

    return progress;
}

const QR_SIZE = 21;

function finderCell(row: number, column: number): boolean | null {
    const spots: Array<[number, number]> = [[0, 0], [0, QR_SIZE - 7], [QR_SIZE - 7, 0]];
    for (const [baseRow, baseColumn] of spots) {
        if (row >= baseRow && row < baseRow + 7 && column >= baseColumn && column < baseColumn + 7) {
            const local = Math.max(Math.abs(row - baseRow - 3), Math.abs(column - baseColumn - 3));
            return local === 3 || local <= 1;
        }
    }
    return null;
}

/**
 * A deterministic, decorative QR-looking matrix (finder patterns plus seeded modules).
 * Purely visual for the launch animation — it is not a scannable code.
 */
export function qrMatrix() {
    const cells: boolean[] = [];
    let seed = 20261001;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    for (let row = 0; row < QR_SIZE; row += 1) {
        for (let column = 0; column < QR_SIZE; column += 1) {
            const finder = finderCell(row, column);
            cells.push(finder === null ? random() > 0.52 : finder);
        }
    }
    return { size: QR_SIZE, cells };
}
