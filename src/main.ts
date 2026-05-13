import './style.css';
import { WarEraAPI } from './api';
import Chart from 'chart.js/auto';

// DOM Elements
const countrySearchInput = document.getElementById('countrySearch') as HTMLInputElement;
const countryDropdown = document.getElementById('countryDropdown') as HTMLElement;
const countryIdHidden = document.getElementById('countryId') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const apiKey2Input = document.getElementById('apiKey2') as HTMLInputElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const btnText = startBtn.querySelector('.btn-text') as HTMLElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;

const totalCitizensWealthEl = document.getElementById('totalCitizensWealth') as HTMLElement;
const citizensCountEl = document.getElementById('citizensCount') as HTMLElement;
const scanProgressEl = document.getElementById('scanProgress') as HTMLElement;
const scanTextEl = document.getElementById('scanText') as HTMLElement;
const scanStatusBadge = document.getElementById('scanStatusBadge') as HTMLElement;
const statusDot = document.querySelector('.status-dot') as HTMLElement;

const chartSection = document.getElementById('chartSection') as HTMLElement;
const resultsBody = document.getElementById('resultsBody') as HTMLElement;

// Persist API keys across sessions
apiKeyInput.value = localStorage.getItem('apiKey1') ?? '';
apiKey2Input.value = localStorage.getItem('apiKey2') ?? '';
function checkDuplicateKeys() {
  const k1 = apiKeyInput.value.trim();
  const k2 = apiKey2Input.value.trim();
  const isDuplicate = k1 && k2 && k1 === k2;
  apiKey2Input.setCustomValidity(isDuplicate ? 'Beide Keys sind identisch – Key-Rotation hat keinen Effekt.' : '');
  apiKey2Input.reportValidity();
}

apiKeyInput.addEventListener('input', () => { localStorage.setItem('apiKey1', apiKeyInput.value); checkDuplicateKeys(); });
apiKey2Input.addEventListener('input', () => { localStorage.setItem('apiKey2', apiKey2Input.value); checkDuplicateKeys(); });
checkDuplicateKeys();

let api: WarEraAPI;
let isScanning = false;
let countries: any[] = [];
let wealthChart: Chart | null = null;
let compositionChart: Chart | null = null;

// ---- Country-Cache (24h) ----
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cacheKey = (countryId: string) => `wealth-cache:${countryId}`;
interface CountryCache { timestamp: number; citizens: CitizenData[]; }

