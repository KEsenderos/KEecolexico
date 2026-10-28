// sync.js — 区切り・完了・区間メモを、ドライブの受け渡しファイルの形に変える・比べる・当てはめる
// 基づく仕様書：KEecolexico 仕様書 v0.10.1
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
  // 区間メモの写し（節の id → [{id, sid, part, s, e, savedAt}]。空の節は入れない。キーは名前の順）
  function copyMemos_(memos) {
    var out = {};
    Object.keys(memos || {}).sort().forEach(function (k) {
      var list = (memos[k] || []).map(function (m) {
        return { id: m.id, sid: m.sid, part: m.part, s: m.s, e: m.e, savedAt: m.savedAt };
      });
      if (list.length) out[k] = list;
    });
    return out;
  }
  // ドライブへ送る中身（savedAt はGASが付ける）
  function makeData(article) {
    return { app: K().SYNC_APP, format: K().SYNC_FORMAT, device: deviceName(),
             marked: !!article.marked, sections: copySections_(article.sections), memos: copyMemos_(article.memos) };
  }
  // 区間メモの形が正しいか（無いときは正しいとみなす＝古い版のファイル）
  function validMemos_(memos, article) {
    if (memos === undefined) return true;
    if (!memos || typeof memos !== 'object' || Array.isArray(memos)) return false;
    var ids = {}; article.sections.forEach(function (s) { ids[s.id] = true; });
    return Object.keys(memos).every(function (k) {
      return ids[k] && Array.isArray(memos[k]) && memos[k].length <= K().MEMO_MAX_PER_SECTION && memos[k].every(function (m) {
        return m && typeof m.id === 'string' && typeof m.sid === 'string' && typeof m.part === 'number' &&
          typeof m.s === 'number' && typeof m.e === 'number' && m.s >= 0 && m.s < m.e;
      });
    });
  }
  // この記事に使える中身か（形が正しく、節の並びが同じ）
  function isValidFor(data, article) {
    if (!data || data.app !== K().SYNC_APP || data.format !== K().SYNC_FORMAT || !Array.isArray(data.sections)) return false;
    if (data.sections.length !== article.sections.length) return false;
    var ok = data.sections.every(function (s, i) {
      if (!s || s.id !== article.sections[i].id || !Array.isArray(s.parts)) return false;
      if (s.done !== null && typeof s.done !== 'string') return false;
      return s.parts.every(function (p) {
        return p && typeof p.s === 'number' && typeof p.e === 'number' && p.s >= 0 && p.s < p.e;
      });
    });
    return ok && validMemos_(data.memos, article);
  }
  // 区切り・完了・marked・区間メモが同じか（相手に区間メモが無ければ、区間メモは比べない）
  function sameContent(data, article) {
    if (!!data.marked !== !!article.marked) return false;
    if (JSON.stringify(copySections_(data.sections)) !== JSON.stringify(copySections_(article.sections))) return false;
    if (data.memos === undefined) return true;
    return JSON.stringify(copyMemos_(data.memos)) === JSON.stringify(copyMemos_(article.memos));
  }
  // ドライブの中身を記事に当てはめる（保存は呼ぶ側）。区間メモが無いファイル（古い版）なら、端末の区間メモは残す
  function apply(article, data) {
    article.sections = copySections_(data.sections);
    article.marked = !!data.marked;
    var keepLocal = data.memos === undefined && Object.keys(copyMemos_(article.memos)).length > 0;
    if (data.memos !== undefined) article.memos = copyMemos_(data.memos);
    article.syncSavedAt = Number(data.savedAt) || 0;
    article.syncDirty = keepLocal;   // 端末の区間メモを残したときは、まだドライブに無いので送る
  }
  // 確認画面に出す数 { parts: 区間の数, done: 完了した節の数, memos: 区間メモの数 }
  function summary(sections, memos) {
    var m = copyMemos_(memos);
    return { parts: sections.reduce(function (n, s) { return n + (s.parts || []).length; }, 0),
             done: sections.filter(function (s) { return !!s.done; }).length,
             memos: Object.keys(m).reduce(function (n, k) { return n + m[k].length; }, 0) };
  }
  window.RE = window.RE || {};
  RE.Sync = { deviceName: deviceName, makeData: makeData, isValidFor: isValidFor,
              sameContent: sameContent, apply: apply, summary: summary, copyMemos: copyMemos_ };
})();
