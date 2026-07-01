/**
 * Index — the whole app. Opening Drawspace drops you straight onto a canvas,
 * like Excalidraw. Sign-in is gated by <AuthGate>; once in, the workspace
 * resolves (or creates) a board and renders the full-screen editor.
 */

import { AuthGate } from 'deepspace'
import { CanvasWorkspace } from '../components/canvas/CanvasWorkspace'

export default function Index() {
  return (
    <AuthGate>
      <CanvasWorkspace />
    </AuthGate>
  )
}