function loadCache(countryId: string): CountryCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(countryId));
    if (!raw) return null;
    const cache: CountryCache = JSON.parse(raw);
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(countryId));
      return null;
    }
    return cache;
  } catch { return null; }
}
function saveCache(countryId: string, citizens: CitizenData[]) {
  try {
    localStorage.setItem(cacheKey(countryId), JSON.stringify({ timestamp: Date.now(), citizens }));
  } catch (e) { console.warn('Cache-Speicherung fehlgeschlagen', e); }
}
function formatCacheAge(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `vor ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `vor ${hrs} h ${mins % 60} min`;
}

type SortKey = 'totalWealth' | 'money' | 'companies' | 'items' | 'equipments' | 'weapons';
let sortKey: SortKey = 'totalWealth';
let sortAsc = false;

interface CitizenData {
  citizenId: string;
  username: string;
  level: number;
  totalWealth: number;
  money: number;
  companies: number;
  items: number;
  equipments: number;
  weapons: number;
  lastActivityStr: string;
  diffDays: number;
  diffHours: number;
  lastConnectionAt: string | null;
}

function recomputeActivity(c: CitizenData) {
  if (!c.lastConnectionAt) {
    c.diffHours = 9999; c.diffDays = 999; c.lastActivityStr = 'Unbekannt';
    return;
  }
  const lastConn = new Date(c.lastConnectionAt).getTime();
  const now = Date.now();
  c.diffHours = Math.floor((now - lastConn) / (1000 * 60 * 60));
  c.diffDays = Math.floor(c.diffHours / 24);
  if (c.diffHours < 1) c.lastActivityStr = 'Gerade eben';
  else if (c.diffHours < 24) c.lastActivityStr = `Vor ${c.diffHours} h`;
  else c.lastActivityStr = `Vor ${c.diffDays} d`;
}
let allCitizensData: CitizenData[] = [];

// Initialize API instance for initial fetch without key
api = new WarEraAPI();

// Initialize App
async function init() {
  countrySearchInput.disabled = true;
  countrySearchInput.placeholder = "Lade Länder...";
  
  try {
    const data = await api.getAllCountries();
    if (Array.isArray(data)) {
      countries = data.sort((a, b) => a.name.localeCompare(b.name));
    }
    countrySearchInput.placeholder = "Ländernamen eingeben...";
    countrySearchInput.disabled = false;
  } catch (err) {
    console.error("Fehler beim Laden der Länder", err);
    countrySearchInput.placeholder = "Fehler beim Laden. Land-ID manuell eingeben.";
    countrySearchInput.disabled = false;
    // We can fallback to manual ID entry if autocomplete fails
    setupManualFallback();
  }
}

init();

// Autocomplete Logic
function renderDropdown(filtered: any[]) {
  countryDropdown.innerHTML = '';
  if (filtered.length === 0) {
    countryDropdown.innerHTML = '<div class="dropdown-item empty">Keine Länder gefunden</div>';
    countryDropdown.classList.remove('hidden');
    return;
  }

  filtered.forEach(country => {
    const div = document.createElement('div');
    div.className = 'dropdown-item';
    div.innerHTML = `
      <span class="country-name">${country.name}</span>
      <span class="country-code">${country.code.toUpperCase()}</span>
    `;
    div.addEventListener('click', () => {
      selectCountry(country);
    });
    countryDropdown.appendChild(div);
  });
  countryDropdown.classList.remove('hidden');
}

function selectCountry(country: any) {
  countrySearchInput.value = country.name;
  countryIdHidden.value = country._id;
  countryDropdown.classList.add('hidden');
  startBtn.disabled = false;
  btnText.innerText = 'Scan starten';
  startBtn.classList.add('ready');
  refreshBtn?.classList.remove('hidden');
}

function setupManualFallback() {
  // If countries fail to load, allow entering ID directly into the search
  countrySearchInput.addEventListener('input', () => {
    countryIdHidden.value = countrySearchInput.value.trim();
    if (countryIdHidden.value) {
      startBtn.disabled = false;
      btnText.innerText = 'Scan starten';
      startBtn.classList.add('ready');
      refreshBtn?.classList.remove('hidden');
    } else {
      startBtn.disabled = true;
      btnText.innerText = 'Land auswählen';
      startBtn.classList.remove('ready');
      refreshBtn?.classList.add('hidden');
    }
  });
}

countrySearchInput.addEventListener('input', (e) => {
  const val = (e.target as HTMLInputElement).value.toLowerCase();
  
  if (!val) {
    countryDropdown.classList.add('hidden');
    countryIdHidden.value = '';
    startBtn.disabled = true;
    btnText.innerText = 'Land auswählen';
    startBtn.classList.remove('ready');
    refreshBtn?.classList.add('hidden');
    return;
  }

  if (countries.length > 0) {
    const filtered = countries.filter(c => c.name.toLowerCase().includes(val) || c.code.toLowerCase().includes(val));
    renderDropdown(filtered.slice(0, 10)); // Top 10 results
  }
});

// Hide dropdown on outside click
document.addEventListener('click', (e) => {
  if (!countrySearchInput.contains(e.target as Node) && !countryDropdown.contains(e.target as Node)) {
    countryDropdown.classList.add('hidden');
  }
});

countrySearchInput.addEventListener('focus', () => {
  if (countrySearchInput.value && countries.length > 0) {
    countrySearchInput.dispatchEvent(new Event('input'));
  } else if (!countrySearchInput.value && countries.length > 0) {
    renderDropdown(countries.slice(0, 10));
  }
});


// Scanning Logic
async function runSingleScan(forceRefresh: boolean) {
  if (isScanning) return;
  const countryId = countryIdHidden.value.trim();
  if (!countryId) return alert('Bitte wähle ein Land aus der Liste oder gib eine gültige ID ein.');

  isScanning = true;
  startBtn.disabled = true;
  refreshBtn.disabled = true;
  startBtn.classList.remove('ready');
  btnText.innerText = forceRefresh ? 'Neu-Scan...' : 'Scanne...';

  scanStatusBadge.innerText = 'Scanne';
  scanStatusBadge.className = 'status-label text-warning';
  statusDot.className = 'status-dot warning inner-glow glow-pulse';

  resultsBody.innerHTML = '';
  chartSection.classList.add('hidden');
  if (wealthChart) wealthChart.destroy();
  if (compositionChart) compositionChart.destroy();
  allCitizensData = [];

  scanProgressEl.style.width = '0%';
  scanTextEl.innerText = 'Initialisiere sichere Verbindung...';

  api = new WarEraAPI(apiKeyInput.value.trim(), apiKey2Input.value.trim());
  api.onRateLimit = (ms) => {
    scanTextEl.innerText = `API-Limit erreicht. Warte ${Math.round(ms / 1000)} Sekunden...`;
  };

  try {
    try { await api.getCountry(countryId); } catch (e) { console.warn('Country-Details ignoriert.', e); }
    totalCitizensWealthEl.innerHTML = `<span class="currency-symbol">🪙</span>0`;

    const startTime = Date.now();
    allCitizensData = await scanCountryCitizens(countryId, (info) => {
      citizensCountEl.innerText = info.total.toLocaleString('de-DE');
      if (info.source === 'cache') {
        scanProgressEl.style.width = '100%';
        scanTextEl.innerText = `Aus Cache geladen (${formatCacheAge(info.ageMs)}) · ${info.total} Bürger`;
      } else {
        scanProgressEl.style.width = `${(info.done / Math.max(1, info.total)) * 100}%`;
        const elapsed = Date.now() - startTime;
        const avg = info.done > 0 ? elapsed / info.done : 0;
        const etaMs = avg * (info.total - info.done);
        let etaStr = '';
        if (info.done > 0) {
          const s = Math.round(etaMs / 1000);
          etaStr = s < 60 ? ` (ETA: ~${s}s)` : ` (ETA: ~${Math.floor(s / 60)}m ${s % 60}s)`;
        }
        scanTextEl.innerText = `Analysiere Bürger ${info.done}/${info.total}${etaStr}`;
      }
    }, forceRefresh);

    if (allCitizensData.length === 0) {
      scanTextEl.innerText = 'Keine Bürger-Einträge gefunden.';
      finishScan();
      return;
    }

    renderData();
    finishScan(true);
  } catch (err: any) {
    console.error(err);
    alert(err.message);
    scanTextEl.innerText = 'Systemfehler: Scan abgebrochen.';
    finishScan(false);
  }
}

startBtn.addEventListener('click', () => runSingleScan(false));
refreshBtn?.addEventListener('click', () => runSingleScan(true));

function finishScan(success: boolean = false) {
  isScanning = false;
  startBtn.disabled = false;
  refreshBtn.disabled = false;
  startBtn.classList.add('ready');
  btnText.innerText = 'Land erneut scannen';
  
  if (success) {
    scanStatusBadge.innerText = 'Aktiv';
    scanStatusBadge.className = 'status-label text-success';
    statusDot.className = 'status-dot success inner-glow glow-pulse';
  } else {
    scanStatusBadge.innerText = 'Bereit / Fehler';
    scanStatusBadge.className = 'status-label text-muted';
    statusDot.className = 'status-dot idle inner-glow';
  }
}

function renderData() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const el = th as HTMLElement;
    el.classList.remove('sort-asc', 'sort-desc');
    if (el.dataset.sort === sortKey) el.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
  });

  resultsBody.innerHTML = '';
  let totalWealthSum = 0;
  let filteredData = applySharedFilters(allCitizensData);

  // Kategorie-Filter: bestimmt totalWealth + Anzeige
  const activeCats = getActiveCategories();
  filteredData = filteredData.map(c => {
    const filteredTotal =
      (activeCats.has('money')      ? c.money      : 0) +
      (activeCats.has('companies')  ? c.companies  : 0) +
      (activeCats.has('items')      ? c.items      : 0) +
      (activeCats.has('equipments') ? c.equipments : 0) +
      (activeCats.has('weapons')    ? c.weapons    : 0);
    return { ...c, totalWealth: filteredTotal };
  });

  filteredData.sort((a, b) => {
    const d = a[sortKey] - b[sortKey];
    return sortAsc ? d : -d;
  });

  const fmt = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  filteredData.forEach((c, i) => {
    totalWealthSum += c.totalWealth;

    const tr = document.createElement('tr');
    tr.className = 'citizen-row slide-up';
    tr.style.animationDelay = `${(i % 10) * 0.02}s`;
    tr.innerHTML = `
      <td>
        <div class="citizen-info">
          <div class="avatar-placeholder">
            ${c.username.charAt(0).toUpperCase()}
            <span class="citizen-level">${c.level}</span>
          </div>
          <div class="citizen-details">
            <strong>${c.username}</strong>
            <div class="id-hash">${c.citizenId.substring(0,8)}...</div>
          </div>
        </div>
      </td>
      <td class="wealth-col font-mono">🪙 ${fmt(c.totalWealth)}</td>
      <td class="wealth-col font-mono text-success col-money">${fmt(c.money)}</td>
      <td class="wealth-col font-mono col-companies">${fmt(c.companies)}</td>
      <td class="wealth-col font-mono col-items">${fmt(c.items)}</td>
      <td class="wealth-col font-mono text-muted col-equipments">${fmt(c.equipments)}</td>
      <td class="wealth-col font-mono text-muted col-weapons">${fmt(c.weapons)}</td>
      <td class="activity-col"><span class="activity-badge">${c.lastActivityStr}</span></td>
    `;
    resultsBody.appendChild(tr);
  });

  totalCitizensWealthEl.innerHTML = `<span class="currency-symbol">🪙</span>${totalWealthSum.toLocaleString('de-DE', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
  scanTextEl.innerText = `Anzeige: ${filteredData.length.toLocaleString('de-DE')} von ${allCitizensData.length.toLocaleString('de-DE')} Bürgern.`;

  drawHistogram(filteredData);
  drawCompositionChart(filteredData, activeCats);
  chartSection.classList.remove('hidden');
  applyCategoryVisibility();
}

function getActiveCategories(): Set<string> {
  const set = new Set<string>();
  document.querySelectorAll('.cat-toggle').forEach(cb => {
    const i = cb as HTMLInputElement;
    if (i.checked) set.add(i.dataset.cat!);
  });
  return set;
}

function reapplyFilters() {
  console.log('[reapplyFilters] single=', allCitizensData.length, 'left=', leftGroup.citizens.length, 'right=', rightGroup.citizens.length);
  if (allCitizensData.length > 0) renderData();
  if (leftGroup.citizens.length > 0 || rightGroup.citizens.length > 0) renderComparison();
}

document.getElementById('activity-filter')?.addEventListener('change', reapplyFilters);

function attachSortListeners() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = (th as HTMLElement).dataset.sort as SortKey;
      if (sortKey === key) sortAsc = !sortAsc;
      else { sortKey = key; sortAsc = false; }
      renderData();
    });
  });
}
attachSortListeners();

