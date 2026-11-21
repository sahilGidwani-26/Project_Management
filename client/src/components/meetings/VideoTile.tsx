import { useEffect, useRef } from "react";
import { Hand, Loader2, MicOff, MoreVertical, Pin, PinOff } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const COLORS = ["#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#0891B2", "#CA8A04", "#DC2626"];
export const colorOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
export const initialOf = (s: string) => (s.trim().charAt(0) || "?").toUpperCase();

export interface TileProps {
  stream: MediaStream | null;
  name: string;
  local?: boolean;
  kind?: "cam" | "screen";
  micOn: boolean;
  camOn: boolean;
  hand?: boolean;
  speaking?: boolean;
  badges?: string[];
  conn?: "connecting" | "connected" | "failed";
  sinkId?: string;
  pinned?: boolean;
  onPin?: () => void;
  menu?: { label: string; onClick: () => void; danger?: boolean }[];
  compact?: boolean;
  className?: string;
}

export function VideoTile({ stream, name, local, kind = "cam", micOn, camOn, hand, speaking, badges = [], conn, sinkId, pinned, onPin, menu, compact, className }: TileProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const screen = kind === "screen";
  const showVideo = screen || camOn;

  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  // choose which speaker plays the sound (only where the browser supports it)
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && sinkId) el.setSinkId(sinkId).catch(() => undefined);
  }, [sinkId]);

  const reveal = "md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100";

  return (
    <div className={cn("group relative overflow-hidden rounded-xl bg-neutral-900", speaking && "ring-2 ring-emerald-400", className)}>
      {/* the video element always exists, because remote sound plays through it even when the camera is off */}
      <video ref={ref} autoPlay playsInline muted={!!local || screen} className={cn("absolute inset-0 h-full w-full", screen ? "bg-black object-contain" : "object-cover", local && !screen && "-scale-x-100", !showVideo && "invisible")} />

      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={cn("flex items-center justify-center rounded-full font-semibold text-white", compact ? "h-10 w-10 text-lg" : "h-20 w-20 text-3xl")} style={{ background: colorOf(name) }}>{initialOf(name)}</div>
        </div>
      )}

      {!local && conn === "connecting" && <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white"><Loader2 className="h-3 w-3 animate-spin" />Connecting…</div>}
      {!local && conn === "failed" && <div className="absolute left-2 top-2 rounded-md bg-red-600/90 px-2 py-0.5 text-[11px] text-white">Connection problem</div>}

      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
        <span className={cn("flex max-w-full items-center gap-1.5 truncate rounded-md bg-black/60 px-2 py-0.5 text-white", compact ? "text-[11px]" : "text-xs")}>
          {!micOn && !screen && <MicOff className="h-3 w-3 shrink-0 text-red-400" />}
          <span className="truncate">{name}</span>
          {badges.length > 0 && <span className="shrink-0 text-white/60">· {badges.join(" · ")}</span>}
        </span>
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-1">
        {hand && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-neutral-900"><Hand className="h-4 w-4" /></span>}
        {onPin && (
          <button type="button" onClick={onPin} aria-label={pinned ? "Unpin" : "Pin"} title={pinned ? "Unpin" : "Pin to the big screen"} className={cn("flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80", pinned ? "" : reveal)}>
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
        )}
        {menu && menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Options" className={cn("flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80", reveal)}><MoreVertical className="h-3.5 w-3.5" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.map((m) => <DropdownMenuItem key={m.label} onClick={m.onClick} className={m.danger ? "text-destructive focus:text-destructive" : ""}>{m.label}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}