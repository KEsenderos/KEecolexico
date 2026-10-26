// drive.js — GAS中継役を呼び、Googleドライブの記事フォルダを取り込む
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

  // GASを1回呼ぶ。時間切れなら1回だけやり直す。失敗は {ok:false, code}
  function call_(params, retry) {
    var s = getSettings();
    if (!s.url || !s.key) return Promise.resolve({ ok: false, code: 'NO_SETTINGS' });
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    q.push('key=' + encodeURIComponent(s.key));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, K().DRIVE_TIMEOUT_MS);
    return fetch(s.url + (s.url.indexOf('?') >= 0 ? '&' : '?') + q.join('&'), { signal: ctl.signal })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, code: 'NETWORK' }; })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok && res.code === 'NETWORK' && !retry) return call_(params, true);
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
  window.RE = window.RE || {};
  RE.Drive = { getSettings: getSettings, saveSettings: saveSettings, isReady: isReady,
               listArticles: listArticles, fetchTexts: fetchTexts, fetchAudio: fetchAudio };
})();
