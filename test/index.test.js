import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, lookup, DualScrollSync } from '../src/index.js';

function near(actual, expected, tol) {
  tol = tol ?? 1;
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `Expected ~${expected}, got ${actual} (tol=${tol})`
  );
}

/** Synchronous frame scheduler for deterministic pump tests. */
function syncScheduler() {
  const queue = [];
  let nextId = 1;
  return {
    requestFrame(fn) { const id = nextId++; queue.push({ id, fn }); return id; },
    cancelFrame(id) { const i = queue.findIndex(f => f.id === id); if (i >= 0) queue.splice(i, 1); },
    drain(max = 200) { let n = 0; while (queue.length && n < max) { queue.shift().fn(); n++; } return n; },
    get pending() { return queue.length; },
  };
}

// ─── buildMap ───

describe('buildMap', () => {
  test('empty anchors → single segment', () => {
    const { segments, vTotal, droppedCount } = buildMap([], 1000, 2000);
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0], { aPx: 0, bPx: 0, vPx: 0, aS: 1000, bS: 2000, vS: 2000 });
    assert.equal(vTotal, 2000);
    assert.equal(droppedCount, 0);
  });

  test('vS = max(aS, bS) per segment', () => {
    const { segments } = buildMap([{ aPx: 400, bPx: 100 }], 1000, 500);
    assert.equal(segments[0].vS, 400);
    assert.equal(segments[1].vS, 600);
  });

  test('vTotal = sum of all vS', () => {
    const { segments, vTotal } = buildMap(
      [{ aPx: 200, bPx: 500 }, { aPx: 600, bPx: 800 }], 1000, 1000
    );
    assert.equal(vTotal, segments.reduce((s, seg) => s + seg.vS, 0));
  });

  test('vPx is cumulative', () => {
    const { segments } = buildMap([{ aPx: 300, bPx: 600 }], 1000, 1000);
    assert.equal(segments[0].vPx, 0);
    assert.equal(segments[1].vPx, segments[0].vS);
  });

  test('non-monotonic bPx entries are dropped', () => {
    const { segments, droppedCount } = buildMap([
      { aPx: 200, bPx: 500 },
      { aPx: 400, bPx: 300 },
      { aPx: 600, bPx: 800 },
    ], 1000, 1000);
    assert.equal(segments.length, 3);
    assert.equal(droppedCount, 1);
  });

  test('droppedCount is 0 when all anchors are monotonic', () => {
    const { droppedCount } = buildMap([
      { aPx: 200, bPx: 200 },
      { aPx: 500, bPx: 500 },
    ], 1000, 1000);
    assert.equal(droppedCount, 0);
  });

  test('droppedCount counts all dropped anchors', () => {
    const { droppedCount } = buildMap([
      { aPx: 100, bPx: 500 },
      { aPx: 200, bPx: 300 },
      { aPx: 300, bPx: 400 },
      { aPx: 400, bPx: 600 },
    ], 1000, 1000);
    assert.equal(droppedCount, 2);
  });

  test('anchors clamped to sMax', () => {
    const { segments } = buildMap([{ aPx: 9999, bPx: 9999 }], 500, 300);
    assert.equal(segments[0].aS, 500);
    assert.equal(segments[0].bS, 300);
  });

  test('sMaxA=0 and sMaxB=0 → vTotal=0', () => {
    const { vTotal, segments } = buildMap([], 0, 0);
    assert.equal(vTotal, 0);
    assert.equal(segments.length, 1);
  });

  test('duplicate aPx anchors: only first kept', () => {
    const { segments } = buildMap([
      { aPx: 300, bPx: 300 },
      { aPx: 300, bPx: 400 },
    ], 1000, 1000);
    assert.equal(segments.length, 2);
  });
});

// ─── lookup ───

