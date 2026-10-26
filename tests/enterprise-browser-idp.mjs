/** Fake only the external identity document, including navigation redirects. */
export async function identityDocument(page, address, html) {
  const cdp = await page.context().newCDPSession(page)
  const expected = new URL(address)
  let resolve, reject, deadline
  const reached = new Promise((yes, no) => {
    resolve = () => { clearTimeout(deadline); yes() }
    reject = error => { clearTimeout(deadline); no(error) }
    deadline = setTimeout(() => reject(new Error('Identity document navigation did not reach the synthetic provider')), 10000)
  })
  cdp.on('Fetch.requestPaused', async event => {
    try {
      const url = new URL(event.request.url)
      if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw new Error('Unexpected identity document request')
      await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(await html(url)).toString('base64') })
      resolve()
    } catch (error) { reject(error) }
  })
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: address + '*', requestStage: 'Request' }] })
  return { reached }
}
