// Feedback & grievances: the gym's periodic survey (rate 1–5; 3 or lower asks what to improve),
// raising an issue by type, and following up on issues already raised.
import { useState } from 'react';
import { CheckCircle2, MessageSquareWarning, Send, Star } from 'lucide-react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { ErrorBox, Field, PageLoader, Spinner, useAction, useLoad } from '../components/ui';

export interface SurveyQuestion { id: number; text: string; category: string }
export interface Survey { id: number; title: string; closes_on: string | null; questions: SurveyQuestion[] }
interface Issue { id: number; type: string; subject: string; description: string; status: 'open' | 'in_progress' | 'resolved' | 'closed'; reply: string | null; created_at: string; updated_at: string; resolved_at: string | null }
interface Data { survey: Survey | null; answered_round: { id: number; title: string } | null; grievance_types: string[]; issues: Issue[] }

const RATING_LABEL = ['', 'Poor', 'Below average', 'Average', 'Good', 'Excellent'];
const STATUS: Record<Issue['status'], { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-warn/20 text-amber-700 dark:text-warn' },
  in_progress: { label: 'In progress', cls: 'bg-info/20 text-blue-700 dark:text-info' },
  resolved: { label: 'Resolved', cls: 'bg-ok/20 text-green-700 dark:text-ok' },
  closed: { label: 'Closed', cls: 'bg-black/10 dark:bg-white/10' },
};

/** The survey form (used on this page and in the app-start popup). */
export function SurveyForm({ survey, onDone }: { survey: Survey; onDone: () => void }) {
  const { busy, run } = useAction();
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [comment, setComment] = useState('');
  const missing = survey.questions.filter((q) => !ratings[q.id] || (ratings[q.id] <= 3 && (notes[q.id] ?? '').trim().length < 3));
  const submit = () => run(() => api.post(`/feedback/surveys/${survey.id}`, {
    answers: survey.questions.map((q) => ({ question_id: q.id, rating: ratings[q.id], improvement: notes[q.id] ?? '' })), comment,
  }), 'Thank you for your feedback 💚').then((r) => { if (r) onDone(); });
  return (
    <div className="space-y-4">
      {survey.questions.map((q, i) => {
        const r = ratings[q.id] ?? 0;
        return (
          <div key={q.id} className="rounded-3xl border border-paper-line dark:border-ink-700 p-4">
            <p className="text-sm font-semibold"><span className="muted mr-1">{i + 1}.</span>{q.text}</p>
            <div className="flex items-center gap-1 mt-2" role="radiogroup" aria-label={q.text}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={r === n} aria-label={`${n} — ${RATING_LABEL[n]}`}
                  className="p-1 -m-0.5" onClick={() => setRatings({ ...ratings, [q.id]: n })}>
                  <Star className={`w-8 h-8 transition ${n <= r ? 'fill-lime text-lime-600 dark:text-lime' : 'text-ink-300 dark:text-ink-600'}`} />
                </button>
              ))}
              {r > 0 && <span className="text-xs muted ml-2">{RATING_LABEL[r]}</span>}
            </div>
            {r > 0 && r <= 3 && (
              <div className="mt-3">
                <label className="text-xs font-semibold" htmlFor={`imp-${q.id}`}>What should we improve? <span className="text-bad">*</span></label>
                <textarea id={`imp-${q.id}`} className="input mt-1 min-h-[72px] py-2" value={notes[q.id] ?? ''} maxLength={600}
                  onChange={(e) => setNotes({ ...notes, [q.id]: e.target.value })} placeholder="Tell management what went wrong and what would make it better" />
              </div>
            )}
          </div>
        );
      })}
      <Field label="Anything else you'd like to tell us? (optional)">
        <textarea className="input min-h-[72px] py-2" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <button className="btn btn-primary btn-lg w-full" disabled={busy || missing.length > 0} onClick={submit}>
        {busy ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}Submit feedback</button>
      {missing.length > 0 && <p className="text-xs muted text-center">{missing.length} question{missing.length > 1 ? 's' : ''} still to answer{missing.some((q) => ratings[q.id]) ? ' (ratings of 3 or less need a note)' : ''}.</p>}
    </div>
  );
}

type Tab = 'survey' | 'issue' | 'mine';

