/* =========================================================
   input.js - 키보드 / 터치 입력
   ---------------------------------------------------------
   레인 키 : S D F  J K L
   플릭    : 레인 키 + 윗줄 키(W E R U I O) 또는 방향키
             터치는 위로 스와이프
   ========================================================= */
var Input = (function () {
  'use strict';

  var DEFAULT_KEYS = ['s', 'd', 'f', 'j', 'k', 'l'];
  var BASE_FLICK = ['w', 'e', 'r', 'u', 'i', 'o',
                    'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

  var LANE_KEYS = DEFAULT_KEYS.slice();
  var FLICK_KEYS = BASE_FLICK.slice();
  var labels = ['S', 'D', 'F', 'J', 'K', 'L'];   // 렌더러가 참조 -> 항상 제자리 수정

  var PRETTY = {
    arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
    ' ': 'Space', control: 'Ctrl', shift: 'Shift', alt: 'Alt',
    tab: 'Tab', enter: 'Enter', backspace: '⌫'
  };
  function keyLabel(k) {
    if (PRETTY[k]) return PRETTY[k];
    return k.length === 1 ? k.toUpperCase() : k;
  }

  /* 레인 키를 바꾸면 겹치는 플릭 키는 자동으로 빠진다 */
  function setKeys(arr) {
    LANE_KEYS = arr.slice(0, 6).map(function (k) { return String(k).toLowerCase(); });
    FLICK_KEYS = BASE_FLICK.filter(function (k) { return LANE_KEYS.indexOf(k) < 0; });
    labels.length = 0;
    for (var i = 0; i < LANE_KEYS.length; i++) labels.push(keyLabel(LANE_KEYS[i]));
  }

  var handler = null;        // { down(lane,t), up(lane,t), flick(t,lane), time() }
  var enabled = false;
  var canvas = null;
  var pointers = {};         // pointerId -> {lane, x, y, flicked}
  var pressed = {};

  function laneFromX(x) {
    var F = Renderer.field;
    var l = Math.floor((x - F.left) / F.laneW);
    return U.clamp(l, 0, 5);
  }

  function onKeyDown(e) {
    if (!enabled) return;
    var k = e.key.toLowerCase();
    var li = LANE_KEYS.indexOf(k);
    if (li >= 0) {
      e.preventDefault();
      if (e.repeat || pressed[k]) return;
      pressed[k] = true;
      handler.down(li, handler.time());
      return;
    }
    if (FLICK_KEYS.indexOf(k) >= 0) {
      e.preventDefault();
      if (e.repeat) return;
      handler.flick(handler.time(), null);
    }
  }

  function onKeyUp(e) {
    if (!enabled) return;
    var k = e.key.toLowerCase();
    var li = LANE_KEYS.indexOf(k);
    if (li >= 0) {
      pressed[k] = false;
      handler.up(li, handler.time());
    }
  }

  function localPos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (!enabled) return;
    e.preventDefault();
    var p = localPos(e);
    var lane = laneFromX(p.x);
    pointers[e.pointerId] = { lane: lane, x: p.x, y: p.y, flicked: false };
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
    handler.down(lane, handler.time());
  }

  function onPointerMove(e) {
    if (!enabled) return;
    var st = pointers[e.pointerId];
    if (!st) return;
    var p = localPos(e);
    var dy = p.y - st.y, dx = p.x - st.x;
    var dist = Math.abs(dx) + Math.abs(dy);
    if (!st.flicked && dist > Renderer.field.laneW * 0.35) {
      st.flicked = true;
      handler.flick(handler.time(), st.lane);
    }
    /* 슬라이드: 레인이 바뀌면 이전 레인 해제 후 새 레인 누름 */
    var nl = laneFromX(p.x);
    if (nl !== st.lane) {
      handler.up(st.lane, handler.time());
      st.lane = nl;
      handler.down(nl, handler.time());
      st.x = p.x; st.y = p.y; st.flicked = false;
    }
  }

  function onPointerUp(e) {
    if (!enabled) return;
    var st = pointers[e.pointerId];
    if (!st) return;
    delete pointers[e.pointerId];
    handler.up(st.lane, handler.time());
  }

  function attach(cv, h) {
    canvas = cv; handler = h;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointercancel', onPointerUp);
  }

  function setEnabled(v) {
    enabled = v;
    if (!v) { pointers = {}; pressed = {}; }
  }

  return {
    attach: attach,
    setEnabled: setEnabled,
    setKeys: setKeys,
    keyLabel: keyLabel,
    keys: function () { return LANE_KEYS.slice(); },
    flickKeys: function () { return FLICK_KEYS.slice(); },
    DEFAULT_KEYS: DEFAULT_KEYS,
    labels: labels
  };
})();
