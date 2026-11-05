import { useEffect, useLayoutEffect, useMemo, useRef, useState, PointerEvent, WheelEvent } from "react";
import { FileNode, GraphEdge } from "./types";
import { invoke } from '@tauri-apps/api/core';
import { logger } from "../logger";

interface WorktableProps {
  nodes: FileNode[];
  setNodes: React.Dispatch<React.SetStateAction<FileNode[]>>;
  edges: GraphEdge[];
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ResolvedEdge {
  key: string;
  fromId: string;
  toId: string;
}

interface DragState {
  id: string;
  initialClientX: number;
  initialClientY: number;
  initialNodeX: number;
  initialNodeY: number;
  currentX: number;
  currentY: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.1;
const BASE_GRID_SIZE = 48;

const DEFAULT_NODE_SIZE: Size = { width: 150, height: 55 };
const EPSILON = 1e-9;

function distanceToPerimeter(ux: number, uy: number, size: Size): number {
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  const tx = Math.abs(ux) > EPSILON ? halfWidth / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > EPSILON ? halfHeight / Math.abs(uy) : Infinity;
  return Math.min(tx, ty);
}

function computeLine(fromPos: Point, fromSize: Size, toPos: Point, toSize: Size): Line | null {
  const fromCenterX = fromPos.x + fromSize.width / 2;
  const fromCenterY = fromPos.y + fromSize.height / 2;
  const toCenterX = toPos.x + toSize.width / 2;
  const toCenterY = toPos.y + toSize.height / 2;

  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;

  const ux = dx / length;
  const uy = dy / length;

  const startDistance = distanceToPerimeter(ux, uy, fromSize);
  const endDistance = distanceToPerimeter(ux, uy, toSize);
  if (startDistance + endDistance >= length) return null;

  return {
    x1: fromCenterX + ux * startDistance,
    y1: fromCenterY + uy * startDistance,
    x2: toCenterX - ux * endDistance,
    y2: toCenterY - uy * endDistance,
  };
}

export function Worktable({ nodes, setNodes, edges }: WorktableProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [, setSizeVersion] = useState(0);

  const pointerState = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const draggingNode = useRef<DragState | null>(null);
  const positions = useRef(new Map<string, Point>());
  const sizes = useRef(new Map<string, Size>());
  const nodeElements = useRef(new Map<string, HTMLDivElement>());
  const lineElements = useRef(new Map<string, SVGLineElement>());
  const frame = useRef<number | null>(null);

  if (!draggingNode.current) {
    positions.current = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  }

  const getSize = (id: string): Size => sizes.current.get(id) ?? DEFAULT_NODE_SIZE;

  useLayoutEffect(() => {
    let changed = false;

    nodeElements.current.forEach((element, id) => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const previous = sizes.current.get(id);

      if (!previous || previous.width !== width || previous.height !== height) {
        sizes.current.set(id, { width, height });
        changed = true;
      }
    });

    if (changed) setSizeVersion((v) => v + 1);
  });

  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) setSizeVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedEdges = useMemo<ResolvedEdge[]>(() => {
    const resolve = (ref: string) =>
      nodes.find((n) => n.id === ref || n.name === ref || n.id.endsWith(ref));

    const result: ResolvedEdge[] = [];
    edges.forEach((edge, idx) => {
      const source = resolve(edge.from);
      const target = resolve(edge.to);
      if (source && target) {
        result.push({ key: `${idx}`, fromId: source.id, toId: target.id });
      }
    });
    return result;
  }, [nodes, edges]);

  const gridSize = Math.max(16, Math.round(BASE_GRID_SIZE * scale));