describe('lookup', () => {
  test('empty segments → returns 0', () => {
    assert.equal(lookup([], 'vPx', 'aPx', 100), 0);
    assert.equal(lookup([], 'aPx', 'vPx', 0), 0);
  });

  const { segments, vTotal } = buildMap([{ aPx: 200, bPx: 600 }], 1000, 1000);

  test('v=0 → a=0, b=0', () => {
    assert.equal(lookup(segments, 'vPx', 'aPx', 0), 0);
    assert.equal(lookup(segments, 'vPx', 'bPx', 0), 0);
  });

  test('v=vTotal → a=sMaxA, b=sMaxB', () => {
    near(lookup(segments, 'vPx', 'aPx', vTotal), 1000);
    near(lookup(segments, 'vPx', 'bPx', vTotal), 1000);
  });

  test('anchor consistency: a→v→b', () => {
    const v = lookup(segments, 'aPx', 'vPx', 200);
    near(lookup(segments, 'vPx', 'bPx', v), 600);
  });

  test('seg0 midpoint: v=300 → a=100, b=300', () => {
    near(lookup(segments, 'vPx', 'aPx', 300), 100);
    near(lookup(segments, 'vPx', 'bPx', 300), 300);
  });

  test('seg1 midpoint: v=1000 → a=600, b=800', () => {
    near(lookup(segments, 'vPx', 'aPx', 1000), 600);
    near(lookup(segments, 'vPx', 'bPx', 1000), 800);
  });

  test('b→v→b round-trip', () => {
    for (let b = 0; b <= 1000; b += 100) {
      const v = lookup(segments, 'bPx', 'vPx', b);
      near(lookup(segments, 'vPx', 'bPx', v), b);
    }
  });

  test('a→v→a round-trip', () => {
    for (let a = 0; a <= 1000; a += 50) {
      const v = lookup(segments, 'aPx', 'vPx', a);
      near(lookup(segments, 'vPx', 'aPx', v), a);
    }
  });
});

// ─── vS principle ───

describe('vS principle', () => {
  test('dominant pane ratio = 1.0 in every segment', () => {
    const { segments } = buildMap(
      [{ aPx: 100, bPx: 500 }, { aPx: 600, bPx: 700 }], 1000, 1000
    );
    for (const seg of segments) {
      if (seg.vS === 0) continue;
      near(Math.max(seg.aS / seg.vS, seg.bS / seg.vS), 1.0, 0.0001);
    }
  });

  test('wheel delta: dominant pane moves at 1:1', () => {
    const { segments } = buildMap([{ aPx: 200, bPx: 800 }], 1000, 1000);
    assert.equal(segments[0].bS / segments[0].vS, 1.0);
    near(segments[0].aS / segments[0].vS, 0.25, 0.001);
  });

  test('no jump at segment boundary', () => {
    const { segments } = buildMap(
      [{ aPx: 500, bPx: 200 }, { aPx: 600, bPx: 900 }], 1000, 1000
    );
    const vB = segments[2].vPx;
    near(lookup(segments, 'vPx', 'bPx', vB - 0.01),
         lookup(segments, 'vPx', 'bPx', vB + 0.01), 1);
  });
});

// ─── stress ───

describe('stress', () => {
  test('100 anchors: all round-trips hold', () => {
    const anchors = [];
    for (let i = 1; i < 100; i++) {
      anchors.push({ aPx: i * 100, bPx: i * 50 + (i % 3) * 100 });
    }
    const { segments } = buildMap(anchors, 10000, 10000);
    for (let a = 0; a <= 10000; a += 500) {
      const v = lookup(segments, 'aPx', 'vPx', a);
      near(lookup(segments, 'vPx', 'aPx', v), a, 2);
    }
  });

  test('extreme asymmetry: aS=1, bS=50000', () => {
    const { segments } = buildMap([], 1, 50000);
    assert.equal(segments[0].vS, 50000);
    near(lookup(segments, 'vPx', 'aPx', 25000), 0.5, 0.1);
    near(lookup(segments, 'vPx', 'bPx', 25000), 25000, 1);
  });
});

// ─── DualScrollSync (DOM mock) ───

function mockPane(scrollHeight, clientHeight) {
  const listeners = {};
  return {
    scrollTop: 0,
    scrollHeight: scrollHeight,
    clientHeight: clientHeight ?? 500,
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn);
    },
    _fire(type, event) {
      (listeners[type] || []).forEach(fn => fn(event));
    },
    _count(type) {
      return (listeners[type] || []).length;
    },
  };
}

