const form = document.getElementById('run-form');
const formError = document.getElementById('form-error');
const resultsBody = document.getElementById('results-body');
// Integrated UI with backend: triggers jobs and polls status
const btnClean = document.getElementById('btn-clean');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnRestart = document.getElementById('btn-restart');
const btnUpload = document.getElementById('btn-upload');
const ipsTextarea = document.getElementById('ips');
const commandInput = document.getElementById('command');
const runBtn = document.getElementById('run-btn');

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
    tdOut.textContent = res?.stdout ?? '';

    const tdErr = document.createElement('td');
    tdErr.textContent = res?.stderr ?? '';

    row.appendChild(tdIP);
    row.appendChild(tdStatus);
    row.appendChild(tdExit);
    row.appendChild(tdOut);
    row.appendChild(tdErr);

    resultsBody.appendChild(row);
  });
}

// UI-only: no backend calls. We just render a preview.

function updateToolbarState() {
  const ips = sanitizeIPs(ipsTextarea.value);
  const allValid = validateAllIPs(ips);
  const disabled = !allValid;
  for (const b of [btnClean, btnStart, btnStop, btnRestart, btnUpload]) {
    if (b) b.disabled = disabled;
  }
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
  const confirmed = window.confirm(`Run "${label}" (\`${command}\`) on ${ips.length} host(s)?`);
  if (!confirmed) return;
  await startJob(ips, command);
}

updateToolbarState();
ipsTextarea.addEventListener('input', updateToolbarState);
commandInput && commandInput.addEventListener('input', updateToolbarState);
commandInput && commandInput.addEventListener('input', updateToolbarState);

btnClean && btnClean.addEventListener('click', () => triggerCommand('Clean Concentrators', 'sh clean.sh'));
btnStart && btnStart.addEventListener('click', () => triggerCommand('Start Load Injector', 'sh start.sh'));
btnStop && btnStop.addEventListener('click', () => triggerCommand('Stop Load Injector', 'sh stop.sh'));
btnRestart && btnRestart.addEventListener('click', () => triggerCommand('Restart Load Injector', 'sh restart.sh'));

// Upload & copy flow
const fileInput = document.getElementById('file-input');
btnUpload && btnUpload.addEventListener('click', () => {
  fileInput && fileInput.click();
});

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
      // Request synchronous execution to get immediate output and avoid polling
      body: JSON.stringify({ ips, command, mode: 'sync' }),
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
  for (const b of [btnClean, btnStart, btnStop, btnRestart, btnUpload]) {
    if (b) b.disabled = disabled;
  }
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
