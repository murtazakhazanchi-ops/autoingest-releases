'use strict';

/**
 * metadataVerificationService.js — read-only compliance check for files that were
 * copied/skipped outside the normal applyBatch write path (Transfer Import,
 * same-size-skip). Resolves + compares only — never writes. A caller that wants
 * non-compliant files fixed queues them through exifService.applyBatch separately,
 * which gets full manifest+journal durability for free.
 */

const fsp = require('fs/promises');
const exifService = require('./exifService');
const { resolveExpectedMetadata } = require('../services/metadataExpectationService');

/**
 * @param {Array<{src:string, dest:string, photographer?:string|null}>} files
 * @param {object} context Same evidence shape exifService.applyBatch consumes
 *   ({photographer,hijriDate,eventDescription,groups,diskComponents} or the QMZ shape).
 * @returns {Promise<Array<{
 *   dest:string, status:'complete'|'incomplete'|'ambiguous'|'excluded'|'read-error',
 *   mismatches?:string[], expectation?:object, error?:string,
 * }>>}
 */
async function verifyFiles(files, context) {
  const results = [];
  for (const file of files) {
    const { isVideo, isRaw, verifyPath } = exifService.classifyForVerification(file.dest);
    if (isVideo) { results.push({ dest: file.dest, status: 'excluded' }); continue; }

    const evidence = exifService.buildEvidence(file, context);
    const expectation = resolveExpectedMetadata(evidence);
    if (expectation.status === 'ambiguous') {
      results.push({ dest: file.dest, status: 'ambiguous', expectation });
      continue;
    }

    let exists = true;
    try { await fsp.access(verifyPath); } catch { exists = false; }
    if (!exists) {
      results.push({ dest: file.dest, status: 'incomplete', expectation, mismatches: ['not-yet-tagged'] });
      continue;
    }

    let actual;
    try {
      actual = await exifService.readFileTags(verifyPath);
    } catch (err) {
      results.push({ dest: file.dest, status: 'read-error', expectation, error: err.message });
      continue;
    }

    const cmp = exifService.compareReadback(actual, expectation, isRaw);
    results.push({
      dest: file.dest,
      status: cmp.complete ? 'complete' : 'incomplete',
      expectation,
      mismatches: cmp.complete ? [] : cmp.mismatches,
    });
  }
  return results;
}

module.exports = { verifyFiles };
