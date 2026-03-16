import { useNamespaces } from "@/socket/Namespaces";
const socket = useNamespaces();

type LatestData = { values: unknown; timestamp: number } | null;

let settings: unknown;
let latestData: LatestData = null

// Function to handle incoming canbus settings
const handlesensorSettings = (data: { sensors?: unknown }) => {
    settings = data.sensors;
};

// Listen for canbus settings
socket.can.on("settings", handlesensorSettings);

// Listen for adc settings
socket.adc.on("settings", handlesensorSettings);

socket.data.on("data", (data: { timestamp?: number; data?: unknown }) => {
  if (data && typeof data.timestamp === 'number' && data.data) {
    latestData = { values: data.data, timestamp: Date.now() }
  }
});

onmessage = (event) => {
  switch (event.data.type) {
    case 'request':
      socket.data.emit('request');
      if (latestData) {
        postMessage({ type: 'message', ...latestData });
        latestData = null; // drop it so backlog can't build
      }
      break;
  }
}
