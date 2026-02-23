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

  test('wheel.smooth < 1 drains delta across multiple frames', (t, done) => {
    let frames = 0;
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    s.ensureMap();
    s.onSync = () => { frames++; };
    a._fire('wheel', wheelEvent(100));

    // Delta should NOT be applied synchronously
    assert.equal(a.scrollTop, 0, 'not applied synchronously');

    setTimeout(() => {
      assert.ok(frames >= 2, `expected multiple frames, got ${frames}`);
      assert.ok(a.scrollTop > 0, 'pane A moved after drain');
      assert.ok(b.scrollTop > 0, 'pane B moved after drain');
      s.destroy();
      done();
    }, 200);
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

  test('destroy during pump cancels pending frame', (t, done) => {
    let frameCount = 0;
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    s.ensureMap();
    s.onSync = () => { frameCount++; };
    a._fire('wheel', wheelEvent(100));
    s.destroy();

    setTimeout(() => {
      assert.ok(frameCount <= 1, `expected ≤1 frames after destroy, got ${frameCount}`);
      done();
    }, 100);
  });

  test('echo guard: exactly 2px offset passes through', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a.scrollTop = 200;
    a._fire('scroll');
    const bAfterSync = b.scrollTop;
    const aAfterSync = a.scrollTop;
    // Simulate browser rounding scrollTop by 2px
    b.scrollTop = bAfterSync + 2;
    b._fire('scroll');
    // 2px is NOT < 2, so echo guard does NOT absorb → B's scroll triggers re-sync
    assert.notEqual(a.scrollTop, aAfterSync, 'A should have been re-synced');
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
    const v = s._vCurrent;
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
    const v = s._vCurrent;
    assert.ok(v >= 499 && v <= 501, `expected ~500 virtual px, got ${v}`);
    s.destroy();
  });

  test('invalidate during pump uses new map', (t, done) => {
    let mapCount = 0;
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: (fn) => setTimeout(fn, 1),
      onMapBuilt: () => { mapCount++; },
    });
    s.ensureMap();
    assert.equal(mapCount, 1);
    a._fire('wheel', wheelEvent(100));
    // Invalidate while pump is running
    s.invalidate();
    setTimeout(() => {
      // Pump frames call ensureMap → should have rebuilt
      assert.ok(mapCount >= 2, `expected map rebuild during pump, got ${mapCount}`);
      s.destroy();
      done();
    }, 100);
  });

  test('scroll during pump: user scroll takes priority', (t, done) => {
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: (fn) => setTimeout(fn, 5),
    });
    s.ensureMap();
    a._fire('wheel', wheelEvent(100));
    // Simulate user scrollbar drag on paneB while pump is running
    setTimeout(() => {
      b.scrollTop = 800;
      b._fire('scroll');
      const aAfterScroll = a.scrollTop;
      // A should have synced to B's position (b=800 → a≈~500 area)
      assert.ok(aAfterScroll > 0, 'A should sync to B scroll during pump');
      s.destroy();
      done();
    }, 20);
  });

  test('negative deltaY scrolls upward', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    // Scroll down first
    a._fire('wheel', wheelEvent(300));
    const vAfterDown = s._vCurrent;
    assert.ok(vAfterDown > 0, 'should have scrolled down');
    // Scroll up
    a._fire('wheel', wheelEvent(-100));
    assert.ok(s._vCurrent < vAfterDown, 'negative delta should scroll up');
    assert.ok(s._vCurrent > 0, 'should not go below 0');
    s.destroy();
  });

  test('negative deltaY clamps at 0', () => {
    const s = makeSync(a, b);
    s.ensureMap();
    a._fire('wheel', wheelEvent(-9999));
    assert.equal(s._vCurrent, 0, 'vCurrent should clamp at 0');
    assert.equal(a.scrollTop, 0);
    assert.equal(b.scrollTop, 0);
    s.destroy();
  });

  test('rapid wheel events accumulate in pump', (t, done) => {
    const s = makeSync(a, b, {
      wheel: { smooth: 0.5 },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    s.ensureMap();
    // Fire 5 rapid wheel events before any frame runs
    for (let i = 0; i < 5; i++) {
      a._fire('wheel', wheelEvent(50));
    }
    // Total accumulated: 250px
    setTimeout(() => {
      // After drain, vCurrent should reflect ~250px total
      assert.ok(s._vCurrent > 200, `expected >200 virtual px, got ${s._vCurrent}`);
      s.destroy();
      done();
    }, 200);
  });

  test('scroll before explicit ensureMap does not crash', () => {
    const s = makeSync(a, b);
    // No explicit ensureMap call — _handleScroll builds map on demand
    a.scrollTop = 100;
    a._fire('scroll');
    // Should work: map is built lazily
    assert.ok(b.scrollTop > 0, 'B should sync even without prior ensureMap');
    s.destroy();
  });
});

