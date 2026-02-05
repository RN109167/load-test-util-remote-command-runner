const form = document.getElementById('run-form');
const formError = document.getElementById('form-error');
const formSuccess = document.getElementById('form-success');
const resultsBody = document.getElementById('results-body');
// App UI logic: renders the Shortcut Hub, handles command execution,
// file operation modals, and polls job status from the backend.
const hubEl = document.getElementById('shortcut-hub');
const actionsEl = document.getElementById('shortcut-actions');
const busyEl = document.getElementById('busy-indicator');
const ipsTextarea = document.getElementById('ips');
const ipsFileInput = document.getElementById('ips-file');
const ipsFileBtn = document.getElementById('ips-file-btn');
const ipsFileName = document.getElementById('ips-file-name');
const ipsClearBtn = document.getElementById('ips-clear-btn');
const commandInput = document.getElementById('command');
const runBtn = document.getElementById('run-btn');

// Common string constants (used 3+ times)
const STRINGS = {
  SUCCESS_ALL: 'All hosts completed successfully.',
  FAILURE_SOME: 'One or more hosts failed. Please review results.',
  NETWORK_ERROR_PREFIX: 'Network error: ',
  NO_FILE_SELECTED: 'No file selected',
  FILE_OPERATIONS: 'File Operations',
};

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
  [STRINGS.FILE_OPERATIONS]: ['Copy From VM', 'Upload and Copy Files'],
};

const CATEGORY_ORDER = ['Concentrator', 'Appserver', 'nConnect-Adapter', 'Unload', 'nConnect Mock', 'MySQL', STRINGS.FILE_OPERATIONS];
let selectedCategory = null;

let currentIPs = [];

// Timers for fading banners
let successTimer = null;
let errorTimer = null;

function clearBannerTimer(timerRef) {
  if (timerRef) {
    clearTimeout(timerRef);
  }
}

function fadeOutBanner(el, durationMs = 300) {
  if (!el) return;
  el.style.transition = `opacity ${durationMs}ms ease`;
  el.style.opacity = '0';
  setTimeout(() => {
    el.classList.add('hidden');
    el.style.opacity = '';
    el.style.transition = '';
  }, durationMs);
}

function showSuccessBanner(text, displayMs = 5000) {
  if (!formSuccess) return;
  // Clear any pending success fade-outs and hide error
  clearBannerTimer(successTimer);
  formError && formError.classList.add('hidden');
  formSuccess.textContent = text || STRINGS.SUCCESS_ALL;
  formSuccess.classList.remove('hidden');
  formSuccess.style.opacity = '1';
  successTimer = setTimeout(() => fadeOutBanner(formSuccess), displayMs);
}

