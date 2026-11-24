import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiError } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IMAGE_TYPES, cropToDataUrl, drawCrop, loadImage } from "@/lib/imageCrop";
import { cn, initials } from "@/lib/utils";

/** Photo or logo with a crop window. `onSave` gets a small square JPEG as a data URL and should throw when the upload fails. */
export function PhotoUploader({
  src, name, shape = "circle", sizeClass = "h-24 w-24", canEdit = true, noun = "photo", onSave, onRemove,
}: {
  src?: string | null; name?: string; shape?: "circle" | "square"; sizeClass?: string; canEdit?: boolean; noun?: string;
  onSave: (dataUrl: string) => Promise<void>; onRemove?: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [ox, setOx] = useState(0);
  const [oy, setOy] = useState(0);
  const [busy, setBusy] = useState(false);

  const pick = async (f?: File) => {
    if (input.current) input.current.value = "";
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) return toast.error("Choose a JPG, PNG or WebP image");
    if (f.size > 10 * 1024 * 1024) return toast.error("That image is larger than 10 MB");
    try { setImg(await loadImage(f)); setZoom(1); setOx(0); setOy(0); } catch (e) { toast.error((e as Error).message); }
  };

  const save = async () => {
    if (!img) return;
    setBusy(true);
    try { await onSave(cropToDataUrl(img, zoom, ox, oy)); setImg(null); } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };

  const remove = async () => {
    if (!onRemove || !window.confirm(`Remove the ${noun}?`)) return;
    setBusy(true);
    try { await onRemove(); } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };

  const radius = shape === "circle" ? "rounded-full" : "rounded-2xl";
  const range = "w-full accent-[hsl(var(--primary))]";

  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" disabled={!canEdit || busy} onClick={() => input.current?.click()} aria-label={`Change ${noun}`} className={cn("group relative shrink-0 overflow-hidden", radius, sizeClass)}>
        {shape === "circle" ? (
          <Avatar className="h-full w-full"><AvatarImage src={src || undefined} /><AvatarFallback className="text-2xl">{initials(name)}</AvatarFallback></Avatar>
        ) : src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-primary/10 text-2xl font-semibold text-primary">{(name || "?").charAt(0).toUpperCase()}</div>}
        {canEdit && <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}</span>}
      </button>
      {canEdit && (
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}><Camera className="h-3.5 w-3.5" /> {src ? "Change" : "Add"}</Button>
          {src && onRemove && <Button type="button" size="sm" variant="ghost" disabled={busy} className="text-destructive" onClick={remove}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />

      <Dialog open={!!img} onOpenChange={(v) => !v && !busy && setImg(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Adjust your {noun}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-center">
              <canvas
                ref={(el) => { if (el && img) drawCrop(el, img, 256, zoom, ox, oy); }}
                width={256} height={256}
                className={cn("h-64 w-64 border border-border", radius)}
              />
            </div>
            <label className="block space-y-1 text-xs text-muted-foreground">Zoom<input type="range" min={1} max={3} step={0.02} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className={range} /></label>
            <label className="block space-y-1 text-xs text-muted-foreground">Move left or right<input type="range" min={-1} max={1} step={0.02} value={ox} onChange={(e) => setOx(Number(e.target.value))} className={range} /></label>
            <label className="block space-y-1 text-xs text-muted-foreground">Move up or down<input type="range" min={-1} max={1} step={0.02} value={oy} onChange={(e) => setOy(Number(e.target.value))} className={range} /></label>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setImg(null)}>Cancel</Button>
            <Button disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save {noun}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}