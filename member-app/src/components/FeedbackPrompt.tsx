// Asks for the gym's periodic feedback survey when one is open and not yet answered.
// Checked once per app session; "Later" snoozes that survey for 2 days (it stays on the Feedback page).
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Sheet } from './ui';
import { SurveyForm, type Survey } from '../pages/Feedback';

const SNOOZE_DAYS = 2;
const key = (id: number) => `cg_fb_snooze_${id}`;
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export default function FeedbackPrompt() {
  const [survey, setSurvey] = useState<Survey | null>(null);
  useEffect(() => {
    try { if (sessionStorage.getItem('cg_fb_checked')) return; } catch { /* ignore */ }
    let alive = true;
    // Mark the session as checked only once the answer is handled here — if this screen is replaced
    // first (e.g. the fitness welcome screen hands over to Home), the next mount asks again.
    const done = () => { try { sessionStorage.setItem('cg_fb_checked', '1'); } catch { /* ignore */ } };
    const t = setTimeout(() => {
      api.get<{ survey: Survey | null }>('/feedback/pending').then((r) => {
        if (!alive) return;
        done();
        if (!r.survey) return;
        const until = Number(get(key(r.survey.id)) ?? 0);
        if (Date.now() < until) return;
        setSurvey(r.survey);
      }).catch(() => undefined);
    }, 2500); // let the home screen settle first
    return () => { alive = false; clearTimeout(t); };
  }, []);
  if (!survey) return null;
  const later = () => { set(key(survey.id), String(Date.now() + SNOOZE_DAYS * 86400000)); setSurvey(null); };
  return (
    <Sheet open onClose={later} title={survey.title}
      footer={<button className="btn btn-ghost w-full" onClick={later}>Remind me later</button>}>
      <p className="text-sm muted mb-4">How are we doing? Rate each point from 1 to 5 — it takes a minute, and management reads every answer.</p>
      <SurveyForm survey={survey} onDone={() => setSurvey(null)} />
    </Sheet>
  );
}
