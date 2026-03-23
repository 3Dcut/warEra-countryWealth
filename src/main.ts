import './style.css';
import { WarEraAPI } from './api';
import Chart from 'chart.js/auto';

// DOM Elements
const countrySearchInput = document.getElementById('countrySearch') as HTMLInputElement;
const countryDropdown = document.getElementById('countryDropdown') as HTMLElement;
const countryIdHidden = document.getElementById('countryId') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const btnText = startBtn.querySelector('.btn-text') as HTMLElement;

const totalCitizensWealthEl = document.getElementById('totalCitizensWealth') as HTMLElement;
const citizensCountEl = document.getElementById('citizensCount') as HTMLElement;
const scanProgressEl = document.getElementById('scanProgress') as HTMLElement;
const scanTextEl = document.getElementById('scanText') as HTMLElement;
const scanStatusBadge = document.getElementById('scanStatusBadge') as HTMLElement;
const statusDot = document.querySelector('.status-dot') as HTMLElement;

const chartSection = document.getElementById('chartSection') as HTMLElement;
const resultsBody = document.getElementById('resultsBody') as HTMLElement;

let api: WarEraAPI;
let isScanning = false;
let countries: any[] = [];
let wealthChart: Chart | null = null;

interface CitizenData {
  citizenId: string;
  username: string;
  level: number;
  totalWealth: number;
  totalCompanyValue: number;
  liquidAssets: number;
  lastActivityStr: string;
  diffDays: number;
  diffHours: number;
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
}

