/* =========================================================
   render.js - 캔버스 렌더러 (원근 레인 / 노트 / 이펙트)
   ========================================================= */
var Renderer = (function () {
  'use strict';

  var cv, ctx, W = 0, H = 0, dpr = 1;
  var MIN = 0.17;                    // 최원경 스케일
  var F = { left: 0, right: 0, laneW: 0, cx: 0, judgeY: 0, horizonY: 0 };

  var COLOR = {
    tap:   ['#63d3ff', '#0e86c8'],
    flick: ['#ff77b4', '#c81c6d'],
    chain: ['#63f0a0', '#12a05c'],
    hold:  ['#ffd166', '#c98a12']
  };
  var JUDGE_COLOR = {
    PERFECT: '#ffe27a', GREAT: '#7bf3a6', GOOD: '#7ec8ff',
    BAD: '#c39dd6', MISS: '#ff6b81'
  };

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    /* 아직 레이아웃이 안 잡힌 상태(숨겨진 탭 등)에서는 0이 들어온다 */
    if (W <= 0 || H <= 0) { W = H = 0; return; }
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var fw = Math.min(W * 0.94, H * 1.05);
    F.left = (W - fw) / 2;
    F.right = F.left + fw;
    F.laneW = fw / 6;
    F.cx = W / 2;
    F.judgeY = H * 0.845;
    F.horizonY = H * 0.10;
  }

  function scaleOf(p) { return 1 / (1 + (1 / MIN - 1) * (1 - p)); }
  function yOf(s) { return F.horizonY + (F.judgeY - F.horizonY) * (s - MIN) / (1 - MIN); }
  function laneCx(lane) { return F.left + (lane + 0.5) * F.laneW; }
  function xOf(lx, s) { return F.cx + (lx - F.cx) * s; }

  /* --------------------------------------------------------
     배경 + 레인
     -------------------------------------------------------- */
  function drawField(game, songTime, st) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0715');
    g.addColorStop(0.55, '#150a24');
    g.addColorStop(1, '#220f2e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* 비트 펄스 */
    var spb = 60 / (game ? game.bpm : 150);
    var ph = songTime / spb;
    var pulse = Math.max(0, 1 - (ph - Math.floor(ph))) * 0.12;
    ctx.fillStyle = 'rgba(255,90,160,' + (pulse * 0.5).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);

    /* 레인 사다리꼴 */
    var sTop = MIN, sBot = 1;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xOf(F.left, sTop), yOf(sTop));
    ctx.lineTo(xOf(F.right, sTop), yOf(sTop));
    ctx.lineTo(xOf(F.right, sBot), yOf(sBot));
    ctx.lineTo(xOf(F.left, sBot), yOf(sBot));
    ctx.closePath();
    var lg = ctx.createLinearGradient(0, F.horizonY, 0, F.judgeY);
    lg.addColorStop(0, 'rgba(120,60,170,0.02)');
    lg.addColorStop(1, 'rgba(150,70,190,0.20)');
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.restore();

    /* 눌린 레인 하이라이트 */
    if (game) {
      for (var i = 0; i < 6; i++) {
        if (!game.held[i]) continue;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(xOf(F.left + i * F.laneW, sTop), yOf(sTop));
        ctx.lineTo(xOf(F.left + (i + 1) * F.laneW, sTop), yOf(sTop));
        ctx.lineTo(xOf(F.left + (i + 1) * F.laneW, sBot), yOf(sBot));
        ctx.lineTo(xOf(F.left + i * F.laneW, sBot), yOf(sBot));
        ctx.closePath();
        var hg = ctx.createLinearGradient(0, F.horizonY, 0, F.judgeY);
        hg.addColorStop(0, 'rgba(255,255,255,0)');
        hg.addColorStop(1, 'rgba(255,190,240,0.20)');
        ctx.fillStyle = hg;
        ctx.fill();
        ctx.restore();
      }
    }

    /* 구분선 */
    ctx.lineWidth = 1;
    for (var k = 0; k <= 6; k++) {
      var lx = F.left + k * F.laneW;
      var edge = (k === 0 || k === 6);
      ctx.strokeStyle = edge ? 'rgba(255,170,220,0.55)' : 'rgba(190,150,230,0.22)';
      ctx.beginPath();
      ctx.moveTo(xOf(lx, sTop), yOf(sTop));
      ctx.lineTo(xOf(lx, sBot), yOf(sBot));
      ctx.stroke();
    }

    /* 마디선 (BPM 기준) */
    if (st.showBars && game) {
      var bar = spb * 4;
      var first = Math.ceil((songTime) / bar) * bar;
      for (var t = first; t < songTime + st.travel; t += bar) {
        var p = 1 - (t - songTime) / st.travel;
        if (p < 0 || p > 1) continue;
        var s = scaleOf(p), y = yOf(s);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + 0.10 * p).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(xOf(F.left, s), y);
        ctx.lineTo(xOf(F.right, s), y);
        ctx.stroke();
      }
    }

    /* 판정선 */
    var jy = F.judgeY;
    var jg = ctx.createLinearGradient(F.left, 0, F.right, 0);
    jg.addColorStop(0, 'rgba(255,120,190,0)');
    jg.addColorStop(0.5, 'rgba(255,210,240,0.95)');
    jg.addColorStop(1, 'rgba(255,120,190,0)');
    ctx.fillStyle = jg;
    ctx.fillRect(F.left, jy - 2, F.right - F.left, 4);
    ctx.save();
    ctx.shadowColor = 'rgba(255,100,190,0.9)';
    ctx.shadowBlur = 18;
    ctx.fillRect(F.left, jy - 1.5, F.right - F.left, 3);
    ctx.restore();

    /* 키 라벨 */
    if (st.showKeys) {
      ctx.font = '600 ' + Math.round(F.laneW * 0.22) + 'px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var q = 0; q < 6; q++) {
        ctx.fillStyle = game && game.held[q] ? 'rgba(255,220,245,0.95)' : 'rgba(255,255,255,0.28)';
        ctx.fillText(st.keyLabels[q], laneCx(q), jy + F.laneW * 0.30);
      }
    }
  }

  /* --------------------------------------------------------
     체인(홀드/슬라이드) 리본
     -------------------------------------------------------- */
  function drawChain(n, songTime, travel) {
    var s0 = n.nodes[0].time, s1 = n.nodes[n.nodes.length - 1].time;
    if (s1 < songTime - 0.15) return;
    if (s0 > songTime + travel) return;

    var from = Math.max(s0, songTime);
    var steps = 26;
    var L = [], R = [];
    for (var i = 0; i <= steps; i++) {
      var t = U.lerp(from, s1, i / steps);
      var p = U.clamp(1 - (t - songTime) / travel, 0, 1);
      var s = scaleOf(p), y = yOf(s);
      var lane = laneAtF(n, t);
      var cxp = laneCx(lane);
      var hw = F.laneW * 0.30 * s;
      L.push([xOf(cxp - hw, s), y]);
      R.push([xOf(cxp + hw, s), y]);
    }

    ctx.beginPath();
    ctx.moveTo(L[0][0], L[0][1]);
    for (var a = 1; a < L.length; a++) ctx.lineTo(L[a][0], L[a][1]);
    for (var b = R.length - 1; b >= 0; b--) ctx.lineTo(R[b][0], R[b][1]);
    ctx.closePath();

    var base = n.slide ? COLOR.chain : COLOR.hold;
    var grad = ctx.createLinearGradient(0, F.horizonY, 0, F.judgeY);
    grad.addColorStop(0, hexA(base[1], 0.25));
    grad.addColorStop(1, hexA(base[0], n.active ? 0.72 : 0.42));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = hexA(base[0], n.active ? 0.9 : 0.5);
    ctx.lineWidth = n.active ? 2 : 1.2;
    ctx.stroke();

    /* 슬라이드 중간 노드 마커 */
    for (var q = 1; q < n.nodes.length - 1; q++) {
      var nd = n.nodes[q];
      var pp = 1 - (nd.time - songTime) / travel;
      if (pp < 0 || pp > 1) continue;
      var ss = scaleOf(pp);
      ctx.fillStyle = hexA(base[0], 0.85);
      ctx.beginPath();
      ctx.arc(xOf(laneCx(nd.lane), ss), yOf(ss), 4 * ss + 1.5, 0, 6.2832);
      ctx.fill();
    }
  }

  function laneAtF(n, t) {
    var nd = n.nodes;
    if (t <= nd[0].time) return nd[0].lane;
    for (var i = 0; i < nd.length - 1; i++) {
      if (t <= nd[i + 1].time) {
        var r = (t - nd[i].time) / Math.max(1e-6, nd[i + 1].time - nd[i].time);
        return U.lerp(nd[i].lane, nd[i + 1].lane, r);
      }
    }
    return nd[nd.length - 1].lane;
  }

  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* --------------------------------------------------------
     노트 한 개
     -------------------------------------------------------- */
  function drawNote(kind, lane, p, alpha) {
    var s = scaleOf(p), y = yOf(s);
    var c = COLOR[kind] || COLOR.tap;
    var w = F.laneW * 0.86 * s;
    var h = Math.max(4, 30 * s);
    var x = xOf(laneCx(lane), s) - w / 2;

    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.shadowColor = hexA(c[0], 0.85);
    ctx.shadowBlur = 14 * s + 3;

    var g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.42, c[0]);
    g.addColorStop(1, c[1]);
    ctx.fillStyle = g;
    U.roundRect(ctx, x, y - h / 2, w, h, h * 0.42);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(0.6, 1.6 * s);
    U.roundRect(ctx, x, y - h / 2, w, h, h * 0.42);
    ctx.stroke();

    /* 플릭 화살표 */
    if (kind === 'flick') {
      var ah = h * 0.42;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y - ah);
      ctx.lineTo(x + w / 2 + ah * 0.9, y + ah * 0.55);
      ctx.lineTo(x + w / 2 - ah * 0.9, y + ah * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------------------
     타격 이펙트
     -------------------------------------------------------- */
  function drawEffects(game, now) {
    for (var i = 0; i < game.effects.length; i++) {
      var e = game.effects[i];
      var age = now - e.time;
      if (age < 0 || age > 0.38) continue;
      var k = age / 0.38;
      var x = laneCx(e.lane), y = F.judgeY;
      var col = JUDGE_COLOR[e.result] || '#fff';

      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.ellipse(x, y, F.laneW * (0.25 + k * 0.75), F.laneW * (0.10 + k * 0.30), 0, 0, 6.2832);
      ctx.stroke();

      ctx.globalAlpha = (1 - k) * 0.85;
      var fg = ctx.createRadialGradient(x, y, 0, x, y, F.laneW * 0.75);
      fg.addColorStop(0, hexA(col, 0.9));
      fg.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.ellipse(x, y, F.laneW * 0.75, F.laneW * 0.35, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
  }

  /* --------------------------------------------------------
     콤보 / 판정 텍스트
     -------------------------------------------------------- */
  function drawHud(game, now) {
    var cy = F.judgeY - (F.judgeY - F.horizonY) * 0.46;

    if (game.combo >= 3) {
      var pop = 1;
      if (game.lastJudge && now - game.lastJudge.time < 0.12) {
        pop = 1 + (1 - (now - game.lastJudge.time) / 0.12) * 0.16;
      }
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.translate(F.cx, cy);
      ctx.scale(pop, pop);
      ctx.font = '800 ' + Math.round(H * 0.085) + 'px Inter, system-ui, sans-serif';
      ctx.shadowColor = 'rgba(255,150,220,0.8)'; ctx.shadowBlur = 22;
      ctx.fillStyle = '#fff';
      ctx.fillText(game.combo, 0, 0);
      ctx.font = '700 ' + Math.round(H * 0.022) + 'px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,220,245,0.85)';
      ctx.fillText('COMBO', 0, H * 0.062);
      ctx.restore();
    }

    var lj = game.lastJudge;
    if (lj && now - lj.time < 0.5) {
      var a = 1 - (now - lj.time) / 0.5;
      ctx.save();
      ctx.globalAlpha = Math.min(1, a * 1.8);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.round(H * 0.042) + 'px Inter, system-ui, sans-serif';
      ctx.fillStyle = JUDGE_COLOR[lj.result];
      ctx.shadowColor = JUDGE_COLOR[lj.result]; ctx.shadowBlur = 16;
      ctx.fillText(lj.result, F.cx, F.judgeY - H * 0.115);
      if (lj.early !== 0 && lj.result !== 'PERFECT' && lj.result !== 'MISS') {
        ctx.font = '700 ' + Math.round(H * 0.020) + 'px Inter, system-ui, sans-serif';
        ctx.fillStyle = lj.early < 0 ? '#8fd7ff' : '#ffb38f';
        ctx.fillText(lj.early < 0 ? 'FAST' : 'LATE', F.cx, F.judgeY - H * 0.082);
      }
      ctx.restore();
    }
  }

  /* --------------------------------------------------------
     메인 draw
     -------------------------------------------------------- */
  function draw(game, songTime, st) {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawField(game, songTime, st);
    if (!game) return;

    var travel = st.travel;
    var notes = game.notes;
    var vis = [];
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var tEnd = n.endTime || n.time;
      if (n.time > songTime + travel) break;
      if (tEnd < songTime - 0.2 || n.done) continue;
      vis.push(n);
    }

    /* 리본 먼저 */
    for (var a = vis.length - 1; a >= 0; a--) {
      if (vis[a].type === 'chain') drawChain(vis[a], songTime, travel);
    }

    /* 노트: 먼 것부터 */
    for (var b = vis.length - 1; b >= 0; b--) {
      var m = vis[b];
      if (m.type === 'chain') {
        var kind = m.slide ? 'chain' : 'hold';
        var ph = 1 - (m.time - songTime) / travel;
        if (ph >= 0 && ph <= 1 && !m.headHit) drawNote(kind, m.nodes[0].lane, ph, 1);
        var pt = 1 - (m.endTime - songTime) / travel;
        if (pt >= 0 && pt <= 1 && !m.done) {
          drawNote(m.endType === 'flick' ? 'flick' : kind,
                   m.nodes[m.nodes.length - 1].lane, pt, 1);
        }
        /* 활성 체인의 현재 위치 마커 */
        if (m.active) {
          var lane = laneAtF(m, songTime);
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.shadowColor = '#7cffb8'; ctx.shadowBlur = 20;
          ctx.beginPath();
          ctx.ellipse(xOf(laneCx(lane), 1), F.judgeY, F.laneW * 0.30, F.laneW * 0.12, 0, 0, 6.2832);
          ctx.fill();
          ctx.restore();
        }
        continue;
      }
      var p = 1 - (m.time - songTime) / travel;
      if (p < 0 || p > 1) continue;
      drawNote(m.type, m.lane, p, 1);
    }

    drawEffects(game, songTime);
    drawHud(game, songTime);
  }

  return { init: init, resize: resize, draw: draw, laneCx: laneCx, field: F };
})();
