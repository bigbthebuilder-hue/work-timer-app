import React, { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'work-timer-local-v1';
const SYNC_SETTINGS_KEY = 'work-timer-sync-settings-v1';

function uid() {
  return crypto?.randomUUID ? crypto.randomUUID() : `shift-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(dateLike = new Date()) {
  const d = new Date(dateLike);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(dateLike) {
  if (!dateLike) return '—';
  return new Date(dateLike).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateLike) {
  if (!dateLike) return '—';
  return new Date(dateLike).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function timeInputValue(dateLike) {
  if (!dateLike) return '';
  const d = new Date(dateLike);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combineDateTime(day, time) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toISOString();
}

function calcHours(shift) {
  if (!shift.clockIn || !shift.clockOut) return { gross: 0, net: 0 };
  const gross = Math.max(0, (new Date(shift.clockOut) - new Date(shift.clockIn)) / 36e5);
  const net = Math.max(0, gross - (Number(shift.lunchMinutes || 0) / 60));
  return { gross, net };
}

function fmtHours(hours) {
  const safe = Math.max(0, Number(hours) || 0);
  const whole = Math.floor(safe);
  const mins = Math.round((safe - whole) * 60);
  if (mins === 60) return `${whole + 1}h 00m`;
  return `${whole}h ${pad(mins)}m`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function endOfWorkWeek(date) {
  const start = startOfWeek(date);
  return endOfDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 4));
}

function getRange(type, monthValue, yearValue, weekCount = 1) {
  const now = new Date();
  let start = new Date(now);
  let end = endOfDay(now);
  let label = 'Today';

  if (type === 'weeks') {
    const weeks = Math.max(1, Number(weekCount) || 1);
    const currentWeekStart = startOfWeek(now);
    start = new Date(currentWeekStart);
    start.setDate(currentWeekStart.getDate() - ((weeks - 1) * 7));
    start.setHours(0, 0, 0, 0);
    end = endOfWorkWeek(now);
    label = weeks === 1 ? 'This Work Week' : `Last ${weeks} Work Weeks`;
  } else if (type === 'mtd') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    label = 'Month To Date';
  } else if (type === 'month') {
    const [y, m] = monthValue.split('-').map(Number);
    start = new Date(y, m - 1, 1);
    end = endOfDay(new Date(y, m, 0));
    label = start.toLocaleDateString([], { month: 'long', year: 'numeric' });
  } else if (type === 'ytd') {
    start = new Date(now.getFullYear(), 0, 1);
    label = 'Year To Date';
  } else if (type === 'year') {
    const y = Number(yearValue) || now.getFullYear();
    start = new Date(y, 0, 1);
    end = endOfDay(new Date(y, 11, 31));
    label = String(y);
  }

  return { start, end, label };
}

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function jsonp(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = `workTimerSync_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const separator = url.includes('?') ? '&' : '?';
    const script = document.createElement('script');
    let done = false;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('Sync timed out.'));
    }, timeoutMs);

    window[callbackName] = data => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      if (data && data.ok === false) reject(new Error(data.error || 'Sync failed.'));
      else resolve(data);
    };

    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('Could not reach Google Sheets sync.'));
    };

    document.body.appendChild(script);
  });
}

function shiftPayload(shift) {
  const h = calcHours(shift);
  return {
    id: shift.id,
    date: shift.date || dateKey(shift.clockIn),
    clockIn: shift.clockIn || '',
    clockOut: shift.clockOut || '',
    lunchMinutes: Number(shift.lunchMinutes || 0),
    grossHours: round2(h.gross),
    netHours: round2(h.net),
    notes: shift.notes || '',
    deleted: !!shift.deleted,
    createdAt: shift.createdAt || shift.updatedAt || new Date().toISOString(),
    updatedAt: shift.updatedAt || new Date().toISOString()
  };
}

function mergeShifts(localRows, cloudRows) {
  const map = new Map();

  [...cloudRows, ...localRows].forEach(row => {
    if (!row || !row.id) return;
    const existing = map.get(row.id);
    if (!existing) {
      map.set(row.id, row);
      return;
    }
    const existingTime = new Date(existing.updatedAt || 0).getTime();
    const rowTime = new Date(row.updatedAt || 0).getTime();
    map.set(row.id, rowTime >= existingTime ? row : existing);
  });

  return Array.from(map.values())
    .filter(row => !row.deleted)
    .sort((a, b) => new Date(b.clockIn || b.updatedAt || 0) - new Date(a.clockIn || a.updatedAt || 0));
}

