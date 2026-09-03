import { io, Socket } from "socket.io-client";

let sockets: {
  [key: string]: Socket
} | null = null;

export function useNamespaces() {
  if (!sockets) {
    const socketOptions = {
      autoConnect: !globalThis.location?.pathname.endsWith('/vlink-preview.html'),
    };

    sockets = {
      app: io("ws://localhost:4001/app", socketOptions),
      can: io("ws://localhost:4001/can", socketOptions),
      swc: io("ws://localhost:4001/swc", socketOptions),
      adc: io("ws://localhost:4001/adc", socketOptions),
      rti: io("ws://localhost:4001/rti", socketOptions),
      sys: io("ws://localhost:4001/sys", socketOptions),
      log: io("ws://localhost:4001/log", socketOptions),
      cam: io("ws://localhost:4001/cam", socketOptions),

      data: io("ws://localhost:4001/data", socketOptions),
    };
  }
  return sockets;
}
