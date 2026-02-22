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
    const { segments, vTotal, snapVs, droppedCount } = buildMap([], 1000, 2000);
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0], { aPx: 0, bPx: 0, vPx: 0, aS: 1000, bS: 2000, vS: 2000 });
    assert.equal(vTotal, 2000);
    assert.deepEqual(snapVs, []);
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

  test('snap anchors collected in snapVs', () => {
    const { snapVs } = buildMap([
      { aPx: 200, bPx: 200, snap: true },
      { aPx: 500, bPx: 500 },
      { aPx: 800, bPx: 800, snap: true },
    ], 1000, 1000);
    assert.equal(snapVs.length, 2);
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
      { aPx: 200, bPx: 600, snap: true },
      { aPx: 500, bPx: 800, snap: true },
    ],
    dampZonePx: 0,
    snapRangePx: 0,
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
      dampZonePx: 0, snapRangePx: 0,
    });
    const d = s.ensureMap();
    assert.deepEqual(d.segments, []);
    assert.equal(d.vTotal, 0);
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

  test('damping reduces effective delta near snap anchor', () => {
    const s = makeSync(a, b, { dampZonePx: 80, dampMin: 0.15 });
    s.ensureMap();
    const snapV = s.ensureMap().snapVs[0];
    s._vCurrent = snapV - s.snapOffsetPx - 10; // 10px from landing
    const vBefore = s._vCurrent;
    a._fire('wheel', wheelEvent(100));
    const moved = s._vCurrent - vBefore;
    assert.ok(moved > 0, 'should move forward');
    assert.ok(moved < 100, `expected damped < 100, got ${moved}`);
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
});