// ---- CATEGORY VISIBILITY (Tabellen-Spalten) ----
function applyCategoryVisibility() {
  document.querySelectorAll('.cat-toggle').forEach(cb => {
    const i = cb as HTMLInputElement;
    document.querySelectorAll(`.col-${i.dataset.cat}`).forEach(el => {
      (el as HTMLElement).style.display = i.checked ? '' : 'none';
    });
  });
}
document.querySelectorAll('.cat-toggle').forEach(cb => {
  cb.addEventListener('change', () => {
    applyCategoryVisibility();
    reapplyFilters();
  });
});

// ---- LEVEL-RANGE-SLIDER ----
const levelMinSlider = document.getElementById('levelMin') as HTMLInputElement | null;
const levelMaxSlider = document.getElementById('levelMax') as HTMLInputElement | null;
const levelRangeLabel = document.getElementById('levelRangeLabel');
function syncLevelLabel() {
  if (!levelMinSlider || !levelMaxSlider || !levelRangeLabel) return;
  let min = parseInt(levelMinSlider.value, 10);
  let max = parseInt(levelMaxSlider.value, 10);
  if (min > max) [min, max] = [max, min];
  levelRangeLabel.textContent = `${min} – ${max}`;
}
[levelMinSlider, levelMaxSlider].forEach(s => {
  s?.addEventListener('input', () => {
    syncLevelLabel();
    reapplyFilters();
  });
});
syncLevelLabel();

