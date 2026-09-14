import { useState, useEffect, useRef } from 'react';
import { APP, modules } from '@/store/Store';
import { useNamespaces } from './Namespaces';


export const Socket = () => {
  const [appConfigLoaded, setAppConfigLoaded] = useState(false);
  const [activeModules, setActiveModules] = useState<Record<string, unknown>>({});
  const [loadedModules, setLoadedModules] = useState(0);
  const loadedModuleSet = useRef(new Set());

  // Get sockets using the global function
  const socket = useNamespaces();

  // Initialize all Zustand stores (we'll filter active ones later)
  const allStores = Object.fromEntries(
    Object.entries(modules).map(([key, useStore]) => [key, (useStore as () => { update: (updater: (state: any) => void) => void })()])
  ) as Record<string, { update: (updater: (state: any) => void) => void }>;

  // Reusable event handlers
  const handleSettings = (module: string) => (data: unknown) => {
    if (data) {
      if (module === 'app') {
        // Special handling for app settings to determine active modules
        setAppConfigLoaded(true);

        // Determine which modules should be active based on app config
        const moduleConfig = (data as any)?.constants?.modules || {};
        const modulesToActivate: Record<string, unknown> = { app: APP }; // Always include app

        Object.entries(moduleConfig).forEach(([moduleName, isEnabled]) => {
          if (isEnabled && (modules as Record<string, unknown>)[moduleName]) {
            modulesToActivate[moduleName] = (modules as Record<string, unknown>)[moduleName];
          }
        });

        setActiveModules(modulesToActivate);
      }

      // Only count as loaded if this module is supposed to be active
      if (module === 'app' || (activeModules[module])) {
        loadedModuleSet.current.add(module);
        setLoadedModules(loadedModuleSet.current.size);
      }

      allStores[module].update((state) => {
        state.settings = data;
      });
    }
  };

  const handleIgnition = (ignStatus: boolean) => {
    allStores['app'].update((state) => {
      state.system.ignState = ignStatus;
    });
  };

  const handleState = (module: string) => (data: unknown) => {
    allStores['app'].update((state) => {
      state.system[`${module}State`] = data;
    });
  };

  const handleConnect = (socketName: string) => () => {
    socket.log.emit('info', `${socketName} socket connected`);
  };

  const handleDisconnect = (socketName: string) => (reason: string) => {
    socket.log.emit('info', `${socketName} socket disconnected: ${reason}`);
  };

  const handleError = (socketName: string) => (error: unknown) => {
    socket.log.emit('error', `${socketName} socket connection error: ${error}`);
  };


  const handleReverse = () => (reverseStatus: boolean) => {
    socket.log.emit('info', `Reverse: ${reverseStatus}`);
    allStores['app'].update((state: any) => {
      state.system.reverse = reverseStatus;
    });
  };

  const handleRearcamCameraStatus = (payload: { on: boolean; error?: string }) => {
    allStores['app'].update((state: any) => {
      state.system.rearcam = !!payload.on;
      state.system.rearcamError = payload.error || null;
    });
  };

  const handleRearcamState = (on: boolean) => {
    allStores['app'].update((state: any) => {
      state.system.rearcam = !!on;
    });
  };

  /* Step 1: Load App Settings First */
  useEffect(() => {
    const appSocket = socket.app;
    if (!appSocket) return;

    const onSettings = handleSettings('app');
    const onConnect = handleConnect('app');
    const onDisconnect = handleDisconnect('app');
    const onError = handleError('app');

    appSocket.on('settings', onSettings);
    appSocket.on('connect', onConnect);
    appSocket.on('disconnect', onDisconnect);
    appSocket.on('connect_error', onError);

    // Request app settings
    appSocket.emit('ping');
    appSocket.emit('load');

    // Cleanup function for app listeners
    return () => {
      appSocket.off('settings', onSettings);
      appSocket.off('connect', onConnect);
      appSocket.off('disconnect', onDisconnect);
      appSocket.off('connect_error', onError);
    };
  }, [socket.app]);

  /* Step 2: Setup Other Module Listeners Based on App Config */
  useEffect(() => {
    if (!appConfigLoaded || Object.keys(activeModules).length === 0) return;

    const cleanupListeners: Array<() => void> = [];

    // Setup listeners for all active modules (except app, which is already set up)
    Object.keys(activeModules).forEach(module => {
      if (module === 'app') return;

      const moduleSocket = socket[module];
      if (!moduleSocket) return;

      const onState = handleState(module);
      const onSettings = handleSettings(module);
      const onConnect = handleConnect(module);
      const onDisconnect = handleDisconnect(module);
      const onError = handleError(module);

      moduleSocket.on('state', onState);
      moduleSocket.on('settings', onSettings);
      moduleSocket.on('connect', onConnect);
      moduleSocket.on('disconnect', onDisconnect);
      moduleSocket.on('connect_error', onError);

      cleanupListeners.push(() => {
        moduleSocket.off('state', onState);
        moduleSocket.off('settings', onSettings);
        moduleSocket.off('connect', onConnect);
        moduleSocket.off('disconnect', onDisconnect);
        moduleSocket.off('connect_error', onError);
      });

      // Initial requests
      moduleSocket.emit('ping');
      moduleSocket.emit('load');
    });

    // Setup system listeners
    const sysSocket = socket.sys;
    if (sysSocket) {
      const onConnect = handleConnect('sys');
      const onDisconnect = handleDisconnect('sys');
      const onError = handleError('sys');
      const onReverse = handleReverse();

      sysSocket.on('ign', handleIgnition);
      sysSocket.on('reverse', onReverse);
      sysSocket.on('connect', onConnect);
      sysSocket.on('disconnect', onDisconnect);
      sysSocket.on('connect_error', onError);

      cleanupListeners.push(() => {
        sysSocket.off('ign', handleIgnition);
        sysSocket.off('reverse', onReverse);
        sysSocket.off('connect', onConnect);
        sysSocket.off('disconnect', onDisconnect);
        sysSocket.off('connect_error', onError);
      });

      sysSocket.emit('systemTask', 'ign');
      sysSocket.emit('systemTask', 'reverse');
    }

    // Setup log socket listeners if it exists
    const logSocket = socket.log;
    if (logSocket) {
      const onConnect = handleConnect('log');
      const onDisconnect = handleDisconnect('log');
      const onError = handleError('log');

      logSocket.on('connect', onConnect);
      logSocket.on('disconnect', onDisconnect);
      logSocket.on('connect_error', onError);

      cleanupListeners.push(() => {
        logSocket.off('connect', onConnect);
        logSocket.off('disconnect', onDisconnect);
        logSocket.off('connect_error', onError);
      });
    }

    // Setup cam socket listeners if it exists
    const camSocket = socket.cam;
    if (camSocket) {
      camSocket.on('camera/status', handleRearcamCameraStatus);
      camSocket.on('state', handleRearcamState);

      cleanupListeners.push(() => {
        camSocket.off('camera/status', handleRearcamCameraStatus);
        camSocket.off('state', handleRearcamState);
      });

      camSocket.emit('status');
    }

    // Cleanup function for module listeners
    return () => {
      cleanupListeners.forEach(cleanup => cleanup());
    };
  }, [appConfigLoaded, activeModules, socket]);

  /* Step 3: Initialize App When All Active Modules Are Loaded */
  useEffect(() => {
    if (!appConfigLoaded) return;
    
    const totalActiveModules = Object.keys(activeModules).length;
    
    if (loadedModules === totalActiveModules) {
      socket.log.emit('info', `Frontend ready with ${totalActiveModules} active modules.`);

      allStores['app'].update((state) => {
        state.modules = activeModules; // Use only active modules
        state.system.startedUp = true;
        state.system.view = state.settings?.general?.startPage?.value ?? state.system.view ?? '/';
      });
    }
  }, [loadedModules, appConfigLoaded, activeModules]);

  return null;
};
