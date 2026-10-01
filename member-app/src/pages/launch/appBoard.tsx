import type { CSSProperties } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { CAPABILITIES, CAPABILITY_CHIPS } from './features';

export function AppBoard() {
    return (
        <section className="launch-board" aria-live="polite" aria-atomic="true">
            <span className="launch-board-rings" aria-hidden="true">
                <i /><i /><i />
            </span>
            <span className="launch-board-scan" aria-hidden="true" />

            <div className="launch-board-head">
                <p className="launch-feature-kicker">AND THERE IS A LOT MORE</p>
                <h1>Your whole gym life,<br /><em>in one app.</em></h1>
                <p className="launch-board-intro">Ten screens, one login. Everything the gym already knows about you, finally on your phone.</p>
            </div>

            <ul className="launch-board-grid">
                {CAPABILITIES.map((item, index) => (
                    <li key={item.label} style={{ '--i': index } as CSSProperties}>
                        <span className="launch-board-glow" />
                        <span className="launch-board-icon"><item.icon size={16} /></span>
                        <b>{item.label}</b>
                        <p>{item.detail}</p>
                        <ArrowUpRight className="launch-board-arrow" size={13} />
                    </li>
                ))}
            </ul>

            <div className="launch-board-ticker" aria-hidden="true">
                <div className="launch-board-ticker-track">
                    {[0, 1].map((copy) => (
                        <span key={copy} className="launch-board-chips">
                            {CAPABILITY_CHIPS.map((chip) => (
                                <em key={chip}>{chip} <i>✳</i></em>
                            ))}
                        </span>
                    ))}
                </div>
            </div>
        </section>
    );
}
