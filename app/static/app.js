const form = document.getElementById('run-form');
const formError = document.getElementById('form-error');
const resultsBody = document.getElementById('results-body');
// Integrated UI with backend: triggers jobs and polls status
// Dynamic Shortcut Hub
const hubEl = document.getElementById('shortcut-hub');
const actionsEl = document.getElementById('shortcut-actions');
const ipsTextarea = document.getElementById('ips');
const commandInput = document.getElementById('command');
const runBtn = document.getElementById('run-btn');

// Shortcut command definitions
const SHORTCUTS = {
  Concentrator: {
    Start: 'echo palmedia1 | sudo -S systemctl start onelink-concentrator',
    Stop: 'echo palmedia1 | sudo -S systemctl stop onelink-concentrator',
    Restart: 'echo palmedia1 | sudo -S systemctl restart onelink-concentrator',
    Clean: 'echo palmedia1 | sudo -S systemctl stop onelink-concentrator && sudo rm -rf /opt/onelink-concentrator/data/kahadb/*.* && sudo -S systemctl start onelink-concentrator',
  },
  Appserver: {
    Start: 'echo palmedia1 | sudo -S systemctl start onelink-appserver',
    Stop: 'echo palmedia1 | sudo -S systemctl stop onelink-appserver',
    Restart: 'echo palmedia1 | sudo -S systemctl restart onelink-appserver',
  },
  'nConnect-Adapter': {
    Start: 'echo palmedia1 | sudo -S systemctl start onelink-nconnect',
    Stop: 'echo palmedia1 | sudo -S systemctl stop onelink-nconnect',
    Restart: 'echo palmedia1 | sudo -S systemctl restart onelink-nconnect',
  },
  Unload: {
    Start: 'sh start-unload.sh',
    Stop: 'sh stop-unload.sh',
  },
  nConnectMock: {
    Start: 'sh start-nconnectmock.sh',
    Stop: 'sh stop-nconnectmock.sh',
  },
  'File Operations': ['Copy From VM', 'Upload and Copy Files'],
};

const CATEGORY_ORDER = ['Concentrator', 'Appserver', 'nConnect-Adapter', 'Unload', 'nConnectMock', 'File Operations'];
let selectedCategory = null;

let currentIPs = [];
// No payload export/state needed in UI-only phase

