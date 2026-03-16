/**
 * Tests for socket event handling logic.
 *
 * Uses socket.io-mock to simulate server to client events without a real backend.
 * We test the handler functions that would be wired up in Socket.tsx, not the
 * component itself — keeping these as pure unit tests with no React rendering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import SocketMock from 'socket.io-mock';
import { APP } from '@/store/Store';

const appStore = APP as any;

/** Simulate the ignition event handler used in Socket.tsx */
function bindIgnitionHandler(socket: SocketMock) {
  socket.socketClient.on('ign', (ignStatus: any) => {
    appStore.getState().update((state: any) => {
      state.system.ignState = ignStatus as boolean;
    });
  });
}

type ModuleStateKey = 'canState' | 'adcState' | 'swcState' | 'rtiState';

/** Simulate the module state handler for a given store */
function bindModuleStateHandler(socket: SocketMock, key: ModuleStateKey) {
  socket.socketClient.on('state', (value: any) => {
    appStore.getState().update((state: any) => {
      state.system[key] = value as boolean;
    });
  });
}

describe('ignition socket event to app store', () => {
  let mockSocket: InstanceType<typeof SocketMock>;

  beforeEach(() => {
    mockSocket = new SocketMock();
    appStore.setState((s: any) => ({ ...s, system: { ...s.system, ignState: true } }));
    bindIgnitionHandler(mockSocket);
  });

  it('ign=false sets APP.system.ignState to false', () => {
    mockSocket.emit('ign', false);
    expect(appStore.getState().system.ignState).toBe(false);
  });

  it('ign=true restores APP.system.ignState to true', () => {
    appStore.getState().update((s: any) => { s.system.ignState = false; });
    mockSocket.emit('ign', true);
    expect(appStore.getState().system.ignState).toBe(true);
  });
});

describe('module state socket event to app store', () => {
  let mockSocket: InstanceType<typeof SocketMock>;

  beforeEach(() => {
    mockSocket = new SocketMock();
    appStore.setState((s: any) => ({ ...s, system: { ...s.system, canState: false } }));
    bindModuleStateHandler(mockSocket, 'canState');
  });

  it('state=true sets APP.system.canState to true', () => {
    mockSocket.emit('state', true);
    expect(appStore.getState().system.canState).toBe(true);
  });

  it('state=false keeps APP.system.canState false', () => {
    mockSocket.emit('state', false);
    expect(appStore.getState().system.canState).toBe(false);
  });
});
