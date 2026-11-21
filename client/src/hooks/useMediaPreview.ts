import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaDevices { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }

/** Asks for camera and microphone, shows a live preview and a mic level, and lets the person pick devices. */
export function useMediaPreview() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDevices>({ mics: [], cams: [], speakers: [] });
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [level, setLevel] = useState(0);
  const ref = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef(0);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({ mics: all.filter((d) => d.kind === "audioinput"), cams: all.filter((d) => d.kind === "videoinput"), speakers: all.filter((d) => d.kind === "audiooutput") });
    } catch { /* ignore */ }
  }, []);

  const stopMeter = () => { cancelAnimationFrame(raf.current); audioCtx.current?.close().catch(() => undefined); audioCtx.current = null; setLevel(0); };

  const startMeter = (s: MediaStream) => {
    stopMeter();
    if (!s.getAudioTracks().length) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      audioCtx.current = ctx;
      const buf = new Uint8Array(an.fftSize);
      let last = 0;
      const tick = (t: number) => {
        raf.current = requestAnimationFrame(tick);
        if (t - last < 100) return;
        last = t;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      };
      raf.current = requestAnimationFrame(tick);
    } catch { /* meter is optional */ }
  };

  const stop = useCallback(() => {
    ref.current?.getTracks().forEach((t) => t.stop());
    ref.current = null;
    setStream(null);
    stopMeter();
  }, []);

  const open = useCallback(async (mic?: string, cam?: string) => {
    ref.current?.getTracks().forEach((t) => t.stop());
    const audio = (id?: string) => ({ deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    const video = (id?: string) => ({ deviceId: id ? { exact: id } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } });
    const tries: MediaStreamConstraints[] = [
      { audio: audio(mic), video: video(cam) },
      { audio: true, video: true }, // the chosen device may be gone: fall back to the defaults
      { audio: true, video: false },
      { audio: false, video: true },
    ];
    let got: MediaStream | null = null;
    for (const c of tries) {
      try { got = await navigator.mediaDevices.getUserMedia(c); break; } catch { /* try the next */ }
    }
    if (!got) {
      ref.current = null;
      setStream(null);
      setError(!navigator.mediaDevices ? "This page needs https:// for camera and microphone." : "Camera and microphone are blocked or not found. Allow access from the lock icon in the address bar, then try again. You can still join without them.");
      return;
    }
    setError(!got.getAudioTracks().length && !got.getVideoTracks().length ? "No camera or microphone found." : "");
    ref.current = got;
    setStream(got);
    setMicId(got.getAudioTracks()[0]?.getSettings().deviceId || "");
    setCamId(got.getVideoTracks()[0]?.getSettings().deviceId || "");
    startMeter(got);
    await refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setError("This browser or page cannot use the camera. Use https:// and a current Chrome, Edge, Firefox or Safari."); return; }
    open();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => { navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMic = !!stream?.getAudioTracks().length;
  const hasCam = !!stream?.getVideoTracks().length;

  return {
    stream, error, devices, micId, camId, level, hasMic, hasCam, audioOn: audioOn && hasMic, videoOn: videoOn && hasCam,
    toggleAudio: () => { const on = !audioOn; setAudioOn(on); ref.current?.getAudioTracks().forEach((t) => (t.enabled = on)); },
    toggleVideo: () => { const on = !videoOn; setVideoOn(on); ref.current?.getVideoTracks().forEach((t) => (t.enabled = on)); },
    selectMic: (id: string) => open(id, camId),
    selectCam: (id: string) => open(micId, id),
    retry: () => open(micId, camId),
    stop,
  };
}