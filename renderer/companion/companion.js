/**
 * companion.js — renderer for the menu-bar/tray companion popup (AI-FEAT-061 Q1).
 * Renders the snapshot pushed by main; never computes status of its own.
 * Text is set with textContent only.
 */

'use strict';

(function () {
  const api = window.companion;
  const heading = document.getElementById('status-heading');
  const empty = document.getElementById('empty-state');
  const list = document.getElementById('card-list');
  const rowTemplate = document.getElementById('card-row');

  function headingText(count) {
    if (count === 0) return 'No card connected';
    return count === 1 ? '1 card connected' : `${count} cards connected`;
  }

  function render(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.sources)) return;
    const sources = snapshot.sources;
    heading.textContent = headingText(sources.length);
    empty.hidden = sources.length !== 0;
    list.hidden = sources.length === 0;

    const rows = sources.map((src) => {
      const row = rowTemplate.content.firstElementChild.cloneNode(true);
      row.dataset.sourceId = src.sourceId;
      row.querySelector('.card-label').textContent = src.label;
      row.querySelector('.card-disambiguator').textContent = src.labelCollision && src.disambiguator ? src.disambiguator : '';
      return row;
    });
    list.replaceChildren(...rows);
  }

  document.getElementById('open-btn').addEventListener('click', () => api.openAutoIngest());
  document.getElementById('quit-btn').addEventListener('click', () => api.quit());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.hide(); });

  api.onSnapshot(render);
  api.getSnapshot().then(render);
  document.getElementById('open-btn').focus();
}());