function drawCompositionChart(data: CitizenData[], activeCats: Set<string>) {
  const tiers = [
    { label: 'Level 1-9',   min: 1,  max: 9   },
    { label: 'Level 10-19', min: 10, max: 19  },
    { label: 'Level 20-29', min: 20, max: 29  },
    { label: 'Level 30+',   min: 30, max: 999 },
  ];

  const categories: { key: keyof Pick<CitizenData, 'money'|'companies'|'items'|'equipments'|'weapons'>; label: string; color: string }[] = [
    { key: 'money',      label: 'Bargeld',    color: 'rgba(63,185,80,0.8)'  },
    { key: 'companies',  label: 'Firmen',     color: 'rgba(88,166,255,0.8)' },
    { key: 'items',      label: 'Items',      color: 'rgba(168,85,247,0.8)' },
    { key: 'equipments', label: 'Ausrüstung', color: 'rgba(234,179,8,0.8)'  },
    { key: 'weapons',    label: 'Waffen',     color: 'rgba(248,81,73,0.8)'  },
  ];

  const datasets = categories.filter(cat => activeCats.has(cat.key)).map(cat => ({
    label: cat.label,
    backgroundColor: cat.color,
    data: tiers.map(tier =>
      data.filter(c => c.level >= tier.min && c.level <= tier.max)
          .reduce((sum, c) => sum + c[cat.key], 0)
    ),
  }));

  const ctx2 = (document.getElementById('compositionChart') as HTMLCanvasElement).getContext('2d');
  if (!ctx2) return;
  if (compositionChart) compositionChart.destroy();

  compositionChart = new Chart(ctx2, {
    type: 'bar',
    data: { labels: tiers.map(t => t.label), datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8' } },
        title: {
          display: true,
          text: 'Vermögenszusammensetzung nach Level-Tier',
          color: '#e2e8f0',
          font: { family: 'Inter', size: 16 },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function drawHistogram(data: CitizenData[]) {
  const bins = [0, 100, 500, 1000, 5000, 10000, 50000, Infinity];
  const labels = ['< 100', '100 - 500', '500 - 1k', '1k - 5k', '5k - 10k', '10k - 50k', '> 50k'];
  
  const tiers = [
    { label: 'Level 1-9', min: 1, max: 9, color: 'rgba(148, 163, 184, 0.8)' },
    { label: 'Level 10-19', min: 10, max: 19, color: 'rgba(56, 189, 248, 0.8)' },
    { label: 'Level 20-29', min: 20, max: 29, color: 'rgba(168, 85, 247, 0.8)' },
    { label: 'Level 30+', min: 30, max: 999, color: 'rgba(234, 179, 8, 0.8)' }
  ];

  const datasets = tiers.map(t => ({
    label: t.label,
    data: new Array(labels.length).fill(0),
    backgroundColor: t.color,
    borderWidth: 1,
    borderRadius: 4
  }));

  data.forEach(c => {
    const val = c.totalWealth;
    let binIndex = 0;
    for (let i = 0; i < bins.length - 1; i++) {
      if (val >= bins[i] && val < bins[i+1]) {
        binIndex = i;
        break;
      }
    }
    
    for (const ds of datasets) {
      const t = tiers.find(tier => tier.label === ds.label);
      if (t && c.level >= t.min && c.level <= t.max) {
        ds.data[binIndex]++;
        break;
      }
    }
  });

  const ctx = (document.getElementById('wealthChart') as HTMLCanvasElement).getContext('2d');
  if (!ctx) return;

  if (wealthChart) {
    wealthChart.destroy();
  }

  wealthChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8' } },
        title: {
          display: true,
          text: 'Vermögensverteilung nach Account-Level',
          color: '#e2e8f0',
          font: { family: 'Inter', size: 16 }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: '#94a3b8', stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

// ============================================================
// MODE SWITCHING
// ============================================================
type AppMode = 'single' | 'compare';

function setMode(mode: AppMode) {
  const single = mode === 'single';
  document.querySelectorAll('.single-mode-section').forEach(el => {
    (el as HTMLElement).classList.toggle('hidden', !single);
  });
  // chartSection is managed separately – only show in single mode when there's data
  if (!single) {
    chartSection.classList.add('hidden');
  } else if (allCitizensData.length > 0) {
    chartSection.classList.remove('hidden');
  }
  document.getElementById('compareSection')?.classList.toggle('hidden', single);
  document.querySelectorAll('.mode-tab').forEach(tab => {
    (tab as HTMLElement).classList.toggle('active', (tab as HTMLElement).dataset.mode === mode);
  });
}

document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => setMode((tab as HTMLElement).dataset.mode as AppMode));
});

// ============================================================
// COMPARE MODE
// ============================================================
interface GroupData {
  name: string;
  countries: { id: string; name: string }[];
  citizens: CitizenData[];
}
const leftGroup: GroupData  = { name: 'Gruppe A', countries: [], citizens: [] };
const rightGroup: GroupData = { name: 'Gruppe B', countries: [], citizens: [] };
let compareChart: Chart | null = null;
let isComparing = false;

function setupGroupPicker(group: GroupData, prefix: string) {
  const searchInput = document.getElementById(`${prefix}Search`) as HTMLInputElement;
  const dropdown    = document.getElementById(`${prefix}Dropdown`) as HTMLElement;
  const addBtn      = document.getElementById(`${prefix}AddBtn`) as HTMLButtonElement;
  const chipList    = document.getElementById(`${prefix}Chips`) as HTMLElement;
  const countEl     = document.getElementById(`${prefix}Count`) as HTMLElement;
  const nameInput   = document.getElementById(`${prefix}GroupName`) as HTMLInputElement;

  if (nameInput) nameInput.addEventListener('input', () => { group.name = nameInput.value; });

  let selectedCountry: any = null;

  function renderChips() {
    chipList.innerHTML = '';
    group.countries.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'country-chip';
      chip.innerHTML = `<span>${c.name}</span><button class="chip-remove" type="button">×</button>`;
      chip.querySelector('.chip-remove')!.addEventListener('click', () => {
        group.countries = group.countries.filter(x => x.id !== c.id);
        renderChips(); updateCompareBtn();
      });
      chipList.appendChild(chip);
    });
    if (countEl) countEl.innerText = `${group.countries.length} ${group.countries.length === 1 ? 'Land' : 'Länder'}`;
  }

  function renderGroupDropdown(filtered: any[]) {
    dropdown.innerHTML = '';
    if (filtered.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-item empty">Keine Länder gefunden</div>';
    } else {
      filtered.slice(0, 10).forEach(country => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.innerHTML = `<span class="country-name">${country.name}</span><span class="country-code">${country.code.toUpperCase()}</span>`;
        div.addEventListener('click', () => {
          selectedCountry = country;
          searchInput.value = country.name;
          dropdown.classList.add('hidden');
        });
        dropdown.appendChild(div);
      });
    }
    dropdown.classList.remove('hidden');
  }

  function addSelected() {
    if (!selectedCountry) return;
    if (!group.countries.find(c => c.id === selectedCountry._id)) {
      group.countries.push({ id: selectedCountry._id, name: selectedCountry.name });
      renderChips(); updateCompareBtn();
    }
    selectedCountry = null;
    searchInput.value = '';
    dropdown.classList.add('hidden');
  }

  searchInput.addEventListener('input', () => {
    const val = searchInput.value.toLowerCase();
    selectedCountry = null;
    if (!val) { dropdown.classList.add('hidden'); return; }
    renderGroupDropdown(countries.filter(c =>
      c.name.toLowerCase().includes(val) || c.code.toLowerCase().includes(val)
    ));
  });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSelected(); } });
  addBtn.addEventListener('click', addSelected);

  document.addEventListener('click', e => {
    if (!searchInput.contains(e.target as Node) && !dropdown.contains(e.target as Node))
      dropdown.classList.add('hidden');
  });

  renderChips();
}

