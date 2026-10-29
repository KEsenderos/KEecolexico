/* lab/js/align-core.js — 本文と音声認識の結果を突き合わせる（RE.AlignCore）。画面・音声には触れない */
/* 基づく仕様書：KEecolexico 自動分割の検証ページ 仕様書 v0.1.1 */
(function () {
  'use strict';
  var RE = (typeof window !== 'undefined' ? window : globalThis).RE = (typeof window !== 'undefined' ? window : globalThis).RE || {};

  // 突き合わせ用に語を整える：小文字・アクセント記号を除く・記号を除く
  function normWord(w) {
    return String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ]+/g, ' ').trim();
  }
  // 文を語の配列にする
  function tokenize(text) {
    var n = normWord(String(text).normalize('NFC').replace(/ñ/gi, 'ñ'));
    return n ? n.split(/\s+/) : [];
  }
  // 2つの語が似ているか：2＝同じ、1＝似ている、0＝違う
  function similar(a, b) {
    if (a === b) return 2;
    if (a.length >= 4 && b.length >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return 1;
    if (Math.abs(a.length - b.length) > 2 || a.length < 4) return 0;
    var d = editDistance_(a, b);
    return d / Math.max(a.length, b.length) <= 0.25 ? 1 : 0;
  }
  function editDistance_(a, b) {
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 全体の突き合わせ（Needleman–Wunsch）。art＝本文の語の配列、asr＝認識した語の配列
  // 戻り値：本文の語ごとに、対応した認識の語の番号（無ければ -1）
  function alignWords(art, asr, opt) {
    opt = opt || {};
    var MATCH = 3, NEAR = 1, MIS = -1, GAP_ART = -1, GAP_ASR = -1;
    var N = art.length, M = asr.length, W = M + 1, i, j;
    var tb = new Uint8Array((N + 1) * W);       // 0＝斜め、1＝上（本文の語を読んでいない）、2＝左（本文に無い語）
    var prev = new Float64Array(W), cur = new Float64Array(W);
    for (j = 1; j <= M; j++) { prev[j] = prev[j - 1] + GAP_ASR; tb[j] = 2; }
    for (i = 1; i <= N; i++) {
      cur[0] = prev[0] + GAP_ART; tb[i * W] = 1;
      var a = art[i - 1];
      for (j = 1; j <= M; j++) {
        var s = similar(a, asr[j - 1]);
        var d = prev[j - 1] + (s === 2 ? MATCH : (s === 1 ? NEAR : MIS));
        var u = prev[j] + GAP_ART, l = cur[j - 1] + GAP_ASR;
        if (d >= u && d >= l) { cur[j] = d; tb[i * W + j] = 0; }
        else if (u >= l) { cur[j] = u; tb[i * W + j] = 1; }
        else { cur[j] = l; tb[i * W + j] = 2; }
      }
      var t = prev; prev = cur; cur = t;
    }
    var map = new Int32Array(N).fill(-1);
    i = N; j = M;
    while (i > 0 || j > 0) {
      var k = tb[i * W + j];
      if (i > 0 && j > 0 && k === 0) { if (similar(art[i - 1], asr[j - 1]) > 0) map[i - 1] = j - 1; i--; j--; }
      else if (i > 0 && (j === 0 || k === 1)) i--;
      else j--;
    }
    return map;
  }

  // 文（ユニット）ごとの開始・終了を出す
  // units＝[{sid, text}]、words＝[{w, s, e}]（認識の語と時刻）
  // 戻り値：[{sid, s, e, ratio}]（見つからなければ s・e は null）
  function alignUnits(units, words, opt) {
    opt = opt || {};
    var minRatio = opt.minRatio != null ? opt.minRatio : 0.3;
    var art = [], owner = [];
    units.forEach(function (u, ui) { tokenize(u.text).forEach(function (t) { art.push(t); owner.push(ui); }); });
    var asr = words.map(function (x) { return x.w; });
    var map = alignWords(art, asr);
    var res = units.map(function (u) { return { sid: u.sid, s: null, e: null, n: 0, hit: 0, ratio: 0 }; });
    for (var k = 0; k < art.length; k++) {
      var r = res[owner[k]]; r.n++;
      var j = map[k]; if (j < 0) continue;
      r.hit++;
      if (r.s === null || words[j].s < r.s) r.s = words[j].s;
      if (r.e === null || words[j].e > r.e) r.e = words[j].e;
    }
    res.forEach(function (r) {
      r.ratio = r.n ? r.hit / r.n : 0;
      if (r.ratio < minRatio) { r.s = null; r.e = null; }
    });
    // 本文に無い長い発話（画像の説明など）：対応しない認識の語が続いた所
    var used = new Uint8Array(words.length);
    for (k = 0; k < map.length; k++) if (map[k] >= 0) used[map[k]] = 1;
    var inserts = [], run = null;
    for (j = 0; j <= words.length; j++) {
      if (j < words.length && !used[j]) { if (!run) run = { s: words[j].s, e: words[j].e, n: 0 }; run.e = words[j].e; run.n++; }
      else if (run) { if (run.e - run.s >= (opt.insertMinSec || 3)) inserts.push(run); run = null; }
    }
    return { units: res, inserts: inserts, map: map, artLen: art.length };
  }

  // 音量（RMS）を frameSec ごとに出す。pcm は Float32Array（16kHz）
  function rmsFrames(pcm, sr, frameSec) {
    var n = Math.max(1, Math.round(sr * frameSec)), out = new Float32Array(Math.ceil(pcm.length / n));
    for (var f = 0; f < out.length; f++) {
      var sum = 0, a = f * n, b = Math.min(pcm.length, a + n);
      for (var i = a; i < b; i++) sum += pcm[i] * pcm[i];
      out[f] = Math.sqrt(sum / Math.max(1, b - a));
    }
    return out;
  }
  // t0〜t1 の間で、いちばん音が小さい時刻
  function quietest(rms, frameSec, t0, t1) {
    var a = Math.max(0, Math.floor(t0 / frameSec)), b = Math.min(rms.length - 1, Math.ceil(t1 / frameSec)), best = a;
    for (var f = a; f <= b; f++) if (rms[f] < rms[best]) best = f;
    return (best + 0.5) * frameSec;
  }
  // 文と文の境目を、間のいちばん静かな所へ寄せる（見つかった文どうしだけ）
  function snapBoundaries(units, rms, frameSec, padSec) {
    var found = units.filter(function (u) { return u.s !== null; });
    for (var i = 0; i + 1 < found.length; i++) {
      var a = found[i], b = found[i + 1];
      var t0 = Math.min(a.e, b.s) - padSec, t1 = Math.max(a.e, b.s) + padSec;
      t0 = Math.max(t0, a.s + 0.2); t1 = Math.min(t1, b.e - 0.2);
      if (t1 <= t0) continue;
      var q = quietest(rms, frameSec, t0, t1);
      a.e = q; b.s = q;
    }
    return units;
  }
  // 音声を、長さ targetSec 前後の、静かな所で区切った区間の一覧にする（[{s,e}] 秒）
  function splitAtQuiet(rms, frameSec, totalSec, targetSec, searchSec) {
    var out = [], s = 0;
    while (totalSec - s > targetSec + searchSec) {
      var cut = quietest(rms, frameSec, s + targetSec - searchSec, s + targetSec);
      out.push({ s: s, e: cut }); s = cut;
    }
    out.push({ s: s, e: totalSec });
    return out;
  }

  RE.AlignCore = { normWord: normWord, tokenize: tokenize, similar: similar, alignWords: alignWords, alignUnits: alignUnits,
                   rmsFrames: rmsFrames, quietest: quietest, snapBoundaries: snapBoundaries, splitAtQuiet: splitAtQuiet };
})();
