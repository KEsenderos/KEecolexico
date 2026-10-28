// lexicon.js — CSVを語の一覧にし、本文のどの文に出てくるかを照合する
// 基づく仕様書：KEecolexico 仕様書 v0.9.1
(function () {
  'use strict';
  var RE_CLITICS = /^(?:me|te|se|nos|os|lo|la|los|las|le|les)+$/;

  // CSVを行の配列にする（引用符・カンマ・改行・"" に対応。BOMと空行を除く）
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = '';
        if (row.some(function (x) { return x.trim(); })) rows.push(row);
        row = [];
      } else f += c;
    }
    row.push(f);
    if (row.some(function (x) { return x.trim(); })) rows.push(row);
    return rows;
  }
  // 照合用に、小文字化してアクセントを外す
  function normalizeForMatch_(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  // 単語の並びにする
  function tokenize_(s) {
    return normalizeForMatch_(s).split(/[^a-z0-9]+/).filter(Boolean);
  }
  function stripTags_(s) { return s.replace(/<[^>]*>/g, ''); }

  // CSVの1行を語(Item)にする（4.3）
  function toItem(row, idx) {
    var front = (row[0] || '').trim(), back = row[1] || '', pos = (row[2] || '').trim();
    var m = front.match(/^(.*?)（([^（）]*)）\s*$/);
    var form = m ? m[1].trim() : front, lemma = m ? m[2].trim() : '';
    var lines = back.split(/<br\s*\/?>/i).map(function (s) { return s.trim(); }).filter(Boolean);
    var context = '', extra = [];
    lines.slice(1).forEach(function (l) {
      if (/^<i>.*<\/i>$/i.test(l)) context = stripTags_(l); else extra.push(stripTags_(l));
    });
    return { idx: idx, form: form, lemma: lemma, pos: pos,
             meaning: stripTags_(lines[0] || ''), extra: extra, context: context };
  }
  // 名詞・形容詞などの語形の変化（複数形・男女）
  function variants_(t) {
    var v = {}; [t, t + 's', t + 'es'].forEach(function (x) { v[x] = true; });
    if (/[oa]$/.test(t)) { var s = t.slice(0, -1); ['o', 'a', 'os', 'as'].forEach(function (e) { v[s + e] = true; }); }
    if (/z$/.test(t)) v[t.slice(0, -1) + 'ces'] = true;
    return v;
  }
  function exact_(t) { var v = {}; v[t] = true; return v; }

  // 語を探すキーを作る（4.4-2）。キー＝単語ごとの「一致してよい形」の並び
  function buildKeys_(item) {
    var keys = [];
    if (item.pos === '熟語') {
      if (item.context) item.context.split(/\s+\/\s+/).forEach(function (c) {
        var t = tokenize_(c); if (t.length) keys.push({ tokens: t.map(exact_), isVerb: false });
      });
      var head = [], words = item.form.split(/\s+/);
      for (var i = 0; i < words.length; i++) {
        if (/^[a-záéíóúüñ]+$/i.test(words[i]) && !/^[A-Z]$/.test(words[i])) head.push(normalizeForMatch_(words[i]));
        else break;
      }
      if (head.length >= 2) keys.push({ tokens: head.map(exact_), isVerb: false });
      return keys;
    }
    var t = tokenize_(item.form);
    if (!t.length) return keys;
    if (item.pos === '動詞') keys.push({ tokens: t.map(exact_), isVerb: true });
    else keys.push({ tokens: t.map(variants_), isVerb: false });
    return keys;
  }
  // 1語の一致判定。動詞の最後の語だけ、後ろに付いた代名詞(nos など)を許す
  function tokenOk_(set, tok, allowClitic) {
    if (set[tok]) return true;
    if (!allowClitic) return false;
    for (var v in set) {
      if (tok.length > v.length && tok.indexOf(v) === 0 && RE_CLITICS.test(tok.slice(v.length))) return true;
    }
    return false;
  }
  // 文の単語の並びの中でキーが始まる位置。無ければ -1
  function findInTokens_(tokens, key) {
    var n = key.tokens.length;
    for (var i = 0; i + n <= tokens.length; i++) {
      var ok = true;
      for (var k = 0; k < n; k++) {
        if (!tokenOk_(key.tokens[k], tokens[i + k], key.isVerb && k === n - 1)) { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  }
  // 照合（4.4）。units は blockId 付きの文。戻り値 { hits:[{sid,blockId,item,at,len}], unmatched:[item] }
  function matchItems(items, units) {
    var toks = units.map(function (u) { return tokenize_(u.text); });
    var hits = [], unmatched = [];
    items.forEach(function (it) {
      var keys = buildKeys_(it), seenBlock = {}, any = false;
      units.forEach(function (u, ui) {
        if (seenBlock[u.blockId]) return;
        var best = -1, len = 0;
        keys.forEach(function (k) {
          var a = findInTokens_(toks[ui], k);
          if (a >= 0 && (best < 0 || a < best)) { best = a; len = k.tokens.length; }
        });
        if (best >= 0) {
          seenBlock[u.blockId] = true; any = true;
          hits.push({ sid: u.sid, blockId: u.blockId, item: it, at: best, len: len });
        }
      });
      if (!any) unmatched.push(it);
    });
    return { hits: hits, unmatched: unmatched };
  }
  // CSV文字列から語の一覧を作る。1列目が空の行は捨てる
  function itemsFromCsv(text) {
    return parseCsv(text).filter(function (r) { return (r[0] || '').trim(); }).map(toItem);
  }
  window.RE = window.RE || {};
  RE.Lexicon = { parseCsv: parseCsv, toItem: toItem, itemsFromCsv: itemsFromCsv, matchItems: matchItems };
})();
