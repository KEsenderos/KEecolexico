/* js/align-worker.js — 音声認識（Whisper）を、画面を止めずに動かす */
/* 基づく仕様書：KEecolexico 仕様書 v1.3 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';
env.allowLocalModels = false;
let asr = null;

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'load') {
    try {
      asr = await pipeline('automatic-speech-recognition', m.model, {
        device: m.device,
        progress_callback: (p) => self.postMessage({ type: 'download', file: p.file || '', progress: p.progress || 0, status: p.status || '' })
      });
      self.postMessage({ type: 'loaded', device: m.device });
    } catch (e) {
      self.postMessage({ type: 'error', where: 'load', message: String((e && e.message) || e) });
    }
    return;
  }
  if (m.type === 'run') {
    const pcm = m.pcm, sr = m.sampleRate, words = [];
    try {
      for (let i = 0; i < m.segments.length; i++) {
        const sg = m.segments[i];
        const sub = pcm.subarray(Math.floor(sg.s * sr), Math.floor(sg.e * sr));
        const out = await asr(sub, { language: m.language, task: 'transcribe', return_timestamps: 'word' });
        (out.chunks || []).forEach((c) => {
          const a = c.timestamp[0] == null ? 0 : c.timestamp[0];
          const b = c.timestamp[1] == null ? a : c.timestamp[1];
          words.push({ text: c.text, s: sg.s + a, e: sg.s + b });
        });
        self.postMessage({ type: 'progress', done: i + 1, total: m.segments.length });
      }
      self.postMessage({ type: 'done', words });
    } catch (e) {
      self.postMessage({ type: 'error', where: 'run', message: String((e && e.message) || e) });
    }
  }
};
