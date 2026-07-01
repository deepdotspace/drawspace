/**
 * App — global providers + full-screen shell.
 *
 * Drawspace is a single-surface app: the canvas owns the whole viewport, the
 * way Excalidraw does. There is no top navigation, no marketing pages — every
 * control floats over the canvas itself. This shell just mounts the provider
 * stack and hands the viewport to the route outlet.
 */

import { Suspense, type ReactNode } from 'react'
import { Outlet, useRouteError } from 'react-router-dom'
import { DeepSpaceAuthProvider, useAuthStatus } from 'deepspace'
import { RecordProvider, RecordScope } from 'deepspace'
import { ErrorScreen, ToastProvider } from '../components/ui'
import { APP_NAME, SCOPE_ID } from '../constants'
import { schemas } from '../schemas'

export default function App() {
  return (
    <ToastProvider>
      <DeepSpaceAuthProvider>
        <AuthBoot>
          {/* data-testid="app-root" is the canonical "app shell mounted" hook
              every test relies on. Don't rename without updating tests. */}
          <div
            data-testid="app-root"
            className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground"
          >
            <Suspense fallback={<BootScreen />}>
              <Outlet />
            </Suspense>
          </div>
        </AuthBoot>
      </DeepSpaceAuthProvider>
    </ToastProvider>
  )
}

/**
 * Root error boundary. Generouted wires a `_app` `Catch` export to the root
 * route's errorElement, so any render-time crash in a page lands here instead
 * of React Router's raw minified screen.
 */
export function Catch() {
  const error = useRouteError()
  return <ErrorScreen error={error} />
}

function BootScreen() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}

/** Waits for auth to resolve, then mounts the data layer. */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuthStatus()

  if (!isLoaded) return <BootScreen />

  return (
    <RecordProvider allowAnonymous>
      <RecordScope roomId={SCOPE_ID} schemas={schemas} appId={APP_NAME}>
        {children}
      </RecordScope>
    </RecordProvider>
  )
}
