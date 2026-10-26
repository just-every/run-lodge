// Applicants choose whether this device keeps a draft. Nothing is sent until submission.
// The draft holds typed and chosen answers and the chosen files, in one entry on this device.
const PRIVATE = ['consent', 'talentPool', 'accommodation', 'monitoring']
const file = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] ?? ''); r.onerror = () => reject(r.error); r.readAsDataURL(blob) })
const bytes = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0))
for (const tools of document.querySelectorAll('[data-careers-draft]')) {
  const form = tools.closest('main').querySelector('form[enctype="multipart/form-data"]')
  if (!form) continue
  tools.hidden = false
  const status = tools.querySelector('[data-draft-status]')
  const key = 'lodge-application-draft:' + new URL(form.action).pathname
  const allowed = control => control.name && !control.closest('[data-draft-private]') && !['hidden', 'submit', 'button'].includes(control.type) && !PRIVATE.includes(control.name)
  const controls = [...form.elements].filter(allowed)
  const text = control => [control.closest('label')?.textContent, control.closest('fieldset')?.querySelector('legend')?.textContent]
  // A draft binds the employer form and versioned hidden fields; a fresh request nonce does not change that form.
  const schema = JSON.stringify([tools.dataset.version, ...controls.map(control => [control.name, control.type, control.required, ['radio', 'checkbox'].includes(control.type) ? control.value : null, ...text(control)]), ...[...form.querySelectorAll('input[type=hidden]:not([data-draft-volatile])')].map(control => [control.name, control.value])])
  const groups = [...new Set(controls.map(control => control.name))]
  const read = async name => {
    const group = controls.filter(control => control.name === name), first = group[0]
    if (first.type === 'file') return { files: await Promise.all([...first.files].map(async f => ({ name: f.name, type: f.type, base64: await file(f) }))) }
    if (first.type === 'radio') return { value: group.find(control => control.checked)?.value ?? '' }
    if (first.type === 'checkbox') return { values: group.filter(control => control.checked).map(control => control.value) }
    if (first.multiple) return { values: [...first.selectedOptions].map(o => o.value) }
    return { value: first.value }
  }
  const apply = (name, saved) => {
    const group = controls.filter(control => control.name === name), first = group[0]
    if (first.type === 'file') {
      if (!Array.isArray(saved.files)) return
      const list = new DataTransfer()
      for (const f of saved.files) list.items.add(new File([bytes(f.base64)], f.name, { type: f.type }))
      first.files = list.files
    } else if (first.type === 'radio') for (const control of group) control.checked = control.value === saved.value
    else if (first.type === 'checkbox' || first.multiple) {
      if (!Array.isArray(saved.values)) return
      if (first.multiple) for (const option of first.options) option.selected = saved.values.includes(option.value)
      else for (const control of group) control.checked = saved.values.includes(control.value)
    } else if (typeof saved.value === 'string') first.value = saved.value
  }
  tools.querySelector('[data-draft-save]').onclick = async () => {
    try {
      const values = await Promise.all(groups.map(async name => [name, await read(name)]))
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), schema, values }))
      status.textContent = status.dataset.saved
    } catch { localStorage.removeItem(key); status.textContent = status.dataset.unavailable }
  }
  tools.querySelector('[data-draft-resume]').onclick = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(key))
      if (!draft || !Array.isArray(draft.values) || !Number.isFinite(draft.savedAt) || draft.schema !== schema || Date.now() - draft.savedAt > 86400000) { localStorage.removeItem(key); status.textContent = status.dataset.unavailable; return }
      const values = new Map(draft.values)
      for (const name of groups) if (values.has(name)) apply(name, values.get(name))
      status.textContent = status.dataset.resumed
    } catch { status.textContent = status.dataset.unavailable }
  }
  tools.querySelector('[data-draft-clear]').onclick = () => {
    try { localStorage.removeItem(key); status.textContent = status.dataset.cleared } catch { status.textContent = status.dataset.unavailable }
  }
}
