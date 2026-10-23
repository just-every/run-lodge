import { useId, type ButtonHTMLAttributes } from 'react'

/** An icon control with its name available on hover and keyboard focus. */
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  const id = useId()
  return <span className="icon-control"><button {...props} className="icon-button" aria-label={label} aria-describedby={id}>{children}</button><span id={id} role="tooltip">{label}</span></span>
}