function updateCompareBtn() {
  const btn = document.getElementById('compareStartBtn') as HTMLButtonElement;
  if (!btn) return;
  const canCompare = leftGroup.countries.length > 0 && rightGroup.countries.length > 0 && !isComparing;
  btn.disabled = !canCompare;
  btn.classList.toggle('ready', canCompare);
}

type ScanProgress =
  | { source: 'cache'; ageMs: number; done: number; total: number }
  | { source: 'live'; done: number; total: number };

async function scanCountryCitizens(
  countryId: string,
  onProgress: (info: ScanProgress) => void,
  forceRefresh = false
): Promise<CitizenData[]> {
  if (!forceRefresh) {
    const cached = loadCache(countryId);
    if (cached) {
      cached.citizens.forEach(recomputeActivity);
      onProgress({ source: 'cache', ageMs: Date.now() - cached.timestamp, done: cached.citizens.length, total: cached.citizens.length });
      return cached.citizens;
    }
  }

  const result: CitizenData[] = [];
  let citizens: any[] = [];
  let cursor: string | undefined;

  while (true) {
    const usersRes: any = await api.getUsersByCountry(countryId, cursor);
    const data = usersRes?.result?.data || usersRes;
    if (!data?.items) break;
    citizens = citizens.concat(data.items);
    cursor = data.nextCursor;
    if (!cursor) break;
  }

  // Parallel-Pool: API-Wrapper drosselt automatisch bei 429 via Key-Rotation/Retry.
  const CONCURRENCY = 8;
  const slots: (CitizenData | null)[] = new Array(citizens.length).fill(null);
  let next = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= citizens.length) return;
      const citizen = citizens[i];
      const citizenId = citizen._id || citizen;
      let username = citizen.username || 'Unbekannt';
      try {
        const uRes: any = await api.getUserById(citizenId);
        const user = uRes?.result?.data || uRes;
        username = user.username || username;
        const level = user.leveling?.level || 1;
        const wealth = user.stats?.wealth ?? {};
        const lastConnectionAt = user.dates?.lastConnectionAt ?? null;
        const c: CitizenData = {
          citizenId, username, level,
          totalWealth: wealth.total ?? 0, money: wealth.money ?? 0,
          companies: wealth.companies ?? 0, items: wealth.items ?? 0,
          equipments: wealth.equipments ?? 0, weapons: wealth.weapons ?? 0,
          lastActivityStr: 'Unbekannt', diffDays: 999, diffHours: 9999,
          lastConnectionAt,
        };
        recomputeActivity(c);
        slots[i] = c;
      } catch (err) { console.error(`Failed citizen ${citizenId}`, err); }
      done++;
      onProgress({ source: 'live', done, total: citizens.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, citizens.length) }, worker));
  for (const c of slots) if (c) result.push(c);

  saveCache(countryId, result);
  return result;
}

