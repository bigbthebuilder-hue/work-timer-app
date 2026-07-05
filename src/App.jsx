import React, { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'work-timer-local-v1';
const SYNC_SETTINGS_KEY = 'work-timer-sync-settings-v1';
const WORK_SETTINGS_KEY = 'work-timer-work-settings-v1';
const DEFAULT_WORK_SETTINGS = { standardDailyHours: 8, openingBankedHours: 0 };

function uid() {
  return crypto?.randomUUID ? crypto.randomUUID() : `shift-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function validDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value);
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();

  // A date-only value must be treated as a local calendar day. Timestamp values
  // must keep their original clock time; otherwise every restored Sheet record
  // displays as noon.
  const dateOnly = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dateKey(dateLike = new Date()) {
  const d = validDate(dateLike);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}
function normalizeDay(day) { return dateKey(day); }
function parseDay(day) {
  const key = normalizeDay(day);
  if (!key) return null;
  const [year, month, date] = key.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
}
function formatDate(dateLike) {
  const d = validDate(dateLike);
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}
function formatDay(day) { return formatDate(parseDay(day)); }
function formatTime(dateLike) {
  const d = validDate(dateLike);
  return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
}
function timeInputValue(dateLike) {
  if (!dateLike) return '';
  const d = new Date(dateLike);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function combineDateTime(day, time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  const d = typeof day === 'string' ? parseDay(day) : new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toISOString();
}
function calcHours(entry) {
  if (!entry.clockIn || !entry.clockOut) return { gross: 0, net: 0 };
  const gross = Math.max(0, (new Date(entry.clockOut) - new Date(entry.clockIn)) / 36e5);
  const net = Math.max(0, gross - (Number(entry.lunchMinutes || 0) / 60));
  return { gross, net };
}
function fmtHours(hours) {
  const safe = Math.max(0, Number(hours) || 0);
  const whole = Math.floor(safe);
  const mins = Math.round((safe - whole) * 60);
  if (mins === 60) return `${whole + 1}h 00m`;
  return `${whole}h ${pad(mins)}m`;
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function workDaySummary(rows, defaultDailyHours) {
  const byDay = new Map();
  rows.forEach(entry => {
    if (!isCompletedWorkEntry(entry)) return;
    const day = entryDay(entry);
    if (!day) return;
    const current = byDay.get(day) || { worked: 0, scheduled: 0 };
    current.worked += calcHours(entry).net;
    current.scheduled = Math.max(current.scheduled, Number(entry.scheduledHours || defaultDailyHours || 8));
    byDay.set(day, current);
  });
  return byDay;
}
function bankedEarnedForRows(rows, defaultDailyHours) {
  return round2(Array.from(workDaySummary(rows, defaultDailyHours).entries()).reduce((total, [day, summary]) => {
    // A stat holiday or a non-scheduled day banks every physical hour worked.
    // A normal weekday only banks the time above the normal daily schedule.
    const earned = isRegularWorkday(day)
      ? Math.max(0, summary.worked - summary.scheduled)
      : summary.worked;
    return total + earned;
  }, 0));
}
function bankedEarnedForDay(day, rows, defaultDailyHours) {
  const summary = workDaySummary(rows.filter(entry => entryDay(entry) === day), defaultDailyHours).get(day);
  if (!summary) return 0;
  return round2(isRegularWorkday(day) ? Math.max(0, summary.worked - summary.scheduled) : summary.worked);
}
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function endOfWorkWeek(date) {
  const start = startOfWeek(date);
  return endOfDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 4));
}
function getRange(type, monthValue, yearValue, weekCount = 1, customStart = '', customEnd = '') {
  const now = new Date();
  let start = new Date(now); let end = endOfDay(now); let label = 'Today';
  if (type === 'weeks') {
    const weeks = Math.max(1, Number(weekCount) || 1);
    const currentWeekStart = startOfWeek(now);
    start = new Date(currentWeekStart);
    start.setDate(currentWeekStart.getDate() - ((weeks - 1) * 7));
    start.setHours(0, 0, 0, 0);
    end = endOfWorkWeek(now);
    label = weeks === 1 ? 'This Work Week' : `Last ${weeks} Work Weeks`;
  } else if (type === 'mtd') {
    start = new Date(now.getFullYear(), now.getMonth(), 1); label = 'Month To Date';
  } else if (type === 'month') {
    const [y, m] = monthValue.split('-').map(Number);
    start = new Date(y, m - 1, 1); end = endOfDay(new Date(y, m, 0));
    label = start.toLocaleDateString([], { month: 'long', year: 'numeric' });
  } else if (type === 'ytd') {
    start = new Date(now.getFullYear(), 0, 1); label = 'Year To Date';
  } else if (type === 'year') {
    const y = Number(yearValue) || now.getFullYear();
    start = new Date(y, 0, 1); end = endOfDay(new Date(y, 11, 31)); label = String(y);
  } else if (type === 'custom' && customStart) {
    start = parseDay(customStart);
    end = endOfDay(parseDay(customEnd || customStart));
    label = customEnd && customEnd !== customStart ? 'Custom Date Range' : 'Selected Date';
  }
  return { start, end, label };
}
function loadJson(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; }
}
function entryType(entry) { return entry.entryType || 'worked'; }
function entryDay(entry) { return normalizeDay(entry?.date) || (entry?.clockIn ? dateKey(entry.clockIn) : '') || dateKey(entry?.updatedAt); }
function isWorkedEntry(entry) { return entryType(entry) === 'worked'; }
function isCompletedWorkEntry(entry) { return isWorkedEntry(entry) && !!entry.clockOut; }
function observedDay(year, monthIndex, day) {
  const d = new Date(year, monthIndex, day, 12);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return dateKey(d);
}
function nthWeekday(year, monthIndex, weekday, nth) {
  const d = new Date(year, monthIndex, 1, 12);
  const add = (weekday - d.getDay() + 7) % 7 + (nth - 1) * 7;
  d.setDate(d.getDate() + add);
  return dateKey(d);
}
function mondayBefore(year, monthIndex, day) {
  const d = new Date(year, monthIndex, day, 12);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return dateKey(d);
}
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1, 12);
}
function bcStatHolidays(year) {
  const easter = easterSunday(year);
  const goodFriday = new Date(easter); goodFriday.setDate(easter.getDate() - 2);
  return [
    { day: observedDay(year, 0, 1), name: "New Year's Day" },
    { day: nthWeekday(year, 1, 1, 3), name: 'Family Day' },
    { day: dateKey(goodFriday), name: 'Good Friday' },
    { day: mondayBefore(year, 4, 25), name: 'Victoria Day' },
    { day: observedDay(year, 6, 1), name: 'Canada Day' },
    { day: nthWeekday(year, 7, 1, 1), name: 'B.C. Day' },
    { day: nthWeekday(year, 8, 1, 1), name: 'Labour Day' },
    { day: observedDay(year, 8, 30), name: 'National Day for Truth and Reconciliation' },
    { day: nthWeekday(year, 9, 1, 2), name: 'Thanksgiving Day' },
    { day: observedDay(year, 10, 11), name: 'Remembrance Day' },
    { day: observedDay(year, 11, 25), name: 'Christmas Day' },
  ];
}
function getBCStatHoliday(day) {
  const parsed = parseDay(day);
  if (!parsed) return null;
  return bcStatHolidays(parsed.getFullYear()).find(holiday => holiday.day === day) || null;
}
function isBCStatHoliday(day) { return !!getBCStatHoliday(day); }
function isRegularWorkday(day) {
  const d = parseDay(day);
  const weekday = d.getDay();
  return weekday >= 1 && weekday <= 5 && !isBCStatHoliday(day);
}
function listRegularWorkdays(start, end) {
  const days = [];
  const d = new Date(start); d.setHours(12, 0, 0, 0);
  const last = new Date(end); last.setHours(12, 0, 0, 0);
  while (d <= last) {
    const key = dateKey(d);
    if (isRegularWorkday(key)) days.push(key);
    d.setDate(d.getDate() + 1);
  }
  return days;
}
function compareDays(a, b) { return parseDay(a).getTime() - parseDay(b).getTime(); }
function laterDay(a, b) { return compareDays(a, b) >= 0 ? a : b; }
function earlierDay(a, b) { return compareDays(a, b) <= 0 ? a : b; }
function dayRangeLabel(startDay, endDay) {
  if (!startDay) return 'Choose dates';
  if (!endDay || endDay === startDay) return formatDay(startDay);
  return `${formatDay(startDay)} — ${formatDay(endDay)}`;
}
function monthLabelFromDay(day) {
  return parseDay(day).toLocaleDateString([], { month: 'long', year: 'numeric' });
}
function daysInRange(start, end) {
  const result = [];
  const cursor = new Date(start); cursor.setHours(12, 0, 0, 0);
  const last = new Date(end); last.setHours(12, 0, 0, 0);
  while (cursor <= last) { result.push(dateKey(cursor)); cursor.setDate(cursor.getDate() + 1); }
  return result;
}
function listStatHolidaysInRange(start, end) {
  return daysInRange(start, end).map(day => getBCStatHoliday(day)).filter(Boolean);
}
function reportLogRows(rows, start, end, defaultDailyHours) {
  const rowsByDay = new Map();
  rows.forEach(row => {
    const day = entryDay(row);
    if (!day) return;
    const list = rowsByDay.get(day) || [];
    list.push(row);
    rowsByDay.set(day, list);
  });
  const allDays = new Set([...rowsByDay.keys(), ...listStatHolidaysInRange(start, end).map(holiday => holiday.day)]);
  return Array.from(allDays).sort((a, b) => compareDays(b, a)).flatMap(day => {
    const holiday = getBCStatHoliday(day);
    const dayRows = rowsByDay.get(day) || [];
    if (holiday) {
      const worked = round2(dayRows.filter(isCompletedWorkEntry).reduce((total, row) => total + calcHours(row).net, 0));
      const vacation = round2(dayRows.reduce((total, row) => total + Number(row.vacationHours || 0), 0));
      const bankedUsed = round2(dayRows.reduce((total, row) => total + Number(row.bankedHoursUsed || 0), 0));
      return [{
        id: `holiday-${day}`,
        kind: 'holiday',
        date: day,
        holiday,
        worked,
        vacationHours: vacation,
        bankedHoursUsed: bankedUsed,
        bankedEarned: bankedEarnedForDay(day, dayRows, defaultDailyHours),
        paidStatHours: Number(defaultDailyHours || 8),
        notes: dayRows.map(row => row.notes).filter(Boolean).join(' · '),
      }];
    }
    return dayRows.sort((a, b) => new Date(b.clockIn || `${entryDay(b)}T12:00:00`) - new Date(a.clockIn || `${entryDay(a)}T12:00:00`));
  });
}
function jsonp(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = `workTimerSync_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const separator = url.includes('?') ? '&' : '?'; const script = document.createElement('script'); let done = false;
    const cleanup = () => { delete window[callbackName]; script.remove(); };
    const timer = setTimeout(() => { if (done) return; done = true; cleanup(); reject(new Error('Sync timed out.')); }, timeoutMs);
    window[callbackName] = data => { if (done) return; done = true; clearTimeout(timer); cleanup(); data && data.ok === false ? reject(new Error(data.error || 'Sync failed.')) : resolve(data); };
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.onerror = () => { if (done) return; done = true; clearTimeout(timer); cleanup(); reject(new Error('Could not reach Google Sheets sync.')); };
    document.body.appendChild(script);
  });
}
function shiftPayload(shift) {
  const h = calcHours(shift);
  return {
    id: shift.id, date: entryDay(shift), entryType: entryType(shift), clockIn: shift.clockIn || '', clockOut: shift.clockOut || '',
    lunchMinutes: Number(shift.lunchMinutes || 0), grossHours: round2(h.gross), netHours: round2(h.net), notes: shift.notes || '',
    vacationHours: Number(shift.vacationHours || 0), bankedHoursUsed: Number(shift.bankedHoursUsed || 0), scheduledHours: Number(shift.scheduledHours || 0),
    deleted: !!shift.deleted, createdAt: shift.createdAt || shift.updatedAt || new Date().toISOString(), updatedAt: shift.updatedAt || new Date().toISOString()
  };
}
function mergeShifts(localRows, cloudRows) {
  const map = new Map();
  [...cloudRows, ...localRows].forEach(row => {
    if (!row || !row.id) return;
    const existing = map.get(row.id);
    if (!existing || new Date(row.updatedAt || 0).getTime() >= new Date(existing.updatedAt || 0).getTime()) map.set(row.id, row);
  });
  return Array.from(map.values()).filter(row => !row.deleted)
    .sort((a, b) => new Date(b.clockIn || `${entryDay(b)}T12:00:00` || b.updatedAt || 0) - new Date(a.clockIn || `${entryDay(a)}T12:00:00` || a.updatedAt || 0));
}
const idleLines = ['SYS// TIME CONSOLE READY', 'WATCHING INPUT CHANNELS', 'SHIFT MEMORY LINKED', 'CLOCK ENGINE STANDBY', 'LOCAL STORAGE ONLINE', 'REPORT CACHE IDLE', 'VERIFYING CHRONO FIELD', 'AWAITING COMMAND', 'SCAN: NO ERRORS DETECTED', 'PANEL LIGHTS NORMAL'];
const processText = {
  clockIn: ['INITIATING SHIFT RECORD', 'STAMPING START TIME', 'WRITING LOCAL MEMORY', 'CLOCK IN COMPLETE'],
  clockOut: ['CLOSING ACTIVE SHIFT', 'CALCULATING HOURS', 'CHECKING DAILY COVERAGE', 'SAVING COMPLETED SHIFT'],
  update: ['LOADING SHIFT RECORD', 'VALIDATING TIME VALUES', 'RECALCULATING TOTALS', 'SAVING REVISION'],
  delete: ['TARGETING RECORD', 'REMOVING LOCAL ENTRY', 'REBUILDING INDEX', 'DELETE COMPLETE'],
  report: ['SCANNING LOCAL ARCHIVE', 'FILTERING DATE RANGE', 'COMPUTING TOTALS', 'RENDERING REPORT'],
  sync: ['OPENING GOOGLE SHEETS LINK', 'WRITING BACKUP RECORDS', 'CONFIRMING CLOUD COPY', 'SYNC COMPLETE'],
  pull: ['CONTACTING GOOGLE SHEETS', 'READING BACKUP RECORDS', 'MERGING LOCAL MEMORY', 'RESTORE COMPLETE'],
  vacation: ['CREATING PAID VACATION RECORD', 'STAMPING SELECTED DATE', 'WRITING LOCAL MEMORY', 'VACATION LOGGED'],
  banked: ['CREATING BANKED TIME RECORD', 'STAMPING SELECTED DATE', 'WRITING LOCAL MEMORY', 'BANKED TIME LOGGED'],
};

