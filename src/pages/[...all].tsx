import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <h1 className="font-hand text-6xl font-bold text-foreground">404</h1>
      <p className="mt-2 text-muted-foreground">This page wandered off the canvas.</p>
      <Link
        to="/"
        className="mt-6 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Back to the canvas
      </Link>
    </div>
  )
}
