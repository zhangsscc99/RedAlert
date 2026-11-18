// src/game/radar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/radar.ts
function createRadar(opts) {
  return {
    radius: opts.radius,
    sweepSeconds: opts.sweepSeconds,
    contactTtl: opts.contactTtl,
    cx: opts.cx ?? 0,
    cy: opts.cy ?? 0,
    phase: 0,
    time: 0,
    contacts: /* @__PURE__ */ new Map()
  };
}
function radarAvailable(powered, built) {
  return powered && built;
}
function stepRadar(radar, dt, units, viewerTeam) {
  radar.time += dt;
  const result = { added: [], expired: [] };
  radar.phase += dt / radar.sweepSeconds;
  while (radar.phase >= 1) {
    radar.phase -= 1;
    const r2 = radar.radius * radar.radius;
    for (const u of units) {
      if (u.team === viewerTeam) continue;
      const dx = u.x - radar.cx;
      const dy = u.y - radar.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const existing = radar.contacts.get(u.id);
      if (existing) {
        existing.x = u.x;
        existing.y = u.y;
        existing.kind = u.kind;
        existing.stamp = radar.time;
      } else {
        const c = { id: u.id, x: u.x, y: u.y, kind: u.kind, stamp: radar.time };
        radar.contacts.set(u.id, c);
        result.added.push(c);
      }
    }
  }
  for (const [id, c] of radar.contacts) {
    if (radar.time - c.stamp >= radar.contactTtl) {
      radar.contacts.delete(id);
      result.expired.push(id);
    }
  }
  return result;
}
function contactAge(radar, contact) {
  return radar.time - contact.stamp;
}
function contactsIn(radar, rect) {
  const out = [];
  for (const c of radar.contacts.values()) {
    if (c.x >= rect.x && c.x <= rect.x + rect.w && c.y >= rect.y && c.y <= rect.y + rect.h) {
      out.push(c);
    }
  }
  return out;
}

// src/game/radar.test.ts
function unit(id, x, y, team, kind = "tank") {
  return { id, x, y, team, kind };
}
test("phase advances with dt and wraps once per sweep", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 4, contactTtl: 10 });
  stepRadar(r, 1, [], "player");
  assert.equal(r.phase, 0.25);
  stepRadar(r, 1, [], "player");
  assert.equal(r.phase, 0.5);
  stepRadar(r, 2.5, [], "player");
  assert.ok(Math.abs(r.phase - 0.125) < 1e-9);
});
test("enemy inside radius becomes a contact at sweep end; friendlies ignored", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 2, contactTtl: 10 });
  const units = [unit(1, 50, 0, "enemy"), unit(2, 10, 0, "player"), unit(3, 150, 0, "enemy")];
  let res = stepRadar(r, 1, units, "player");
  assert.equal(res.added.length, 0);
  res = stepRadar(r, 1, units, "player");
  assert.deepEqual(res.added.map((c) => c.id), [1]);
  assert.equal(res.added[0].kind, "tank");
  assert.equal(r.contacts.size, 1);
});
test("re-ping refreshes stamp instead of adding a duplicate", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  const units = [unit(1, 20, 0, "enemy")];
  stepRadar(r, 1, units, "player");
  const res = stepRadar(r, 1, units, "player");
  assert.equal(res.added.length, 0);
  assert.equal(r.contacts.size, 1);
  assert.equal(r.contacts.get(1).stamp, r.time);
  units[0] = unit(1, 30, 40, "enemy");
  stepRadar(r, 1, units, "player");
  assert.equal(r.contacts.get(1).x, 30);
});
test("contacts expire after contactTtl without a re-ping", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 2 });
  stepRadar(r, 1, [unit(1, 10, 0, "enemy")], "player");
  assert.equal(r.contacts.size, 1);
  let res = stepRadar(r, 1, [], "player");
  assert.deepEqual(res.expired, []);
  res = stepRadar(r, 1, [], "player");
  assert.deepEqual(res.expired, [1]);
  assert.equal(r.contacts.size, 0);
});
test("radarAvailable requires power and a built radar", () => {
  assert.equal(radarAvailable(true, true), true);
  assert.equal(radarAvailable(false, true), false);
  assert.equal(radarAvailable(true, false), false);
  assert.equal(radarAvailable(false, false), false);
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  if (radarAvailable(false, true)) {
    stepRadar(r, 5, [unit(1, 10, 0, "enemy")], "player");
  }
  assert.equal(r.contacts.size, 0);
});
test("contactAge reports seconds since last ping", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  const res = stepRadar(r, 1, [unit(1, 10, 0, "enemy")], "player");
  assert.equal(contactAge(r, res.added[0]), 0);
  stepRadar(r, 0.5, [], "player");
  assert.equal(contactAge(r, res.added[0]), 0.5);
});
test("contactsIn returns only contacts inside the rect", () => {
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10 });
  stepRadar(r, 1, [unit(1, 10, 10, "enemy"), unit(2, 100, 100, "enemy")], "player");
  const inRect = contactsIn(r, { x: 0, y: 0, w: 50, h: 50 });
  assert.deepEqual(inRect.map((c) => c.id), [1]);
  assert.equal(contactsIn(r, { x: 0, y: 0, w: 200, h: 200 }).length, 2);
});
