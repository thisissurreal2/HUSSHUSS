import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('HUSHHUSS render error', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', gap: 12, padding: 24, background: '#101216', color: '#e9e8e1', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ margin: 0 }}>HUSHHUSS couldn’t open this screen.</h1>
          <p style={{ margin: 0, color: '#a5a9b0' }}>Your saved data has not been cleared. Reload the app to try again.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 48, padding: '0 18px', border: '1px solid #36e5ff', background: '#171a20', color: '#36e5ff', font: 'inherit', cursor: 'pointer' }}>
            Reload HUSHHUSS
          </button>
        </main>
      )
    }

    return this.props.children
  }
}
