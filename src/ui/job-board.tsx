import { useState } from 'react'
import type { PageProps } from './app'
import { when } from './format'
import { person } from './names'
import { Field, Form, Table, type D } from './shared'

// ATTR-009: the public job board for the employer's own careers page. Admins
// name its token, list the websites that may submit from a browser, and keep
// submit-only keys, each shown once.

const lines = (v: string) => (v ?? '').split(/[\n,]/).map(x => x.trim()).filter(Boolean)

export function JobBoardSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const [shown, setShown] = useState<string>()
  const board: D | null = w.jobBoard
  const base = typeof location === 'undefined' ? '' : location.origin
  const keys = (board?.keys ?? []) as D[]
  const reveal = (result: D) => { setShown(result.key) }
  return <section aria-label="Public job board">
    <h2>Public job board</h2>
    <p className="hint">Your own careers page can list published jobs and send applications through Lodge’s board API (see API.md). Confidential jobs never appear.</p>
    <Form label="Save job board" onSubmit={x => mutate('job-board', { token: x.token, allowedOrigins: lines(x.allowedOrigins) })}>
      <Field label="Board token" name="token" defaultValue={board?.token ?? ''} hint="Part of each board address, such as acme-careers." />
      <Field label="Websites that may submit applications (one per line)" name="allowedOrigins" type="textarea" required={false} defaultValue={(board?.allowedOrigins ?? []).join('\n')} hint="Scheme and host only, such as https://careers.example.com" />
    </Form>
    {board && <>
      <p className="meta">Job list: <code>{`${base}/api/board/v1/${board.token}/jobs`}</code></p>
      <h3>Board keys</h3>
      {shown && <p role="status">Copy this key now; Lodge shows it only once: <code>{shown}</code></p>}
      <Table heads={['Key', 'Created', 'Status', '']} empty="No board keys yet.">{keys.map(k => <tr key={k.id}>
        <td>{k.label} · …{k.last4}</td><td>{when(k.createdAt)} · {person(w, k.createdBy)}</td><td>{k.revokedAt ? `Revoked ${when(k.revokedAt)}` : 'Active'}</td>
        <td>{!k.revokedAt && <><Form label="Rotate" compact onSubmit={async () => reveal(await mutate('rotate-board-key', { id: k.id }))} /><Form label="Revoke" compact onSubmit={() => mutate('revoke-board-key', { id: k.id })} /></>}</td>
      </tr>)}</Table>
      <Form label="Create board key" reset compact onSubmit={async x => reveal(await mutate('board-key', { label: x.label }))}>
        <Field label="Key label" name="label" hint="Where the key is used, such as Website server." />
      </Form>
    </>}
  </section>
}