export default function App() {
  const [shifts, setShifts] = useState([]);
  const [syncQueue, setSyncQueue] = useState([]);
  const [syncSettings, setSyncSettings] = useState(() => loadJson(SYNC_SETTINGS_KEY, { scriptUrl: '', token: 'worktimer' }));
  const [workSettings, setWorkSettings] = useState(() => ({ ...DEFAULT_WORK_SETTINGS, ...loadJson(WORK_SETTINGS_KEY, DEFAULT_WORK_SETTINGS) }));
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', message: 'Local only', lastSync: '' });
  const [showSyncSetup, setShowSyncSetup] = useState(false);
  const [showWorkSettings, setShowWorkSettings] = useState(false);
  const [now, setNow] = useState(new Date()); const [tab, setTab] = useState('clock'); const [lunchMinutes, setLunchMinutes] = useState(0);
  const [rangeType, setRangeType] = useState('weeks'); const [weekCount, setWeekCount] = useState('1'); const [month, setMonth] = useState(dateKey().slice(0, 7)); const [year, setYear] = useState(String(new Date().getFullYear())); const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [editing, setEditing] = useState(null); const [codeLines, setCodeLines] = useState([]); const [process, setProcess] = useState(null);
  const [coveragePrompt, setCoveragePrompt] = useState(null); const [timeOffEntry, setTimeOffEntry] = useState(null);

  useEffect(() => {
    const saved = loadJson(STORAGE_KEY, []);
    if (Array.isArray(saved)) setShifts(saved);
    else { setShifts(Array.isArray(saved.shifts) ? saved.shifts : []); setSyncQueue(Array.isArray(saved.syncQueue) ? saved.syncQueue : []); if (saved.lastSync) setSyncStatus(s => ({ ...s, lastSync: saved.lastSync, message: 'Ready' })); }
  }, []);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ shifts, syncQueue, lastSync: syncStatus.lastSync || '' })); }, [shifts, syncQueue, syncStatus.lastSync]);
  useEffect(() => { localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(syncSettings)); }, [syncSettings]);
  useEffect(() => { localStorage.setItem(WORK_SETTINGS_KEY, JSON.stringify(workSettings)); }, [workSettings]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const add = () => { const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); setCodeLines(lines => [...lines.slice(-7), `[${stamp}] ${idleLines[Math.floor(Math.random() * idleLines.length)]}`]); }; add(); const t = setInterval(add, 1300); return () => clearInterval(t); }, []);
  useEffect(() => { if (!syncSettings.scriptUrl || !syncSettings.token || !syncQueue.length) return; const t = setTimeout(() => syncPending(false), 1500); return () => clearTimeout(t); }, [syncQueue.length, syncSettings.scriptUrl, syncSettings.token]);

  const activeShift = shifts.find(s => isWorkedEntry(s) && !s.clockOut);
  const live = activeShift ? calcHours({ ...activeShift, clockOut: now.toISOString(), lunchMinutes }) : { net: 0 };
  function runProcess(type, callback) { setProcess({ type, lines: [] }); const lines = processText[type] || processText.report; lines.forEach((line, i) => setTimeout(() => setProcess(p => p ? { ...p, lines: [...p.lines, line] } : p), i * 260)); setTimeout(() => { callback(); setProcess(p => p ? { ...p, lines: [...p.lines, 'PROCESS COMPLETE'] } : p); }, lines.length * 260 + 120); setTimeout(() => setProcess(null), lines.length * 260 + 950); }
  function queueSync(id) { setSyncQueue(prev => Array.from(new Set([...prev, id]))); }
  function saveShift(nextShift) { setShifts(prev => prev.some(s => s.id === nextShift.id) ? prev.map(s => s.id === nextShift.id ? nextShift : s) : [nextShift, ...prev]); queueSync(nextShift.id); }
  function syncUrl(action, extra = {}) { const params = new URLSearchParams({ action, token: syncSettings.token || '', ...extra }); return `${String(syncSettings.scriptUrl || '').trim()}?${params.toString()}`; }
  async function syncWorkSettings() { if (!syncSettings.scriptUrl || !syncSettings.token) return; try { await jsonp(syncUrl('saveSettings', { payload: JSON.stringify(workSettings) })); } catch { /* entries remain safely queued; local setting is still saved */ } }
  async function syncPending(showProcess = true) {
    if (!syncSettings.scriptUrl || !syncSettings.token) { setShowSyncSetup(true); setSyncStatus(s => ({ ...s, state: 'error', message: 'Sync not set up' })); return; }
    const ids = syncQueue.length ? syncQueue : shifts.map(s => s.id); const rows = shifts.filter(s => ids.includes(s.id)).map(shiftPayload);
    const doSync = async () => { try { setSyncStatus(s => ({ ...s, state: 'syncing', message: `Syncing ${rows.length} record(s)...` })); for (const row of rows) { await jsonp(syncUrl('upsert', { payload: JSON.stringify(row) })); setSyncQueue(prev => prev.filter(id => id !== row.id)); } await syncWorkSettings(); setSyncStatus({ state: 'ok', message: 'Synced to Google Sheets', lastSync: new Date().toISOString() }); } catch (err) { setSyncStatus(s => ({ ...s, state: 'error', message: err.message || 'Sync failed' })); } };
    if (showProcess) runProcess('sync', doSync); else doSync();
  }
  async function restoreFromSheets() {
    if (!syncSettings.scriptUrl || !syncSettings.token) { setShowSyncSetup(true); setSyncStatus(s => ({ ...s, state: 'error', message: 'Sync not set up' })); return; }
    runProcess('pull', async () => { try { setSyncStatus(s => ({ ...s, state: 'syncing', message: 'Restoring from Google Sheets...' })); const [rowsResult, settingsResult] = await Promise.all([jsonp(syncUrl('list')), jsonp(syncUrl('getSettings'))]); const cloudRows = Array.isArray(rowsResult.rows) ? rowsResult.rows : []; setShifts(mergeShifts(shifts, cloudRows)); if (settingsResult && settingsResult.settings) setWorkSettings(s => ({ ...DEFAULT_WORK_SETTINGS, ...s, ...settingsResult.settings })); setSyncQueue([]); setSyncStatus({ state: 'ok', message: `Restored ${cloudRows.length} cloud record(s)`, lastSync: new Date().toISOString() }); } catch (err) { setSyncStatus(s => ({ ...s, state: 'error', message: err.message || 'Restore failed' })); } });
  }
  function addManualShift() { const today = dateKey(); const shift = { id: uid(), date: today, entryType: 'worked', clockIn: combineDateTime(today, '08:00'), clockOut: combineDateTime(today, '17:00'), lunchMinutes: 0, vacationHours: 0, bankedHoursUsed: 0, scheduledHours: Number(workSettings.standardDailyHours || 8), notes: 'Manual entry', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; saveShift(shift); setEditing(shift); }
  function clockIn() { if (activeShift) return; runProcess('clockIn', () => { setLunchMinutes(0); saveShift({ id: uid(), date: dateKey(), entryType: 'worked', clockIn: new Date().toISOString(), clockOut: '', lunchMinutes: 0, vacationHours: 0, bankedHoursUsed: 0, scheduledHours: Number(workSettings.standardDailyHours || 8), notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }); }
  function clockOut() { if (!activeShift) return; runProcess('clockOut', () => { const next = { ...activeShift, clockOut: new Date().toISOString(), lunchMinutes, updatedAt: new Date().toISOString() }; saveShift(next); setLunchMinutes(0); const worked = calcHours(next).net; const standard = Number(workSettings.standardDailyHours || 8); if (isRegularWorkday(next.date) && worked < standard - 0.01) setCoveragePrompt({ shift: next, worked, remaining: round2(standard - worked) }); }); }
  function saveEdit(data) { runProcess('update', () => { const day = data.shiftDate || entryDay(data); const clockIn = data.clockInTime ? combineDateTime(day, data.clockInTime) : ''; const clockOut = data.clockOutTime ? combineDateTime(day, data.clockOutTime) : ''; saveShift({ ...data, date: day, entryType: data.entryType || 'worked', clockIn, clockOut, lunchMinutes: Number(data.lunchMinutes || 0), vacationHours: Number(data.vacationHours || 0), bankedHoursUsed: Number(data.bankedHoursUsed || 0), scheduledHours: Number(data.scheduledHours || workSettings.standardDailyHours || 8), notes: data.notes || '', updatedAt: new Date().toISOString() }); setEditing(null); }); }
  function deleteShift(id) { if (!confirm('Delete this record?')) return; runProcess('delete', () => { const found = shifts.find(s => s.id === id); if (found) saveShift({ ...found, deleted: true, updatedAt: new Date().toISOString() }); setShifts(prev => prev.filter(s => s.id !== id)); }); }
  function applyBankedToShortDay(shift) {
    const worked = calcHours(shift).net;
    const standard = Number(shift.scheduledHours || workSettings.standardDailyHours || 8);
    const alreadyCovered = Number(shift.bankedHoursUsed || 0) + Number(shift.vacationHours || 0);
    const remaining = round2(Math.max(0, standard - worked - alreadyCovered));
    if (remaining <= 0) return;
    if (!confirm(`Use ${fmtHours(remaining)} of banked time for ${formatDay(entryDay(shift))}?`)) return;
    runProcess('update', () => saveShift({ ...shift, bankedHoursUsed: round2(Number(shift.bankedHoursUsed || 0) + remaining), updatedAt: new Date().toISOString() }));
  }
  function selectReport(next) { runProcess('report', () => { setRangeType(next); setTab('reports'); }); }
  function saveTimeOff({ type, startDay, endDay, hours, notes }) {
    const first = startDay || dateKey(); const last = endDay || first;
    const days = listRegularWorkdays(parseDay(first), parseDay(last));
    if (!days.length) { alert('That date range does not include a regular workday. Weekends and B.C. statutory holidays are skipped.'); return; }
    runProcess(type === 'vacation' ? 'vacation' : 'banked', () => {
      const stamp = new Date().toISOString();
      days.forEach(day => saveShift({ id: uid(), date: day, entryType: type, clockIn: '', clockOut: '', lunchMinutes: 0, vacationHours: type === 'vacation' ? Number(hours) : 0, bankedHoursUsed: type === 'banked' ? Number(hours) : 0, scheduledHours: Number(workSettings.standardDailyHours || 8), notes: notes || '', createdAt: stamp, updatedAt: stamp }));
      setTimeOffEntry(null);
    });
  }
  const visibleShifts = shifts.filter(s => !s.deleted); const completed = visibleShifts.filter(isCompletedWorkEntry); const recent = [...visibleShifts].sort((a, b) => new Date(b.clockIn || `${entryDay(b)}T12:00:00`) - new Date(a.clockIn || `${entryDay(a)}T12:00:00`)).slice(0, 20);
  const report = useMemo(() => {
    const requested = getRange(rangeType, month, year, weekCount, customRange.start, customRange.end);
    const trackedDays = visibleShifts.map(entryDay).filter(Boolean).sort(compareDays);
    const firstTrackedDay = trackedDays[0] || '';
    const todayDay = dateKey();
    const requestedStartDay = dateKey(requested.start); const requestedEndDay = dateKey(requested.end);
    const startDay = firstTrackedDay ? laterDay(requestedStartDay, firstTrackedDay) : requestedStartDay;
    const endDay = earlierDay(requestedEndDay, todayDay);
    const hasRange = compareDays(startDay, endDay) <= 0;
    const r = { ...requested, start: parseDay(startDay), end: endOfDay(parseDay(endDay)), label: firstTrackedDay && startDay !== requestedStartDay ? `${requested.label} (from first log)` : requested.label };
    const standard = Number(workSettings.standardDailyHours || 8);
    const workdays = hasRange ? listRegularWorkdays(r.start, r.end) : [];
    const daySet = new Set(workdays);
    const rows = hasRange ? visibleShifts.filter(s => {
      const day = entryDay(s); return day && compareDays(day, startDay) >= 0 && compareDays(day, endDay) <= 0;
    }) : [];
    let gross = 0, net = 0, lunch = 0, vacation = 0, bankedUsed = 0, attendedDays = new Set(), vacationDays = new Set();
    rows.forEach(s => {
      const h = calcHours(s);
      if (isCompletedWorkEntry(s)) {
        gross += h.gross; net += h.net; lunch += Number(s.lunchMinutes || 0) / 60;
        if (h.net > 0) attendedDays.add(entryDay(s));
      }
      vacation += Number(s.vacationHours || 0); bankedUsed += Number(s.bankedHoursUsed || 0);
      if (Number(s.vacationHours || 0) > 0) vacationDays.add(entryDay(s));
    });
    const statHolidays = hasRange ? listStatHolidaysInRange(r.start, r.end) : [];
    const paidStatHours = round2(statHolidays.length * standard);
    const expected = round2(workdays.length * standard);
    const bankedEarned = bankedEarnedForRows(rows, standard);
    const paidCovered = round2(net + vacation + bankedUsed + paidStatHours);
    const logRows = hasRange ? reportLogRows(rows, r.start, r.end, standard) : [];
    return {
      ...r, rows, logRows, gross, net: round2(net), lunch: round2(lunch), expected,
      paidCovered, paidStatHours, statHolidays, difference: round2(net - expected),
      bankedUsed: round2(bankedUsed), bankedEarned, vacation: round2(vacation),
      daysAtWork: attendedDays.size, vacationDays: vacationDays.size, scheduledDays: workdays.length,
      statDays: statHolidays.length,
    };
  }, [visibleShifts, rangeType, month, year, weekCount, customRange, workSettings.standardDailyHours]);
  const allTime = useMemo(() => {
    const earned = bankedEarnedForRows(visibleShifts, Number(workSettings.standardDailyHours || 8));
    const used = round2(visibleShifts.reduce((total, shift) => total + Number(shift.bankedHoursUsed || 0), 0));
    return { earned, used, balance: round2(Number(workSettings.openingBankedHours || 0) + earned - used) };
  }, [visibleShifts, workSettings]);
  function exportCsv() { const header = 'Date,Type,Clock In,Clock Out,Lunch Minutes,Worked Hours,Vacation Hours,Banked Hours Used,Notes\n'; const body = visibleShifts.map(s => { const h = calcHours(s); return [entryDay(s), entryType(s), formatTime(s.clockIn), formatTime(s.clockOut), s.lunchMinutes || 0, round2(h.net), Number(s.vacationHours || 0), Number(s.bankedHoursUsed || 0), `"${String(s.notes || '').replaceAll('"', '""')}"`].join(','); }).join('\n'); const blob = new Blob([header + body], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'work-timer-export.csv'; a.click(); URL.revokeObjectURL(a.href); }
  function printReport() { openPrintableReport(report, allTime, workSettings, new Date()); }

  return <div className="page">
    {process && <Processing process={process} />}
    {coveragePrompt && <CoverageModal prompt={coveragePrompt} onCancel={() => setCoveragePrompt(null)} onUseBanked={() => { const next = { ...coveragePrompt.shift, bankedHoursUsed: round2(Number(coveragePrompt.shift.bankedHoursUsed || 0) + coveragePrompt.remaining), updatedAt: new Date().toISOString() }; saveShift(next); setCoveragePrompt(null); }} onUseVacation={() => { const next = { ...coveragePrompt.shift, vacationHours: round2(Number(coveragePrompt.shift.vacationHours || 0) + coveragePrompt.remaining), updatedAt: new Date().toISOString() }; saveShift(next); setCoveragePrompt(null); }} />}
    {timeOffEntry && <TimeOffModal type={timeOffEntry} standardHours={Number(workSettings.standardDailyHours || 8)} onCancel={() => setTimeOffEntry(null)} onSave={saveTimeOff} />}
    <div className="shell">
      <header className="top"><div><div className="eyebrow"><span className="power-dot" /> Time Control Console</div><h1>Work Timer</h1><p>Work hours, vacation use, and banked-time planning.</p></div><div className="clock-card"><div className="digital">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div><div className="date-line">{now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div></div></header>
      <nav className="tabs"><button className={`tab ${tab === 'clock' ? 'active' : ''}`} onClick={() => setTab('clock')}>Clock</button><button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>Reports</button></nav>
      <SyncPanel syncSettings={syncSettings} setSyncSettings={setSyncSettings} syncStatus={syncStatus} pendingCount={syncQueue.length} showSetup={showSyncSetup} setShowSetup={setShowSyncSetup} onSync={() => syncPending(true)} onRestore={restoreFromSheets} />
      {tab === 'clock' && <>
        <Panel title="Main Control" lamp={activeShift}><div className="dummy-grid"><i /><i /><i className="amber" /><i /></div><div className="button-deck"><button className={`big-btn btn-in ${activeShift ? 'disabled' : ''}`} onClick={clockIn}>Clock In</button><button className={`big-btn btn-out ${!activeShift ? 'disabled' : ''}`} onClick={clockOut}>Clock Out</button></div><div className="readouts"><Readout label="Status" value={activeShift ? 'Clocked In' : 'Standby'} /><Readout label="Started" value={activeShift ? formatTime(activeShift.clockIn) : '—'} /><Readout label="Live Total" value={activeShift ? fmtHours(live.net) : '—'} cyan /></div></Panel>
        <Panel title="Time Off"><div className="time-off-actions"><button className="time-off-btn vacation" onClick={() => setTimeOffEntry('vacation')}>Log Vacation</button><button className="time-off-btn banked" onClick={() => setTimeOffEntry('banked')}>Use Banked Time</button></div><div className="readouts"><Readout label="Banked Balance" value={fmtHours(allTime.balance)} cyan /><Readout label="Banked Days" value={round2(allTime.balance / Number(workSettings.standardDailyHours || 8))} /><Readout label="Vacation Logged" value={fmtHours(report.vacation)} amber /></div></Panel>
        <Panel title="Lunch Controls" lamp={lunchMinutes > 0}><div className="lunch-buttons"><LunchButton active={lunchMinutes === 0} label="No Lunch" sub="No deduction from this shift." onClick={() => setLunchMinutes(0)} /><LunchButton active={lunchMinutes === 30} label="30 Minutes" sub="Subtract half an hour at clock out." onClick={() => setLunchMinutes(30)} /><LunchButton active={lunchMinutes === 60} label="1 Hour" sub="Subtract one full hour at clock out." onClick={() => setLunchMinutes(60)} /></div><div className="lunch-status">Current lunch deduction: {lunchMinutes} minutes</div></Panel>
        <Panel title="System Activity" lamp><div className="system-screen"><div className="screen-row"><strong>Console Memory Feed</strong><span>Idle Loop</span></div><div className="code-feed">{codeLines.map((line, i) => <div key={i}><span>&gt;</span> {line}{i === codeLines.length - 1 && <b className="cursor" />}</div>)}</div><div className="meters"><i /><i /><i /></div></div></Panel>
        <Panel title="Recent Records"><button className="export-btn secondary" onClick={addManualShift}>Add Manual Work Shift</button><RecordList rows={recent} standardHours={Number(workSettings.standardDailyHours || 8)} onEdit={setEditing} onDelete={deleteShift} onApplyBanked={applyBankedToShortDay} /></Panel>
      </>}
      {tab === 'reports' && <>
        <Panel title="Report Selector"><div className="report-buttons">{[['weeks', 'Choose Weeks'], ['mtd', 'MTD'], ['month', 'Choose Month'], ['ytd', 'YTD'], ['year', 'Choose Year'], ['custom', 'Choose Dates']].map(([key, label]) => <button key={key} className={`range-btn ${rangeType === key ? 'active' : ''}`} onClick={() => selectReport(key)}>{label}</button>)}</div>
          {rangeType === 'weeks' && <div className="input-grid report-picker"><label>Number of Work Weeks<select value={weekCount} onChange={e => setWeekCount(e.target.value)}><option value="1">1 week: this Monday to Friday</option><option value="2">2 consecutive work weeks</option><option value="3">3 consecutive work weeks</option><option value="4">4 consecutive work weeks</option><option value="5">5 consecutive work weeks</option><option value="6">6 consecutive work weeks</option><option value="8">8 consecutive work weeks</option></select></label></div>}
          {rangeType === 'month' && <div className="input-grid report-picker"><div className="calendar-field-wrap"><label>Choose Month</label><MonthField value={month} onChange={setMonth} /></div></div>}
          {rangeType === 'year' && <div className="input-grid report-picker"><div className="calendar-field-wrap"><label>Choose Year</label><YearField value={year} onChange={setYear} /></div></div>}
          {rangeType === 'custom' && <div className="input-grid report-picker"><div className="calendar-field-wrap"><label>Choose Report Dates</label><CalendarField mode="range" start={customRange.start} end={customRange.end} buttonLabel={dayRangeLabel(customRange.start, customRange.end)} onRangeChange={({ start, end }) => setCustomRange({ start, end })} /></div></div>}
          {(rangeType === 'mtd' || rangeType === 'ytd') && <div className="report-picker-note">{rangeType === 'mtd' ? 'Month to date uses the first day of this month through today.' : 'Year to date uses January 1 through today, starting no earlier than your first saved record.'}</div>}
        </Panel>
        <Panel title="Banked Time Setup"><div className="settings-summary"><div><strong>{fmtHours(allTime.balance)}</strong><small>Current calculated banked balance</small></div><button onClick={() => setShowWorkSettings(!showWorkSettings)}>{showWorkSettings ? 'Hide Setup' : 'Edit Setup'}</button></div>{showWorkSettings && <div className="input-grid work-settings"><label>Standard Workday Hours<input type="number" min="1" max="24" step="0.25" value={workSettings.standardDailyHours} onChange={e => setWorkSettings(s => ({ ...s, standardDailyHours: Number(e.target.value) || 8 }))} /></label><label>Opening Banked Hours<input type="number" min="0" step="0.25" value={workSettings.openingBankedHours} onChange={e => setWorkSettings(s => ({ ...s, openingBankedHours: Number(e.target.value) || 0 }))} /></label><div className="setting-note">B.C. statutory holidays are excluded from regular expected workdays. Save with Sync Now after changing these values.</div></div>}</Panel>
        <Panel title={report.label}><div className="stats"><Stat label="Scheduled Hours" value={fmtHours(report.expected)} sub={`${report.scheduledDays} regular workdays`} /><Stat label="Hours Worked" value={fmtHours(report.net)} sub={`${report.daysAtWork} day(s) worked`} /><Stat label="Paid Stat Holidays" value={fmtHours(report.paidStatHours)} sub={`${report.statDays} holiday${report.statDays === 1 ? '' : 's'}`} /></div><div className="stats"><Stat label="Vacation Taken" value={fmtHours(report.vacation)} sub={`${report.vacationDays} day(s) logged`} /><Stat label="Banked Time Taken" value={fmtHours(report.bankedUsed)} sub="Used as paid time" /><Stat label="Total Paid Time" value={fmtHours(report.paidCovered)} sub="Work + time off + paid stats" /></div><div className="stats"><Stat label={report.difference >= 0 ? "Extra Work Hours" : "Hours Below Schedule"} value={`${report.difference >= 0 ? '+' : ''}${fmtHours(Math.abs(report.difference))}`} sub="Compared with scheduled hours" /><Stat label="Banked Time Earned" value={`+${fmtHours(report.bankedEarned)}`} sub="Overtime, stats, and days off" /><Stat label="Banked Time Available" value={fmtHours(allTime.balance)} sub="Current balance" /></div><div className="readouts"><Readout label="Banked Time Available" value={fmtHours(allTime.balance)} cyan /><Readout label="Stat Holidays" value={report.statHolidays.map(holiday => holiday.name).join(' · ') || 'None in this range'} /><Readout label="Range" value={`${formatDate(report.start)} - ${formatDate(report.end)}`} /></div><div className="report-export-actions"><button className="export-btn" onClick={printReport}>Print Report</button><button className="export-btn secondary" onClick={exportCsv}>Export CSV</button></div></Panel>
        <Panel title="Report Log"><ReportRecordList rows={report.logRows} standardHours={Number(workSettings.standardDailyHours || 8)} onEdit={setEditing} onDelete={deleteShift} onApplyBanked={applyBankedToShortDay} /></Panel>
      </>}
    </div>
    {editing && <EditModal shift={editing} standardHours={Number(workSettings.standardDailyHours || 8)} onCancel={() => setEditing(null)} onSave={saveEdit} />}
  </div>;
}

function Panel({ title, children, lamp }) { return <section className="panel"><div className="panel-head"><h2><span className="panel-marker" /> {title}</h2><div className={`lamp ${lamp ? 'on' : ''}`} /></div>{children}</section>; }
function SyncPanel({ syncSettings, setSyncSettings, syncStatus, pendingCount, showSetup, setShowSetup, onSync, onRestore }) { return <section className="panel sync-panel"><div className="panel-head"><h2><span className="panel-marker" /> Sheet Sync</h2><div className={`lamp ${syncStatus.state === 'ok' ? 'on' : ''}`} /></div><div className="sync-status"><div><strong>{syncStatus.message || 'Local only'}</strong><small>{pendingCount} pending sync item(s){syncStatus.lastSync ? ` • last sync ${formatTime(syncStatus.lastSync)}` : ''}</small></div><button onClick={() => setShowSetup(!showSetup)}>{showSetup ? 'Hide' : 'Setup'}</button></div>{showSetup && <div className="sync-setup"><label>Apps Script Web App URL<input value={syncSettings.scriptUrl} onChange={e => setSyncSettings(s => ({ ...s, scriptUrl: e.target.value }))} placeholder="https://script.google.com/macros/s/.../exec" /></label><label>Sync Token<input value={syncSettings.token} onChange={e => setSyncSettings(s => ({ ...s, token: e.target.value }))} /></label></div>}<div className="sync-actions"><button onClick={onSync}>Sync Now</button><button onClick={onRestore}>Restore From Sheet</button></div></section>; }
function Readout({ label, value, cyan, amber }) { return <div className="readout"><div>{label}</div><strong className={cyan ? 'cyan' : amber ? 'amber' : ''}>{value}</strong></div>; }
function LunchButton({ active, label, sub, onClick }) { return <button className={`lunch-btn ${active ? 'active' : ''}`} onClick={onClick}>{label}<small>{sub}</small></button>; }
function Stat({ label, value, sub }) { return <div className="stat"><div>{label}</div><strong>{value}</strong><small>{sub}</small></div>; }
function RecordList({ rows, onEdit, onDelete, standardHours = 8, onApplyBanked }) {
  if (!rows.length) return <div className="empty">No records found.</div>;
  return <div className="records">{rows.map(s => {
    const h = calcHours(s);
    const type = entryType(s);
    const scheduled = Number(s.scheduledHours || standardHours || 8);
    const covered = round2((type === 'worked' ? h.net : 0) + Number(s.vacationHours || 0) + Number(s.bankedHoursUsed || 0));
    const remaining = type === 'worked' && s.clockOut && isRegularWorkday(entryDay(s)) ? round2(Math.max(0, scheduled - covered)) : 0;
    return <div className="record" key={s.id}>
      <Row label="Date" value={formatDay(entryDay(s))} />
      <Row label="Type" value={type === 'vacation' ? 'Vacation' : type === 'banked' ? 'Banked Time' : 'Worked'} />
      {type === 'worked' && <><Row label="In" value={formatTime(s.clockIn)} /><Row label="Out" value={s.clockOut ? formatTime(s.clockOut) : '—'} /><Row label="Lunch" value={`${s.lunchMinutes || 0}m`} /><Row label="Worked" value={s.clockOut ? fmtHours(h.net) : 'Active'} cyan /></>}
      {Number(s.vacationHours || 0) > 0 && <Row label="Vacation" value={fmtHours(s.vacationHours)} amber />}
      {Number(s.bankedHoursUsed || 0) > 0 && <Row label="Banked Used" value={fmtHours(s.bankedHoursUsed)} cyan />}
      {type === 'worked' && s.clockOut && isRegularWorkday(entryDay(s)) && <Row label="Paid Coverage" value={`${fmtHours(covered)} of ${fmtHours(scheduled)}`} cyan={remaining <= 0} amber={remaining > 0} />}
      {remaining > 0 && <Row label="Uncovered" value={fmtHours(remaining)} amber />}
      {s.notes && <Row label="Notes" value={s.notes} />}
      <div className="actions">
        <button onClick={() => onEdit(s)}>Edit</button>
        {remaining > 0 && <button className="banked-action" onClick={() => onApplyBanked && onApplyBanked(s)}>Use {fmtHours(remaining)} Banked</button>}
        {(type !== 'worked' || s.clockOut) && <button className="danger" onClick={() => onDelete(s.id)}>Delete</button>}
      </div>
    </div>;
  })}</div>;
}
function Row({ label, value, cyan, amber }) { return <div className="record-row"><span>{label}</span><strong className={cyan ? 'cyan' : amber ? 'amber' : ''}>{value}</strong></div>; }
function EditModal({ shift, standardHours, onCancel, onSave }) {
  const type = entryType(shift); const [shiftDate, setShiftDate] = useState(entryDay(shift) || dateKey()); const [clockInTime, setClockInTime] = useState(timeInputValue(shift.clockIn)); const [clockOutTime, setClockOutTime] = useState(timeInputValue(shift.clockOut)); const [lunch, setLunch] = useState(String(shift.lunchMinutes || 0)); const [notes, setNotes] = useState(shift.notes || ''); const [vacationHours, setVacationHours] = useState(String(shift.vacationHours || 0)); const [bankedHoursUsed, setBankedHoursUsed] = useState(String(shift.bankedHoursUsed || 0));
  return <div className="modal"><div className="edit-box"><h3>Edit Record</h3><div className="edit-grid"><div className="wide calendar-field-wrap"><label>Date</label><CalendarField mode="single" value={shiftDate} buttonLabel={formatDay(shiftDate)} onChange={setShiftDate} /></div>{type === 'worked' && <><label>Clock In<input type="time" value={clockInTime} onChange={e => setClockInTime(e.target.value)} /></label><label>Clock Out<input type="time" value={clockOutTime} onChange={e => setClockOutTime(e.target.value)} /></label><label>Lunch<select value={lunch} onChange={e => setLunch(e.target.value)}><option value="0">No Lunch</option><option value="30">30 Minutes</option><option value="60">1 Hour</option></select></label></>}<label>Vacation Hours<input type="number" min="0" step="0.25" value={vacationHours} onChange={e => setVacationHours(e.target.value)} /></label><label>Banked Hours Used<input type="number" min="0" step="0.25" value={bankedHoursUsed} onChange={e => setBankedHoursUsed(e.target.value)} /></label><label className="wide">Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} /></label></div><div className="modal-actions"><button onClick={onCancel}>Cancel</button><button className="save" onClick={() => onSave({ ...shift, shiftDate, clockInTime, clockOutTime, lunchMinutes: lunch, vacationHours, bankedHoursUsed, scheduledHours: shift.scheduledHours || standardHours, notes })}>Save</button></div></div></div>;
}
function CoverageModal({ prompt, onCancel, onUseBanked, onUseVacation }) { return <div className="modal"><div className="edit-box"><h3>Complete Today’s Paid Hours</h3><div className="coverage-summary"><strong>{fmtHours(prompt.worked)} worked</strong><span>of your {fmtHours(prompt.worked + prompt.remaining)} scheduled day</span><b>{fmtHours(prompt.remaining)} remaining</b></div><p className="modal-copy">Choose whether to use banked time or vacation for the remaining hours. You can also leave this as a short day and adjust it later.</p><div className="coverage-actions"><button className="save" onClick={onUseBanked}>Use {fmtHours(prompt.remaining)} Banked</button><button onClick={onUseVacation}>Use Vacation</button><button className="coverage-cancel" onClick={onCancel}>Leave Short Day</button></div></div></div>; }
function TimeOffModal({ type, standardHours, onCancel, onSave }) {
  const [startDay, setStartDay] = useState(dateKey()); const [endDay, setEndDay] = useState(dateKey()); const [hours, setHours] = useState(String(standardHours)); const [notes, setNotes] = useState('');
  const days = startDay && endDay ? listRegularWorkdays(parseDay(startDay), parseDay(endDay)) : [];
  return <div className="modal"><div className="edit-box"><h3>{type === 'vacation' ? 'Log Vacation' : 'Use Banked Time'}</h3><div className="edit-grid"><div className="wide calendar-field-wrap"><label>{type === 'vacation' ? 'Vacation Dates' : 'Banked-Time Dates'}</label><CalendarField mode="range" start={startDay} end={endDay} buttonLabel={dayRangeLabel(startDay, endDay)} onRangeChange={({ start, end }) => { setStartDay(start); setEndDay(end); }} /></div><div className="range-summary wide"><strong>{days.length} regular workday{days.length === 1 ? '' : 's'} selected</strong><span>Weekends and B.C. statutory holidays are skipped.</span></div><label>Hours Per Selected Day<input type="number" min="0.25" max="24" step="0.25" value={hours} onChange={e => setHours(e.target.value)} /></label><div className="range-summary"><strong>{fmtHours((Number(hours) || 0) * days.length)} total</strong><span>{type === 'vacation' ? 'Vacation recorded' : 'Banked time deducted'}</span></div><label className="wide">Notes<textarea placeholder={type === 'vacation' ? 'Optional vacation note' : 'Optional banked-time note'} value={notes} onChange={e => setNotes(e.target.value)} /></label></div><div className="modal-actions"><button onClick={onCancel}>Cancel</button><button className="save" onClick={() => onSave({ type, startDay, endDay, hours: Number(hours) || 0, notes })}>Save</button></div></div></div>;
}
function MonthField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const label = monthLabelFromDay(`${value}-01`);
  return <><button type="button" className="calendar-field" onClick={() => setOpen(true)}>{label}<span>▾</span></button>{open && <MonthPickerModal value={value} onCancel={() => setOpen(false)} onSelect={next => { onChange(next); setOpen(false); }} />}</>;
}
function MonthPickerModal({ value, onCancel, onSelect }) {
  const initialYear = Number(String(value || dateKey()).slice(0, 4)) || new Date().getFullYear();
  const [viewYear, setViewYear] = useState(initialYear);
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return <div className="modal calendar-modal"><div className="edit-box calendar-box month-picker-box"><div className="calendar-modal-head"><h3>Choose Month</h3><button type="button" className="calendar-close" onClick={onCancel}>Close</button></div><div className="calendar-nav"><button type="button" onClick={() => setViewYear(y => y - 1)}>‹</button><strong>{viewYear}</strong><button type="button" onClick={() => setViewYear(y => y + 1)}>›</button></div><div className="month-grid">{monthNames.map((name, index) => { const next = `${viewYear}-${pad(index + 1)}`; return <button type="button" key={name} className={next === value ? 'selected' : ''} onClick={() => onSelect(next)}>{name.slice(0, 3)}</button>; })}</div><div className="calendar-actions"><button type="button" onClick={() => setViewYear(new Date().getFullYear())}>This Year</button></div></div></div>;
}
function YearField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="calendar-field" onClick={() => setOpen(true)}>{value}<span>▾</span></button>{open && <YearPickerModal value={value} onCancel={() => setOpen(false)} onSelect={next => { onChange(next); setOpen(false); }} />}</>;
}
function YearPickerModal({ value, onCancel, onSelect }) {
  const selectedYear = Number(value) || new Date().getFullYear();
  const [startYear, setStartYear] = useState(selectedYear - 5);
  const years = Array.from({ length: 12 }, (_, index) => startYear + index);
  return <div className="modal calendar-modal"><div className="edit-box calendar-box month-picker-box"><div className="calendar-modal-head"><h3>Choose Year</h3><button type="button" className="calendar-close" onClick={onCancel}>Close</button></div><div className="calendar-nav"><button type="button" onClick={() => setStartYear(y => y - 12)}>‹</button><strong>{years[0]} — {years[years.length - 1]}</strong><button type="button" onClick={() => setStartYear(y => y + 12)}>›</button></div><div className="month-grid year-grid">{years.map(next => <button type="button" key={next} className={String(next) === String(value) ? 'selected' : ''} onClick={() => onSelect(String(next))}>{next}</button>)}</div><div className="calendar-actions"><button type="button" onClick={() => setStartYear(new Date().getFullYear() - 5)}>Current Years</button></div></div></div>;
}
function CalendarField({ mode = 'single', value = '', start = '', end = '', onChange, onRangeChange, buttonLabel }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="calendar-field" onClick={() => setOpen(true)}>{buttonLabel || 'Choose date'}<span>▾</span></button>{open && <CalendarPickerModal mode={mode} value={value} start={start} end={end} onCancel={() => setOpen(false)} onSelect={day => { onChange && onChange(day); setOpen(false); }} onRangeSelect={({ start: nextStart, end: nextEnd }) => { onRangeChange && onRangeChange({ start: nextStart, end: nextEnd }); setOpen(false); }} />}</>;
}
function CalendarPickerModal({ mode, value, start, end, onCancel, onSelect, onRangeSelect }) {
  const initialDay = mode === 'range' ? (start || end || dateKey()) : (value || dateKey());
  const [view, setView] = useState(() => parseDay(initialDay)); const [draftStart, setDraftStart] = useState(start || ''); const [draftEnd, setDraftEnd] = useState(end || '');
  const year = view.getFullYear(); const month = view.getMonth(); const first = new Date(year, month, 1, 12); const leading = (first.getDay() + 6) % 7; const days = new Date(year, month + 1, 0).getDate();
  function moveMonth(delta) { setView(v => new Date(v.getFullYear(), v.getMonth() + delta, 1, 12)); }
  function choose(day) { if (mode !== 'range') { onSelect(day); return; } if (!draftStart || (draftStart && draftEnd)) { setDraftStart(day); setDraftEnd(''); return; } if (compareDays(day, draftStart) < 0) { setDraftStart(day); setDraftEnd(draftStart); } else { setDraftEnd(day); } }
  const rangeReady = mode === 'range' && draftStart && draftEnd;
  const title = mode === 'range' ? 'Choose Date Range' : 'Choose Date';
  return <div className="modal calendar-modal"><div className="edit-box calendar-box"><div className="calendar-modal-head"><h3>{title}</h3><button type="button" className="calendar-close" onClick={onCancel}>Close</button></div><div className="calendar-nav"><button type="button" onClick={() => moveMonth(-1)}>‹</button><strong>{view.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong><button type="button" onClick={() => moveMonth(1)}>›</button></div>{mode === 'range' && <div className="calendar-selection">{draftStart ? dayRangeLabel(draftStart, draftEnd) : 'Tap a start date, then an end date.'}</div>}<div className="calendar-weekdays">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <span key={d}>{d}</span>)}</div><div className="calendar-grid">{Array.from({ length: leading }).map((_, i) => <i key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => { const day = `${year}-${pad(month + 1)}-${pad(i + 1)}`; const selected = mode === 'range' ? day === draftStart || day === draftEnd : day === value; const inRange = mode === 'range' && draftStart && draftEnd && compareDays(day, draftStart) > 0 && compareDays(day, draftEnd) < 0; const today = day === dateKey(); return <button type="button" key={day} className={`calendar-day ${selected ? 'selected' : ''} ${inRange ? 'in-range' : ''} ${today ? 'today' : ''}`} onClick={() => choose(day)}>{i + 1}</button>; })}</div><div className="calendar-actions"><button type="button" onClick={() => setView(parseDay(dateKey()))}>Today</button>{mode === 'range' && <button type="button" onClick={() => { setDraftStart(''); setDraftEnd(''); }}>Clear</button>}{mode === 'range' && <button type="button" className="save" disabled={!rangeReady} onClick={() => onRangeSelect({ start: draftStart, end: draftEnd })}>Use Selected Dates</button>}</div></div></div>;
}
function ReportRecordList({ rows, standardHours, onEdit, onDelete, onApplyBanked }) {
  if (!rows.length) return <div className="empty">No records found.</div>;
  return <div className="records">{rows.map(row => {
    if (row.kind === 'holiday') {
      const worked = Number(row.worked || 0);
      return <div className="record holiday-record" key={row.id}>
        <Row label="Date" value={formatDay(row.date)} />
        <Row label="Type" value={worked > 0 ? 'Worked · Stat Holiday' : 'Stat Holiday'} />
        <Row label="Holiday" value={row.holiday.name} amber />
        <Row label="Paid Stat" value={fmtHours(row.paidStatHours)} cyan />
        {worked > 0 && <Row label="Hours Worked" value={fmtHours(worked)} cyan />}
        {worked > 0 && <Row label="Banked Earned" value={`+${fmtHours(row.bankedEarned)}`} cyan />}
        {Number(row.vacationHours || 0) > 0 && <Row label="Vacation" value={fmtHours(row.vacationHours)} amber />}
        {Number(row.bankedHoursUsed || 0) > 0 && <Row label="Banked Used" value={fmtHours(row.bankedHoursUsed)} cyan />}
        <Row label="Status" value={worked > 0 ? 'Paid stat holiday · all worked hours banked' : 'Paid stat holiday'} />
        {row.notes && <Row label="Notes" value={row.notes} />}
      </div>;
    }
    return <RecordList rows={[row]} standardHours={standardHours} onEdit={onEdit} onDelete={onDelete} onApplyBanked={onApplyBanked} />;
  })}</div>;
}
function printableEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function openPrintableReport(report, allTime, workSettings, generatedAt) {
  const rows = report.logRows || [];
  const detailRows = rows.map(row => {
    if (row.kind === 'holiday') {
      return `<tr class="holiday"><td>${printableEscape(formatDay(row.date))}</td><td>${row.worked > 0 ? 'Worked · Stat Holiday' : 'Stat Holiday'}</td><td>—</td><td>—</td><td>${row.worked > 0 ? printableEscape(fmtHours(row.worked)) : '—'}</td><td>${printableEscape(fmtHours(row.paidStatHours))}</td><td>${row.worked > 0 ? printableEscape('+' + fmtHours(row.bankedEarned)) : '—'}</td><td>${printableEscape(`${row.holiday.name} · ${row.worked > 0 ? 'All worked hours banked' : 'Paid stat holiday'}`)}</td></tr>`;
    }
    const h = calcHours(row);
    const type = entryType(row) === 'vacation' ? 'Vacation' : entryType(row) === 'banked' ? 'Banked Time' : (isRegularWorkday(entryDay(row)) ? 'Worked' : 'Worked · Non-scheduled day');
    const bankedEarned = isCompletedWorkEntry(row) ? bankedEarnedForDay(entryDay(row), [row], Number(workSettings.standardDailyHours || 8)) : 0;
    return `<tr><td>${printableEscape(formatDay(entryDay(row)))}</td><td>${type}</td><td>${row.clockIn ? printableEscape(formatTime(row.clockIn)) : '—'}</td><td>${row.clockOut ? printableEscape(formatTime(row.clockOut)) : '—'}</td><td>${row.clockOut ? printableEscape(fmtHours(h.net)) : '—'}</td><td>${Number(row.vacationHours || 0) ? printableEscape(fmtHours(row.vacationHours)) : '—'}</td><td>${bankedEarned ? printableEscape('+' + fmtHours(bankedEarned)) : Number(row.bankedHoursUsed || 0) ? printableEscape('-' + fmtHours(row.bankedHoursUsed)) : '—'}</td><td>${printableEscape(row.notes || '')}</td></tr>`;
  }).join('');
  const summary = [
    ['Scheduled Hours', fmtHours(report.expected)], ['Hours Worked', fmtHours(report.net)],
    ['Paid Stat Holidays', fmtHours(report.paidStatHours)], ['Vacation Taken', fmtHours(report.vacation)],
    ['Banked Time Taken', fmtHours(report.bankedUsed)], ['Total Paid Time', fmtHours(report.paidCovered)],
    [report.difference >= 0 ? 'Extra Work Hours' : 'Hours Below Schedule', `${report.difference >= 0 ? '+' : ''}${fmtHours(Math.abs(report.difference))}`],
    ['Banked Time Earned', `+${fmtHours(report.bankedEarned)}`], ['Banked Time Available', fmtHours(allTime.balance)],
  ].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
  const win = window.open('', '_blank');
  if (!win) { alert('Your browser blocked the print window. Please allow pop-ups for Work Timer and try again.'); return; }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Work Timer Report</title><style>
    @page { size: letter; margin: 0.5in; } * { box-sizing:border-box; } body { font-family: Arial, Helvetica, sans-serif; color:#111827; margin:0; font-size:11px; } .head { border-bottom:3px solid #111827; display:flex; justify-content:space-between; gap:20px; padding-bottom:14px; margin-bottom:20px; } h1 { font-size:31px; letter-spacing:.05em; margin:4px 0 0; } .eyebrow { color:#4b5563; font-weight:800; letter-spacing:.12em; } .range { text-align:right; font-size:14px; font-weight:700; } .generated { color:#4b5563; margin-top:8px; } h2 { margin:19px 0 9px; font-size:18px; border-bottom:1px solid #d1d5db; padding-bottom:6px; } .summary { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; } .stat { min-height:70px; border:1px solid #cbd5e1; padding:10px; } .stat span { display:block; color:#475569; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; } .stat strong { display:block; font-size:20px; margin-top:8px; } .note { border:1px solid #cbd5e1; background:#f8fafc; padding:11px; line-height:1.35; } table { border-collapse:collapse; width:100%; margin-top:10px; } th,td { border:1px solid #cbd5e1; text-align:left; padding:7px; vertical-align:top; } th { background:#f1f5f9; font-size:9px; letter-spacing:.05em; text-transform:uppercase; } tr.holiday td { background:#fffbeb; } @media print { .no-print { display:none; } }
  </style></head><body><div class="head"><div><div class="eyebrow">WORK TIMER</div><h1>TIME &amp; BANKED SUMMARY</h1></div><div class="range">${printableEscape(formatDate(report.start))} – ${printableEscape(formatDate(report.end))}<div class="generated">Generated ${printableEscape(formatDate(generatedAt))} at ${printableEscape(formatTime(generatedAt))}</div></div></div><h2>Summary</h2><div class="summary">${summary}</div><h2>Banked Time</h2><div class="note"><b>Banked Time Earned:</b> +${printableEscape(fmtHours(allTime.earned))}&nbsp;&nbsp;&nbsp; <b>Banked Time Taken:</b> -${printableEscape(fmtHours(allTime.used))}&nbsp;&nbsp;&nbsp; <b>Banked Time Available:</b> ${printableEscape(fmtHours(allTime.balance))}<br><br>Banked time comes from overtime on regular weekdays, plus every physical hour worked on a statutory holiday or non-scheduled day. Vacation stays separate.</div><h2>Detailed Log</h2><table><thead><tr><th>Date</th><th>Type</th><th>Clock In</th><th>Clock Out</th><th>Worked</th><th>Paid Stat / Vacation</th><th>Banked</th><th>Notes</th></tr></thead><tbody>${detailRows || '<tr><td colspan="8">No records found.</td></tr>'}</tbody></table><script>window.onload = () => window.print();<\/script></body></html>`);
  win.document.close();
}
function Processing({ process }) { return <div className="process"><div className="process-box"><div className="process-head"><strong>{process.type} Sequence</strong><span>Running</span></div><div className="process-feed">{process.lines.map((line, i) => <div key={i}><span>&gt;</span> {line}{i === process.lines.length - 1 && <b className="cursor" />}</div>)}</div><div className="progress"><i style={{ width: `${Math.min(100, (process.lines.length / 4) * 100)}%` }} /></div></div></div>; }

export function StartupErrorBoundary({ children }) { return children; }
