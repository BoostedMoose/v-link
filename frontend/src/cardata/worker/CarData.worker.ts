import { useNamespaces } from "@/socket/Namespaces";
import { APP } from '@/store/Store';

const socket = useNamespaces();

type LatestData = Record<string, unknown> | null;

let settings: unknown;
let latestData: LatestData = null;
let latestPolling: Record<string, unknown> | null = null;
let latestTimestamp: string | null = null;
// Function to handle incoming sensor settings
const handleSensorSettings = (data: { sensors?: unknown }) => {
  settings = data.sensors;
};

// Listen for canbus settings
socket.can.on("settings", handleSensorSettings);

// Listen for adc settings
socket.adc.on("settings", handleSensorSettings);

socket.data.on("data", (data: { timestamp?: string; data?: Record<string, unknown>; pollingrate?: Record<string, unknown> }) => {
  if (data.data) {
    latestData = data.data;
  }
  if (data.pollingrate) {
    latestPolling = data.pollingrate;
  }
  if (data.timestamp) {
    latestTimestamp = data.timestamp;
  }
});

// Helper for sub-millisecond precision
const microWait = (ms: number) => {
  const start = performance.now();
  while (performance.now() - start < ms) {
    // Busy wait for high precision
  }
};

onmessage = (event) => {
  switch (event.data.type) {
    case 'request':
      socket.data.emit('request');
      if (latestData || latestPolling || latestTimestamp) {
        postMessage({ 
            type: 'message', 
            data: latestData,              // Send polling data back to main thread
            polling: latestPolling,     // Send polling data back to main thread
            timestamp: latestTimestamp, // Send timestamp back to main thread
        });
        latestData = null;
        latestPolling = null; // Clear after sending
        latestTimestamp = null;
      }
      
      microWait(0.1);
      break;
  }
};
