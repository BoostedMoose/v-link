import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Display from './Display'

const mocks = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock('@/socket/Namespaces', () => ({ useNamespaces: () => ({
  log: { emit: vi.fn() },
  sys: {
    emit: mocks.emit,
  },
}) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('requests open explicitly on each browser startup, including when settings load late', () => {
  const result = render(<Display autoOpen={false} />)
  expect(mocks.emit).not.toHaveBeenCalled()
  result.rerender(<Display autoOpen />)
  result.unmount()
  render(<Display autoOpen />)
  expect(mocks.emit.mock.calls).toEqual([
    ['systemTask', 'rti_open'], ['systemTask', 'rti_open'],
  ])
})

it('does not auto-open when disabled', () => {
  render(<Display autoOpen={false} />)
  expect(mocks.emit).not.toHaveBeenCalled()
})
