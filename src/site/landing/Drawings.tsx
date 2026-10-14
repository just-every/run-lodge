// The section drawings: engraved birch cards copying real Lodge screens. Every string is real text,
// and each drawing's accessible label lists what it shows.

export function ScorecardDrawing() {
  return <figure className="plank drawing" role="img" aria-label="A scorecard: Craft, 3, “Walked us through three real redesigns.” Each scorecard stays private to its author until you release feedback. Release feedback to the panel.">
    <p className="plank-title split"><span>Craft</span><span className="num">3</span></p>
    <p className="quote">“Walked us through three real redesigns.”</p>
    <p className="note">Each scorecard stays private to its author until you release feedback.</p>
    <span className="engraved-button">Release feedback to the panel</span>
  </figure>
}

export function LicenceDrawing() {
  return <figure className="plank drawing" role="img" aria-label="MIT License: Permission is hereby granted, free of charge">
    <p className="plank-title">MIT License</p>
    <p className="plank-row">Permission is hereby granted, free of charge</p>
    <span className="lines" aria-hidden="true"><i /><i /><i /></span>
  </figure>
}

export function ApprovalDrawing() {
  return <figure className="plank drawing" role="img" aria-label="An approval: Role, Product Designer; Headcount, 1; Manager, Morgan Lee. Approve these exact terms selected. Record decision.">
    <dl className="terms-drawing">
      <dt>Role</dt><dd>Product Designer</dd>
      <dt>Headcount</dt><dd>1</dd>
      <dt>Manager</dt><dd>Morgan Lee</dd>
    </dl>
    <p className="choice"><span className="check">✓</span>Approve these exact terms</p>
    <span className="engraved-button">Record decision</span>
  </figure>
}

export function HistoryDrawing() {
  return <figure className="plank drawing" role="img" aria-label="A stage history: Phone screen, Oct 14, Morgan Lee, Strong portfolio; Panel interview, Oct 21, Morgan Lee, Clear case studies.">
    <ol className="timeline">
      <li><strong>Phone screen</strong><span>Oct 14 · Morgan Lee · Strong portfolio</span></li>
      <li><strong>Panel interview</strong><span>Oct 21 · Morgan Lee · Clear case studies</span></li>
    </ol>
  </figure>
}

export function MoveInDrawing() {
  return <figure className="plank drawing" role="img" aria-label="Preview of workable-export.zip: 1,204 records read, 1,180 to import, 24 set aside. Commit this exact preview.">
    <p className="plank-title with-icon"><FileIcon /><span>Preview of <span className="nowrap">workable-export.zip</span></span></p>
    <p className="plank-row">1,204&nbsp;records&nbsp;read · 1,180&nbsp;to&nbsp;import · 24&nbsp;set&nbsp;aside</p>
    <span className="engraved-button">Commit this exact preview</span>
  </figure>
}

function FileIcon() {
  return <svg className="icon" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M8 4h11l6 6v18H8z" /><path d="M19 4v6h6M12 16h9M12 20h9M12 24h6" /></svg>
}
