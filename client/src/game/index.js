// Test entry: makes `node --test client/src/game/` work on Node builds
// without directory scanning — importing this file registers all tests.
import "./grid.test.js";
import "./pathfind.test.js";
import "./camera.test.js";
import "./selection.test.js";
import "./units.test.js";
