import { links } from './links'

/** The house-outline mark and the name, as on the installed app. */
export function Lockup() {
  return <a className="lockup" href={links.home}><img src="/brand/mark.svg" alt="" width="28" height="28" /><span>Lodge</span></a>
}
