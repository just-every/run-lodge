// Protected traits under US equal-employment law, as words Lodge refuses in
// its own hiring questions (SCREEN-001) and agent debrief briefs (COORD-006).
// Matched case-insensitively as whole words. Voluntary monitoring answers
// (LDG-003) are collected apart from this, restricted to administrators.
const PROTECTED = /\b(age|aged|years old|how old|date of birth|birth\s?date|birthday|race|racial|ethnic\w*|religio\w*|pregnan\w*|maternity|gender|sex|sexual\w*|disab\w*|national origin|nationality|citizenship|immigra\w*|accent|married|marital|children|veteran|genetic\w*)\b/i

/** The protected-trait word a text uses, if any. */
export const protectedTerm = (value: string) => value.match(PROTECTED)?.[0]
