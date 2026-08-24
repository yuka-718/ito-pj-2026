"use client";

import { useEffect, useRef } from "react";

type Vec3 = [number, number, number];
type Face = { points: [Vec3, Vec3, Vec3]; tone: number };

const palette = ["#ff6a4d", "#f4a261", "#f2c14e", "#d9ef45", "#6d8ee8", "#fff2d8"];

function face(a: Vec3, b: Vec3, c: Vec3, tone: number): Face {
  return { points: [a, b, c], tone };
}

function fishMesh(): Face[] {
  const nose: Vec3 = [1.75, 0, 0];
  const tail: Vec3 = [-0.85, 0, 0];
  const top: Vec3 = [0.15, 0.78, 0];
  const bottom: Vec3 = [0.15, -0.68, 0];
  const front: Vec3 = [0.2, 0, 0.62];
  const back: Vec3 = [0.2, 0, -0.62];
  const tailTop: Vec3 = [-2.05, 0.95, 0];
  const tailBottom: Vec3 = [-2.05, -0.95, 0];
  const tailFront: Vec3 = [-1.72, 0, 0.62];
  const tailBack: Vec3 = [-1.72, 0, -0.62];
  return [
    face(nose, top, front, 0), face(nose, front, bottom, 1), face(nose, bottom, back, 2), face(nose, back, top, 4),
    face(tail, front, top, 2), face(tail, bottom, front, 0), face(tail, back, bottom, 1), face(tail, top, back, 5),
    face(tail, tailTop, tailFront, 0), face(tail, tailFront, tailBottom, 1), face(tail, tailBottom, tailBack, 2), face(tail, tailBack, tailTop, 4),
    face(top, [0.1, 1.35, -0.08], [0.65, 0.55, 0.06], 3),
    face(bottom, [0.55, -1.05, 0.22], [0.85, -0.35, -0.06], 5),
  ];
}

function craneMesh(): Face[] {
  const center: Vec3 = [0, 0, 0];
  const top: Vec3 = [0, 0.55, 0];
  const bottom: Vec3 = [0, -0.55, 0];
  const front: Vec3 = [0, 0, 0.5];
  const back: Vec3 = [0, 0, -0.5];
  const neck: Vec3 = [1.25, 0.75, 0.08];
  const head: Vec3 = [1.45, 1.2, 0.06];
  const beak: Vec3 = [2.0, 1.15, 0];
  const tail: Vec3 = [-1.5, -0.1, 0];
  return [
    face(center, top, front, 5), face(center, front, bottom, 0), face(center, bottom, back, 1), face(center, back, top, 4),
    face(center, front, [0.05, 0.15, 2.05], 0), face(center, [0.05, 0.15, 2.05], back, 1),
    face(center, back, [0.05, 0.15, -2.05], 4), face(center, [0.05, 0.15, -2.05], front, 5),
    face(top, neck, front, 2), face(front, neck, center, 0), face(neck, head, front, 5), face(head, beak, front, 3),
    face(center, tail, top, 1), face(center, bottom, tail, 2),
  ];
}

function beetleMesh(): Face[] {
  const head: Vec3 = [1.05, 0, 0];
  const rear: Vec3 = [-1.15, 0, 0];
  const top: Vec3 = [-0.05, 0.68, 0];
  const bottom: Vec3 = [-0.05, -0.68, 0];
  const front: Vec3 = [-0.05, 0, 0.55];
  const back: Vec3 = [-0.05, 0, -0.55];
  const leg = (root: Vec3, tip: Vec3, z: number, tone: number) => face(root, tip, [tip[0] - 0.22, tip[1] * 0.72, z], tone);
  return [
    face(head, top, front, 3), face(head, front, bottom, 2), face(head, bottom, back, 1), face(head, back, top, 4),
    face(rear, front, top, 0), face(rear, bottom, front, 1), face(rear, back, bottom, 4), face(rear, top, back, 5),
    face(head, [1.85, 0.6, 0], [1.45, 0.05, 0.15], 2), face(head, [1.85, -0.6, 0], [1.45, -0.05, -0.15], 0),
    leg([0.45, 0.35, 0], [0.25, 1.45, 0.15], 0.45, 5), leg([-0.15, 0.4, 0], [-0.55, 1.5, 0.1], 0.35, 3),
    leg([-0.7, 0.3, 0], [-1.25, 1.25, 0.1], 0.28, 2), leg([0.45, -0.35, 0], [0.25, -1.45, -0.15], -0.45, 4),
    leg([-0.15, -0.4, 0], [-0.55, -1.5, -0.1], -0.35, 0), leg([-0.7, -0.3, 0], [-1.25, -1.25, -0.1], -0.28, 1),
  ];
}

function flowerMesh(): Face[] {
  const center: Vec3 = [0, 0, 0.55];
  const faces: Face[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const next = ((index + 1) / 8) * Math.PI * 2;
    const middle = (angle + next) / 2;
    const a: Vec3 = [Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, 0.1];
    const b: Vec3 = [Math.cos(next) * 0.55, Math.sin(next) * 0.55, 0.1];
    const tip: Vec3 = [Math.cos(middle) * 1.65, Math.sin(middle) * 1.65, -0.2 + (index % 2) * 0.18];
    faces.push(face(center, a, b, index % palette.length), face(a, tip, b, (index + 2) % palette.length));
  }
  return faces;
}

const knowledgeFamilies = new Set([
  "miura_like",
  "single_vertex_kawasaki",
  "radial_flasher_like",
  "square_twist_array",
  "kresling_like",
  "accordion_pleats",
  "yoshimura_like",
  "box_pleat",
  "triangular_lattice",
  "waterbomb_tessellation",
  "reference_precrease",
]);

