import { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import { now } from '../core/types'
import { FREE_BOARDS, feedEntries, renderFreeFeed, type FreeBoard } from '../distribution/free-feeds'

export const freeFeeds = new Hono<{ Bindings: Bindings }>()
freeFeeds.get('/:file', async c => {
  const board = c.req.param('file').replace(/\.xml$/, '') as FreeBoard
  if (c.req.param('file') !== board + '.xml' || !FREE_BOARDS.includes(board)) return c.notFound()
  const s = await load(c.env.DB), entries = await feedEntries(s, board)
  const xml = await renderFreeFeed(s, board, new URL(c.req.url).origin, entries)
  // A real served-entry receipt supports the honest workspace state, and save fences the public projection against concurrent changes.
  if (entries.length) {
    const business = s.get('business', 'main')
    s.put('business', 'main', { ...business, freeFeedServed: { ...business.freeFeedServed, [board]: { at: now(), entries: entries.map(e => ({ id: e.id, version: e.config.version, source: e.source })) } } })
    await save(c.env.DB, s, null)
  }
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff' } })
})
