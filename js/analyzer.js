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
  function fluxState(mono) {
    var frames = Math.max(1, Math.floor((mono.data.length - N) / HOP));
    var binHz = mono.sr / N;
    return {
      data: mono.data, sr: mono.sr, frames: frames, f: 0,
      win: U.hann(N), half: N >> 1,
      prev: new Float32Array(N >> 1),
      flux: new Float32Array(frames),
      low: new Float32Array(frames),
      mid: new Float32Array(frames),
      high: new Float32Array(frames),
      iLow: Math.max(1, Math.round(30 / binHz)),
      iMid: Math.round(250 / binHz),
      iHigh: Math.round(2200 / binHz),
      re: new Float32Array(N), im: new Float32Array(N)
    };
  }

  /* [s.f, to) 구간의 프레임을 채운다 */
  function fluxRange(s, to) {
    var re = s.re, im = s.im, data = s.data, win = s.win;
    for (; s.f < to; s.f++) {
      var off = s.f * HOP, k;
      for (k = 0; k < N; k++) { re[k] = data[off + k] * win[k]; im[k] = 0; }
      U.fft(re, im);

      var tot = 0, lo = 0, mi = 0, hi = 0;
      for (k = s.iLow; k < s.half; k++) {
        var mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        var d = mag - s.prev[k];
        if (d > 0) {
          tot += d;
          if (k < s.iMid) lo += d;
          else if (k < s.iHigh) mi += d;
          else hi += d;
        }
        s.prev[k] = mag;
      }
      s.flux[s.f] = tot; s.low[s.f] = lo; s.mid[s.f] = mi; s.high[s.f] = hi;
    }
  }

  /* 청크가 너무 잘면 백그라운드 탭에서 setTimeout 이 초 단위로
     throttle 되어 분석이 수십 초로 늘어난다. */
  var CHUNK = 1200;

  function computeFlux(mono, onProgress, done) {
    var s = fluxState(mono);
    (function chunk() {
      fluxRange(s, Math.min(s.frames, s.f + CHUNK));
      if (onProgress) onProgress(s.f / s.frames);
      if (s.f < s.frames) setTimeout(chunk, 0);
      else done(s);
    })();
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
  var MIN_BPM = 100, MAX_BPM = 210;

  function estimateTempo(env, sr, hintBpm) {
    var frameSec = HOP / sr;
    /* 모든 후보 BPM이 "같은 구간"을 보게 고정한다.
       구간 길이를 lag 에 맡기면 느린 BPM일수록 표본이 줄어
       점수가 부풀려져 느린 템포로 편향된다. */
    var maxLag = (60 / MIN_BPM) / frameSec;
    var limit = Math.max(1, env.length - Math.ceil(maxLag * 2) - 2);
    var best = { bpm: hintBpm || 150, score: -1 };

    for (var bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
      var lag = (60 / bpm) / frameSec;
      var s = 0;
      for (var i = 0; i < limit; i += 2) {
        var a = env[i];
        if (a <= 0) continue;
        s += a * (env[Math.round(i + lag)] || 0)
           + a * 0.6 * (env[Math.round(i + lag * 2)] || 0);
      }
      /* 힌트 BPM 근처에 약한 가중 (강한 진짜 피크를 뒤집을 정도는 아니다) */
      if (hintBpm) s *= 1 + 0.30 * Math.exp(-Math.pow((bpm - hintBpm) / 10, 2));
      if (s > best.score) best = { bpm: bpm, score: s };
    }
    return best.bpm;
  }

  /* --------------------------------------------------------
     3-b) 정밀 BPM — 온셋이 16분 격자에 얼마나 위상 고정되는지(원형 평균)
     자기상관은 0.25 BPM 해상도로도 1 BPM 가까이 틀릴 수 있는데,
     3분 40초 곡에서 0.75 BPM 오차면 곡 끝에서 3비트가 밀린다.
     -------------------------------------------------------- */
  function gridFit(peaks, bpm) {
    var sub = 60 / bpm / 4;
    var cr = 0, ci = 0, w = 0;
    for (var i = 0; i < peaks.length; i++) {
      var a = 2 * Math.PI * peaks[i].t / sub;
      var wt = peaks[i].v;                    // 강한 타점일수록 신뢰
      cr += wt * Math.cos(a); ci += wt * Math.sin(a); w += wt;
    }
    if (!w) return { R: 0, phase: 0, bpm: bpm };
    var ph = Math.atan2(ci, cr) / (2 * Math.PI) * sub;
    while (ph < 0) ph += sub;
    return { R: Math.sqrt(cr * cr + ci * ci) / w, phase: ph, bpm: bpm };
  }

  /* 배음(2배·1/2배) 혼동을 피하려고 자기상관 결과 근처만 훑는다 */
  function refineTempo(peaks, coarse) {
    var lo = Math.max(MIN_BPM, coarse - 5), hi = Math.min(MAX_BPM, coarse + 5);
    var best = gridFit(peaks, coarse);
    for (var bpm = lo; bpm <= hi; bpm += 0.05) {
      var f = gridFit(peaks, bpm);
      if (f.R > best.R) best = f;
    }
    return best;
  }

  /* 16분 격자 위상 -> 그중 실제 박(拍)에 해당하는 것 고르기 */
  function pickBeatPhase(peaks, bpm, phase16) {
    var beat = 60 / bpm, sub = beat / 4;
    var best = { s: -1, ph: phase16 };
    for (var k = 0; k < 4; k++) {
      var ph = phase16 + k * sub, s = 0;
      for (var i = 0; i < peaks.length; i++) {
        var r = (peaks[i].t - ph) / beat;
        if (Math.abs(r - Math.round(r)) * beat < 0.035) s += peaks[i].v;
      }
      if (s > best.s) best = { s: s, ph: ph };
    }
    return best.ph;
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
  /* 스펙트럼이 준비된 뒤의 공통 마무리 */
  function finish(spec, hintBpm) {
    var env = normalize(spec.flux);
    var peaks = pickPeaks(env, spec);
    var coarse = estimateTempo(env, spec.sr, hintBpm);      // 자기상관(대략)
    var fit = refineTempo(peaks, coarse);                    // 격자 정렬(정밀)
    var phase = pickBeatPhase(peaks, fit.bpm, fit.phase);
    return {
      bpm: Math.round(fit.bpm * 100) / 100,
      phase: phase,
      coarseBpm: coarse,
      fitR: fit.R,
      peaks: peaks
    };
  }

  function analyze(audioBuffer, hintBpm, onProgress, done) {
    computeFlux(toMono(audioBuffer), function (p) { onProgress(p * 0.85); },
      function (spec) {
        onProgress(0.9);
        setTimeout(function () {
          var res = finish(spec, hintBpm);
          onProgress(1);
          done(res);
        }, 0);
      });
  }

  /* 타이머 없이 한 번에 처리 (테스트·오프라인용) */
  function analyzeSync(audioBuffer, hintBpm) {
    var s = fluxState(toMono(audioBuffer));
    fluxRange(s, s.frames);
    return finish(s, hintBpm);
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

  return { analyze: analyze, analyzeSync: analyzeSync, makeChart: makeChart };
})();
