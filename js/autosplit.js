/* js/autosplit.js — 本文と音声から、節の区間と文ごとの区間メモを自動で作る（RE.AutoSplit） */
/* 基づく仕様書：KEecolexico 仕様書 v1.1 */
(function () {
  'use strict';
  var K = RE.Config.KX;
  var M = RE.Config.KXMSG;
  var A = RE.AlignCore;
  var seq_ = 0;

  function fill_(t, v) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return v[k] !== undefined ? v[k] : m; }); }
  // 区間メモの id（main.js の makeMemoId_ と同じ形）
  function memoId_() { seq_ += 1; return 'm' + Date.now().toString(36) + 'a' + seq_.toString(36) + Math.random().toString(36).slice(2, 4); }
  // iPhone・iPad では行わない（メモリが足りないおそれ。仕様 6.10）
  function isMobile() { return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

  // WebGPU が使えるか
  function detectDevice_() {
    if (!navigator.gpu || !navigator.gpu.requestAdapter) return Promise.resolve('wasm');
    return navigator.gpu.requestAdapter().then(function (a) { return a ? 'webgpu' : 'wasm'; }).catch(function () { return 'wasm'; });
  }

  // 音声を 16kHz・1チャンネルにする（区切りごとの平均で間引く）
  function decodeTo16k_(blob) {
    return blob.arrayBuffer().then(function (ab) {
      var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx();
      return new Promise(function (resolve, reject) { ctx.decodeAudioData(ab, resolve, reject); }).then(function (buf) {
        try { ctx.close(); } catch (e) { /* 無視 */ }
        var sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels, ratio = sr / K.AUTO_SAMPLE_RATE;
        var outLen = Math.floor(n / ratio), out = new Float32Array(outLen), data = [], c;
        for (c = 0; c < ch; c++) data.push(buf.getChannelData(c));
        for (var i = 0; i < outLen; i++) {
          var a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)), sum = 0;
          for (var k = a; k < b && k < n; k++) for (c = 0; c < ch; c++) sum += data[c][k];
          out[i] = sum / ((b - a) * ch);
        }
        return { pcm: out, durationSec: n / sr };
      });
    });
  }

  // 音声認識（Web Worker）。結果は [{text, s, e}]
  function recognize_(pcm, segments, device, onStatus) {
    return new Promise(function (resolve, reject) {
      var w;
      try { w = new Worker(K.AUTO_WORKER_URL, { type: 'module' }); } catch (e) { reject(new Error('WORKER')); return; }
      var retried = false, files = {};
      w.onerror = function (e) { w.terminate(); reject(new Error((e && e.message) || 'WORKER')); };
      w.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === 'download') {
          if (m.file && m.progress) files[m.file] = m.progress;
          var ks = Object.keys(files), avg = ks.length ? ks.reduce(function (s, k) { return s + files[k]; }, 0) / ks.length : 0;
          onStatus(fill_(M.AUTO_DOWNLOAD, { n: Math.round(avg) }));
        } else if (m.type === 'loaded') {
          onStatus(fill_(M.AUTO_RECOG, { done: 0, total: segments.length }));
          w.postMessage({ type: 'run', pcm: pcm, sampleRate: K.AUTO_SAMPLE_RATE, segments: segments, language: K.AUTO_LANGUAGE }, [pcm.buffer]);
        } else if (m.type === 'progress') {
          onStatus(fill_(M.AUTO_RECOG, { done: m.done, total: m.total }));
        } else if (m.type === 'done') {
          w.terminate(); resolve(m.words);
        } else if (m.type === 'error') {
          if (m.where === 'load' && device === 'webgpu' && !retried) { retried = true; device = 'wasm'; w.postMessage({ type: 'load', model: K.AUTO_MODEL, device: 'wasm' }); return; }
          w.terminate(); reject(new Error(m.message || m.where));
        }
      };
      w.postMessage({ type: 'load', model: K.AUTO_MODEL, device: device });
    });
  }

  // 認識した単語を語に分ける（2語以上になったら時刻を等分）
  function toWords_(raw) {
    var out = [];
    raw.forEach(function (x) {
      var toks = A.tokenize(x.text); if (!toks.length) return;
      var d = (x.e - x.s) / toks.length;
      toks.forEach(function (t, i) { out.push({ w: t, s: x.s + d * i, e: x.s + d * (i + 1) }); });
    });
    return out;
  }

  // 自動の結果から、保存の形（節の区間・区間メモ）を作る（仕様 6.10.3）
  function assemble_(blocks, units, r, durEnd) {
    var bySid = {};
    r.units.forEach(function (u, i) { bySid[units[i].sid] = u; });
    var parts = {}, memos = {}, nMemo = 0, nMiss = 0, nBlocks = 0, prevE = 0;
    blocks.forEach(function (b) {
      var found = b.units.map(function (u) { return { u: u, x: bySid[u.sid] }; }).filter(function (o) { return o.x && o.x.s !== null; });
      b.units.forEach(function (u) { var x = bySid[u.sid]; if (!x || x.s === null) nMiss++; });
      if (!found.length) { parts[b.id] = []; return; }
      var s0 = Math.min.apply(null, found.map(function (o) { return o.x.s; })), e0 = Math.max.apply(null, found.map(function (o) { return o.x.e; }));
      // 本文に無い発話（画像の説明など）で区間を分ける
      var ranges = [], cur = s0;
      r.inserts.filter(function (x) { return x.s > s0 && x.e < e0; }).forEach(function (x) { ranges.push({ s: cur, e: x.s }); cur = x.e; });
      ranges.push({ s: cur, e: e0 });
      var ps = [];
      ranges.slice(0, K.PART_LETTERS.length).forEach(function (g) {
        var s = Math.max(Math.floor(g.s), prevE), e = Math.min(Math.ceil(g.e), durEnd);
        if (e <= s) return;
        ps.push({ s: s, e: e }); prevE = e;
      });
      parts[b.id] = ps;
      if (!ps.length) return;
      nBlocks++;
      // 文ごとの区間メモ（区間の中に収める。前の文と重ねない）
      var list = [], lastE = -1;
      found.forEach(function (o) {
        if (o.u.kind === 'heading' || list.length >= K.MEMO_MAX_PER_SECTION) return;
        var mid = (o.x.s + o.x.e) / 2, pi = -1;
        ps.forEach(function (p, i) { if (pi < 0 && mid < p.e) pi = i; });
        if (pi < 0) pi = ps.length - 1;
        var p = ps[pi];
        var s = Math.min(Math.max(Math.round(o.x.s), p.s, lastE), p.e - 1), e = Math.min(Math.max(Math.round(o.x.e), s + 1), p.e);
        if (e <= s) return;
        list.push({ id: memoId_(), sid: o.u.sid, part: pi, s: s, e: e, savedAt: Date.now() + list.length });
        lastE = e;
      });
      if (list.length) { memos[b.id] = list; nMemo += list.length; }
    });
    return { parts: parts, memos: memos, stats: { blocks: nBlocks, memos: nMemo, miss: nMiss } };
  }

  // 自動分割を行う。article は保存してある記事、blob は音声。onStatus(文) で進み具合を知らせる
  // 戻り値 Promise<{parts:{節id:[{s,e}]}, memos:{節id:[…]}, stats}>
  function run(article, blob, onStatus) {
    var units, blocks, rms, dur;
    var parsed = RE.Article.parseArticle(article.articleText);
    units = parsed.units.filter(function (u) { return u.kind !== 'skipped'; });
    blocks = RE.Article.buildBlocks(units);
    onStatus(M.AUTO_PREPARING);
    return Promise.all([decodeTo16k_(blob), detectDevice_()]).then(function (rs) {
      var d = rs[0]; dur = d.durationSec;
      rms = A.rmsFrames(d.pcm, K.AUTO_SAMPLE_RATE, K.AUTO_FRAME_SEC);
      var segments = A.splitAtQuiet(rms, K.AUTO_FRAME_SEC, dur, K.AUTO_SEG_TARGET_SEC, K.AUTO_SEG_SEARCH_SEC);
      return recognize_(d.pcm, segments, rs[1], onStatus);
    }).then(function (raw) {
      onStatus(M.AUTO_ALIGN);
      var r = A.alignUnits(units.map(function (u) { return { sid: u.sid, text: u.text }; }), toWords_(raw),
                           { minRatio: K.AUTO_MIN_RATIO, insertMinSec: K.AUTO_INSERT_MIN_SEC });
      A.snapBoundaries(r.units, rms, K.AUTO_FRAME_SEC, K.AUTO_SNAP_PAD_SEC);
      return assemble_(blocks, units, r, Math.floor(article.durationSec || dur));
    });
  }

  RE.AutoSplit = { run: run, isMobile: isMobile, assemble_: assemble_ };
})();
