// @vitest-environment jsdom
/**
 * Verifies the toolbar's tool buttons and the new "more shapes" dropdown: it
 * opens, selects an extra geo shape, closes after selection, and highlights
 * while one of its shapes is the active tool.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Toolbar } from './Toolbar'

afterEach(cleanup)

describe('Toolbar', () => {
  it('selects a base tool when its button is clicked', () => {
    const onToolChange = vi.fn()
    const { getByTestId } = render(<Toolbar activeTool="select" onToolChange={onToolChange} />)
    fireEvent.click(getByTestId('tool-rect'))
    expect(onToolChange).toHaveBeenCalledWith('rect')
  })

  it('opens the more-shapes dropdown, selects an extra shape, then closes', () => {
    const onToolChange = vi.fn()
    const { getByTestId, queryByTestId } = render(<Toolbar activeTool="select" onToolChange={onToolChange} />)

    expect(queryByTestId('more-shapes-menu')).toBeNull()
    fireEvent.click(getByTestId('tool-more-shapes'))
    expect(getByTestId('more-shapes-menu')).toBeTruthy()

    fireEvent.click(getByTestId('tool-star'))
    expect(onToolChange).toHaveBeenCalledWith('star')
    // Menu closes after a selection.
    expect(queryByTestId('more-shapes-menu')).toBeNull()
  })

  it('highlights the dropdown button when one of its shapes is the active tool', () => {
    const { getByTestId } = render(<Toolbar activeTool="hexagon" onToolChange={() => {}} />)
    expect(getByTestId('tool-more-shapes').className).toContain('bg-primary')
  })

  it('does not highlight the dropdown for an unrelated active tool', () => {
    const { getByTestId } = render(<Toolbar activeTool="select" onToolChange={() => {}} />)
    expect(getByTestId('tool-more-shapes').className).not.toContain('bg-primary')
  })
})
