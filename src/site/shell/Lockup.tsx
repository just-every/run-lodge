import { links } from './links'

/** The two-chairs mark and the "Lodge" wordmark in the heading face. */
export function Lockup({ light = false }: { light?: boolean }) {
  return <a className="site-brand" href={links.home}><img src={light ? '/brand/mark-light.svg' : '/brand/mark.svg'} alt="" width="52" height="34" /><span>Lodge</span></a>
}
