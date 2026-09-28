/* =========================================================
   songs.js - 내장 오리지널 곡 (자유 이용)
   ---------------------------------------------------------
   코드 진행 + 음계에서 멜로디를 알고리즘으로 생성한다.
   따라서 곡 자체가 이 프로젝트의 창작물이고, 재배포에
   아무 제약이 없다.

   더 중요한 건 싱크다. 멜로디 음표의 시각을 이미 알고
   있으므로 온셋 검출로 "추정"할 필요가 없다 -> 채보가
   음악과 정확히 일치한다.
   ========================================================= */
var Songs = (function () {
  'use strict';

  var MINOR = [0, 2, 3, 5, 7, 8, 10];       // 자연단음계
  var TRIAD = { min: [0, 3, 7], maj: [0, 4, 7] };

  /* ---------------------------------------------------------
     곡 정의
     prog: [[루트 midi, 화음], ...]  (한 마디에 하나씩 순환)
     plan: '섹션:마디수'
     --------------------------------------------------------- */
  var LIST = [
    {
      id: 'verdict', title: 'VERDICT', sub: '유죄인가, 무죄인가',
      bpm: 160, seed: 0x5645, lead: 72, range: 12,
      prog: [[57, 'min'], [53, 'maj'], [48, 'maj'], [55, 'maj']],
      plan: ['intro:8', 'verse:16', 'pre:8', 'chorus:16', 'break:4',
             'verse:12', 'pre:8', 'chorus:16', 'bridge:8', 'chorus:16', 'outro:8']
    },
    {
      id: 'parade', title: 'GLASS PARADE', sub: '유리창 너머의 행진',
      bpm: 174, seed: 0x9A2C, lead: 74, range: 14,
      prog: [[52, 'min'], [48, 'maj'], [55, 'maj'], [50, 'maj']],
      plan: ['intro:8', 'verse:16', 'pre:8', 'chorus:16', 'break:4',
             'verse:16', 'pre:8', 'chorus:16', 'bridge:8', 'chorus:20', 'outro:8']
    },
    {
      id: 'lanterns', title: 'PAPER LANTERNS', sub: '느린 밤의 등불',
      bpm: 132, seed: 0x3D71, lead: 69, range: 11,
      prog: [[50, 'min'], [57, 'min'], [53, 'maj'], [48, 'maj']],
      plan: ['intro:8', 'verse:16', 'pre:8', 'chorus:16',
             'verse:12', 'pre:8', 'chorus:16', 'bridge:8', 'chorus:16', 'outro:8']
    }
  ];

  /* 섹션별 리드 리듬(한 마디 16칸) 후보 */
  var RHY = {
    intro:  [[1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
             [1,0,0,0, 1,0,0,0, 0,0,1,0, 0,0,1,0]],
    verse:  [[1,0,0,1, 0,0,1,0, 1,0,0,0, 1,0,0,0],
             [1,0,1,0, 0,1,0,0, 1,0,0,1, 0,0,1,0],
             [1,0,0,0, 1,0,1,0, 0,1,0,0, 1,0,0,1]],
    pre:    [[1,0,1,0, 1,0,1,0, 1,0,1,0, 1,1,0,0],
             [1,0,1,1, 0,1,0,1, 1,0,1,0, 1,0,1,0]],
    chorus: [[1,0,1,0, 1,1,0,1, 1,0,1,0, 1,0,1,1],
             [1,1,0,1, 0,1,1,0, 1,0,1,1, 0,1,0,1],
             [1,0,1,1, 1,0,1,0, 1,1,0,1, 1,0,1,0]],
    break:  [[1,0,1,0, 1,0,1,0, 1,1,1,0, 1,1,1,1]],
    bridge: [[1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
             [1,0,0,0, 1,0,0,0, 1,0,1,0, 1,0,1,0]],
    outro:  [[1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0]]
  };

  /* ---------------------------------------------------------
     작곡
     --------------------------------------------------------- */
  function compose(def) {
    var rnd = U.mulberry32(def.seed);
    var spb = 60 / def.bpm;
    var ev = [], anchors = [];
    var bar = 0, pitch = def.lead;

    function T(b) { return b * spb; }              // beat -> sec

    function note(beat, dur, midi, inst, v) {
      ev.push({ t: T(beat), d: dur * spb, m: midi, inst: inst, v: v });
    }
    function drum(beat, kind, v) {
      ev.push({ t: T(beat), drum: kind, v: v });
    }

    /* 화음 구성음 중 목표 음높이에 가장 가까운 것 */
    function nearestChordTone(chord, target) {
      var best = target, bd = 1e9;
      for (var o = -2; o <= 2; o++) {
        for (var i = 0; i < TRIAD[chord[1]].length; i++) {
          var m = chord[0] + TRIAD[chord[1]][i] + o * 12;
          var d = Math.abs(m - target);
          if (d < bd) { bd = d; best = m; }
        }
      }
      return best;
    }
    /* 음계 안에서 한 칸 움직이기 */
    function stepInScale(m, dir) {
      var root = def.prog[0][0] % 12;
      for (var k = 1; k <= 3; k++) {
        var c = m + dir * k;
        if (MINOR.indexOf(((c - root) % 12 + 12) % 12) >= 0) return c;
      }
      return m + dir * 2;
    }

    var plan = def.plan.map(function (s) {
      var p = s.split(':'); return { kind: p[0], bars: +p[1] };
    });

    for (var si = 0; si < plan.length; si++) {
      var sec = plan[si];
      for (var m = 0; m < sec.bars; m++, bar++) {
        var b0 = bar * 4;
        var chord = def.prog[bar % def.prog.length];
        var kind = sec.kind;
        var last = (m === sec.bars - 1);
        var heavy = (kind === 'chorus' || kind === 'pre' || kind === 'break');

        /* ---- 드럼 ---- */
        if (kind !== 'bridge' || m >= 4) {
          drum(b0, 'kick', 1);
          if (heavy) drum(b0 + 1.5, 'kick', 0.85);
          if (kind !== 'intro') { drum(b0 + 1, 'snare', 0.9); drum(b0 + 3, 'snare', 0.9); }
          drum(b0 + 2, 'kick', kind === 'intro' ? 0.7 : 0.95);
          var hatStep = heavy ? 0.5 : (kind === 'intro' || kind === 'outro' ? 1 : 0.5);
          for (var h = 0; h < 4; h += hatStep) {
            drum(b0 + h, h === 3.5 && heavy ? 'open' : 'hat', 0.8);
          }
          if (heavy && (m % 4 === 3)) {
            drum(b0 + 3.25, 'snare', 0.7); drum(b0 + 3.5, 'snare', 0.8);
            drum(b0 + 3.75, 'snare', 0.95);
          }
        }

        /* ---- 베이스 ---- */
        var broot = chord[0] - 24;
        var bstep = heavy ? 0.5 : 1;
        for (var bb = 0; bb < 4; bb += bstep) {
          var bm = broot + (bb === 3.5 ? 7 : 0);
          note(b0 + bb, bstep * 0.9, bm, 'bass', kind === 'intro' ? 0.6 : 1);
        }

        /* ---- 패드(화음) ---- */
        if (kind !== 'bridge' || m >= 4) {
          var tri = TRIAD[chord[1]];
          for (var c = 0; c < tri.length; c++) {
            note(b0, heavy ? 1.9 : 3.8, chord[0] + tri[c], 'pad', heavy ? 0.9 : 0.7);
            if (heavy) note(b0 + 2, 1.9, chord[0] + tri[c], 'pad', 0.9);
          }
        }

        /* ---- 리드 멜로디 ---- */
        var pats = RHY[kind] || RHY.verse;
        var pat = pats[Math.floor(rnd() * pats.length) % pats.length];
        var lift = (kind === 'chorus') ? 5 : (kind === 'pre' ? 2 : 0);

        for (var s = 0; s < 16; s++) {
          if (!pat[s]) continue;
          var beat = b0 + s * 0.25;
          /* 강박은 화음 구성음, 약박은 음계 내 진행 */
          if (s % 4 === 0) {
            pitch = nearestChordTone(chord, def.lead + lift + (rnd() * 4 - 2));
          } else {
            pitch = stepInScale(pitch, rnd() < 0.5 ? -1 : 1);
          }
          /* 음역 유지 */
          var lo = def.lead - def.range, hi = def.lead + def.range;
          if (pitch < lo) pitch += 12;
          if (pitch > hi) pitch -= 12;

          /* 다음 음까지의 길이 */
          var nx = 1;
          while (s + nx < 16 && !pat[s + nx]) nx++;
          var dur = nx * 0.25;

          var vel = (s === 0 ? 1 : (s % 4 === 0 ? 0.9 : 0.72));
          note(beat, dur * 0.92, pitch, 'lead', vel);
          if (kind === 'chorus') note(beat, dur * 0.92, pitch - 12, 'lead2', vel * 0.8);

          anchors.push({
            beat: beat, pitch: pitch, vel: vel, dur: dur,
            sec: kind, strong: (s % 4 === 0), last: last && s >= 12
          });
        }

        /* 섹션 마지막 마디 필 */
        if (last && (kind === 'pre' || kind === 'break')) {
          for (var f = 0; f < 4; f++) {
            drum(b0 + 3 + f * 0.25, 'snare', 0.6 + f * 0.12);
          }
        }
      }
    }

    return { events: ev, anchors: anchors, bars: bar, lengthSec: bar * 4 * spb + 2 };
  }

  /* ---------------------------------------------------------
     렌더 (AudioBuffer)
     --------------------------------------------------------- */
  var _cache = {};
  function render(def, actx) {
    if (_cache[def.id]) return _cache[def.id];
    var c = compose(def);
    var buf = Synth.render(c.events, c.lengthSec, actx);
    _cache[def.id] = { buffer: buf, comp: c };
    return _cache[def.id];
  }

  /* ---------------------------------------------------------
     채보 — 멜로디 앵커에서 직접 생성하므로 싱크가 정확하다
     --------------------------------------------------------- */
  function chart(def, diff) {
    var c = _cache[def.id] ? _cache[def.id].comp : compose(def);
    var A = c.anchors;
    var notes = [], i;

    /* 음높이 -> 레인 (높을수록 오른쪽) */
    var lo = 1e9, hi = -1e9;
    for (i = 0; i < A.length; i++) { if (A[i].pitch < lo) lo = A[i].pitch; if (A[i].pitch > hi) hi = A[i].pitch; }
    var span = Math.max(1, hi - lo);
    var lastLane = -1;

    for (i = 0; i < A.length; i++) {
      var a = A[i];
      var lane = U.clamp(Math.round((a.pitch - lo) / span * 5), 0, 5);
      if (lane === lastLane && !a.strong) lane = (lane + (i % 2 ? 1 : 5)) % 6;
      lastLane = lane;

      /* 긴 음표 = 홀드 / 슬라이드 */
      if (a.dur >= 1 && a.sec !== 'chorus') {
        var len = a.dur * 0.85;
        if (a.dur >= 1.5) {
          var mid = (lane + (lane < 3 ? 2 : -2) + 6) % 6;
          notes.push({ type: 'chain', beat: a.beat, lane: lane, slide: true,
            nodes: [{ beat: a.beat, lane: lane },
                    { beat: a.beat + len * 0.5, lane: mid },
                    { beat: a.beat + len, lane: (mid + (lane < 3 ? 1 : -1) + 6) % 6 }],
            endType: 'release' });
        } else {
          notes.push({ type: 'chain', beat: a.beat, lane: lane, slide: false,
            nodes: [{ beat: a.beat, lane: lane }, { beat: a.beat + len, lane: lane }],
            endType: 'release' });
        }
        continue;
      }

      /* 프레이즈 끝 강세 = 플릭 */
      if (a.last && a.strong) { notes.push({ type: 'flick', beat: a.beat, lane: lane, dir: 'up' }); continue; }

      notes.push({ type: 'tap', beat: a.beat, lane: lane });

      /* 사비 강박은 양손 동시치기로 밀도를 올린다 */
      if (a.sec === 'chorus' && a.strong && a.vel >= 0.9) {
        var partner = lane < 3 ? 5 - (lane % 3) : 2 - (lane % 3);
        if (partner !== lane) notes.push({ type: 'tap', beat: a.beat, lane: partner });
      }
      /* 킥에 맞춘 16분 채움 (최고 난이도 감각용) */
      if (a.sec === 'chorus' && a.strong && i + 1 < A.length && A[i + 1].beat - a.beat >= 0.5) {
        notes.push({ type: 'tap', beat: a.beat + 0.25, lane: (lane + 3) % 6 });
      }
    }

    var clean = Charts.sanitize(Charts.thin(notes, diff));
    return {
      notes: Charts.toSeconds(clean, def.bpm, 0),
      bpm: def.bpm,
      diff: diff,
      level: (Charts.DIFFS[diff] || Charts.DIFFS.APPEND).lv,
      source: '내장곡 (정확 동기)'
    };
  }

  function byId(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  return { LIST: LIST, byId: byId, compose: compose, render: render, chart: chart };
})();
