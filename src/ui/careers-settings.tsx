import type { PageProps } from './app'
import { Check, Field, Form, fileFrom, readFile, type D } from './shared'

function DomainStatus({ domain }: { domain: D }) {
  return <>
    <dl>
      <div><dt>Hostname</dt><dd><code>{domain.hostname}</code></dd></div>
      <div><dt>Domain verification</dt><dd>{domain.status}</dd></div>
      <div><dt>Provider provisioning</dt><dd>{domain.providerStatus ?? 'Not provisioned'}</dd></div>
      <div><dt>TLS certificate</dt><dd>{domain.tlsStatus ?? 'Not verified'}</dd></div>
    </dl>
    {domain.dns && <><h4>DNS ownership challenge</h4><p>Add this TXT record at your DNS provider, then verify this challenge.</p>
      <dl><div><dt>TXT record name</dt><dd><code>{domain.dns.name}</code></dd></div>
        <div><dt>Record type</dt><dd><code>{domain.dns.type}</code></dd></div>
        <div><dt>TXT value</dt><dd><code>{domain.dns.value}</code></dd></div></dl></>}
    {domain.verificationPath && <p>Verification path: <code>{domain.verificationPath}</code></p>}
    {domain.error && <p role="alert">{domain.error}</p>}
  </>
}

/** Employer settings within the existing workspace shell. Provider state is reported by the server. */
export function CareersSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const careers: D | null = w.careers
  const actor = w.actor
  if (!careers || actor.agent || !(actor.owner || (!actor.roles.includes('agency') && actor.roles.includes('admin')))) return null
  const brand: D = careers.brand ?? {}, domain: D | null = careers.domain
  return <section aria-label="Employer careers site">
    <h2>Employer careers site</h2>
    <p>Your employer introduction, logo and colors appear on the careers list, job and application pages, including the embedded careers page.</p>
    <article className="card" aria-label="Careers branding">
      <h3>Careers branding</h3>
      <Form key={brand.updatedAt ?? 'new-brand'} label="Save careers branding" onSubmit={async (values, form) => {
        const file = fileFrom(form, 'logo')
        if (file && values.removeLogo) throw new Error('Choose either a new logo or removal of the saved logo')
        if (file && file.size > 256 * 1024) throw new Error('Logos may be at most 256 KiB')
        await mutate('careers-brand', { intro: values.intro, primaryColor: values.primaryColor,
          backgroundColor: values.backgroundColor, textColor: values.textColor,
          ...(file ? { logo: await readFile(file) } : values.removeLogo ? { logo: null } : {}) })
      }}>
        <Field label="Employer introduction" name="intro" type="textarea" wide required={false} defaultValue={brand.intro} hint="Plain text shown on each careers and application page." />
        <label>Employer logo (PNG, JPEG or WebP, up to 256 KiB)<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" /><small>Upload an original raster image. SVG and remote image URLs are not supported.</small></label>
        {brand.logo && <><p className="wide">Saved logo: {brand.logo.name}</p><Check name="removeLogo" label="Remove saved employer logo" /></>}
        <Field label="Primary color (#RRGGBB)" name="primaryColor" defaultValue={brand.primaryColor} hint="Used for links and button backgrounds." />
        <Field label="Background color (#RRGGBB)" name="backgroundColor" defaultValue={brand.backgroundColor} hint="Also used for button text." />
        <Field label="Text color (#RRGGBB)" name="textColor" defaultValue={brand.textColor} />
        <p className="hint wide">Text against background and primary against background must each meet WCAG AA contrast of at least 4.5:1. Lodge checks both pairs before saving.</p>
      </Form>
    </article>
    <article className="card" aria-label="Careers custom domain">
      <h3>Custom domain</h3>
      <p>The installation’s <a href="/jobs" target="_blank" rel="noreferrer">/jobs page</a> stays available. DNS ownership verification and provider provisioning are separate from a valid TLS certificate.</p>
      {!careers.setupAvailable && <p role="status">Custom-domain verification and TLS provisioning are unavailable until the installation has a reviewed domain provider setup.</p>}
      {domain && <DomainStatus domain={domain} />}
      {careers.setupAvailable && <>
        <Form label="Create domain challenge" onSubmit={values => mutate('careers-domain-challenge', { hostname: values.hostname })}>
          <Field label="Careers hostname" name="hostname" defaultValue={domain?.hostname} hint="Enter the hostname only, such as careers.example.com. Disconnect the current domain before replacing it; the same hostname keeps its existing challenge." />
        </Form>
        {domain?.generation && domain.status !== 'disconnected' && <>
          <Form label="Verify DNS ownership" compact onSubmit={() => mutate('careers-domain-verify', { generation: domain.generation })} />
          {['verified', 'connecting', 'connected'].includes(domain.status) && <Form label="Connect domain and check TLS" compact onSubmit={() => mutate('careers-domain-connect', { generation: domain.generation })} />}
          <Form label="Disconnect domain" compact onSubmit={() => mutate('careers-domain-disconnect', { generation: domain.generation })} />
        </>}
      </>}
    </article>
  </section>
}
