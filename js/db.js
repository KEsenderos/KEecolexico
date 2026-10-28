/* js/db.js — 記事と音声をiPhoneの中（IndexedDB）に保存する（RE.Db）。どの関数も失敗で止まらず、false・null・[] を返す */
/* 基づく仕様書：KEecolexico 仕様書 v1.0 */
(function () {
  'use strict';
  var C = RE.Config;
  var dbPromise_ = null;

  // データベースを開く（初回はストアを2つ作る）。使えない環境では null
  function open_() {
    if (dbPromise_) return dbPromise_;
    dbPromise_ = new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(C.DB_NAME, C.DB_VERSION); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(C.KX.STORE_ARTICLES)) db.createObjectStore(C.KX.STORE_ARTICLES, { keyPath: 'articleId' });
        if (!db.objectStoreNames.contains(C.KX.STORE_AUDIOS)) db.createObjectStore(C.KX.STORE_AUDIOS, { keyPath: 'articleId' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    }).then(function (db) { if (!db) dbPromise_ = null; return db; });
    return dbPromise_;
  }

  // 1回の読み書き。fn(store) が返したリクエストの結果を返す。失敗は fallback
  function run_(storeName, mode, fn, fallback) {
    return open_().then(function (db) {
      if (!db) return fallback;
      return new Promise(function (resolve) {
        var result = fallback;
        try {
          var tx = db.transaction(storeName, mode);
          var req = fn(tx.objectStore(storeName));
          if (req) req.onsuccess = function () { result = req.result; };
          // 書き込みは成功すれば true。読み出しで見つからなければ fallback
          tx.oncomplete = function () { resolve(mode === 'readwrite' ? true : (result === undefined ? fallback : result)); };
          tx.onerror = function () { resolve(fallback); };
          tx.onabort = function () { resolve(fallback); };
        } catch (e) { resolve(fallback); }
      });
    }).catch(function () { return fallback; });
  }

  // 記事を保存・上書き（updatedAt を今にする）
  function saveArticle(article) {
    article.updatedAt = Date.now();
    return run_(C.KX.STORE_ARTICLES, 'readwrite', function (st) { return st.put(article); }, false)
      .then(function (r) { return r !== false; });
  }

  // 記事を1件
  function getArticle(articleId) {
    return run_(C.KX.STORE_ARTICLES, 'readonly', function (st) { return st.get(articleId); }, null);
  }

  // 記事の全件（作成日の新しい順）
  function listArticles() {
    return run_(C.KX.STORE_ARTICLES, 'readonly', function (st) { return st.getAll(); }, []).then(function (list) {
      return (list || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
    });
  }

  // 音声を保存
  function saveAudio(articleId, file) {
    var rec = { articleId: articleId, blob: file, name: file.name || 'audio', type: file.type || '' };
    return run_(C.KX.STORE_AUDIOS, 'readwrite', function (st) { return st.put(rec); }, false)
      .then(function (r) { return r !== false; });
  }

  // 音声を取得
  function getAudio(articleId) {
    return run_(C.KX.STORE_AUDIOS, 'readonly', function (st) { return st.get(articleId); }, null);
  }

  // 記事と音声を両方削除
  function deleteArticle(articleId) {
    return Promise.all([
      run_(C.KX.STORE_ARTICLES, 'readwrite', function (st) { return st.delete(articleId); }, false),
      run_(C.KX.STORE_AUDIOS, 'readwrite', function (st) { return st.delete(articleId); }, false)
    ]).then(function (r) { return r[0] !== false && r[1] !== false; });
  }

  // iPhoneに保存領域を勝手に消さないようお願いする（できなくても問題なし）
  function requestPersist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* 無視 */ }
  }

  RE.Db = { saveArticle: saveArticle, getArticle: getArticle, listArticles: listArticles,
            saveAudio: saveAudio, getAudio: getAudio, deleteArticle: deleteArticle, requestPersist: requestPersist };
})();
