import './style.css';
import { WarEraAPI } from './api';

// DOM Elements
const countryIdInput = document.getElementById('countryId') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;

const treasuryValueEl = document.getElementById('treasuryValue') as HTMLElement;
const citizensCountEl = document.getElementById('citizensCount') as HTMLElement;
const scanProgressEl = document.getElementById('scanProgress') as HTMLElement;
const scanTextEl = document.getElementById('scanText') as HTMLElement;
const scanStatusBadge = document.getElementById('scanStatusBadge') as HTMLElement;

const resultsBody = document.getElementById('resultsBody') as HTMLElement;

let api: WarEraAPI;
let isScanning = false;

startBtn.addEventListener('click', async () => {
  if (isScanning) return;
  const countryId = countryIdInput.value.trim();
  if (!countryId) return alert('Please enter a Country ID');

  isScanning = true;
  startBtn.disabled = true;
  startBtn.innerText = 'Scanning...';
  scanStatusBadge.innerText = 'Scanning';
  scanStatusBadge.className = 'badge scanning';
  resultsBody.innerHTML = '';
  
  scanProgressEl.style.width = '0%';
  scanTextEl.innerText = 'Initializing...';

  api = new WarEraAPI(apiKeyInput.value.trim());

  try {
    // 1. Fetch Country Treasury
    scanTextEl.innerText = 'Fetching Treasury...';
    let countryData;
    try {
      const res = await api.getCountry(countryId);
      countryData = res?.result?.data;
    } catch(err: any) {
      // Sometimes result format varies, let's just grab the whole response if not wrapped
      countryData = await api.getCountry(countryId);
      if (countryData?.result) countryData = countryData.result.data;
    }

    if (!countryData) {
      throw new Error(`Could not fetch country data. Invalid ID or API block.`);
    }

    const treasury = countryData.money || 0;
    treasuryValueEl.innerText = `$${treasury.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    // 2. Fetch All Citizens
    scanTextEl.innerText = 'Fetching Citizens...';
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

    citizensCountEl.innerText = citizens.length.toString();
    
    if (citizens.length === 0) {
      scanTextEl.innerText = 'No citizens found.';
      finishScan();
      return;
    }

    // 3. Process Citizens one by one
    for (let i = 0; i < citizens.length; i++) {
      const citizen = citizens[i];
      const citizenId = citizen._id || citizen;
      let username = citizen.username || 'Unknown';

      scanTextEl.innerText = `Processing ${i+1} / ${citizens.length} (${Math.round(((i+1)/citizens.length)*100)}%)`;
      scanProgressEl.style.width = `${((i+1)/citizens.length)*100}%`;

      try {
        // Fetch user lite for total wealth and username
        const uLiteRes: any = await api.getUserLite(citizenId);
        const userLite = uLiteRes?.result?.data || uLiteRes;
        
        username = userLite.username || username;
        const totalWealth = userLite.rankings?.userWealth?.value || 0;

        // Fetch companies
        const compsRes: any = await api.getCompanies(citizenId);
        const compData = compsRes?.result?.data || compsRes;
        const companyIds = compData.items || [];
        
        let totalCompanyValue = 0;

        // Fetch each company's estimated value
        for (const cId of companyIds) {
          try {
            const cRes: any = await api.getCompany(cId);
            const cDetails = cRes?.result?.data || cRes;
            const evalue = cDetails.estimatedValue || 0;
            totalCompanyValue += evalue;
          } catch(e) {
            console.error(`Error fetching company ${cId}:`, e);
          }
        }

        const liquidAssets = totalWealth - totalCompanyValue;

        // Create table row
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${username}</strong><br><small style="color:var(--text-muted)">${citizenId.substring(0,8)}</small></td>
          <td>$${totalWealth.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
          <td>$${totalCompanyValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
          <td class="${liquidAssets >= 0 ? 'positive' : 'negative'}">$${liquidAssets.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        `;
        resultsBody.appendChild(tr);

      } catch (err) {
        console.error(`Failed to process citizen ${citizenId}`, err);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${username || citizenId}</strong></td>
          <td colspan="3" style="color:var(--error); font-style:italic">Failed to load data</td>
        `;
        resultsBody.appendChild(tr);
      }
    }

    scanTextEl.innerText = `Completed scan of ${citizens.length} citizens.`;
    finishScan();

  } catch (err: any) {
    alert(err.message);
    scanTextEl.innerText = 'Scan failed.';
    finishScan();
  }
});

function finishScan() {
  isScanning = false;
  startBtn.disabled = false;
  startBtn.innerText = 'Start Scan';
  scanStatusBadge.innerText = 'Done';
  scanStatusBadge.className = 'badge done';
}