function knowledgeHeight(modelKey: string, x: number, y: number, ix: number, iy: number) {
  const radius = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  if (modelKey === "miura_like") return ((ix + iy) % 2 ? .3 : -.16) + y * .08;
  if (modelKey === "accordion_pleats") return ix % 2 ? .32 : -.2;
  if (modelKey === "box_pleat") return ((ix % 2) + (iy % 2) - 1) * .24;
  if (modelKey === "radial_flasher_like") return Math.sin(angle * 8 + radius * 4) * .24;
  if (modelKey === "square_twist_array") return Math.sin((Math.abs(x) + Math.abs(y)) * 5) * .22;
  if (modelKey === "kresling_like") return Math.sin((x * 1.2 + y) * 4.2) * .28;
  if (modelKey === "yoshimura_like") return Math.cos(x * 4) * Math.sin(y * 4) * .25;
  if (modelKey === "triangular_lattice") return (ix + iy) % 3 === 0 ? .28 : -.12;
  if (modelKey === "waterbomb_tessellation") return (ix + iy) % 2 ? .34 : -.24;
  if (modelKey === "single_vertex_kawasaki") return Math.max(-.12, .65 - radius * .42);
  return Math.cos(radius * 4) * .16;
}

function knowledgeSurfaceMesh(modelKey: string): Face[] {
  const cells = 7;
  const extent = 1.72;
  const points: Vec3[][] = Array.from({ length: cells + 1 }, (_, iy) =>
    Array.from({ length: cells + 1 }, (_, ix) => {
      const x = -extent + (ix / cells) * extent * 2;
      const y = -extent + (iy / cells) * extent * 2;
      return [x, y, knowledgeHeight(modelKey, x, y, ix, iy)];
    }),
  );
  const faces: Face[] = [];
  for (let iy = 0; iy < cells; iy += 1) {
    for (let ix = 0; ix < cells; ix += 1) {
      const a = points[iy][ix];
      const b = points[iy][ix + 1];
      const c = points[iy + 1][ix + 1];
      const d = points[iy + 1][ix];
      if ((ix + iy) % 2 === 0) {
        faces.push(face(a, b, c, ix + iy), face(a, c, d, ix + iy + 2));
      } else {
        faces.push(face(a, b, d, ix + iy + 1), face(b, c, d, ix + iy + 3));
      }
    }
  }
  return faces;
}

function getMesh(modelKey: string) {
  if (knowledgeFamilies.has(modelKey)) return knowledgeSurfaceMesh(modelKey);
  if (modelKey === "crane") return craneMesh();
  if (modelKey === "beetle") return beetleMesh();
  if (modelKey === "flower") return flowerMesh();
  return fishMesh();
}

function shade(hex: string, light: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const factor = Math.max(0.52, Math.min(1.08, light));
  return `rgb(${Math.round(red * factor)}, ${Math.round(green * factor)}, ${Math.round(blue * factor)})`;
}

export default function Origami3D({ modelKey }: { modelKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = useRef({ x: -0.28, y: 0.62 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const drawRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    function draw() {
      if (!canvas || !context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const rotate = ([x, y, z]: Vec3): Vec3 => {
        const cosY = Math.cos(rotation.current.y);
        const sinY = Math.sin(rotation.current.y);
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        const cosX = Math.cos(rotation.current.x);
        const sinX = Math.sin(rotation.current.x);
        return [x1, y * cosX - z1 * sinX, y * sinX + z1 * cosX];
      };
      const project = ([x, y, z]: Vec3): [number, number] => {
        const scale = Math.min(width, height) * 0.215;
        const perspective = 4.6 / (5.8 - z);
        return [width / 2 + x * scale * perspective, height / 2 - y * scale * perspective];
      };
      const transformed = getMesh(modelKey).map((item) => {
        const points = item.points.map(rotate) as [Vec3, Vec3, Vec3];
        return { ...item, points, depth: points.reduce((sum, point) => sum + point[2], 0) / 3 };
      }).sort((a, b) => a.depth - b.depth);

      context.save();
      context.fillStyle = "rgba(19, 34, 60, .10)";
      context.beginPath();
      context.ellipse(width / 2, height * 0.78, Math.min(width * 0.27, 170), 20, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();

      transformed.forEach((item) => {
        const points = item.points.map(project) as [[number, number], [number, number], [number, number]];
        const [a, b, c] = item.points;
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        const normalZ = ux * vy - uy * vx;
        const normalX = uy * vz - uz * vy;
        const light = 0.72 + Math.max(-0.15, Math.min(0.32, normalZ * 0.08 + normalX * -0.04));
        context.beginPath();
        context.moveTo(points[0][0], points[0][1]);
        context.lineTo(points[1][0], points[1][1]);
        context.lineTo(points[2][0], points[2][1]);
        context.closePath();
        context.fillStyle = shade(palette[item.tone % palette.length], light);
        context.fill();
        context.strokeStyle = "rgba(19, 34, 60, .72)";
        context.lineWidth = 1.25;
        context.stroke();
      });
    }

    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);
    drawRef.current = draw;
    draw();
    return () => {
      drawRef.current = () => undefined;
      resizeObserver.disconnect();
    };
  }, [modelKey]);

  return (
    <canvas
      ref={canvasRef}
      className="modelCanvas"
      aria-label="生成された折り紙完成形の3Dプレビュー。ドラッグして回転できます"
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        rotation.current.y += (event.clientX - drag.current.x) * 0.012;
        rotation.current.x += (event.clientY - drag.current.y) * 0.012;
        drag.current = { x: event.clientX, y: event.clientY };
        drawRef.current();
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    />
  );
}
