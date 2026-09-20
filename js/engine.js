/* =========================================================
   engine.js - 판정 / 점수 / 게이지
   ---------------------------------------------------------
   노트를 "판정 단위(unit)"로 평탄화해서 처리한다.
     tap / flick        -> 1 unit
     chain(홀드·슬라이드) -> head + tick*n + tail
   ========================================================= */
var Engine = (function () {
  'use strict';

  /* 판정 윈도우(초). 프세카보다 전반적으로 좁게 잡았다. */
  var W = { PERFECT: 0.042, GREAT: 0.078, GOOD: 0.112, BAD: 0.155 };
  var WEIGHT = { PERFECT: 1, GREAT: 0.72, GOOD: 0.40, BAD: 0.08, MISS: 0 };
  var LIFE = { PERFECT: 1.2, GREAT: 0.3, GOOD: -3, BAD: -9, MISS: -18 };
  var FLICK_ARM = 0.16;     // 방향키 <-> 레인키 허용 간격

  function judgeOf(dt) {
    var a = Math.abs(dt);
    if (a <= W.PERFECT) return 'PERFECT';
    if (a <= W.GREAT) return 'GREAT';
    if (a <= W.GOOD) return 'GOOD';
    if (a <= W.BAD) return 'BAD';
    return null;
  }

  function Game(chart, opts) {
    opts = opts || {};
    this.chart = chart;
    this.bpm = chart.bpm || 150;
    this.flickSimple = !!opts.flickSimple;
    this.noFail = !!opts.noFail;
    this.autoPlay = !!opts.autoPlay;

    this.notes = chart.notes;
    this.units = [];
    this._flatten();

    this.total = this.units.length;
    this.baseScore = this.total ? 950000 / this.total : 0;

    this.held = [false, false, false, false, false, false];
    this.lastUp = [-99, -99, -99, -99, -99, -99];
    this.flickArm = -99;
    this.pendingFlicks = [];   // 동시 플릭이 여러 개일 수 있으므로 목록으로

    this.cursor = 0;          // 자동 미스 검사 시작 위치
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.life = 1000;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, BAD: 0, MISS: 0 };
    this.lastJudge = null;    // {result, time, early}
    this.hitCount = 0;        // 타격음 트리거용
    this.effects = [];
    this.failed = false;
    this.judged = 0;

    var last = this.notes.length
      ? this.notes[this.notes.length - 1]
      : { time: 0 };
    this.endTime = (last.endTime || last.time) + 2.5;
  }

  Game.prototype._flatten = function () {
    var spb = 60 / this.bpm;
    var tick = spb * 0.5;
    for (var i = 0; i < this.notes.length; i++) {
      var n = this.notes[i];
      n.broken = false; n.headHit = false; n.active = false; n.done = false;
      if (n.type === 'chain') {
        this.units.push({ n: n, kind: 'head', time: n.time, lane: n.nodes[0].lane, judged: false });
        var s = n.nodes[0].time, e = n.nodes[n.nodes.length - 1].time;
        for (var t = s + tick; t < e - tick * 0.35; t += tick) {
          this.units.push({ n: n, kind: 'tick', time: t, lane: laneAt(n, t), judged: false });
        }
        this.units.push({ n: n, kind: 'tail', time: e, lane: n.nodes[n.nodes.length - 1].lane, judged: false });
      } else {
        this.units.push({ n: n, kind: n.type, time: n.time, lane: n.lane, judged: false });
      }
    }
    this.units.sort(function (a, b) { return a.time - b.time; });
  };

  /* 체인의 시각 t 에서 눌러야 하는 레인 */
  function laneAt(n, t) {
    var nd = n.nodes;
    if (t <= nd[0].time) return nd[0].lane;
    for (var i = 0; i < nd.length - 1; i++) {
      if (t <= nd[i + 1].time) {
        var r = (t - nd[i].time) / Math.max(1e-6, nd[i + 1].time - nd[i].time);
        return Math.round(U.lerp(nd[i].lane, nd[i + 1].lane, r));
      }
    }
    return nd[nd.length - 1].lane;
  }
  Game.prototype.laneAt = laneAt;

  /* 슬라이드에서 레인이 바뀌는 순간은 칼같이 끊지 않는다.
     전환점 ±LANE_EASE 안의 레인 중 하나만 눌려 있으면 유효. */
  var LANE_EASE = 0.09;
  Game.prototype._chainHeld = function (n, t) {
    var a = laneAt(n, t);
    if (this.held[a]) return true;
    var b = laneAt(n, t - LANE_EASE);
    if (b !== a && this.held[b]) return true;
    var c = laneAt(n, t + LANE_EASE);
    return c !== a && this.held[c];
  };

  /* --------------------------------------------------------
     판정 기록
     -------------------------------------------------------- */
  Game.prototype._apply = function (unit, result, dt, now) {
    if (unit.judged) return;
    unit.judged = true;
    unit.result = result;
    this.judged++;
    this.counts[result]++;

    if (result === 'PERFECT' || result === 'GREAT') {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    } else {
      this.combo = 0;
    }
    this.score += this.baseScore * WEIGHT[result];
    this.life = U.clamp(this.life + LIFE[result], 0, 1000);
    if (this.life <= 0 && !this.noFail) this.failed = true;

    if (unit.kind !== 'tick') {
      this.lastJudge = { result: result, time: now, early: dt > 0.012 ? -1 : (dt < -0.012 ? 1 : 0) };
    }
    if (result !== 'MISS' && unit.kind !== 'tick') {
      this.effects.push({ lane: unit.lane, time: now, result: result, kind: unit.kind });
      this.hitCount++;
    }
    if (unit.kind === 'head') {
      if (result === 'MISS') unit.n.broken = true;
      else { unit.n.headHit = true; unit.n.active = true; }
    }
    /* 판정이 끝난 노트는 화면에서 지운다 */
    if (unit.kind === 'tap' || unit.kind === 'flick' || unit.kind === 'tail') unit.n.done = true;
  };

  /* --------------------------------------------------------
     입력
     -------------------------------------------------------- */
  Game.prototype._candidate = function (lane, now) {
    var best = null, bestDt = 1e9;
    for (var i = this.cursor; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.time > now + W.BAD) break;
      if (u.judged || u.lane !== lane) continue;
      if (u.kind === 'tick' || u.kind === 'tail') continue;
      if (u.n.broken) continue;
      var dt = Math.abs(u.time - now);
      if (dt < bestDt) { bestDt = dt; best = u; }
    }
    return best;
  };

  Game.prototype.laneDown = function (lane, now) {
    if (this.autoPlay) return;
    this.held[lane] = true;
    var u = this._candidate(lane, now);
    if (!u) return;

    var needFlick = (u.kind === 'flick') && !this.flickSimple;
    if (needFlick) {
      if (now - this.flickArm <= FLICK_ARM) this._hit(u, now);
      else this.pendingFlicks.push({ unit: u, at: now });
      return;
    }
    this._hit(u, now);
  };

  Game.prototype._hit = function (u, now) {
    var r = judgeOf(u.time - now);
    if (!r) return;
    this._apply(u, r, u.time - now, now);
  };

  Game.prototype.laneUp = function (lane, now) {
    if (this.autoPlay) return;
    this.held[lane] = false;
    this.lastUp[lane] = now;
  };

  /* 방향키 / 스와이프 */
  Game.prototype.flickInput = function (now, lane) {
    if (this.autoPlay) return;
    this.flickArm = now;

    /* 대기 중이던 레인 누름과 결합 (동시 플릭 전부 처리) */
    var resolved = false;
    for (var p = this.pendingFlicks.length - 1; p >= 0; p--) {
      var pf = this.pendingFlicks[p];
      if (now - pf.at > FLICK_ARM) { this.pendingFlicks.splice(p, 1); continue; }
      this.pendingFlicks.splice(p, 1);
      if (!pf.unit.judged) {
        var dt = pf.unit.time - pf.at;
        this._apply(pf.unit, judgeOf(dt) || 'BAD', dt, now);
      }
      resolved = true;
    }
    if (resolved) return;

    /* 스와이프처럼 레인 정보가 같이 오면 바로 처리 */
    if (lane != null) {
      var u = this._candidate(lane, now);
      if (u && u.kind === 'flick') { this._hit(u, now); return; }
    }
    /* 진행 중인 체인의 플릭 끝점 */
    for (var i = this.cursor; i < this.units.length; i++) {
      var t = this.units[i];
      if (t.time > now + W.BAD) break;
      if (t.judged || t.kind !== 'tail' || t.n.endType !== 'flick') continue;
      if (!t.n.headHit || t.n.broken) continue;
      var r = judgeOf(t.time - now);
      if (r) { this._apply(t, r, t.time - now, now); return; }
    }
  };

  /* --------------------------------------------------------
     매 프레임 갱신
     -------------------------------------------------------- */
  Game.prototype.update = function (now) {
    var i, u;

    /* 오토플레이 */
    if (this.autoPlay) {
      for (i = this.cursor; i < this.units.length; i++) {
        u = this.units[i];
        if (u.time > now) break;
        if (!u.judged) {
          if (u.kind === 'head') { u.n.headHit = true; u.n.active = true; }
          if (u.kind === 'tail') u.n.done = true;
          this._apply(u, 'PERFECT', 0, now);
        }
      }
    }

    for (i = this.cursor; i < this.units.length; i++) {
      u = this.units[i];
      if (u.time > now + 0.001) break;
      if (u.judged) continue;

      if (u.kind === 'tick') {
        if (!u.n.headHit || u.n.broken) this._apply(u, 'MISS', 0, now);
        else this._apply(u, this._chainHeld(u.n, u.time) ? 'PERFECT' : 'MISS', 0, now);
        continue;
      }
      if (u.kind === 'tail') {
        if (!u.n.headHit || u.n.broken) { this._apply(u, 'MISS', 0, now); continue; }
        if (u.n.endType === 'flick' && !this.flickSimple) continue;   // 플릭 입력 대기
        if (this._chainHeld(u.n, u.time)) { this._apply(u, 'PERFECT', 0, now); continue; }
        var d = u.time - this.lastUp[u.lane];
        var r = judgeOf(d);
        this._apply(u, (r && d >= 0) ? r : 'MISS', 0, now);
        continue;
      }
    }

    /* 윈도우를 지난 미판정 노트 = MISS */
    while (this.cursor < this.units.length) {
      u = this.units[this.cursor];
      if (u.time >= now - W.BAD) break;
      if (!u.judged) {
        this._apply(u, 'MISS', 0, now);
        if (u.kind === 'head') u.n.broken = true;
      }
      this.cursor++;
    }

    for (i = this.pendingFlicks.length - 1; i >= 0; i--) {
      if (now - this.pendingFlicks[i].at > FLICK_ARM) this.pendingFlicks.splice(i, 1);
    }

    /* 체인 활성 상태 갱신(렌더용) */
    for (i = 0; i < this.notes.length; i++) {
      var n = this.notes[i];
      if (n.type === 'chain') n.active = n.headHit && !n.done && now >= n.time && now <= n.endTime;
    }

    /* 이펙트 수명 */
    if (this.effects.length > 64) this.effects.splice(0, this.effects.length - 64);
  };

  /* --------------------------------------------------------
     결과
     -------------------------------------------------------- */
  Game.prototype.result = function () {
    var comboScore = this.total ? 50000 * (this.maxCombo / this.total) : 0;
    var score = Math.round(this.score + comboScore);
    var c = this.counts;
    var acc = this.total
      ? (c.PERFECT + c.GREAT * 0.72 + c.GOOD * 0.4 + c.BAD * 0.08) / this.total * 100
      : 0;
    var rank = score >= 980000 ? 'S+' : score >= 950000 ? 'S' : score >= 900000 ? 'A'
             : score >= 800000 ? 'B' : score >= 650000 ? 'C' : 'D';
    var badge = (c.GREAT + c.GOOD + c.BAD + c.MISS === 0 && this.total > 0) ? 'ALL PERFECT'
              : (c.GOOD + c.BAD + c.MISS === 0 && this.total > 0) ? 'FULL COMBO' : null;
    return {
      score: score, rank: rank, badge: badge, counts: c,
      maxCombo: this.maxCombo, total: this.total,
      accuracy: acc, failed: this.failed, life: this.life
    };
  };

  Game.W = W;
  return Game;
})();
