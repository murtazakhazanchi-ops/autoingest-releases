'use strict';

// Centralized date engine for AutoIngest.
// All date logic lives here; the renderer accesses it exclusively via IPC (window.api.*).
//
// External API contract (month always 1-indexed):
//   getToday()          → { gregorian: { iso, display }, hijri: { year, month, day, iso, display } }
//   convertToHijri(iso) → { year, month, day, iso, display }   (month 1-indexed)
//   convertToGregorian({ year, month, day }) → { iso, display }  (month in = 1-indexed)
//   getHijriCalendar(year, month) → { cells, todayISO }   (month in = 1-indexed)

const {
    hijriFromGregorian,
    hijriToGregorian,
    formatISODate,
    HIJRI_MONTH_NAMES_SHORT,
    buildCalendarCells,
} = require('./hijriCore');

// Set to noon to prevent timezone-boundary drift during conversions
function normalizeDate(date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d;
}

// ── Canonical formatters (single source of truth) ─────────────────────────────

// date = JS Date object
function formatGregorianDisplay(date) {
    return date.toLocaleDateString('en-GB', {
        weekday: 'long',
        day:     'numeric',
        month:   'long',
        year:    'numeric',
    });
}

// h = hijriCore object with 0-indexed month
function formatHijriDisplay(h) {
    return `${String(h.day).padStart(2, '0')} ${HIJRI_MONTH_NAMES_SHORT[h.month]} ${h.year} AH`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _hijriApiObj(h) {
    const month1 = h.month + 1;  // 0-indexed → 1-indexed for all external callers
    return {
        year:    h.year,
        month:   month1,
        day:     h.day,
        iso:     `${h.year}-${String(month1).padStart(2,'0')}-${String(h.day).padStart(2,'0')}`,
        display: formatHijriDisplay(h),
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

function getToday() {
    const now = normalizeDate(new Date());
    return {
        gregorian: { iso: formatISODate(now), display: formatGregorianDisplay(now) },
        hijri:     _hijriApiObj(hijriFromGregorian(now)),
    };
}

// gregorianDateStr = "YYYY-MM-DD"
function convertToHijri(gregorianDateStr) {
    const [y, m, d] = gregorianDateStr.split('-').map(Number);
    const date = normalizeDate(new Date(y, m - 1, d));
    return _hijriApiObj(hijriFromGregorian(date));
}

// hijri.month is 1-indexed
function convertToGregorian(hijri) {
    const date = normalizeDate(hijriToGregorian({ year: hijri.year, month: hijri.month - 1, day: hijri.day }));
    return { iso: formatISODate(date), display: formatGregorianDisplay(date) };
}

// month is 1-indexed externally; converted to 0-indexed for hijriCore
function getHijriCalendar(year, month) {
    return buildCalendarCells(year, month - 1);
}

module.exports = {
    getToday,
    convertToHijri,
    convertToGregorian,
    getHijriCalendar,
    normalizeDate,
    formatGregorianDisplay,
    formatHijriDisplay,
};