function setupManualFallback() {
  // If countries fail to load, allow entering ID directly into the search
  countrySearchInput.addEventListener('input', () => {
    countryIdHidden.value = countrySearchInput.value.trim();
    if (countryIdHidden.value) {
      startBtn.disabled = false;
      btnText.innerText = 'Scan starten';
      startBtn.classList.add('ready');
    } else {
      startBtn.disabled = true;
      btnText.innerText = 'Land auswählen';
      startBtn.classList.remove('ready');
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
startBtn.addEventListener('click', async () => {
  if (isScanning) return;
  const countryId = countryIdHidden.value.trim();
  if (!countryId) return alert('Bitte wähle ein Land aus der Liste oder gib eine gültige ID ein.');

  isScanning = true;
  startBtn.disabled = true;
  startBtn.classList.remove('ready');
  btnText.innerText = 'Scanne...';
  
  scanStatusBadge.innerText = 'Scanne';
  scanStatusBadge.className = 'status-label text-warning';
  statusDot.className = 'status-dot warning inner-glow glow-pulse';
  
  resultsBody.innerHTML = '';
  chartSection.classList.add('hidden');
  if (wealthChart) wealthChart.destroy();
  allCitizensData = [];
  
  scanProgressEl.style.width = '0%';
  scanTextEl.innerText = 'Initialisiere sichere Verbindung...';

  api = new WarEraAPI(apiKeyInput.value.trim());
  api.onRateLimit = (ms) => {
    scanTextEl.innerText = `API-Limit erreicht. Warte ${Math.round(ms / 1000)} Sekunden...`;
  };

  try {
    // 1. Fetch Country details (optional, ignoring errors)
    try {
      await api.getCountry(countryId);
    } catch(e) {
      console.warn("Could not fetch country details, ignoring.", e);
    }
    
    totalCitizensWealthEl.innerHTML = `<span class="currency-symbol">🪙</span>0`;

    // 2. Fetch All Citizens
    scanTextEl.innerText = 'Erstelle Bürger-Register...';
    let citizens: any[] = [];
    let cursor = undefined;
    
    while (true) {
      const usersRes: any = await api.getUsersByCountry(countryId, cursor);
      const data = usersRes?.result?.data || usersRes;
      if (!data || !data.items) break;
      
      citizens = citizens.concat(data.items);
      cursor = data.nextCursor;
      if (!cursor) break;
    }

    citizensCountEl.innerText = citizens.length.toLocaleString();
    
    if (citizens.length === 0) {
      scanTextEl.innerText = 'Keine Bürger-Einträge im Register gefunden.';
      finishScan();
      return;
    }

    // 3. Process Citizens
    const CHUNK_SIZE = 10;
    let processedCount = 0;

    for (let i = 0; i < citizens.length; i += CHUNK_SIZE) {
      const chunk = citizens.slice(i, i + CHUNK_SIZE);

      await Promise.all(chunk.map(async (citizen) => {
        const citizenId = citizen._id || citizen;
        let username = citizen.username || 'Verschlüsselte Identität';

        let level = 1;
        let lastActivityStr = 'Unbekannt';
        let totalWealth = 0;
        let diffHours = 9999;
        let diffDays = 999;
        
        try {
          const uLiteRes: any = await api.getUserLite(citizenId);
          const userLite = uLiteRes?.result?.data || uLiteRes;
          
          username = userLite.username || username;
          totalWealth = userLite.rankings?.userWealth?.value || 0;
          level = userLite.leveling?.level || 1;
          
          if (userLite.dates?.lastConnectionAt) {
            const lastConn = new Date(userLite.dates.lastConnectionAt);
            const now = new Date();
            diffHours = Math.floor((now.getTime() - lastConn.getTime()) / (1000 * 60 * 60));
            diffDays = Math.floor(diffHours / 24);
            
            if (diffHours < 1) {
              lastActivityStr = 'Gerade eben';
            } else if (diffHours < 24) {
              lastActivityStr = `Vor ${diffHours} h`;
            } else {
              lastActivityStr = `Vor ${diffDays} d`;
            }
          }

          const compsRes: any = await api.getCompanies(citizenId);
          const compData = compsRes?.result?.data || compsRes;
          const companyIds = compData.items || [];
          
          let totalCompanyValue = 0;

          await Promise.all(companyIds.map(async (cId: string) => {
            try {
              const cRes: any = await api.getCompany(cId);
              const cDetails = cRes?.result?.data || cRes;
              const evalue = cDetails.estimatedValue || 0;
              totalCompanyValue += evalue;
            } catch(e) {
              console.error(`Error fetching company ${cId}`, e);
            }
          }));

          const liquidAssets = totalWealth - totalCompanyValue;
          
          allCitizensData.push({
            citizenId,
            username,
            level,
            totalWealth,
            totalCompanyValue,
            liquidAssets,
            lastActivityStr,
            diffDays,
            diffHours
          });

        } catch (err) {
          console.error(`Failed to process citizen ${citizenId}`, err);
        }

        processedCount++;
        scanTextEl.innerText = `Analysiere Bürger ${processedCount}/${citizens.length}`;
        scanProgressEl.style.width = `${(processedCount / citizens.length) * 100}%`;
      }));
    }

    scanTextEl.innerText = `Scan abgeschlossen: ${citizens.length.toLocaleString('de-DE')} Identitäten entschlüsselt. Rendere Daten...`;
    
    renderData();
    finishScan(true);

  } catch (err: any) {
    console.error(err);
    alert(err.message);
    scanTextEl.innerText = 'Systemfehler: Scan abgebrochen.';
    finishScan(false);
  }
});

function finishScan(success: boolean = false) {
  isScanning = false;
  startBtn.disabled = false;
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
  resultsBody.innerHTML = '';
  let totalWealthSum = 0;
  let filteredData = [...allCitizensData];
  
  const filterVal = (document.getElementById('activity-filter') as HTMLSelectElement).value;

  if (filterVal === '24h') {
    filteredData = filteredData.filter(c => c.diffHours < 24);
  } else if (filterVal === '3d') {
    filteredData = filteredData.filter(c => c.diffDays <= 3);
  } else if (filterVal === '7d') {
    filteredData = filteredData.filter(c => c.diffDays <= 7);
  } else if (filterVal === 'inactive') {
    filteredData = filteredData.filter(c => c.diffDays > 7);
  }

  // Sort by liquid assets descending
  filteredData.sort((a, b) => b.liquidAssets - a.liquidAssets);

  filteredData.forEach((c, i) => {
    totalWealthSum += c.totalWealth;
    const liquidClass = c.liquidAssets >= 0 ? 'text-success' : 'text-danger';
    
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
            <div class="citizen-name-wrap">
              <strong>${c.username}</strong>
              <span class="activity-badge">${c.lastActivityStr}</span>
            </div>
            <div class="id-hash">${c.citizenId.substring(0,8)}...</div>
          </div>
        </div>
      </td>
      <td class="wealth-col font-mono">🪙 ${c.totalWealth.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="wealth-col font-mono text-muted">🪙 ${c.totalCompanyValue.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="wealth-col font-mono ${liquidClass} fw-bold">🪙 ${c.liquidAssets.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
    `;
    resultsBody.appendChild(tr);
  });

  totalCitizensWealthEl.innerHTML = `<span class="currency-symbol">🪙</span>${totalWealthSum.toLocaleString('de-DE', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
  scanTextEl.innerText = `Anzeige: ${filteredData.length.toLocaleString('de-DE')} von ${allCitizensData.length.toLocaleString('de-DE')} Bürgern.`;

  drawHistogram(filteredData);
  chartSection.classList.remove('hidden');
}

document.getElementById('activity-filter')?.addEventListener('change', () => {
  if (allCitizensData.length > 0) {
    renderData();
  }
});

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

