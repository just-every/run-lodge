// The landing's exact copy. Every string a drawing shows is here too.
export const copy = {
  meta: {
    title: 'Lodge · Hire well, together',
    description: 'Free, open source hiring for one business: approved vacancies, independent scorecards and recorded offers.',
  },
  hero: {
    title: 'Hire well, together.',
    sub: 'Approve the role, let each interviewer score on their own, and record every decision.',
    alternatives: ['Workable', 'Greenhouse', 'Lever'],
    run: 'Run Lodge',
    docs: 'Read the docs',
    licence: 'Free and open source, MIT licensed.',
    label: 'Lodge in three steps: the Product Designer vacancy approved; Ivy Chen and Sam Ortiz submitted their scorecards on their own, a strong yes; the offer accepted.',
  },
  sections: {
    scorecards: { eyebrow: 'Scorecards', title: 'Each interviewer decides alone.', body: 'Scorecards stay private to their author until the manager releases feedback. Every rating carries its evidence.' },
    free: { eyebrow: 'Open source', title: '100% free. Yours to keep.', body: 'Lodge is MIT licensed. Run it, change it and keep every record.' },
    approvals: { eyebrow: 'Approvals', title: 'Approve the exact terms.', body: 'Pay range, headcount and hiring manager are approved together. Change one and it needs approval again.' },
    history: { eyebrow: 'History', title: 'Every move keeps its reason.', body: 'Each stage change records who moved it, when and why.' },
    moveIn: { eyebrow: 'Move in', title: 'Bring your Workable history.', body: 'Preview the full export first. Nothing is written until you commit that exact preview.' },
  },
  included: {
    eyebrow: 'Also included',
    title: 'The rest of your hiring.',
    tiles: [
      ['page', 'An application page anyone can use'],
      ['calendar', 'Interview times and calendar files'],
      ['mail', 'Messages you approve, then send yourself'],
      ['copies', 'Duplicates decided by a person'],
      ['records', 'Retention, holds and deletion receipts'],
      ['agent', 'Your coding agent proposes, you approve'],
    ] as const,
  },
}
