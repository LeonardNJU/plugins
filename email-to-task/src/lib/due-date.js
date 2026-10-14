// Finds a due date in a message: "by Friday", "until 2026-10-20",
// "bis zum 20.10.", "spätestens Freitag", "due end of month", ...
//
// Only dates that follow a deadline word count (by, until, due, deadline,
// bis, spätestens, fällig, Frist, ...). A message mentions plenty of dates
// that are not deadlines (when it was sent, a meeting, an old reply), so a
// date on its own is ignored. Relative dates ("Friday", "tomorrow", "in 3
// days") are counted from when the message arrived, not from today: "by
// Friday" in last week's mail means last week's Friday.

const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';

const TRIGGERS = [
  'no later than', 'not later than', 'at the latest by', 'deadline', 'until', 'till', 'due', 'before', 'within', 'by',
  'bis spätestens', 'spätestens', 'fällig', 'frist', 'innerhalb von', 'innerhalb', 'binnen', 'bis',
];

// Words that may sit between the deadline word and the date.
const FILLER = /^(?:(?:the|this|coming|on|at|by|until|am|zum|zur|zu|dem|den|diesen|diesem|dieser|kommenden|kommender|kommendem|spätestens|bis|latest|date)\s*:?\s+)*/iu;

const MONTHS = {
  january: 1, jan: 1, januar: 1, jänner: 1, jaenner: 1,
  february: 2, feb: 2, februar: 2,
  march: 3, mar: 3, märz: 3, maerz: 3, mär: 3, mrz: 3,
  april: 4, apr: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juni: 6,
  july: 7, jul: 7, juli: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, oktober: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, dec: 12, dezember: 12, dez: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

// 0 = Sunday, as Date#getDay.
const WEEKDAYS = {
  sunday: 0, sonntag: 0,
  monday: 1, montag: 1,
  tuesday: 2, dienstag: 2,
  wednesday: 3, mittwoch: 3,
  thursday: 4, donnerstag: 4,
  friday: 5, freitag: 5,
  saturday: 6, samstag: 6, sonnabend: 6,
};
const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, ein: 1, eine: 1, einer: 1, einem: 1, einen: 1,
  two: 2, zwei: 2, three: 3, drei: 3, four: 4, vier: 4, five: 5, fünf: 5,
  six: 6, sechs: 6, seven: 7, sieben: 7, ten: 10, zehn: 10, fourteen: 14, vierzehn: 14,
};
const NUMBER_RE = `\\d{1,3}|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')}`;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` of a local date. */
export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function fullYear(raw) {
  const y = Number(raw);
  return raw.length <= 2 ? 2000 + y : y;
}

/** A day and month without a year: the next one on or after `ref`. */
function nextDayMonth(ref, m, d) {
  let date = validDate(ref.getFullYear(), m, d);
  if (date && date < ref) date = validDate(ref.getFullYear() + 1, m, d);
  // 29 February in a year without it: try the following years.
  for (let y = ref.getFullYear() + 1; !date && y < ref.getFullYear() + 8; y++) date = validDate(y, m, d);
  return date;
}

function count(raw) {
  const n = NUMBER_WORDS[raw.toLowerCase()];
  return n ?? Number(raw);
}

// Each parser looks at the text right after the deadline word and returns
// the date and how many characters it used, or null.
const PARSERS = [
  // 2026-10-20
  (s) => {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/u.exec(s);
    return m && { date: validDate(+m[1], +m[2], +m[3]), length: m[0].length };
  },
  // 20.10.2026, 20.10.26, 20.10.
  (s, ref) => {
    const m = /^(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})(?!\d))?/u.exec(s);
    if (!m) return null;
    const date = m[3] ? validDate(fullYear(m[3]), +m[2], +m[1]) : nextDayMonth(ref, +m[2], +m[1]);
    return { date, length: m[0].length };
  },
  // 10/20/2026 or 20/10/2026, only when it can't be read both ways.
  (s, ref) => {
    const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/u.exec(s);
    if (!m) return null;
    const a = +m[1];
    const b = +m[2];
    let month;
    let day;
    if (a > 12 && b <= 12) { day = a; month = b; } else if (b > 12 && a <= 12) { month = a; day = b; } else return null;
    const date = m[3] ? validDate(fullYear(m[3]), month, day) : nextDayMonth(ref, month, day);
    return { date, length: m[0].length };
  },
  // 20 October 2026, 20th of Oct, 20. Oktober
  (s, ref) => {
    const m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s*(?:of\\s+)?(${MONTH_RE})${R}\\.?(?:,?\\s*(\\d{4})(?!\\d))?`, 'iu').exec(s);
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase()];
    const date = m[3] ? validDate(+m[3], month, +m[1]) : nextDayMonth(ref, month, +m[1]);
    return { date, length: m[0].length };
  },
  // October 20, 2026; Oct 20th
  (s, ref) => {
    const m = new RegExp(`^(${MONTH_RE})${R}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s*(\\d{4})(?!\\d))?`, 'iu').exec(s);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    const date = m[3] ? validDate(+m[3], month, +m[2]) : nextDayMonth(ref, month, +m[2]);
    return { date, length: m[0].length };
  },
  // end of October, Ende Oktober
  (s, ref) => {
    const m = new RegExp(`^(?:the\\s+)?(?:end\\s+of|ende)\\s+(${MONTH_RE})${R}(?:\\s+(\\d{4})(?!\\d))?`, 'iu').exec(s);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    let year = m[2] ? +m[2] : ref.getFullYear();
    if (!m[2] && month < ref.getMonth() + 1) year += 1;
    return { date: new Date(year, month, 0), length: m[0].length };
  },
  // today, tomorrow, the day after tomorrow, heute, morgen, übermorgen, tonight, EOD
  (s, ref) => {
    const m = new RegExp(`^(?:the\\s+)?(day\\s+after\\s+tomorrow|übermorgen|tomorrow|morgen|today|tonight|heute(?:\\s+abend)?|end\\s+of\\s+(?:the\\s+)?day|eod|cob)${R}`, 'iu').exec(s);
    if (!m) return null;
    const word = m[1].toLowerCase();
    const days = /after|über/u.test(word) ? 2 : /tomorrow|morgen/u.test(word) ? 1 : 0;
    return { date: addDays(ref, days), length: m[0].length };
  },
  // end of the week / month / year, Ende der Woche, Monatsende, Jahresende
  (s, ref) => {
    const m = new RegExp(`^(?:the\\s+)?(?:end\\s+of\\s+(?:the\\s+|this\\s+)?(week|month|year)|ende\\s+(?:der|dieser)\\s+(woche)|ende\\s+(?:des|dieses)\\s+(monats|jahres)|(wochenende|monatsende|jahresende))${R}`, 'iu').exec(s);
    if (!m) return null;
    const unit = (m[1] || m[2] || m[3] || m[4]).toLowerCase();
    let date;
    if (/^(week|woche|wochenende)$/u.test(unit)) {
      // The Friday of this week (or today, when it is already Friday or later).
      const diff = (5 - ref.getDay() + 7) % 7;
      date = ref.getDay() === 6 || ref.getDay() === 0 ? ref : addDays(ref, diff);
    } else if (/^(month|monats|monatsende)$/u.test(unit)) {
      date = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    } else {
      date = new Date(ref.getFullYear(), 11, 31);
    }
    return { date, length: m[0].length };
  },
  // next week, nächste Woche, kommende Woche: the Monday of next week
  (s, ref) => {
    const m = new RegExp(`^(?:next|nächste|nächsten|kommende|kommenden)\\s+(week|woche)${R}`, 'iu').exec(s);
    if (!m) return null;
    const diff = ((1 - ref.getDay() + 7) % 7) || 7;
    return { date: addDays(ref, diff), length: m[0].length };
  },
  // in 3 days, within two weeks, in einer Woche, innerhalb von 5 Tagen
  (s, ref) => {
    const m = new RegExp(`^(?:(?:in|within|innerhalb\\s+(?:von\\s+)?|binnen)\\s+)?(${NUMBER_RE})\\s+(days?|weeks?|tagen?|wochen?)${R}`, 'iu').exec(s);
    if (!m) return null;
    const n = count(m[1]);
    if (!Number.isFinite(n) || n > 365) return null;
    const weeks = /^(week|woche)/iu.test(m[2]);
    return { date: addDays(ref, weeks ? n * 7 : n), length: m[0].length };
  },
  // Friday, next Friday, nächsten Freitag
  (s, ref) => {
    const m = new RegExp(`^(?:(next|nächsten|nächster|nächstem|nächste)\\s+)?(${WEEKDAY_RE})${R}`, 'iu').exec(s);
    if (!m) return null;
    const wanted = WEEKDAYS[m[2].toLowerCase()];
    let diff = (wanted - ref.getDay() + 7) % 7;
    if (diff === 0 && m[1]) diff = 7;
    return { date: addDays(ref, diff), length: m[0].length };
  },
];