function wheelEvent(deltaY) {
  return {
    deltaY, deltaX: 0,
    shiftKey: false, ctrlKey: false, metaKey: false,
    preventDefault() {},
  };
}

function makeSync(a, b, extra) {
  return new DualScrollSync(a, b, {
    getAnchors: () => [
      { aPx: 200, bPx: 600 },
      { aPx: 500, bPx: 800 },
    ],
    wheel: { smooth: 1 },
    ...extra,
  });
}

/** Derive vCurrent from public API (scrollTop + lookup). */
function deriveV(s) {
  const d = s.ensureMap();
  return lookup(d.segments, 'aPx', 'vPx', s.paneA.scrollTop + s.alignOffset);
}

/**
 * Pump one frame and return the virtual-axis delta from startV.
 * smooth = 0.5; 1-frame drain = delta × smooth × damping(startV).
 */
function pumpOneDelta(startV, delta, brakeOpts) {
  const pa = mockPane(2000), pb = mockPane(3000);
  const sched = syncScheduler();
  const s = makeSync(pa, pb, {
    wheel: { smooth: 0.5, ...brakeOpts },
    requestFrame: sched.requestFrame,
    cancelFrame: sched.cancelFrame,
  });
  s.ensureMap();
  s.scrollTo(startV);
  pa._fire('wheel', wheelEvent(delta));
  sched.drain(1);
  const vAfter = deriveV(s);
  s.destroy();
  return vAfter - startV;
}

