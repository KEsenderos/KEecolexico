// sync.js — 区切り・完了を、ドライブの受け渡しファイルの形に変える・比べる・当てはめる
(function () {
  'use strict';
  var K = function () { return RE.Config.KX; };

  // この端末の呼び名（iPhone・iPad・Mac）
  function deviceName() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Macintosh/.test(ua)) return 'Mac';
    return K().SYNC_DEVICE_OTHER;
  }
  // sections の写し（余計な項目を持ち込まない）
  function copySections_(list) {
    return list.map(function (s) {
      return { id: s.id, parts: (s.parts || []).map(function (p) { return { s: p.s, e: p.e }; }), done: s.done || null };
    });
  }
  // ドライブへ送る中身（savedAt はGASが付ける）
  function makeData(article) {
    return { app: K().SYNC_APP, format: K().SYNC_FORMAT, device: deviceName(),
             marked: !!article.marked, sections: copySections_(article.sections) };
  }
  // この記事に使える中身か（形が正しく、節の並びが同じ）
  function isValidFor(data, article) {
    if (!data || data.app !== K().SYNC_APP || data.format !== K().SYNC_FORMAT || !Array.isArray(data.sections)) return false;
    if (data.sections.length !== article.sections.length) return false;
    return data.sections.every(function (s, i) {
      if (!s || s.id !== article.sections[i].id || !Array.isArray(s.parts)) return false;
      if (s.done !== null && typeof s.done !== 'string') return false;
      return s.parts.every(function (p) {
        return p && typeof p.s === 'number' && typeof p.e === 'number' && p.s >= 0 && p.s < p.e;
      });
    });
  }
  // 区切り・完了・marked が同じか
  function sameContent(data, article) {
    return !!data.marked === !!article.marked &&
      JSON.stringify(copySections_(data.sections)) === JSON.stringify(copySections_(article.sections));
  }
  // ドライブの中身を記事に当てはめる（保存は呼ぶ側）
  function apply(article, data) {
    article.sections = copySections_(data.sections);
    article.marked = !!data.marked;
    article.syncSavedAt = Number(data.savedAt) || 0;
    article.syncDirty = false;
  }
  // 確認画面に出す数 { parts: 区間の数, done: 完了した節の数 }
  function summary(sections) {
    return { parts: sections.reduce(function (n, s) { return n + (s.parts || []).length; }, 0),
             done: sections.filter(function (s) { return !!s.done; }).length };
  }
  window.RE = window.RE || {};
  RE.Sync = { deviceName: deviceName, makeData: makeData, isValidFor: isValidFor,
              sameContent: sameContent, apply: apply, summary: summary };
})();
