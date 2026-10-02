// Feedback & grievances: members' issues (reply + status), survey results per round, and the survey
// set-up (questions, how often it is asked, issue types, send now).
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, MessageSquareWarning, Plus, Send, Star } from 'lucide-react';
import { api, qs } from '../lib/api';
import { ago, date } from '../lib/format';
import { useSession } from '../lib/session';
import type { Settings as S } from '../lib/types';
import { Empty, ErrorBox, Field, Modal, PageLoader, SectionTitle, Segmented, Spinner, useAction, useLoad } from '../components/ui';
import { PageHeader } from '../components/Layout';

type Tab = 'issues' | 'results' | 'setup';
type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
interface Issue {
  id: number; member_id: number; type: string; subject: string; description: string; status: IssueStatus; reply: string | null; handled_by: string | null;
  created_at: string; updated_at: string; resolved_at: string | null; name: string; essl_id: string; mobile: string | null;
}
const STATUS: Record<IssueStatus, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-warn/20 text-amber-700 dark:text-warn' },
  in_progress: { label: 'In progress', cls: 'bg-info/20 text-blue-700 dark:text-info' },
  resolved: { label: 'Resolved', cls: 'bg-ok/20 text-green-700 dark:text-ok' },
  closed: { label: 'Closed', cls: 'bg-black/10 dark:bg-white/10' },
};

export default function FeedbackPage() {
  const [tab, setTab] = useState<Tab>('issues');
  const { can } = useSession();
  const admin = can('owner', 'admin');
  return (
    <>
      <PageHeader title="Feedback & issues" subtitle="Members' grievances, survey results and the monthly feedback survey." />
      <div className="mb-5"><Segmented value={tab} onChange={setTab} options={[
        { value: 'issues', label: 'Issues' }, { value: 'results', label: 'Survey results' }, ...(admin ? [{ value: 'setup' as Tab, label: 'Survey & settings' }] : []),
      ]} /></div>
      {tab === 'issues' && <Issues />}
      {tab === 'results' && <Results />}
      {tab === 'setup' && admin && <Setup />}
    </>
  );
}

