/**
 * importProgress.js — the companion's structured import progress (AI-FEAT-064 EQI-2.1).
 * Shared by the single-event Event Dump view and the multi-event division. Renders main's import
 * view (companionImportService.view): stage, bytes, files, speed, time left, per-event rows, the
 * operator decision (busy archive folder) and the final summary. Text via textContent only.
 *
 * Copy completion is never shown as import completion: "Copying & verifying" → "Saving event
 * record" → "Writing metadata" are distinct stages, and an estimate is shown only while copying,
 * after enough measurements ("Calculating…" before; "Waiting…" / "Paused" when nothing moves).
 */

'use strict';

window.ImportProgress = (function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;

  /** Decimal units, one style everywhere: 950 KB, 48.2 MB, 10.6 GB. */
  function bytes(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)} GB`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)} MB`;
    if (v >= 1e3) return `${Math.round(v / 1e3)} KB`;
    return `${v} B`;
  }
  const speed = (bps) => `${(bps / 1e6).toFixed(bps >= 1e8 ? 0 : 1)} MB/s`;
  function duration(sec) {
    const s = Math.max(0, Math.round(sec));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  const STAGE = {
    preparing: 'Preparing',
    'waiting-decision': 'Waiting for your decision',
    copying: 'Copying & verifying',
    finalizing: 'Saving event record',
    metadata: 'Writing metadata',
  };
  const STATUS = { waiting: 'Waiting', copying: 'Copying', completed: 'Imported', 'completed-with-errors': 'Imported with errors', failed: 'Failed', 'not-started': 'Not started' };
  const META = { writing: 'writing metadata', complete: 'metadata written', 'needs-review': 'metadata needs review', 'some-failed': 'metadata failed for some files', 'not-run': 'metadata off', unconfirmed: 'metadata not confirmed — check Metadata Audit' };
  const SYNC = { queued: 'queued for archive sync', 'needs-attention': 'sync queued — needs attention', failed: 'sync not queued — open AutoIngest', queuing: 'queuing sync' };

  function eventLabel(folder) {
    const m = /^(\d{4}-\d{2}-\d{2} _\d+)-(.*)$/.exec(folder || '');
    return m ? `${m[1]} · ${m[2].split('-')[0]}` : (folder || '');
  }

  /** Writing-metadata progress across events (counts, never an estimate). */
  function metaCounts(op) {
    let done = 0, total = 0, writing = 0;
    for (const e of op.events) if (e.metadata && (e.metadata.state === 'writing' || e.metadata.total)) { done += e.metadata.done || 0; total += e.metadata.total || 0; if (e.metadata.state === 'writing') writing++; }
    return { done, total, writing };
  }

  function stageLine(op) {
    if (op.decision) return { label: 'Paused', detail: 'Waiting for your decision' };
    const t = op.totals;
    if (op.stage === 'copying') {
      const rate = op.stalled ? 'Waiting…' : op.calculating || !op.speedBps ? 'Calculating…' : speed(op.speedBps);
      const eta = op.etaSec != null && !op.stalled ? `About ${duration(op.etaSec)} left` : null;
      return { label: STAGE.copying, detail: [rate, eta].filter(Boolean).join(' · ') };
    }
    if (op.stage === 'metadata' || op.stage === 'finalizing') {
      const m = metaCounts(op);
      return { label: STAGE[op.stage], detail: m.total ? `${m.done.toLocaleString()} of ${m.total.toLocaleString()} files` : '' };
    }
    return { label: STAGE[op.stage] || 'Working', detail: t.totalBytes ? `${bytes(t.totalBytes)} to copy` : '' };
  }

  /** Stage track: Copy & verify → Event record → Metadata (→ Sync queued, Local First). */
  function track(op) {
    const order = ['copying', 'finalizing', 'metadata'];
    const cur = op.state !== 'pending' ? 3 : Math.max(0, order.indexOf(op.stage));
    const steps = [['Copy & verify', 0], ['Event record', 1], ['Metadata', 2]];
    if (op.mode === 'local-first') steps.push(['Sync queued', 3]);
    const ol = el('ol', 'ip-track');
    for (const [label, i] of steps) {
      const li = el('li', 'ip-step', label);
      li.dataset.state = op.state !== 'pending' ? 'done' : i < cur ? 'done' : i === cur ? 'active' : 'todo';
      ol.append(li);
    }
    return ol;
  }

  function eventRows(op) {
    const ul = el('ul', 'ip-events');
    ul.setAttribute('aria-label', 'Progress per event');
    op.events.forEach((e, i) => {
      const li = el('li', 'ip-event');
      li.dataset.status = e.status;
      if (i === op.current) li.dataset.current = 'yes';
      const b = e.bytes || {};
      const head = el('div', 'ip-event-head');
      head.append(el('span', 'ip-event-name', `${eventLabel(e.eventId)} · ${e.photographer}`), el('span', 'ip-event-status', STATUS[e.status] || e.status));
      head.title = e.eventId;
      const done = (b.copiedBytes || 0) + (b.skippedBytes || 0) + (b.failedBytes || 0);
      const bar = el('div', 'progress-track ip-mini');
      const fill = el('div', 'progress-bar');
      fill.style.width = `${b.totalBytes ? Math.min(100, Math.round((done / b.totalBytes) * 100)) : 0}%`;
      bar.append(fill);
      const parts = [`${bytes(b.copiedBytes || 0)} of ${bytes(b.totalBytes || 0)}`, `${(b.copied || 0).toLocaleString()} of ${plural(b.totalFiles || 0, 'file')}`];
      if (b.skipped) parts.push(`${b.skipped.toLocaleString()} skipped`);
      if (b.failed) parts.push(`${b.failed.toLocaleString()} failed`);
      if (e.metadata && META[e.metadata.state]) parts.push(e.metadata.state === 'writing' && e.metadata.total ? `metadata ${e.metadata.done || 0}/${e.metadata.total}` : META[e.metadata.state]);
      if (e.sync && SYNC[e.sync]) parts.push(SYNC[e.sync]);
      li.append(head, bar, el('p', 'ip-event-meta', parts.join(' · ')));
      if (e.error && (e.status === 'failed' || e.status === 'not-started')) li.append(el('p', 'ip-event-error', e.error === 'source-disconnected' ? 'The card was removed — nothing more was copied.' : e.error));
      ul.append(li);
    });
    return ul;
  }

  function decisionPanel(op, onDecide) {
    const d = op.decision;
    const box = el('div', 'ip-decision');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', 'Archive folder in use');
    const title = d.sameDevice ? 'Previous import lock found' : 'Archive folder in use';
    const body = d.sameDevice
      ? `${d.folders.join(', ')} ${d.folders.length === 1 ? 'is' : 'are'} locked by this computer (${d.device}), but no import is running here. The last import may have been interrupted.`
      : `${d.folders.join(', ')} ${d.folders.length === 1 ? 'is' : 'are'} being written by ${d.device || 'another computer'}. Wait until it finishes, then check again.`;
    box.append(el('p', 'ip-decision-title', title), el('p', 'ip-decision-body', body));
    if (op.detail === 'lock-still-active') box.append(el('p', 'ip-decision-note', 'The lock was renewed too recently to clear safely — a sync may still be running on this computer. Try again in a minute.'));
    else if (op.detail === 'lock-not-cleared') box.append(el('p', 'ip-decision-note', 'The lock could not be cleared. Check Again, or open AutoIngest to look at the archive.'));
    const row = el('div', 'ip-decision-actions');
    const btn = (label, cls, choice) => { const b = el('button', `btn ${cls}`, label); b.type = 'button'; b.addEventListener('click', () => { b.disabled = true; onDecide(choice); }); return b; };
    row.append(btn('Cancel Import', 'btn-quiet', 'cancel'), btn('Check Again', 'btn-secondary', 'recheck'));
    if (d.sameDevice) row.append(btn('Clear Lock & Continue', 'btn-primary', 'clear'));
    box.append(row);
    return box;
  }

  function summary(op) {
    const t = op.totals;
    const head = op.state === 'completed' ? 'Import complete'
      : op.state === 'completed-with-errors' ? 'Imported — some files need attention'
      : op.state === 'partial' ? 'Import partly complete'
      : op.state === 'refused' ? 'Import not started' : 'Import did not complete';
    const lines = [];
    if (op.state !== 'refused') {
      lines.push(`${plural(t.files.copied, 'file')} (${bytes(t.copiedBytes)}) copied and verified`);
      if (t.files.skipped) lines.push(`${t.files.skipped.toLocaleString()} already there — skipped`);
      if (t.files.failed) lines.push(`${t.files.failed.toLocaleString()} failed — still on the card`);
      const metaFailed = op.events.some(e => e.metadata && e.metadata.state === 'some-failed');
      const metaReview = op.events.some(e => e.metadata && e.metadata.state === 'needs-review');
      const metaOff = op.events.some(e => e.metadata && e.metadata.state === 'not-run');
      const metaUnconfirmed = op.events.some(e => e.metadata && e.metadata.state === 'unconfirmed');
      lines.push(metaFailed ? 'Metadata failed for some files — see Metadata Audit' : metaUnconfirmed ? 'Metadata not confirmed — check Metadata Audit' : metaReview ? 'Metadata written; some files need review' : metaOff ? 'Metadata not written (automatic metadata is off)' : t.files.copied ? 'Metadata written' : '');
      if (op.mode === 'local-first' && t.files.copied) lines.push('Staged locally and queued for archive sync');
    }
    const box = el('div', 'ip-summary');
    box.dataset.state = op.state;
    box.append(el('p', 'ip-summary-title', head), el('p', 'ip-summary-body', lines.filter(Boolean).join(' · ')));
    return box;
  }

  /**
   * @param {HTMLElement} host
   * @param {object|null} op    main's import view (or null)
   * @param {{ onDecide: (choice: string) => void, showEvents?: boolean }} opts
   */
  function render(host, op, opts) {
    host.replaceChildren();
    host.hidden = !op || op.state === 'refused';
    if (host.hidden) return;
    host.dataset.state = op.state;
    if (op.state !== 'pending') {
      host.append(summary(op));
      if (opts.showEvents && op.events.length > 1) host.append(eventRows(op));
      return;
    }
    const t = op.totals;
    const pct = t.totalBytes ? Math.min(100, Math.floor((t.processedBytes / t.totalBytes) * 100)) : 0;
    const cur = op.current >= 0 ? op.events[op.current] : null;
    const s = stageLine(op);
    const top = el('div', 'ip-top');
    const stage = el('span', 'ip-stage', s.label);
    stage.dataset.stage = op.decision ? 'paused' : op.stage;
    const count = op.events.length > 1 && op.current >= 0 ? el('span', 'ip-of', `Event ${op.current + 1} of ${op.events.length}`) : null;
    const pctEl = el('span', 'ip-pct', op.stage === 'copying' || op.stage === 'preparing' || op.decision ? `${pct}%` : '');
    top.append(stage, ...(count ? [count] : []), pctEl);
    host.append(top);
    if (cur) host.append(el('p', 'ip-what', `${eventLabel(cur.eventId)} · ${cur.photographer}`));
    const bar = el('div', 'progress-track ip-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-label', 'Import progress');
    const fill = el('div', 'progress-bar');
    fill.style.width = `${op.stage === 'metadata' || op.stage === 'finalizing' ? 100 : pct}%`;
    bar.append(fill);
    host.append(bar);
    const stats = el('p', 'ip-stats');
    stats.append(el('strong', null, `${bytes(t.transferredBytes)} of ${bytes(t.totalBytes)}`),
      document.createTextNode(` · ${(t.files.copied).toLocaleString()} of ${plural(t.files.total, 'file')} verified`
        + (t.files.skipped ? ` · ${t.files.skipped.toLocaleString()} skipped` : '') + (t.files.failed ? ` · ${t.files.failed.toLocaleString()} failed` : '')));
    host.append(stats);
    if (s.detail) host.append(el('p', 'ip-rate', s.detail));
    host.append(track(op));
    if (op.decision) host.append(decisionPanel(op, opts.onDecide));
    if (opts.showEvents && op.events.length > 1) host.append(eventRows(op));
  }

  return { render, bytes };
}());