function showErrorBanner(text, displayMs = 5000) {
  if (!formError) return;
  // Clear any pending error fade-outs and hide success
  clearBannerTimer(errorTimer);
  formSuccess && formSuccess.classList.add('hidden');
  formError.textContent = text || STRINGS.FAILURE_SOME;
  formError.classList.remove('hidden');
  formError.style.opacity = '1';
  errorTimer = setTimeout(() => fadeOutBanner(formError), displayMs);
}

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

  // Disable Clear IPs button when textarea is empty
  const hasIpsText = (ipsTextarea?.value || '').trim().length > 0;
  if (ipsClearBtn) ipsClearBtn.disabled = !hasIpsText;

  if (!allValid && ips.length > 0) {
    const invalid = ips.filter(ip => !isValidIPv4(ip));
    formError.textContent = `Invalid IP format: ${invalid.join(', ')}`;
    formError.classList.remove('hidden');
    formSuccess && formSuccess.classList.add('hidden');
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

// Upload IPs file: parse .txt/.csv and fill textarea
ipsFileBtn && ipsFileBtn.addEventListener('click', () => {
  ipsFileInput && ipsFileInput.click();
});

ipsFileInput && ipsFileInput.addEventListener('change', () => {
  formError.classList.add('hidden');
  const file = ipsFileInput.files && ipsFileInput.files[0];
  if (!file) {
    if (ipsFileName) { ipsFileName.textContent = STRINGS.NO_FILE_SELECTED; ipsFileName.classList.add('muted'); }
    return;
  }
  const extOk = /\.txt$|\.csv$/i.test(file.name) || (file.type || '').includes('text');
  if (!extOk) {
    formError.textContent = 'Please upload a .txt or .csv file containing IP addresses.';
    formError.classList.remove('hidden');
    ipsFileInput.value = '';
    if (ipsFileName) { ipsFileName.textContent = STRINGS.NO_FILE_SELECTED; ipsFileName.classList.add('muted'); }
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || '');
      // Split by newline/comma/whitespace and validate IPv4 format
      const tokens = sanitizeIPs(text);
      const invalid = tokens.filter(ip => !isValidIPv4(ip));
      if (!tokens.length || invalid.length) {
        formError.textContent = 'File must contain valid IPv4s separated by new lines or commas.';
        formError.classList.remove('hidden');
        return;
      }
      // Fill textarea with one IP per line
      ipsTextarea.value = tokens.join('\n');
      if (ipsFileName) {
        ipsFileName.textContent = `${file.name} — ${tokens.length} IP(s)`;
        ipsFileName.classList.remove('muted');
      }
      updateToolbarState();
    } catch (err) {
      formError.textContent = 'Unable to parse IP file.';
      formError.classList.remove('hidden');
    }
  };
  reader.onerror = () => {
    formError.textContent = 'Failed to read IP file.';
    formError.classList.remove('hidden');
  };
  reader.readAsText(file);
});

