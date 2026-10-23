// The full local journey covers both widths; CI runs one width per matrix job.
const selected = process.env.LODGE_BROWSER_WIDTH
if (selected && !['1440', '390'].includes(selected)) throw new Error('Unknown LODGE_BROWSER_WIDTH: ' + selected)
export const browserWidths = selected ? [Number(selected)] : [1440, 390]
