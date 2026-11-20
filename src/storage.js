'use strict';

const fs = require('fs');
const path = require('path');

// Persists the state of every checker in a single JSON file: { [checkerName]: record }.
// The file is read once at creation; writes are serialized and atomic (temp file + rename),
// so a crash mid-write never leaves a truncated file behind.
function createFileStore(filePath) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Refuse to start rather than silently overwrite a file we cannot read.
      throw new Error(`Cannot load state file ${filePath}: ${err.message}`);
    }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Cannot load state file ${filePath}: expected a JSON object`);
  }

  let writeChain = Promise.resolve();

  async function persist() {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2));
    await fs.promises.rename(tempPath, filePath);
  }

  return {
    async get(key) {
      return data[key];
    },
    async getAll() {
      return { ...data };
    },
    set(key, value) {
      data[key] = value;
      const result = writeChain.then(persist);
      // Keep the chain alive after a failed write so later writes still run.
      writeChain = result.catch(() => {});
      return result;
    }
  };
}

module.exports = { createFileStore };
