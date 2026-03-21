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
    let totalWealthSum = 0;
    const wealthArray: number[] = [];

    for (let i = 0; i < citizens.length; i++) {
      const citizen = citizens[i];
      const citizenId = citizen._id || citizen;
      let username = citizen.username || 'Verschlüsselte Identität';

      scanTextEl.innerText = `Analysiere Bürger ${i+1}/${citizens.length}`;
      scanProgressEl.style.width = `${((i+1)/citizens.length)*100}%`;

      try {
        const uLiteRes: any = await api.getUserLite(citizenId);
        const userLite = uLiteRes?.result?.data || uLiteRes;
        
        username = userLite.username || username;
        const totalWealth = userLite.rankings?.userWealth?.value || 0;

        const compsRes: any = await api.getCompanies(citizenId);
        const compData = compsRes?.result?.data || compsRes;
        const companyIds = compData.items || [];
        
        let totalCompanyValue = 0;

        for (const cId of companyIds) {
          try {
            const cRes: any = await api.getCompany(cId);
            const cDetails = cRes?.result?.data || cRes;
            const evalue = cDetails.estimatedValue || 0;
            totalCompanyValue += evalue;
          } catch(e) {
            console.error(`Error fetching company ${cId}`, e);
          }
        }

        const liquidAssets = totalWealth - totalCompanyValue;
        const liquidClass = liquidAssets >= 0 ? 'text-success' : 'text-danger';

        totalWealthSum += totalWealth;
        wealthArray.push(totalWealth);
        totalCitizensWealthEl.innerHTML = `<span class="currency-symbol">🪙</span>${totalWealthSum.toLocaleString('de-DE', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;

        const tr = document.createElement('tr');
        tr.className = 'citizen-row slide-up';
        tr.style.animationDelay = `${(i % 10) * 0.05}s`;
        tr.setAttribute('data-liquid', liquidAssets.toString());
        tr.innerHTML = `
          <td>
            <div class="citizen-info">
              <div class="avatar-placeholder">${username.charAt(0).toUpperCase()}</div>
              <div>
                <strong>${username}</strong>
                <div class="id-hash">${citizenId.substring(0,8)}...</div>
              </div>
            </div>
          </td>
          <td class="wealth-col font-mono">🪙 ${totalWealth.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
          <td class="wealth-col font-mono text-muted">🪙 ${totalCompanyValue.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
          <td class="wealth-col font-mono ${liquidClass} fw-bold">🪙 ${liquidAssets.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        `;
        resultsBody.appendChild(tr);

      } catch (err) {
        console.error(`Failed to process citizen ${citizenId}`, err);
        const tr = document.createElement('tr');
        tr.className = 'citizen-row error-row slide-up';
        tr.innerHTML = `
          <td>
            <div class="citizen-info">
              <div class="avatar-placeholder error-avatar">!</div>
              <div><strong>${username}</strong></div>
            </div>
          </td>
          <td colspan="3" class="text-danger">Extraktion fehlgeschlagen: Daten verschlüsselt</td>
        `;
        resultsBody.appendChild(tr);
      }
    }

    scanTextEl.innerText = `Scan abgeschlossen: ${citizens.length.toLocaleString('de-DE')} Identitäten entschlüsselt. Sortiere Daten...`;
    
    // Sort rows by liquid assets descending
    const rows = Array.from(resultsBody.querySelectorAll('tr.citizen-row'));
    rows.sort((a, b) => {
      const valA = parseFloat(a.getAttribute('data-liquid') || '-999999999');
      const valB = parseFloat(b.getAttribute('data-liquid') || '-999999999');
      return valB - valA;
    });
    rows.forEach(row => {
      // Remove animation delay so they don't pop-in again when re-appended
      (row as HTMLElement).style.animationDelay = '0s';
      resultsBody.appendChild(row);
    });

    scanTextEl.innerText = `Scan abgeschlossen: ${citizens.length.toLocaleString('de-DE')} Identitäten entschlüsselt.`;

    drawHistogram(wealthArray);
    chartSection.classList.remove('hidden');

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

function drawHistogram(data: number[]) {
  const bins = [0, 100, 500, 1000, 5000, 10000, 50000, Infinity];
  const labels = ['< 100', '100 - 500', '500 - 1k', '1k - 5k', '5k - 10k', '10k - 50k', '> 50k'];
  const counts = new Array(labels.length).fill(0);

  data.forEach(val => {
    for (let i = 0; i < bins.length - 1; i++) {
      if (val >= bins[i] && val < bins[i+1]) {
        counts[i]++;
        break;
      }
    }
  });

  const ctx = (document.getElementById('wealthChart') as HTMLCanvasElement).getContext('2d');
  if (!ctx) return;

  wealthChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Anzahl Bürger',
        data: counts,
        backgroundColor: 'rgba(56, 189, 248, 0.7)',
        borderColor: 'rgba(56, 189, 248, 1)',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Vermögensverteilung (Logarithmisch)',
          color: '#e2e8f0',
          font: { family: 'Inter', size: 16 }
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

