import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles } from 'lucide-react';

/** Entry card to the AI coach from the Diet / Train pages. */
export default function CoachLink({ kind }: { kind: 'diet' | 'workout' }) {
  return (
    <Link to={kind === 'diet' ? '/coach' : '/coach?tab=workout'}
      className="flex items-center gap-3 rounded-3xl p-3 pr-4 bg-gradient-to-r from-lime/25 to-lime/5 border border-lime/40 hover:border-lime transition">
      <span className="w-10 h-10 rounded-2xl bg-lime text-ink-900 flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm">{kind === 'diet' ? 'AI diet plan' : 'AI workout plan'}</span>
        <span className="block text-xs muted truncate">{kind === 'diet' ? 'Meals for your day or week — tick them off as you eat' : 'A balanced 1-day, 3-day or weekly plan for your goal'}</span>
      </span>
      <ChevronRight className="w-5 h-5 muted shrink-0" />
    </Link>
  );
}
