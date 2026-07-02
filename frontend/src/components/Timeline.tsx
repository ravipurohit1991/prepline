import { useEffect, useRef, useState } from 'react';
import type { EquipmentUse, StepStatus } from '../api/types';
import { usageSegments, type Interval } from '../lib/lanes';
import { fmtClock } from '../lib/time';
import { hueFor } from '../theme';

export interface TimelineTrack {
  id: string;
  name: string;
  hueIndex: number;
}

export interface TimelineBlock {
  id: string;
  trackId: string;
  name: string;
  start: Date;
  end: Date;
  attention: 'active' | 'passive';
  equipment: EquipmentUse[];
  status?: StepStatus;
}

interface TimelineProps {
  tracks: TimelineTrack[];
  blocks: TimelineBlock[];
  serveAt: Date;
  serveEta?: Date;
  now?: Date;
  mode?: 'light' | 'service';
  compact?: boolean;
  showLanes?: boolean;
  /** capacity labels for the lanes, e.g. { cooks: 1, burners: 4 } */
  capacities?: { cooks: number; burners: number; oven_slots: number };
}

function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function tickStepMinutes(spanMinutes: number): number {
  if (spanMinutes <= 100) return 15;
  if (spanMinutes <= 200) return 30;
  if (spanMinutes <= 420) return 60;
  return 120;
}

const MONO = "'IBM Plex Mono', Consolas, monospace";
const BASE = "'Archivo Variable', 'Segoe UI', sans-serif";

