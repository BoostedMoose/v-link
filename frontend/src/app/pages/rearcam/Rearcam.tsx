import React, { useEffect, useRef, useState } from "react";
import styled, { useTheme } from 'styled-components';
import { useNamespaces } from "@/socket/Namespaces";
import { Typography } from "@/theme/styles/Typography";
import { APP } from "@/store/Store";

type ReverseCamSettings = {
  deviceSelectionMode?: { value: string };
  deviceId?: { value: string };
  deviceLabel?: { value: string };
  videoWidth?: { value: number };
  videoHeight?: { value: number };
  videoFps?: { value: number };
};

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
const BottomText = styled.div`
  position: absolute;
  left: 0; right: 0; bottom: 0;
  padding: 10px 14px;
  text-align: center;
  color: #fff;
  font-size: 25px;
  letter-spacing: .2px;
  background: linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0));
  user-select: none;
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

export default function Rearcam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openingRef = useRef(false);
  const socket = useNamespaces();

  const Caption = Typography.Subtitle;
  const theme = useTheme();
  const reverseCamSettings = APP((state) => state.settings.reverseCam as ReverseCamSettings | undefined);

  const [status, setStatus] =
    useState<"idle" | "opening" | "playing" | "error" | "denied">("idle");
  const [err, setErr] = useState("");

  // Turn GPIO on when entering and off when leaving
  useEffect(() => {
    socket.cam.emit('mount');
    return () => {
      socket.cam.emit('unmount');
    };
  }, []);

  // Configurable bottom text
  const overlayText = "CHECK SURROUNDINGS";

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const buildVideoConstraints = async () => {
    const constraints: MediaTrackConstraints = {};
    const selectionMode = reverseCamSettings?.deviceSelectionMode?.value ?? "auto";
    const deviceId = reverseCamSettings?.deviceId?.value ?? "";
    const deviceLabel = reverseCamSettings?.deviceLabel?.value ?? "";
    const width = Number(reverseCamSettings?.videoWidth?.value ?? 0);
    const height = Number(reverseCamSettings?.videoHeight?.value ?? 0);
    const fps = Number(reverseCamSettings?.videoFps?.value ?? 0);

    if (Number.isFinite(width) && width > 0) constraints.width = { ideal: width };
    if (Number.isFinite(height) && height > 0) constraints.height = { ideal: height };
    if (Number.isFinite(fps) && fps > 0) constraints.frameRate = { ideal: fps };

    if (selectionMode === "deviceId" && deviceId && deviceId !== "default") {
      constraints.deviceId = { exact: deviceId };
    } else if (selectionMode === "label" && deviceLabel && navigator?.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const match = devices.find(
        (device) =>
          device.kind === "videoinput" &&
          device.label.toLowerCase().includes(deviceLabel.toLowerCase())
      );
      if (match?.deviceId) {
        constraints.deviceId = { exact: match.deviceId };
      }
    }

    return constraints;
  };

  const openCamera = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
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
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("playing");
    } catch (e: any) {
      setStatus(e?.name === "NotAllowedError" ? "denied" : "error");
      setErr(e?.message || "Failed to open camera");
    } finally {
      openingRef.current = false;
    }
  };

  // Auto-start on enter
  useEffect(() => {
    openCamera();
    return () => { stopStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reverseCamSettings?.deviceSelectionMode?.value,
    reverseCamSettings?.deviceId?.value,
    reverseCamSettings?.deviceLabel?.value,
    reverseCamSettings?.videoWidth?.value,
    reverseCamSettings?.videoHeight?.value,
    reverseCamSettings?.videoFps?.value,
  ]);

  // Retry when the capture device connects/disconnects
  useEffect(() => {
    const h = async () => {
      if (status !== "opening" && status !== "denied") await openCamera();
    };
    if (!navigator?.mediaDevices?.addEventListener) return;
    navigator.mediaDevices.addEventListener("devicechange", h);
    return () => navigator.mediaDevices.removeEventListener("devicechange", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <Container>
      <Video ref={videoRef} autoPlay playsInline muted />

      {/* Overlay PNG transparente */}
      <OverlayImg
        src="/assets/svg/graphics/guidelines.svg"
        alt="Rear camera guidelines"
      />

      {/* Bottom text */}
      <Caption style= {{position:'absolute', bottom:'0', left:'0', right:'0', textAlign:'center', zIndex: 5}}>{overlayText}</Caption>

      {/* Error messages */}
      {status === "error" && <CenterMsg>Error: {err}</CenterMsg>}
      {status === "denied" && (
        <CenterMsg>Camera access denied. Check browser permissions.</CenterMsg>
      )}
    </Container>
  );
}
