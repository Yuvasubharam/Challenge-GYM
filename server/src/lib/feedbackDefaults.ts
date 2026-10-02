// Feedback settings type + defaults — no imports, so db.ts can use them without an import cycle.
export interface FeedbackSettings {
  /** 0 = only when sent by hand; otherwise a new survey every N months. */
  every_months: number;
  /** How long the survey popup keeps asking after a round opens. */
  days_open: number;
  /** Issue types members choose from when raising a grievance. */
  grievance_types: string[];
}

export const DEFAULT_FEEDBACK: FeedbackSettings = {
  every_months: 1,
  days_open: 14,
  grievance_types: ['Equipment', 'Cleanliness / washrooms', 'Trainer', 'Staff behaviour', 'Crowd / timings', 'Payments / billing', 'Door / fingerprint', 'Member app', 'Other'],
};
