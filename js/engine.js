/* js/engine.js / 再生エンジン（RE.Engine）Web Audio方式 / 仕様書 v2.10.1 5.5・5.9・9.3章 / 版 2.10.1
 * 画面（DOM）にも RE.State にも触れない。状態の変化は callbacks.onStateChange で知らせるだけ。
 * スロット "A"（1つ目）・"B"（2つ目）・"C"（3つ目）のファイルを持てる。ダブル／トリプルモードでは区間を A→B→C の順に交互に再生する。 */
(function () {
  'use strict';
  var C = RE.Config;
  var S = C.PLAYER_STATE;

  var callbacks = { onStateChange: function () {}, onError: function () {} };
  var ctx = null;
  var buffers = { A: null, B: null, C: null };
  var sec = { A: { s: 0, e: 0 }, B: { s: 0, e: 0 }, C: { s: 0, e: 0 } };   // 各スロットの区間（秒）
  var mode = C.MODE.SINGLE;
  var source = null;
  var keepAudio = null;
  var state = S.NO_FILE;
  var rate = 1;            // 倍速（State.rate と同じ値。Main が setRate で知らせる）
  var gap = 0;             // 繰り返しの間の無音（秒。Main が setGap で知らせる）
  var srcRate = 1;         // 現在の再生元を作ったときの倍速（位置の換算に使う）
  var curParts = [];       // 現在の再生元のパート [{slot, s, e, len}]（lenは「つなげる」方式のときだけ。秒）
  var combined = null;     // 「つなげる」方式の音声
  var combinedKey = '';    // combined を作ったときの条件
  var combinedParts = [];  // combined のパート [{slot, s, e, len}]
  var segCtx = 0;          // 再生開始時の ctx.currentTime
  var segOffset = 0;       // 「元の音声そのまま」方式: 再生開始位置（そのファイル上の秒）
  var segOffsetS = 0;      // 「つなげる」方式: combined 上の再生開始位置（秒）
  var pausedSlot = 'A';    // 一時停止・停止中のスロット
  var pausedPos = 0;       // 一時停止・停止中の位置（そのファイル上の秒）

  function notify_() { callbacks.onStateChange(state); }
  function setState_(s) { state = s; notify_(); }

  /** 再生に使うスロットの並び（シングル: Aだけ。ダブル: A・B。トリプル: A・B・C。読み込まれているものだけ。v2.10） */
  function parts_() {
    var list = [];
    if (buffers.A) list.push('A');
    if (mode !== C.MODE.SINGLE && buffers.B) list.push('B');
    if (mode === C.MODE.TRIPLE && buffers.C) list.push('C');
    return list;
  }

  function normSlot_(slot) { return slot === 'B' ? 'B' : (slot === 'C' ? 'C' : 'A'); }

  function firstSlot_() { var p = parts_(); return p.length ? p[0] : 'A'; }

  function ensureContext_() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    ctx.onstatechange = onContextStateChange_;
    return true;
  }

  function onContextStateChange_() {
    if (state === S.PLAYING && ctx && ctx.state !== 'running') interrupt_();
  }

  function interrupt_() {
    var loc = locate_();
    pausedSlot = loc.slot;
    pausedPos = loc.pos;
    destroySource_();
    keepStop_();
    setState_(S.PAUSED);
    callbacks.onError(C.ERR.INTERRUPTED);
  }

  function makeSilentWavUrl_() {
    var n = 8000, b = new ArrayBuffer(44 + n), v = new DataView(b), i;
    function w(o, str) { for (var k = 0; k < str.length; k++) v.setUint8(o + k, str.charCodeAt(k)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for (i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }

  function keepStart_() {
    if (!C.KEEPALIVE_SILENT_AUDIO) return;
    if (!keepAudio) { keepAudio = new Audio(makeSilentWavUrl_()); keepAudio.loop = true; }
    var p = keepAudio.play();
    if (p && p.catch) p.catch(function () { /* 無音audioが鳴らせなくても本体の再生は続ける */ });
  }

  function keepStop_() {
    if (keepAudio) keepAudio.pause();
  }

  function destroySource_() {
    if (!source) return;
    try { source.onended = null; source.stop(); } catch (e) { /* すでに停止 */ }
    try { source.disconnect(); } catch (e2) { /* すでに切断 */ }
    source = null;
  }

  function inSection_(slot, pos) { return pos >= sec[slot].s && pos < sec[slot].e; }

  function tooLong_() { var e = new Error('TOO_LONG'); return e; }

  /**
   * 「つなげる」方式の音声（combined）を用意する。同じ条件なら作り直さない。
   * 区間の音声: rate==1 → そのスロットのコピー、rate≠1 → RE.Stretch.render の結果。
   */
  function prepareCombined_(slots) {
    var total = 0, i;
    for (i = 0; i < slots.length; i++) total += Math.max(0, sec[slots[i]].e - sec[slots[i]].s);
    if (total > (mode === C.MODE.TRIPLE ? C.TRIPLE_MAX_SECTION_SEC : C.DOUBLE_MAX_SECTION_SEC)) throw tooLong_();
    var key = mode + '|' + rate + '|' + gap + '|' + slots.map(function (sl) { return sl + ':' + sec[sl].s + ':' + sec[sl].e; }).join(',');
    if (combined && key === combinedKey) return;
    combined = null; combinedKey = ''; combinedParts = [];

    var segs = [], sr = buffers[slots[0]].sampleRate, chans = 1, totalLen = 0;
    for (i = 0; i < slots.length; i++) {
      var sl = slots[i], b = buffers[sl], s = sec[sl].s, e = sec[sl].e, seg;
      if (rate === 1) {
        var i0 = Math.max(0, Math.floor(s * b.sampleRate));
        var i1 = Math.min(b.length, Math.ceil(e * b.sampleRate));
        seg = { buf: b, from: i0, len: Math.max(1, i1 - i0) };
      } else {
        var r = RE.Stretch.render(ctx, b, s, e, rate);
        seg = { buf: r, from: 0, len: r.length };
      }
      seg.slot = sl; seg.s = s; seg.e = e;
      segs.push(seg);
      chans = Math.max(chans, seg.buf.numberOfChannels);
      totalLen += seg.len;
    }
    totalLen = 0;
    for (i = 0; i < segs.length; i++) { segs[i].gapLen = Math.round(gap * sr); totalLen += segs[i].len + segs[i].gapLen; }
    var out = ctx.createBuffer(chans, totalLen, sr);
    var at = 0;
    for (i = 0; i < segs.length; i++) {
      var sg = segs[i];
      for (var c = 0; c < chans; c++) {
        var from = sg.buf.getChannelData(Math.min(c, sg.buf.numberOfChannels - 1));
        var to = out.getChannelData(c);
        to.set(from.subarray(sg.from, sg.from + sg.len), at);
      }
      combinedParts.push({ slot: sg.slot, s: sg.s, e: sg.e, len: sg.len / sr, gap: sg.gapLen / sr });
      at += sg.len + sg.gapLen;
    }
    combined = out;
    combinedKey = key;
  }

  /** 指定のスロット・位置（そのファイル上の秒）から再生元を作る。上限超えは例外 TOO_LONG */
  function createSource_(slot, pos) {
    destroySource_();
    var slots = parts_();
    if (!slots.length) return;
    if (slots.indexOf(slot) < 0 || !inSection_(slot, pos)) { slot = slots[0]; pos = sec[slot].s; }
    var src = ctx.createBufferSource();
    segCtx = ctx.currentTime;
    if (slots.length === 1 && rate === 1 && gap === 0) {
      // 元の音声そのまま（従来どおり）
      var b = buffers[slot];
      source = src;
      srcRate = 1;
      curParts = [{ slot: slot, s: sec[slot].s, e: sec[slot].e }];
      segOffset = pos;
      src.buffer = b;
      applyLoop_(src, slot);                 // ループ範囲を先に決めてから loop を有効にする（Safari対策）
      src.connect(ctx.destination);
      src.start(0, pos);
      applyLoop_(src, slot);                 // 開始後にもう一度確定させる（Safari対策）
    } else {
      prepareCombined_(slots);
      source = src;
      srcRate = rate;
      curParts = combinedParts.slice();
      var before = 0;
      for (var i = 0; i < combinedParts.length && combinedParts[i].slot !== slot; i++) before += combinedParts[i].len + combinedParts[i].gap;
      segOffsetS = Math.min(Math.max(0, before + (pos - sec[slot].s) / rate), Math.max(0, combined.duration - 0.001));
      src.buffer = combined;
      src.loopStart = 0;
      src.loopEnd = combined.duration;
      src.loop = true;
      src.connect(ctx.destination);
      src.start(0, segOffsetS);
    }
    // 万一ループが効かずバッファの終わりまで再生された場合は、先頭から再生し直す
    src.onended = function () {
      if (source === src && state === S.PLAYING) {
        var f = firstSlot_();
        try { createSource_(f, sec[f].s); } catch (e) { /* 無視 */ }
      }
    };
  }

  function applyLoop_(src, slot) {
    try {
      var b = buffers[slot];
      var end = sec[slot].e > sec[slot].s ? sec[slot].e : Math.min(sec[slot].s + 1, b.duration);
      src.loopStart = sec[slot].s;
      src.loopEnd = end;
      src.loop = true;
    } catch (e) { /* 設定できない場合は無視 */ }
  }

  /** 再生中のスロットと位置（そのファイル上の秒）を返す */
  function locate_() {
    if (state === S.PLAYING && ctx && curParts.length) {
      if (curParts.length === 1 && curParts[0].len === undefined) {
        var p0 = curParts[0];
        var len = p0.e - p0.s;
        if (len <= 0) return { slot: p0.slot, pos: p0.s };
        var run = (segOffset - p0.s) + (ctx.currentTime - segCtx);
        return { slot: p0.slot, pos: p0.s + (run % len) };
      }
      var total = combined ? combined.duration : 0;
      if (total <= 0) return { slot: curParts[0].slot, pos: curParts[0].s };
      var u = (segOffsetS + (ctx.currentTime - segCtx)) % total;
      for (var i = 0; i < curParts.length; i++) {
        if (u < curParts[i].len) {
          return { slot: curParts[i].slot, pos: curParts[i].s + u * srcRate };
        }
        if (u < curParts[i].len + curParts[i].gap || i === curParts.length - 1) {
          // 無音の間は、そのパートの開始地点を返す（一時停止してもその区間の頭から再開できる）
          return { slot: curParts[i].slot, pos: curParts[i].s };
        }
        u -= curParts[i].len + curParts[i].gap;
      }
    }
    if (state === S.PAUSED) return { slot: pausedSlot, pos: pausedPos };
    var f = firstSlot_();
    return { slot: f, pos: sec[f].s };
  }

  function getPositionSec() { return locate_().pos; }
  function getActiveSlot() { return locate_().slot; }

  function init(cb) {
    callbacks = cb;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 未対応 */ }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state === S.PLAYING && ctx && ctx.state !== 'running') interrupt_();
    });
  }

  function stopToStart_() {
    var f = firstSlot_();
    pausedSlot = f;
    pausedPos = sec[f].s;
  }

  /** 読み込み用の変換器。AUDIO_SAMPLE_RATE が指定されていれば、その周波数で展開する（メモリ節約）。失敗したら通常の出口を使う */
  function decodeContext_() {
    var rate = C.AUDIO_SAMPLE_RATE;
    if (rate > 0) {
      try {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (OAC) return new OAC(2, 1, rate);
      } catch (e) { /* 通常の出口を使う */ }
    }
    return ctx;
  }

  /** AUDIO_MONO が true のときだけモノラルにする（標準は false=ステレオのまま） */
  function lighten_(buf, force) {
    if ((!C.AUDIO_MONO && !force) || buf.numberOfChannels < 2) return buf;
    var out = ctx.createBuffer(1, buf.length, buf.sampleRate);
    var o = out.getChannelData(0), n = buf.numberOfChannels, c, i;
    for (c = 0; c < n; c++) {
      var d = buf.getChannelData(c);
      for (i = 0; i < o.length; i++) o[i] += d[i] / n;
    }
    return out;
  }

  /** そのスロットの音声を、全チャンネル平均のモノラルに置き換える（v2.10。元のステレオは破棄） */
  function toMono_(slot) {
    var b = buffers[slot];
    if (!b || b.numberOfChannels < 2) return false;
    buffers[slot] = lighten_(b, true);
    combined = null; combinedKey = ''; combinedParts = [];
    return true;
  }

  /** 3区間モードのメモリ判断（仕様 5.15.3）。展開後サイズの合計が TRIPLE_STEREO_MAX_MB を超えたら、読み込み済みを A→B→C の順にモノラルへ。変換したら true */
  function enforceTripleMemory_() {
    if (mode !== C.MODE.TRIPLE || C.AUDIO_MONO) return false;
    var total = 0, slots = ['A', 'B', 'C'], i;
    for (i = 0; i < 3; i++) { var b = buffers[slots[i]]; if (b) total += b.length * b.numberOfChannels * 4; }
    if (total / 1000000 <= C.TRIPLE_STEREO_MAX_MB) return false;
    var changed = false;
    for (i = 0; i < 3; i++) { if (toMono_(slots[i])) changed = true; }
    return changed;
  }

  /** ファイルを読み込む（slot は "A"・"B"・"C"）。再生は止まる。メモリ節約のため、先に前のファイルを破棄する。失敗時はそのスロットが未選択に戻る。 */
  function loadFile(file, slot) {
    slot = normSlot_(slot);
    destroySource_();
    keepStop_();
    buffers[slot] = null;
    combined = null; combinedKey = ''; combinedParts = []; curParts = [];
    var stateNow = parts_().length ? S.STOPPED : S.NO_FILE;
    if (state !== stateNow) { state = stateNow; notify_(); }
    if (!ensureContext_()) return Promise.reject(new Error('NO_WEB_AUDIO'));
    return file.arrayBuffer().then(function (ab) {
      return new Promise(function (resolve, reject) {
        var dctx = decodeContext_();
        var p = dctx.decodeAudioData(ab, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    }).then(function (decoded) {
      return lighten_(decoded);
    }).then(function (decoded) {
      buffers[slot] = decoded;
      sec[slot] = { s: 0, e: Math.min(C.END_DEFAULT_SEC, decoded.duration) };
      if (slot === 'A') { rate = C.RATE_DEFAULT; srcRate = 1; }
      var mono = enforceTripleMemory_();
      stopToStart_();
      setState_(S.STOPPED);
      return { durationSec: decoded.duration, monoApplied: mono };
    });
  }

  /** モードを設定する。再生は止まる。状態は、有効なスロットが読み込まれていればSTOPPED、なければNO_FILE */
  function setMode(m) {
    destroySource_();
    keepStop_();
    mode = m === C.MODE.DOUBLE ? C.MODE.DOUBLE : (m === C.MODE.TRIPLE ? C.MODE.TRIPLE : C.MODE.SINGLE);
    combined = null; combinedKey = ''; combinedParts = []; curParts = [];
    var mono = enforceTripleMemory_();
    stopToStart_();
    setState_(parts_().length ? S.STOPPED : S.NO_FILE);
    return { monoApplied: mono };
  }

  /** 再生元を作り直す。上限（TOO_LONG）を超えたら、再生を止めて onError(TOO_LONG) */
  function rebuild_(slot, pos) {
    try {
      createSource_(slot, pos);
    } catch (e) {
      if (e && e.message === 'TOO_LONG') {
        destroySource_();
        keepStop_();
        stopToStart_();
        setState_(S.STOPPED);
        callbacks.onError(C.ERR.TOO_LONG);
      } else {
        throw e;
      }
    }
  }

  /** そのスロットの区間を更新。noApply が true なら、値を覚えるだけ（続けて playFromStart を呼ぶとき用）。 */
  function setSection(startSec, endSec, slot, noApply) {
    slot = normSlot_(slot);
    var loc = state === S.PLAYING ? locate_() : null;
    sec[slot] = { s: startSec, e: endSec };
    if (noApply) return;
    if (state === S.PLAYING) {
      var useSlot = loc.slot, usePos = loc.pos;
      if (parts_().indexOf(useSlot) < 0 || !inSection_(useSlot, usePos)) { useSlot = firstSlot_(); usePos = sec[useSlot].s; }
      rebuild_(useSlot, usePos);
    } else if (state === S.PAUSED && parts_().indexOf(pausedSlot) >= 0 && inSection_(pausedSlot, pausedPos)) {
      /* 位置を維持 */
    } else if (state !== S.NO_FILE) {
      stopToStart_();
      if (state !== S.STOPPED) setState_(S.STOPPED);
    }
  }

  function play() {
    if (!parts_().length || !ctx) return Promise.resolve();
    var slot, pos;
    if (state === S.PAUSED && parts_().indexOf(pausedSlot) >= 0 && inSection_(pausedSlot, pausedPos)) {
      slot = pausedSlot; pos = pausedPos;
    } else {
      slot = firstSlot_(); pos = sec[slot].s;
    }
    keepStart_();
    var go = function () {
      try {
        createSource_(slot, pos);
        setState_(S.PLAYING);
      } catch (e) {
        if (e && e.message === 'TOO_LONG') {
          destroySource_(); keepStop_(); stopToStart_(); setState_(S.STOPPED); callbacks.onError(C.ERR.TOO_LONG);
        } else {
          throw e;
        }
      }
    };
    if (ctx.state === 'running') {
      try { go(); } catch (e) { callbacks.onError(C.ERR.PLAY_BLOCKED); }
      return Promise.resolve();
    }
    return resumeContext_().then(go).catch(function () {
      // 再開できなかった場合は、音の出口（AudioContext）を作り直して1回だけ試す
      recreateContext_();
      return resumeContext_().then(go).catch(function () { callbacks.onError(C.ERR.PLAY_BLOCKED); });
    });
  }

  /** ctx.resume() を、1.5秒で見切りをつけて待つ（iOSで返事が来ないことがあるため） */
  function resumeContext_() {
    return Promise.race([
      ctx.resume(),
      new Promise(function (resolve, reject) { setTimeout(function () { reject(new Error('RESUME_TIMEOUT')); }, 1500); })
    ]).then(function () {
      if (ctx.state !== 'running') throw new Error('NOT_RUNNING');
    });
  }

  function recreateContext_() {
    destroySource_();
    try { if (ctx) { ctx.onstatechange = null; ctx.close(); } } catch (e) { /* 無視 */ }
    ctx = null;
    ensureContext_();
  }

  /** 先頭のパートの開始地点へ移動して再生（区間移動・開始地点の編集で使う） */
  function playFromStart() {
    if (!parts_().length || !ctx) return Promise.resolve();
    stopToStart_();
    if (state === S.PLAYING) { rebuild_(pausedSlot, pausedPos); return Promise.resolve(); }
    state = S.STOPPED;
    return play();
  }

  /** 指定スロットの開始地点から再生（区間メモのタップで使う）。そのスロットが再生に使われない場合は playFromStart と同じ */
  function playFromSlot(slot) {
    slot = normSlot_(slot);
    if (!parts_().length || !ctx) return Promise.resolve();
    if (parts_().indexOf(slot) < 0) return playFromStart();
    stopToStart_();
    pausedSlot = slot;
    pausedPos = sec[slot].s;
    if (state === S.PLAYING) { rebuild_(pausedSlot, pausedPos); return Promise.resolve(); }
    state = S.PAUSED;   // play() が「保持した位置から」始めるための内部設定（画面への通知は play が行う）
    return play();
  }

  function pause() {
    if (state !== S.PLAYING) return;
    var loc = locate_();
    pausedSlot = loc.slot;
    pausedPos = loc.pos;
    destroySource_();
    // 一時停止中も無音audioは鳴らし続ける。止めてしまうと、iOSが「再生中のアプリ」から外し、
    // イヤホンやインカムの再生ボタンがアプリに届かなくなるため（v1.9）。
    keepStart_();
    setState_(S.PAUSED);
  }

  function stop() {
    if (state === S.NO_FILE) return;
    destroySource_();
    keepStop_();
    stopToStart_();
    setState_(S.STOPPED);
  }

  /** 倍速を設定する。再生中は現在位置を保存しておく（実際の切り替えは、続く playFromStart で行う） */
  function setRate(r) {
    if (state === S.PLAYING && ctx && source) {
      var loc = locate_();
      pausedSlot = loc.slot;
      pausedPos = loc.pos;
    }
    rate = r;
  }

  /** 繰り返しの間の無音（秒）を設定する。再生中なら、今の位置から作り直す */
  function setGap(g) {
    var loc = state === S.PLAYING && ctx && source ? locate_() : null;
    gap = Number(g) > 0 ? Number(g) : 0;
    if (loc) rebuild_(loc.slot, inSection_(loc.slot, loc.pos) ? loc.pos : sec[loc.slot].s);
  }

  /** 再生位置を pos（そのファイル上の秒）へ移す（KEecolexico で足した窓口。仕様 3.3）。
      区間の外なら区間の中へ収める。再生中はその位置から続けて再生し、一時停止中・停止中は一時停止の状態でその位置を覚える */
  function seekTo(pos) {
    if (!parts_().length || !ctx) return;
    var slot = firstSlot_(), s = sec[slot].s, e = sec[slot].e;
    pos = Math.min(Math.max(Number(pos) || 0, s), Math.max(s, e - 0.1));
    pausedSlot = slot;
    pausedPos = pos;
    if (state === S.PLAYING) { rebuild_(slot, pos); return; }
    if (state === S.STOPPED) setState_(S.PAUSED);
  }

  function getState() { return state; }

  RE.Engine = {
    init: init,
    loadFile: loadFile,
    setSection: setSection,
    setMode: setMode,
    play: play,
    playFromStart: playFromStart,
    playFromSlot: playFromSlot,
    pause: pause,
    stop: stop,
    setRate: setRate,
    setGap: setGap,
    seekTo: seekTo,
    getPositionSec: getPositionSec,
    getActiveSlot: getActiveSlot,
    getState: getState
  };
})();