describe('DualScrollSync', () => {
  let a, b;
  beforeEach(() => {
    a = mockPane(2000);
    b = mockPane(3000);
  });

  test('constructor registers 2 scroll + 2 wheel listeners', () => {
    const s = makeSync(a, b);
    assert.equal(a._count('scroll'), 1);
    assert.equal(a._count('wheel'), 1);
    assert.equal(b._count('scroll'), 1);
    assert.equal(b._count('wheel'), 1);
    s.destroy();
  });

  test('destroy removes all listeners', () => {
    const s = makeSync(a, b);
    s.destroy();
    assert.equal(a._count('scroll'), 0);
    assert.equal(a._count('wheel'), 0);
    assert.equal(b._count('scroll'), 0);
    assert.equal(b._count('wheel'), 0);
  });

  test('scroll paneA → syncs paneB to matching position', () => {
    const s = makeSync(a, b);
    a.scrollTop = 200; // anchor: aPx=200 → bPx=600
    a._fire('scroll');
    near(b.scrollTop, 600);
    s.destroy();
  });

  test('scroll paneB → syncs paneA', () => {
    const s = makeSync(a, b);
    b.scrollTop = 600;
    b._fire('scroll');
    near(a.scrollTop, 200);
    s.destroy();
  });

  test('echo guard absorbs reflected scroll event', () => {
    const s = makeSync(a, b);
    a.scrollTop = 200;
    a._fire('scroll');
    // B was set by sync → its scroll event should be absorbed
    const aPos = a.scrollTop;
    b._fire('scroll');
    near(a.scrollTop, aPos); // A unchanged
    s.destroy();
  });

  test('enabled=false suspends all sync', () => {
    const s = makeSync(a, b);
    s.enabled = false;
    a.scrollTop = 200;
    a._fire('scroll');
    assert.equal(b.scrollTop, 0);
    s.destroy();
  });

  test('invalidate causes rebuild on next ensureMap', () => {
    let count = 0;
    const s = makeSync(a, b, { onMapBuilt: () => count++ });
    s.ensureMap();
    assert.equal(count, 1);
    s.ensureMap(); // cached
    assert.equal(count, 1);
    s.invalidate();
    s.ensureMap();
    assert.equal(count, 2);
    s.destroy();
  });

  test('getAnchors exception → empty map, no crash', () => {
    const s = new DualScrollSync(a, b, {
      getAnchors: () => { throw new Error('broken'); },
      wheel: { smooth: 1 },
    });
    const d = s.ensureMap();
    assert.deepEqual(d.segments, []);
    assert.equal(d.vTotal, 0);
    assert.equal(d.droppedCount, 0);
    s.destroy();
  });

  test('wheel after getAnchors exception does not crash', () => {
    const s = new DualScrollSync(a, b, {
      getAnchors: () => { throw new Error('broken'); },
      wheel: { smooth: 1 },
    });
    a._fire('wheel', wheelEvent(100));
    assert.equal(a.scrollTop, 0);
    s.destroy();
  });

  test('wheel event moves both panes', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a._fire('wheel', wheelEvent(100));
    assert.ok(a.scrollTop > 0);
    assert.ok(b.scrollTop > 0);
    s.destroy();
  });

  test('wheel with modifier keys is ignored', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a._fire('wheel', { ...wheelEvent(100), shiftKey: true });
    assert.equal(a.scrollTop, 0);
    a._fire('wheel', { ...wheelEvent(100), ctrlKey: true });
    assert.equal(a.scrollTop, 0);
    a._fire('wheel', { ...wheelEvent(100), metaKey: true });
    assert.equal(a.scrollTop, 0);
    s.destroy();
  });

  test('horizontal-only wheel is ignored', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a._fire('wheel', {
      deltaY: 0, deltaX: 100,
      shiftKey: false, ctrlKey: false, metaKey: false,
      preventDefault() {},
    });
    assert.equal(a.scrollTop, 0);
    s.destroy();
  });

  test('onSync fires on scroll and wheel', () => {
    let count = 0;
    const s = makeSync(a, b, { onSync: () => count++ });
    a.scrollTop = 100;
    a._fire('scroll');
    assert.ok(count >= 1);
    const prev = count;
    a._fire('wheel', wheelEvent(50));
    assert.ok(count > prev);
    s.destroy();
  });

  test('wheel.smooth < 1 drains delta across multiple frames', () => {
    const sched = syncScheduler();
    let frames = 0;
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
    });
    s.ensureMap();
    s.onSync = () => { frames++; };
    a._fire('wheel', wheelEvent(100));
    assert.equal(a.scrollTop, 0, 'not applied synchronously');
    sched.drain();
    assert.ok(frames >= 2, `expected multiple frames, got ${frames}`);
    assert.ok(a.scrollTop > 0, 'pane A moved after drain');
    assert.ok(b.scrollTop > 0, 'pane B moved after drain');
    s.destroy();
  });

  test('wheel.smooth=0 does not preventDefault and does not start pump', () => {
    let frameRequested = false;
    let prevented = false;
    const s = makeSync(a, b, {
      wheel: { smooth: 0 },
      requestFrame: (fn) => { frameRequested = true; return setTimeout(fn, 1); },
    });
    s.ensureMap();
    a._fire('wheel', {
      ...wheelEvent(100),
      preventDefault() { prevented = true; },
    });
    assert.equal(a.scrollTop, 0, 'wheel.smooth=0 should not move');
    assert.equal(prevented, false, 'preventDefault should not be called');
    assert.equal(frameRequested, false, 'pump should not start');
    s.destroy();
  });

  test('wheel.smooth > 1 treated as instant', () => {
    const s = makeSync(a, b, { wheel: { smooth: 2 } });
    s.ensureMap();
    a._fire('wheel', wheelEvent(100));
    assert.ok(a.scrollTop > 0, 'should move synchronously');
    s.destroy();
  });

  test('destroy during pump cancels pending frame', () => {
    const sched = syncScheduler();
    let frameCount = 0;
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
    });
    s.ensureMap();
    s.onSync = () => { frameCount++; };
    a._fire('wheel', wheelEvent(100));
    s.destroy();
    sched.drain();
    assert.ok(frameCount <= 1, `expected ≤1 frames after destroy, got ${frameCount}`);
  });

  test('echo guard: 2px offset absorbed, 3px passes through', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a.scrollTop = 200;
    a._fire('scroll');
    const bAfterSync = b.scrollTop;
    const aAfterSync = a.scrollTop;
    // 2px rounding is absorbed (< 3)
    b.scrollTop = bAfterSync + 2;
    b._fire('scroll');
    near(a.scrollTop, aAfterSync, 0.01, 'A should NOT re-sync for 2px echo');
    // 3px offset passes through (NOT < 3)
    a.scrollTop = 200;
    a._fire('scroll');
    const bAfterSync2 = b.scrollTop;
    const aAfterSync2 = a.scrollTop;
    b.scrollTop = bAfterSync2 + 3;
    b._fire('scroll');
    assert.notEqual(a.scrollTop, aAfterSync2, 'A should re-sync for 3px offset');
    s.destroy();
  });

  test('deltaMode=1 (lines) multiplies deltaY by 16', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a._fire('wheel', {
      deltaY: 3, deltaX: 0, deltaMode: 1,
      shiftKey: false, ctrlKey: false, metaKey: false,
      preventDefault() {},
    });
    // wheelSmooth=1 → instant. 3 lines × 16 = 48 virtual px
    const v = deriveV(s);
    assert.ok(v >= 47 && v <= 49, `expected ~48 virtual px, got ${v}`);
    s.destroy();
  });

  test('deltaMode=2 (pages) multiplies deltaY by clientHeight', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a._fire('wheel', {
      deltaY: 1, deltaX: 0, deltaMode: 2,
      shiftKey: false, ctrlKey: false, metaKey: false,
      preventDefault() {},
    });
    // 1 page × 500 (clientHeight) = 500 virtual px
    const v = deriveV(s);
    assert.ok(v >= 499 && v <= 501, `expected ~500 virtual px, got ${v}`);
    s.destroy();
  });

  test('invalidate during pump uses new map', () => {
    const sched = syncScheduler();
    let mapCount = 0;
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
      onMapBuilt: () => { mapCount++; },
    });
    s.ensureMap();
    assert.equal(mapCount, 1);
    a._fire('wheel', wheelEvent(100));
    s.invalidate();
    sched.drain();
    assert.ok(mapCount >= 2, `expected map rebuild during pump, got ${mapCount}`);
    s.destroy();
  });

  test('scroll during pump: user scroll takes priority', () => {
    const sched = syncScheduler();
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
    });
    s.ensureMap();
    a._fire('wheel', wheelEvent(100));
    // Drain one frame so pump is mid-flight
    sched.drain(1);
    // Simulate user scrollbar drag on paneB
    b.scrollTop = 800;
    b._fire('scroll');
    assert.ok(a.scrollTop > 0, 'A should sync to B scroll during pump');
    s.destroy();
  });

  test('negative deltaY scrolls upward', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    // Scroll down first
    a._fire('wheel', wheelEvent(300));
    const aAfterDown = a.scrollTop;
    assert.ok(aAfterDown > 0, 'should have scrolled down');
    // Scroll up
    a._fire('wheel', wheelEvent(-100));
    assert.ok(a.scrollTop < aAfterDown, 'negative delta should scroll up');
    assert.ok(a.scrollTop > 0, 'should not go below 0');
    s.destroy();
  });

  test('negative deltaY clamps at 0', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a._fire('wheel', wheelEvent(-9999));
    assert.equal(a.scrollTop, 0);
    assert.equal(b.scrollTop, 0);
    s.destroy();
  });

  test('rapid wheel events accumulate in pump', () => {
    const sched = syncScheduler();
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
    });
    s.ensureMap();
    for (let i = 0; i < 5; i++) {
      a._fire('wheel', wheelEvent(50));
    }
    sched.drain();
    const v = deriveV(s);
    assert.ok(v > 200, `expected >200 virtual px, got ${v}`);
    s.destroy();
  });

  test('scroll before explicit ensureMap does not crash', () => {
    const s = makeSync(a, b);
    // No explicit ensureMap call — #handleScroll builds map on demand
    a.scrollTop = 100;
    a._fire('scroll');
    // Should work: map is built lazily
    assert.ok(b.scrollTop > 0, 'B should sync even without prior ensureMap');
    s.destroy();
  });
});

