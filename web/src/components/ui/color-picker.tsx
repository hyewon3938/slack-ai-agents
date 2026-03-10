'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { PRESET_COLORS, colorToHex } from '@/lib/types';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

const PRESET_LIST = Object.entries(PRESET_COLORS).filter(([k]) => k !== 'gray');

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const hex = colorToHex(value);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="h-8 w-8 rounded-full border-2 border-gray-200 transition hover:scale-110"
        style={{ backgroundColor: hex }}
        title={value}
      />
      {open && (
        <div className="absolute top-10 right-0 z-50 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          {/* 프리셋 색상 */}
          <div className="mb-3">
            <div className="mb-1.5 text-[10px] font-medium text-gray-400">프리셋</div>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_LIST.map(([name, { hex: presetHex }]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                  className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${
                    value === name ? 'ring-2 ring-blue-400 ring-offset-1' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: presetHex }}
                  title={name}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <div className="mb-1.5 text-[10px] font-medium text-gray-400">커스텀</div>
            <HslGradient
              hex={hex}
              onApply={(h) => {
                onChange(h);
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function HslGradient({ hex, onApply }: { hex: string; onApply: (hex: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hue, setHue] = useState(() => hexToHsl(hex)[0]);
  const [preview, setPreview] = useState(hex);
  const dragging = useRef(false);

  const drawCanvas = useCallback(
    (h: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const hCanvas = canvas.height;

      for (let x = 0; x < w; x++) {
        for (let y = 0; y < hCanvas; y++) {
          const s = (x / w) * 100;
          const l = 100 - (y / hCanvas) * 100;
          ctx.fillStyle = `hsl(${h}, ${s}%, ${l}%)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    },
    [],
  );

  useEffect(() => {
    drawCanvas(hue);
  }, [hue, drawCanvas]);

  const pickColor = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width - 1));
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height - 1));
      const s = (x / rect.width) * 100;
      const l = 100 - (y / rect.height) * 100;
      setPreview(hslToHex(hue, s, l));
    },
    [hue],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      dragging.current = true;
      pickColor(e);
    },
    [pickColor],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragging.current) pickColor(e);
    },
    [pickColor],
  );

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={232}
        height={120}
        className="w-full cursor-crosshair rounded"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      <input
        type="range"
        min={0}
        max={360}
        value={hue}
        onChange={(e) => setHue(Number(e.target.value))}
        className="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(to right,
            hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%),
            hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))`,
        }}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="h-6 w-6 rounded-full border border-gray-200"
            style={{ backgroundColor: preview }}
          />
          <span className="font-mono text-xs text-gray-500">{preview}</span>
        </div>
        <button
          type="button"
          onClick={() => onApply(preview)}
          className="rounded-md bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
        >
          적용
        </button>
      </div>
    </div>
  );
}