function isValidIPv4(ip) {
  // Matches 0-255.0-255.0-255.0-255
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function validateAllIPs(ips) {
  return ips.length > 0 && ips.every(isValidIPv4);
}

function sanitizeIPs(text) {
  return text
    .split(/\n|\r|,|\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function renderTable(ips, job) {
  resultsBody.innerHTML = '';
  ips.forEach(ip => {
    const status = job?.statuses?.[ip] || 'pending';
    const res = job?.results?.[ip] || null;
    const row = document.createElement('tr');

    const tdIP = document.createElement('td');
    tdIP.textContent = ip;

    const tdStatus = document.createElement('td');
    tdStatus.textContent = status;

    const tdExit = document.createElement('td');
    tdExit.textContent = res?.exit_code ?? '';

    const tdOut = document.createElement('td');
    const stdoutNode = renderStdout(res?.stdout ?? '');
    const outWrap = document.createElement('div');
    outWrap.className = 'stdout-wrap';
    outWrap.appendChild(stdoutNode);
    tdOut.appendChild(outWrap);

    const tdErr = document.createElement('td');
    const stderrNode = renderStdout(res?.stderr ?? '');
    const errWrap = document.createElement('div');
    errWrap.className = 'stdout-wrap';
    errWrap.appendChild(stderrNode);
    tdErr.appendChild(errWrap);

    row.appendChild(tdIP);
    row.appendChild(tdStatus);
    row.appendChild(tdExit);
    row.appendChild(tdOut);
    row.appendChild(tdErr);

    resultsBody.appendChild(row);
  });
}

// Generic stdout formatter: try to render columns when output has 2+ space or tab-separated fields
function renderStdout(text) {
  const rows = parseColumns(text);
  if (rows.length > 0) {
    return renderColumnsTable(rows);
  }
  const pre = document.createElement('pre');
  pre.textContent = text;
  return pre;
}

function parseColumns(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const rows = [];
  for (const line of lines) {
    if (!line) continue;
    // Split on 2+ spaces or tabs to preserve tokens with single spaces
    const cols = line.split(/\s{2,}|\t+/).map(c => c.trim()).filter(c => c.length > 0);
    if (cols.length >= 2) rows.push(cols);
  }
  if (rows.length === 0) return [];
  // Normalize to a consistent column count by padding to the max length
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map(r => {
    if (r.length < maxCols) {
      return r.concat(Array(maxCols - r.length).fill(''));
    }
    return r;
  });
}

function renderColumnsTable(rows) {
  const table = document.createElement('table');
  table.className = 'stdout-table';
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const c of r) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function updateToolbarState() {
  const ips = sanitizeIPs(ipsTextarea.value);
  const allValid = validateAllIPs(ips);
  setActionsDisabled(!allValid);
  // Enable Run only when IPs valid and command non-empty
  const cmdFilled = (commandInput?.value || '').trim().length > 0;
  if (runBtn) runBtn.disabled = !(allValid && cmdFilled);

  if (!allValid && ips.length > 0) {
    const invalid = ips.filter(ip => !isValidIPv4(ip));
    formError.textContent = `Invalid IP format: ${invalid.join(', ')}`;
    formError.classList.remove('hidden');
  } else {
    formError.classList.add('hidden');
  }
}

async function triggerCommand(label, command) {
  formError.classList.add('hidden');
  const ips = sanitizeIPs(ipsTextarea.value);
  if (!validateAllIPs(ips)) {
    formError.textContent = ips.length ? 'Please correct invalid IPs before running.' : 'Please provide at least one IP address.';
    formError.classList.remove('hidden');
    updateToolbarState();
    return;
  }
  const confirmed = window.confirm(`Run "${label}" on ${ips.length} host(s)?`);
  if (!confirmed) return;
  await startJob(ips, command);
}

updateToolbarState();
ipsTextarea.addEventListener('input', updateToolbarState);
commandInput && commandInput.addEventListener('input', updateToolbarState);

// Render category buttons
function renderCategories() {
  hubEl.innerHTML = '';
  CATEGORY_ORDER.forEach(cat => {
    const btn = document.createElement('button');
    btn.textContent = cat;
    btn.type = 'button';
    btn.className = 'hub-btn';
    if (selectedCategory === cat) btn.classList.add('selected');
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleCategory(cat); });
    hubEl.appendChild(btn);
  });
}

function toggleCategory(cat) {
  if (selectedCategory === cat) {
    selectedCategory = null;
    actionsEl.innerHTML = '';
    renderCategories();
    return;
  }
  selectedCategory = cat;
  renderCategories();
  renderActions(cat);
}

function renderActions(cat) {
  actionsEl.innerHTML = '';
  const spec = SHORTCUTS[cat];
  const labels = Array.isArray(spec) ? spec : Object.keys(spec);
  labels.forEach(label => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.type = 'button';
    btn.className = 'action-btn';
    // Disable until IPs valid
    const ips = sanitizeIPs(ipsTextarea.value);
    btn.disabled = !validateAllIPs(ips);
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (cat === 'File Operations') {
        if (label === 'Copy From VM') {
          const copyModal = document.getElementById('copy-modal');
          const copyError = document.getElementById('copy-error');
          if (copyError) copyError.classList.add('hidden');
          if (copyModal) copyModal.classList.remove('hidden');
        } else if (label === 'Upload and Copy Files') {
          const fileInput = document.getElementById('file-input');
          if (fileInput) fileInput.click();
        }
        return;
      }
      const command = SHORTCUTS[cat][label];
      await triggerCommand(`${label} ${cat}`, command);
    });
    actionsEl.appendChild(btn);
  });
}

function setActionsDisabled(disabled) {
  actionsEl.querySelectorAll('button').forEach(b => b.disabled = disabled);
}

renderCategories();

// Upload & copy flow
const fileInput = document.getElementById('file-input');

fileInput && fileInput.addEventListener('change', async () => {
  formError.classList.add('hidden');
  const ips = sanitizeIPs(ipsTextarea.value);
  if (!validateAllIPs(ips)) {
    formError.textContent = ips.length ? 'Please correct invalid IPs before uploading.' : 'Please provide at least one IP address.';
    formError.classList.remove('hidden');
    updateToolbarState();
    fileInput.value = '';
    return;
  }
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  // Confirm before distributing file across hosts
  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  const large = file.size > (1024 * 1024 * 1024); // >1 GB
  const msg = `Upload '${file.name}' (${sizeMB} MB) to ${ips.length} host(s) at ~/${file.name}.\nExisting files will be overwritten. Proceed?` + (large ? `\n\nWarning: Large file; uploads may take time.` : '');
  const proceed = window.confirm(msg);
  if (!proceed) {
    fileInput.value = '';
    return;
  }
  setDisabledState(true);
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ips', JSON.stringify(ips));
    const res = await fetch('/api/upload-copy', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!data.ok) {
      formError.textContent = data.error || 'Upload failed';
      formError.classList.remove('hidden');
      return;
    }
    currentIPs = ips;
    // Render results; show destination path in stdout column
    const job = { statuses: data.statuses || {}, results: {} };
    for (const ip of ips) {
      job.results[ip] = job.results[ip] || {};
      const r = data.results && data.results[ip];
      if (r && r.dest) job.results[ip].stdout = `Copied to ${r.dest}`;
      if (r && r.error) job.results[ip].stderr = r.error;
    }
    renderTable(currentIPs, job);
  } catch (err) {
    formError.textContent = 'Network error: ' + err.message;
    formError.classList.remove('hidden');
  } finally {
    setDisabledState(false);
    fileInput.value = '';
  }
});

