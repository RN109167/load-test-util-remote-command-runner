const form = document.getElementById('run-form');
const formError = document.getElementById('form-error');
const resultsBody = document.getElementById('results-body');
// App UI logic: renders the Shortcut Hub, handles command execution,
// file operation modals, and polls job status from the backend.
const hubEl = document.getElementById('shortcut-hub');
const actionsEl = document.getElementById('shortcut-actions');
const busyEl = document.getElementById('busy-indicator');
const ipsTextarea = document.getElementById('ips');
const commandInput = document.getElementById('command');
const runBtn = document.getElementById('run-btn');

// Shortcut command definitions: grouped actions the user can run remotely
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
  'nConnect Mock': {
    Start: 'sh start-nconnectmock.sh',
    Stop: 'sh stop-nconnectmock.sh',
  },
  'MySQL': {
    Start: 'echo palmedia1 | sudo -S systemctl start mysqld',
    Stop: 'echo palmedia1 | sudo -S systemctl stop mysqld',
    Restart: 'echo palmedia1 | sudo -S systemctl restart mysqld',
  },
  'File Operations': ['Copy From VM', 'Upload and Copy Files'],
};

const CATEGORY_ORDER = ['Concentrator', 'Appserver', 'nConnect-Adapter', 'Unload', 'nConnect Mock', 'MySQL', 'File Operations'];
let selectedCategory = null;

let currentIPs = [];

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

// Render the results table for the provided IPs and job data
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

// Render stdout/stderr: detect tabular output and show it in a grid; otherwise use preformatted text
function renderStdout(text) {
  const rows = parseColumns(text);
  if (rows.length > 0) {
    return renderColumnsTable(rows);
  }
  const pre = document.createElement('pre');
  pre.textContent = text;
  return pre;
}

// Parse text into rows/columns when there are 2+ spaces or tab separators
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

// Build an HTML table from rows of columns
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

// Validate IPs and enable/disable actions accordingly
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

// Confirm and start a command across selected IPs
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

// Render category buttons in the Shortcut Hub
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

// Toggle active category and render its actions
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

// Render action buttons for the selected category
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
          const uploadModal = document.getElementById('upload-modal');
          const uploadError = document.getElementById('upload-error');
          if (uploadError) uploadError.classList.add('hidden');
          if (uploadModal) uploadModal.classList.remove('hidden');
        }
        return;
      }
      const command = SHORTCUTS[cat][label];
      await triggerCommand(`${label} ${cat}`, command);
    });
    actionsEl.appendChild(btn);
  });
}

// Disable/enable all hub and action buttons; toggle the busy indicator
function setActionsDisabled(disabled) {
  actionsEl.querySelectorAll('button').forEach(b => b.disabled = disabled);
}

renderCategories();

// Upload & copy flow (modal): send selected file to hosts with optional destination/owner/group
const uploadModal = document.getElementById('upload-modal');
const uploadForm = document.getElementById('upload-form');
const uploadError = document.getElementById('upload-error');
const uploadCancelBtn = document.getElementById('upload-cancel');
const uploadDestInput = document.getElementById('upload-dest-dir');
const uploadFileInput = document.getElementById('upload-file');
const uploadOwnerInput = document.getElementById('upload-owner');
const uploadGroupInput = document.getElementById('upload-group');

uploadCancelBtn && uploadCancelBtn.addEventListener('click', () => {
  uploadModal.classList.add('hidden');
  uploadForm && uploadForm.reset();
  if (uploadError) uploadError.classList.add('hidden');
});

uploadForm && uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  uploadError.classList.add('hidden');
  const ips = sanitizeIPs(ipsTextarea.value);
  if (!validateAllIPs(ips)) {
    uploadError.textContent = ips.length ? 'Please correct invalid IPs before uploading.' : 'Please provide at least one IP address.';
    uploadError.classList.remove('hidden');
    return;
  }
  const file = uploadFileInput && uploadFileInput.files && uploadFileInput.files[0];
  if (!file) {
    uploadError.textContent = 'Please select a file to upload.';
    uploadError.classList.remove('hidden');
    return;
  }
  const destDir = (uploadDestInput?.value || '').trim();
  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  const large = file.size > (1024 * 1024 * 1024); // >1 GB
  const msg = `Upload '${file.name}' (${sizeMB} MB) to ${ips.length} host(s)` + (destDir ? ` at ${destDir}/${file.name}.` : ` at default destination.`) + (large ? `\n\nWarning: Large file; uploads may take time.` : '');
  const proceed = window.confirm(msg);
  if (!proceed) return;
  setDisabledState(true);
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ips', JSON.stringify(ips));
    if (destDir) formData.append('destDir', destDir);
    const owner = (uploadOwnerInput?.value || '').trim();
    const group = (uploadGroupInput?.value || '').trim();
    if (owner) formData.append('owner', owner);
    if (group) formData.append('group', group);
    const res = await fetch('/api/upload-copy', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.ok) {
      uploadError.textContent = data.error || 'Upload failed';
      uploadError.classList.remove('hidden');
      return;
    }
    uploadModal.classList.add('hidden');
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
    uploadError.textContent = 'Network error: ' + err.message;
    uploadError.classList.remove('hidden');
  } finally {
    setDisabledState(false);
    uploadForm && uploadForm.reset();
  }
});

// Copy From VM modal: fetch a file from a source VM and distribute to hosts
const copyModal = document.getElementById('copy-modal');
const copyForm = document.getElementById('copy-form');
const copyError = document.getElementById('copy-error');
const copyCancelBtn = document.getElementById('copy-cancel');
const srcIpInput = document.getElementById('src-ip');
const srcUserInput = document.getElementById('src-user');
const srcPassInput = document.getElementById('src-pass');
const srcPortInput = document.getElementById('src-port');
const srcPathInput = document.getElementById('src-path');
const destDirInput = document.getElementById('dest-dir');
const copyOwnerInput = document.getElementById('copy-owner');
const copyGroupInput = document.getElementById('copy-group');

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
      source: { ip: srcIp, username: srcUser, password: srcPass, port: srcPort, path: srcPath },
      destDir: (destDirInput?.value || '').trim(),
      owner: (copyOwnerInput?.value || '').trim(),
      group: (copyGroupInput?.value || '').trim(),
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
// Execute arbitrary command via the main form
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

// Start a backend job and poll status if needed
async function startJob(ips, command) {
  // Disable controls until job completes (or polling finishes)
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
      // Sync execution: results returned immediately; re-enable controls
      setDisabledState(false);
    } else if (data.jobId) {
      // Async execution: show queued state and begin polling
      renderTable(currentIPs, { statuses: Object.fromEntries(ips.map(ip => [ip, 'queued'])) });
      await pollJob(data.jobId);
    }
  } catch (err) {
    formError.textContent = 'Network error: ' + err.message;
    formError.classList.remove('hidden');
  } finally {
    // Controls remain disabled for async; pollJob will re-enable on completion
  }
}

function setDisabledState(disabled) {
  if (runBtn) runBtn.disabled = disabled;
  // Disable/enable category buttons and currently rendered sub-action buttons
  hubEl.querySelectorAll('button').forEach(b => { b.disabled = disabled; });
  actionsEl.querySelectorAll('button').forEach(b => { b.disabled = disabled; });
  if (busyEl) busyEl.classList.toggle('hidden', !disabled);
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
  // Job completed; re-enable controls
  setDisabledState(false);
}
