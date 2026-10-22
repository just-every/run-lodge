// Applicants choose whether this device keeps a draft. Nothing is sent until submission.
for (const tools of document.querySelectorAll('[data-careers-draft]')) {
  const form = tools.closest('main').querySelector('form[enctype="multipart/form-data"]')
  if (!form) continue
  tools.hidden = false
  const status = tools.querySelector('[data-draft-status]')
  const key = 'lodge-application-draft:' + new URL(form.action).pathname
  const allowed = control => control.name && !control.closest('[data-draft-private]') && !['hidden', 'file', 'checkbox', 'radio', 'submit', 'button'].includes(control.type) && !['accommodation', 'monitoring'].includes(control.name)
  const controls = [...form.elements].filter(allowed)
  tools.querySelector('[data-draft-save]').onclick = () => {
    try {
      const values = controls.map(control => [control.name, control.multiple ? [...control.selectedOptions].map(o => o.value) : control.value])
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), values }))
      status.textContent = status.dataset.saved
    } catch { status.textContent = status.dataset.unavailable }
  }
  tools.querySelector('[data-draft-resume]').onclick = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(key))
      if (!draft || !Array.isArray(draft.values) || !Number.isFinite(draft.savedAt) || Date.now() - draft.savedAt > 7 * 86400000) { localStorage.removeItem(key); status.textContent = status.dataset.unavailable; return }
      const values = new Map(draft.values)
      for (const control of controls) {
        const value = values.get(control.name)
        if (control.multiple && Array.isArray(value)) for (const option of control.options) option.selected = value.includes(option.value)
        else if (typeof value === 'string') control.value = value
      }
      status.textContent = status.dataset.resumed
    } catch { status.textContent = status.dataset.unavailable }
  }
  tools.querySelector('[data-draft-clear]').onclick = () => {
    try { localStorage.removeItem(key); status.textContent = status.dataset.cleared } catch { status.textContent = status.dataset.unavailable }
  }
}
