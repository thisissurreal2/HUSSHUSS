import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let AppErrorBoundary

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  AppErrorBoundary = (await vite.ssrLoadModule('/src/AppErrorBoundary.tsx')).AppErrorBoundary
})

after(async () => { await vite?.close() })

test('render failures switch the boundary to its recovery screen without exposing details', () => {
  assert.deepEqual(AppErrorBoundary.getDerivedStateFromError(new Error('private stack detail')), { hasError: true })
  const boundary = new AppErrorBoundary({ children: null })
  boundary.state = { hasError: true }
  const markup = boundary.render().props.children.map((child) => child?.props?.children ?? '').join(' ')
  assert.match(markup, /couldn’t open this screen/i)
  assert.match(markup, /saved data has not been cleared/i)
  assert.doesNotMatch(markup, /private stack detail/)
})

test('error fallback reload button requests a page reload', () => {
  const boundary = new AppErrorBoundary({ children: null })
  boundary.state = { hasError: true }
  const button = boundary.render().props.children[2]
  let reloaded = false
  const previousWindow = globalThis.window
  globalThis.window = { location: { reload: () => { reloaded = true } } }
  try {
    button.props.onClick()
    assert.equal(reloaded, true)
  } finally {
    globalThis.window = previousWindow
  }
})
