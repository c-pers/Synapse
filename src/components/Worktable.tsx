import { useRef, useState, PointerEvent, WheelEvent } from "react";
import { FileNode } from "./types";
import { invoke } from '@tauri-apps/api/core';
import { logger } from "../logger";

interface WorktableProps {
  nodes: FileNode[];
  setNodes: React.Dispatch<React.SetStateAction<FileNode[]>>;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.1;
const BASE_GRID_SIZE = 48;

export function Worktable({ nodes, setNodes }: WorktableProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const pointerState = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const draggingNode = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const gridSize = Math.max(16, Math.round(BASE_GRID_SIZE * scale));

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.file-node')) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    pointerState.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    // 1. Gestione Drag sicura del Nodo
    if (draggingNode.current) {
      // CALCOLO SICURO DEL DELTA: Aggiunte validazioni NaN/Zero
      const deltaX = event.clientX - draggingNode.current.startX;
      const deltaY = event.clientY - draggingNode.current.startY;

      // Protezione NaN/Zero sullo scale (estremamente raro ma possibile)
      const currentScale = scale > 0 ? scale : 1;

      const dx = deltaX / currentScale;
      const dy = deltaY / currentScale;

      // CONTROLLO DI SICUREZZA FINALE: Se i valori sono instabili, non aggiornare lo stato
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        console.error("Critical calculation fault during drag. Operation aborted.");
        draggingNode.current = null; // Forza l'uscita dal drag
        return;
      }

      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.id === draggingNode.current!.id
            ? { ...n, x: n.x + dx, y: n.y + dy }
            : n
        )
      );

      draggingNode.current.startX = event.clientX;
      draggingNode.current.startY = event.clientY;
      return;
    }

    // 2. Gestione Pan Sfondo sicura
    if (!pointerState.current || pointerState.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - pointerState.current.x;
    const dy = event.clientY - pointerState.current.y;

    // Controllo sicurezza anche sul Pan
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      console.error("Critical calculation fault during pan. Operation aborted.");
      pointerState.current = null;
      return;
    }

    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    pointerState.current = { ...pointerState.current, x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingNode.current) {
      draggingNode.current = null;
    }
    if (pointerState.current) {
      // Aggiunta protezione sulla release: Tauri/browser a volte perdono il capture
      try {
        event.currentTarget.releasePointerCapture(pointerState.current.pointerId);
      } catch (e) {
        // Ignora errore se il browser ha già perso il capture
      }
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

  const handleNodePointerDown = (event: PointerEvent<HTMLDivElement>, nodeId: string) => {
    event.stopPropagation();

    draggingNode.current = {
      id: nodeId,
      startX: event.clientX,
      startY: event.clientY
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
      <div className="worktable-canvas" style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        transformOrigin: '0 0',
        pointerEvents: 'none'
      }}>
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`file-node ext-${node.extension}`}
            onPointerDown={(e) => handleNodePointerDown(e, node.id)}
            onDoubleClick={async () => {
              try {
                logger.add(`Analyzing file via Rust: ${node.name}`, "UI");

                // Chiamata al backend Rust
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
              left: node.x,
              top: node.y,
              pointerEvents: 'auto',
              cursor: 'move',
              zIndex: 10,
              touchAction: 'none'
            }}
          >
            <div className="node-content">
              <span className="node-ext">.{node.extension}</span>
              <span className="node-name">{node.name}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="worktable-stats">
        <div>Nodes: {nodes.length}</div>
        <div>Zoom: {Math.round(scale * 100)}%</div>
        <div>Offset: {Math.round(offset.x)} x {Math.round(offset.y)}</div>
      </div>
    </div>
  );
}