  const flushDrag = () => {
    frame.current = null;
    const drag = draggingNode.current;
    if (!drag) return;

    const element = nodeElements.current.get(drag.id);
    if (element) {
      element.style.transform = `translate(${drag.currentX}px, ${drag.currentY}px)`;
    }

    positions.current.set(drag.id, { x: drag.currentX, y: drag.currentY });

    for (const edge of resolvedEdges) {
      if (edge.fromId !== drag.id && edge.toId !== drag.id) continue;

      const lineElement = lineElements.current.get(edge.key);
      const from = positions.current.get(edge.fromId);
      const to = positions.current.get(edge.toId);
      if (!lineElement || !from || !to) continue;

      const line = computeLine(from, getSize(edge.fromId), to, getSize(edge.toId));

      if (!line) {
        lineElement.setAttribute("visibility", "hidden");
        continue;
      }

      lineElement.setAttribute("visibility", "visible");
      lineElement.setAttribute("x1", String(line.x1));
      lineElement.setAttribute("y1", String(line.y1));
      lineElement.setAttribute("x2", String(line.x2));
      lineElement.setAttribute("y2", String(line.y2));
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.file-node')) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    pointerState.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = draggingNode.current;

    if (drag) {
      const currentScale = scale > 0 ? scale : 1;
      const newX = drag.initialNodeX + (event.clientX - drag.initialClientX) / currentScale;
      const newY = drag.initialNodeY + (event.clientY - drag.initialClientY) / currentScale;

      if (!Number.isFinite(newX) || !Number.isFinite(newY)) return;

      drag.currentX = newX;
      drag.currentY = newY;

      if (frame.current === null) {
        frame.current = requestAnimationFrame(flushDrag);
      }
      return;
    }

    if (!pointerState.current || pointerState.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - pointerState.current.x;
    const dy = event.clientY - pointerState.current.y;

    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    pointerState.current = { ...pointerState.current, x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = draggingNode.current;

    if (drag) {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
      flushDrag();
      draggingNode.current = null;

      if (drag.currentX !== drag.initialNodeX || drag.currentY !== drag.initialNodeY) {
        const { id, currentX, currentY } = drag;
        setNodes((prevNodes) =>
          prevNodes.map((n) => (n.id === id ? { ...n, x: currentX, y: currentY } : n))
        );
      }
    }

    if (pointerState.current) {
      try {
        event.currentTarget.releasePointerCapture(pointerState.current.pointerId);
      } catch (e) {}
      pointerState.current = null;
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + direction * SCALE_STEP));
    if (nextScale === scale) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    const ratio = nextScale / scale;

    setOffset((prev) => ({
      x: prev.x - (localX - prev.x) * (ratio - 1),
      y: prev.y - (localY - prev.y) * (ratio - 1),
    }));
    setScale(nextScale);
  };

  const handleNodePointerDown = (event: PointerEvent<HTMLDivElement>, node: FileNode) => {
    if (event.button !== 0) return;

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    draggingNode.current = {
      id: node.id,
      initialClientX: event.clientX,
      initialClientY: event.clientY,
      initialNodeX: node.x,
      initialNodeY: node.y,
      currentX: node.x,
      currentY: node.y,
    };
  };

  return (
    <div
      className="worktable-viewer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundSize: `${gridSize}px ${gridSize}px, ${gridSize}px ${gridSize}px, ${gridSize * 4}px ${gridSize * 4}px, ${gridSize * 4}px ${gridSize * 4}px`,
        backgroundPosition: `${offset.x}px ${offset.y}px`,
      }}
    >
      <div
        className="worktable-canvas"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
          position: 'absolute',
        }}
      >
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', zIndex: 1 }}>
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#4f46e5" />
            </marker>
          </defs>

          {resolvedEdges.map((edge) => {
            const from = positions.current.get(edge.fromId);
            const to = positions.current.get(edge.toId);
            if (!from || !to) return null;

            const line = computeLine(from, getSize(edge.fromId), to, getSize(edge.toId));

            return (
              <line
                key={edge.key}
                ref={(el) => {
                  if (el) lineElements.current.set(edge.key, el);
                  else lineElements.current.delete(edge.key);
                }}
                x1={line?.x1 ?? 0}
                y1={line?.y1 ?? 0}
                x2={line?.x2 ?? 0}
                y2={line?.y2 ?? 0}
                visibility={line ? "visible" : "hidden"}
                stroke="#4f46e5"
                strokeWidth="2"
                strokeDasharray="4"
                opacity="0.8"
                markerEnd="url(#arrow)"
              />
            );
          })}
        </svg>

        {nodes.map((node) => {
          const position = positions.current.get(node.id) ?? node;

          return (
            <div
              key={node.id}
              ref={(el) => {
                if (el) nodeElements.current.set(node.id, el);
                else nodeElements.current.delete(node.id);
              }}
              className={`file-node ext-${node.extension}`}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
              onDoubleClick={async () => {
                try {
                  logger.add(`Analyzing file via Rust: ${node.name}`, "UI");
                  const result: any = await invoke('analyze_file', { path: node.path });
                  logger.add(
                    `[${node.name}] Lines: ${result.lines} | Size: ${(result.size_bytes / 1024).toFixed(2)} KB -> ${result.message}`,
                    "RUST"
                  );
                } catch (error) {
                  logger.add(`Rust Analysis Error for ${node.name}: ${error}`, "RUST");
                }
              }}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `translate(${position.x}px, ${position.y}px)`,
                willChange: 'transform',
                pointerEvents: 'auto',
                cursor: 'move',
                zIndex: 10,
                touchAction: 'none',
              }}
            >
              <div className="node-content">
                <span className="node-ext">.{node.extension}</span>
                <span className="node-name">{node.name}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="worktable-stats">
        <div>Nodes: {nodes.length}</div>
        <div>Zoom: {Math.round(scale * 100)}%</div>
        <div>Offset: {Math.round(offset.x)} x {Math.round(offset.y)}</div>
      </div>
    </div>
  );
}