document.getElementById('compareStartBtn')?.addEventListener('click', async () => {
  if (isComparing) return;
  isComparing = true;
  updateCompareBtn();

  const progressWrapper = document.getElementById('compareProgressWrapper') as HTMLElement;
  const progressEl      = document.getElementById('compareProgress') as HTMLElement;
  const progressBar     = document.getElementById('compareProgressBar') as HTMLElement;
  const resultsEl       = document.getElementById('compareResults') as HTMLElement;

  progressWrapper?.classList.remove('hidden');
  resultsEl?.classList.add('hidden');
  leftGroup.citizens  = [];
  rightGroup.citizens = [];

  leftGroup.name  = (document.getElementById('leftGroupName') as HTMLInputElement)?.value  || 'Gruppe A';
  rightGroup.name = (document.getElementById('rightGroupName') as HTMLInputElement)?.value || 'Gruppe B';

  api = new WarEraAPI(apiKeyInput.value.trim(), apiKey2Input.value.trim());
  api.onRateLimit = ms => { progressEl.innerText = `Rate-Limit. Warte ${Math.round(ms / 1000)}s...`; };

  const allWork: { group: GroupData; country: { id: string; name: string } }[] = [];
  [leftGroup, rightGroup].forEach(g => g.countries.forEach(c => allWork.push({ group: g, country: c })));
  const total = allWork.length;
  let done = 0;

  const forceRefresh = (document.getElementById('compareForceRefresh') as HTMLInputElement)?.checked ?? false;

  for (const { group, country } of allWork) {
    const citizens = await scanCountryCitizens(country.id, (info) => {
      const pct = ((done + info.done / Math.max(1, info.total)) / total) * 100;
      progressBar.style.width = `${pct.toFixed(1)}%`;
      if (info.source === 'cache') {
        progressEl.innerText = `${country.name}: Cache ${formatCacheAge(info.ageMs)} · ${info.total} Bürger · Land ${done + 1}/${total}`;
      } else {
        progressEl.innerText = `${country.name}: Bürger ${info.done}/${info.total} · Land ${done + 1}/${total}`;
      }
    }, forceRefresh);
    group.citizens.push(...citizens);
    done++;
  }

  progressBar.style.width = '100%';
  progressEl.innerText = `Vergleich abgeschlossen: ${leftGroup.citizens.length + rightGroup.citizens.length} Bürger analysiert.`;
  renderComparison();
  resultsEl?.classList.remove('hidden');
  isComparing = false;
  updateCompareBtn();
});

