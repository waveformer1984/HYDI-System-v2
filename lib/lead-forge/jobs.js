'use strict';

const { randomUUID } = require('crypto');
const path = require('path');
const { buildLeadPack } = require('../../lead-forge/lib/pack');
const { importPack } = require('../importPack');
const { getPool } = require('./db');

/** @type {Map<string, object>} */
const jobs = new Map();

function createJob(request) {
  const id = randomUUID();
  const job = {
    id,
    status: 'queued',
    request,
    packId: null,
    boardWarning: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function patchJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

async function runPackJob(jobId, deps = {}) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'queued') return job;
  patchJob(jobId, { status: 'running' });
  try {
    const pack = await (deps.buildLeadPack || buildLeadPack)(job.request, deps.packDeps || {});
    const pool = deps.pool || getPool();
    if (pool) {
      await (deps.importPack || importPack)(pack.id, { pool, packRoot: deps.packRoot });
    }
    return patchJob(jobId, {
      status: 'completed',
      packId: pack.id,
      boardWarning: pack.boardWarning || null,
    });
  } catch (error) {
    return patchJob(jobId, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'pack job failed',
    });
  }
}

function schedulePackJob(jobId, deps = {}) {
  setImmediate(() => {
    runPackJob(jobId, deps).catch((error) => {
      patchJob(jobId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'pack job failed',
      });
    });
  });
}

function resetJobsForTests() {
  jobs.clear();
}

module.exports = {
  createJob,
  getJob,
  patchJob,
  runPackJob,
  schedulePackJob,
  resetJobsForTests,
  DEFAULT_PACK_ROOT: path.join(__dirname, '..', '..', 'lead-forge', 'packs'),
};