"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "framer-motion";
import {
  createGameState,
  brushAt,
  isClean,
  progress,
  type GameState,
} from "@/lib/game/toothBrush";

const W = 640;
const H = 400;

export default function ToothBrushGameClient() {
  const t = useTranslations("Home");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const [won, setWon] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [cleanliness, setCleanliness] = useState(0);

  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const fillPlaque = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    
    // Fill with a dirty plaque color
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(194, 150, 60, 0.85)";
    ctx.fillRect(0, 0, W, H);
    
    // Add some noise/texture for realism
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const r = Math.random() * 3 + 1;
      ctx.fillStyle = `rgba(130, 90, 30, ${Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const start = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    stateRef.current = createGameState(W, H, 8);
    setWon(false);
    setCleanliness(0);
    fillPlaque();
  }, [fillPlaque]);

  useEffect(() => {
    if (!mounted || prefersReducedMotion) return;
    start();
  }, [mounted, prefersReducedMotion, start]);

  const brush = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const state = stateRef.current;
      if (!canvas || !ctx || !state || won) return;

      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * W;
      const y = ((clientY - rect.top) / rect.height) * H;

      // Erase the plaque on the canvas
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, state.brushRadius * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Update the logical game state
      const next = brushAt(state, x, y);
      stateRef.current = next;
      setCleanliness(progress(next));
      if (isClean(next)) {
        setWon(true);
      }
    },
    [won],
  );

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (prefersReducedMotion || !mounted) return;
    brush(e.clientX, e.clientY);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (prefersReducedMotion || !mounted) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    brush(e.clientX, e.clientY);
  };

  if (!mounted) {
    return (
      <div className="bg-teal-50 p-8 rounded-3xl text-center flex flex-col items-center shadow-sm">
        <h2 className="text-3xl font-bold text-teal-900 mb-4">{t("gameTitle")}</h2>
        <div style={{ width: "100%", maxWidth: 640, height: 400 }} className="rounded-2xl bg-teal-100/60" />
      </div>
    );
  }

  if (prefersReducedMotion) {
    return (
      <div className="bg-teal-50 p-8 rounded-3xl text-center flex flex-col items-center shadow-sm">
        <h2 className="text-3xl font-bold text-teal-900 mb-4">{t("gameTitle")}</h2>
        <p className="text-teal-700 max-w-md">{t("gameFallback")}</p>
        <button
          type="button"
          onClick={() => setWon(true)}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-teal-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-teal-700"
        >
          {t("gameReveal")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-lg border border-teal-100 text-center flex flex-col items-center">
      <h2 className="text-3xl font-bold text-teal-900 mb-2">{t("gameTitle")}</h2>
      <p className="text-zinc-600 max-w-md mb-6">{t("gameIntro")}</p>

      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl shadow-inner bg-teal-50" style={{ aspectRatio: "640 / 400" }}>
        {/* Realistic background image of a clean smile */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/smile.jpg"
          alt="Clean smile"
          className="absolute inset-0 w-full h-full object-cover"
        />
        
        {/* Canvas overlay with the plaque */}
        <canvas
          ref={canvasRef}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          className="absolute inset-0 w-full h-full touch-none"
          style={{ cursor: "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%230d9488\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"rgba(13, 148, 136, 0.2)\"/></svg>') 12 12, auto" }}
          role="img"
          aria-label={t("gameAriaLabel")}
        />

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

      {!won && (
        <div className="mt-5 w-full max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-600">{t("gameCTA")}</span>
            <div className="h-2 flex-1 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-200"
                style={{ width: `${Math.round(cleanliness * 100)}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-teal-700 tabular-nums">
              {Math.round(cleanliness * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
