// article.js — 記事本文を1文ずつに分け、文番号(sid)と節(ブロック)を付ける
// 基づく仕様書：KEecolexico 仕様書 v1.3
(function () {
  'use strict';
  var RE_QUESTION   = /^(\d+(?:\s*,\s*\d+)*)\.\s+(\S.*)$/;
  var RE_RESPUESTA  = /^respuestas?$/i;
  var RE_TEMA       = /^tema$/i;
  var RE_REVIEW     = /¿?\s*QUÉ\s+[A-ZÁÉÍÓÚÜÑ]+RÍAS\s*\??\s*$/i;
  var RE_LOWER      = /[a-záéíóúüñ]/;
  var RE_LETTERS    = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g;
  var RE_NEXT_START = /[A-ZÁÉÍÓÚÜÑ¿¡“"«]/;
  var RE_FOOTNOTE   = /([.?!][”"’»]?)\s+[a-dfgh](?=\s+[A-ZÁÉÍÓÚÜÑ¿¡“"«]|\s*$)/g;
  var RE_IMAGE_NOTE = /\s*\((?:Mira|Vea|Véase) también (?:la imagen|las imágenes)\)\.?/gi;
  var ABBREVIATIONS = ['sr','sra','srta','dr','dra','etc','pág','págs','núm','ej','vol','cap'];

  // 1行を整える（見えない文字・ノーブレークスペース・連続空白）
  function normalizeLine_(s) {
    return s.replace(/[​-‍﻿]/g, '').replace(/ /g, ' ')
            .replace(/[ \t]+/g, ' ').trim();
  }
  // 文末の脚注記号 a / b を消す
  function stripFootnoteMarks_(s) { return s.replace(RE_FOOTNOTE, '$1'); }
  // 段落冒頭の「CUANDO」→「Cuando」
  function normalizeLeadingCaps_(s) {
    return s.replace(/^([A-ZÁÉÍÓÚÜÑ]{2,})(?=[\s,.;:]|$)/, function (w) { return w[0] + w.slice(1).toLowerCase(); });
  }
  // 括弧内の「(SANT. 4:7)」→「(Sant. 4:7)」
  function normalizeRefCase_(s) {
    return s.replace(/\([^)]*\)/g, function (seg) {
      return seg.replace(/\b([A-ZÁÉÍÓÚÜÑ])([A-ZÁÉÍÓÚÜÑ]+)(?=\.|\s\d)/g, function (m, a, b) { return a + b.toLowerCase(); });
    });
  }
  // そのピリオドが略語（Sr. など）の後か
  function isAbbreviation_(text, i) {
    var m = text.slice(0, i).match(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)$/);
    return !!m && ABBREVIATIONS.indexOf(m[1].toLowerCase()) >= 0;
  }
  // 本文を文に分ける（括弧の中・「...」・略語では分けない）
  function splitSentences(text) {
    var out = [], start = 0, depth = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '(') { depth++; continue; }
      if (c === ')') { depth = Math.max(0, depth - 1); continue; }
      if (depth > 0 || !/[.?!]/.test(c)) continue;
      if (c === '.' && (text[i - 1] === '.' || text[i + 1] === '.')) continue;
      if (c === '.' && isAbbreviation_(text, i)) continue;
      var j = i + 1;
      while (j < text.length && /[”"’»]/.test(text[j])) j++;
      if (j >= text.length) break;
      if (!/\s/.test(text[j])) continue;
      var k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (k < text.length && RE_NEXT_START.test(text[k])) {
        out.push(text.slice(start, j).trim());
        start = k; i = k - 1;
      }
    }
    var rest = text.slice(start).trim();
    if (rest) out.push(rest);
    return out;
  }
  // 大文字だけの見出し行か
  function isHeading_(s) {
    var letters = s.match(RE_LETTERS) || [];
    return letters.length >= 4 && !RE_LOWER.test(s);
  }
  // 記事全体を整形する。戻り値 { units:[{sid,kind,para,text,section}], skipped:[行] }
  function parseArticle(rawText) {
    var lines = rawText.split(/\r?\n/).map(normalizeLine_);
    var units = [], skipped = [];
    var state = 'head', tCount = 0, hCount = 0, rCount = 0;
    var expectBody = false, temaNext = false;
    var currentParas = [], usedParas = {}, section = '';
    function add(u) { u.section = section; units.push(u); }
    for (var n = 0; n < lines.length; n++) {
      var line = lines[n];
      if (!line) continue;
      if (RE_RESPUESTA.test(line)) { if (state !== 'review') expectBody = true; continue; }
      if (state === 'head') {
        if (RE_TEMA.test(line)) { temaNext = true; continue; }
        if (temaNext) { add({ sid: 'T-' + (++tCount), kind: 'tema', para: null, text: 'Tema: ' + line }); temaNext = false; state = 'main'; continue; }
        if (!RE_QUESTION.test(line)) { add({ sid: 'T-' + (++tCount), kind: 'title', para: null, text: normalizeRefCase_(line) }); continue; }
        state = 'main';
      }
      if (state === 'review') { add({ sid: 'R-' + (++rCount), kind: 'review', para: null, text: line }); continue; }
      var q = line.match(RE_QUESTION);
      if (q) {
        currentParas = q[1].split(/\s*,\s*/);
        add({ sid: 'Q' + currentParas.join('-'), kind: 'question', para: currentParas.join('-'),
              text: q[2].replace(RE_IMAGE_NOTE, '').trim() });
        expectBody = false; continue;
      }
      if (isHeading_(line)) {
        section = line;
        add({ sid: 'H-' + (++hCount), kind: 'heading', para: null, text: line });
        if (RE_REVIEW.test(line)) state = 'review';
        continue;
      }
      var lead = line.match(/^(\d+)\s+(?=\S)/);
      var para = null, body = line;
      if (lead && currentParas.indexOf(lead[1]) >= 0 && !usedParas[lead[1]]) {
        para = lead[1]; body = line.slice(lead[0].length);
      } else if (expectBody) {
        para = currentParas.filter(function (p) { return !usedParas[p]; })[0] || null;
      }
      if (para) {
        usedParas[para] = true; expectBody = false;
        body = normalizeRefCase_(normalizeLeadingCaps_(stripFootnoteMarks_(body)));
        splitSentences(body).forEach(function (s, idx) {
          add({ sid: para + '-' + (idx + 1), kind: 'body', para: para, text: s });
        });
        continue;
      }
      skipped.push(line);
    }
    return { units: units, skipped: skipped };
  }
  // 文を節(ブロック)にまとめる。各文に blockId を付ける。戻り値 [{id,label,units}]
  function buildBlocks(units) {
    var blocks = [], cur = null, pendingHeads = [];
    function open(id, label) {
      cur = { id: id, label: label, units: pendingHeads.splice(0) };
      cur.units.forEach(function (h) { h.blockId = id; });
      blocks.push(cur);
    }
    units.forEach(function (u) {
      if (u.kind === 'heading') { pendingHeads.push(u); return; }
      if (u.kind === 'title' || u.kind === 'tema') { if (!cur || cur.id !== 'B-T') open('B-T', '冒頭'); }
      else if (u.kind === 'question') open('B-Q' + u.para, '第' + u.para + '節');
      else if (u.kind === 'review') { if (!cur || cur.id !== 'B-R') open('B-R', '復習質問'); }
      else if (!cur) open('B-X', 'その他');
      u.blockId = cur.id;
      cur.units.push(u);
    });
    if (pendingHeads.length) {
      if (!cur) open('B-X', 'その他');
      else { pendingHeads.forEach(function (h) { h.blockId = cur.id; }); cur.units.push.apply(cur.units, pendingHeads.splice(0)); }
    }
    return blocks;
  }
  window.RE = window.RE || {};
  RE.Article = { parseArticle: parseArticle, splitSentences: splitSentences, buildBlocks: buildBlocks };
})();
