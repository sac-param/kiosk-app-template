import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";

/**
 * InfiniteGrid Component
 * Auto-loads all images from: src/assets/images/
 * No hardcoded IMAGES array needed.
 */
export default function InfiniteGrid() {
  // ---------------------- State for modal ----------------------
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImageSrc, setModalImageSrc] = useState("");
  const [modalTitle, setModalTitle] = useState("");

  // ---------------------- Refs for DOM & imperative grid logic ----------------------
  const viewportRef = useRef(null);
  const layerRef = useRef(null);

  // Grid and camera state
  const gridRef = useRef({
    tiles: [],
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

  // Constants
  const TILE_W = 400;
  const TILE_H = 250;
  const GAP_X = 70;
  const GAP_Y = 70;
  const STEP_X = TILE_W + GAP_X;
  const STEP_Y = TILE_H + GAP_Y;
  const EXTRA = 4;
  const FRICTION = 0.92;
  const IMPULSE = 0.6;
  const MAX_V = 40;
  const ZMIN = 0.33;
  const ZMAX = 3.0;

  // ---------------------- AUTO LOAD IMAGES ----------------------
  // Put your images in: src/assets/images/
  // Supported: png, jpg, jpeg, webp, gif, avif, svg
  const imageModules = import.meta.glob(
    "/src/assets/images/*.{png,jpg,jpeg,webp,gif,avif,svg}",
    {
      eager: true,
      import: "default",
    }
  );

  const IMAGES = useMemo(() => {
    return Object.entries(imageModules)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([, value]) => value)
      .filter(Boolean);
  }, [imageModules]);

  // Helper: deterministic image from cell coordinates
  const STRIDE = 17;
  const mod = (n, m) => ((n % m) + m) % m;

  const imageForCell = useCallback(
    (wc, wr) => {
      if (!IMAGES.length) return "";
      const idx = mod(wc + wr * STRIDE, IMAGES.length);
      return IMAGES[idx];
    },
    [IMAGES]
  );

  // Device pixel ratio snapping
  const DPR =
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const quantizeToDevicePixels = useCallback((valueUnscaled, zoom) => {
    const scaled = valueUnscaled * zoom;
    const snapped = Math.round(scaled * DPR) / DPR;
    return snapped / zoom;
  }, []);

  // Preload all discovered images
  useEffect(() => {
    IMAGES.forEach((src) => {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
    });

    const bg = new Image();
    bg.src = "/background.png";
  }, [IMAGES]);

  // Set CSS custom properties
  useEffect(() => {
    document.documentElement.style.setProperty("--tile-w", `${TILE_W}px`);
    document.documentElement.style.setProperty("--tile-h", `${TILE_H}px`);
    document.documentElement.style.setProperty("--gap-x", `${GAP_X}px`);
    document.documentElement.style.setProperty("--gap-y", `${GAP_Y}px`);
  }, []);

  // Compute required rows/cols
  const computeGridDimensions = useCallback(() => {
    const cols = Math.ceil(window.innerWidth / STEP_X) + EXTRA;
    const rows = Math.ceil(window.innerHeight / STEP_Y) + EXTRA;
    return { rows, cols };
  }, [STEP_X, STEP_Y, EXTRA]);

  // Build tile DOM elements
  const buildGrid = useCallback(() => {
    if (!layerRef.current) return;

    const { rows, cols } = computeGridDimensions();
    const layer = layerRef.current;

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

  // Render tiles
  const renderTiles = useCallback(() => {
    const { tiles, rows, cols } = gridRef.current;
    if (!tiles.length) return;

    const camera = cameraRef.current;
    const { x: camX, y: camY, zoom } = camera;

    const ox = mod(-camX, STEP_X);
    const oy = mod(-camY, STEP_Y);
    const col0 = Math.floor(camX / STEP_X);
    const row0 = Math.floor(camY / STEP_Y);

    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, idx++) {
        const wc = c - 1 + col0;
        const wr = r - 1 + row0;
        const tile = tiles[idx];

        if (tile.wc !== wc || tile.wr !== wr) {
          tile.wc = wc;
          tile.wr = wr;

          const imgUrl = imageForCell(wc, wr);
          if (imgUrl) {
            tile.el.style.setProperty("--img", `url("${imgUrl}")`);
          } else {
            tile.el.style.setProperty("--img", "none");
          }

          if (!tile.el.dataset.bgSet) {
            tile.el.style.background = `url("/background.png") center/cover no-repeat`;
            tile.el.dataset.bgSet = "true";
          }

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

    if (layerRef.current) {
      layerRef.current.style.transform = `scale(${zoom})`;
    }
  }, [STEP_X, STEP_Y, imageForCell, quantizeToDevicePixels]);

  // Animation loop
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
  }, [renderTiles]);

  // Setup events
  const setupEvents = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

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

      const moved = Math.hypot(
        e.clientX - physics.pressX,
        e.clientY - physics.pressY
      );

      if (physics.pressTile && moved < 8) {
        const wc = parseInt(physics.pressTile.dataset.wc, 10);
        const wr = parseInt(physics.pressTile.dataset.wr, 10);

        if (!isNaN(wc) && !isNaN(wr)) {
          const imgUrl = imageForCell(wc, wr);
          if (imgUrl) {
            setModalTitle(`Image — cell (${wc}, ${wr})`);
            setModalImageSrc(imgUrl);
            setModalOpen(true);
          }
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

  // Init grid
  const initGrid = useCallback(() => {
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

  // Resize handler
  const handleResize = useCallback(() => {
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

  // Main init
  useEffect(() => {
    if (!IMAGES.length) return;

    initGrid();
    const removeEvents = setupEvents();
    const removeResizeHandler = handleResize();

    animFrameRef.current = requestAnimationFrame(animationLoop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      removeEvents?.();
      removeResizeHandler?.();
    };
  }, [IMAGES, initGrid, setupEvents, handleResize, animationLoop]);

  // Modal close
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
      overflow: hidden;
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
      background: none;
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
    .emptyState {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      background: black;
      font: 600 18px/1.4 system-ui, sans-serif;
      text-align: center;
      padding: 24px;
    }
  `;

  if (!IMAGES.length) {
    return (
      <>
        <style>{styles}</style>
        <div className="emptyState">
          No images found in <code style={{ marginLeft: 6 }}>src/assets/images/</code>
        </div>
      </>
    );
  }

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