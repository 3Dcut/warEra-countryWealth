const BASE = 'https://api2.warera.io/trpc';
const API_KEY = 'wae_f6c46b1b30c0700a44155530965b96de8eca1e9e539a9710a6c0ac0499c6a306';
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, 'x-api-key': API_KEY };
const now = Date.now();
const h38 = 38 * 60 * 60 * 1000;
const countryId = '6813b6d446e731854c7ac79c';

// 1) Aktive Bevölkerung laut API-Ranking
const countryUrl = BASE + '/country.getCountryById?input=' + encodeURIComponent(JSON.stringify({ countryId }));
const countryData = (await fetch(countryUrl, { headers }).then(r => r.json())).result.data;
const apiActivePopulation = countryData.rankings.countryActivePopulation.value;

// 2) Alle User-IDs sammeln
let allIds = [];
let cursor = null;
do {
  const params = { countryId, limit: 100 };
  if (cursor) params.cursor = cursor;
  const url = BASE + '/user.getUsersByCountry?input=' + encodeURIComponent(JSON.stringify(params));
  const r = await fetch(url, { headers }).then(r => r.json());
  allIds.push(...r.result.data.items.map(u => u._id));
  cursor = r.result.data.nextCursor || null;
} while (cursor);

// 3) Alle User-Details abrufen
let lv10plus = 0;
let underLv10 = 0;
let underLv10_active38h = 0;
let underLv10_active38h_minLv3 = 0;
const batchSize = 10;

for (let i = 0; i < allIds.length; i += batchSize) {
  const batch = allIds.slice(i, i + batchSize);
  const results = await Promise.all(batch.map(async (id) => {
    try {
      const url = BASE + '/user.getUserLite?input=' + encodeURIComponent(JSON.stringify({ userId: id }));
      const r = await fetch(url, { headers }).then(r => r.json());
      return r.result?.data || null;
    } catch(e) { return null; }
  }));
  for (const u of results) {
    if (!u) continue;
    const lvl = u.leveling?.level || 0;
    if (lvl >= 10) {
      lv10plus++;
    } else {
      underLv10++;
      const lastConn = u.dates?.lastConnectionAt;
      const isActive38h = lastConn && (now - new Date(lastConn).getTime()) < h38;
      if (isActive38h) {
        underLv10_active38h++;
        if (lvl >= 3) {
          underLv10_active38h_minLv3++;
        }
      }
    }
  }
}

console.log('========================================');
console.log('  DEUTSCHLAND - SPIELERANALYSE');
console.log('========================================');
console.log('');
console.log('Gesamt Spieler:              ' + allIds.length);
console.log('Davon Lv 10+:               ' + lv10plus);
console.log('API countryActivePopulation: ' + apiActivePopulation);
console.log('Check (Lv10+ == API):        ' + (lv10plus === apiActivePopulation ? 'OK ✓' : 'MISMATCH ✗ (Diff: ' + (lv10plus - apiActivePopulation) + ')'));
console.log('');
console.log('--- Unter Level 10 ---');
console.log('Gesamt unter Lv 10:          ' + underLv10);
console.log('Davon aktiv (38h):           ' + underLv10_active38h);
console.log('Davon aktiv (38h) + min Lv3: ' + underLv10_active38h_minLv3);