export default function Feedback() {
  const { data, error, reload } = useLoad(() => api.get<Data>('/feedback'));
  const [tab, setTab] = useState<Tab | null>(null);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const current: Tab = tab ?? (data.survey ? 'survey' : 'issue');
  const open = data.issues.filter((i) => i.status === 'open' || i.status === 'in_progress').length;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl sm:text-3xl font-bold pt-1">Feedback</h1>
      <div className="flex rounded-full bg-black/5 dark:bg-white/5 p-1">
        {([['survey', `Rate us${data.survey ? ' •' : ''}`], ['issue', 'Report an issue'], ['mine', `My issues${open ? ` (${open})` : ''}`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={`flex-1 h-9 rounded-full text-sm font-semibold ${current === k ? 'bg-ink-900 text-white dark:bg-lime dark:text-ink-900' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {current === 'survey' && (data.survey ? (
        <section className="card card-pad">
          <p className="font-semibold">{data.survey.title}</p>
          <p className="text-xs muted mb-4">Rate each point from 1 (poor) to 5 (excellent). Management reads every answer.{data.survey.closes_on ? ` Open till ${date(data.survey.closes_on)}.` : ''}</p>
          <SurveyForm survey={data.survey} onDone={() => { setTab('survey'); void reload(); }} />
        </section>
      ) : (
        <section className="card card-pad text-center py-10">
          <CheckCircle2 className="w-10 h-10 mx-auto text-lime-600 dark:text-lime" />
          <p className="font-semibold mt-3">{data.answered_round ? `Thanks — you've answered “${data.answered_round.title}”.` : 'No survey right now.'}</p>
          <p className="text-sm muted mt-1">We'll ask again in a while. Something wrong today? Use “Report an issue”.</p>
        </section>
      ))}
      {current === 'issue' && <IssueForm types={data.grievance_types} onDone={() => { setTab('mine'); void reload(); }} />}
      {current === 'mine' && <MyIssues issues={data.issues} onNew={() => setTab('issue')} />}
    </div>
  );
}

function IssueForm({ types, onDone }: { types: string[]; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ type: '', subject: '', description: '' });
  const ok = f.type && f.subject.trim().length >= 3 && f.description.trim().length >= 10;
  return (
    <section className="card card-pad space-y-3">
      <p className="text-sm muted">Tell management about a problem — equipment, cleanliness, staff, payments, the door or this app. You'll see their reply under “My issues”.</p>
      <div>
        <p className="text-xs font-semibold mb-2">Type of issue</p>
        <div className="flex flex-wrap gap-2">
          {types.map((t) => <button key={t} type="button" className={`chip ${f.type === t ? 'chip-on' : ''}`} onClick={() => setF({ ...f, type: t })}>{t}</button>)}
        </div>
      </div>
      <Field label="Subject"><input className="input" value={f.subject} maxLength={120} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Treadmill 3 not working" /></Field>
      <Field label="Describe the issue"><textarea className="input min-h-[120px] py-2" value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What happened, when, and where in the gym?" /></Field>
      <button className="btn btn-primary btn-lg w-full" disabled={busy || !ok} onClick={() => run(() => api.post('/feedback/issues', f), 'Issue sent to management').then((r) => r && onDone())}>
        {busy ? <Spinner className="w-4 h-4" /> : <MessageSquareWarning className="w-4 h-4" />}Send to management</button>
    </section>
  );
}

function MyIssues({ issues, onNew }: { issues: Issue[]; onNew: () => void }) {
  if (!issues.length) {
    return <section className="card card-pad text-center py-10"><p className="font-semibold">No issues raised</p><button className="btn btn-outline mt-3" onClick={onNew}>Report an issue</button></section>;
  }
  return (
    <ul className="space-y-3">
      {issues.map((i) => (
        <li key={i.id} className="card card-pad">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-semibold">{i.subject}</p><p className="text-xs muted">{i.type} · raised {date(i.created_at.slice(0, 10))}</p></div>
            <span className={`badge shrink-0 ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
          </div>
          <p className="text-sm mt-2 whitespace-pre-line">{i.description}</p>
          {i.reply && <div className="mt-3 rounded-2xl bg-lime/15 p-3 text-sm"><p className="text-xs font-semibold mb-1">Reply from management</p><p className="whitespace-pre-line">{i.reply}</p></div>}
        </li>
      ))}
    </ul>
  );
}