// ─── Anchor braking ───

describe('anchor braking', () => {
  // Integration tests: verify damping via 1-frame pump drain amount.
  // drain per frame = delta × smooth(0.5) × damping(v).
  // With delta=100, smooth=0.5: noBrake drain ≈ 50, factor=0.5 drain ≈ 25.
  const DELTA = 100;
  const NO_BRAKE_DRAIN = DELTA * 0.5; // damping = 1

  test('brake.factor=1 has no damping effect', () => {
    const d = pumpOneDelta(0, DELTA, { brake: { factor: 1, zone: 100 } });
    near(d, NO_BRAKE_DRAIN, 1);
  });

  test('brake.zone=0 disables damping', () => {
    const d = pumpOneDelta(0, DELTA, { brake: { factor: 0.5, zone: 0 } });
    near(d, NO_BRAKE_DRAIN, 1);
  });

  test('no brake option disables damping', () => {
    const d = pumpOneDelta(0, DELTA, {});
    near(d, NO_BRAKE_DRAIN, 1);
  });

  test('at anchor (v=0), damping = brake.factor', () => {
    // At v=0 (segment boundary), damping = factor = 0.5 → drain = 100×0.5×0.5 = 25
    const d = pumpOneDelta(0, DELTA, { brake: { factor: 0.5, zone: 100 } });
    near(d, DELTA * 0.5 * 0.5, 1);
  });

  test('far from any anchor, damping = 1.0', () => {
    // v=300 is far from anchors at 0, 600, 900 with zone=50 → damping = 1
    const d = pumpOneDelta(300, DELTA, { brake: { factor: 0.5, zone: 50 } });
    near(d, NO_BRAKE_DRAIN, 1);
  });

  test('smoothstep curve is non-linear', () => {
    // At t=0.25 (v=25, zone=100), smoothstep gives less damping than linear
    const dQuarter = pumpOneDelta(25, DELTA, { brake: { factor: 0.5, zone: 100 } });
    const dHalf = pumpOneDelta(50, DELTA, { brake: { factor: 0.5, zone: 100 } });
    // Linear: d(25)/d(50) would be ~0.578/0.75 ≈ 0.77
    // Smoothstep: d(25)/d(50) ≈ 0.578/0.75 but d(25) < linear-d(25)
    const linearQuarter = DELTA * 0.5 * (0.5 + 0.5 * 0.25); // 0.625 × 50 = 31.25
    assert.ok(dQuarter < linearQuarter,
      `smoothstep at quarter zone should be < linear (${dQuarter} < ${linearQuarter})`);
    assert.ok(dQuarter < dHalf, 'closer to anchor should drain less');
  });

  test('pump drains slower near anchor with braking', () => {
    const a = mockPane(2000), b = mockPane(3000);
    const a2 = mockPane(2000), b2 = mockPane(3000);
    const sched1 = syncScheduler();
    const sBrake = makeSync(a, b, {
      wheel: { smooth: 0.5, brake: { factor: 0.3, zone: 200 } },
      requestFrame: sched1.requestFrame,
      cancelFrame: sched1.cancelFrame,
    });
    sBrake.ensureMap();
    const sched2 = syncScheduler();
    const sNoBrake = makeSync(a2, b2, {
      wheel: { smooth: 0.5 },
      requestFrame: sched2.requestFrame,
      cancelFrame: sched2.cancelFrame,
    });
    sNoBrake.ensureMap();

    a._fire('wheel', wheelEvent(50));
    a2._fire('wheel', wheelEvent(50));
    sched1.drain(3);
    sched2.drain(3);
    assert.ok(
      a.scrollTop <= a2.scrollTop,
      `braked (${a.scrollTop}) should be ≤ unbraked (${a2.scrollTop})`
    );
    sBrake.destroy();
    sNoBrake.destroy();
  });
});

