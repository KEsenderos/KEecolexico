/* js/stretch.js / 倍速用の伸び縮み処理（RE.Stretch）WSOLA / 仕様書 v2.10.1 5.5・9.2b章 / 版 2.10.1
 * 声の高さを変えずに、区間だけを rate 倍速の長さに伸び縮みさせる。画面・State・Engine には触れない。 */
(function () {
  'use strict';
  var C = RE.Config;

  /** 周期ハン窓（50%重ねで合計が1になる） */
  function hann_(n) {
    var w = new Float32Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
  }

  /** 全チャンネルの平均を、D個おきに取った探索用の波形にする */
  function mixToMonoD_(chans, inLen, D) {
    var n = Math.floor(inLen / D) + 1;
    var m = new Float32Array(n);
    var ch = chans.length;
    for (var i = 0; i < n; i++) {
      var idx = i * D;
      if (idx >= inLen) break;
      var sum = 0;
      for (var c = 0; c < ch; c++) sum += chans[c][idx];
      m[i] = sum / ch;
    }
    return m;
  }

  /** monoD 上で、target から frameD 個と最も似ている位置を、center の前後 range の範囲から探す */
  function findBest_(monoD, target, center, range, frameD) {
    var len = monoD.length, i, tn = 0;
    for (i = 0; i < frameD; i++) { var t = (target + i < len && target + i >= 0) ? monoD[target + i] : 0; tn += t * t; }
    var best = center, bestScore = -Infinity;
    for (var d = -range; d <= range; d++) {
      var pos = center + d;
      if (pos < 0) continue;
      var dot = 0, pn = 0;
      for (i = 0; i < frameD; i++) {
        var a = (pos + i < len) ? monoD[pos + i] : 0;
        var b = (target + i < len && target + i >= 0) ? monoD[target + i] : 0;
        dot += a * b;
        pn += a * a;
      }
      var score = dot / Math.sqrt(pn * tn + 1e-9);
      if (score > bestScore) { bestScore = score; best = pos; }
    }
    return best;
  }

  /** 区間 startSec〜endSec だけを、長さ（区間 ÷ rate）の AudioBuffer にして返す。声の高さは変わらない */
  function render(ctx, buffer, startSec, endSec, rate) {
    var sr = buffer.sampleRate;
    var chN = buffer.numberOfChannels;
    var s0 = Math.max(0, Math.floor(startSec * sr));
    var s1 = Math.min(buffer.length, Math.ceil(endSec * sr));
    var inLen = Math.max(0, s1 - s0);
    var outLen = Math.max(1, Math.round((endSec - startSec) * sr / rate));
    var out = ctx.createBuffer(chN, outLen, sr);

    var N = Math.round(C.STRETCH_FRAME_MS / 1000 * sr);
    if (N % 2) N += 1;
    var Hs = N / 2;
    var Ha = Hs * rate;
    var S = Math.round(C.STRETCH_SEARCH_MS / 1000 * sr);
    var D = C.STRETCH_DECIMATE;
    var win = hann_(N);

    var inp = [], outp = [], c;
    for (c = 0; c < chN; c++) {
      inp.push(buffer.getChannelData(c).subarray(s0, s1));
      outp.push(out.getChannelData(c));
    }
    var monoD = mixToMonoD_(inp, inLen, D);
    var frameD = Math.max(1, Math.floor(Hs / D));
    var rangeD = Math.max(1, Math.round(S / D));
    var frames = Math.ceil(outLen / Hs) + 1;
    var prev = 0;

    for (var k = 0; k < frames; k++) {
      var base = k * Hs;
      if (base >= outLen) break;
      var p = Math.round(k * Ha);
      var q;
      if (k === 0) {
        q = p;
      } else {
        q = findBest_(monoD, Math.round((prev + Hs) / D), Math.round(p / D), rangeD, frameD) * D;
      }
      for (c = 0; c < chN; c++) {
        var src = inp[c], dst = outp[c];
        for (var i = 0; i < N; i++) {
          var o = base + i;
          if (o >= outLen) break;
          var idx = q + i;
          var v = (idx >= 0 && idx < inLen) ? src[idx] : 0;
          // 最初のフレームの前半は、重なる相手がいないので窓を掛けない（音量が小さくならないように）
          var w = (k === 0 && i < Hs) ? 1 : win[i];
          dst[o] += v * w;
        }
      }
      prev = q;
    }
    return out;
  }

  RE.Stretch = { render: render, hann_: hann_, mixToMonoD_: mixToMonoD_, findBest_: findBest_ };
})();
