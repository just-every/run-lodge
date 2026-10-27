// Protected traits under US equal-employment law, as words Lodge refuses in
// its own hiring questions (SCREEN-001) and agent debrief briefs (COORD-006).
// Matched case-insensitively as whole words. Voluntary monitoring answers
// (LDG-003) are collected apart from this, restricted to administrators.
const PROTECTED = /\b(age|aged|years old|how old|date of birth|birth\s?date|birthday|birth\s+year|born|race|racial|colou?r|ancestry|ethnic\w*|religio\w*|creed|pregnan\w*|maternity|paternity|gender\w*|male|female|man|woman|men|women|nonbinary|non-binary|transgender|sex|sexual\w*|disab\w*|national origin|nationality|citizenship|immigra\w*|accent|married|marital|marriage|spouse|husband|wife|child|children|kids|(?:family|familial)\s+status|parent\w*|caregiv\w*|veteran|military\s+service|genetic\w*)\b/i

/** The protected-trait word a text uses, if any. */
export const protectedTerm = (value: string) => value.match(PROTECTED)?.[0]
