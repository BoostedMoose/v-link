import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'styled-components'

import { theme } from '@/theme/Theme'
import { ADC, APP } from '@/store/Store'
import { RadialGauge } from './RadialGauge'
import ErrorBoundary from './ErrorBoundary'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('renders a gauge whose sensor type is set after the first render', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  APP.setState((state) => ({ ...state, modules: { app: APP, adc: ADC } }))
  ADC.setState((state) => ({ ...state, settings: { sensors: { oilt: { label: 'Oil Temp' } } } }))
  const gauge = (type: string) => <ThemeProvider theme={theme}><RadialGauge sensor="oilt" type={type} /></ThemeProvider>

  const result = render(gauge(''))
  expect(() => result.rerender(gauge('adc'))).not.toThrow()
  vi.unstubAllGlobals()
})

it('shows a fallback and reports the error instead of unmounting the app', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const silence = (event: ErrorEvent) => event.preventDefault()
  window.addEventListener('error', silence)
  const onError = vi.fn()
  const Broken = () => { throw new Error('boom') }

  render(<ThemeProvider theme={theme}><ErrorBoundary onError={onError}><Broken /></ErrorBoundary></ThemeProvider>)

  expect(screen.getByText('boom')).toBeInTheDocument()
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), expect.any(String))
  window.removeEventListener('error', silence)
})
