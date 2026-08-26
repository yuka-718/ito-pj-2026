"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Origami3D from "./Origami3D";

const SIMULATOR_URL = "./origami-simulator/index.html";
const BOOT_TIMEOUT_MS = 15_000;
const IMPORT_TIMEOUT_MS = 20_000;
let requestSequence = 0;

type SimulatorMessage = {
  from: "OrigamiSimulator";
  bridgeVersion: number;
  bridgeId: string;
  status: "ready" | "loaded" | "error";
  requestId?: string;
};

function nextRequestId() {
  requestSequence += 1;
  return `fold-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function isSimulatorMessage(value: unknown): value is SimulatorMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SimulatorMessage>;
  return message.from === "OrigamiSimulator"
    && message.bridgeVersion === 1
    && typeof message.bridgeId === "string"
    && ["ready", "loaded", "error"].includes(message.status ?? "");
}

function decodeFold(dataUrl: string | null) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:application\/json;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(window.atob(match[1]), (character) => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(value?.vertices_coords) || !Array.isArray(value?.edges_vertices)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function OrigamiSimulator3D({
  foldFile,
  modelKey,
}: {
  foldFile: string | null;
  modelKey: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fold = useMemo(() => decodeFold(foldFile), [foldFile]);
  const requestId = useMemo(() => fold ? nextRequestId() : null, [fold]);
  const foldRef = useRef<Record<string, unknown> | null>(fold);
  const requestIdRef = useRef<string | null>(requestId);
  const bridgeIdRef = useRef<string | null>(null);
  const lastSentRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [loadedRequestId, setLoadedRequestId] = useState<string | null>(null);
  const [failedRequestId, setFailedRequestId] = useState<string | null>(null);
  const loaded = requestId !== null && loadedRequestId === requestId;
  const failed = requestId !== null && failedRequestId === requestId;

  const clearTimeout = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const armTimeout = useCallback((delay: number, timedRequestId: string) => {
    clearTimeout();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      if (requestIdRef.current !== timedRequestId) return;
      readyRef.current = false;
      setReady(false);
      setFailedRequestId(timedRequestId);
    }, delay);
  }, [clearTimeout]);

  const sendFold = useCallback(() => {
    const requestId = requestIdRef.current;
    const bridgeId = bridgeIdRef.current;
    const target = iframeRef.current?.contentWindow;
    if (!foldRef.current || !requestId || !bridgeId || !target) return;
    const sentKey = `${bridgeId}:${requestId}`;
    if (lastSentRef.current === sentKey) return;
    lastSentRef.current = sentKey;
    target.postMessage({
      from: "ORIAI",
      op: "importFold",
      requestId,
      fold: foldRef.current,
    }, window.location.origin);
    armTimeout(IMPORT_TIMEOUT_MS, requestId);
  }, [armTimeout]);

  const requestReady = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({
      from: "ORIAI",
      op: "hello",
    }, window.location.origin);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (!isSimulatorMessage(event.data)) return;
      const message = event.data;

      if (message.status === "ready") {
        if (bridgeIdRef.current !== message.bridgeId) {
          bridgeIdRef.current = message.bridgeId;
          lastSentRef.current = null;
        }
        readyRef.current = true;
        setReady(true);
        sendFold();
        return;
      }

      if (message.bridgeId !== bridgeIdRef.current || message.requestId !== requestIdRef.current) return;
      clearTimeout();
      if (message.status === "loaded") {
        setLoadedRequestId(message.requestId ?? null);
      } else {
        readyRef.current = false;
        setReady(false);
        setFailedRequestId(message.requestId ?? null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [clearTimeout, sendFold]);

  useEffect(() => {
    foldRef.current = fold;
    requestIdRef.current = requestId;
    lastSentRef.current = null;
    if (!fold || !requestId) {
      clearTimeout();
      return;
    }
    armTimeout(BOOT_TIMEOUT_MS, requestId);
    if (readyRef.current) sendFold();
  }, [armTimeout, clearTimeout, fold, requestId, sendFold]);

  useEffect(() => clearTimeout, [clearTimeout]);

  if (!fold || failed) return <Origami3D modelKey={modelKey} />;

  return (
    <div className={`simulatorViewport ${loaded ? "isReady" : ""}`} data-simulator-ready={ready || undefined}>
      {!loaded && <Origami3D modelKey={modelKey} />}
      <iframe
        ref={iframeRef}
        className="origamiSimulatorFrame"
        src={SIMULATOR_URL}
        title="FOLDデータから計算した折り紙の3Dシミュレーション。ドラッグで回転できます"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={requestReady}
      />
    </div>
  );
}