export function Timeline({
  tracks,
  blocks,
  serveAt,
  serveEta,
  now,
  mode = 'light',
  compact = false,
  showLanes = true,
  capacities,
}: TimelineProps) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();

  const dark = mode === 'service';
  const palette = {
    text: dark ? '#F5EFE6' : '#201B14',
    muted: dark ? '#A79C8C' : '#6E6558',
    hairline: dark ? '#3A342B' : '#E2DCD2',
    tape: dark ? '#7A97D8' : '#2B5BB7',
    tapeFill: '#2B5BB7',
    late: dark ? '#F2803B' : '#B02E0C',
    lane: dark ? '#F5EFE6' : '#201B14',
  };

  const labelW = compact ? 128 : 172;
  const rowH = compact ? 22 : 38;
  const rowGap = compact ? 5 : 8;
  const rulerH = 24;
  const laneH = compact ? 14 : 20;
  const laneGap = 4;
  const lanesBlockH = showLanes ? 14 + 3 * (laneH + laneGap) : 0;

  if (blocks.length === 0) return null;

  const times = blocks.flatMap((b) => [b.start.getTime(), b.end.getTime()]);
  const serveMs = serveAt.getTime();
  const etaMs = serveEta?.getTime() ?? serveMs;
  const rawStart = Math.min(...times, now ? now.getTime() : Infinity);
  const rawEnd = Math.max(...times, serveMs, etaMs, now ? now.getTime() : -Infinity);
  const span = rawEnd - rawStart;
  const domainStart = rawStart - Math.max(4 * 60_000, span * 0.02);
  const domainEnd = rawEnd + Math.max(10 * 60_000, span * 0.06);

  const plotW = Math.max(320, width) - labelW - 8;
  const x = (ms: number) => labelW + ((ms - domainStart) / (domainEnd - domainStart)) * plotW;

  const tracksH = tracks.length * rowH + (tracks.length - 1) * rowGap;
  const height = rulerH + 8 + tracksH + lanesBlockH + 8;
  const plotTop = rulerH + 8;
  const plotBottom = plotTop + tracksH + (showLanes ? lanesBlockH : 0);

  // ruler ticks aligned to the local wall clock
  const step = tickStepMinutes(span / 60_000);
  const ticks: number[] = [];
  const first = new Date(domainStart);
  first.setSeconds(0, 0);
  first.setMinutes(Math.ceil(first.getMinutes() / step) * step);
  for (let t = first.getTime(); t <= domainEnd; t += step * 60_000) ticks.push(t);

  const trackIndex = new Map(tracks.map((t, i) => [t.id, i]));

  const laneDefs = showLanes
    ? [
        {
          name: capacities ? `Hands ×${capacities.cooks}` : 'Hands',
          segments: usageSegments(
            blocks
              .filter((b) => b.attention === 'active')
              .map<Interval>((b) => ({ start: b.start.getTime(), end: b.end.getTime() })),
          ),
          capacity: capacities?.cooks ?? 1,
        },
        {
          name: capacities ? `Burners ×${capacities.burners}` : 'Burners',
          segments: usageSegments(
            blocks
              .filter((b) => b.equipment.some((e) => e.kind === 'burner'))
              .map<Interval>((b) => ({ start: b.start.getTime(), end: b.end.getTime() })),
          ),
          capacity: capacities?.burners ?? 4,
        },
        {
          name: 'Oven',
          segments: usageSegments(
            blocks
              .filter((b) => b.equipment.some((e) => e.kind === 'oven'))
              .map<Interval>((b) => {
                const oven = b.equipment.find((e) => e.kind === 'oven');
                return {
                  start: b.start.getTime(),
                  end: b.end.getTime(),
                  label: oven?.temp_c ? `${oven.temp_c}°` : undefined,
                };
              }),
          ),
          capacity: capacities?.oven_slots ?? 2,
        },
      ]
    : [];

  const flag = (ms: number, label: string, fill: string, y: number) => {
    const cx = Math.min(Math.max(x(ms), labelW + 34), labelW + plotW - 40);
    const w = label.length * 6.4 + 14;
    return (
      <g key={label}>
        <rect x={cx - w / 2} y={y} width={w} height={17} rx={4} fill={fill} />
        <text
          x={cx}
          y={y + 12}
          textAnchor="middle"
          fontFamily={MONO}
          fontSize={10.5}
          fontWeight={600}
          fill="#FFFFFF"
        >
          {label}
        </text>
      </g>
    );
  };

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Cooking timeline for ${tracks.length} dishes, serving at ${fmtClock(serveAt)}`}
      >
        <defs>
          <pattern
            id={`hatch-${mode}`}
            width="5"
            height="5"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="5" height="5" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="5" stroke={palette.text} strokeOpacity="0.14" />
          </pattern>
        </defs>

        {/* ruler */}
        {ticks.map((t) => (
          <g key={t}>
            <text
              x={x(t)}
              y={rulerH - 9}
              textAnchor="middle"
              fontFamily={MONO}
              fontSize={10}
              fill={palette.muted}
            >
              {fmtClock(new Date(t))}
            </text>
            <line
              x1={x(t)}
              y1={rulerH - 4}
              x2={x(t)}
              y2={plotBottom}
              stroke={palette.hairline}
              strokeWidth={1}
            />
          </g>
        ))}

        {/* tracks */}
        {tracks.map((track, i) => {
          const y = plotTop + i * (rowH + rowGap);
          const hue = hueFor(track.hueIndex);
          return (
            <g key={track.id}>
              <rect x={0} y={y + rowH / 2 - 5} width={10} height={10} rx={3} fill={hue.deep} />
              <text
                x={16}
                y={y + rowH / 2 + 4}
                fontFamily={BASE}
                fontSize={compact ? 11 : 12.5}
                fontWeight={600}
                fill={palette.text}
              >
                {track.name.length > (compact ? 17 : 22)
                  ? `${track.name.slice(0, compact ? 16 : 21)}…`
                  : track.name}
              </text>
              <line
                x1={labelW}
                y1={y + rowH / 2}
                x2={labelW + plotW}
                y2={y + rowH / 2}
                stroke={palette.hairline}
                strokeWidth={1}
                strokeDasharray="1 4"
              />
            </g>
          );
        })}

        {/* blocks */}
        {blocks.map((block) => {
          const i = trackIndex.get(block.trackId);
          if (i === undefined) return null;
          const y = plotTop + i * (rowH + rowGap);
          const hue = hueFor(tracks[i].hueIndex);
          const bx = x(block.start.getTime()) + 1;
          const bw = Math.max(3, x(block.end.getTime()) - x(block.start.getTime()) - 2);
          const done = block.status === 'done';
          const running = block.status === 'running';
          const fill = dark ? hue.service : hue.tint;
          const edge = dark ? hue.service : hue.deep;
          const minutes = Math.round((block.end.getTime() - block.start.getTime()) / 60_000);
          const oven = block.equipment.find((e) => e.kind === 'oven');
          const label = done ? `✓ ${block.name}` : block.name;
          const maxChars = Math.floor((bw - 14) / 6.1);
          return (
            <g key={block.id} opacity={done ? 0.45 : 1}>
              <title>
                {`${block.name} — ${tracks[i].name}\n${fmtClock(block.start)}–${fmtClock(block.end)} · ${minutes} min · ${block.attention}${oven ? ` · oven ${oven.temp_c ?? ''}°C` : ''}`}
              </title>
              <rect
                x={bx}
                y={y + 2}
                width={bw}
                height={rowH - 4}
                rx={4}
                fill={fill}
                fillOpacity={dark ? (block.attention === 'passive' ? 0.22 : 0.34) : 1}
                stroke={edge}
                strokeOpacity={dark ? 0.9 : 0.55}
                strokeWidth={running ? 2 : 1}
                className={running ? 'tl-running-outline' : undefined}
              />
              {block.attention === 'passive' && (
                <rect
                  x={bx}
                  y={y + 2}
                  width={bw}
                  height={rowH - 4}
                  rx={4}
                  fill={`url(#hatch-${mode})`}
                  pointerEvents="none"
                />
              )}
              {!dark && (
                <rect x={bx} y={y + 2} width={3} height={rowH - 4} rx={1.5} fill={edge} />
              )}
              {!compact && maxChars >= 7 && (
                <text
                  x={bx + 8}
                  y={y + rowH / 2 + 4}
                  fontFamily={BASE}
                  fontSize={11.5}
                  fontWeight={500}
                  fill={palette.text}
                  pointerEvents="none"
                >
                  {label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label}
                </text>
              )}
              {!compact && oven?.temp_c && bw >= 120 && (
                <text
                  x={bx + bw - 7}
                  y={y + rowH / 2 + 4}
                  textAnchor="end"
                  fontFamily={MONO}
                  fontSize={9.5}
                  fill={dark ? hue.service : hue.deep}
                  pointerEvents="none"
                >
                  {oven.temp_c}°
                </text>
              )}
            </g>
          );
        })}

        {/* resource lanes: the constraints, made visible */}
        {laneDefs.map((lane, li) => {
          const y = plotTop + tracksH + 14 + li * (laneH + laneGap);
          return (
            <g key={lane.name}>
              <text
                x={16}
                y={y + laneH / 2 + 3.5}
                fontFamily={MONO}
                fontSize={10}
                fill={palette.muted}
              >
                {lane.name}
              </text>
              {lane.segments.map((segment) => {
                const sx = x(segment.start);
                const sw = Math.max(2, x(segment.end) - sx);
                const load = Math.min(1, segment.count / Math.max(1, lane.capacity));
                return (
                  <g key={`${segment.start}-${segment.end}`}>
                    <rect
                      x={sx}
                      y={y}
                      width={sw}
                      height={laneH}
                      rx={3}
                      fill={palette.lane}
                      fillOpacity={0.14 + 0.5 * load}
                    />
                    {sw >= 30 && (segment.label || segment.count > 1) && (
                      <text
                        x={sx + sw / 2}
                        y={y + laneH / 2 + 3.5}
                        textAnchor="middle"
                        fontFamily={MONO}
                        fontSize={9.5}
                        fill={dark ? '#16130F' : '#FFFFFF'}
                        fillOpacity={load > 0.55 ? 1 : 0}
                      >
                        {segment.label ?? `×${segment.count}`}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* serve target and, when pushed, the live ETA */}
        <line
          x1={x(serveMs)}
          y1={rulerH + 2}
          x2={x(serveMs)}
          y2={plotBottom}
          stroke={palette.tapeFill}
          strokeWidth={1.6}
        />
        {flag(serveMs, `SERVE ${fmtClock(serveAt)}`, palette.tapeFill, 1)}
        {etaMs > serveMs + 30_000 && (
          <>
            <line
              x1={x(etaMs)}
              y1={rulerH + 2}
              x2={x(etaMs)}
              y2={plotBottom}
              stroke={palette.late}
              strokeWidth={1.6}
              strokeDasharray="5 4"
            />
            {flag(etaMs, `ETA ${fmtClock(new Date(etaMs))}`, palette.late, 1)}
          </>
        )}

        {/* playhead */}
        {now && now.getTime() > domainStart && now.getTime() < domainEnd && (
          <g>
            <line
              x1={x(now.getTime())}
              y1={rulerH + 2}
              x2={x(now.getTime())}
              y2={plotBottom}
              stroke={palette.text}
              strokeWidth={1.5}
            />
            <path
              d={`M ${x(now.getTime()) - 5} ${rulerH + 2} h 10 l -5 7 z`}
              fill={palette.text}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
