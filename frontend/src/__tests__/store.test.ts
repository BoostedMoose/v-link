/**
 * Unit tests for Zustand stores (Store.ts).
 *
 * These run in jsdom without any React rendering — pure store state operations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { APP, CAN, DATA } from '@/store/Store';

const appStore = APP as any;
const canStore = CAN as any;
const dataStore = DATA as any;

// APP store
describe('APP store', () => {
  beforeEach(() => {
    appStore.setState((s: any) => ({
      ...s,
      system: {
        ...s.system,
        ignState: true,
        canState: false,
        startedUp: false,
        configLoaded: false,
        initialized: false,
      },
      keyStroke: '',
    }));
  });

  it('has correct initial system defaults', () => {
    const { system } = appStore.getState();
    expect(system.ignState).toBe(true);
    expect(system.startedUp).toBe(false);
    expect(system.configLoaded).toBe(false);
  });

  it('update() merges partial state via immer', () => {
    const systemVersion = appStore.getState().system.version;
    appStore.getState().update((state: any) => {
      state.system.version = systemVersion
      state.system.ignState = false;
      state.system.startedUp = true;
    });
    const { system } = appStore.getState();
    expect(system.ignState).toBe(false);
    expect(system.startedUp).toBe(true);
  });

  it('update() does not clobber unrelated state', () => {
    const systemVersion = appStore.getState().system.version;
    appStore.getState().update((state: any) => {
      state.system.canState = true;
    });
    expect(appStore.getState().system.version).toBe(systemVersion);
  });

  it('setKeyStroke() sets the keystroke value', () => {
    appStore.getState().setKeyStroke('ArrowUp');
    expect(appStore.getState().keyStroke).toBe('ArrowUp');
  });

  it('setKeyStroke() clears the keystroke asynchronously', async () => {
    appStore.getState().setKeyStroke('ArrowDown');
    expect(appStore.getState().keyStroke).toBe('ArrowDown');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(appStore.getState().keyStroke).toBe('');
  });
});

// CAN store
describe('CAN store', () => {
  beforeEach(() => {
    canStore.setState((s: any) => ({
      ...s,
      system: { state: false },
    }));
  });

  it('initializes with system.state = false', () => {
    expect(canStore.getState().system.state).toBe(false);
  });

  it('update() can set state to true', () => {
    canStore.getState().update((state: any) => {
      state.system.state = true;
    });
    expect(canStore.getState().system.state).toBe(true);
  });
});

// DATA store
describe('DATA store', () => {
  beforeEach(() => {
    dataStore.setState((s: any) => ({ ...s, data: {}, timestamp: '' }));
  });

  it('initializes with an empty data object', () => {
    expect(dataStore.getState().data).toEqual({});
  });

  it('updateData() merges new values into data', () => {
    dataStore.getState().updateData({ rpm: 1500, boost: 1.2 });
    const { data } = dataStore.getState();
    expect(data.rpm).toBe(1500);
    expect(data.boost).toBe(1.2);
  });

  it('updateData() preserves existing keys when adding new ones', () => {
    dataStore.getState().updateData({ rpm: 2000 });
    dataStore.getState().updateData({ boost: 0.9 });
    const { data } = dataStore.getState();
    expect(data.rpm).toBe(2000);
    expect(data.boost).toBe(0.9);
  });

  it('updateData() overwrites an existing key', () => {
    dataStore.getState().updateData({ rpm: 1000 });
    dataStore.getState().updateData({ rpm: 3500 });
    expect(dataStore.getState().data.rpm).toBe(3500);
  });

  it('updateTimestamp() replaces the scalar timestamp', () => {
    dataStore.getState().updateTimestamp('1234,567');
    expect(dataStore.getState().timestamp).toBe('1234,567');
  });
});
