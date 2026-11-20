/**
 * V-Link Rearcam
 * Version: 2.0
 * Created by: Pablo Martín for BoostedMoose
 */

// TO DO NEXT VERSION: Dynamic rear-camera guidelines
// - Read the steering angle from a configurable CAN signal.
// - Add center offset, direction, and curve-strength calibration.
// - Render curved guidelines according to the steering input.
// - Treat the guidelines as a visual aid, not a precise trajectory prediction.


import React, { useEffect, useRef, useState } from "react";
import styled from 'styled-components';
import { useNamespaces } from "@/socket/Namespaces";
import { Typography } from "@/theme/styles/Typography";
import { APP } from "@/store/Store";


// Shape of the Rearcam settings read from the global app store.
type ReverseCamSettings = {
  deviceSelectionMode?: { value: string };
  deviceId?: { value: string };
  videoResolution?: { value: string };
  videoFps?: { value: string };
  guidelineMode?: { value: string };
  guidelineNearWidth?: { value: number };
  guidelineFarWidth?: { value: number };
  guidelineLength?: { value: number };
  guidelineVerticalPosition?: { value: number };
  guidelineOpacity?: { value: number };
  guidelineLineThickness?: { value: number };
};

// Camera startup validation and user-facing media error messages.
const VIDEO_START_TIMEOUT_MS = 10_000;

const getCameraErrorMessage = (error: unknown) => {
  const mediaError = error as DOMException & { constraint?: string };

  switch (mediaError?.name) {
    case "NotAllowedError":
      return "Camera access was denied. Allow camera access in Chromium permissions and try again.";
    case "NotFoundError":
      return "No video input device was found. Check that the camera or video grabber is connected and recognized by the system.";
    case "NotReadableError":
      return "The video device was found but could not be read. It may be disconnected, already in use, or unavailable to Chromium.";
    case "OverconstrainedError":
      return `The selected camera cannot satisfy the requested${mediaError.constraint ? ` ${mediaError.constraint}` : " video"} setting. Try another resolution, frame rate, or device.`;
    case "SecurityError":
      return "Camera access is blocked by the browser security policy for this page.";
    case "AbortError":
      return "The camera stopped while Chromium was opening it. Reconnect the device and try again.";
    case "PlaybackError":
    case "VideoTimeoutError":
      return mediaError.message;
    default:
      return mediaError?.message
        ? `Failed to open the video device: ${mediaError.message}`
        : "Failed to open the video device for an unknown reason.";
  }
};

const waitForVideoData = (video: HTMLVideoElement) => {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const finish = (result: "ready" | "error" | "timeout") => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("error", onVideoError);

      if (result === "ready") {
        resolve();
      } else {
        const error = new Error(
          result === "timeout"
            ? "The video device opened, but no video frames were received within 10 seconds. Check the selected channel, cable, and video signal."
            : "The camera stream opened, but Chromium reported a video decoding or playback error."
        );
        error.name = result === "timeout" ? "VideoTimeoutError" : "PlaybackError";
        reject(error);
      }
    };

    const onLoadedData = () => finish("ready");
    const onVideoError = () => finish("error");
    const timeoutId = window.setTimeout(() => finish("timeout"), VIDEO_START_TIMEOUT_MS);

    video.addEventListener("loadeddata", onLoadedData, { once: true });
    video.addEventListener("error", onVideoError, { once: true });
  });
};

// Full-screen video, guideline overlays, and camera status layout.
const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
`;
const Video = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
`;
const OverlayImg = styled.img`
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  object-fit: contain;
  pointer-events: none;
  z-index: 5;
`;
const CustomGuidelinesSvg = styled.svg`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  height: auto;
  aspect-ratio: 639.46 / 206.03;
  overflow: visible;
  pointer-events: none;
  z-index: 5;
`;
const CenterMsg = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  z-index: 4;
`;
const SettingsResetNotice = styled.div`
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  width: min(90%, 680px);
  box-sizing: border-box;
  padding: 12px 18px;
  border: 2px solid #ff4d4d;
  border-radius: 6px;
  background: rgba(120, 0, 0, 0.92);
  color: #fff;
  font-weight: 700;
  text-align: center;
  pointer-events: none;
