const form = document.getElementById('run-form');
const formError = document.getElementById('form-error');
const resultsBody = document.getElementById('results-body');
// Table-only UI preview; no backend calls yet
const btnClean = document.getElementById('btn-clean');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnRestart = document.getElementById('btn-restart');
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
  for (const b of [btnClean, btnStart, btnStop, btnRestart]) {
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

function triggerCommand(label, command) {
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
  currentIPs = ips;
  renderTable(currentIPs, { statuses: Object.fromEntries(ips.map(ip => [ip, 'pending'])) });
}

updateToolbarState();
ipsTextarea.addEventListener('input', updateToolbarState);
commandInput && commandInput.addEventListener('input', updateToolbarState);
commandInput && commandInput.addEventListener('input', updateToolbarState);

btnClean && btnClean.addEventListener('click', () => triggerCommand('Clean Concentrators', 'sh clean.sh'));
btnStart && btnStart.addEventListener('click', () => triggerCommand('Start Load Injector', 'sh start.sh'));
btnStop && btnStop.addEventListener('click', () => triggerCommand('Stop Load Injector', 'sh stop.sh'));
btnRestart && btnRestart.addEventListener('click', () => triggerCommand('Restart Load Injector', 'sh restart.sh'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');

  const ips = sanitizeIPs(ipsTextarea.value);
  const command = (commandInput.value || '').trim();
  // No credentials or port needed in UI-only phase

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

  currentIPs = ips;
  renderTable(currentIPs, { statuses: Object.fromEntries(ips.map(ip => [ip, 'queued'])) });

  // Render a local preview of the intended execution plan
  const statuses = Object.fromEntries(ips.map(ip => [ip, 'pending']));
  renderTable(currentIPs, { statuses });
  // Export removed; just render table
});
