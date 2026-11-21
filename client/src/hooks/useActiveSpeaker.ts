import { useEffect, useRef, useState } from "react";

export interface SpeakerInput { id: string; stream: MediaStream | null; on: boolean }

/** Watches how loud every stream is. `talking` = who is speaking now, `loudest` = who spoke most recently (kept for 2 seconds so it does not flicker). */
export function useActiveSpeaker(inputs: SpeakerInput[]) {
  const [state, setState] = useState<{ loudest: string | null; talking: string[] }>({ loudest: null, talking: [] });
  const ref = useRef(inputs);
  ref.current = inputs;

  useEffect(() => {
    let ctx: AudioContext | null = null;
    const nodes = new Map<string, { track: string; src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Uint8Array }>();
    const smooth = new Map<string, number>();
    let stick: { id: string; at: number } | null = null;
    let last = "";

    const drop = (id: string) => {
      const n = nodes.get(id);
      if (n) { try { n.src.disconnect(); } catch { /* already gone */ } }
      nodes.delete(id);
      smooth.delete(id);
    };

    const tick = () => {
      const list = ref.current;
      const alive = new Set(list.map((i) => i.id));
      for (const id of [...nodes.keys()]) if (!alive.has(id)) drop(id);

      let best = 0.02;
      let loudest: string | null = null;
      const talking: string[] = [];

      for (const i of list) {
        const track = i.stream?.getAudioTracks()[0];
        if (!track || !i.on || track.readyState !== "live") { drop(i.id); continue; }
        let n = nodes.get(i.id);
        if (!n || n.track !== track.id) {
          drop(i.id);
          try {
            if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
            const src = ctx.createMediaStreamSource(new MediaStream([track]));
            const an = ctx.createAnalyser();
            an.fftSize = 512;
            src.connect(an);
            n = { track: track.id, src, an, buf: new Uint8Array(an.fftSize) };
            nodes.set(i.id, n);
          } catch { continue; }
        }
        n.an.getByteTimeDomainData(n.buf);
        let sum = 0;
        for (const v of n.buf) { const x = (v - 128) / 128; sum += x * x; }
        const level = (smooth.get(i.id) ?? 0) * 0.5 + Math.sqrt(sum / n.buf.length) * 0.5;
        smooth.set(i.id, level);
        if (level > 0.02) {
          talking.push(i.id);
          if (level > best) { best = level; loudest = i.id; }
        }
      }

      const now = Date.now();
      if (loudest) stick = { id: loudest, at: now };
      else if (stick && now - stick.at > 2000) stick = null;

      const key = `${stick?.id || ""}|${talking.sort().join(",")}`;
      if (key !== last) { last = key; setState({ loudest: stick?.id ?? null, talking }); }
    };

    const timer = setInterval(tick, 200);
    return () => {
      clearInterval(timer);
      [...nodes.keys()].forEach(drop);
      ctx?.close().catch(() => undefined);
    };
  }, []);

  return state;
}