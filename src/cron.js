'use strict';

// Standard crontab syntax with an optional leading seconds field:
// [second] minute hour dayOfMonth month dayOfWeek (5-field patterns get second = 0).
// Months are 1-12, days of week 0-7 (0 and 7 = Sunday); jan-dec and sun-sat aliases are accepted.
// Supported per field: *, lists (a,b), ranges (a-b) and steps (*/n, a-b/n, a/n).
const CRON_FIELD_RANGES = [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const CRON_ALIASES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
};
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parseCronPattern(pattern) {
  const invalid = reason => new Error(`Invalid cron pattern "${pattern}": ${reason}`);
  const parts = pattern.trim().replace(/[a-z]+/gi, name => {
    const value = CRON_ALIASES[name.toLowerCase()];
    if (value === undefined) throw invalid(`unknown alias "${name}"`);
    return value;
  }).split(/\s+/);
  if (parts.length === 5) parts.unshift('0');
  if (parts.length !== 6) throw invalid('expected 5 or 6 fields');
  return parts.map((part, index) => {
    const [min, max] = CRON_FIELD_RANGES[index];
    const values = new Set();
    for (const item of part.split(',')) {
      const match = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
      if (!match) throw invalid(`cannot parse "${item}"`);
      const [, from, to, stepText] = match;
      const step = stepText === undefined ? 1 : Number(stepText);
      const low = from === undefined ? min : Number(from);
      const high = from === undefined ? max : to !== undefined ? Number(to) : stepText !== undefined ? max : low;
      if (step === 0 || low > high || low < min || high > max) throw invalid(`"${item}" is out of range ${min}-${max}`);
      // Day of week 7 is an alias for 0 (Sunday).
      for (let value = low; value <= high; value += step) values.add(index === 5 && value === 7 ? 0 : value);
    }
    return { values, all: values.size === (index === 5 ? 7 : max - min + 1) };
  });
}

function cronMatches([second, minute, hour, dayOfMonth, month, dayOfWeek], time) {
  const dayOfMonthOk = dayOfMonth.values.has(time.day);
  const dayOfWeekOk = dayOfWeek.values.has(time.weekday);
  // Like classic cron: if both day fields are restricted, either one matching is enough.
  const dayOk = dayOfMonth.all || dayOfWeek.all ? dayOfMonthOk && dayOfWeekOk : dayOfMonthOk || dayOfWeekOk;
  return dayOk && second.values.has(time.second) && minute.values.has(time.minute) &&
    hour.values.has(time.hour) && month.values.has(time.month);
}

// Returns a function mapping a Date to its wall-clock fields in `timeZone`.
// Throws a RangeError if timeZone is not a valid IANA time zone.
function createZonedTime(timeZone) {
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', weekday: 'short',
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  });
  return date => {
    const parts = Object.fromEntries(clock.formatToParts(date).map(part => [part.type, part.value]));
    return {
      second: Number(parts.second),
      minute: Number(parts.minute),
      hour: Number(parts.hour),
      day: Number(parts.day),
      month: Number(parts.month),
      weekday: WEEKDAYS[parts.weekday]
    };
  };
}

// Ticks on every second boundary. If the event loop was busy and seconds were skipped,
// they are checked too (up to one minute back) and each job runs at most once per tick.
// jobs: [{ fields: parseCronPattern(...), run: () => void }]. Returns a stop function.
function startCronScheduler(jobs, zonedTime) {
  const msToNextSecond = () => 1000 - (Date.now() % 1000);
  let lastSecond = Math.floor(Date.now() / 1000);
  let timer;
  const tick = () => {
    const nowSecond = Math.floor(Date.now() / 1000);
    const times = [];
    for (let s = Math.max(lastSecond + 1, nowSecond - 59); s <= nowSecond; s++) {
      times.push(zonedTime(new Date(s * 1000)));
    }
    lastSecond = nowSecond;
    for (const job of jobs) {
      if (times.some(time => cronMatches(job.fields, time))) job.run();
    }
    timer = setTimeout(tick, msToNextSecond());
  };
  timer = setTimeout(tick, msToNextSecond());
  return () => clearTimeout(timer);
}

module.exports = { parseCronPattern, cronMatches, createZonedTime, startCronScheduler };