const idleLines = [
  'SYS// TIME CONSOLE READY',
  'WATCHING INPUT CHANNELS',
  'SHIFT MEMORY LINKED',
  'CLOCK ENGINE STANDBY',
  'LOCAL STORAGE ONLINE',
  'REPORT CACHE IDLE',
  'VERIFYING CHRONO FIELD',
  'AWAITING COMMAND',
  'SCAN: NO ERRORS DETECTED',
  'PANEL LIGHTS NORMAL',
];

const processText = {
  clockIn: ['INITIATING SHIFT RECORD', 'STAMPING START TIME', 'WRITING LOCAL MEMORY', 'CLOCK IN COMPLETE'],
  clockOut: ['CLOSING ACTIVE SHIFT', 'CALCULATING HOURS', 'APPLYING LUNCH DEDUCTION', 'SAVING COMPLETED SHIFT'],
  update: ['LOADING SHIFT RECORD', 'VALIDATING TIME VALUES', 'RECALCULATING TOTALS', 'SAVING REVISION'],
  delete: ['TARGETING RECORD', 'REMOVING LOCAL ENTRY', 'REBUILDING INDEX', 'DELETE COMPLETE'],
  report: ['SCANNING LOCAL ARCHIVE', 'FILTERING DATE RANGE', 'COMPUTING TOTALS', 'RENDERING REPORT'],
  sync: ['OPENING GOOGLE SHEETS LINK', 'WRITING BACKUP RECORDS', 'CONFIRMING CLOUD COPY', 'SYNC COMPLETE'],
  pull: ['CONTACTING GOOGLE SHEETS', 'READING BACKUP RECORDS', 'MERGING LOCAL MEMORY', 'RESTORE COMPLETE'],
};