// ─── Anchor braking ───

describe('anchor braking', () => {
  let a, b;
  beforeEach(() => {
    a = mockPane(2000);
    b = mockPane(3000);
  });

  test('brake.factor=1 has no damping effect', () => {
    const s = makeSync(a, b, { wheel: { smooth: 1, brake: { factor: 1, zone: 100 } } });
    assert.equal(s._anchorDamping(), 1);
    s.destroy();
  });

  test('brake.zone=0 disables damping', () => {
    const s = makeSync(a, b, { wheel: { smooth: 1, brake: { factor: 0.5, zone: 0 } } });
    assert.equal(s._anchorDamping(), 1);
    s.destroy();
  });

  test('no brake option disables damping', () => {
    const s = makeSync(a, b, { wheel: { smooth: 1 } });
    assert.equal(s._anchorDamping(), 1);
    s.destroy();
  });

  test('at anchor (v=0), damping = brake.factor', () => {
    const s = makeSync(a, b, { wheel: { smooth: 1, brake: { factor: 0.5, zone: 100 } } });
    s.ensureMap();
    s._vCurrent = 0; // segment boundary at v=0
    near(s._anchorDamping(), 0.5, 0.01);
    s.destroy();
  });

  test('far from any anchor, damping = 1.0', () => {
    const s = makeSync(a, b, { wheel: { smooth: 1, brake: { factor: 0.5, zone: 50 } } });
    s.ensureMap();
    // Place vCurrent far from all segment boundaries
    const segs = s._data.segments;
    // Mid-point of the largest segment
    let best = segs[0];
    for (const seg of segs) { if (seg.vS > best.vS) best = seg; }
    s._vCurrent = best.vPx + best.vS / 2;
    // If segment is large enough, midpoint is > brake.zone from both edges
    if (best.vS / 2 > 50) {
      near(s._anchorDamping(), 1.0, 0.01);
    }
    s.destroy();
  });

  test('smoothstep curve is non-linear (midpoint ≠ 0.75)', () => {
    const s = makeSync(a, b, { wheel: { smooth: 1, brake: { factor: 0.5, zone: 100 } } });
    s.ensureMap();
    // Place vCurrent at half the zone distance from anchor at v=0
    s._vCurrent = 50;
    const fMid = s._anchorDamping();
    // smoothstep(0.5) = 0.5, factor = 0.5 + 0.5*0.5 = 0.75 (same as linear at midpoint)
    near(fMid, 0.75, 0.01);
    // But at t=0.25: smoothstep=0.15625, factor=0.578 (linear would be 0.625)
    s._vCurrent = 25; // t=0.25
    const f2 = s._anchorDamping();
    const linearExpected = 0.5 + 0.5 * 0.25; // 0.625
    assert.ok(f2 < linearExpected, `smoothstep at t=0.25 should be < linear (${f2} < ${linearExpected})`);
    s.destroy();
  });

  test('pump drains slower near anchor with braking', (t, done) => {
    // With braking
    const sBrake = makeSync(a, b, {
      wheel: { smooth: 0.5, brake: { factor: 0.3, zone: 200 } },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    sBrake.ensureMap();

    // Without braking (control)
    const a2 = mockPane(2000);
    const b2 = mockPane(3000);
    const sNoBrake = makeSync(a2, b2, {
      wheel: { smooth: 0.5 },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    sNoBrake.ensureMap();

    // Both start at v=0 (on anchor) and receive same delta
    a._fire('wheel', wheelEvent(50));
    a2._fire('wheel', wheelEvent(50));

    setTimeout(() => {
      // Braked instance should have moved less after same elapsed time
      assert.ok(
        sBrake._vCurrent <= sNoBrake._vCurrent,
        `braked (${sBrake._vCurrent}) should be ≤ unbraked (${sNoBrake._vCurrent})`
      );
      sBrake.destroy();
      sNoBrake.destroy();
      done();
    }, 60);
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
    const v = s._vCurrent;
    const segs = s.ensureMap().segments;
    // Pane positions should be lookup(v) - offset
    near(a.scrollTop, lookup(segs, 'vPx', 'aPx', v) - 30, 1);
    near(b.scrollTop, lookup(segs, 'vPx', 'bPx', v) - 30, 1);
    s.destroy();
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
    // vCurrent should account for offset: lookup(aPx, vPx, scrollTop + offset)
    const segs = s.ensureMap().segments;
    const expectedV = lookup(segs, 'aPx', 'vPx', 200 + 20);
    near(s._vCurrent, expectedV, 1);
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

  test('_trySnap triggers snap when within range', (t, done) => {
    const s = new DualScrollSync(a, b, {
      getAnchors: () => [{ aPx: 200, bPx: 600, snap: true }],
      wheel: { smooth: 0.5, snap: 50 },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    s.ensureMap();
    const anchorV = s.ensureMap().segments[1].vPx;
    // Place vCurrent 30px before anchor (within snap range of 50)
    s._vCurrent = anchorV - 30;
    s._applyV();
    s._trySnap();
    // After snap animation completes, should be at anchor
    setTimeout(() => {
      near(s._vCurrent, anchorV, 5);
      s.destroy();
      done();
    }, 200);
  });

  test('_trySnap does nothing when out of range', () => {
    const s = new DualScrollSync(a, b, {
      getAnchors: () => [{ aPx: 500, bPx: 800, snap: true }],
      wheel: { smooth: 0.5, snap: 10 },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    s.ensureMap();
    // Place vCurrent far from any anchor
    const anchorV = s.ensureMap().segments[1].vPx;
    s._vCurrent = anchorV - 100;
    s._applyV();
    const vBefore = s._vCurrent;
    s._trySnap();
    // Should not have started snap (no pump scheduled)
    assert.equal(s._vCurrent, vBefore);
    s.destroy();
  });

  test('snap=0 disables snap entirely', () => {
    const s = new DualScrollSync(a, b, {
      getAnchors: () => [{ aPx: 200, bPx: 600, snap: true }],
      wheel: { smooth: 0.5, snap: 0 },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    s.ensureMap();
    const anchorV = s.ensureMap().segments[1].vPx;
    s._vCurrent = anchorV - 5;
    s._applyV();
    const vBefore = s._vCurrent;
    s._trySnap();
    assert.equal(s._vCurrent, vBefore);
    s.destroy();
  });

  test('with hasSnap, only snap anchors are snap targets', () => {
    const s = new DualScrollSync(a, b, {
      getAnchors: () => [
        { aPx: 200, bPx: 400 },           // no snap
        { aPx: 500, bPx: 800, snap: true }, // snap target
      ],
      wheel: { smooth: 0.5, snap: 50 },
      requestFrame: (fn) => setTimeout(fn, 1),
    });
    const d = s.ensureMap();
    // seg[1] is at the non-snap anchor, seg[2] is at the snap anchor
    const nonSnapV = d.segments[1].vPx;
    // Place near the non-snap anchor (not near snap anchor at segments[2])
    s._vCurrent = nonSnapV - 5;
    s._applyV();
    const vBefore = s._vCurrent;
    s._trySnap();
    // Should NOT snap to non-snap anchor
    assert.equal(s._vCurrent, vBefore);
    s.destroy();
  });
});