`;

// Custom guideline dimensions and reusable geometry helpers.
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

type CustomGuidelinesProps = {
  nearWidth: number;
  farWidth: number;
  length: number;
  verticalPosition: number;
  opacity: number;
  lineThickness: number;
};

const ORIGINAL_GUIDELINE_WIDTH = 639.46;
const ORIGINAL_GUIDELINE_HEIGHT = 206.03;
const ORIGINAL_GUIDELINE_CENTER = ORIGINAL_GUIDELINE_WIDTH / 2;
const DEFAULT_NEAR_WIDTH = 90;
const DEFAULT_GUIDELINE_LENGTH = 50;
const CROSSBAR_GAP = 0;
const CROSSBAR_LENGTH = 50;

const guidelineSideSegments = [
  { color: '#00ff00', startY: 0, endY: 40},
  { color: '#00ff00', startY: 50, endY: 90 },
  { color: '#ffff00', startY: 100, endY: 120},
  { color: '#ffff00', startY: 130, endY: 170 },
  { color: '#ff0000', startY: 180, endY: 200 },
  { color: '#ff0000', startY: 210, endY: 250 },
] as const;

const guidelineCrossbars = [
  { color: '#00ff00', y: 20 },
  { color: '#00ff00', y: 70 },
  { color: '#ffff00', y: 150 },
  { color: '#ff0000', y: 230 },
] as const;

// Build both sides of the configurable parking guide from simple SVG lines.
const CustomGuidelines = ({ nearWidth, farWidth, length, verticalPosition, opacity, lineThickness }: CustomGuidelinesProps) => {
  const targetNearWidth = clamp(nearWidth, 20, 100);
  const targetFarWidth = Math.min(clamp(farWidth, 5, 90), targetNearWidth);
  const lengthScale = clamp(length, 20, 100) / DEFAULT_GUIDELINE_LENGTH;
  const thicknessScale = clamp(lineThickness, 50, 200) / 100;

  const transformY = (sourceY: number) => ORIGINAL_GUIDELINE_HEIGHT / 2
    + (sourceY - ORIGINAL_GUIDELINE_HEIGHT / 2) * lengthScale;

  const halfWidthAt = (sourceY: number, farWidth: number, nearWidth: number) => {
    const progress = sourceY / ORIGINAL_GUIDELINE_HEIGHT;
    const width = farWidth + (nearWidth - farWidth) * progress;
    return ORIGINAL_GUIDELINE_CENTER * width / DEFAULT_NEAR_WIDTH;
  };

  return (
    <CustomGuidelinesSvg
      viewBox={`0 0 ${ORIGINAL_GUIDELINE_WIDTH} ${ORIGINAL_GUIDELINE_HEIGHT}`}
      aria-label="Custom rear camera guidelines"
      style={{
        opacity: clamp(opacity, 10, 100) / 100,
        top: `${clamp(verticalPosition, 0, 100)}%`,
      }}
    >
      {([-1, 1] as const).flatMap((side) =>
        guidelineSideSegments.map((segment, index) => (
          <line
            key={`side-${side}-${index}`}
            x1={ORIGINAL_GUIDELINE_CENTER + side * halfWidthAt(segment.startY, targetFarWidth, targetNearWidth)}
            y1={transformY(segment.startY)}
            x2={ORIGINAL_GUIDELINE_CENTER + side * halfWidthAt(segment.endY, targetFarWidth, targetNearWidth)}
            y2={transformY(segment.endY)}
            stroke={segment.color}
            strokeWidth={5 * thicknessScale}
            strokeLinecap="butt"
          />
        ))
      )}
      {([-1, 1] as const).flatMap((side) =>
        guidelineCrossbars.map((bar, index) => {
          const targetHalfWidth = halfWidthAt(bar.y, targetFarWidth, targetNearWidth);
          const separatedOuterHalfWidth = Math.max(
            0,
            targetHalfWidth - CROSSBAR_GAP * thicknessScale
          );
          const innerHalfWidth = Math.max(0, separatedOuterHalfWidth - CROSSBAR_LENGTH);
          return (
            <line
              key={`bar-${side}-${index}`}
              x1={ORIGINAL_GUIDELINE_CENTER + side * separatedOuterHalfWidth}
              y1={transformY(bar.y)}
              x2={ORIGINAL_GUIDELINE_CENTER + side * innerHalfWidth}
              y2={transformY(bar.y)}
              stroke={bar.color}
              strokeWidth={5 * thicknessScale}
              strokeLinecap="butt"
            />
          );
        })
      )}
    </CustomGuidelinesSvg>
  );
};

export default function Rearcam() {
  // Active stream references, Socket.IO namespace, and saved guide settings.
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const socket = useNamespaces();
  const appUpdate = APP((state) => state.update);

  const Caption = Typography.Subtitle;
  const reverseCamSettings = APP((state) => state.settings.reverseCam as ReverseCamSettings | undefined);
  const resetNoticePending = APP((state) => (
    state.settings.constants as { rearcam_settings_reset_notice?: boolean } | undefined
  )?.rearcam_settings_reset_notice ?? false);
  const [showSettingsResetNotice] = useState(resetNoticePending);

  const guidelineMode = reverseCamSettings?.guidelineMode?.value ?? "Standard";
  const guidelineNearWidth = Number(reverseCamSettings?.guidelineNearWidth?.value ?? 80);
  const guidelineFarWidth = Number(reverseCamSettings?.guidelineFarWidth?.value ?? 35);
  const guidelineLength = Number(reverseCamSettings?.guidelineLength?.value ?? 55);
  const guidelineVerticalPosition = Number(reverseCamSettings?.guidelineVerticalPosition?.value ?? 45);
  const guidelineOpacity = Number(reverseCamSettings?.guidelineOpacity?.value ?? 100);
  const guidelineLineThickness = Number(reverseCamSettings?.guidelineLineThickness?.value ?? 65);

  const [status, setStatus] =
    useState<"idle" | "opening" | "playing" | "error" | "denied">("idle");
  const [err, setErr] = useState("");

  // Persistently acknowledge the migration warning as soon as its first
  // Rearcam visit starts, while keeping it visible for this mounted view.
  useEffect(() => {
    if (!showSettingsResetNotice) return;

    const nextSettings = structuredClone(APP.getState().settings);
    const constants = nextSettings.constants as Record<string, unknown> | undefined;
    if (!constants) return;

    constants.rearcam_settings_reset_notice = false;
    appUpdate((state) => { state.settings = nextSettings; });
    socket.app.emit('save', nextSettings);
  }, [appUpdate, showSettingsResetNotice, socket.app]);

  // Power the camera through GPIO while the Rearcam page is mounted.
  useEffect(() => {
    socket.cam.emit('mount');
    return () => {
      socket.cam.emit('unmount');
    };
  }, []);

  // Overlay warning and media-stream cleanup shared by every exit path.
  const overlayText = "CHECK SURROUNDINGS";

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // Translate saved device, resolution, and video-standard choices into
  // non-strict browser constraints so unsupported modes can fall back safely.
  const buildVideoConstraints = async () => {
    const constraints: MediaTrackConstraints = {};
    const selectionMode = reverseCamSettings?.deviceSelectionMode?.value ?? "auto";
    const deviceId = reverseCamSettings?.deviceId?.value ?? "";
    const resolution = reverseCamSettings?.videoResolution?.value ?? "Auto";
    const videoStandard = reverseCamSettings?.videoFps?.value ?? "Auto";

    const resolutionMatch = resolution.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (resolutionMatch) {
      constraints.width = { ideal: Number(resolutionMatch[1]) };
      constraints.height = { ideal: Number(resolutionMatch[2]) };
    }
    const frameRate = videoStandard === "PAL" ? 25 : videoStandard === "NTSC" ? 30 : 0;
    if (frameRate > 0) constraints.frameRate = { ideal: frameRate };

    if (selectionMode === "deviceId" && deviceId && deviceId !== "default") {
      const devices = navigator?.mediaDevices?.enumerateDevices
        ? await navigator.mediaDevices.enumerateDevices()
        : [];
      const deviceAvailable = devices.some(
        (device) => device.kind === "videoinput" && device.deviceId === deviceId
      );
      // A saved ID can change after moving the grabber to another USB port.
      // Fall back for this session without erasing the user's preference.
      if (deviceAvailable) constraints.deviceId = { exact: deviceId };
    }

    return constraints;
  };

  // Open the selected capture device, reject stale asynchronous requests, and
  // confirm that Chromium receives a playable frame before reporting success.
  const openCamera = async () => {
    const requestId = ++requestIdRef.current;
    setStatus("opening"); setErr("");
    try {
      stopStream();
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Media devices API not available");
      }

      const constraints = await buildVideoConstraints();
      const videoConstraint =
        Object.keys(constraints).length > 0 ? constraints : true;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: false,
      });

      // The user may have left Rearcam or changed camera settings while the
      // browser was still opening this device. Never keep an outdated stream.
      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        const startPlayback = video.play().catch((cause) => {
          const detail = cause instanceof Error ? ` ${cause.message}` : "";
          const error = new Error(`The camera stream opened, but video playback could not start.${detail}`);
          error.name = "PlaybackError";
          throw error;
        });
        await Promise.all([startPlayback, waitForVideoData(video)]);
      }

      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener("ended", () => {
        if (streamRef.current !== stream) return;
        stopStream();
        setStatus("error");
        setErr("The video device stopped sending data or was disconnected. Check the USB connection and selected camera.");
      }, { once: true });

      setStatus("playing");
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setStatus(e?.name === "NotAllowedError" ? "denied" : "error");
      setErr(getCameraErrorMessage(e));
      stopStream();
    }
  };

  // Start on entry and reopen when a camera-related setting changes.
  useEffect(() => {
    openCamera();
    return () => {
      requestIdRef.current += 1;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reverseCamSettings?.deviceSelectionMode?.value,
    reverseCamSettings?.deviceId?.value,
    reverseCamSettings?.videoResolution?.value,
    reverseCamSettings?.videoFps?.value,
  ]);

  // Retry after USB capture devices are connected or disconnected.
  useEffect(() => {
    const h = async () => {
      if (status !== "denied") await openCamera();
    };
    if (!navigator?.mediaDevices?.addEventListener) return;
    navigator.mediaDevices.addEventListener("devicechange", h);
    return () => navigator.mediaDevices.removeEventListener("devicechange", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Render the live video, selected guideline mode, warning, and any errors.
  return (
    <Container>
      <Video ref={videoRef} autoPlay playsInline muted />

      {showSettingsResetNotice && (
        <SettingsResetNotice role="alert">
          Rear camera settings were incompatible and have been reset to defaults. Please review and save your camera preferences.
        </SettingsResetNotice>
      )}

      {guidelineMode === "Standard" && (
        <OverlayImg
          src="/assets/svg/graphics/guidelines.svg"
          alt="Rear camera guidelines"
        />
      )}
      {guidelineMode === "Custom" && (
        <CustomGuidelines
          nearWidth={guidelineNearWidth}
          farWidth={guidelineFarWidth}
          length={guidelineLength}
          verticalPosition={guidelineVerticalPosition}
          opacity={guidelineOpacity}
          lineThickness={guidelineLineThickness}
        />
      )}

      {/* Bottom text */}
      <Caption style= {{position:'absolute', bottom:'0', left:'0', right:'0', textAlign:'center', zIndex: 5}}>{overlayText}</Caption>

      {/* Error messages */}
      {status === "error" && <CenterMsg>Error: {err}</CenterMsg>}
      {status === "denied" && (
        <CenterMsg>{err}</CenterMsg>
      )}
    </Container>
  );
}