// ─── alignOffset ───

describe('alignOffset', () => {
  let a, b;
  beforeEach(() => {
    a = mockPane(2000);
    b = mockPane(3000);
  });

  test('alignOffset shifts scroll positions by offset', () => {
    const s = makeSync(a, b, { alignOffset: 30 });
    s.ensureMap();
    a._fire('wheel', wheelEvent(200));
    const aWith = a.scrollTop;
    const bWith = b.scrollTop;
    s.destroy();
    // Compare against no-offset baseline with same delta
    const a2 = mockPane(2000), b2 = mockPane(3000);
    const s2 = makeSync(a2, b2);
    s2.ensureMap();
    a2._fire('wheel', wheelEvent(200));
    near(aWith, a2.scrollTop - 30, 1);
    near(bWith, b2.scrollTop - 30, 1);
    s2.destroy();
  });

  test('alignOffset=0 is equivalent to no offset', () => {
    const s1 = makeSync(a, b, { alignOffset: 0 });
    const a2 = mockPane(2000);
    const b2 = mockPane(3000);
    const s2 = makeSync(a2, b2);
    s1.ensureMap();
    s2.ensureMap();
    a._fire('wheel', wheelEvent(300));
    a2._fire('wheel', wheelEvent(300));
    near(a.scrollTop, a2.scrollTop, 1);
    near(b.scrollTop, b2.scrollTop, 1);
    s1.destroy();
    s2.destroy();
  });

  test('scroll event with alignOffset re-derives vCurrent correctly', () => {
    const s = makeSync(a, b, { alignOffset: 20 });
    s.ensureMap();
    // Simulate scrollbar drag on pane A
    a.scrollTop = 200;
    a._fire('scroll');
    // Verify b.scrollTop reflects the correct virtual position (accounting for offset)
    const segs = s.ensureMap().segments;
    const expectedV = lookup(segs, 'aPx', 'vPx', 200 + 20);
    near(b.scrollTop, lookup(segs, 'vPx', 'bPx', expectedV) - 20, 1);
    s.destroy();
  });
});

