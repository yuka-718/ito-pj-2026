"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Origami3D from "./Origami3D";

const SIMULATOR_ORIGIN = "https://origamisimulator.org";
const SIMULATOR_URL = `${SIMULATOR_ORIGIN}/`;

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
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const sendFold = useCallback(() => {
    if (!fold || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ op: "importFold", fold }, SIMULATOR_ORIGIN);
  }, [fold]);

  useEffect(() => {
    if (!fold) return;
    let timeout = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SIMULATOR_ORIGIN || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.from === "OrigamiSimulator" && event.data?.status === "ready") {
        window.clearTimeout(timeout);
        setReady(true);
        setFailed(false);
        sendFold();
      }
    };
    window.addEventListener("message", onMessage);
    timeout = window.setTimeout(() => setFailed(true), 15_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [fold, sendFold]);

  useEffect(() => {
    if (ready) sendFold();
  }, [ready, sendFold]);

  if (!fold || failed) return <Origami3D modelKey={modelKey} />;

  return (
    <div className={`simulatorViewport ${ready ? "isReady" : ""}`}>
      {!ready && <Origami3D modelKey={modelKey} />}
      <iframe
        ref={iframeRef}
        className="origamiSimulatorFrame"
        src={SIMULATOR_URL}
        title="FOLDデータから計算した折り紙の3Dシミュレーション。ドラッグで回転できます"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={() => { if (ready) sendFold(); }}
      />
    </div>
  );
}
