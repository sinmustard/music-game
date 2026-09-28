/* =========================================================
   main.js - 화면 전환 / 오디오 / 게임 루프
   ========================================================= */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 상태 ---------------- */
  var actx = null, musicGain = null, seGain = null, noiseBuf = null;
  var buffer = null, src = null, fileBuffer = null;
  var ctxStart = 0, baseSeek = 0;
  var playing = false, paused = false, pauseAt = 0;
  var game = null, chart = null, analysis = null;
  var rafId = 0, lastHit = 0, metroNext = 0;
  var frozenT = 0, completeAt = 0, fileLabel = '';

  var S = {
    diff: 'APPEND',
    songId: 'verdict',         // 'file' 또는 Songs.LIST 의 id
    chartMode: 'builtin',      // builtin | auto
    speed: 5.2,
    offset: 0,                 // ms (+ = 노트가 늦게)
    bpm: 150,
    musicVol: 0.8,
    seVol: 0.6,
    flickSimple: false,
    noFail: false,
    autoPlay: false,
    showBars: true,
    showKeys: true
  };

  try {
    var saved = JSON.parse(localStorage.getItem('lovetrial.settings') || '{}');
    for (var k in saved) if (k in S) S[k] = saved[k];
  } catch (e) {}
  function save() {
    try { localStorage.setItem('lovetrial.settings', JSON.stringify(S)); } catch (e) {}
  }

  /* ---------------- 오디오 ---------------- */
  function ensureAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return actx; }
    actx = new (window.AudioContext || window.webkitAudioContext)();
    musicGain = actx.createGain(); musicGain.gain.value = S.musicVol;
    seGain = actx.createGain(); seGain.gain.value = S.seVol;
    musicGain.connect(actx.destination); seGain.connect(actx.destination);

    var n = actx.sampleRate * 0.12;
    noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    return actx;
  }

  function playHit() {
    if (!actx || S.seVol <= 0) return;
    var s = actx.createBufferSource(); s.buffer = noiseBuf;
    var f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.1;
    var g = actx.createGain(); g.gain.value = 0.55;
    s.connect(f); f.connect(g); g.connect(seGain);
    s.start();
  }

  function playClick(when, accent) {
    if (!actx) return;
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1050;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(accent ? 0.30 : 0.16, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
    o.connect(g); g.connect(seGain);
    o.start(when); o.stop(when + 0.09);
  }

  function elapsed() { return actx.currentTime - ctxStart + baseSeek; }
  function ctxTimeOf(e) { return ctxStart + e - baseSeek; }

  /* ---------------- 화면 ---------------- */
  function hideAll() {
    ['titleScreen', 'pauseScreen', 'resultScreen'].forEach(function (s) {
      $(s).classList.add('hidden');
    });
  }

  /* ---------------- 채보 준비 ---------------- */
  function curSong() { return S.songId === 'file' ? null : Songs.byId(S.songId); }

  function buildChart() {
    var song = curSong();
    if (song) {
      /* 내장곡은 멜로디 음표 시각을 알고 있으므로 분석이 필요 없다 */
      chart = Songs.chart(song, S.diff);
    } else if (S.chartMode === 'auto' && analysis) {
      chart = Analyzer.makeChart(analysis, S.diff);
    } else {
      chart = Charts.build(S.diff, S.bpm, 60 / S.bpm * 8);   // 2마디 리드인
    }
    return chart;
  }

  /* 곡 선택 — 내장곡이면 합성해서 buffer 로 쓴다 */
  function selectSong(id) {
    S.songId = id;
    save();
    var song = curSong();
    Array.prototype.forEach.call(document.querySelectorAll('.song-btn'), function (b) {
      b.classList.toggle('on', b.dataset.song === id);
    });
    $('fileSection').classList.toggle('hidden', !!song);

    if (!song) { buffer = fileBuffer; updateChartInfo(); return; }

    ensureAudio();
    $('loading').classList.remove('hidden');
    $('loadText').textContent = '「' + song.title + '」 합성 중…';
    $('loadBar').style.width = '35%';
    setTimeout(function () {
      buffer = Songs.render(song, actx).buffer;   // 두 번째부터는 캐시
      $('loadBar').style.width = '100%';
      $('loading').classList.add('hidden');
      updateChartInfo();
    }, 30);
  }

  function updateChartInfo() {
    var c = buildChart();
    var chains = 0, taps = 0, flicks = 0;
    c.notes.forEach(function (n) {
      if (n.type === 'chain') chains++;
      else if (n.type === 'flick') flicks++;
      else taps++;
    });
    var g = new Engine(c, { flickSimple: S.flickSimple });
    $('infoLevel').textContent = 'Lv.' + c.level;
    $('infoNotes').textContent = U.comma(g.total);
    $('infoBpm').textContent = c.bpm.toFixed(c.bpm % 1 ? 2 : 0);
    $('infoSource').textContent = c.source;
    $('infoBreak').textContent = '탭 ' + taps + ' · 플릭 ' + flicks + ' · 홀드/슬라이드 ' + chains;
  }

  /* ---------------- 시작 ---------------- */
  function start(seek) {
    ensureAudio();
    hideAll();
    $('hud').classList.remove('hidden');

    if (seek == null) {
      chart = buildChart();
      game = new Engine(chart, {
        flickSimple: S.flickSimple, noFail: S.noFail, autoPlay: S.autoPlay
      });
      seek = 0;
      lastHit = 0;
      completeAt = 0;
      var song = curSong();
      $('hudSong').textContent = song ? song.title
        : ('연애재판' + (fileLabel ? '' : '  (메트로놈 모드)'));
      $('hudSub').textContent =
        S.diff + ' Lv.' + chart.level + ' · ' + U.comma(game.total) + ' NOTES · ' + chart.source;
    }
    baseSeek = Math.max(0, seek);
    var pre = baseSeek > 0 ? 1.4 : 2.2;
    ctxStart = actx.currentTime + pre;

    if (src) { try { src.stop(); } catch (e) {} src = null; }
    if (buffer) {
      src = actx.createBufferSource();
      src.buffer = buffer;
      src.connect(musicGain);
      src.start(ctxStart, baseSeek);
    }
    metroNext = Math.floor(baseSeek / (60 / chart.bpm)) * (60 / chart.bpm);

    playing = true; paused = false;
    Input.setEnabled(true);
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function stopPlayback() {
    if (src) { try { src.stop(); } catch (e) {} src = null; }
    playing = false;
    Input.setEnabled(false);
  }

  function pause() {
    if (!playing || paused) return;
    pauseAt = elapsed();
    frozenT = pauseAt - S.offset / 1000;
    stopPlayback();
    paused = true;
    $('pauseScreen').classList.remove('hidden');
    $('pOffset').value = S.offset;
    $('pOffsetVal').textContent = S.offset + ' ms';
    $('pSpeed').value = S.speed;
    $('pSpeedVal').textContent = S.speed.toFixed(1);
  }

  function resume() {
    $('pauseScreen').classList.add('hidden');
    start(Math.max(0, pauseAt - 1.6));
  }

  function quit() {
    stopPlayback();
    paused = false;
    game = null;
    cancelAnimationFrame(rafId); rafId = 0;
    hideAll();
    $('titleScreen').classList.remove('hidden');
    $('hud').classList.add('hidden');
    Renderer.draw(null, 0, viewSettings());
  }

  function finish() {
    frozenT = elapsed() - S.offset / 1000;
    stopPlayback();
    $('countdown').classList.add('hidden');
    var r = game.result();
    $('rScore').textContent = U.comma(r.score);
    $('rRank').textContent = r.rank;
    $('rRank').className = 'rank rank-' + r.rank.replace('+', 'p');
    $('rBadge').textContent = r.badge || '';
    $('rBadge').classList.toggle('hidden', !r.badge);
    $('rPerfect').textContent = r.counts.PERFECT;
    $('rGreat').textContent = r.counts.GREAT;
    $('rGood').textContent = r.counts.GOOD;
    $('rBad').textContent = r.counts.BAD;
    $('rMiss').textContent = r.counts.MISS;
    $('rCombo').textContent = r.maxCombo + ' / ' + r.total;
    $('rAcc').textContent = r.accuracy.toFixed(2) + '%';
    $('rState').textContent = r.failed ? 'FAILED' : 'CLEAR';
    $('rState').classList.toggle('failed', r.failed);
    $('resultScreen').classList.remove('hidden');
    $('hud').classList.add('hidden');
  }

  /* ---------------- 루프 ---------------- */
  function viewSettings() {
    return {
      travel: 3.0 / S.speed,
      showBars: S.showBars,
      showKeys: S.showKeys,
      keyLabels: Input.labels
    };
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    var vs = viewSettings();

    if (!playing || !game) {
      $('countdown').classList.add('hidden');
      Renderer.draw(game, game ? frozenT : 0, vs);
      return;
    }

    var e = elapsed();
    var songT = e - S.offset / 1000;

    /* 메트로놈 (음원 없을 때) */
    if (!buffer && actx) {
      var spb = 60 / chart.bpm;
      while (metroNext < e + 0.25) {
        var when = ctxTimeOf(metroNext);
        if (when > actx.currentTime) {
          playClick(when, Math.abs((metroNext / spb) % 4) < 1e-6);
        }
        metroNext += spb;
      }
    }

    if (e >= 0) {
      game.update(songT);
      if (game.hitCount > lastHit) {
        var n = Math.min(3, game.hitCount - lastHit);
        for (var i = 0; i < n; i++) playHit();
        lastHit = game.hitCount;
      }
    }

    Renderer.draw(game, songT, vs);

    /* 카운트다운 */
    var cd = $('countdown');
    if (e < 0) {
      cd.classList.remove('hidden');
      cd.textContent = Math.ceil(-e);
    } else cd.classList.add('hidden');

    /* HUD */
    $('score').textContent = U.comma(game.score + (game.total ? 50000 * game.maxCombo / game.total : 0));
    $('lifeFill').style.width = (game.life / 10) + '%';
    $('lifeFill').classList.toggle('low', game.life < 300);
    var dur = buffer ? buffer.duration : game.endTime;
    $('progFill').style.width = U.clamp(e / dur * 100, 0, 100) + '%';
    $('timeNow').textContent = U.mmss(Math.max(0, e));

    if (game.failed) { finish(); return; }
    if (game.total > 0 && game.judged >= game.total) {
      if (!completeAt) completeAt = e;
      else if (e - completeAt > 1.4) { finish(); return; }
    }
    if (e > (buffer ? Math.max(buffer.duration, game.endTime) : game.endTime)) { finish(); return; }
  }

  /* ---------------- 파일 로딩 ---------------- */
  function onBufferReady(name, buf) {
    fileBuffer = buf;
    if (S.songId === 'file') buffer = buf;
    fileLabel = name;
    $('fileName').textContent = name + '  (' + U.mmss(buf.duration) + ')';
    $('dropZone').classList.add('loaded');
    $('analyzeBtn').disabled = false;
    $('analyzeBtn').classList.add('primary');
    $('modeAuto').disabled = false;
    $('audioState').textContent = '음원 로드됨';
    updateChartInfo();
  }

  function loadFile(file) {
    if (!file) return;
    ensureAudio();
    $('fileName').textContent = '읽는 중… ' + file.name;
    var fr = new FileReader();
    fr.onload = function () {
      actx.decodeAudioData(fr.result.slice(0), function (buf) {
        onBufferReady(file.name, buf);
      }, function () {
        $('fileName').textContent = '디코딩 실패 — mp3/ogg/wav/m4a 파일을 사용해 주세요.';
      });
    };
    fr.readAsArrayBuffer(file);
  }

  /* audio/song.mp3 이 있으면 자동으로 불러온다.
     fetch 는 file:// 에서 차단되므로 http 로 열었을 때만 동작한다. */
  function autoLoadSong() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      $('audioState').textContent = '음원 없음 (file:// 에서는 자동 로드 불가)';
      return;
    }
    $('fileName').textContent = 'audio/song.mp3 불러오는 중…';
    fetch('audio/song.mp3').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      ensureAudio();
      return new Promise(function (ok, no) { actx.decodeAudioData(ab, ok, no); });
    }).then(function (buf) {
      onBufferReady('audio/song.mp3', buf);
      /* 내장 채보는 BPM 고정이라 이 파일과 안 맞을 수 있다.
         내 음원을 고른 상태일 때만 바로 분석해서 곡에 맞춘다. */
      if (S.songId === 'file') runAnalysis();
    }).catch(function () {
      $('fileName').textContent = '';
      $('audioState').textContent = '음원 없음';
    });
  }

  function runAnalysis() {
    if (!buffer) return;
    $('loading').classList.remove('hidden');
    $('loadBar').style.width = '0%';
    $('loadText').textContent = '음원 분석 중…';
    setTimeout(function () {
      Analyzer.analyze(buffer, S.bpm, function (p) {
        $('loadBar').style.width = Math.round(p * 100) + '%';
      }, function (res) {
        analysis = res;
        S.chartMode = 'auto';
        $('modeAuto').checked = true;
        $('loading').classList.add('hidden');
        $('analyzeState').textContent =
          '분석 완료 · 검출 BPM ' + res.bpm.toFixed(2) + ' · 온셋 ' + res.peaks.length + '개';
        updateChartInfo();
        save();
      });
    }, 30);
  }

  /* ---------------- UI 바인딩 ---------------- */
  function bind() {
    var cv = $('game');
    Renderer.init(cv);

    function relayout() {
      Renderer.resize();
      Renderer.draw(game, game ? (playing ? elapsed() - S.offset / 1000 : frozenT) : 0, viewSettings());
    }
    window.addEventListener('resize', relayout);
    /* 숨겨진 탭/패널에서 열리면 최초 레이아웃 시점에 크기가 0이다.
       resize 이벤트로는 0→N 전환이 안 잡히므로 캔버스를 직접 관찰한다. */
    if (window.ResizeObserver) new ResizeObserver(relayout).observe(cv);

    Input.attach(cv, {
      down: function (l, t) { if (game) game.laneDown(l, t); },
      up: function (l, t) { if (game) game.laneUp(l, t); },
      flick: function (t, l) { if (game) game.flickInput(t, l); },
      time: function () { return elapsed() - S.offset / 1000; }
    });

    /* 곡 목록 */
    var listEl = $('songList'), html = '';
    Songs.LIST.forEach(function (s) {
      html += '<button class="song-btn" data-song="' + s.id + '">' +
        '<span class="ic">🎼</span><span class="tx"><span class="nm">' + s.title +
        '<span class="free-tag">자유 이용</span></span>' +
        '<span class="ds">' + s.sub + '</span></span>' +
        '<span class="bp">' + s.bpm + '</span></button>';
    });
    html += '<button class="song-btn" data-song="file">' +
      '<span class="ic">📂</span><span class="tx"><span class="nm">내 음원 파일</span>' +
      '<span class="ds">audio/song.mp3 또는 직접 선택 · 자동 분석 채보</span></span>' +
      '<span class="bp">?</span></button>';
    listEl.innerHTML = html;
    Array.prototype.forEach.call(listEl.querySelectorAll('.song-btn'), function (b) {
      b.addEventListener('click', function () { selectSong(b.dataset.song); });
    });

    /* 난이도 */
    Array.prototype.forEach.call(document.querySelectorAll('.diff-btn'), function (b) {
      b.classList.toggle('on', b.dataset.diff === S.diff);
      b.addEventListener('click', function () {
        S.diff = b.dataset.diff;
        Array.prototype.forEach.call(document.querySelectorAll('.diff-btn'), function (x) {
          x.classList.toggle('on', x === b);
        });
        updateChartInfo(); save();
      });
    });

    /* 채보 모드 */
    $('modeBuiltin').addEventListener('change', function () {
      if (this.checked) { S.chartMode = 'builtin'; updateChartInfo(); save(); }
    });
    $('modeAuto').addEventListener('change', function () {
      if (this.checked) {
        if (!analysis) { runAnalysis(); }
        else { S.chartMode = 'auto'; updateChartInfo(); save(); }
      }
    });

    /* 파일 */
    $('fileInput').addEventListener('change', function () { loadFile(this.files[0]); });
    $('dropZone').addEventListener('click', function () { $('fileInput').click(); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('dropZone').addEventListener(ev, function (e) {
        e.preventDefault(); $('dropZone').classList.add('drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('dropZone').addEventListener(ev, function (e) {
        e.preventDefault(); $('dropZone').classList.remove('drag');
      });
    });
    $('dropZone').addEventListener('drop', function (e) {
      if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });
    $('analyzeBtn').addEventListener('click', runAnalysis);

    /* 슬라이더 */
    function slider(id, valId, key, fmt, after) {
      var el = $(id);
      el.value = S[key];
      $(valId).textContent = fmt(S[key]);
      el.addEventListener('input', function () {
        S[key] = parseFloat(this.value);
        $(valId).textContent = fmt(S[key]);
        if (after) after();
        save();
      });
    }
    slider('speed', 'speedVal', 'speed', function (v) { return v.toFixed(1); });
    slider('offset', 'offsetVal', 'offset', function (v) { return v + ' ms'; });
    slider('bpm', 'bpmVal', 'bpm', function (v) { return v + ' BPM'; }, updateChartInfo);
    slider('musicVol', 'musicVolVal', 'musicVol', function (v) { return Math.round(v * 100) + '%'; },
      function () { if (musicGain) musicGain.gain.value = S.musicVol; });
    slider('seVol', 'seVolVal', 'seVol', function (v) { return Math.round(v * 100) + '%'; },
      function () { if (seGain) seGain.gain.value = S.seVol; });

    function toggle(id, key, after) {
      var el = $(id);
      el.checked = S[key];
      el.addEventListener('change', function () {
        S[key] = this.checked; if (after) after(); save();
      });
    }
    /* 일시정지 화면의 미러 슬라이더 */
    $('pOffset').addEventListener('input', function () {
      S.offset = parseFloat(this.value);
      $('pOffsetVal').textContent = S.offset + ' ms';
      $('offset').value = S.offset; $('offsetVal').textContent = S.offset + ' ms';
      save();
    });
    $('pSpeed').addEventListener('input', function () {
      S.speed = parseFloat(this.value);
      $('pSpeedVal').textContent = S.speed.toFixed(1);
      $('speed').value = S.speed; $('speedVal').textContent = S.speed.toFixed(1);
      save();
    });

    toggle('flickSimple', 'flickSimple', updateChartInfo);
    toggle('noFail', 'noFail');
    toggle('autoPlay', 'autoPlay');
    toggle('showBars', 'showBars');
    toggle('showKeys', 'showKeys');

    /* 버튼 */
    $('startBtn').addEventListener('click', function () { start(null); });
    $('resumeBtn').addEventListener('click', resume);
    $('retryBtn').addEventListener('click', function () {
      $('pauseScreen').classList.add('hidden'); start(null);
    });
    $('quitBtn').addEventListener('click', quit);
    $('rRetryBtn').addEventListener('click', function () {
      $('resultScreen').classList.add('hidden'); start(null);
    });
    $('rQuitBtn').addEventListener('click', quit);
    $('pauseBtn').addEventListener('click', pause);

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (playing && !paused) pause();
        else if (paused) resume();
      }
      if (e.key === 'Enter' && !playing && !$('titleScreen').classList.contains('hidden')) {
        start(null);
      }
    });

    /* 초기 표시 */
    $('modeBuiltin').checked = S.chartMode !== 'auto';
    $('modeAuto').checked = false;
    $('modeAuto').disabled = true;
    $('analyzeBtn').disabled = true;
    S.chartMode = 'builtin';
    if (S.songId !== 'file' && !Songs.byId(S.songId)) S.songId = Songs.LIST[0].id;
    selectSong(S.songId);
    Renderer.draw(null, 0, viewSettings());
    autoLoadSong();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
