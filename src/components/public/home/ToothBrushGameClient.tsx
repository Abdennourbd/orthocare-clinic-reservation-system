"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "framer-motion";
import {
  createGameState,
  hoverAt,
  isWon,
  REQUIRED_PASSES,
  type GameState,
} from "@/lib/game/toothBrush";

const W = 640;
const H = 400;

type CoverCrop = { sx: number; sy: number; sw: number; sh: number };
type Sparkle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  teal: boolean;
};

/** CSS object-cover equivalent: which source rect of `img` maps onto W×H. */
function coverCrop(
  imgW: number,
  imgH: number,
  w: number,
  h: number,
): CoverCrop {
  const scale = Math.max(w / imgW, h / imgH);
  const sw = w / scale;
  const sh = h / scale;
  return {
    sx: (imgW - sw) / 2,
    sy: (imgH - sh) / 2,
    sw,
    sh,
  };
}

/**
 * Find the best (dx, dy) source-crop shift so the "after" picture lines up
 * with the "before" one. Downsample both to grayscale and scan a small shift
 * range for the lowest sum of squared differences.
 */
function alignImages(
  before: HTMLImageElement,
  after: HTMLImageElement,
): { dx: number; dy: number; crop: CoverCrop } {
  const GW = 96;
  const GH = 60;
  const crop = coverCrop(before.naturalWidth, before.naturalHeight, W, H);

  const sample = (img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = GW;
    c.height = GH;
    const g = c.getContext("2d")!;
    g.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, GW, GH);
    const d = g.getImageData(0, 0, GW, GH).data;
    const out = new Float32Array(GW * GH);
    for (let i = 0; i < out.length; i++) {
      out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }
    return out;
  };

  const a = sample(before);
  const b = sample(after);
  let best = Infinity;
  let bestDx = 0;
  let bestDy = 0;
  const margin = 5;

  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      let ssd = 0;
      outer: for (let y = margin; y < GH - margin; y++) {
        const sy = y + dy;
        if (sy < margin || sy >= GH - margin) continue;
        for (let x = margin; x < GW - margin; x++) {
          const sx = x + dx;
          if (sx < margin || sx >= GW - margin) continue;
          const diff = a[y * GW + x] - b[sy * GW + sx];
          ssd += diff * diff;
          if (ssd > best) break outer;
        }
      }
      if (ssd < best) {
        best = ssd;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  const pxPer = crop.sw / GW;
  return { dx: bestDx * pxPer, dy: bestDy * pxPer, crop };
}

