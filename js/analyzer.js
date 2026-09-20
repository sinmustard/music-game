/* =========================================================
   analyzer.js - 오디오 자동 채보
   ---------------------------------------------------------
   불러온 음원을 STFT -> 스펙트럴 플럭스로 온셋을 잡고,
   자기상관으로 BPM/박자 위상을 추정한 뒤 16분 격자에
   스냅해서 "실제 곡에 맞는" 채보를 만든다.
   무거운 계산이라 청크 단위로 쪼개 진행률을 보고한다.
   ========================================================= */
var Analyzer = (function () {
  'use strict';

  var TARGET_SR = 22050;
  var N = 1024;            // FFT 크기
  var HOP = 256;           // 프레임 간격 (≈11.6ms @22050)

  /* 프레임 f 의 대표 시각 = 분석 윈도우의 중심.
     시작점을 쓰면 온셋이 윈도우 절반(≈23ms)만큼 빨라진다. */
  function frameTime(f, sr) { return (f * HOP + N / 2) / sr; }
  function timeFrame(t, sr) { return Math.round((t * sr - N / 2) / HOP); }

  /* 모노 다운믹스 + 2배 데시메이션 */
  function toMono(buf) {
    var ch = buf.numberOfChannels;
    var a = buf.getChannelData(0);
    var b = ch > 1 ? buf.getChannelData(1) : null;
    var step = Math.max(1, Math.round(buf.sampleRate / TARGET_SR));
    var len = Math.floor(a.length / step);
    var out = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      var j = i * step;
      out[i] = b ? (a[j] + b[j]) * 0.5 : a[j];
    }
    return { data: out, sr: buf.sampleRate / step };
  }

  /* --------------------------------------------------------
     1) STFT + 밴드별 스펙트럴 플럭스 (청크 처리)
     -------------------------------------------------------- */
  function computeFlux(mono, onProgress, done) {
    var data = mono.data, sr = mono.sr;
    var frames = Math.max(1, Math.floor((data.length - N) / HOP));
    var win = U.hann(N);
    var half = N >> 1;

    var prev = new Float32Array(half);
    var flux = new Float32Array(frames);
    var bLow = new Float32Array(frames);
    var bMid = new Float32Array(frames);
    var bHigh = new Float32Array(frames);

    var binHz = sr / N;
    var iLow = Math.max(1, Math.round(30 / binHz));
    var iMid = Math.round(250 / binHz);
    var iHigh = Math.round(2200 / binHz);

    var re = new Float32Array(N), im = new Float32Array(N);
    var f = 0;

    function chunk() {
      var end = Math.min(frames, f + 300);
      for (; f < end; f++) {
        var off = f * HOP, k;
        for (k = 0; k < N; k++) { re[k] = data[off + k] * win[k]; im[k] = 0; }
        U.fft(re, im);

        var tot = 0, lo = 0, mi = 0, hi = 0;
        for (k = iLow; k < half; k++) {
          var mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
          var d = mag - prev[k];
          if (d > 0) {
            tot += d;
            if (k < iMid) lo += d;
            else if (k < iHigh) mi += d;
            else hi += d;
          }
          prev[k] = mag;
        }
        flux[f] = tot; bLow[f] = lo; bMid[f] = mi; bHigh[f] = hi;
      }
      if (onProgress) onProgress(f / frames);
      if (f < frames) setTimeout(chunk, 0);
      else done({ flux: flux, low: bLow, mid: bMid, high: bHigh, frames: frames, sr: sr });
    }
    chunk();
  }

  /* 이동평균 대비 정규화 */
  function normalize(flux) {
    var n = flux.length;
    var out = new Float32Array(n);
    var W = 40;                       // ±0.46초
    var sum = 0, i;
    for (i = 0; i < Math.min(n, W); i++) sum += flux[i];
    var cnt = Math.min(n, W);
    for (i = 0; i < n; i++) {
      var add = i + W, sub = i - W - 1;
      if (add < n) { sum += flux[add]; cnt++; }
      if (sub >= 0) { sum -= flux[sub]; cnt--; }
      var mean = sum / Math.max(1, cnt);
      out[i] = Math.max(0, flux[i] - mean * 1.12);
    }
    return out;
  }

  /* --------------------------------------------------------
     2) 피크 픽킹
     -------------------------------------------------------- */
  function pickPeaks(env, spec) {
    var frameSec = HOP / spec.sr;
    var minGap = Math.max(2, Math.round(0.055 / frameSec));
    var peaks = [], i;

    var mx = 0;
    for (i = 0; i < env.length; i++) if (env[i] > mx) mx = env[i];
    var thr = mx * 0.035;

    for (i = 2; i < env.length - 2; i++) {
      var v = env[i];
      if (v < thr) continue;
      if (v < env[i - 1] || v < env[i + 1] || v < env[i - 2] || v < env[i + 2]) continue;
      if (peaks.length && i - peaks[peaks.length - 1].f < minGap) {
        if (v > peaks[peaks.length - 1].v) peaks[peaks.length - 1] = mk(i, v);
        continue;
      }
      peaks.push(mk(i, v));
    }

    function mk(f, v) {
      var lo = spec.low[f], mi = spec.mid[f], hi = spec.high[f];
      var s = lo + mi + hi || 1;
      return {
        f: f, v: v, t: frameTime(f, spec.sr),
        lo: lo / s, mid: mi / s, hi: hi / s,
        /* 0(저역) ~ 1(고역) */
        bright: (mi * 0.5 + hi) / s
      };
    }
    return peaks;
  }

  /* --------------------------------------------------------
     3) BPM / 위상 추정
     -------------------------------------------------------- */
  function estimateTempo(env, sr, hintBpm) {
    var frameSec = HOP / sr;
    var best = { bpm: hintBpm || 150, score: -1 };

    for (var bpm = 100; bpm <= 210; bpm += 0.25) {
      var lag = (60 / bpm) / frameSec;
      var s = 0, cnt = 0;
      for (var i = 0; i + lag * 4 < env.length; i += 3) {
        var a = env[i];
        if (a <= 0) continue;
        s += a * (env[Math.round(i + lag)] || 0) + a * 0.6 * (env[Math.round(i + lag * 2)] || 0);
        cnt++;
      }
      if (!cnt) continue;
      s /= cnt;
      /* 힌트 BPM 근처에 약한 가중 */
      if (hintBpm) s *= 1 + 0.25 * Math.exp(-Math.pow((bpm - hintBpm) / 12, 2));
      if (s > best.score) best = { bpm: bpm, score: s };
    }
    return best.bpm;
  }

  function estimatePhase(env, sr, bpm) {
    var beat = 60 / bpm;
    var endSec = frameTime(env.length, sr);
    var best = { off: 0, score: -1 };
    for (var off = 0; off < beat; off += 0.004) {
      var s = 0;
      for (var t = off; t < endSec; t += beat) {
        var f = timeFrame(t, sr);
        if (f >= 0 && f < env.length) s += env[f];
      }
      if (s > best.score) best = { off: off, score: s };
    }
    return best.off;
  }

  /* --------------------------------------------------------
     4) 온셋 -> 노트
     -------------------------------------------------------- */
  function buildNotes(peaks, bpm, phase, opts) {
    var beat = 60 / bpm;
    var notes = [];
    var snapped = [];
    var i;

    /* 16분 격자 스냅 */
    var tol = beat / 4 * 0.42;
    for (i = 0; i < peaks.length; i++) {
      var p = peaks[i];
      var rel = (p.t - phase) / (beat / 4);
      var g = Math.round(rel);
      if (g < 0) continue;
      var gt = phase + g * beat / 4;
      if (Math.abs(gt - p.t) > tol) continue;
      if (snapped.length && g === snapped[snapped.length - 1].g) {
        if (p.v > snapped[snapped.length - 1].v) snapped[snapped.length - 1] = { g: g, b: g / 4, v: p.v, p: p };
        continue;
      }
      snapped.push({ g: g, b: g / 4, v: p.v, p: p });
    }
    if (!snapped.length) return notes;

    /* 세기 정규화 */
    var vs = snapped.map(function (s) { return s.v; }).slice().sort(function (a, b) { return a - b; });
    var vHi = vs[Math.floor(vs.length * 0.88)] || 1;
    var vMid = vs[Math.floor(vs.length * 0.55)] || 1;

    /* 레인 배치: 음색 밝기 + 손 교대 */
    var lane = 2, lastLane = -1, handRight = false;
    for (i = 0; i < snapped.length; i++) {
      var s = snapped[i];
      var pk = s.p;
      var gap = (i + 1 < snapped.length) ? (snapped[i + 1].b - s.b) : 4;
      var prevGap = i > 0 ? (s.b - snapped[i - 1].b) : 4;

      /* 밝기로 대략적인 위치(0~5)를 잡고 */
      var zone = U.clamp(Math.round(pk.bright * 5.6 - 0.3), 0, 5);

      if (prevGap <= 0.3) {
        /* 연타 구간: 손 교대로 흐르게 */
        handRight = !handRight;
        lane = handRight ? 3 + ((i + zone) % 3) : ((i + zone) % 3);
      } else {
        lane = zone;
        if (lane === lastLane) lane = (lane + (i % 2 ? 1 : 5)) % 6;
      }
      if (lane === lastLane) lane = (lane + 1) % 6;
      lastLane = lane;

      var strong = s.v >= vHi;

      /* 긴 공백 앞 = 홀드/슬라이드 */
      if (gap >= 1.25 && opts.chains) {
        var len = Math.min(gap - 0.5, 4);
        if (opts.slides && (i % 3 === 0) && len >= 1) {
          var mid = (lane + (lane < 3 ? 2 : -2) + 6) % 6;
          var end = (mid + (lane < 3 ? 1 : -1) + 6) % 6;
          notes.push({
            type: 'chain', beat: s.b, lane: lane, slide: true,
            nodes: [{ beat: s.b, lane: lane },
                    { beat: s.b + len * 0.5, lane: mid },
                    { beat: s.b + len, lane: end }],
            endType: (opts.flicks && strong) ? 'flick' : 'release'
          });
        } else {
          notes.push({
            type: 'chain', beat: s.b, lane: lane, slide: false,
            nodes: [{ beat: s.b, lane: lane }, { beat: s.b + len, lane: lane }],
            endType: (opts.flicks && strong) ? 'flick' : 'release'
          });
        }
        continue;
      }

      /* 밝고 강한 단발 = 플릭 */
      if (opts.flicks && strong && pk.hi > 0.40 && gap >= 0.5) {
        notes.push({ type: 'flick', beat: s.b, lane: lane, dir: 'up' });
        continue;
      }

      notes.push({ type: 'tap', beat: s.b, lane: lane });

      /* 아주 강한 타점 = 동시치기(코드)로 난이도 상승 */
      if (opts.chords && s.v >= vHi && prevGap >= 0.45) {
        var partner = lane < 3 ? (5 - (lane % 3)) : (2 - (lane % 3));
        if (partner !== lane) notes.push({ type: 'tap', beat: s.b, lane: partner });
      }
      /* 중간 세기 + 여유 = 16분 채움 한 개 */
      if (opts.fill && s.v >= vMid && gap >= 0.5 && gap < 1.5) {
        notes.push({ type: 'tap', beat: s.b + 0.25, lane: (lane + 3) % 6 });
      }
    }
    return notes;
  }

  var DENSITY = {
    NORMAL: { chains: true, slides: false, flicks: false, chords: false, fill: false },
    HARD:   { chains: true, slides: true,  flicks: false, chords: false, fill: false },
    EXPERT: { chains: true, slides: true,  flicks: true,  chords: false, fill: false },
    MASTER: { chains: true, slides: true,  flicks: true,  chords: true,  fill: false },
    APPEND: { chains: true, slides: true,  flicks: true,  chords: true,  fill: true  }
  };

  /* --------------------------------------------------------
     public
     -------------------------------------------------------- */
  function analyze(audioBuffer, hintBpm, onProgress, done) {
    var mono = toMono(audioBuffer);
    computeFlux(mono, function (p) { onProgress(p * 0.8); }, function (spec) {
      var env = normalize(spec.flux);
      onProgress(0.85);
      setTimeout(function () {
        var bpm = estimateTempo(env, spec.sr, hintBpm);
        onProgress(0.93);
        setTimeout(function () {
          var phase = estimatePhase(env, spec.sr, bpm);
          var peaks = pickPeaks(env, spec);
          onProgress(1);
          done({ bpm: Math.round(bpm * 100) / 100, phase: phase, peaks: peaks });
        }, 0);
      }, 0);
    });
  }

  function makeChart(analysis, diff) {
    var opts = DENSITY[diff] || DENSITY.APPEND;
    var raw = buildNotes(analysis.peaks, analysis.bpm, analysis.phase, opts);
    var thinned = Charts.thin(raw, diff);
    var clean = Charts.sanitize(thinned);
    /* 이미 초 단위 위상(phase)이 반영되도록 offset=phase 로 변환 */
    return {
      notes: Charts.toSeconds(clean, analysis.bpm, analysis.phase),
      bpm: analysis.bpm,
      diff: diff,
      level: (Charts.DIFFS[diff] || Charts.DIFFS.APPEND).lv,
      source: '오디오 자동 분석'
    };
  }

  return { analyze: analyze, makeChart: makeChart };
})();