function applySharedFilters(citizens: CitizenData[]): CitizenData[] {
  let data = citizens;

  const filterVal = (document.getElementById('activity-filter') as HTMLSelectElement | null)?.value ?? 'all';
  if (filterVal === '24h') data = data.filter(c => c.diffHours < 24);
  else if (filterVal === '3d') data = data.filter(c => c.diffDays <= 3);
  else if (filterVal === '7d') data = data.filter(c => c.diffDays <= 7);
  else if (filterVal === 'inactive') data = data.filter(c => c.diffDays > 7);

  const lvlMinEl = document.getElementById('levelMin') as HTMLInputElement | null;
  const lvlMaxEl = document.getElementById('levelMax') as HTMLInputElement | null;
  if (lvlMinEl && lvlMaxEl) {
    let lvlMin = parseInt(lvlMinEl.value, 10);
    let lvlMax = parseInt(lvlMaxEl.value, 10);
    if (lvlMin > lvlMax) [lvlMin, lvlMax] = [lvlMax, lvlMin];
    data = data.filter(c => c.level >= lvlMin && c.level <= lvlMax);
  }
  return data;
}

function aggregateGroup(citizens: CitizenData[], activeCats: Set<string>) {
  const sumCat = (key: keyof CitizenData) =>
    activeCats.has(key as string) ? citizens.reduce((s, c) => s + (c[key] as number), 0) : 0;
  const money = sumCat('money');
  const companies = sumCat('companies');
  const items = sumCat('items');
  const equipments = sumCat('equipments');
  const weapons = sumCat('weapons');
  return {
    count: citizens.length,
    totalWealth: money + companies + items + equipments + weapons,
    money, companies, items, equipments, weapons,
  };
}