const TRIGGER_RE = new RegExp(`${L}(${TRIGGERS.map((t) => t.replace(/ /g, '\\s+')).join('|')})${R}\\s*:?\\s*`, 'giu');

/** Text without quoted replies: lines starting with ">" and everything after a reply header. */
export function ownText(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*-{2,}\s*(original message|ursprüngliche nachricht|forwarded message|weitergeleitete nachricht)/iu.test(line)) break;
    if (/^\s*(on .{4,200} wrote:|am .{4,200} schrieb .{1,200}:)\s*$/iu.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * The first due date in `text`, or null: `{ date: 'YYYY-MM-DD', match }`,
 * where `match` is the words it came from ("by Friday").
 */
export function findDueDateIn(text, reference) {
  const ref = startOfDay(reference instanceof Date && !Number.isNaN(reference.getTime()) ? reference : new Date());
  const source = String(text ?? '');
  TRIGGER_RE.lastIndex = 0;
  for (let m = TRIGGER_RE.exec(source); m; m = TRIGGER_RE.exec(source)) {
    const after = source.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const filler = FILLER.exec(after)?.[0] ?? '';
    const rest = after.slice(filler.length);
    for (const parse of PARSERS) {
      const found = parse(rest, ref);
      if (found?.date) {
        const end = m.index + m[0].length + filler.length + found.length;
        return { date: isoDate(found.date), match: source.slice(m.index, end).replace(/\s+/g, ' ').trim() };
      }
    }
  }
  return null;
}

/** The due date of a message: from the subject first, then its own text. */
export function findDueDate({ subject, text, receivedAt }) {
  const ref = receivedAt ? new Date(receivedAt) : new Date();
  return findDueDateIn(subject, ref) ?? findDueDateIn(ownText(text).slice(0, 8000), ref);
}
