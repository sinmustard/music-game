/* =========================================================
   synth.js - 내장 곡 렌더러
   ---------------------------------------------------------
   음표 이벤트 목록을 Float32Array 에 직접 합성해서
   AudioBuffer 로 만든다. 외부 음원 없이 곡이 나오므로
   저작권 문제가 없고, 음표 시각을 이미 알고 있으니
   채보가 음악과 정확히 일치한다.
   ========================================================= */
var Synth = (function () {
  'use strict';

  var TAU = 6.283185307179586;

  var WAVE = {
    sine:   function (p) { return Math.sin(TAU * p); },
    square: function (p) { return p < 0.5 ? 1 : -1; },
    pulse:  function (p) { return p < 0.3 ? 1 : -1; },
    saw:    function (p) { return 2 * p - 1; },
    tri:    function (p) { return 4 * Math.abs(p - 0.5) - 1; }
  };

  /* 악기 프리셋: 파형 / 게인 / ADSR / 디튠 / 저역통과 계수 */
  var INST = {
    lead:  { wave: 'pulse',  gain: 0.20, a: 0.006, d: 0.09, s: 0.55, r: 0.10, det: 0.006, lp: 0 },
    lead2: { wave: 'square', gain: 0.11, a: 0.004, d: 0.12, s: 0.40, r: 0.09, det: -0.008, lp: 0 },
    bass:  { wave: 'saw',    gain: 0.30, a: 0.004, d: 0.10, s: 0.70, r: 0.06, det: 0,      lp: 0.22 },
    pad:   { wave: 'tri',    gain: 0.10, a: 0.015, d: 0.20, s: 0.45, r: 0.18, det: 0.004,  lp: 0.55 }
  };

  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function env(t, dur, p) {
    if (t < p.a) return t / p.a;
    var t2 = t - p.a;
    if (t2 < p.d) return 1 - (1 - p.s) * (t2 / p.d);
    if (t < dur) return p.s;
    var k = (t - dur) / p.r;
    return k >= 1 ? 0 : p.s * (1 - k);
  }

  /* 단음 렌더 (릴리즈 꼬리 포함) */
  function tone(out, sr, t0, dur, hz, p, vel) {
    var total = dur + p.r;
    var s0 = Math.round(t0 * sr);
    var n = Math.round(total * sr);
    if (s0 < 0) { n += s0; s0 = 0; }
    if (n <= 0 || s0 >= out.length) return;
    if (s0 + n > out.length) n = out.length - s0;

    var w = WAVE[p.wave];
    var inc = hz / sr, inc2 = (hz * (1 + p.det)) / sr;
    var ph = 0, ph2 = 0, lpz = 0;
    var g = p.gain * (vel == null ? 1 : vel);

    for (var i = 0; i < n; i++) {
      var t = i / sr;
      var e = env(t, dur, p);
      /* 어택은 0에서 시작하므로 여기서 끊으면 안 된다.
         릴리즈가 끝나 0으로 떨어졌을 때만 중단한다. */
      if (t >= dur && e <= 0) break;
      var v = w(ph);
      if (p.det) v = (v + w(ph2)) * 0.5;
      if (p.lp) { lpz += (v - lpz) * p.lp; v = lpz; }
      out[s0 + i] += v * e * g;
      ph += inc; if (ph >= 1) ph -= 1;
      ph2 += inc2; if (ph2 >= 1) ph2 -= 1;
    }
  }

  /* --------------------------------------------------------
     드럼 (간단한 감산 합성)
     -------------------------------------------------------- */
  function kick(out, sr, t0, vel) {
    var n = Math.round(0.20 * sr), s0 = Math.round(t0 * sr);
    if (s0 < 0 || s0 >= out.length) return;
    var ph = 0;
    for (var i = 0; i < n && s0 + i < out.length; i++) {
      var k = i / n;
      var hz = 120 * Math.pow(0.36, k * 3) + 42;
      var e = Math.pow(1 - k, 2.2);
      out[s0 + i] += Math.sin(TAU * ph) * e * 0.85 * (vel || 1);
      ph += hz / sr; if (ph >= 1) ph -= 1;
    }
  }

  function snare(out, sr, t0, vel, seed) {
    var n = Math.round(0.15 * sr), s0 = Math.round(t0 * sr);
    if (s0 < 0 || s0 >= out.length) return;
    var rnd = U.mulberry32(seed | 0);
    var ph = 0, hp = 0, prev = 0;
    for (var i = 0; i < n && s0 + i < out.length; i++) {
      var k = i / n;
      var e = Math.pow(1 - k, 3);
      var nz = rnd() * 2 - 1;
      hp = nz - prev; prev = nz;                 // 대충 하이패스
      var tn = Math.sin(TAU * ph); ph += 185 / sr; if (ph >= 1) ph -= 1;
      out[s0 + i] += (hp * 0.55 + tn * 0.30) * e * 0.62 * (vel || 1);
    }
  }

  function hat(out, sr, t0, vel, open, seed) {
    var len = open ? 0.13 : 0.035;
    var n = Math.round(len * sr), s0 = Math.round(t0 * sr);
    if (s0 < 0 || s0 >= out.length) return;
    var rnd = U.mulberry32(seed | 0);
    var prev = 0;
    for (var i = 0; i < n && s0 + i < out.length; i++) {
      var e = Math.pow(1 - i / n, open ? 2 : 3.5);
      var nz = rnd() * 2 - 1;
      var hp = nz - prev; prev = nz;
      out[s0 + i] += hp * e * 0.17 * (vel || 1);
    }
  }

  /* --------------------------------------------------------
     events -> AudioBuffer
     ev: { t, d, m(midi), inst, v }  또는  { t, drum:'kick'|'snare'|'hat'|'open', v }
     -------------------------------------------------------- */
  function render(events, lengthSec, actx) {
    var sr = actx.sampleRate;
    var len = Math.ceil(lengthSec * sr) + sr;      // 꼬리 여유 1초
    var buf = actx.createBuffer(1, len, sr);
    var out = buf.getChannelData(0);

    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.drum) {
        if (e.drum === 'kick') kick(out, sr, e.t, e.v);
        else if (e.drum === 'snare') snare(out, sr, e.t, e.v, 1000 + i);
        else hat(out, sr, e.t, e.v, e.drum === 'open', 2000 + i);
      } else {
        var p = INST[e.inst] || INST.lead;
        tone(out, sr, e.t, e.d, midiHz(e.m), p, e.v);
      }
    }

    /* 소프트 클리핑 + 정규화 */
    var peak = 0, k;
    for (k = 0; k < out.length; k++) { var a = Math.abs(out[k]); if (a > peak) peak = a; }
    var g = peak > 0 ? Math.min(1, 0.92 / peak) : 1;
    for (k = 0; k < out.length; k++) out[k] = Math.tanh(out[k] * g * 1.1) * 0.95;

    return buf;
  }

  return { render: render, midiHz: midiHz, INST: INST };
})();