function renderComparison() {
  const fmt = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const activeCats = getActiveCategories();
  const leftFiltered  = applySharedFilters(leftGroup.citizens);
  const rightFiltered = applySharedFilters(rightGroup.citizens);
  console.log('[renderComparison] activeCats=', [...activeCats], 'left raw=', leftGroup.citizens.length, '→filtered=', leftFiltered.length, 'right raw=', rightGroup.citizens.length, '→filtered=', rightFiltered.length);
  const leftAgg  = aggregateGroup(leftFiltered, activeCats);
  const rightAgg = aggregateGroup(rightFiltered, activeCats);

  const lNameEl = document.getElementById('compareLeftName');
  const rNameEl = document.getElementById('compareRightName');
  if (lNameEl) lNameEl.innerText = leftGroup.name;
  if (rNameEl) rNameEl.innerText = rightGroup.name;

  type Agg = ReturnType<typeof aggregateGroup>;
  const allFields: { key: keyof Agg; label: string; currency: boolean; cat?: string }[] = [
    { key: 'count',       label: 'Bürger',      currency: false },
    { key: 'totalWealth', label: 'Gesamt',      currency: true  },
    { key: 'money',       label: 'Bargeld',     currency: true, cat: 'money'      },
    { key: 'companies',   label: 'Firmen',      currency: true, cat: 'companies'  },
    { key: 'items',       label: 'Items',       currency: true, cat: 'items'      },
    { key: 'equipments',  label: 'Ausrüstung',  currency: true, cat: 'equipments' },
    { key: 'weapons',     label: 'Waffen',      currency: true, cat: 'weapons'    },
  ];
  const fields = allFields.filter(f => !f.cat || activeCats.has(f.cat));

  function buildStats(elId: string, agg: Agg, vs: Agg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '';
    fields.forEach(f => {
      const val = agg[f.key] as number;
      const vsVal = vs[f.key] as number;
      const row = document.createElement('div');
      row.className = 'compare-stat-row';
      row.innerHTML = `
        <span class="compare-stat-label">${f.label}</span>
        <span class="compare-stat-value ${val >= vsVal ? 'text-success' : 'text-danger'}">
          ${f.currency ? '🪙 ' + fmt(val) : val.toLocaleString('de-DE')}
        </span>`;
      el.appendChild(row);
    });
    if (agg.count > 0) {
      const avgRow = document.createElement('div');
      avgRow.className = 'compare-stat-row compare-stat-avg';
      avgRow.innerHTML = `
        <span class="compare-stat-label">Ø pro Bürger</span>
        <span class="compare-stat-value">🪙 ${fmt(agg.totalWealth / agg.count)}</span>`;
      el.appendChild(avgRow);
    }
  }
  buildStats('leftGroupStats',  leftAgg,  rightAgg);
  buildStats('rightGroupStats', rightAgg, leftAgg);
  drawComparisonChart(leftAgg, rightAgg, activeCats);
}

function drawComparisonChart(left: ReturnType<typeof aggregateGroup>, right: ReturnType<typeof aggregateGroup>, activeCats: Set<string>) {
  const allCategories: { key: keyof typeof left; label: string }[] = [
    { key: 'money',      label: 'Bargeld'    },
    { key: 'companies',  label: 'Firmen'     },
    { key: 'items',      label: 'Items'      },
    { key: 'equipments', label: 'Ausrüstung' },
    { key: 'weapons',    label: 'Waffen'     },
  ];
  const categories = allCategories.filter(c => activeCats.has(c.key as string));
  const ctx = (document.getElementById('compareChart') as HTMLCanvasElement)?.getContext('2d');
  if (!ctx) return;
  if (compareChart) compareChart.destroy();
  compareChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories.map(c => c.label),
      datasets: [
        { label: leftGroup.name  || 'Gruppe A', data: categories.map(c => left[c.key]),  backgroundColor: 'rgba(88,166,255,0.8)', borderRadius: 4 },
        { label: rightGroup.name || 'Gruppe B', data: categories.map(c => right[c.key]), backgroundColor: 'rgba(248,81,73,0.75)', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8' } },
        title: { display: true, text: 'Finanzieller Vergleich', color: '#e2e8f0', font: { family: 'Inter', size: 16 } },
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

// Init
setupGroupPicker(leftGroup,  'left');
setupGroupPicker(rightGroup, 'right');
updateCompareBtn();

