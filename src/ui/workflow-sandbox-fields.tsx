import type { PageProps } from './app'
import { FieldSchemaEditor, isFieldAdmin } from './fields'
import { HiringViewEditor } from './hiring-views'
import type { D } from './shared'

export function SandboxFields({ box, w, mutate }: { box: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const config = box.config
  return <section aria-label="Sandbox fields and team views"><h3>Trial fields and team views</h3>
    <p>Changes affect this isolated configuration only. Preview required-stage gaps, field scope and saved-view matches before deploying the exact reviewed version. Live field values remain unchanged.</p>
    <FieldSchemaEditor fields={config.customSchema ?? []} stages={config.stages} admin={isFieldAdmin(w)} save={fields => mutate('sandbox-edit', { id: box.id, edits: [{ op: 'field-schema', input: { fields } }] })} />
    <HiringViewEditor views={config.hiringViews ?? []} fields={config.customSchema ?? []} save={views => mutate('sandbox-edit', { id: box.id, edits: [{ op: 'hiring-view', input: { views } }] })} />
  </section>
}