// ─── snap (wheel-level) ───

describe('wheel snap', () => {
  let a, b;
  beforeEach(() => {
    a = mockPane(2000);
    b = mockPane(3000);
  });

  test('hasSnap is true when any anchor has snap: true', () => {
    const { hasSnap } = buildMap([
      { aPx: 200, bPx: 600, snap: true },
      { aPx: 500, bPx: 800 },
    ], 1000, 1000);
    assert.equal(hasSnap, true);
  });

  test('hasSnap is false when no anchor has snap', () => {
    const { hasSnap } = buildMap([
      { aPx: 200, bPx: 600 },
      { aPx: 500, bPx: 800 },
    ], 1000, 1000);
    assert.equal(hasSnap, false);
  });

  test('snap segment preserves snap: true on segment', () => {
    const { segments } = buildMap([
      { aPx: 200, bPx: 600, snap: true },
    ], 1000, 1000);
    assert.equal(segments[1].snap, true);
    assert.equal(segments[0].snap, undefined);
  });

  test('snap triggers when pump ends within range', () => {
    const sched = syncScheduler();
    const s = new DualScrollSync(a, b, {
      getAnchors: () => [{ aPx: 200, bPx: 600, snap: true }],
      wheel: { smooth: 0.5, snap: 50 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
    });
    s.ensureMap();
    const anchorV = s.ensureMap().segments[1].vPx;
    s.scrollTo(anchorV - 30);
    // Fire tiny wheel event → pump drains → trySnap fires
    a._fire('wheel', wheelEvent(1));
    sched.drain();
    near(deriveV(s), anchorV, 5);
    s.destroy();
  });

  test('snap does not trigger when out of range', () => {
    const sched = syncScheduler();
    const s = new DualScrollSync(a, b, {
      getAnchors: () => [{ aPx: 500, bPx: 800, snap: true }],
      wheel: { smooth: 0.5, snap: 10 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
    });
    s.ensureMap();
    const anchorV = s.ensureMap().segments[1].vPx;
    s.scrollTo(anchorV - 100);
    // Fire tiny wheel event → pump drains → trySnap fires but distance > snap
    a._fire('wheel', wheelEvent(1));
    sched.drain();
    const dist = Math.abs(deriveV(s) - anchorV);
    assert.ok(dist > 10, `should not snap, dist=${dist}`);
    s.destroy();
  });

  test('snap=0 disables snap entirely', () => {
    const sched = syncScheduler();
    const s = new DualScrollSync(a, b, {
      getAnchors: () => [{ aPx: 200, bPx: 600, snap: true }],
      wheel: { smooth: 0.5, snap: 0 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
    });
    s.ensureMap();
    const anchorV = s.ensureMap().segments[1].vPx;
    s.scrollTo(anchorV - 5);
    // Fire tiny wheel event → pump drains → no snap (snap=0)
    a._fire('wheel', wheelEvent(1));
    sched.drain();
    const dist = Math.abs(deriveV(s) - anchorV);
    assert.ok(dist > 1, 'should not snap with snap=0');
    s.destroy();
  });

  test('with hasSnap, only snap anchors are snap targets', () => {
    const sched = syncScheduler();
    const s = new DualScrollSync(a, b, {
      getAnchors: () => [
        { aPx: 200, bPx: 400 },           // no snap
        { aPx: 500, bPx: 800, snap: true }, // snap target
      ],
      wheel: { smooth: 0.5, snap: 50 },
      requestFrame: sched.requestFrame,
      cancelFrame: sched.cancelFrame,
    });
    const d = s.ensureMap();
    const nonSnapV = d.segments[1].vPx;
    s.scrollTo(nonSnapV - 5);
    // Fire tiny wheel event near non-snap anchor → should NOT snap
    a._fire('wheel', wheelEvent(1));
    sched.drain();
    const dist = Math.abs(deriveV(s) - nonSnapV);
    assert.ok(dist > 1, 'should not snap to non-snap anchor');
    s.destroy();
  });
});

// ─── buildMap input validation ───

describe('buildMap input validation', () => {
  test('negative sMaxA is clamped to 0', () => {
    const { segments, vTotal } = buildMap([], -100, 500);
    assert.equal(vTotal, 500);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].aS, 0);
    assert.equal(segments[0].bS, 500);
  });

  test('negative sMaxB is clamped to 0', () => {
    const { segments, vTotal } = buildMap([], 500, -100);
    assert.equal(vTotal, 500);
    assert.equal(segments[0].aS, 500);
    assert.equal(segments[0].bS, 0);
  });

  test('both negative → vTotal=0', () => {
    const { vTotal } = buildMap([], -10, -20);
    assert.equal(vTotal, 0);
  });
});

// ─── onError callback ───

describe('onError', () => {
  let a, b;
  beforeEach(() => {
    a = mockPane(2000);
    b = mockPane(3000);
  });

  test('onError receives exception from getAnchors', () => {
    let captured = null;
    const s = new DualScrollSync(a, b, {
      getAnchors: () => { throw new Error('test-error'); },
      wheel: { smooth: 1 },
      onError: (err) => { captured = err; },
    });
    s.ensureMap();
    assert.ok(captured instanceof Error);
    assert.equal(captured.message, 'test-error');
    s.destroy();
  });

  test('onError not called when getAnchors succeeds', () => {
    let called = false;
    const s = makeSync(a, b, { onError: () => { called = true; } });
    s.ensureMap();
    assert.equal(called, false);
    s.destroy();
  });

  test('without onError, exception still produces empty map', () => {
    const s = new DualScrollSync(a, b, {
      getAnchors: () => { throw new Error('no-handler'); },
      wheel: { smooth: 1 },
    });
    const d = s.ensureMap();
    assert.deepEqual(d.segments, []);
    assert.equal(d.vTotal, 0);
    s.destroy();
  });
});

// ─── wheel.smooth validation ───

describe('wheel.smooth validation', () => {
  let a, b;
  beforeEach(() => {
    a = mockPane(2000);
    b = mockPane(3000);
  });

  test('NaN smooth falls back to default 0.1', () => {
    const s = makeSync(a, b, { wheel: { smooth: NaN } });
    assert.equal(s.wheel.smooth, 0.1);
    s.destroy();
  });

  test('Infinity smooth falls back to default 0.1', () => {
    const s = makeSync(a, b, { wheel: { smooth: Infinity } });
    assert.equal(s.wheel.smooth, 0.1);
    s.destroy();
  });
});
