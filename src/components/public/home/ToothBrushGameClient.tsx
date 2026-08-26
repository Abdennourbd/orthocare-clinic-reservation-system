"use client";

import { useRef, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createGameState, brushAt, isClean, GameState } from "@/lib/game/toothBrush";
import { useReducedMotion } from "framer-motion";

export default function ToothBrushGameClient() {
  const t = useTranslations("Home");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [won, setWon] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || prefersReducedMotion) return;
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = 300;
    const height = 200;
    canvas.width = width;
    canvas.height = height;
    
    setGameState(createGameState(width, height));
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Draw initial plaque
    ctx.fillStyle = "#fef08a"; // yellow plaque
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#ffffff"; // tooth color
  }, [prefersReducedMotion, mounted]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (won || !gameState || prefersReducedMotion || !mounted) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;

    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    // Erase plaque (draw tooth color)
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();

    const newState = brushAt(gameState, x, y, 20);
    setGameState(newState);

    if (isClean(newState)) {
      setWon(true);
    }
  };

  if (!mounted) {
    // Avoid hydration mismatch by rendering a generic placeholder matching the server HTML
    return (
      <div className="bg-teal-50 p-8 rounded-2xl text-center flex flex-col items-center">
        <h2 className="text-3xl font-bold text-teal-900 mb-6">{t("gameTitle")}</h2>
        <div className="relative inline-block" style={{ width: "300px", height: "200px" }}></div>
        <p className="mt-4 text-sm text-teal-600 invisible">Placeholder</p>
      </div>
    );
  }

  if (prefersReducedMotion) {
    return (
      <div className="bg-teal-50 p-8 rounded-2xl text-center flex flex-col items-center">
        <h2 className="text-3xl font-bold text-teal-900 mb-4">{t("gameTitle")}</h2>
        <p className="text-teal-700">{t("gameFallback")}</p>
      </div>
    );
  }

  return (
    <div className="bg-teal-50 p-8 rounded-2xl text-center flex flex-col items-center" ref={containerRef}>
      <h2 className="text-3xl font-bold text-teal-900 mb-6">{t("gameTitle")}</h2>
      
      <div className="relative inline-block">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onTouchMove={handleMouseMove}
          className="rounded-lg shadow-inner cursor-crosshair touch-none"
          style={{ width: "300px", height: "200px" }}
          aria-label="Toothbrush mini-game"
          role="img"
        />
        {won && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-lg">
            <p className="text-2xl font-bold text-teal-600 animate-bounce">
              {t("gameWon")}
            </p>
          </div>
        )}
      </div>
      
      {!won && (
        <p className="mt-4 text-sm text-teal-600">
          {t("gameCTA")}
        </p>
      )}
    </div>
  );
}
