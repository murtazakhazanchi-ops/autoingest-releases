'use strict';

const { parentPort } = require('worker_threads');
const fs = require('fs');

parentPort.on('message', ({ id, srcPath }) => {
  try {
    const buffer = fs.readFileSync(srcPath);
    parentPort.postMessage({ id, ok: true, buffer });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
