// CommonJS loader for G.722 native addon
// This file uses .cjs extension to ensure it's treated as CommonJS

let g722_addon = null;
let g722LoadError = null;

try {
  // Try to load the G.722 native addon
  g722_addon = require('../../build/Release/g722.node');
} catch (error) {
  g722LoadError = error.message;
}

module.exports = {
  g722_addon,
  g722LoadError,
  isAvailable: () => g722_addon !== null && g722_addon.g722Enabled,
  getUnavailableReason: () => {
    if (g722_addon !== null && g722_addon.g722Enabled) {
      return null;
    }
    return g722LoadError || 'G.722 codec not compiled in';
  }
};