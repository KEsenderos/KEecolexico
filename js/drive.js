// drive.js — GAS中継役を呼び、Googleドライブの記事フォルダを取り込む
// 基づく仕様書：KEecolexico 仕様書 v1.1
(function () {
  'use strict';
  var K = function () { return RE.Config.KX; };

  // 保存してあるGASのURLと合言葉
  function getSettings() {
    var url = '', key = '';
    try { url = localStorage.getItem(K().STORAGE_KEY_GAS_URL) || ''; key = localStorage.getItem(K().STORAGE_KEY_GAS_KEY) || ''; } catch (e) {}
    return { url: url.trim(), key: key.trim() };
  }
  function saveSettings(url, key) {
    try { localStorage.setItem(K().STORAGE_KEY_GAS_URL, url.trim()); localStorage.setItem(K().STORAGE_KEY_GAS_KEY, key.trim()); } catch (e) {}
  }
  function isReady() { var s = getSettings(); return !!(s.url && s.key); }

  // 返事を JSON にする。JSON でなければ（GASのエラーのページなど）NOT_JSON と、HTTPの番号・ページの文字（先頭100文字）
  function parse_(r) {
    return r.text().then(function (txt) {
      try { return JSON.parse(txt); } catch (e) {
        var s = txt.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return { ok: false, code: 'NOT_JSON', message: ('HTTP ' + r.status + ' ' + s).slice(0, 100) };
      }
    });
  }
  // fetch が失敗したとき（時間切れは TIMEOUT、つながらないときは NETWORK）
  function fail_(e) {
    var timeout = e && e.name === 'AbortError';
    return { ok: false, code: timeout ? 'TIMEOUT' : 'NETWORK', message: e ? String(e.message || e).slice(0, 100) : '' };
  }

  // GASを1回呼ぶ。つながらなければ1回だけやり直す（retry が true のときはやり直さない）。失敗は {ok:false, code}
  // timeoutMs を省くと DRIVE_TIMEOUT_MS
  function call_(params, retry, timeoutMs) {
    var s = getSettings();
    if (!s.url || !s.key) return Promise.resolve({ ok: false, code: 'NO_SETTINGS' });
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    q.push('key=' + encodeURIComponent(s.key));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, timeoutMs || K().DRIVE_TIMEOUT_MS);
    return fetch(s.url + (s.url.indexOf('?') >= 0 ? '&' : '?') + q.join('&'), { signal: ctl.signal })
      .then(parse_)
      .catch(fail_)
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok && (res.code === 'NETWORK' || res.code === 'TIMEOUT') && !retry) return call_(params, true, timeoutMs);
        return res;
      });
  }
  // 記事フォルダの一覧
  function listArticles() { return call_({ action: 'list' }, false); }
  // 本文とCSV
  function fetchTexts(folderId) { return call_({ action: 'texts', folderId: folderId }, false); }
  // 音声を分割して受け取り、File にする。onProgress(part, parts)
  function fetchAudio(folderId, onProgress) {
    var chunks = [], meta = null;
    function next(part) {
      return call_({ action: 'audio', folderId: folderId, part: part }, false).then(function (res) {
        if (!res.ok) return res;
        meta = res;
        var bin = atob(res.data), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        chunks.push(arr);
        if (onProgress) onProgress(part + 1, res.parts);
        if (part + 1 < res.parts) return next(part + 1);
        var type = meta.mime || (/\.m4a$/i.test(meta.name) ? 'audio/mp4' : 'audio/mpeg');
        return { ok: true, file: new File(chunks, meta.name, { type: type }) };
      });
    }
    return next(0);
  }
  // 受け渡しファイルを読む。{ok:true, sync:object|null}。記事を開くたびに呼ぶので、やり直さず短く待つ
  function fetchSync(folderId) { return call_({ action: 'sync', folderId: folderId }, true, K().SYNC_TIMEOUT_MS); }
  // 受け渡しファイルを書く。{ok:true, savedAt} か {ok:false, code, sync}
  function putSync(folderId, baseSavedAt, data, force) {
    var s = getSettings();
    if (!s.url || !s.key) return Promise.resolve({ ok: false, code: 'NO_SETTINGS' });
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, K().SYNC_TIMEOUT_MS);
    var body = JSON.stringify({ key: s.key, action: 'putSync', folderId: folderId,
                                baseSavedAt: baseSavedAt || 0, force: !!force, data: data });
    // 本文は文字列のまま送る（text/plain になり、ブラウザの事前確認が起きない。headers は付けない）
    return fetch(s.url, { method: 'POST', body: body, signal: ctl.signal })
      .then(parse_)
      .catch(fail_)
      .then(function (res) { clearTimeout(timer); return res; });
  }
  window.RE = window.RE || {};
  RE.Drive = { getSettings: getSettings, saveSettings: saveSettings, isReady: isReady,
               listArticles: listArticles, fetchTexts: fetchTexts, fetchAudio: fetchAudio,
               fetchSync: fetchSync, putSync: putSync };
})();
