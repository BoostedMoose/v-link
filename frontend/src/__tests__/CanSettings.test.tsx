/**
 * Unit tests for CanSettings component.
 *
 * Renders the component in jsdom with a mocked socket and seeded CAN store,
 * then asserts on rendered content and the remaining toggle interaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { theme } from '@/theme/Theme';
import { CAN } from '@/store/Store';

// vi.mock is hoisted above variable declarations, so mockEmit must be defined
// with vi.hoisted() to be accessible inside the factory.
const { mockEmit } = vi.hoisted(() => ({ mockEmit: vi.fn() }));

vi.mock('@/socket/Namespaces', () => ({
  useNamespaces: () => ({
    can: { emit: mockEmit },
  }),
}));

// Import component after mock is set up
import CanSettings from '@/app/pages/settings/CanSettings';

const MOCK_CAN_CONFIG = {
  type: 'data',
  name: 'can',
  interfaces: [
    {
      enabled: true,
      channel: 'can2',
      bitrate: 500000,
      bustype: 'socketcan',
      is_extended: true,
      wait_for_ecu: false,
    },
  ],
  sensors: {
    boost: {
      label: 'Boost',
      unit: 'Bar',
      req_id: '0x000FFFFE',
      rep_id: '0x00400021',
      priority: 1,
      enabled: true,
      interface: 'can2',
      parameter: ['0x12', '0x9D'],
    },
    rpm: {
      label: 'RPM',
      unit: 'rpm',
      req_id: '0x000FFFFE',
      rep_id: '0x00400021',
      priority: 1,
      enabled: false,
      interface: 'can2',
      parameter: ['0x10', '0x1D'],
    },
    coolant: {
      label: 'Coolant',
      unit: '°C',
      req_id: '0x000FFFFE',
      rep_id: '0x00400022',
      priority: 2,
      enabled: true,
      interface: 'can2',
      parameter: ['0x10', '0xD8'],
    },
  },
  signal_sensors: [
    {
      key: 'reverse',
      label: 'Reverse Gear',
      interface: 'can2',
      enabled: false,
      can_id: '0x00000000',
      byte_index: 0,
      bit_index: 0,
      invert: false,
    },
  ],
};

const canStore = CAN as any;

const renderComponent = () =>
  render(
    <ThemeProvider theme={theme}>
      <CanSettings />
    </ThemeProvider>
  );

describe('CanSettings', () => {
  beforeEach(() => {
    mockEmit.mockClear();
    canStore.setState((s: any) => ({ ...s, settings: structuredClone(MOCK_CAN_CONFIG) }));
  });

  it('renders the current section headers', () => {
    renderComponent();
    expect(screen.getByText('Diagnostic')).toBeInTheDocument();
    expect(screen.getByText('Signals')).toBeInTheDocument();
  });

  it('renders all sensor labels in the flat list (at least once each)', () => {
    renderComponent();
    expect(screen.getAllByText(/Boost/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/RPM/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Coolant/).length).toBeGreaterThan(0);
  });

  it('renders signal sensor label', () => {
    renderComponent();
    expect(screen.getAllByText('Reverse Gear').length).toBeGreaterThan(0);
  });

  it('shows enabled sensor toggle as checked', () => {
    renderComponent();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
  });

  it('shows disabled sensor toggle as unchecked', () => {
    canStore.setState((s: any) => ({
      ...s,
      settings: {
        ...MOCK_CAN_CONFIG,
        sensors: {
          ...MOCK_CAN_CONFIG.sensors,
          rpm: { ...MOCK_CAN_CONFIG.sensors.rpm, enabled: false },
        },
      },
    }));
    renderComponent();
    const rpmToggle = screen.getAllByRole('checkbox').find((checkbox) => checkbox.closest('tr')?.textContent?.includes('RPM'));
    expect(rpmToggle).not.toBeChecked();
  });

  it('renders diagnostic table headers', () => {
    renderComponent();
    expect(screen.getAllByText('NAME')).toHaveLength(2);
    expect(screen.getByText('UNIT')).toBeInTheDocument();
    expect(screen.getByText('PRIO')).toBeInTheDocument();
  });

  it('renders signal table headers', () => {
    renderComponent();
    expect(screen.getByText('INTERFACE')).toBeInTheDocument();
    expect(screen.getByText('CAN ID')).toBeInTheDocument();
    expect(screen.getByText('BYTE')).toBeInTheDocument();
    expect(screen.getByText('FIELD')).toBeInTheDocument();
  });

  it('Diagnostic section is open by default', () => {
    renderComponent();
    expect(screen.getAllByText(/Boost/).length).toBeGreaterThan(0);
  });

  it('renders the sensor and signal toggles', () => {
    renderComponent();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(1);
  });

  it('renders the CAN settings content', () => {
    renderComponent();
    expect(screen.getByText('Diagnostic')).toBeInTheDocument();
  });

  it('sensor toggles update the CAN settings store', () => {
    renderComponent();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(canStore.getState().settings.sensors.boost.enabled).toBe(false);
  });

  it('does not emit save events when rendering status-only sensor rows', () => {
    renderComponent();
    expect(mockEmit).not.toHaveBeenCalledWith('save', expect.anything());
  });

  it('shows fallback message when CAN settings are not available', () => {
    canStore.setState((s: any) => ({ ...s, settings: {} }));
    renderComponent();
    expect(screen.getByText('CAN settings not available.')).toBeInTheDocument();
  });
});
