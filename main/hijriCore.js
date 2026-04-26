'use strict';

// Hijri (Islamic) calendar conversion utilities.
// Ported from hijriDate.ts (mumineen_calendar_js by mygulamali, MIT License).
// All months are 0-indexed internally (0=Moharram … 11=Zilhaj).
// Callers that need 1-indexed months must convert at the boundary (see dateEngine.js).

const KABISA_YEAR_REMAINDERS = [2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29];

// Cumulative days in a Hijri year per month (0-indexed, 11 entries for months 0–10)
const DAYS_IN_YEAR = [30, 59, 89, 118, 148, 177, 207, 236, 266, 295, 325];

// Cumulative days in each 30-year Hijri cycle (30 entries)
const DAYS_IN_30_YEARS = [
     354,  708, 1063, 1417, 1771, 2126, 2480, 2834,  3189,  3543,
    3898, 4252, 4606, 4961, 5315, 5669, 6024, 6378,  6732,  7087,
    7441, 7796, 8150, 8504, 8859, 9213, 9567, 9922, 10276, 10631,
];

const HIJRI_MONTH_NAMES_SHORT = [
    'Moharram', 'Safar', 'Rabi I', 'Rabi II',
    'Jumada I', 'Jumada II', 'Rajab', "Sha'baan",
    'Ramadaan', 'Shawwal', 'Zilqadah', 'Zilhaj',
];

const HIJRI_MONTH_NAMES_LONG = [
    'Moharram al-Haraam', 'Safar al-Muzaffar', "Rabi' al-Awwal", "Rabi' al-Aakhar",
    'Jumada al-Ula', 'Jumada al-Ukhra', 'Rajab al-Asab', "Sha'baan al-Karim",
    'Ramadaan al-Moazzam', 'Shawwal al-Mukarram', 'Zilqadah al-Haraam', 'Zilhaj al-Haraam',
];

// ── Internal helpers ──────────────────────────────────────────────────────────

function isKabisa(year) {
    return KABISA_YEAR_REMAINDERS.some((r) => year % 30 === r);
}

function dayOfHijriYear(month, day) {
    return month === 0 ? day : DAYS_IN_YEAR[month - 1] + day;
}

function gregorianToAJD(date) {
    let year  = date.getFullYear();
    let month = date.getMonth() + 1;
    const day = date.getDate();

    if (month < 3) { year--; month += 12; }

    let b;
    if (year < 1582 || (year === 1582 && month < 10) || (year === 1582 && month === 10 && day < 15)) {
        b = 0;
    } else {
        const a = Math.floor(year / 100);
        b = 2 - a + Math.floor(a / 4);
    }

    return (
        Math.floor(365.25 * (year + 4716)) +
        Math.floor(30.6001 * (month + 1)) +
        day + b - 1524.5
    );
}

function ajdToGregorian(ajd) {
    const z = Math.floor(ajd + 0.5);
    const f = ajd + 0.5 - z;

    let a;
    if (z < 2299161) {
        a = z;
    } else {
        const alpha = Math.floor((z - 1867216.25) / 36524.25);
        a = z + 1 + alpha - Math.floor(0.25 * alpha);
    }

    const b = a + 1524;
    const c = Math.floor((b - 122.1) / 365.25);
    const d = Math.floor(365.25 * c);
    const e = Math.floor((b - d) / 30.6001);

    const dayFrac = b - d - Math.floor(30.6001 * e) + f;
    const day     = Math.floor(dayFrac);
    const month   = e < 14 ? e - 2 : e - 14;
    const year    = month < 2 ? c - 4715 : c - 4716;

    return new Date(year, month, day);
}

// ── Public API ────────────────────────────────────────────────────────────────

function isHijriKabisa(year) { return isKabisa(year); }

function daysInHijriMonth(year, month) {
    return ((month === 11) && isKabisa(year)) || month % 2 === 0 ? 30 : 29;
}

function hijriFromGregorian(date) {
    const ajd = gregorianToAJD(date);
    let left   = Math.floor(ajd - 1948083.5);

    const y30 = Math.floor(left / 10631.0);
    left -= y30 * 10631;

    let i = 0;
    while (i < DAYS_IN_30_YEARS.length && left > DAYS_IN_30_YEARS[i]) i++;

    const year = Math.floor(y30 * 30.0 + i);
    if (i > 0) left -= DAYS_IN_30_YEARS[i - 1];

    i = 0;
    while (i < DAYS_IN_YEAR.length && left > DAYS_IN_YEAR[i]) i++;

    const month = Math.floor(i);
    const day   = i > 0 ? Math.floor(left - DAYS_IN_YEAR[i - 1]) : Math.floor(left);

    return { year, month, day };
}

function hijriToGregorian(hd) {
    const y30 = Math.floor(hd.year / 30.0);
    let ajd = 1948083.5 + y30 * 10631 + dayOfHijriYear(hd.month, hd.day);
    if (hd.year % 30 !== 0) ajd += DAYS_IN_30_YEARS[hd.year - y30 * 30 - 1];
    return ajdToGregorian(ajd);
}

function formatISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function prevHijriMonth(year, month) {
    return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
}

function nextHijriMonth(year, month) {
    return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
}

const GREG_MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function gregSubtitle(hYear, hMonth) {
    const firstGreg = hijriToGregorian({ year: hYear, month: hMonth, day: 1 });
    const lastGreg  = hijriToGregorian({ year: hYear, month: hMonth, day: daysInHijriMonth(hYear, hMonth) });
    const fm = firstGreg.getMonth(), fy = firstGreg.getFullYear();
    const lm = lastGreg.getMonth(),  ly = lastGreg.getFullYear();
    if (fm === lm && fy === ly) return `${GREG_MONTHS_SHORT[fm]} ${fy}`;
    if (fy === ly) return `${GREG_MONTHS_SHORT[fm]} – ${GREG_MONTHS_SHORT[lm]} ${fy}`;
    return `${GREG_MONTHS_SHORT[fm]} ${fy} – ${GREG_MONTHS_SHORT[lm]} ${ly}`;
}

function buildCalendarCells(hYear, hMonth) {
    const totalDays   = daysInHijriMonth(hYear, hMonth);
    const firstGreg   = hijriToGregorian({ year: hYear, month: hMonth, day: 1 });
    const startOffset = firstGreg.getDay();
    const todayISO    = formatISODate(new Date());
    const cells       = [];
    for (let i = 0; i < startOffset; i++) cells.push({ type: 'empty', key: `e${i}` });
    for (let d = 1; d <= totalDays; d++) {
        const greg = hijriToGregorian({ year: hYear, month: hMonth, day: d });
        cells.push({ type: 'day', hijriDay: d, isoDate: formatISODate(greg), gregDay: greg.getDate() });
    }
    return { cells, todayISO };
}

module.exports = {
    HIJRI_MONTH_NAMES_SHORT,
    HIJRI_MONTH_NAMES_LONG,
    isHijriKabisa,
    daysInHijriMonth,
    hijriFromGregorian,
    hijriToGregorian,
    formatISODate,
    prevHijriMonth,
    nextHijriMonth,
    gregSubtitle,
    buildCalendarCells,
};
