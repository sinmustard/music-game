/* =========================================================
   chart.js - 내장 채보 생성기 (연애재판 / BPM 150 / 4-4박)
   ---------------------------------------------------------
   * 6레인(S D F  J K L) 기준.
   * 곡 구조(인트로-A멜로-B멜로-사비-간주-...)를 따라
     마디 단위로 패턴을 쌓아 올린다.
   * APPEND 난이도를 풀로 생성한 뒤, 하위 난이도는
     솎아내기(thin)로 파생시킨다.
   ========================================================= */
var Charts = (function () {
  'use strict';

  var LANES = 6;
  var L = [0, 1, 2], R = [3, 4, 5];   // 왼손 / 오른손

  /* ---------------------------------------------------------
     빌더: 비트(beat) 단위로 노트를 쌓는다. 1 beat = 4분음표
     --------------------------------------------------------- */
  function Builder(seed) {
    this.n = [];
    this.rnd = U.mulberry32(seed);
  }
  Builder.prototype.pick = function (arr) {
    return arr[Math.floor(this.rnd() * arr.length) % arr.length];
  };
  Builder.prototype.tap = function (b, lane) {
    this.n.push({ type: 'tap', beat: b, lane: lane });
  };
  Builder.prototype.flick = function (b, lane, dir) {
    this.n.push({ type: 'flick', beat: b, lane: lane, dir: dir || 'up' });
  };
  Builder.prototype.hold = function (b, len, lane, endType) {
    this.n.push({
      type: 'chain', beat: b, lane: lane, slide: false,
      nodes: [{ beat: b, lane: lane }, { beat: b + len, lane: lane }],
      endType: endType || 'release'
    });
  };
  /* pts = [[beat, lane], ...] */
  Builder.prototype.slide = function (pts, endType) {
    var nodes = [], slide = false;
    for (var i = 0; i < pts.length; i++) {
      nodes.push({ beat: pts[i][0], lane: pts[i][1] });
      if (i > 0 && pts[i][1] !== pts[i - 1][1]) slide = true;
    }
    this.n.push({
      type: 'chain', beat: nodes[0].beat, lane: nodes[0].lane,
      slide: slide, nodes: nodes, endType: endType || 'release'
    });
  };
  Builder.prototype.chord = function (b, lanes) {
    for (var i = 0; i < lanes.length; i++) this.tap(b, lanes[i]);
  };

  /* 연타 스트림. mode 로 손 이동 패턴을 바꾼다. */
  Builder.prototype.stream = function (b0, count, step, start, mode) {
    var lane = start, i;
    for (i = 0; i < count; i++) {
      this.tap(b0 + i * step, lane);
      switch (mode) {
        case 'up':     lane = (lane + 1) % LANES; break;
        case 'down':   lane = (lane + LANES - 1) % LANES; break;
        case 'alt':    lane = (lane < 3) ? (3 + (i % 3)) : ((i + 1) % 3); break;
        case 'zig':    lane = (i % 2 === 0) ? (5 - (i % 6)) : (i % 6); break;
        case 'inout':  lane = [0, 5, 1, 4, 2, 3][(i + 1) % 6]; break;
        default:       lane = (lane + 1) % LANES;
      }
    }
  };
  Builder.prototype.trill = function (b0, count, step, a, b) {
    for (var i = 0; i < count; i++) this.tap(b0 + i * step, i % 2 ? b : a);
  };

  /* ---------------------------------------------------------
     섹션 패턴
     --------------------------------------------------------- */

  /* 인트로: 피아노/밴드 인 - 성기게 */
  function secIntro(B, b0, bars) {
    for (var m = 0; m < bars; m++) {
      var b = b0 + m * 4;
      if (m < 2) {
        B.tap(b, m % 2 ? 4 : 1);
        B.tap(b + 2, m % 2 ? 1 : 4);
        B.tap(b + 3, m % 2 ? 2 : 3);
      } else if (m < 4) {
        B.tap(b, 0); B.tap(b + 0.5, 5);
        B.tap(b + 1, 1); B.tap(b + 1.5, 4);
        B.hold(b + 2, 1.5, m % 2 ? 2 : 3);
        B.tap(b + 3.5, m % 2 ? 5 : 0);
      } else if (m < 7) {
        B.stream(b, 4, 0.5, m % 2 ? 5 : 0, m % 2 ? 'down' : 'up');
        B.tap(b + 2, 2); B.tap(b + 2, 3);
        B.tap(b + 3, 1); B.tap(b + 3.5, 4);
      } else {
        /* 마지막 마디: 16분 채움 + 플릭으로 A멜로 진입 */
        B.stream(b, 8, 0.25, 0, 'inout');
        B.chord(b + 2, [0, 5]);
        B.slide([[b + 2.5, 1], [b + 3, 2], [b + 3.5, 3]], 'flick');
      }
    }
  }

  /* A멜로: 보컬 리듬 - 8분 중심 + 간헐 16분 */
  function secVerse(B, b0, bars, variant) {
    var base = variant ? 3 : 1;
    for (var m = 0; m < bars; m++) {
      var b = b0 + m * 4;
      var p = m % 4;
      var l1 = (base + m) % LANES;
      var l2 = (LANES - 1 - l1);

      B.tap(b, l1);
      B.tap(b + 0.75, l2);
      B.tap(b + 1.5, (l1 + 2) % LANES);
      B.tap(b + 2, (l2 + 4) % LANES);

      if (p === 0) {
        B.tap(b + 2.5, (l1 + 3) % LANES);
        B.tap(b + 3, l2);
        B.tap(b + 3.5, l1);
      } else if (p === 1) {
        B.hold(b + 2.5, 1.25, (l1 + 1) % LANES);
        B.tap(b + 3, (l2 + 2) % LANES);
      } else if (p === 2) {
        /* 16분 필 */
        B.stream(b + 2.5, 4, 0.25, l2, 'alt');
        B.tap(b + 3.75, l1);
      } else {
        /* 슬라이드로 마무리 */
        var s = variant ? 5 : 0, e = variant ? 2 : 3;
        B.slide([[b + 2.5, s], [b + 3, (s + e) >> 1], [b + 3.75, e]], 'release');
      }

      if (variant && p === 3) B.flick(b + 3.75, variant ? 0 : 5, 'up');
    }
  }

  /* B멜로: 빌드업 - 밀도 상승 */
  function secPre(B, b0, bars) {
    for (var m = 0; m < bars; m++) {
      var b = b0 + m * 4;
      var dense = m >= bars - 3;
      B.chord(b, m % 2 ? [1, 4] : [0, 5]);
      B.stream(b + 0.5, 3, 0.5, m % 2 ? 4 : 1, m % 2 ? 'down' : 'up');
      if (dense) {
        B.stream(b + 2, 8, 0.25, m % 2 ? 5 : 0, 'inout');
      } else {
        B.tap(b + 2, 2); B.tap(b + 2.5, 3);
        B.slide([[b + 3, m % 2 ? 4 : 1], [b + 3.5, m % 2 ? 2 : 3], [b + 4, m % 2 ? 0 : 5]], 'flick');
      }
      if (m === bars - 1) {
        /* 사비 직전 폭발 */
        B.stream(b + 3, 4, 0.25, 0, 'zig');
        B.chord(b + 4 - 0.001, [0, 5]);
      }
    }
  }

  /* 사비(후렴): 16분 스트림 + 슬라이드 + 플릭 체인 */
  function secChorus(B, b0, bars, hard) {
    for (var m = 0; m < bars; m++) {
      var b = b0 + m * 4;
      var p = m % 8;

      /* 킥 = 코드 */
      B.chord(b, p % 2 ? [1, 4] : [0, 5]);

      switch (p) {
        case 0:
          B.stream(b + 0.5, 6, 0.25, 1, 'alt');
          B.tap(b + 2, 5); B.tap(b + 2.5, 0);
          B.slide([[b + 3, 2], [b + 3.5, 3], [b + 4, 4]], 'flick');
          break;
        case 1:
          B.trill(b + 0.5, 6, 0.25, 0, 3);
          B.chord(b + 2, [2, 5]);
          B.stream(b + 2.5, 6, 0.25, 4, 'down');
          break;
        case 2:
          B.hold(b + 0.5, 1, 5);
          B.stream(b + 0.5, 4, 0.25, 0, 'up');
          B.tap(b + 2, 1);
          B.stream(b + 2.25, 6, 0.25, 2, 'zig');
          B.flick(b + 3.75, 5, 'up');
          break;
        case 3:
          B.slide([[b + 0.5, 0], [b + 1, 1], [b + 1.5, 2], [b + 2, 3], [b + 2.5, 4]], 'flick');
          B.trill(b + 0.5, 8, 0.25, 5, 4);
          B.stream(b + 3, 4, 0.25, 1, 'alt');
          break;
        case 4:
          B.stream(b + 0.5, 6, 0.25, 4, 'down');
          B.chord(b + 2, [0, 3]);
          B.tap(b + 2.5, 5); B.tap(b + 2.75, 2);
          B.stream(b + 3, 4, 0.25, 5, 'inout');
          break;
        case 5:
          B.trill(b + 0.5, 6, 0.25, 2, 5);
          B.hold(b + 2, 1.5, 0);
          B.stream(b + 2.25, 6, 0.25, 3, 'up');
          B.flick(b + 3.75, 4, 'up');
          break;
        case 6:
          B.stream(b + 0.5, 8, 0.25, 0, 'inout');
          B.slide([[b + 2.5, 5], [b + 3, 4], [b + 3.5, 3], [b + 4, 2]], 'flick');
          B.tap(b + 2.5, 0); B.tap(b + 3, 1); B.tap(b + 3.5, 0);
          break;
        default:
          /* 프레이즈 마감: 계단 + 양손 코드 + 플릭 */
          B.stream(b + 0.5, 6, 0.25, 5, 'down');
          B.chord(b + 2, [1, 4]);
          B.stream(b + 2.5, 5, 0.25, 0, 'zig');
          B.chord(b + 3.75, [0, 5]);
          B.flick(b + 3.75, 2, 'up'); B.flick(b + 3.75, 3, 'up');
      }

      /* 하드 모드(라스트 사비): 추가 16분 잭 */
      if (hard && (p === 1 || p === 5)) {
        B.tap(b + 1.75, p === 1 ? 5 : 0);
        B.tap(b + 3.25, p === 1 ? 0 : 5);
      }
      if (hard && p === 7) B.stream(b + 3, 3, 0.25, 2, 'up');
    }
  }

  /* 간주 / 기타솔로 */
  function secBreak(B, b0, bars) {
    for (var m = 0; m < bars; m++) {
      var b = b0 + m * 4;
      B.stream(b, 8, 0.25, m % 2 ? 5 : 0, m % 2 ? 'down' : 'up');
      B.stream(b + 2, 6, 0.25, 2, 'zig');
      B.chord(b + 3.5, [0, 5]);
      B.flick(b + 3.75, m % 2 ? 1 : 4, 'up');
    }
  }

  /* 브릿지: 롱슬라이드로 숨 고르기 */
  function secBridge(B, b0, bars) {
    for (var m = 0; m < bars; m++) {
      var b = b0 + m * 4;
      if (m < 4) {
        B.slide([[b, m % 2 ? 4 : 1], [b + 1, m % 2 ? 3 : 2],
                 [b + 2, m % 2 ? 1 : 4], [b + 3.5, m % 2 ? 0 : 5]], 'release');
        B.tap(b + 1, m % 2 ? 0 : 5);
        B.tap(b + 2.5, m % 2 ? 5 : 0);
      } else {
        B.stream(b, 4, 0.5, m % 2 ? 5 : 0, m % 2 ? 'down' : 'up');
        B.stream(b + 2, 8, 0.25, 2, 'alt');
      }
    }
  }

  /* 아웃트로 */
  function secOutro(B, b0, bars) {
    for (var m = 0; m < bars; m++) {
      var b = b0 + m * 4;
      if (m < bars - 2) {
        B.tap(b, m % 2 ? 1 : 4);
        B.tap(b + 1, m % 2 ? 4 : 1);
        B.tap(b + 2, 2); B.tap(b + 2, 3);
        B.slide([[b + 3, m % 2 ? 0 : 5], [b + 3.5, m % 2 ? 1 : 4]], 'release');
      } else if (m === bars - 2) {
        B.stream(b, 8, 0.25, 0, 'inout');
        B.chord(b + 2, [0, 5]);
      } else {
        B.chord(b, [0, 1, 4, 5]);
        B.flick(b + 2, 2, 'up'); B.flick(b + 2, 3, 'up');
      }
    }
  }

  /* ---------------------------------------------------------
     곡 전체 구성 (128마디 ≒ 3분25초 @ BPM150)
     --------------------------------------------------------- */
  function compose() {
    var B = new Builder(0x4C4F5645); // 'LOVE'
    var b = 0, bar = 4;
    secIntro(B, b, 8);            b += 8 * bar;
    secVerse(B, b, 16, 0);        b += 16 * bar;
    secPre(B, b, 8);              b += 8 * bar;
    secChorus(B, b, 16, false);   b += 16 * bar;
    secBreak(B, b, 4);            b += 4 * bar;
    secVerse(B, b, 16, 1);        b += 16 * bar;
    secPre(B, b, 8);              b += 8 * bar;
    secChorus(B, b, 16, false);   b += 16 * bar;
    secBridge(B, b, 8);           b += 8 * bar;
    secChorus(B, b, 20, true);    b += 20 * bar;
    secOutro(B, b, 8);            b += 8 * bar;
    return B.n;
  }

  /* ---------------------------------------------------------
     난이도 솎아내기
     grid: 유지할 최소 분할 (1=4분, 2=8분, 4=16분)
     --------------------------------------------------------- */
  var DIFFS = {
    NORMAL: { lv: 14, grid: 1, drop: 0.30, noFlick: true,  noSlide: true  },
    HARD:   { lv: 20, grid: 2, drop: 0.28, noFlick: true,  noSlide: false },
    EXPERT: { lv: 26, grid: 4, drop: 0.50, noFlick: false, noSlide: false },
    MASTER: { lv: 31, grid: 4, drop: 0.22, noFlick: false, noSlide: false },
    APPEND: { lv: 35, grid: 4, drop: 0.00, noFlick: false, noSlide: false }
  };

  function thin(notes, diff) {
    var cfg = DIFFS[diff] || DIFFS.APPEND;
    var rnd = U.mulberry32(0xC0FFEE ^ cfg.lv);
    var out = [], i, n;

    for (i = 0; i < notes.length; i++) {
      n = notes[i];

      if (n.type === 'chain') {
        /* 원본(_raw)을 건드리지 않도록 항상 복제해서 내보낸다 */
        var a = n.nodes[0], z = n.nodes[n.nodes.length - 1];
        var nodes = (cfg.noSlide && n.slide)
          ? [{ beat: a.beat, lane: a.lane }, { beat: z.beat, lane: a.lane }]
          : n.nodes.map(function (p) { return { beat: p.beat, lane: p.lane }; });
        out.push({
          type: 'chain', beat: a.beat, lane: a.lane,
          slide: (cfg.noSlide ? false : n.slide),
          nodes: nodes,
          endType: (cfg.noFlick && n.endType === 'flick') ? 'release' : n.endType
        });
        continue;
      }

      /* 격자 밖(더 잘게 쪼개진) 노트 제거 */
      var g = n.beat * cfg.grid;
      if (Math.abs(g - Math.round(g)) > 1e-6) continue;

      if (cfg.noFlick && n.type === 'flick') n = { type: 'tap', beat: n.beat, lane: n.lane };

      /* 다운비트는 항상 보존, 나머지는 확률적으로 솎음 */
      var onBeat = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
      if (!onBeat && rnd() < cfg.drop) continue;

      out.push(n);
    }
    return out;
  }

  /* ---------------------------------------------------------
     유효성 정리: 같은 레인 중복/홀드 겹침 제거
     --------------------------------------------------------- */
  /* engine.laneAt 과 동일한 반올림 규칙 — 체인이 "실제로 점유하는" 레인 */
  function chainLaneAt(n, b) {
    var nd = n.nodes;
    if (b <= nd[0].beat) return nd[0].lane;
    for (var i = 0; i < nd.length - 1; i++) {
      if (b <= nd[i + 1].beat) {
        var r = (b - nd[i].beat) / Math.max(1e-6, nd[i + 1].beat - nd[i].beat);
        return Math.round(U.lerp(nd[i].lane, nd[i + 1].lane, r));
      }
    }
    return nd[nd.length - 1].lane;
  }

  /* 체인이 점유하는 [레인, 시작, 끝] 구간 목록 */
  function occupancy(n) {
    var s = n.nodes[0].beat, e = n.nodes[n.nodes.length - 1].beat;
    var segs = [], step = 0.0625;
    var cur = chainLaneAt(n, s), from = s;
    for (var b = s + step; b < e; b += step) {
      var l = chainLaneAt(n, b);
      if (l !== cur) { segs.push([cur, from, b]); cur = l; from = b; }
    }
    segs.push([cur, from, e]);
    return segs;
  }

  function sanitize(notes) {
    var PAD = 0.16;              // 체인 점유 구간 앞뒤 여유(beat) ≒ 64ms @150
    var MIN = 0.115;             // 같은 레인 최소 간격(beat)
    var busy = [[], [], [], [], [], []];
    var lastAt = [-9, -9, -9, -9, -9, -9];
    var chains = [], singles = [], out = [], i, n;

    for (i = 0; i < notes.length; i++) {
      (notes[i].type === 'chain' ? chains : singles).push(notes[i]);
    }
    var byBeat = function (a, b) { return a.beat - b.beat || a.lane - b.lane; };
    chains.sort(byBeat); singles.sort(byBeat);

    function blocked(lane, b) {
      var arr = busy[lane];
      for (var k = 0; k < arr.length; k++) {
        if (b > arr[k][0] - PAD && b < arr[k][1] + PAD) return true;
      }
      return false;
    }

    /* 1) 체인 먼저 확정 (음악적으로 더 중요하므로 우선권) */
    for (i = 0; i < chains.length; i++) {
      n = chains[i];
      var segs = occupancy(n);
      if (n.nodes[n.nodes.length - 1].beat - n.nodes[0].beat < 0.2) continue;

      var conflict = false;
      for (var s = 0; s < segs.length && !conflict; s++) {
        var arr = busy[segs[s][0]];
        for (var k = 0; k < arr.length; k++) {
          if (segs[s][2] > arr[k][0] - PAD && segs[s][1] < arr[k][1] + PAD) { conflict = true; break; }
        }
      }
      if (conflict) continue;

      for (var s2 = 0; s2 < segs.length; s2++) busy[segs[s2][0]].push([segs[s2][1], segs[s2][2]]);
      out.push(n);
    }

    /* 2) 단타 배치 */
    for (i = 0; i < singles.length; i++) {
      n = singles[i];
      if (n.beat - lastAt[n.lane] < MIN) continue;
      if (blocked(n.lane, n.beat)) continue;
      lastAt[n.lane] = n.beat;
      out.push(n);
    }

    out.sort(byBeat);
    return out;
  }

  /* ---------------------------------------------------------
     public: 비트 -> 초 변환까지 마친 채보 반환
     --------------------------------------------------------- */
  function toSeconds(notes, bpm, offset) {
    var spb = 60 / bpm, out = [];
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var o = { type: n.type, lane: n.lane, time: offset + n.beat * spb, dir: n.dir || 'up' };
      if (n.type === 'chain') {
        o.slide = n.slide;
        o.endType = n.endType;
        o.nodes = n.nodes.map(function (p) {
          return { time: offset + p.beat * spb, lane: p.lane };
        });
        o.time = o.nodes[0].time;
        o.endTime = o.nodes[o.nodes.length - 1].time;
      }
      out.push(o);
    }
    out.sort(function (a, b) { return a.time - b.time; });
    return out;
  }

  var _raw = null;
  function build(diff, bpm, offset) {
    if (!_raw) _raw = compose();
    var notes = sanitize(thin(_raw, diff));
    return {
      notes: toSeconds(notes, bpm, offset),
      bpm: bpm,
      diff: diff,
      level: (DIFFS[diff] || DIFFS.APPEND).lv,
      source: '내장 채보'
    };
  }

  return {
    build: build, thin: thin, sanitize: sanitize, toSeconds: toSeconds,
    DIFFS: DIFFS, LANES: LANES
  };
})();
