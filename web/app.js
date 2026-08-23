const API = window.SUFTRIP_API_URL || '';
const TOKEN_KEY = 'suftrip_demo_token';
const IDENTITY_KEY = 'suftrip_demo_identity';

const $ = (id) => document.getElementById(id);

function token() { return localStorage.getItem(TOKEN_KEY); }
function headers(extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...extra };
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Request failed (${response.status})`);
  return body;
}

function showApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('identity').textContent = 'Customer demo • connected';
  loadExisting();
}

function showLogin() {
  $('login').hidden = false;
  $('app').hidden = true;
  $('identity').textContent = 'Demo delivery platform';
}

$('customerLogin').addEventListener('click', async () => {
  // The API intentionally accepts this only when DEMO_AUTH=true.
  localStorage.setItem(TOKEN_KEY, 'demo:customer');
  localStorage.setItem(IDENTITY_KEY, 'demo-customer');
  try {
    await api('/health', { headers: {} });
    showApp();
  } catch (error) {
    $('formMessage').textContent = error.message;
    localStorage.removeItem(TOKEN_KEY);
  }
});

$('logout').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(IDENTITY_KEY);
  localStorage.removeItem('suftrip_current_delivery');
  showLogin();
});

$('deliveryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('formMessage').textContent = 'Creating delivery…';
  const body = {
    pickup: { address: $('pickupAddress').value.trim(), latitude: Number($('pickupLat').value), longitude: Number($('pickupLng').value) },
    dropoff: { address: $('dropoffAddress').value.trim(), latitude: Number($('dropoffLat').value), longitude: Number($('dropoffLng').value) },
    deliveryType: $('deliveryType').value,
  };
  try {
    const job = await api('/api/v1/delivery-jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    localStorage.setItem('suftrip_current_delivery', job.id);
    render(job);
    $('formMessage').textContent = 'Delivery requested successfully.';
  } catch (error) {
    $('formMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('refresh').addEventListener('click', loadExisting);

async function loadExisting() {
  const id = localStorage.getItem('suftrip_current_delivery');
  if (!id) return;
  try { render(await api(`/api/v1/delivery-jobs/${encodeURIComponent(id)}`)); } catch { localStorage.removeItem('suftrip_current_delivery'); }
}

function render(job) {
  $('empty').hidden = true;
  $('delivery').hidden = false;
  $('refresh').hidden = false;
  const status = String(job.status).replaceAll('_', ' ');
  $('delivery').innerHTML = `
    <div class="tracking-id">${escapeHtml(job.id)}</div>
    <div class="status-pill">${escapeHtml(status)}</div>
    <div class="route"><div><b>Pickup</b><span>${escapeHtml(job.pickup.address)}</span></div><div class="line"></div><div><b>Drop-off</b><span>${escapeHtml(job.dropoff.address)}</span></div></div>
    <div class="meta"><span>Type <b>${escapeHtml(job.deliveryType)}</b></span><span>Version <b>${job.version}</b></span></div>
    <div class="timeline">${timeline(job.status)}</div>`;
}

const stages = ['REQUESTED','SEARCHING_FOR_PROVIDER','PROVIDER_ASSIGNED','PROVIDER_ACCEPTED','PICKED_UP','IN_TRANSIT','DELIVERED'];
function timeline(status) {
  const index = stages.indexOf(status);
  return stages.map((stage, i) => `<div class="stage ${i <= index ? 'done' : ''}"><i></i><span>${stage.replaceAll('_',' ')}</span></div>`).join('');
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

if (token()) showApp(); else showLogin();