// ── Issues ──────────────────────────────────────────────────────────────
function Issues() {
  const [status, setStatus] = useState('active');
  const [type, setType] = useState('');
  const { data, error, reload } = useLoad(() => api.get<{ issues: Issue[]; counts: Partial<Record<IssueStatus, number>> }>(`/feedback/issues${qs({ status, type })}`), [status, type]);
  const { data: settings } = useLoad(() => api.get<S>('/settings'));
  const [open, setOpen] = useState<Issue | null>(null);
  const n = data?.counts ?? {};
  return (
    <div className="card overflow-hidden">
      <div className="p-4 flex flex-wrap gap-2 items-center border-b border-paper-line dark:border-ink-700">
        {([['active', `Needs action · ${(n.open ?? 0) + (n.in_progress ?? 0)}`], ['open', 'Open'], ['in_progress', 'In progress'], ['resolved', `Resolved · ${n.resolved ?? 0}`], ['closed', 'Closed'], ['all', 'All']] as [string, string][])
          .map(([k, l]) => <button key={k} className={`chip ${status === k ? 'chip-on' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
        <select className="input w-auto ml-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Issue type">
          <option value="">All types</option>{settings?.feedback.grievance_types.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      {error ? <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div> : !data ? <PageLoader /> : data.issues.length === 0 ? (
        <Empty icon={<MessageSquareWarning className="w-6 h-6" />} title="No issues here" hint="Members raise issues from the app (More → Feedback & issues)." />
      ) : (
        <ul>
          {data.issues.map((i) => (
            <li key={i.id}>
              <button className="w-full text-left px-4 py-3 border-t border-paper-line dark:border-ink-700 hover:bg-black/5 dark:hover:bg-white/5 flex gap-3 items-start" onClick={() => setOpen(i)}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{i.subject}</p>
                  <p className="text-xs muted">{i.type} · {i.name} (#{i.essl_id}) · {ago(i.created_at)}</p>
                  <p className="text-sm muted line-clamp-2 mt-0.5">{i.description}</p>
                </div>
                <span className={`badge shrink-0 ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <IssueModal issue={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function IssueModal({ issue, onClose, onSaved }: { issue: Issue; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [status, setStatus] = useState<IssueStatus>(issue.status === 'open' ? 'in_progress' : issue.status);
  const [reply, setReply] = useState(issue.reply ?? '');
  return (
    <Modal open onClose={onClose} title={issue.subject}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.patch(`/feedback/issues/${issue.id}`, { status, reply }), 'Saved — the member sees it in their app').then((r) => r && onSaved())}>
          {busy && <Spinner className="w-4 h-4" />}Save</button></>}>
      <div className="space-y-3 text-sm">
        <p className="muted">{issue.type} · raised {date(issue.created_at.slice(0, 10))} by <b className="text-current">{issue.name}</b> (#{issue.essl_id}){issue.mobile ? ` · ${issue.mobile}` : ''}</p>
        <p className="whitespace-pre-line rounded-2xl bg-black/5 dark:bg-white/5 p-3">{issue.description}</p>
        {issue.handled_by && <p className="text-xs muted">Last updated by {issue.handled_by} · {ago(issue.updated_at)}</p>}
        <Field label="Status">
          <div className="flex flex-wrap gap-2">{(Object.keys(STATUS) as IssueStatus[]).map((s) => <button key={s} className={`chip ${status === s ? 'chip-on' : ''}`} onClick={() => setStatus(s)}>{STATUS[s].label}</button>)}</div>
        </Field>
        <Field label="Reply to the member" hint="Shown in their app under My issues">
          <textarea className="input min-h-[110px] py-2" value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Thanks for flagging this — the treadmill has been serviced today." />
        </Field>
      </div>
    </Modal>
  );
}

// ── Survey results ──────────────────────────────────────────────────────
interface RoundRow { id: number; title: string; kind: string; closes_on: string | null; created_by: string | null; created_at: string; responses: number; avg_rating: number | null }
interface RoundDetail {
  round: { id: number; title: string; kind: string; closes_on: string | null; created_at: string }; responses: number;
  questions: { id: number; text: string; category: string; count: number; avg: number | null; dist: number[]; improvements: { rating: number; text: string; name: string; essl_id: string; at: string }[] }[];
  comments: { comment: string; created_at: string; name: string; essl_id: string }[];
}

function Results() {
  const { data, error, reload } = useLoad(() => api.get<{ rounds: RoundRow[]; app_members: number }>('/feedback/rounds'));
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => { if (data?.rounds.length && pick === null) setPick(data.rounds[0].id); }, [data, pick]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  if (!data.rounds.length) return <div className="card"><Empty icon={<Star className="w-6 h-6" />} title="No surveys yet" hint="The first survey opens automatically on schedule, or send one now from “Survey & settings”." /></div>;
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="card overflow-hidden self-start">
        <p className="font-semibold px-4 pt-4 pb-2">Surveys</p>
        <ul>{data.rounds.map((r) => (
          <li key={r.id}><button className={`w-full text-left px-4 py-3 border-t border-paper-line dark:border-ink-700 ${pick === r.id ? 'bg-lime/15' : 'hover:bg-black/5 dark:hover:bg-white/5'}`} onClick={() => setPick(r.id)}>
            <p className="font-semibold text-sm">{r.title} {r.closes_on && r.closes_on >= today && <span className="badge bg-lime/30 ml-1">open</span>}</p>
            <p className="text-xs muted">{r.responses} response{r.responses === 1 ? '' : 's'}{r.avg_rating ? ` · avg ${r.avg_rating} ★` : ''} · {date(r.created_at.slice(0, 10))}</p>
          </button></li>
        ))}</ul>
        <p className="text-[11px] muted px-4 py-3">{data.app_members} members have signed in to the app.</p>
      </div>
      {pick && <RoundView id={pick} onChanged={reload} />}
    </div>
  );
}

function RoundView({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api.get<RoundDetail>(`/feedback/rounds/${id}`), [id]);
  const { busy, run } = useAction();
  const { can } = useSession();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const isOpen = !!data.round.closes_on && data.round.closes_on >= today;
  const tone = (avg: number | null) => (avg === null ? 'text-ink-400' : avg < 3 ? 'text-bad' : avg < 4 ? 'text-amber-600 dark:text-warn' : 'text-green-700 dark:text-ok');
  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-center gap-3">
        <div className="flex-1"><p className="font-semibold">{data.round.title}</p>
          <p className="text-xs muted">{data.responses} responses · {data.round.kind === 'instant' ? 'sent by hand' : 'scheduled'} · {isOpen ? `open till ${date(data.round.closes_on!)}` : `closed${data.round.closes_on ? ` ${date(data.round.closes_on)}` : ''}`}</p></div>
        {isOpen && can('owner', 'admin') && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(() => api.post(`/feedback/rounds/${id}/close`, {}), 'Survey closed').then(() => { void reload(); onChanged(); })}>Stop asking</button>}
      </div>
      {data.questions.map((q) => (
        <div key={q.id} className="card card-pad">
          <div className="flex items-start gap-3">
            <div className="flex-1"><p className="font-semibold text-sm">{q.text}</p><p className="text-xs muted capitalize">{q.category} · {q.count} rating{q.count === 1 ? '' : 's'}</p></div>
            <p className={`font-display text-2xl font-bold ${tone(q.avg)}`}>{q.avg ?? '—'}<span className="text-sm"> ★</span></p>
          </div>
          <div className="flex gap-1 mt-3 items-end h-14">
            {q.dist.map((n, k) => {
              const max = Math.max(1, ...q.dist);
              return <div key={k} className="flex-1 flex flex-col items-center gap-1"><div className={`w-full rounded-t-md ${k < 2 ? 'bg-bad/70' : k === 2 ? 'bg-warn/70' : 'bg-ok/70'}`} style={{ height: `${(n / max) * 40 + 2}px` }} title={`${k + 1}★: ${n}`} /><span className="text-[10px] muted">{k + 1}★ {n}</span></div>;
            })}
          </div>
          {q.improvements.length > 0 && (
            <details className="mt-3" open={q.avg !== null && q.avg < 3.5}>
              <summary className="text-xs font-semibold cursor-pointer">What members want improved ({q.improvements.length})</summary>
              <ul className="mt-2 space-y-2">{q.improvements.map((m, k) => (
                <li key={k} className="text-sm rounded-2xl bg-black/5 dark:bg-white/5 p-3"><p className="whitespace-pre-line">{m.text}</p><p className="text-[11px] muted mt-1">{m.rating}★ · {m.name} (#{m.essl_id}) · {ago(m.at)}</p></li>
              ))}</ul>
            </details>
          )}
        </div>
      ))}
      {data.comments.length > 0 && (
        <div className="card card-pad"><SectionTitle title={`Other comments (${data.comments.length})`} />
          <ul className="space-y-2">{data.comments.map((m, k) => <li key={k} className="text-sm rounded-2xl bg-black/5 dark:bg-white/5 p-3"><p className="whitespace-pre-line">{m.comment}</p><p className="text-[11px] muted mt-1">{m.name} (#{m.essl_id}) · {ago(m.created_at)}</p></li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ── Survey set-up ───────────────────────────────────────────────────────
interface Question { id: number; text: string; category: string; sort: number; active: number }

function Setup() {
  const { data: s, reload: reloadSettings } = useLoad(() => api.get<S>('/settings'));
  const { data: q, error, reload } = useLoad(() => api.get<{ questions: Question[]; categories: string[] }>('/feedback/questions'));
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<Question | 'new' | null>(null);
  const [f, setF] = useState<S['feedback'] | null>(null);
  const [types, setTypes] = useState('');
  useEffect(() => { if (s) { setF(s.feedback); setTypes(s.feedback.grievance_types.join('\n')); } }, [s]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!q || !f) return <PageLoader />;
  const active = q.questions.filter((x) => x.active);
  const move = (id: number, dir: -1 | 1) => run(() => api.post(`/feedback/questions/${id}/move`, { dir })).then(reload);
  const toggle = (x: Question) => run(() => api.patch(`/feedback/questions/${x.id}`, { active: !x.active })).then(reload);
  const saveSettings = () => run(() => api.put('/settings/feedback', { ...f, grievance_types: types.split('\n') }), 'Saved').then(reloadSettings);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card overflow-hidden lg:col-span-2">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div><p className="font-semibold">Survey questions</p><p className="text-xs muted">Members rate each from 1 to 5; a 3 or lower asks them what to improve. Changes apply to the next survey.</p></div>
          <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Plus className="w-4 h-4" />Add</button>
        </div>
        <ul>{q.questions.map((x) => {
          const pos = active.findIndex((a) => a.id === x.id);
          return (
            <li key={x.id} className={`flex items-center gap-2 px-4 py-2.5 border-t border-paper-line dark:border-ink-700 ${x.active ? '' : 'opacity-45'}`}>
              <span className="w-6 text-center font-display font-bold">{x.active ? pos + 1 : '–'}</span>
              <button className="flex-1 min-w-0 text-left" onClick={() => setEdit(x)}><p className="text-sm font-medium truncate">{x.text}</p><p className="text-[11px] muted capitalize">{x.category}</p></button>
              <button className="icon-btn w-8 h-8" disabled={!x.active || pos <= 0 || busy} onClick={() => move(x.id, -1)} aria-label="Move up"><ArrowUp className="w-4 h-4" /></button>
              <button className="icon-btn w-8 h-8" disabled={!x.active || pos >= active.length - 1 || busy} onClick={() => move(x.id, 1)} aria-label="Move down"><ArrowDown className="w-4 h-4" /></button>
              <button className="icon-btn w-8 h-8" disabled={busy} onClick={() => toggle(x)} aria-label={x.active ? 'Hide' : 'Show'} title={x.active ? 'Stop asking this' : 'Ask this again'}>{x.active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
            </li>
          );
        })}</ul>
      </div>

      <div className="card card-pad space-y-3">
        <SectionTitle title="How often to ask" />
        <Field label="Survey frequency">
          <select className="input" value={f.every_months} onChange={(e) => setF({ ...f, every_months: Number(e.target.value) })}>
            <option value={1}>Every month</option><option value={2}>Every 2 months</option><option value={3}>Every 3 months</option><option value={6}>Every 6 months</option><option value={0}>Only when I send it</option>
          </select>
        </Field>
        <Field label="Keep asking for (days)" hint="The popup reminds members until they answer or this many days pass">
          <input className="input" inputMode="numeric" value={f.days_open} onChange={(e) => setF({ ...f, days_open: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={saveSettings}>{busy && <Spinner className="w-4 h-4" />}Save</button>
          <button className="btn btn-outline" disabled={busy || !active.length} onClick={() => run(() => api.post('/feedback/rounds', {}), 'Survey sent — members see it next time they open the app')}>
            <Send className="w-4 h-4" />Send survey now</button>
        </div>
        <p className="text-[11px] muted">Members see the survey as a popup in the app (and under More → Feedback). “Send survey now” starts a new survey immediately and closes any open one.</p>
      </div>

      <div className="card card-pad space-y-3">
        <SectionTitle title="Issue types" />
        <Field label="One per line" hint="Members pick one of these when they report an issue">
          <textarea className="input min-h-[200px] py-2" value={types} onChange={(e) => setTypes(e.target.value)} />
        </Field>
        <button className="btn btn-primary" disabled={busy} onClick={saveSettings}>Save</button>
      </div>

      {edit && <QuestionModal q={edit} categories={q.categories} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </div>
  );
}

function QuestionModal({ q, categories, onClose, onSaved }: { q: Question | 'new'; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [text, setText] = useState(q === 'new' ? '' : q.text);
  const [category, setCategory] = useState(q === 'new' ? 'gym' : q.category);
  const save = () => run(() => (q === 'new' ? api.post('/feedback/questions', { text, category }) : api.patch(`/feedback/questions/${q.id}`, { text, category })), 'Question saved').then((r) => r && onSaved());
  return (
    <Modal open onClose={onClose} title={q === 'new' ? 'Add question' : 'Edit question'}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || text.trim().length < 3} onClick={save}>{busy && <Spinner className="w-4 h-4" />}Save</button></>}>
      <div className="space-y-3">
        <Field label="Question" hint="Members rate it from 1 (poor) to 5 (excellent)"><input className="input" value={text} maxLength={160} onChange={(e) => setText(e.target.value)} placeholder="e.g. Air conditioning in the cardio area" autoFocus /></Field>
        <Field label="Category"><select className="input capitalize" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
      </div>
    </Modal>
  );
}
