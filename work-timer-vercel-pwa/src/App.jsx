import React, { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'work-timer-local-v1';

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

function getRange(type, monthValue, yearValue) {
  const now = new Date();
  let start = new Date(now);
  let end = endOfDay(now);
  let label = 'Today';

  if (type === 'week') {
    start = startOfWeek(now);
    end = endOfDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
    label = 'This Week';
  } else if (type === 'twoWeeks') {
    start = new Date(now);
    start.setDate(start.getDate() - 13);
    start.setHours(0, 0, 0, 0);
    label = 'Last 2 Weeks';
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
};

export default function App() {
  const [shifts, setShifts] = useState([]);
  const [now, setNow] = useState(new Date());
  const [tab, setTab] = useState('clock');
  const [lunchMinutes, setLunchMinutes] = useState(0);
  const [rangeType, setRangeType] = useState('week');
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [editing, setEditing] = useState(null);
  const [codeLines, setCodeLines] = useState([]);
  const [process, setProcess] = useState(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      setShifts(Array.isArray(saved) ? saved : []);
    } catch {
      setShifts([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shifts));
  }, [shifts]);

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

  function clockIn() {
    if (activeShift) return;
    runProcess('clockIn', () => {
      setLunchMinutes(0);
      setShifts(prev => [{
        id: uid(),
        date: dateKey(),
        clockIn: new Date().toISOString(),
        clockOut: '',
        lunchMinutes: 0,
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, ...prev]);
    });
  }

  function clockOut() {
    if (!activeShift) return;
    runProcess('clockOut', () => {
      setShifts(prev => prev.map(s => s.id === activeShift.id ? {
        ...s,
        clockOut: new Date().toISOString(),
        lunchMinutes,
        updatedAt: new Date().toISOString(),
      } : s));
      setLunchMinutes(0);
    });
  }

  function saveEdit(data) {
    runProcess('update', () => {
      const base = data.clockIn ? new Date(data.clockIn) : new Date();
      const clockIn = combineDateTime(base, data.clockInTime);
      const clockOut = data.clockOutTime ? combineDateTime(base, data.clockOutTime) : '';
      setShifts(prev => prev.map(s => s.id === data.id ? {
        ...s,
        date: dateKey(clockIn),
        clockIn,
        clockOut,
        lunchMinutes: Number(data.lunchMinutes || 0),
        notes: data.notes || '',
        updatedAt: new Date().toISOString(),
      } : s));
      setEditing(null);
    });
  }

  function deleteShift(id) {
    if (!confirm('Delete this shift?')) return;
    runProcess('delete', () => setShifts(prev => prev.filter(s => s.id !== id)));
  }

  function selectReport(next) {
    runProcess('report', () => {
      setRangeType(next);
      setTab('reports');
    });
  }

  const completed = shifts.filter(s => s.clockOut);
  const recent = shifts.slice(0, 20);

  const report = useMemo(() => {
    const r = getRange(rangeType, month, year);
    const rows = completed.filter(s => {
      const d = new Date(s.clockIn);
      return d >= r.start && d <= r.end;
    });
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
  }, [completed, rangeType, month, year]);

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
              <RecordList rows={recent} onEdit={setEditing} onDelete={deleteShift} />
            </Panel>
          </>
        )}

        {tab === 'reports' && (
          <>
            <Panel title="Report Selector">
              <div className="report-buttons">
                {[
                  ['week', 'This Week'],
                  ['twoWeeks', '2 Weeks'],
                  ['mtd', 'MTD'],
                  ['month', 'Month'],
                  ['ytd', 'YTD'],
                  ['year', 'Year'],
                ].map(([key, label]) => (
                  <button key={key} className={`range-btn ${rangeType === key ? 'active' : ''}`} onClick={() => selectReport(key)}>{label}</button>
                ))}
              </div>
              <div className="input-grid">
                <label>Month<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
                <label>Year<input type="number" value={year} onChange={e => setYear(e.target.value)} /></label>
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
  const [clockInTime, setClockInTime] = useState(timeInputValue(shift.clockIn));
  const [clockOutTime, setClockOutTime] = useState(timeInputValue(shift.clockOut));
  const [lunch, setLunch] = useState(String(shift.lunchMinutes || 0));
  const [notes, setNotes] = useState(shift.notes || '');

  return (
    <div className="modal">
      <div className="edit-box">
        <h3>Edit Shift</h3>
        <div className="edit-grid">
          <label>Clock In<input type="time" value={clockInTime} onChange={e => setClockInTime(e.target.value)} /></label>
          <label>Clock Out<input type="time" value={clockOutTime} onChange={e => setClockOutTime(e.target.value)} /></label>
          <label>Lunch<select value={lunch} onChange={e => setLunch(e.target.value)}><option value="0">No Lunch</option><option value="30">30 Minutes</option><option value="60">1 Hour</option></select></label>
          <label className="wide">Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} /></label>
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="save" onClick={() => onSave({ ...shift, clockInTime, clockOutTime, lunchMinutes: lunch, notes })}>Save</button>
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