export default function App() {
  const [shifts, setShifts] = useState([]);
  const [syncQueue, setSyncQueue] = useState([]);
  const [syncSettings, setSyncSettings] = useState(() => loadJson(SYNC_SETTINGS_KEY, { scriptUrl: '', token: 'worktimer' }));
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', message: 'Local only', lastSync: '' });
  const [showSyncSetup, setShowSyncSetup] = useState(false);
  const [now, setNow] = useState(new Date());
  const [tab, setTab] = useState('clock');
  const [lunchMinutes, setLunchMinutes] = useState(0);
  const [rangeType, setRangeType] = useState('weeks');
  const [weekCount, setWeekCount] = useState('1');
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [editing, setEditing] = useState(null);
  const [codeLines, setCodeLines] = useState([]);
  const [process, setProcess] = useState(null);

  useEffect(() => {
    const saved = loadJson(STORAGE_KEY, []);
    if (Array.isArray(saved)) {
      setShifts(saved);
    } else {
      setShifts(Array.isArray(saved.shifts) ? saved.shifts : []);
      setSyncQueue(Array.isArray(saved.syncQueue) ? saved.syncQueue : []);
      if (saved.lastSync) setSyncStatus(s => ({ ...s, lastSync: saved.lastSync, message: 'Ready' }));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ shifts, syncQueue, lastSync: syncStatus.lastSync || '' }));
  }, [shifts, syncQueue, syncStatus.lastSync]);

  useEffect(() => {
    localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(syncSettings));
  }, [syncSettings]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const add = () => {
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setCodeLines(lines => [...lines.slice(-7), `[${stamp}] ${idleLines[Math.floor(Math.random() * idleLines.length)]}`]);
    };
    add();
    const t = setInterval(add, 1300);
    return () => clearInterval(t);
  }, []);


  useEffect(() => {
    if (!syncSettings.scriptUrl || !syncSettings.token || !syncQueue.length) return;
    const t = setTimeout(() => syncPending(false), 1500);
    return () => clearTimeout(t);
  }, [syncQueue.length, syncSettings.scriptUrl, syncSettings.token]);

  const activeShift = shifts.find(s => !s.clockOut);
  const live = activeShift ? calcHours({ ...activeShift, clockOut: now.toISOString(), lunchMinutes }) : { net: 0 };

  function runProcess(type, callback) {
    setProcess({ type, lines: [] });
    const lines = processText[type] || processText.report;
    lines.forEach((line, i) => {
      setTimeout(() => {
        setProcess(p => p ? { ...p, lines: [...p.lines, line] } : p);
      }, i * 260);
    });
    setTimeout(() => {
      callback();
      setProcess(p => p ? { ...p, lines: [...p.lines, 'PROCESS COMPLETE'] } : p);
    }, lines.length * 260 + 120);
    setTimeout(() => setProcess(null), lines.length * 260 + 950);
  }


  function queueSync(id) {
    setSyncQueue(prev => Array.from(new Set([...prev, id])));
  }

  function saveShift(nextShift) {
    setShifts(prev => {
      const exists = prev.some(s => s.id === nextShift.id);
      return exists ? prev.map(s => s.id === nextShift.id ? nextShift : s) : [nextShift, ...prev];
    });
    queueSync(nextShift.id);
  }

  function syncUrl(action, extra = {}) {
    const params = new URLSearchParams({
      action,
      token: syncSettings.token || '',
      ...extra,
    });
    return `${String(syncSettings.scriptUrl || '').trim()}?${params.toString()}`;
  }

  async function syncPending(showProcess = true) {
    if (!syncSettings.scriptUrl || !syncSettings.token) {
      setShowSyncSetup(true);
      setSyncStatus(s => ({ ...s, state: 'error', message: 'Sync not set up' }));
      return;
    }

    const ids = syncQueue.length ? syncQueue : shifts.map(s => s.id);
    const rows = shifts.filter(s => ids.includes(s.id)).map(shiftPayload);

    if (!rows.length) {
      setSyncStatus(s => ({ ...s, state: 'idle', message: 'Nothing to sync' }));
      return;
    }

    const doSync = async () => {
      try {
        setSyncStatus(s => ({ ...s, state: 'syncing', message: `Syncing ${rows.length} record(s)...` }));
        for (const row of rows) {
          const payload = JSON.stringify(row);
          await jsonp(syncUrl('upsert', { payload }));
          setSyncQueue(prev => prev.filter(id => id !== row.id));
        }
        setSyncStatus({ state: 'ok', message: 'Synced to Google Sheets', lastSync: new Date().toISOString() });
      } catch (err) {
        setSyncStatus(s => ({ ...s, state: 'error', message: err.message || 'Sync failed' }));
      }
    };

    if (showProcess) runProcess('sync', doSync);
    else doSync();
  }

  async function restoreFromSheets() {
    if (!syncSettings.scriptUrl || !syncSettings.token) {
      setShowSyncSetup(true);
      setSyncStatus(s => ({ ...s, state: 'error', message: 'Sync not set up' }));
      return;
    }

    runProcess('pull', async () => {
      try {
        setSyncStatus(s => ({ ...s, state: 'syncing', message: 'Restoring from Google Sheets...' }));
        const result = await jsonp(syncUrl('list'));
        const cloudRows = Array.isArray(result.rows) ? result.rows : [];
        const merged = mergeShifts(shifts, cloudRows);
        setShifts(merged);
        setSyncQueue([]);
        setSyncStatus({ state: 'ok', message: `Restored ${cloudRows.length} cloud record(s)`, lastSync: new Date().toISOString() });
      } catch (err) {
        setSyncStatus(s => ({ ...s, state: 'error', message: err.message || 'Restore failed' }));
      }
    });
  }

  function addManualShift() {
    const start = new Date();
    start.setHours(8, 0, 0, 0);
    const end = new Date();
    end.setHours(17, 0, 0, 0);

    const shift = {
      id: uid(),
      date: dateKey(),
      clockIn: start.toISOString(),
      clockOut: end.toISOString(),
      lunchMinutes: 0,
      notes: 'Manual entry',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveShift(shift);
    setEditing(shift);
  }


  function clockIn() {
    if (activeShift) return;
    runProcess('clockIn', () => {
      setLunchMinutes(0);
      saveShift({
        id: uid(),
        date: dateKey(),
        clockIn: new Date().toISOString(),
        clockOut: '',
        lunchMinutes: 0,
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  }

  function clockOut() {
    if (!activeShift) return;
    runProcess('clockOut', () => {
      saveShift({
        ...activeShift,
        clockOut: new Date().toISOString(),
        lunchMinutes,
        updatedAt: new Date().toISOString(),
      });
      setLunchMinutes(0);
    });
  }

  function saveEdit(data) {
    runProcess('update', () => {
      const base = data.shiftDate ? new Date(data.shiftDate + 'T00:00:00') : (data.clockIn ? new Date(data.clockIn) : new Date());
      const clockIn = combineDateTime(base, data.clockInTime);
      const clockOut = data.clockOutTime ? combineDateTime(base, data.clockOutTime) : '';
      saveShift({
        ...data,
        date: dateKey(clockIn),
        clockIn,
        clockOut,
        lunchMinutes: Number(data.lunchMinutes || 0),
        notes: data.notes || '',
        updatedAt: new Date().toISOString(),
      });
      setEditing(null);
    });
  }

  function deleteShift(id) {
    if (!confirm('Delete this shift?')) return;
    runProcess('delete', () => {
      const found = shifts.find(s => s.id === id);
      if (found) saveShift({ ...found, deleted: true, updatedAt: new Date().toISOString() });
      setShifts(prev => prev.filter(s => s.id !== id));
    });
  }

  function selectReport(next) {
    runProcess('report', () => {
      setRangeType(next);
      setTab('reports');
    });
  }

  const visibleShifts = shifts.filter(s => !s.deleted);
  const completed = visibleShifts.filter(s => s.clockOut);
  const recent = visibleShifts.slice(0, 20);

  const report = useMemo(() => {
    const r = getRange(rangeType, month, year, weekCount);
    const rows = completed
      .filter(s => {
        const d = new Date(s.clockIn);
        return d >= r.start && d <= r.end;
      })
      .sort((a, b) => new Date(b.clockIn || 0) - new Date(a.clockIn || 0));
    let gross = 0, net = 0, lunch = 0;
    const days = new Set();
    rows.forEach(s => {
      const h = calcHours(s);
      gross += h.gross;
      net += h.net;
      lunch += Number(s.lunchMinutes || 0) / 60;
      days.add(dateKey(s.clockIn));
    });
    return { ...r, rows, gross, net, lunch, days: days.size, avg: days.size ? net / days.size : 0 };
  }, [completed, rangeType, month, year, weekCount]);

  function exportCsv() {
    const header = 'Date,Clock In,Clock Out,Lunch Minutes,Gross Hours,Net Hours,Notes\n';
    const body = completed.map(s => {
      const h = calcHours(s);
      return [
        formatDate(s.clockIn),
        formatTime(s.clockIn),
        formatTime(s.clockOut),
        s.lunchMinutes || 0,
        round2(h.gross),
        round2(h.net),
        `"${String(s.notes || '').replaceAll('"', '""')}"`
      ].join(',');
    }).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'work-timer-export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="page">
      {process && <Processing process={process} />}

      <div className="shell">
        <header className="top">
          <div>
            <div className="eyebrow"><span className="power-dot" /> Time Control Console</div>
            <h1>Work Timer</h1>
            <p>Phone-first work timer. Data is saved locally on this device.</p>
          </div>
          <div className="clock-card">
            <div className="digital">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div className="date-line">{now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
          </div>
        </header>

        <nav className="tabs">
          <button className={`tab ${tab === 'clock' ? 'active' : ''}`} onClick={() => setTab('clock')}>Clock</button>
          <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>Reports</button>
        </nav>


        <SyncPanel
          syncSettings={syncSettings}
          setSyncSettings={setSyncSettings}
          syncStatus={syncStatus}
          pendingCount={syncQueue.length}
          showSetup={showSyncSetup}
          setShowSetup={setShowSyncSetup}
          onSync={() => syncPending(true)}
          onRestore={restoreFromSheets}
        />

        {tab === 'clock' && (
          <>
            <Panel title="Main Control" lamp={activeShift}>
              <div className="dummy-grid"><i /><i /><i className="amber" /><i /></div>
              <div className="button-deck">
                <button className={`big-btn btn-in ${activeShift ? 'disabled' : ''}`} onClick={clockIn}>Clock In</button>
                <button className={`big-btn btn-out ${!activeShift ? 'disabled' : ''}`} onClick={clockOut}>Clock Out</button>
              </div>
              <div className="readouts">
                <Readout label="Status" value={activeShift ? 'Clocked In' : 'Standby'} />
                <Readout label="Started" value={activeShift ? formatTime(activeShift.clockIn) : '—'} />
                <Readout label="Live Total" value={activeShift ? fmtHours(live.net) : '—'} cyan />
              </div>
            </Panel>

            <Panel title="Lunch Controls" lamp={lunchMinutes > 0}>
              <div className="lunch-buttons">
                <LunchButton active={lunchMinutes === 0} label="No Lunch" sub="No deduction from this shift." onClick={() => setLunchMinutes(0)} />
                <LunchButton active={lunchMinutes === 30} label="30 Minutes" sub="Subtract half an hour at clock out." onClick={() => setLunchMinutes(30)} />
                <LunchButton active={lunchMinutes === 60} label="1 Hour" sub="Subtract one full hour at clock out." onClick={() => setLunchMinutes(60)} />
              </div>
              <div className="lunch-status">Current lunch deduction: {lunchMinutes} minutes</div>
            </Panel>

            <Panel title="System Activity" lamp>
              <div className="system-screen">
                <div className="screen-row"><strong>Console Memory Feed</strong><span>Idle Loop</span></div>
                <div className="code-feed">
                  {codeLines.map((line, i) => <div key={i}><span>&gt;</span> {line}{i === codeLines.length - 1 && <b className="cursor" />}</div>)}
                </div>
                <div className="meters"><i /><i /><i /></div>
              </div>
            </Panel>

            <Panel title="Recent Shifts">
              <button className="export-btn secondary" onClick={addManualShift}>Add Manual Shift</button>
              <RecordList rows={recent} onEdit={setEditing} onDelete={deleteShift} />
            </Panel>
          </>
        )}

        {tab === 'reports' && (
          <>
            <Panel title="Report Selector">
              <div className="report-buttons">
                {[
                  ['weeks', 'Choose Weeks'],
                  ['mtd', 'MTD'],
                  ['month', 'Choose Month'],
                  ['ytd', 'YTD'],
                  ['year', 'Choose Year'],
                ].map(([key, label]) => (
                  <button key={key} className={`range-btn ${rangeType === key ? 'active' : ''}`} onClick={() => selectReport(key)}>{label}</button>
                ))}
              </div>
              <div className="input-grid">
                <label>Number of Work Weeks
                  <select value={weekCount} onChange={e => { setWeekCount(e.target.value); setRangeType('weeks'); }}>
                    <option value="1">1 week: this Monday to Friday</option>
                    <option value="2">2 consecutive work weeks</option>
                    <option value="3">3 consecutive work weeks</option>
                    <option value="4">4 consecutive work weeks</option>
                    <option value="5">5 consecutive work weeks</option>
                    <option value="6">6 consecutive work weeks</option>
                    <option value="8">8 consecutive work weeks</option>
                  </select>
                </label>
                <label>Choose Month<input type="month" value={month} onChange={e => { setMonth(e.target.value); setRangeType('month'); }} /></label>
                <label>Choose Year<input type="number" value={year} onChange={e => { setYear(e.target.value); setRangeType('year'); }} /></label>
              </div>
            </Panel>

            <Panel title={report.label}>
              <div className="stats">
                <Stat label="Net Hours" value={round2(report.net)} sub="After lunch" />
                <Stat label="Days Worked" value={report.days} sub="Unique days" />
                <Stat label="Avg / Day" value={round2(report.avg)} sub="Worked days only" />
              </div>
              <div className="readouts">
                <Readout label="Gross Hours" value={round2(report.gross)} />
                <Readout label="Lunch Hours" value={round2(report.lunch)} amber />
                <Readout label="Range" value={`${formatDate(report.start)} - ${formatDate(report.end)}`} />
              </div>
              <button className="export-btn" onClick={exportCsv}>Export CSV</button>
            </Panel>

            <Panel title="Report Shifts">
              <RecordList rows={report.rows} onEdit={setEditing} onDelete={deleteShift} />
            </Panel>
          </>
        )}
      </div>

      {editing && <EditModal shift={editing} onCancel={() => setEditing(null)} onSave={saveEdit} />}
    </div>
  );
}

function Panel({ title, children, lamp }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2><span className="panel-marker" /> {title}</h2>
        <div className={`lamp ${lamp ? 'on' : ''}`} />
      </div>
      {children}
    </section>
  );
}


function SyncPanel({ syncSettings, setSyncSettings, syncStatus, pendingCount, showSetup, setShowSetup, onSync, onRestore }) {
  return (
    <section className="panel sync-panel">
      <div className="panel-head">
        <h2><span className="panel-marker" /> Sheet Sync</h2>
        <div className={`lamp ${syncStatus.state === 'ok' ? 'on' : ''}`} />
      </div>

      <div className="sync-status">
        <div>
          <strong>{syncStatus.message || 'Local only'}</strong>
          <small>{pendingCount} pending sync item(s){syncStatus.lastSync ? ` • last sync ${formatTime(syncStatus.lastSync)}` : ''}</small>
        </div>
        <button onClick={() => setShowSetup(!showSetup)}>{showSetup ? 'Hide' : 'Setup'}</button>
      </div>

      {showSetup && (
        <div className="sync-setup">
          <label>Apps Script Web App URL
            <input value={syncSettings.scriptUrl} onChange={e => setSyncSettings(s => ({ ...s, scriptUrl: e.target.value }))} placeholder="https://script.google.com/macros/s/.../exec" />
          </label>
          <label>Sync Token
            <input value={syncSettings.token} onChange={e => setSyncSettings(s => ({ ...s, token: e.target.value }))} />
          </label>
        </div>
      )}

      <div className="sync-actions">
        <button onClick={onSync}>Sync Now</button>
        <button onClick={onRestore}>Restore From Sheet</button>
      </div>
    </section>
  );
}

function Readout({ label, value, cyan, amber }) {
  return <div className="readout"><div>{label}</div><strong className={cyan ? 'cyan' : amber ? 'amber' : ''}>{value}</strong></div>;
}

function LunchButton({ active, label, sub, onClick }) {
  return <button className={`lunch-btn ${active ? 'active' : ''}`} onClick={onClick}>{label}<small>{sub}</small></button>;
}

function Stat({ label, value, sub }) {
  return <div className="stat"><div>{label}</div><strong>{value}</strong><small>{sub}</small></div>;
}

function RecordList({ rows, onEdit, onDelete }) {
  if (!rows.length) return <div className="empty">No shifts found.</div>;
  return (
    <div className="records">
      {rows.map(s => {
        const h = calcHours(s);
        return (
          <div className="record" key={s.id}>
            <Row label="Date" value={formatDate(s.clockIn)} />
            <Row label="In" value={formatTime(s.clockIn)} />
            <Row label="Out" value={s.clockOut ? formatTime(s.clockOut) : '—'} />
            <Row label="Lunch" value={`${s.lunchMinutes || 0}m`} />
            <Row label="Net" value={s.clockOut ? round2(h.net) : 'Active'} cyan />
            <Row label="Status" value={s.clockOut ? 'Complete' : 'Active'} />
            {s.notes && <Row label="Notes" value={s.notes} />}
            <div className="actions">
              <button onClick={() => onEdit(s)}>Edit</button>
              {s.clockOut && <button className="danger" onClick={() => onDelete(s.id)}>Delete</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value, cyan }) {
  return <div className="record-row"><span>{label}</span><strong className={cyan ? 'cyan' : ''}>{value}</strong></div>;
}

function EditModal({ shift, onCancel, onSave }) {
  const [shiftDate, setShiftDate] = useState(dateKey(shift.clockIn || new Date()));
  const [clockInTime, setClockInTime] = useState(timeInputValue(shift.clockIn));
  const [clockOutTime, setClockOutTime] = useState(timeInputValue(shift.clockOut));
  const [lunch, setLunch] = useState(String(shift.lunchMinutes || 0));
  const [notes, setNotes] = useState(shift.notes || '');

  return (
    <div className="modal">
      <div className="edit-box">
        <h3>Edit Shift</h3>
        <div className="edit-grid">
          <label className="wide">Date<input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} /></label>
          <label>Clock In<input type="time" value={clockInTime} onChange={e => setClockInTime(e.target.value)} /></label>
          <label>Clock Out<input type="time" value={clockOutTime} onChange={e => setClockOutTime(e.target.value)} /></label>
          <label>Lunch<select value={lunch} onChange={e => setLunch(e.target.value)}><option value="0">No Lunch</option><option value="30">30 Minutes</option><option value="60">1 Hour</option></select></label>
          <label className="wide">Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} /></label>
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="save" onClick={() => onSave({ ...shift, shiftDate, clockInTime, clockOutTime, lunchMinutes: lunch, notes })}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Processing({ process }) {
  return (
    <div className="process">
      <div className="process-box">
        <div className="process-head"><strong>{process.type} Sequence</strong><span>Running</span></div>
        <div className="process-feed">
          {process.lines.map((line, i) => <div key={i}><span>&gt;</span> {line}{i === process.lines.length - 1 && <b className="cursor" />}</div>)}
        </div>
        <div className="progress"><i style={{ width: `${Math.min(100, (process.lines.length / 4) * 100)}%` }} /></div>
      </div>
    </div>
  );
}