export default function ToothBrushGameClient() {
  const t = useTranslations("Home");
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const effectsRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const beforeImgRef = useRef<HTMLImageElement | null>(null);
  const afterImgRef = useRef<HTMLImageElement | null>(null);
  const alignRef = useRef({ dx: 0, dy: 0, crop: { sx: 0, sy: 0, sw: W, sh: H } });
  const stateRef = useRef<GameState | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, active: false });
  const sparklesRef = useRef<Sparkle[]>([]);
  const [won, setWon] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [passes, setPasses] = useState(0);

  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const start = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const effects = effectsRef.current;
    if (!canvas || !ctx || !effects) return;

    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    effects.width = W;
    effects.height = H;

    if (!maskRef.current) {
      maskRef.current = document.createElement("canvas");
    }
    const mask = maskRef.current;
    mask.width = W;
    mask.height = H;
    mask.getContext("2d")?.clearRect(0, 0, W, H);

    sparklesRef.current = [];
    stateRef.current = createGameState(W, H);
    setWon(false);
    setPasses(0);
  }, []);

  const spawnSparkles = useCallback((x: number, y: number, n: number, boost = 1) => {
    const list = sparklesRef.current;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (15 + Math.random() * 40) * boost;
      const maxLife = 0.35 + Math.random() * 0.35;
      list.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.5 + Math.random() * 2.5,
        life: maxLife,
        maxLife,
        teal: Math.random() < 0.35,
      });
    }
    if (list.length > 160) list.splice(0, list.length - 160);
  }, []);

  const stampMask = useCallback((x: number, y: number) => {
    const mask = maskRef.current;
    const maskCtx = mask?.getContext("2d");
    const state = stateRef.current;
    if (!mask || !maskCtx || !state) return;

    // Small, soft, low-opacity stamp per frame: the reveal builds up slowly.
    const radius = state.brushRadius * 1.8;
    const gradient = maskCtx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    gradient.addColorStop(0.6, "rgba(255, 255, 255, 0.16)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    maskCtx.globalCompositeOperation = "source-over";
    maskCtx.beginPath();
    maskCtx.arc(x, y, radius, 0, Math.PI * 2);
    maskCtx.fillStyle = gradient;
    maskCtx.fill();
  }, []);

  const drawFrame = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const effects = effectsRef.current;
      const fctx = effects?.getContext("2d");
      const state = stateRef.current;
      if (!canvas || !ctx || !effects || !fctx || !state) return;

      const pointer = pointerRef.current;
      const gameWon = isWon(state);
      const after = afterImgRef.current;

      // 1. Slowly build the reveal mask where the brush is.
      if (!gameWon && pointer.active && after) {
        stampMask(pointer.x, pointer.y);
        spawnSparkles(pointer.x, pointer.y, 2);
      }

      // 2. Effects layer: pulsing glow around the brush + twinkling sparkles.
      fctx.clearRect(0, 0, W, H);
      if (!gameWon && pointer.active) {
        const pulse = 0.2 + 0.08 * Math.sin(now / 220);
        const r = state.brushRadius * 2.4;
        const glow = fctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, r);
        glow.addColorStop(0, `rgba(45, 212, 191, ${pulse + 0.15})`);
        glow.addColorStop(0.5, `rgba(45, 212, 191, ${pulse * 0.4})`);
        glow.addColorStop(1, "rgba(45, 212, 191, 0)");
        fctx.fillStyle = glow;
        fctx.beginPath();
        fctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2);
        fctx.fill();
      }

      const sparks = sparklesRef.current;
      const dt = 1 / 60;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life -= dt;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const damp = 1 - 1.4 * dt;
        p.vx *= damp;
        p.vy *= damp;
        const alpha = Math.max(0, p.life / p.maxLife);
        const s = p.size * (0.4 + 0.6 * alpha);
        fctx.strokeStyle = p.teal
          ? `rgba(45, 212, 191, ${alpha})`
          : `rgba(255, 255, 255, ${alpha})`;
        fctx.lineWidth = 1.2;
        fctx.beginPath();
        fctx.moveTo(p.x - s, p.y);
        fctx.lineTo(p.x + s, p.y);
        fctx.moveTo(p.x, p.y - s);
        fctx.lineTo(p.x, p.y + s);
        fctx.stroke();
      }

      // 3. Reveal canvas: "after" picture clipped to the accumulated mask.
      if (after) {
        const { dx, dy, crop } = alignRef.current;
        const sx = Math.min(Math.max(crop.sx + dx, 0), after.naturalWidth - crop.sw);
        const sy = Math.min(Math.max(crop.sy + dy, 0), after.naturalHeight - crop.sh);
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(after, sx, sy, crop.sw, crop.sh, 0, 0, W, H);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(maskRef.current!, 0, 0);
        ctx.globalCompositeOperation = "source-over";
      }
    },
    [spawnSparkles, stampMask],
  );

  useEffect(() => {
    if (!mounted || prefersReducedMotion) return;
    const before = new window.Image();
    const after = new window.Image();
    before.src = "/images/beforewhitening.jpeg";
    after.src = "/images/afterwhitening.jpeg";
    let cancelled = false;
    let loaded = 0;
    let failed = false;
    const onLoad = () => {
      if (cancelled || failed) return;
      loaded += 1;
      if (loaded === 2) {
        beforeImgRef.current = before;
        afterImgRef.current = after;
        alignRef.current = alignImages(before, after);
        start();
      }
    };
    const onError = () => {
      if (cancelled) return;
      failed = true;
      setLoadFailed(true);
    };
    before.onload = onLoad;
    after.onload = onLoad;
    before.onerror = onError;
    after.onerror = onError;
    return () => {
      cancelled = true;
    };
  }, [mounted, prefersReducedMotion, start]);

  useEffect(() => {
    if (!mounted || prefersReducedMotion) return;
    let raf = 0;
    const loop = (now: number) => {
      drawFrame(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mounted, prefersReducedMotion, drawFrame]);

  const toCanvas = (clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  };

  const track = useCallback(
    (clientX: number, clientY: number) => {
      const state = stateRef.current;
      if (!state || isWon(state)) return;
      const { x, y } = toCanvas(clientX, clientY);
      pointerRef.current = { x, y, active: true };
      const next = hoverAt(state, x);
      stateRef.current = next;
      setPasses(next.passes);
      if (isWon(next)) {
        setWon(true);
        spawnSparkles(x, y, 42, 1.8);
      }
    },
    [spawnSparkles],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || !mounted) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    track(e.clientX, e.clientY);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || !mounted) return;
    track(e.clientX, e.clientY);
  };
  const handlePointerEnd = () => {
    pointerRef.current.active = false;
  };

  const TOOTHBRUSH_CURSOR =
    "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"40\" viewBox=\"0 0 40 40\"><rect x=\"10\" y=\"12\" width=\"16\" height=\"8\" rx=\"3\" fill=\"%230d9488\"/><g stroke=\"%23ffffff\" stroke-width=\"2\" stroke-linecap=\"round\"><line x1=\"12\" y1=\"8\" x2=\"12\" y2=\"12\"/><line x1=\"16\" y1=\"7\" x2=\"16\" y2=\"12\"/><line x1=\"20\" y1=\"7\" x2=\"20\" y2=\"12\"/><line x1=\"24\" y1=\"8\" x2=\"24\" y2=\"12\"/></g><path d=\"M10 18 L2 30\" stroke=\"%230d9488\" stroke-width=\"5\" stroke-linecap=\"round\"/></svg>') 16 8, auto";

  if (!mounted) {
    return (
      <div className="bg-teal-50 p-8 rounded-3xl text-center flex flex-col items-center shadow-sm">
        <h2 className="text-3xl font-bold text-teal-900 mb-4">{t("gameTitle")}</h2>
        <div style={{ width: "100%", maxWidth: 640, height: 400 }} className="rounded-2xl bg-teal-100/60" />
      </div>
    );
  }

  if (prefersReducedMotion || loadFailed) {
    return (
      <div className="bg-teal-50 p-8 rounded-3xl text-center flex flex-col items-center shadow-sm">
        <h2 className="text-3xl font-bold text-teal-900 mb-4">{t("gameTitle")}</h2>
        {won ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/afterwhitening.jpeg"
              alt={t("gameCaption")}
              className="w-full max-w-2xl rounded-2xl object-cover"
            />
            <p className="mt-4 text-teal-700 max-w-md">{t("gameWonSub")}</p>
          </>
        ) : (
          <>
            <p className="text-teal-700 max-w-md">{t("gameFallback")}</p>
            {!loadFailed && (
              <button
                type="button"
                onClick={() => setWon(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-teal-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-teal-700"
              >
                {t("gameReveal")}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-lg border border-teal-100 text-center flex flex-col items-center">
      <h2 className="text-3xl font-bold text-teal-900 mb-2">{t("gameTitle")}</h2>
      <p className="text-zinc-600 max-w-md mb-6">{t("gameIntro")}</p>

      <div
        ref={wrapRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl shadow-inner bg-teal-50 touch-none"
        style={{ aspectRatio: "640 / 400", cursor: TOOTHBRUSH_CURSOR }}
        role="img"
        aria-label={t("gameAriaLabel")}
      >
        {/* Before picture: the stained smile, always underneath */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/beforewhitening.jpeg"
          alt={t("gameCaption")}
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Canvas overlay: progressively reveals the "after" picture */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {/* Effects layer: glow + sparkles */}
        <canvas ref={effectsRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {won && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm transition-all duration-500">
            <div className="text-center px-6">
              <p className="text-3xl font-extrabold text-teal-600 mb-2 animate-bounce">
                {t("gameWon")}
              </p>
              <p className="text-zinc-700 font-medium mb-4">{t("gameWonSub")}</p>
              <div className="flex flex-wrap gap-3 justify-center">
                <button
                  type="button"
                  onClick={start}
                  className="rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  {t("gamePlayAgain")}
                </button>
                <a
                  href="#book"
                  className="rounded-full bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
                >
                  {t("gameBook")}
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-sm text-zinc-500 italic">{t("gameCaption")}</p>

      {!won && (
        <div className="mt-4 w-full max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-600">{t("gameCTA")}</span>
            <div className="h-2 flex-1 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-200"
                style={{ width: `${Math.round((passes / REQUIRED_PASSES) * 100)}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-teal-700 tabular-nums">
              {Math.min(passes, REQUIRED_PASSES)}/{REQUIRED_PASSES}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}