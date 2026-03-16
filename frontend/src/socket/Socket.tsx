import { useState, useEffect, useRef } from 'react';
import { APP, modules } from '@/store/Store';
import { useNamespaces } from './Namespaces';


export const Socket = () => {
  const [appConfigLoaded, setAppConfigLoaded] = useState(false);
  const [activeModules, setActiveModules] = useState<Record<string, unknown>>({});
  const [loadedModules, setLoadedModules] = useState(0);
  const loadedModuleSet = useRef(new Set());
  const listenersSetup = useRef(false);

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
    if (!socket.app || listenersSetup.current) return;

    // Setup app-specific listeners first
    const setupAppListeners = () => {
      socket.app.on('settings', handleSettings('app'));
      socket.app.on('connect', handleConnect('app'));
      socket.app.on('disconnect', handleDisconnect('app'));
      socket.app.on('connect_error', handleError('app'));

      // Request app settings
      socket.app.emit('ping');
      socket.app.emit('load');
    };

    setupAppListeners();
    listenersSetup.current = true;

    // Cleanup function for app listeners
    return () => {
      if (socket.app) {
        socket.app.off('settings', handleSettings('app'));
        socket.app.off('connect', handleConnect('app'));
        socket.app.off('disconnect', handleDisconnect('app'));
        socket.app.off('connect_error', handleError('app'));
      }
    };
  }, [socket.app]);

  /* Step 2: Setup Other Module Listeners Based on App Config */
  useEffect(() => {
    if (!appConfigLoaded || Object.keys(activeModules).length === 0) return;

    const setupModuleListeners = () => {
      // Setup listeners for all active modules (except app, which is already set up)
      Object.keys(activeModules).forEach(module => {
        if (module === 'app') return; // Skip app as it's already set up
        
        if (socket[module]) {
          // Data listeners
          socket[module].on('state', handleState(module));
          socket[module].on('settings', handleSettings(module));
          
          // Connection listeners
          socket[module].on('connect', handleConnect(module));
          socket[module].on('disconnect', handleDisconnect(module));
          socket[module].on('connect_error', handleError(module));

          // Initial requests
          socket[module].emit('ping');
          socket[module].emit('load');
        }
      });

      // Setup system listeners
      if (socket.sys) {
        socket.sys.on('ign', handleIgnition);
        socket.sys.on('connect', handleConnect('sys'));
        socket.sys.on('disconnect', handleDisconnect('sys'));
        socket.sys.on('connect_error', handleError('sys'));
        
        socket.sys.emit('systemTask', 'ign');
      }

      // Setup log socket listeners if it exists
      if (socket.log) {
        socket.log.on('connect', handleConnect('log'));
        socket.log.on('disconnect', handleDisconnect('log'));
        socket.log.on('connect_error', handleError('log'));
      }

      // Setup cam socket listeners if it exists
      if (socket.cam) {
        socket.cam.on('camera/status', handleRearcamCameraStatus);
        socket.cam.on('state', handleRearcamState);

        socket.cam.emit('status');
      }
    };

    setupModuleListeners();

    // Cleanup function for module listeners
    return () => {
      Object.keys(activeModules).forEach(module => {
        if (module === 'app' || !socket[module]) return;
        
        socket[module].off('settings', handleSettings(module));
        socket[module].off('state', handleState(module));
        socket[module].off('connect', handleConnect(module));
        socket[module].off('disconnect', handleDisconnect(module));
        socket[module].off('connect_error', handleError(module));
      });
      
      if (socket.sys) {
        socket.sys.off('ign', handleIgnition);
        socket.sys.off('connect', handleConnect('sys'));
        socket.sys.off('disconnect', handleDisconnect('sys'));
        socket.sys.off('connect_error', handleError('sys'));
      }

      if (socket.log) {
        socket.log.off('connect', handleConnect('log'));
        socket.log.off('disconnect', handleDisconnect('log'));
        socket.log.off('connect_error', handleError('log'));
      }

      if (socket.cam) {
        socket.cam.off('camera/status', handleRearcamCameraStatus);
        socket.cam.off('state', handleRearcamState);
      }
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