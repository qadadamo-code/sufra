/** getUserMedia + MediaRecorder wrapper for one PTT clip at a time (browser only). */
import { pickMime } from "./ptt";

export class MicError extends Error {
  constructor(public code: "mic_denied" | "unsupported" | "unknown") {
    super(code);
  }
}

export function recorderSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export class ClipRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  mime = "";
  /** level 0..1 for the on-air meter */
  private analyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;

  async start(): Promise<void> {
    if (!recorderSupported()) throw new MicError("unsupported");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      const n = (e as DOMException)?.name;
      throw new MicError(n === "NotAllowedError" || n === "SecurityError" ? "mic_denied" : n === "NotFoundError" ? "unsupported" : "unknown");
    }
    const mime = pickMime((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    this.rec = mime ? new MediaRecorder(this.stream, { mimeType: mime, audioBitsPerSecond: 24_000 }) : new MediaRecorder(this.stream);
    this.mime = this.rec.mimeType || mime || "audio/webm";
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(200);
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        const src = this.ctx.createMediaStreamSource(this.stream);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        src.connect(this.analyser);
      }
    } catch {
      /* meter is optional */
    }
  }

  level(): number {
    if (!this.analyser) return 0;
    const a = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(a);
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, peak / 64);
  }

  stop(): Promise<Blob> {
    return new Promise((res) => {
      const rec = this.rec;
      if (!rec || rec.state === "inactive") {
        this.release();
        return res(new Blob(this.chunks, { type: this.mime }));
      }
      rec.onstop = () => {
        const b = new Blob(this.chunks, { type: this.mime });
        this.release();
        res(b);
      };
      try {
        rec.requestData();
      } catch {
        /* not recording */
      }
      rec.stop();
    });
  }

  cancel() {
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    } catch {
      /* ignore */
    }
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    this.analyser = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
