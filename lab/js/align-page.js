/* lab/js/align-page.js — 検証ページの画面と手順のまとめ役（RE.AlignPage）。KEecolexico の保存データは読むだけ */
/* 基づく仕様書：KEecolexico 自動分割の検証ページ 仕様書 v0.1.1 */
(function () {
  'use strict';
  var CFG = Object.freeze({
    ALIGN_VERSION: '0.1.1',
    MODELS: [
      { id: 'onnx-community/whisper-base_timestamped', label: '標準（base・速い）' },
      { id: 'onnx-community/whisper-small_timestamped', label: '高精度（small・遅い）' }
    ],
    SAMPLE_RATE: 16000,
    FRAME_SEC: 0.02,
    SEG_TARGET_SEC: 25,
    SEG_SEARCH_SEC: 5,
    SNAP_PAD_SEC: 0.3,
    MIN_RATIO: 0.3,
    INSERT_MIN_SEC: 3,
    LANGUAGE: 'spanish',
    RESULT_PREFIX: 'kealign-result-',
    WORKER_URL: 'js/align-worker.js'
  });
  var A = RE.AlignCore;
  var el = {};
  var state = { device: 'wasm', busy: false, audioUrl: '', playEnd: 0, playBtn: null, result: null, startedAt: 0 };

  function $(id) { return document.getElementById(id); }
  function make_(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  // 「01:23.4」
  function fmt(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return '—';
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  // 「+0.3」
  function fmtDiff(d) { return d === null ? '—' : (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1); }
  // 差の色
  function diffClass(d) { if (d === null) return ''; var x = Math.abs(d); return x <= 1 ? 'ok' : (x <= 2 ? 'mid' : 'ng'); }
  function elapsed_() { var s = Math.round((Date.now() - state.startedAt) / 1000); return Math.floor(s / 60) + '分' + (s % 60) + '秒'; }
  function setStatus(t) { el['txt-status'].textContent = t || ''; }
  function setError(t) { el['txt-error'].textContent = t || ''; }

  // 起動：部品を集め、記事とモデルの一覧を出す
  function start() {
    ['sel-article', 'sel-model', 'txt-device', 'btn-run', 'txt-status', 'txt-error', 'txt-summary', 'table-blocks', 'table-units',
     'list-inserts', 'btn-export', 'audio-player', 'txt-version', 'h-blocks', 'h-units', 'h-inserts'].forEach(function (id) { el[id] = $(id); });
    el['txt-version'].textContent = 'v' + CFG.ALIGN_VERSION;
    CFG.MODELS.forEach(function (m) { var o = make_('option', '', m.label); o.value = m.id; el['sel-model'].appendChild(o); });
    el['btn-run'].addEventListener('click', run);
    el['btn-export'].addEventListener('click', exportResult);
    el['audio-player'].addEventListener('timeupdate', function () {
      if (state.playEnd && el['audio-player'].currentTime >= state.playEnd) stopPlay_();
    });
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('button.play'); if (!b) return;
      playRange_(Number(b.getAttribute('data-s')), Number(b.getAttribute('data-e')), b);
    });
    detectDevice_();
    listArticles_();
  }

  // WebGPU が使えるか
  function detectDevice_() {
    var done = function (d) { state.device = d; el['txt-device'].textContent = d === 'webgpu' ? 'WebGPU（速い）' : 'WASM（遅い）'; };
    if (!navigator.gpu || !navigator.gpu.requestAdapter) { done('wasm'); return; }
    navigator.gpu.requestAdapter().then(function (a) { done(a ? 'webgpu' : 'wasm'); }).catch(function () { done('wasm'); });
  }

  // 記事の一覧（音声がある記事だけ）
  function listArticles_() {
    RE.Db.listArticles().then(function (list) {
      return Promise.all(list.map(function (a) { return RE.Db.getAudio(a.articleId).then(function (r) { return r ? a : null; }); }));
    }).then(function (list) {
      list = list.filter(Boolean);
      var sel = el['sel-article']; sel.textContent = '';
      list.forEach(function (a) { var o = make_('option', '', a.title); o.value = a.articleId; sel.appendChild(o); });
      var pick = list.filter(function (a) { return /^Valoremos/i.test(a.title); })[0];
      if (pick) sel.value = pick.articleId;
      if (!list.length) { setError('このブラウザの KEecolexico に記事がありません。KEecolexico を開いているのと同じブラウザで開いてください'); el['btn-run'].disabled = true; }
    });
  }

  function setBusy_(b) {
    state.busy = b;
    el['btn-run'].disabled = b; el['sel-article'].disabled = b; el['sel-model'].disabled = b;
  }

  // 音声の Blob を 16kHz・1チャンネルの Float32Array にする（区切りごとの平均で間引く）
  function decodeTo16k_(blob) {
    return blob.arrayBuffer().then(function (ab) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      return new Promise(function (resolve, reject) { ctx.decodeAudioData(ab, resolve, reject); }).then(function (buf) {
        try { ctx.close(); } catch (e) { /* 無視 */ }
        var sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels, ratio = sr / CFG.SAMPLE_RATE;
        var outLen = Math.floor(n / ratio), out = new Float32Array(outLen), data = [];
        for (var c = 0; c < ch; c++) data.push(buf.getChannelData(c));
        for (var i = 0; i < outLen; i++) {
          var a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)), sum = 0;
          for (var k = a; k < b && k < n; k++) for (c = 0; c < ch; c++) sum += data[c][k];
          out[i] = sum / ((b - a) * ch);
        }
        return { pcm: out, durationSec: n / sr };
      });
    });
  }

  // 音声認識（Web Worker）。words＝[{text, s, e}]
  function recognize_(pcm, segments, model) {
    return new Promise(function (resolve, reject) {
      var w;
      try { w = new Worker(CFG.WORKER_URL, { type: 'module' }); }
      catch (e) { reject({ kind: 'worker', message: String(e && e.message || e) }); return; }
      var device = state.device, retried = false, files = {};
      w.onerror = function (e) { reject({ kind: 'worker', message: (e && e.message) || 'Worker error' }); w.terminate(); };
      w.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === 'download') {
          if (m.file && m.progress) files[m.file] = m.progress;
          var keys = Object.keys(files), avg = keys.length ? keys.reduce(function (s, k) { return s + files[k]; }, 0) / keys.length : 0;
          setStatus('モデルを取得中 ' + (m.file || '') + ' ' + Math.round(avg) + '%');
        } else if (m.type === 'loaded') {
          state.device = m.device;
          el['txt-device'].textContent = m.device === 'webgpu' ? 'WebGPU（速い）' : 'WASM（遅い）';
          state.startedAt = Date.now();
          setStatus('認識中 0/' + segments.length);
          w.postMessage({ type: 'run', pcm: pcm, sampleRate: CFG.SAMPLE_RATE, segments: segments, language: CFG.LANGUAGE }, [pcm.buffer]);
        } else if (m.type === 'progress') {
          setStatus('認識中 ' + m.done + '/' + m.total + '（' + elapsed_() + '）');
        } else if (m.type === 'done') {
          w.terminate();
          resolve({ words: m.words, asrSec: (Date.now() - state.startedAt) / 1000 });
        } else if (m.type === 'error') {
          if (m.where === 'load' && device === 'webgpu' && !retried) {   // WebGPU で読めなければ、1回だけ WASM で
            retried = true; device = 'wasm';
            w.postMessage({ type: 'load', model: model, device: 'wasm' });
            return;
          }
          w.terminate();
          reject({ kind: m.where, message: m.message });
        }
      };
      w.postMessage({ type: 'load', model: model, device: device });
    });
  }

  // 認識した単語を語に分ける（1つの単語が2語以上になったら時刻を等分）
  function toWords_(raw) {
    var out = [];
    raw.forEach(function (x) {
      var toks = A.tokenize(x.text); if (!toks.length) return;
      var d = (x.e - x.s) / toks.length;
      toks.forEach(function (t, i) { out.push({ w: t, s: x.s + d * i, e: x.s + d * (i + 1), text: x.text }); });
    });
    return out;
  }

  // 差の集計
  function stats_(diffs) {
    var xs = diffs.filter(function (d) { return d !== null; }).map(Math.abs).sort(function (a, b) { return a - b; });
    if (!xs.length) return { n: 0, median: null, in05: null, in1: null, in2: null };
    var r = function (t) { return xs.filter(function (x) { return x <= t; }).length / xs.length; };
    return { n: xs.length / 2, median: xs[Math.floor(xs.length / 2)], in05: r(0.5), in1: r(1), in2: r(2) };
  }

  // 実行：読み込み → 音声の準備 → 認識 → 突き合わせ → 比較 → 表示
  function run() {
    if (state.busy) return;
    setError(''); clearResult_();
    var id = el['sel-article'].value, model = el['sel-model'].value, article, blocks, units, audio, rms, dur;
    if (!id) return;
    setBusy_(true);
    Promise.all([RE.Db.getArticle(id), RE.Db.getAudio(id)]).then(function (rs) {
      article = rs[0]; audio = rs[1];
      if (!article || !audio || !audio.blob) throw { kind: 'audio', message: 'NO_DATA' };
      var parsed = RE.Article.parseArticle(article.articleText);
      units = parsed.units.filter(function (u) { return u.kind !== 'skipped'; });
      blocks = RE.Article.buildBlocks(units);
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = URL.createObjectURL(audio.blob);
      el['audio-player'].src = state.audioUrl;
      setStatus('音声を準備中…');
      return decodeTo16k_(audio.blob).catch(function (e) { throw { kind: 'audio', message: String(e && e.message || e) }; });
    }).then(function (d) {
      dur = d.durationSec;
      rms = A.rmsFrames(d.pcm, CFG.SAMPLE_RATE, CFG.FRAME_SEC);
      var segments = A.splitAtQuiet(rms, CFG.FRAME_SEC, dur, CFG.SEG_TARGET_SEC, CFG.SEG_SEARCH_SEC);
      setStatus('モデルを準備中…');
      return recognize_(d.pcm, segments, model);
    }).then(function (rec) {
      setStatus('突き合わせ中…');
      var words = toWords_(rec.words);
      var r = A.alignUnits(units.map(function (u) { return { sid: u.sid, text: u.text }; }), words, { minRatio: CFG.MIN_RATIO, insertMinSec: CFG.INSERT_MIN_SEC });
      A.snapBoundaries(r.units, rms, CFG.FRAME_SEC, CFG.SNAP_PAD_SEC);
      state.result = buildResult_(article, blocks, units, r, words, rec, model, dur);
      render_(state.result);
      setStatus('完了（認識 ' + Math.floor(rec.asrSec / 60) + '分' + Math.round(rec.asrSec % 60) + '秒）');
    }).catch(function (e) {
      console.error(e);
      var msg = (e && e.message) || String(e);
      if (e && e.kind === 'audio') setError('音声を読めませんでした（' + msg + '）');
      else if (e && e.kind === 'load') setError('AIのモデルを取得できませんでした（' + msg + '）。通信を確かめて、もう一度押してください');
      else if (e && e.kind === 'run') setError('認識に失敗しました（' + msg + '）。モデルを『標準』にして、もう一度押してください');
      else if (e && e.kind === 'worker') setError('このブラウザでは使えません（' + msg + '）。Chrome か Safari の新しい版で開いてください');
      else setError('うまくいきませんでした（' + msg + '）');
      setStatus('');
    }).then(function () { setBusy_(false); });
  }

  // 結果をまとめる（節・文・手作業との差・本文に無い発話）
  function buildResult_(article, blocks, units, r, words, rec, model, dur) {
    var bySid = {}; r.units.forEach(function (u, i) { bySid[u.sid] = u; u.blockId = units[i].blockId; u.text = units[i].text; });
    var secs = {}; (article.sections || []).forEach(function (s) { secs[s.id] = s; });
    var memos = article.memos || {};
    var unitRows = [], blockRows = [], bd = [], ud = [];
    blocks.forEach(function (b) {
      var found = b.units.map(function (u) { return bySid[u.sid]; }).filter(function (u) { return u && u.s !== null; });
      var auto = found.length ? { s: Math.min.apply(null, found.map(function (u) { return u.s; })), e: Math.max.apply(null, found.map(function (u) { return u.e; })) } : null;
      var sec = secs[b.id], hand = sec && sec.parts && sec.parts.length ? { s: sec.parts[0].s, e: sec.parts[sec.parts.length - 1].e } : null;
      var split = null;
      if (auto) {
        var ins = r.inserts.filter(function (x) { return x.s > auto.s && x.e < auto.e; });
        if (ins.length) {
          split = []; var cur = auto.s;
          ins.forEach(function (x) { split.push({ s: cur, e: x.s }); cur = x.e; });
          split.push({ s: cur, e: auto.e });
        }
      }
      var ds = auto && hand ? auto.s - hand.s : null, de = auto && hand ? auto.e - hand.e : null;
      bd.push(ds, de);
      blockRows.push({ id: b.id, label: b.label, auto: auto, hand: hand, split: split, ds: ds, de: de });
      var mm = {}; (memos[b.id] || []).forEach(function (m) { mm[m.sid] = m; });
      b.units.forEach(function (u) {
        var x = bySid[u.sid], m = mm[u.sid];
        var a = x && x.s !== null ? { s: x.s, e: x.e } : null, h = m ? { s: m.s, e: m.e } : null;
        var us = a && h ? a.s - h.s : null, ue = a && h ? a.e - h.e : null;
        if (h) ud.push(us, ue);
        unitRows.push({ sid: u.sid, blockId: b.id, text: u.text, auto: a, hand: h, ratio: x ? x.ratio : 0, ds: us, de: ue });
      });
    });
    unitRows.sort(function (p, q) { return (q.hand ? 1 : 0) - (p.hand ? 1 : 0); });
    var inserts = r.inserts.map(function (x) {
      var t = words.filter(function (w) { return w.s >= x.s && w.e <= x.e; }).map(function (w) { return w.w; }).join(' ');
      return { s: x.s, e: x.e, text: t.slice(0, 120) };
    });
    return {
      app: 'KEalign', version: CFG.ALIGN_VERSION, createdAt: Date.now(),
      article: { title: article.title, durationSec: Math.round(dur * 10) / 10 },
      model: model, device: state.device, asrSec: Math.round(rec.asrSec * 10) / 10,
      summary: { blocks: stats_(bd), units: stats_(ud), missing: unitRows.filter(function (u) { return !u.auto; }).length, inserts: inserts.length, unitCount: unitRows.length },
      blocks: blockRows.map(function (b) { return { id: b.id, auto: b.auto, hand: b.hand, split: b.split }; }),
      units: unitRows.map(function (u) { return { sid: u.sid, blockId: u.blockId, auto: u.auto, hand: u.hand, ratio: Math.round(u.ratio * 100) / 100 }; }),
      inserts: inserts,
      words: rec.words.map(function (w) { return { text: w.text, s: Math.round(w.s * 100) / 100, e: Math.round(w.e * 100) / 100 }; }),
      _blockRows: blockRows, _unitRows: unitRows
    };
  }

  function clearResult_() {
    ['txt-summary', 'table-blocks', 'table-units', 'list-inserts', 'btn-export', 'h-blocks', 'h-units', 'h-inserts'].forEach(function (id) { el[id].hidden = true; });
    ['table-blocks', 'table-units', 'list-inserts'].forEach(function (id) { el[id].textContent = ''; });
    state.result = null;
  }

  // ▶ボタン
  function playBtn_(label, r) {
    var b = make_('button', 'play', label); b.type = 'button';
    if (!r) { b.disabled = true; return b; }
    b.setAttribute('data-s', String(r.s)); b.setAttribute('data-e', String(r.e));
    return b;
  }
  function cell_(tr, text, cls) { var td = make_('td', cls || '', text); tr.appendChild(td); return td; }
  function rangeText_(r) { return r ? fmt(r.s) + '〜' + fmt(r.e) : '—'; }
  function pct_(x) { return x === null ? '—' : Math.round(x * 100) + '%'; }

  // 表を描く
  function render_(res) {
    var s = res.summary;
    var line = function (name, st) {
      return name + ' ' + st.n + '件：差の中央値 ' + (st.median === null ? '—' : st.median.toFixed(1) + '秒') +
        '、0.5秒以内 ' + pct_(st.in05) + '・1秒以内 ' + pct_(st.in1) + '・2秒以内 ' + pct_(st.in2);
    };
    el['txt-summary'].textContent = '手作業との差（始まり・終わりそれぞれ）\n' + line('節', s.blocks) + '\n' + line('文（区間メモ）', s.units) +
      '\n見つからなかった文 ' + s.missing + '／' + s.unitCount + '・本文に無い発話 ' + s.inserts + 'か所・認識 ' + res.asrSec + '秒（' + (res.device === 'webgpu' ? 'WebGPU' : 'WASM') + '）';
    // 節
    var tb = el['table-blocks'], hr = make_('tr');
    ['節', '自動', '手作業', '差（始／終）', '自動の分け方（本文に無い発話を除く）', ''].forEach(function (h) { hr.appendChild(make_('th', '', h)); });
    tb.appendChild(hr);
    res._blockRows.forEach(function (b) {
      var tr = make_('tr');
      cell_(tr, b.label);
      cell_(tr, rangeText_(b.auto), 'num');
      cell_(tr, b.hand ? fmt(b.hand.s) + '〜' + fmt(b.hand.e) : '—', 'num');
      var td = cell_(tr, '', 'num');
      td.appendChild(make_('span', diffClass(b.ds), fmtDiff(b.ds))); td.appendChild(document.createTextNode('／')); td.appendChild(make_('span', diffClass(b.de), fmtDiff(b.de)));
      cell_(tr, b.split ? b.split.map(rangeText_).join('／') : '', 'num');
      var tdp = cell_(tr, ''); tdp.appendChild(playBtn_('▶自動', b.auto)); tdp.appendChild(document.createTextNode(' ')); tdp.appendChild(playBtn_('▶手作業', b.hand));
      tb.appendChild(tr);
    });
    // 文
    var tu = el['table-units'], hu = make_('tr');
    ['文番号', '本文', '自動', '手作業', '差（始／終）', '一致', ''].forEach(function (h) { hu.appendChild(make_('th', '', h)); });
    tu.appendChild(hu);
    res._unitRows.forEach(function (u) {
      var tr = make_('tr');
      cell_(tr, u.sid, 'num');
      var t = cell_(tr, u.text, 'txt'); t.title = u.text;
      if (u.auto) cell_(tr, rangeText_(u.auto), 'num'); else cell_(tr, '見つからなかった', 'miss');
      cell_(tr, rangeText_(u.hand), 'num');
      var td = cell_(tr, '', 'num');
      td.appendChild(make_('span', diffClass(u.ds), fmtDiff(u.ds))); td.appendChild(document.createTextNode('／')); td.appendChild(make_('span', diffClass(u.de), fmtDiff(u.de)));
      cell_(tr, Math.round(u.ratio * 100) + '%', 'num');
      var tdp = cell_(tr, ''); tdp.appendChild(playBtn_('▶自動', u.auto)); tdp.appendChild(document.createTextNode(' ')); tdp.appendChild(playBtn_('▶手作業', u.hand));
      tu.appendChild(tr);
    });
    // 本文に無い発話
    var ti = el['list-inserts'];
    res.inserts.forEach(function (x) {
      var tr = make_('tr');
      cell_(tr, rangeText_(x), 'num');
      cell_(tr, '「' + x.text + '」', 'txt').title = x.text;
      cell_(tr, '').appendChild(playBtn_('▶', x));
      ti.appendChild(tr);
    });
    ['txt-summary', 'table-blocks', 'table-units', 'btn-export', 'h-blocks', 'h-units'].forEach(function (id) { el[id].hidden = false; });
    el['list-inserts'].hidden = el['h-inserts'].hidden = !res.inserts.length;
  }

  // その範囲だけを鳴らす
  function playRange_(s, e, btn) {
    var p = el['audio-player'];
    if (state.playBtn === btn && !p.paused) { stopPlay_(); return; }
    stopPlay_();
    state.playEnd = e; state.playBtn = btn; btn.classList.add('is-on');
    p.currentTime = s;
    var pr = p.play(); if (pr && pr.catch) pr.catch(function () { stopPlay_(); });
  }
  function stopPlay_() {
    var p = el['audio-player'];
    try { p.pause(); } catch (e) { /* 無視 */ }
    state.playEnd = 0;
    if (state.playBtn) state.playBtn.classList.remove('is-on');
    state.playBtn = null;
  }

  // 結果をファイルに書き出す
  function exportResult() {
    var r = state.result; if (!r) return;
    var out = {}; Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = r[k]; });
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    var name = CFG.RESULT_PREFIX + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
    var blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 60000);
    setStatus('書き出しました：' + name);
  }

  RE.AlignPage = { CFG: CFG, start: start, run: run, exportResult: exportResult };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