// Copy From VM modal handlers
const copyModal = document.getElementById('copy-modal');
const copyForm = document.getElementById('copy-form');
const copyError = document.getElementById('copy-error');
const copyCancelBtn = document.getElementById('copy-cancel');
const srcIpInput = document.getElementById('src-ip');
const srcUserInput = document.getElementById('src-user');
const srcPassInput = document.getElementById('src-pass');
const srcPortInput = document.getElementById('src-port');
const srcPathInput = document.getElementById('src-path');

// Opening the modal is now triggered by the Shortcut Hub "Copy From VM" button

copyCancelBtn && copyCancelBtn.addEventListener('click', () => {
  copyModal.classList.add('hidden');
});

copyForm && copyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  copyError.classList.add('hidden');
  const ips = sanitizeIPs(ipsTextarea.value);
  if (!validateAllIPs(ips)) {
    copyError.textContent = ips.length ? 'Please correct invalid target IPs.' : 'Please provide target IPs in the main form.';
    copyError.classList.remove('hidden');
    return;
  }
  const srcIp = (srcIpInput?.value || '').trim();
  const srcUser = (srcUserInput?.value || '').trim();
  const srcPass = (srcPassInput?.value || '').trim();
  const srcPort = Number(srcPortInput?.value || 22);
  const srcPath = (srcPathInput?.value || '').trim();
  if (!isValidIPv4(srcIp)) {
    copyError.textContent = 'Invalid source IP.';
    copyError.classList.remove('hidden');
    return;
  }
  if (!srcUser || !srcPass || !srcPath) {
    copyError.textContent = 'Username, password, and source file path are required.';
    copyError.classList.remove('hidden');
    return;
  }
  const confirmed = window.confirm(`Copy '${srcPath}' from ${srcIp} to ${ips.length} host(s)?`);
  if (!confirmed) return;
  setDisabledState(true);
  try {
    const payload = {
      ips,
      source: { ip: srcIp, username: srcUser, password: srcPass, port: srcPort, path: srcPath }
    };
    const res = await fetch('/api/copy-from-vm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      copyError.textContent = data.error || 'Copy failed';
      copyError.classList.remove('hidden');
      return;
    }
    copyModal.classList.add('hidden');
    currentIPs = ips;
    const job = { statuses: data.statuses || {}, results: {} };
    for (const ip of ips) {
      job.results[ip] = job.results[ip] || {};
      const r = data.results && data.results[ip];
      if (r && r.dest) job.results[ip].stdout = `Copied to ${r.dest}`;
      if (r && r.error) job.results[ip].stderr = r.error;
    }
    renderTable(currentIPs, job);
  } catch (err) {
    copyError.textContent = 'Network error: ' + err.message;
    copyError.classList.remove('hidden');
  } finally {
    setDisabledState(false);
    // Reset form inputs
    if (copyForm) copyForm.reset();
  }
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');

  const ips = sanitizeIPs(ipsTextarea.value);
  const command = (commandInput.value || '').trim();
  // Use backend to execute

  if (!ips.length) {
    formError.textContent = 'Please provide at least one IP address.';
    formError.classList.remove('hidden');
    return;
  }
  if (!command) {
    formError.textContent = 'Please provide a command to run.';
    formError.classList.remove('hidden');
    return;
  }

  await startJob(ips, command);
});

async function startJob(ips, command) {
  setDisabledState(true);
  try {
    const res = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Default to async execution; backend returns a jobId and UI polls
      body: JSON.stringify({ ips, command }),
    });
    const data = await res.json();
    if (!data.ok) {
      formError.textContent = (data.errors && data.errors.join('; ')) || data.error || 'Request failed';
      formError.classList.remove('hidden');
      setDisabledState(false);
      return;
    }
    currentIPs = ips;
    if (data.results) {
      renderTable(currentIPs, { statuses: data.statuses || {}, results: data.results, completed: data.completed });
    } else if (data.jobId) {
      // Fallback to async job mode
      renderTable(currentIPs, { statuses: Object.fromEntries(ips.map(ip => [ip, 'queued'])) });
      await pollJob(data.jobId);
    }
  } catch (err) {
    formError.textContent = 'Network error: ' + err.message;
    formError.classList.remove('hidden');
  } finally {
    setDisabledState(false);
  }
}

function setDisabledState(disabled) {
  if (runBtn) runBtn.disabled = disabled;
  // Disable/enable currently rendered sub-action buttons
  actionsEl.querySelectorAll('button').forEach(b => { b.disabled = disabled; });
  if (!disabled) {
    // Re-apply validation gating when re-enabling controls
    updateToolbarState();
  }
}

async function pollJob(jobId) {
  let completed = false;
  while (!completed) {
    const res = await fetch(`/api/job/${jobId}`);
    const data = await res.json();
    if (!data.ok) {
      formError.textContent = data.error || 'Unknown error';
      formError.classList.remove('hidden');
      break;
    }
    const job = data.job;
    renderTable(currentIPs, job);
    completed = !!job.completed;
    if (!completed) await new Promise(r => setTimeout(r, 1000));
  }
}
