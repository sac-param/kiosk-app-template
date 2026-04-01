import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";

/**
 * InfiniteGrid Component
 * Converts the original HTML/CSS/JS infinite pan/zoom image grid into a React component.
 * All images are expected to be in the /public folder (root of the project).
 * The grid is infinite, tiles are recycled, drag + inertia, pinch/zoom via ctrl+wheel,
 * and a modal shows the selected image at higher resolution.
 */
export default function InfiniteGrid() {
  // ---------------------- State for modal ----------------------
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImageSrc, setModalImageSrc] = useState("");
  const [modalTitle, setModalTitle] = useState("");

  // ---------------------- Refs for DOM & imperative grid logic ----------------------
  const viewportRef = useRef(null);
  const layerRef = useRef(null);

  // Grid and camera state (stored in refs to avoid re-renders)
  const gridRef = useRef({
    tiles: [], // array of { el, r, c, wc, wr }
    rows: 0,
    cols: 0,
  });

  const cameraRef = useRef({
    x: 0,
    y: 0,
    zoom: 1,
  });

  const physicsRef = useRef({
    vx: 0,
    vy: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pressTile: null,
    pressX: 0,
    pressY: 0,
  });

  const animFrameRef = useRef(null);
  const resizeKeyRef = useRef(0);

  // Constants (match original behavior)
  const TILE_W = 400;
  const TILE_H = 250;
  const GAP_X = 70;
  const GAP_Y = 70;
  const STEP_X = TILE_W + GAP_X;
  const STEP_Y = TILE_H + GAP_Y;
  const EXTRA = 4; // extra tiles around the viewport
  const FRICTION = 0.92;
  const IMPULSE = 0.6;
  const MAX_V = 40;
  const ZMIN = 0.33;
  const ZMAX = 3.0;

  // List of image file names (must be present in /public folder)
  const IMAGES = [
    "1.png",
    "2.png",
    "3.png",
    "4.png",
    "5.png",
    "6.png",
    "7.png",
    "8.png",
    "9.png",
    "10.png",
    "11.png",
    "12.png",
    "13.png",
    "14.png",
    "15.png",
    "16.png",
    "17.png",
    "18.png",
    "19.png",
    "20.png",
    "21.png",
    "22.png",
    "23.png",
    "24.png",
    "25.png",
    "26.png",
    "27.png",
  ];

  // Helper: deterministic image from cell coordinates (infinite wrapping)
  const STRIDE = 17;
  const mod = (n, m) => ((n % m) + m) % m;

  const imageForCell = useCallback((wc, wr) => {
    const idx = mod(wc + wr * STRIDE, IMAGES.length);
    return IMAGES[idx];
  }, []);

  // Device pixel ratio snapping (keep text crisp)
  const DPR = window.devicePixelRatio || 1;
  const quantizeToDevicePixels = useCallback((valueUnscaled, zoom) => {
    const scaled = valueUnscaled * zoom;
    const snapped = Math.round(scaled * DPR) / DPR;
    return snapped / zoom;
  }, []);

  // Preload all images (non-blocking)
  useEffect(() => {
    // Use BASE_URL to preload with relative paths
    const base = import.meta.env.BASE_URL || './';
    IMAGES.forEach((src) => {
      const img = new Image();
      img.decoding = "async";
      img.src = `${base}${src}`;
    });
    // also preload background.png (tile paper texture)
    const bg = new Image();
    bg.src = `${base}background.png`;
  }, []);

  // Set CSS custom properties for tile dimensions
  useEffect(() => {
    document.documentElement.style.setProperty("--tile-w", `${TILE_W}px`);
    document.documentElement.style.setProperty("--tile-h", `${TILE_H}px`);
    document.documentElement.style.setProperty("--gap-x", `${GAP_X}px`);
    document.documentElement.style.setProperty("--gap-y", `${GAP_Y}px`);
  }, []);

  // Helper: compute required rows/cols based on viewport size + margin
  const computeGridDimensions = useCallback(() => {
    const cols = Math.ceil(window.innerWidth / STEP_X) + EXTRA;
    const rows = Math.ceil(window.innerHeight / STEP_Y) + EXTRA;
    return { rows, cols };
  }, [STEP_X, STEP_Y, EXTRA]);

  // Build (or rebuild) the tile DOM elements
  const buildGrid = useCallback(() => {
    if (!layerRef.current) return;
    const { rows, cols } = computeGridDimensions();
    const layer = layerRef.current;

    // Remove all existing tiles
    while (layer.firstChild) {
      layer.removeChild(layer.firstChild);
    }

    const newTiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const el = document.createElement("div");
        el.className = "tile ready";
        layer.appendChild(el);
        newTiles.push({ el, r, c, wc: NaN, wr: NaN });
      }
    }

    gridRef.current = {
      tiles: newTiles,
      rows,
      cols,
    };
  }, [computeGridDimensions]);

  // Render all tiles: update background images and transforms based on current camera
  const renderTiles = useCallback(() => {
    const { tiles, rows, cols } = gridRef.current;
    if (!tiles.length) return;

    const camera = cameraRef.current;
    const { x: camX, y: camY, zoom } = camera;

    const ox = mod(-camX, STEP_X);
    const oy = mod(-camY, STEP_Y);
    const col0 = Math.floor(camX / STEP_X);
    const row0 = Math.floor(camY / STEP_Y);

    const base = import.meta.env.BASE_URL || './';

    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, idx++) {
        const wc = c - 1 + col0;
        const wr = r - 1 + row0;
        const tile = tiles[idx];

        // Update image if cell changed
        if (tile.wc !== wc || tile.wr !== wr) {
          tile.wc = wc;
          tile.wr = wr;
          const imgName = imageForCell(wc, wr);
          const imgUrl = `${base}${imgName}`;
          tile.el.style.setProperty("--img", `url("${imgUrl}")`);
          // Also set the background image (paper texture) only once per tile
          if (!tile.el.style.background) {
            const bgUrl = `${base}background.png`;
            tile.el.style.background = `url("${bgUrl}") center/cover no-repeat`;
          }
          // store cell coordinates for click detection
          tile.el.dataset.wc = wc;
          tile.el.dataset.wr = wr;
        }

        const x0 = c * STEP_X + ox - STEP_X;
        const y0 = r * STEP_Y + oy - STEP_Y;
        const x = quantizeToDevicePixels(x0, zoom);
        const y = quantizeToDevicePixels(y0, zoom);
        tile.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
    }

    // Apply global zoom to layer
    if (layerRef.current) {
      layerRef.current.style.transform = `scale(${zoom})`;
    }
  }, [STEP_X, STEP_Y, imageForCell, quantizeToDevicePixels]);

  // Animation loop: update inertia and re-render
  const animationLoop = useCallback(() => {
    const physics = physicsRef.current;
    const camera = cameraRef.current;

    if (!physics.dragging) {
      let { vx, vy } = physics;
      vx = Math.max(Math.min(vx, MAX_V), -MAX_V);
      vy = Math.max(Math.min(vy, MAX_V), -MAX_V);
      camera.x += vx;
      camera.y += vy;
      vx *= FRICTION;
      vy *= FRICTION;
      if (Math.abs(vx) < 0.01) vx = 0;
      if (Math.abs(vy) < 0.01) vy = 0;
      physics.vx = vx;
      physics.vy = vy;
    }

    renderTiles();
    animFrameRef.current = requestAnimationFrame(animationLoop);
  }, [renderTiles, FRICTION, MAX_V]);

  // Setup all event listeners (wheel, pointer, resize)
  const setupEvents = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // ----- Wheel (pan / zoom with ctrl) -----
    const onWheel = (e) => {
      e.preventDefault();
      const physics = physicsRef.current;
      const camera = cameraRef.current;

      if (e.ctrlKey) {
        const preX = e.clientX / camera.zoom + camera.x;
        const preY = e.clientY / camera.zoom + camera.y;
        const s = Math.exp(-e.deltaY * 0.001);
        const nz = Math.min(ZMAX, Math.max(ZMIN, camera.zoom * s));
        camera.zoom = nz;
        camera.x = preX - e.clientX / camera.zoom;
        camera.y = preY - e.clientY / camera.zoom;
      } else {
        physics.vx += e.deltaX * IMPULSE;
        physics.vy += e.deltaY * IMPULSE;
      }
    };

    // ----- Pointer events (drag + click detection) -----
    const onPointerDown = (e) => {
      const physics = physicsRef.current;
      physics.dragging = true;
      viewport.setPointerCapture(e.pointerId);
      physics.lastX = e.clientX;
      physics.lastY = e.clientY;
      physics.pressX = e.clientX;
      physics.pressY = e.clientY;
      physics.vx = 0;
      physics.vy = 0;
      // record which tile was clicked (if any)
      physics.pressTile = e.target.closest(".tile");
    };

    const onPointerMove = (e) => {
      const physics = physicsRef.current;
      if (!physics.dragging) return;
      const dx = e.clientX - physics.lastX;
      const dy = e.clientY - physics.lastY;
      const camera = cameraRef.current;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      physics.lastX = e.clientX;
      physics.lastY = e.clientY;
    };

    const onPointerUp = (e) => {
      const physics = physicsRef.current;
      physics.dragging = false;

      // check for "click" (minimal movement and started on a tile)
      const moved = Math.hypot(e.clientX - physics.pressX, e.clientY - physics.pressY);
      if (physics.pressTile && moved < 8) {
        const wc = parseInt(physics.pressTile.dataset.wc, 10);
        const wr = parseInt(physics.pressTile.dataset.wr, 10);
        if (!isNaN(wc) && !isNaN(wr)) {
          const imgName = imageForCell(wc, wr);
          const base = import.meta.env.BASE_URL || './';
          const imgUrl = `${base}${imgName}`;
          setModalTitle(`Image — cell (${wc}, ${wr})`);
          setModalImageSrc(imgUrl);
          setModalOpen(true);
        }
      }
      physics.pressTile = null;
    };

    const onPointerCancel = () => {
      const physics = physicsRef.current;
      physics.dragging = false;
      physics.pressTile = null;
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerCancel);

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [IMPULSE, ZMIN, ZMAX, imageForCell]);

  // Full grid initialization (called on mount and after resize)
  const initGrid = useCallback(() => {
    // reset camera and physics
    cameraRef.current = { x: 0, y: 0, zoom: 1 };
    physicsRef.current = {
      vx: 0,
      vy: 0,
      dragging: false,
      lastX: 0,
      lastY: 0,
      pressTile: null,
      pressX: 0,
      pressY: 0,
    };

    buildGrid();
    renderTiles();
  }, [buildGrid, renderTiles]);

  // Handle window resize: rebuild grid completely (like original reload)
  const handleResize = useCallback(() => {
    // Use a small delay to avoid excessive rebuilds during resize
    let timeoutId;
    const debounced = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        initGrid();
      }, 150);
    };
    window.addEventListener("resize", debounced);
    return () => {
      window.removeEventListener("resize", debounced);
      clearTimeout(timeoutId);
    };
  }, [initGrid]);

  // Main effect: setup grid, events, animation; cleanup on unmount
  useEffect(() => {
    initGrid();
    const removeEvents = setupEvents();
    const removeResizeHandler = handleResize();

    // start animation loop
    animFrameRef.current = requestAnimationFrame(animationLoop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      removeEvents?.();
      removeResizeHandler?.();
    };
  }, [initGrid, setupEvents, handleResize, animationLoop]);

  // ---------- Modal close logic ----------
  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalImageSrc("");
    setModalTitle("");
  }, []);

  const handleBackdropClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) {
        closeModal();
      }
    },
    [closeModal]
  );

  // ---------- Styles (embedded to match original look) ----------
  const styles = `
    :root {
      --tile-w: ${TILE_W}px;
      --tile-h: ${TILE_H}px;
      --gap-x: ${GAP_X}px;
      --gap-y: ${GAP_Y}px;
      --inner: 8px;
      --radius: 8px;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      overflow: hidden;   /* removes all scrollbars */
      background: #000;
    }
    #infinite-viewport {
      position: relative;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      background: #000000;
      touch-action: none;
    }
    #infinite-layer {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
      will-change: transform;
    }
    .tile {
      position: absolute;
      width: var(--tile-w);
      height: var(--tile-h);
      background: none;  /* set dynamically in JS */
      contain: paint;
      will-change: transform;
      backface-visibility: hidden;
      outline: 1px solid transparent;
      cursor: pointer;
      box-shadow: 0 0 18px rgba(194, 192, 192, 0.55);
    }
    .tile::after {
      content: "";
      position: absolute;
      inset: var(--inner);
      border-radius: var(--radius);
      background: var(--img) center/cover no-repeat;
      opacity: 0;
      transition: opacity 0.12s linear;
      will-change: opacity;
      transform: translateZ(0);
    }
    .tile.ready::after {
      opacity: 1;
    }
    /* Modal styling */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(1px);
      z-index: 9999;
    }
    .modal.image-modal {
      width: 96vw;
      height: 92vh;
      max-width: 1800px;
      max-height: 92vh;
      background: #111;
      color: #f2f2f2;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 16px 60px rgba(0, 0, 0, 0.35);
      display: grid;
      grid-template-rows: 56px 1fr;
    }
    .modal header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      background: linear-gradient(180deg, #191919, #141414);
      border-bottom: 1px solid #232323;
    }
    .modal header h2 {
      margin: 0;
      font: 700 18px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      letter-spacing: 0.2px;
    }
    .imageWrap {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 100%;
      padding: 12px;
      background: #0a0a0a;
      box-sizing: border-box;
      overflow: hidden;
    }
    .imageWrap img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: center;
      border-radius: 12px;
      box-shadow: 0 0 18px rgba(128, 128, 128, 0.35);
    }
    .closeBtn {
      appearance: none;
      border: 0;
      border-radius: 10px;
      padding: 8px 12px;
      background: #2a2a2a;
      color: #eee;
      cursor: pointer;
      font-weight: 700;
    }
    .closeBtn:hover {
      background: #3a3a3a;
    }
  `;

  return (
    <>
      <style>{styles}</style>
      <div id="infinite-viewport" ref={viewportRef}>
        <div id="infinite-layer" ref={layerRef} />
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
          <div className="modal image-modal">
            <header>
              <h2 id="dlgTitle">{modalTitle}</h2>
              <button className="closeBtn" onClick={closeModal} type="button">
                Close
              </button>
            </header>
            <div className="imageWrap">
              <img src={modalImageSrc} alt="Preview" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}