// Clear IPs button: empties the textarea and resets state
ipsClearBtn && ipsClearBtn.addEventListener('click', (e) => {
  e.preventDefault();
  formError.classList.add('hidden');
  ipsTextarea.value = '';
  if (ipsFileName) { ipsFileName.textContent = STRINGS.NO_FILE_SELECTED; ipsFileName.classList.add('muted'); }
  updateToolbarState();
});

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
      if (cat === STRINGS.FILE_OPERATIONS) {
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
const uploadFileBtn = document.getElementById('upload-file-btn');
const uploadFileName = document.getElementById('upload-file-name');
const uploadOwnerInput = document.getElementById('upload-owner');
const uploadGroupInput = document.getElementById('upload-group');

uploadCancelBtn && uploadCancelBtn.addEventListener('click', () => {
  uploadModal.classList.add('hidden');
  uploadForm && uploadForm.reset();
  if (uploadError) uploadError.classList.add('hidden');
  if (uploadFileName) uploadFileName.textContent = 'No file selected';
  // Use constant string
  if (uploadFileName) uploadFileName.textContent = STRINGS.NO_FILE_SELECTED;
});
// Enhanced file input: trigger native picker and show selected filename
uploadFileBtn && uploadFileBtn.addEventListener('click', () => {
  uploadFileInput && uploadFileInput.click();
});

uploadFileInput && uploadFileInput.addEventListener('change', () => {
  const f = uploadFileInput.files && uploadFileInput.files[0];
  if (!uploadFileName) return;
  if (f) {
    const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
    uploadFileName.textContent = `${f.name} (${sizeMB} MB)`;
    uploadFileName.classList.remove('muted');
  } else {
    uploadFileName.textContent = STRINGS.NO_FILE_SELECTED;
    uploadFileName.classList.add('muted');
  }
});


uploadForm && uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Close the dialog immediately on submit
  uploadModal.classList.add('hidden');
  uploadError.classList.add('hidden');
  formSuccess && formSuccess.classList.add('hidden');
  // Also stop any fade timers
  clearBannerTimer(successTimer);
  clearBannerTimer(errorTimer);
  const ips = sanitizeIPs(ipsTextarea.value);
  if (!validateAllIPs(ips)) {
    // Keep processing status in results; dialog remains closed
    return;
  }
  const file = uploadFileInput && uploadFileInput.files && uploadFileInput.files[0];
  if (!file) {
    // No file selected; dialog remains closed
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
      // Surface backend error on the main screen
      showErrorBanner(data.error || 'Upload failed');
    }
    currentIPs = ips;
    const job = { statuses: data.statuses || {}, results: {} };
    for (const ip of ips) {
      job.results[ip] = job.results[ip] || {};
      const r = data.results && data.results[ip];
      if (r && r.dest) job.results[ip].stdout = `Copied to ${r.dest}`;
      if (r && r.error) job.results[ip].stderr = r.error;
    }
    renderTable(currentIPs, job);
    // Show a global message if any host failed
    const statuses = data.statuses || {};
    const anyFailed = ips.some(ip => statuses[ip] !== 'completed');
    if (anyFailed) {
      showErrorBanner(STRINGS.FAILURE_SOME);
    } else {
      showSuccessBanner(STRINGS.SUCCESS_ALL);
    }
  } catch (err) {
    // Network error; modal remains closed and error shown on main screen
    showErrorBanner(STRINGS.NETWORK_ERROR_PREFIX + err.message);
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
  // Close the dialog immediately on submit
  copyModal.classList.add('hidden');
  copyError.classList.add('hidden');
  formSuccess && formSuccess.classList.add('hidden');
  clearBannerTimer(successTimer);
  clearBannerTimer(errorTimer);
  const ips = sanitizeIPs(ipsTextarea.value);
  if (!validateAllIPs(ips)) {
    // Invalid targets; dialog remains closed
    return;
  }
  const srcIp = (srcIpInput?.value || '').trim();
  const srcUser = (srcUserInput?.value || '').trim();
  const srcPass = (srcPassInput?.value || '').trim();
  const srcPort = Number(srcPortInput?.value || 22);
  const srcPath = (srcPathInput?.value || '').trim();
  if (!isValidIPv4(srcIp)) {
    return;
  }
  if (!srcUser || !srcPass || !srcPath) {
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
      // Surface backend error on the main screen
      showErrorBanner(data.error || 'Copy failed');
    }
    currentIPs = ips;
    const job = { statuses: data.statuses || {}, results: {} };
    for (const ip of ips) {
      job.results[ip] = job.results[ip] || {};
      const r = data.results && data.results[ip];
      if (r && r.dest) job.results[ip].stdout = `Copied to ${r.dest}`;
      if (r && r.error) job.results[ip].stderr = r.error;
    }
    renderTable(currentIPs, job);
    // Show a global message if any host failed
    const statuses = data.statuses || {};
    const anyFailed = ips.some(ip => statuses[ip] !== 'completed');
    if (anyFailed) {
      showErrorBanner(STRINGS.FAILURE_SOME);
    } else {
      showSuccessBanner(STRINGS.SUCCESS_ALL);
    }
  } catch (err) {
    // Network error; modal remains closed and error shown on main screen
    showErrorBanner(STRINGS.NETWORK_ERROR_PREFIX + err.message);
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
  formSuccess && formSuccess.classList.add('hidden');
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
    formError.textContent = STRINGS.NETWORK_ERROR_PREFIX + err.message;
    formError.classList.remove('hidden');
  } finally {
    // Controls remain disabled for async; pollJob will re-enable on completion
  }
}

function setDisabledState(disabled) {
  if (runBtn) runBtn.disabled = disabled;
  // Disable/enable category buttons and currently rendered sub-action buttons
  hubEl.querySelectorAll('button').forEach(b => {
    // Keep 'File Operations' category enabled even while busy
    const isFileOpsCat = (b.textContent || '').trim() === STRINGS.FILE_OPERATIONS;
    b.disabled = disabled && !isFileOpsCat;
  });
  actionsEl.querySelectorAll('button').forEach(b => {
    // When busy, only allow actions if current category is 'File Operations'
    const allowActions = selectedCategory === STRINGS.FILE_OPERATIONS;
    b.disabled = disabled && !allowActions;
  });
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
