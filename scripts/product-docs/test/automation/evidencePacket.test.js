#!/usr/bin/env node
'use strict';

// Tests evidencePacket's schema validation and journal-then-snapshot
// persistence. Writes ONLY under the real repo's .autoingest-docs/ (never
// docs/product/) and cleans up every session it creates. Run with:
// node scripts/product-docs/test/automation/evidencePacket.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const { createRunner } = require('../testHarness');
const evidencePacket = require('../../automation/evidencePacket');
const { PENDING_DIR, COMPLETED_DIR, FAILED_DIR } = require('../../automation/paths');

const createdSessionIds = [];

function cleanupSession(id) {
  for (const dir of [PENDING_DIR, COMPLETED_DIR, FAILED_DIR]) {
    const p = evidencePacket.packetPath(id, dir);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const j = evidencePacket.journalPath(id);
  if (fs.existsSync(j)) fs.unlinkSync(j);
}

async function main() {
  const { t, summarize } = createRunner();

  await t('createPacket requires a valid task_type', () => {
    assert.throws(() => evidencePacket.createPacket({ taskType: 'not-a-real-type', taskTitle: 'x' }));
  });

  await t('createPacket requires a task_title', () => {
    assert.throws(() => evidencePacket.createPacket({ taskType: 'feature' }));
  });

  await t('createPacket never invents task_summary/user_request_summary — defaults to the literal evidence-pending phrase', () => {
    const p = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'x' });
    assert.equal(p.task_summary, 'Evidence pending — not yet documented as fact.');
    assert.equal(p.user_request_summary, 'Evidence pending — not yet documented as fact.');
    createdSessionIds.push(p.session_id);
  });

  await t('validatePacket rejects a packet missing a required field', () => {
    const p = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'x' });
    createdSessionIds.push(p.session_id);
    delete p.branch;
    const { valid, errors } = evidencePacket.validatePacket(p);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('branch')));
  });

  await t('validatePacket rejects an invalid automation_status', () => {
    const p = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'x' });
    createdSessionIds.push(p.session_id);
    p.automation_status = 'not-a-real-status';
    const { valid } = evidencePacket.validatePacket(p);
    assert.equal(valid, false);
  });

  await t('persist writes a journal entry AND an atomic snapshot; loadPacket round-trips', () => {
    const p = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'Round Trip Test' });
    createdSessionIds.push(p.session_id);
    evidencePacket.persist(p, { event: 'start' });
    assert.ok(fs.existsSync(evidencePacket.journalPath(p.session_id)));
    const journalLines = fs.readFileSync(evidencePacket.journalPath(p.session_id), 'utf8').trim().split('\n');
    assert.equal(journalLines.length, 1);
    assert.equal(JSON.parse(journalLines[0]).event, 'start');

    const found = evidencePacket.loadPacket(p.session_id);
    assert.ok(found);
    assert.equal(found.packet.task_title, 'Round Trip Test');
    assert.equal(found.dir, PENDING_DIR);
  });

  await t('persist appends a NEW journal line on every call — never overwrites journal history', () => {
    const p = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'Journal Growth Test' });
    createdSessionIds.push(p.session_id);
    evidencePacket.persist(p, { event: 'start' });
    p.task_summary = 'updated';
    evidencePacket.persist(p, { event: 'update' });
    p.task_summary = 'updated again';
    evidencePacket.persist(p, { event: 'update' });
    const lines = fs.readFileSync(evidencePacket.journalPath(p.session_id), 'utf8').trim().split('\n');
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((l) => JSON.parse(l).event), ['start', 'update', 'update']);
  });

  await t('persist redacts an obvious secret before writing the snapshot to disk', () => {
    const p = evidencePacket.createPacket({ taskType: 'investigation', taskTitle: 'Secret Test' });
    createdSessionIds.push(p.session_id);
    p.task_summary = 'found token=ghp_1234567890abcdefghijklmnopqrstuvwxyz in a log';
    evidencePacket.persist(p, { event: 'update' });
    const onDisk = fs.readFileSync(evidencePacket.packetPath(p.session_id, PENDING_DIR), 'utf8');
    assert.ok(!onDisk.includes('ghp_1234567890abcdefghijklmnopqrstuvwxyz'));
    assert.ok(onDisk.includes('[REDACTED]'));
  });

  await t('persist refuses to write a structurally invalid packet', () => {
    const p = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'Invalid Test' });
    createdSessionIds.push(p.session_id);
    p.automation_status = 'garbage-status';
    assert.throws(() => evidencePacket.persist(p));
  });

  await t('moveToTerminal removes the pending copy only after the terminal copy is written', () => {
    const p = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'Terminal Move Test' });
    createdSessionIds.push(p.session_id);
    evidencePacket.persist(p, { event: 'start' });
    p.automation_status = 'completed';
    evidencePacket.moveToTerminal(p, 'completed');
    assert.ok(!fs.existsSync(evidencePacket.packetPath(p.session_id, PENDING_DIR)));
    assert.ok(fs.existsSync(evidencePacket.packetPath(p.session_id, COMPLETED_DIR)));
    const found = evidencePacket.loadPacket(p.session_id);
    assert.equal(found.dir, COMPLETED_DIR);
  });

  await t('listPending lists only sessions currently in pending/', () => {
    const p1 = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'Pending One' });
    createdSessionIds.push(p1.session_id);
    evidencePacket.persist(p1, { event: 'start' });
    const before = evidencePacket.listPending().length;

    const p2 = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'Pending Two Then Completed' });
    createdSessionIds.push(p2.session_id);
    evidencePacket.persist(p2, { event: 'start' });
    assert.equal(evidencePacket.listPending().length, before + 1);
    p2.automation_status = 'completed';
    evidencePacket.moveToTerminal(p2, 'completed');
    assert.equal(evidencePacket.listPending().length, before, 'a completed session must disappear from listPending()');
  });

  summarize('evidencePacket.test.js');
  for (const id of createdSessionIds) cleanupSession(id);
}

main();
