# Offers and the hire

Messages and offers are approved as exact text and terms, then recorded.
Lodge never sends anything itself.

## Messages to the candidate

Under **Messages to the candidate**, choose **Draft a message**, pick its
**Purpose**, write the subject and message and press **Save draft**. Request
approval from a hiring manager. Once approved, **Download approved message
(.eml)** gives an email file to send from your own mailbox. Editing the text
needs approval again.

## Prepare an offer

On an active application, choose **Prepare an offer**: the job title, start
date, pay, any other terms and the opening it fills. Press **Save offer**.
Accepting the offer marks that opening filled.

**Request offer approval** sends it to an approver. The approver opens the
**Approval packet**: the rubric, the stage history, the released scorecards,
the approvals so far, and a plain warning when the pay falls outside the
vacancy's approved range.

## Record the outcome

When the candidate answers, choose the **Outcome** (*Accepted*, *Declined* or
*Withdrawn by us*), add a **Note** and press **Record outcome**. Accepted and
declined need a current approval of the exact terms; an edited offer needs
approval again.

Accepting records the hire on the vacancy and the application. **HR handoff
(JSON)** then downloads the person, role, pay, start date and their documents
for your HR process. Lodge records the hiring decision only: contracts, payroll
and right-to-work checks happen elsewhere.

An application that was closed stays closed: its offer can be withdrawn, never
accepted.

## Sign natively in Lodge

Without a signature provider you can send the approved offer for **Lodge-native electronic signature**. Under
**Vacancies → Electronic signature** the owner or a hiring admin reviews the consent disclosure and designates the
people who countersign for the employer; a reviewed offer template version then chooses **native signature** and may
require countersignature. On an approved offer, **Send for native signature** emails the candidate a link. The
candidate asks for a one-time code (a separate email), reads and agrees to the disclosure, reviews the exact approved
document and signs with a typed name. The designated signer then countersigns from the same offer; Lodge seals a PDF
of the approved text with a signature page and issues a completion certificate listing both parties, their verified
emails, IP addresses, user agents, times and every fingerprint. Completion records the hire and the HR handoff carries
the signature record. Changing the offer, the candidate's email or the application, or recording an outcome, voids
the signing request. The seal is tamper-evident by its SHA-256; it is not a PKI digital signature, and Lodge does not
verify anyone's authority to sign.
