/* Phone numbers: the place table and the number rules, shared by the Round 2 mock.
   Copied from phone-numbers-round1-mock.html; nothing here is wired to the module.
   All codes are ours. Region codes are invented: none is the real dialling code of that country. */
const COLS = ['Region code', 'Region', 'State', 'City code', 'City', 'Area', 'Code', 'District', 'Category', 'Players can pick', 'Status', 'Source', 'Listed'];
const row = (l) => { const v = l.split('|'); const r = Object.fromEntries(COLS.map((c, i) => [c, v[i] ?? ''])); r.Listed = r.Listed || 'yes'; return r; };
const unlisted = (r) => ({ ...r, Listed: 'no' });
const NC = (area, code, name, cat = 'District', pick = 'yes', st = 'live', src = 'Night City 2045') => row('72|Pacifica Confederation|Northern California|NC|Night City|' + [area, code, name, cat, pick, st, src].join('|'));
/** A place with no book districts: the number is just the city and four digits, so nothing is invented. */
const P = (rc, region, state, code, city, src) => row([rc, region, state, code, city, '', '', '', 'City', 'yes', 'live', src].join('|'));
/** One district in a city outside Night City. */
const D = (rc, region, state, code, city, area, ex, name, src) => row([rc, region, state, code, city, area, ex, name, 'District', 'yes', 'live', src].join('|'));
const WHERE = {
  NC: ['72', 'Pacifica Confederation', 'Northern California', 'Night City'], SF: ['72', 'Pacifica Confederation', 'Northern California', 'San Francisco'], SEA: ['72', 'Pacifica Confederation', 'Washington', 'Seattle'], POR: ['72', 'Pacifica Confederation', 'Oregon', 'Portland'],
  DC: ['10', 'NUSA', 'District of Columbia', 'Washington D.C.'], NYC: ['10', 'NUSA', 'New York', 'New York'], CHI: ['10', 'NUSA', 'Illinois', 'Chicago'], ATL: ['10', 'NUSA', 'Georgia', 'Atlanta'], MIA: ['10', 'NUSA', 'Florida', 'Miami'], NOL: ['10', 'NUSA', 'Louisiana', 'New Orleans'], DEN: ['10', 'NUSA', 'Colorado', 'Denver'], BAL: ['10', 'NUSA', 'Maryland', 'Baltimore'], TUL: ['10', 'NUSA', 'Oklahoma', 'Tulsa'], SFE: ['10', 'NUSA', 'New Mexico', 'Santa Fe'],
  DAL: ['14', 'Free State of Texas', 'Texas', 'Dallas'], AUS: ['14', 'Free State of Texas', 'Texas', 'Austin'], LA: ['15', 'Free State of Southern California', 'Southern California', 'Los Angeles'], LJA: ['15', 'Free State of Southern California', 'Southern California', 'La Jolla'],
  MTL: ['12', 'Canada', 'Quebec', 'Montreal'], TOR: ['12', 'Canada', 'Ontario', 'Toronto'], HAV: ['54', 'Cuba', '', 'Havana'], RIO: ['58', 'Brazil', '', 'Rio de Janeiro'],
  LON: ['40', 'EuroTheatre', 'United Kingdom', 'London'], PAR: ['40', 'EuroTheatre', 'France', 'Paris'], BON: ['40', 'EuroTheatre', 'Germany', 'Bonn'], HAM: ['40', 'EuroTheatre', 'Germany', 'Hamburg'], ZRH: ['40', 'EuroTheatre', 'Switzerland', 'Zurich'], ROM: ['41', 'Southern Europe', 'Italy', 'Rome'],
  MOS: ['47', 'Neo-Soviet Russia', 'Russia', 'Moscow'], STP: ['47', 'Neo-Soviet Russia', 'Russia', 'St. Petersburg'], VVO: ['47', 'Neo-Soviet Russia', 'Russia', 'Vladivostok'], TAS: ['48', 'Uzbekistan', '', 'Toshkent'], TLV: ['49', 'Israel', '', 'Tel Aviv'],
  TKY: ['83', 'Japan', 'Kanto', 'Tokyo'], BJG: ['88', 'China', 'Beijing and Tianjin', 'Beijing'], HKG: ['88', 'China', '', 'Hong Kong'], SEL: ['84', 'Korea', '', 'Seoul'], SIN: ['66', 'Singapore', '', 'Singapore'], MNL: ['69', 'The Philippines', '', 'Manila'], HCM: ['68', 'Vietnam', '', 'Ho Chi Minh City'], MUM: ['93', 'India', 'Maharashtra', 'Mumbai'], SYD: ['63', 'Australia', 'New South Wales', 'Sydney'],
};
/** One corp in many cities: the same three letters, a row per office. The first city is the headquarters. */
const branches = (ex, name, hq, cities, src) => [...(hq ? [hq] : []), ...cities].map((c, i) => { const [rc, region, state, city] = WHERE[c]; return row([rc, region, state, c, city, hq && i === 0 ? 'Headquarters' : 'Office', ex, name, 'Corporate', 'no', 'live', src].join('|')); });
const PAC = 'Pacifica Confederation', NUS = 'NUSA', JP = 'Japan', EU = 'EuroTheatre', HR = 'Highrider Confederation', CORE = 'CORE', N45 = 'Night City 2045', RIM = 'Pacific Rim (2020)', EUS = 'Eurosource Plus (2020)', PH = 'Placeholder district';
const BOOK_ROWS = [
  NC('The Island', 'LEU', 'Little Europe'), NC('The Island', 'UMR', 'Upper Marina'), NC('The Island', 'DTN', 'Downtown'), unlisted(NC('The Island', 'HOT', 'The Hot Zone', 'Dead zone', 'no', 'dead')),
  NC('The Island', 'LCH', 'Little China'), NC('The Island', 'UNI', 'University District'), NC('The Island', 'GLN', 'The Glen'), NC('The Island', 'OJT', 'Old Japantown'),
  NC('The Island', 'SNC', 'South Night City'), NC('The Island', 'PRT', 'Port of Night City'), NC('The Island', 'REC', 'Reclamation Zone'), NC('The Island', 'OCZ', 'Old Combat Zone'),
  unlisted(NC('Northside', 'NCM', 'NorCal Military Base', 'Military', 'no')), NC('Northside', 'WAT', 'Watson Development'), NC('Northside', 'KAB', 'Kabuki'),
  NC('The Mainland', 'NWB', 'New Westbrook'), NC('The Mainland', 'CHH', 'Charter Hill'), NC('The Mainland', 'EXZ', 'Executive Zone', 'District', 'no'), NC('The Mainland', 'HDK', 'Heywood Docks'),
  NC('The Mainland', 'NHW', 'North Heywood'), NC('The Mainland', 'HIZ', 'Heywood Industrial Zone'), NC('The Mainland', 'SDO', 'Santo Domingo'),
  NC('Southside', 'PPG', 'Pacifica Playground'), NC('Southside', 'RCO', 'Rancho Coronado'),
  NC('Outside the city', 'OUT', 'Outskirts'), NC('Outside the city', 'PLY', 'Playland by the Sea'),
  unlisted(NC('Private lines', 'BRN', 'Burner', 'Burner', 'no', 'live', 'Ours')),
  // The Pacifica Confederation (CORE: Washington, Oregon, Idaho, Northern California, British Columbia)
  P('72', PAC, 'Northern California', 'SF', 'San Francisco', N45), P('72', PAC, 'Northern California', 'SAC', 'Sacramento', N45),
  D('72', PAC, 'Washington', 'SEA', 'Seattle', '', 'DWN', 'Downtown', PH),
  P('72', PAC, 'Oregon', 'POR', 'Portland', N45), P('72', PAC, 'Oregon', 'COO', 'Coos Bay', N45),
  P('72', PAC, 'Idaho', 'BOI', 'Boise', 'Idaho: CORE. City: RED DLC'),
  D('72', PAC, 'British Columbia', 'VAN', 'Vancouver', '', 'GAS', 'Gastown', PH), P('72', PAC, 'British Columbia', 'VIC', 'Victoria', CORE), P('72', PAC, 'British Columbia', 'PRU', 'Prince Rupert', N45),
  // The New United States
  D('10', NUS, 'District of Columbia', 'DC', 'Washington D.C.', '', 'CAP', 'Capitol', PH),
  P('10', NUS, 'New York', 'NYC', 'New York', CORE), P('10', NUS, 'Massachusetts', 'BOS', 'Boston', CORE), P('10', NUS, 'Illinois', 'CHI', 'Chicago', CORE),
  P('10', NUS, 'Georgia', 'ATL', 'Atlanta', CORE), P('10', NUS, 'Florida', 'MIA', 'Miami', CORE), P('10', NUS, 'Louisiana', 'NOL', 'New Orleans', CORE),
  P('10', NUS, 'Colorado', 'DEN', 'Denver', N45), P('10', NUS, 'New Mexico', 'ABQ', 'Albuquerque', N45), P('10', NUS, 'Arizona', 'PHX', 'Phoenix', N45), P('10', NUS, 'Missouri', 'JEF', 'Jefferson City', N45),
  // The Free States
  D('14', 'Free State of Texas', 'Texas', 'DAL', 'Dallas', '', 'CEN', 'Central', PH), D('14', 'Free State of Texas', 'Texas', 'AUS', 'Austin', '', 'CEN', 'Central', PH), P('14', 'Free State of Texas', 'Texas', 'HOU', 'Houston', CORE),
  D('15', 'Free State of Southern California', 'Southern California', 'LA', 'Los Angeles', '', 'HWD', 'Hollywood', PH), P('15', 'Free State of Southern California', 'Southern California', 'SD', 'San Diego', CORE),
  P('16', 'Free State of Nevada', 'Nevada', 'LV', 'Las Vegas', 'City: Night City 2045. Free State: Land of the Free (2020)'),
  // North and Central America
  P('12', 'Canada', 'Ontario', 'TOR', 'Toronto', CORE), P('12', 'Canada', 'Quebec', 'MTL', 'Montreal', CORE),
  P('53', 'Mexico', 'Federal District', 'MEX', 'Mexico City', N45), P('53', 'Mexico', 'Chihuahua', 'CHU', 'Chihuahua', N45), P('53', 'Mexico', 'Sinaloa', 'MZT', 'Mazatlán', N45), P('53', 'Mexico', 'Guerrero', 'ACA', 'Acapulco', N45),
  // Europe. CORE: most nations are in the Common Market; Italy, Spain and Greece are not.
  D('40', EU, 'United Kingdom', 'LON', 'London', '', 'CTY', 'The City', PH),
  P('40', EU, 'France', 'PAR', 'Paris', CORE), P('40', EU, 'France', 'MRS', 'Marseille', EUS),
  P('40', EU, 'Germany', 'BER', 'Berlin', EUS), P('40', EU, 'Germany', 'HAM', 'Hamburg', CORE), P('40', EU, 'Germany', 'FRA', 'Frankfurt', EUS), P('40', EU, 'Germany', 'MUC', 'Munich', 'RED DLC'),
  P('40', EU, 'Belgium', 'BRU', 'Brussels', EUS), P('40', EU, 'Netherlands', 'AMS', 'Amsterdam', EUS), P('40', EU, 'Czech Republic', 'PRG', 'Prague', EUS), P('40', EU, 'Hungary', 'BUD', 'Budapest', EUS), P('40', EU, 'Poland', 'WAW', 'Warsaw', EUS), P('40', EU, 'Sweden', 'STO', 'Stockholm', EUS),
  P('41', 'Southern Europe', 'Italy', 'ROM', 'Rome', CORE), P('41', 'Southern Europe', 'Italy', 'MIL', 'Milan', EUS), P('41', 'Southern Europe', 'Spain', 'MAD', 'Madrid', EUS), P('41', 'Southern Europe', 'Spain', 'BCN', 'Barcelona', 'RED DLC'), P('41', 'Southern Europe', 'Greece', 'ATH', 'Athens', EUS),
  P('47', 'Neo-Soviet Russia', 'Russia', 'MOS', 'Moscow', CORE), P('47', 'Neo-Soviet Russia', 'Russia', 'STP', 'St. Petersburg', CORE),
  // Japan: Tokyo's districts are from the Pacific Rim sourcebook's sprawl map
  D('83', JP, 'Kanto', 'TKY', 'Tokyo', 'West Tokyo', 'SJK', 'Shinjuku', RIM), D('83', JP, 'Kanto', 'TKY', 'Tokyo', 'West Tokyo', 'SHB', 'Shibuya', RIM), D('83', JP, 'Kanto', 'TKY', 'Tokyo', 'West Tokyo', 'MGR', 'Meguro', RIM),
  D('83', JP, 'Kanto', 'TKY', 'Tokyo', 'Central Tokyo', 'CHY', 'Chiyoda', RIM), D('83', JP, 'Kanto', 'TKY', 'Tokyo', 'Central Tokyo', 'NHB', 'Nihombashi', RIM), D('83', JP, 'Kanto', 'TKY', 'Tokyo', 'Central Tokyo', 'GIN', 'Ginza', RIM), D('83', JP, 'Kanto', 'TKY', 'Tokyo', 'Central Tokyo', 'AKB', 'Akihabara', RIM),
  D('83', JP, 'Kanto', 'TKY', 'Tokyo', 'Tokyo Bay', 'HRM', 'Harumi', RIM),
  P('83', JP, 'Kanto', 'CHB', 'Chiba', RIM), P('83', JP, 'Kanto', 'YOK', 'Yokohama', RIM),
  P('83', JP, 'Kansai', 'OSK', 'Osaka', RIM), P('83', JP, 'Kansai', 'KYO', 'Kyoto', RIM), P('83', JP, 'Kansai', 'KOB', 'Kobe', RIM),
  P('83', JP, 'Chubu', 'NGY', 'Nagoya', RIM), P('83', JP, 'Chugoku', 'HIR', 'Hiroshima', RIM), P('83', JP, 'Okinawa', 'OKI', 'Okinawa', RIM),
  // The rest of the Pacific Rim
  P('88', 'China', 'Beijing and Tianjin', 'BJG', 'Beijing', CORE), P('88', 'China', '', 'SHA', 'Shanghai', CORE), P('88', 'China', '', 'HKG', 'Hong Kong', CORE),
  P('84', 'Korea', '', 'SEL', 'Seoul', CORE), P('84', 'Korea', '', 'PUS', 'Pusan', RIM), P('89', 'Taiwan', '', 'TPE', 'Taipei', RIM),
  P('66', 'Singapore', '', 'SIN', 'Singapore', CORE), P('67', 'Thailand', '', 'BKK', 'Bangkok', RIM), P('68', 'Vietnam', '', 'HAN', 'Hanoi', RIM), P('68', 'Vietnam', '', 'SGN', 'Saigon', RIM),
  P('69', 'The Philippines', '', 'MNL', 'Manila', CORE), P('70', 'Indonesia', '', 'JKT', 'Jakarta', RIM), P('71', 'Malaysia', '', 'KUL', 'Kuala Lumpur', RIM),
  P('63', 'Australia', 'New South Wales', 'SYD', 'Sydney', CORE), P('63', 'Australia', 'Victoria', 'MEL', 'Melbourne', CORE), P('63', 'Australia', 'Northern Territory', 'DRW', 'Darwin', RIM), P('64', 'West Australia', 'West Australia', 'PER', 'Perth', RIM), P('62', 'New Zealand', '', 'AKL', 'Auckland', RIM),
  P('93', 'India', 'Maharashtra', 'MUM', 'Mumbai', 'RED DLC'),
  // Elsewhere
  P('58', 'Brazil', '', 'RIO', 'Rio de Janeiro', 'RED DLC'), P('56', 'Colombia', '', 'BOG', 'Bogota', CORE), P('27', 'Africa', 'Egypt', 'CAI', 'Cairo', 'RED DLC'),
  P('30', 'Drift Nations', '', 'DFT', 'Drift city', 'CORE (cities are unnamed)'), P('31', 'The Deepdown', '', 'DOM', 'Subsurface dome', 'CORE (domes are unnamed)'),
  // Corporate lines: each corp's headquarters and regional offices, as CORE lists them. GM-held: a player can ring one, not hold one.
  ...branches('ARA', 'Arasaka', 'TKY', ['HKG', 'LON', 'PAR', 'SIN'], 'CORE: HQ, and "offices throughout the world". Cities ours'),
  // Banned from the continental U.S. after the War (CORE). The lines exist; the directory doesn't show them. 2045 mentions rumours of agents in the city.
  ...branches('ARA', 'Arasaka', null, ['NC', 'DC', 'NYC', 'CHI', 'LA'], 'Banned in North America (CORE). Hidden').map(unlisted),
  ...branches('BIO', 'Biotechnica', 'LJA', ['LON', 'BON', 'PAR', 'SEA', 'DAL', 'NC', 'SYD', 'RIO'], 'CORE'),
  ...branches('CBR', 'Continental Brands', 'TUL', ['CHI', 'ATL', 'BAL', 'SEA', 'DAL', 'NC'], 'CORE'),
  ...branches('DGL', 'Danger Gal', 'NC', ['NYC', 'MIA', 'MTL', 'LON', 'ROM', 'ZRH', 'DC', 'LA', 'TOR'], 'CORE'),
  ...branches('MIL', 'Militech International', 'DC', ['NYC', 'MIA', 'CHI', 'MTL', 'LON', 'ROM', 'ZRH', 'NC', 'LA', 'TOR', 'TKY', 'BJG'], 'CORE'),
  ...branches('NFF', 'Network 54', 'SFE', ['ATL', 'CHI', 'NOL', 'DAL', 'DEN', 'POR', 'SEA', 'LA', 'SF', 'NC'], 'CORE. Night City: Night City 2045'),
  ...branches('PCH', 'Petrochem', 'DAL', ['NYC', 'DC', 'MIA', 'CHI', 'SF', 'TKY', 'LON', 'HAM', 'PAR', 'ROM', 'NC'], 'CORE. Night City: Night City 2045'),
  ...branches('RKL', 'Rocklin Augmentics', 'AUS', ['DC', 'CHI', 'DEN', 'ATL', 'BAL', 'SEA', 'DAL', 'NC'], 'CORE'),
  ...branches('SOV', 'SovOil', 'MOS', ['TAS', 'STP', 'TKY', 'SEL', 'BJG', 'MNL', 'HCM', 'HAV', 'NC'], 'CORE'),
  ...branches('TTI', 'Trauma Team', 'SEA', ['NC', 'LA', 'SF', 'CHI', 'NYC', 'DC', 'DAL', 'TOR'], 'CORE: "most major North American cities". Cities ours'),
  ...branches('ZIG', 'Ziggurat', 'NC', ['SEA', 'LA', 'SF', 'CHI', 'NYC', 'DC', 'DAL', 'TOR'], 'CORE: "most North American cities". Cities ours'),
  ...branches('ZTM', 'Zhirafa Technical Manufacturing', 'VVO', ['LON', 'PAR', 'TLV', 'MUM', 'SIN', 'NC'], 'CORE'),
  // Space: CORE places the Highriders in the L points and on Luna and Mars
  P('90', HR, 'Earth orbit', 'PAL', 'Crystal Palace', CORE), P('90', HR, 'Earth orbit', 'ONE', "O'Neill One Habitat (L-5)", CORE), P('90', HR, 'Earth orbit', 'TWO', "O'Neill Two", CORE), P('90', HR, 'Earth orbit', 'PDS', 'Paradise Station (L-4)', CORE), P('90', HR, 'Earth orbit', 'GAL', 'Galileo Cylinder (L-3)', CORE),
  P('90', HR, 'Luna', 'TYC', 'Tycho', CORE), P('90', HR, 'Luna', 'COP', 'Copernicus', CORE), P('90', HR, 'Mars', 'MRC', 'Mars colonies', 'CORE (colonies are unnamed)'),
];
/* 2077 names checked against the Edgerunners Mission Kit handbook, except Little China. A place in both eras keeps its code. */
const ERA_2077 = [
  ['Watson', 'WAT', 'Watson'], ['Watson', 'KAB', 'Kabuki'], ['Watson', 'NSD', 'Northside'], ['Watson', 'LCH', 'Little China'],
  ['Westbrook', 'JPT', 'Japantown'], ['Westbrook', 'CHH', 'Charter Hill'], ['Westbrook', 'NOK', 'North Oak'],
  ['City Center', 'CPL', 'Corpo Plaza'], ['City Center', 'DTN', 'Downtown'],
  ['Heywood', 'HEY', 'Heywood'], ['Heywood', 'GLN', 'The Glen'], ['Heywood', 'VDR', 'Vista del Rey'], ['Heywood', 'WSP', 'Wellsprings'],
  ['Santo Domingo', 'SDO', 'Santo Domingo'], ['Santo Domingo', 'ARR', 'Arroyo'], ['Santo Domingo', 'RCO', 'Rancho Coronado'],
  ['Pacifica', 'CVW', 'Coastview'], ['Pacifica', 'WWE', 'West Wind Estates'], ['Outside the city', 'DOG', 'Dogtown'], ['Outside the city', 'BAD', 'Badlands'],
].map(([a, c, n]) => NC(a, c, n)).concat(NC('Office', 'ARA', 'Arasaka', 'Corporate', 'no', 'live', 'Back in the city by 2077'));
const isNcDistrict = (r) => r['City code'] === 'NC' && (!['Corporate', 'Burner'].includes(r.Category) || r.Code === 'ARA');
const CAMPAIGNS = {
  dallas: { home: { rc: '14', city: 'DAL' }, label: 'a Texas campaign', rows: [['Downtown', 'CEN', 'Central'], ['Downtown', 'DEL', 'Deep Ellum'], ['North Dallas', 'UPT', 'Uptown'], ['North Dallas', 'PLN', 'Plano'], ['South Dallas', 'OAK', 'Oak Cliff'], ['South Dallas', 'FAI', 'Fair Park']].map(([a, c, n]) => row('14|Free State of Texas|Texas|DAL|Dallas|' + [a, c, n].join('|') + '|District|yes|live|Sample')) },
  tokyo: { home: { rc: '83', city: 'TKY' }, label: 'an overseas campaign', rows: [] },
};
let ROWS = BOOK_ROWS.map((r) => ({ ...r }));
let EXTRA_COLS = [];
/* World settings in the real thing, not columns: the campaign's home city, and how far players may reach. */
let HOME = { rc: '72', city: 'NC' };
const LIMITS = { scope: 'all', ownDigits: true, extra: 1, changeNeedsGm: true };
let AREAS = {}, NC_EX = {}, REGIONS = {};   // AREAS and NC_EX describe the HOME city, whatever it is
function buildTables() {
  AREAS = {}; NC_EX = {}; REGIONS = {};
  for (const r of ROWS) {
    const rc = r['Region code'], city = r['City code'], code = r.Code;
    const R = (REGIONS[rc] ??= { name: r.Region, cities: {} });
    const C = (R.cities[city] ??= { name: r.City, state: r.State, ex: {} });
    if (!code) { C.noEx = true; continue; }
    C.ex[code] = r.District;
    if (city === HOME.city && rc === HOME.rc) { NC_EX[code] = r.District; if (r['Players can pick'] === 'yes') (AREAS[r.Area || r.City] ??= {})[code] = r.District; }
  }
}
buildTables();
const OWNERS = { WAT4471: 'Veronica A. (you)', WAT2208: 'Judy Alvarez', NHW2087: 'Rogue', LCH6130: 'Kid Static', TKYARA0042: 'Arasaka switchboard', DCMIL0100: 'Militech switchboard', ZIG0100: 'Ziggurat switchboard', BRN7719: 'Unknown burner', 'SEADWN2210': 'Marcus Vance', 'DCCAP8812': 'NUSA liaison', 'DALCEN3345': 'Militech procurement', 'PAL0316': 'Angels relay', 'TKYSHB5021': 'Haruka Mori' };
/* Numbers that belonged to someone and were changed, burned or deleted. Never handed out again. */
const RETIRED = { WAT5150: 'Changed by Rache, 2045-03-02', WAT1234: 'Burned', WAT7000: 'Contact deleted', NHW3000: 'Burned' };
const SERVICE = { TRAUMA: 'Trauma Team', NCPD: 'Night City Police' };
const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['+', ''], ['0', ''], ['#', '']];
const keyOf = (ch) => { const u = ch.toUpperCase(); return (KEYS.find(([k, l]) => k === u || l.includes(u)) || [])[0] || null; };
const asKeys = (code) => [...code].map(keyOf).join('');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ─── read any number. The one rule the explainer, picker and dial box all share. ─── */
function parse(raw) {
  const s = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  if (!s) return { empty: true };
  if (SERVICE[s]) return { service: s, name: SERVICE[s], done: true };
  let rest = s, rc = HOME.rc, city = HOME.city, far = false;
  const plus = rest.match(/^\+(\d{0,2})/);
  if (plus) {
    rc = plus[1]; rest = rest.slice(plus[0].length); far = true;
    if (rc.length < 2 || !REGIONS[rc]) return { partial: true, hint: rc.length < 2 ? 'A + starts a region code, two digits.' : `No region uses +${rc}.`, bad: rc.length === 2 };
    const m = rest.match(/^[A-Z]{2,3}/); const code = m && Object.keys(REGIONS[rc].cities).find((c) => rest.startsWith(c));
    if (!code) return { rc, partial: true, hint: `${REGIONS[rc].name}. Next, the city: ${Object.keys(REGIONS[rc].cities).join(', ')}.` };
    city = code; rest = rest.slice(code.length);
  } else {
    const code = Object.keys(REGIONS[rc].cities).find((c) => c !== city && rest.startsWith(c) && rest.length > c.length && !NC_EX[rest.slice(0, 3)]);
    if (code) { city = code; rest = rest.slice(code.length); far = true; }
  }
  const C = REGIONS[rc].cities[city];
  if (C.noEx) {
    const line = rest.replace(/\D/g, '').slice(0, 4);
    return { rc, city, line, done: line.length === 4, key: city + line };
  }
  const table = C.ex;
  const m = rest.match(/^[A-Z]{1,3}/);
  if (!m) return { rc, city, partial: true, far, hint: `${C.name}. Next, the district.` };
  const ex = m[0];
  if (ex.length < 3) return { rc, city, partial: true, far, hint: `Could be: ${Object.keys(table).filter((x) => x.startsWith(ex)).slice(0, 6).join(', ') || 'no district starts like that'}.` };
  if (!table[ex]) return { rc, city, ex, partial: true, far, bad: true, hint: `${ex} isn't a district in ${C.name}.` };
  const line = rest.slice(3).replace(/\D/g, '').slice(0, 4);
  return { rc, city, ex, line, far, done: line.length === 4, key: (city === 'NC' ? '' : city) + ex + line };
}
const stateOf = (p) => REGIONS[p.rc]?.cities[p.city]?.state || '';
const fullForm = (p) => `+${p.rc} ${p.city}${p.ex ? ` ${p.ex}-` : '-'}${p.line ?? ''}`;
/** What a number looks like from where YOUR number is from. */
function seenFrom(p, myRc = HOME.rc, myCity = HOME.city) {
  if (p.service) return p.service;
  const tail = p.ex ? `${p.ex}-${p.line}` : `${p.line}`;
  if (p.rc === myRc && p.city === myCity) return tail;
  if (p.rc === myRc) return `${p.city}${p.ex ? ' ' : '-'}${tail}`;
  return `+${p.rc} ${p.city}${p.ex ? ' ' : '-'}${tail}`;
}
function placeOf(p) {
  if (p.service) return p.name;
  if (isUnlisted(p)) return 'Unlisted number';
  const C = REGIONS[p.rc]?.cities[p.city];
  const ex = p.ex ? C.ex[p.ex] : null;
  return [ex, C?.name, p.rc === HOME.rc ? null : REGIONS[p.rc]?.name].filter(Boolean).join(', ');
}
/** A number as coloured, hoverable text. */
function numHtml(raw, opts = {}) {
  const p = parse(raw);
  if (p.service) return `<span class="ncm-num" data-num="${esc(raw)}"><span class="x">${esc(p.service)}</span></span>`;
  const shown = opts.full ? fullForm(p) : seenFrom(p);
  const parts = [];
  let rest = shown;
  const take = (cls, re) => { const m = rest.match(re); if (m) { parts.push(`<span class="${cls}">${esc(m[0])}</span>`); rest = rest.slice(m[0].length); } };
  take('r', /^\+\d+\s/); if (p.city !== HOME.city || /^\+/.test(shown)) take('c', /^[A-Z]{2,3}[\s-]/);
  take('x', /^[A-Z]{3}-/); parts.push(`<span class="l">${esc(rest)}</span>`);
  return `<span class="ncm-num" data-num="${esc(raw)}" tabindex="0">${parts.join('')}</span>`;
}
function ownerOf(p) { return p.key && !isUnlisted(p) ? (OWNERS[p.key] ?? null) : null; }
/** The player's view: the number can exist and even answer, but the directory won't say whose it is. */
function isUnlisted(p) { if (!p?.city) return false; const r = ROWS.find((x) => x['Region code'] === p.rc && x['City code'] === p.city && (x.Code || '') === (p.ex || '')); return !!r && r.Listed === 'no'; }
const uniq = (a) => [...new Set(a)];
const csvCell = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? ''));

/* ─── items. In the real build these are the world's and the characters' own items, with their own art. ─── */
const CPRI = (p) => '/_vendor/cpr-icons/compendium/' + p + '.svg';
const ITEM_CAT = {
  'Voice Stress Analyzer': ['Cyberware', 'cyberware/voice_stress_analyzer'], 'Amplified Hearing': ['Cyberware', 'cyberware/amplified_hearing'], 'Cyberaudio Suite': ['Cyberware', 'cyberware/cyberaudio_suite'], Biomonitor: ['Cyberware', 'cyberware/biomonitor'], 'Internal Agent': ['Cyberware', 'cyberware/internal_agent'], 'Neural Link': ['Cyberware', 'cyberware/neural_link'], 'Pain Editor': ['Cyberware', 'cyberware/pain_editor'],
  'Radio Scanner (Cyberaudio)': ['Cyberware', 'cyberware/radio_scanner_music_player'], Banhammer: ['Program', 'programs/banhammer'], 'Homebrew Bug Kit': ['Gear', ''],
  'Radio Scanner/Music Player': ['Gear', 'gear/radio_scanner_music_player'], 'Scrambler/Descrambler': ['Gear', 'gear/scrambler_descrambler'], 'Bug Detector': ['Gear', 'gear/bug_detector'], 'Audio Recorder': ['Gear', 'gear/audio_recorder'], Agent: ['Gear', 'gear/agent'], Medscanner: ['Gear', 'gear/medscanner'], 'Radio Communicator': ['Gear', 'gear/radio_communicator'], 'Trauma Team Card (Silver)': ['Gear', 'gear/memory_chip'], 'Trauma Team Card (Executive)': ['Gear', 'gear/memory_chip'],
};
const itemImg = (n) => (ITEM_CAT[n]?.[1] ? CPRI(ITEM_CAT[n][1]) : '');
const itemEntries = () => Object.entries(ITEM_CAT).map(([name, [type]]) => ({ id: name, name, group: type, sub: type, img: itemImg(name), icon: 'fas fa-box' }));
/* what each character has on their sheet. [name, installed]: installed only means anything for cyberware */
const SHEETS = {
  'Veronica A.': [['Agent'], ['Biomonitor', true], ['Radio Scanner/Music Player'], ['Scrambler/Descrambler'], ['Trauma Team Card (Silver)']],
  Rache: [['Agent'], ['Cyberaudio Suite', true], ['Radio Scanner (Cyberaudio)', true], ['Amplified Hearing', true], ['Voice Stress Analyzer', true], ['Trauma Team Card (Executive)']],
  'Kid Static': [['Agent'], ['Voice Stress Analyzer', false], ['Bug Detector']],
  'Dex Moreno': [['Agent'], ['Audio Recorder']],
};
/** The one rule. Cyberware only counts once it is installed; carried gear counts as it is. Names match the way SkillService matches them. */
const itemKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const itemList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
function holdsOne(who, name) {
  const hit = (SHEETS[who] || []).find(([n]) => itemKey(n) === itemKey(name)); if (!hit) return null;
  const cyber = ITEM_CAT[hit[0]]?.[0] === 'Cyberware';
  return { item: hit[0], ...(cyber ? (hit[1] ? { counts: true, how: 'Installed' } : { counts: false, how: 'Not installed' }) : { counts: true, how: 'Carried' }) };
}
/** Takes one item or a list. Any one that counts is enough; if none does, it reports one they hold that doesn't. */
function holdsItem(who, v) { const hits = itemList(v).map((n) => holdsOne(who, n)).filter(Boolean); return hits.find((h) => h.counts) || hits[0] || null; }
const hasItem = (who, v) => !!holdsItem(who, v)?.counts;
const whoHolds = (v) => Object.keys(SHEETS).map((who) => ({ who, h: holdsItem(who, v) })).filter((x) => x.h);
const itemArt = (name, cls = '') => (itemImg(name) ? `<img class="ncm-item-art ${cls}" src="${esc(itemImg(name))}" alt="">` : `<span class="ncm-item-art is-none ${cls}"><i class="fas fa-box" aria-hidden="true"></i></span>`);
/** A small chip: the item's own icon, its name, and how this person has it. */
const itemChip = (name, how, tone, tip) => `<span class="ncm-item-chip${tone ? ' ' + tone : ''}"${tip || how ? ` data-tooltip="${esc(tip || name + ': ' + how)}"` : ''}>${itemArt(name)}${esc(name)}${how ? `<small>${esc(how)}</small>` : ''}</span>`;
/** Who has it, from their sheets. */
const whoHoldsHtml = (v) => { const items = itemList(v), list = whoHolds(items); if (!items.length) return ''; if (!list.length) return `<small class="ncm-item-who">Nobody has ${items.length > 1 ? 'any of these' : 'it'} yet</small>`; const yes = list.filter((x) => x.h.counts).length, no = list.length - yes; return `<span class="ncm-item-who" data-tooltip="${esc(list.map((x) => x.who + ': ' + x.h.item + ', ' + x.h.how.toLowerCase()).join('. '))}">${list.map((x) => `<span class="ncm-pn-face${x.h.counts ? '' : ' is-off'}" style="--tc:var(--ncm-hue-${(itemKey(x.who).length % 8) + 1})">${esc(x.who.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''))}</span>`).join('')}<small>${yes + (yes === 1 ? ' has it' : ' have it')}${no ? ', ' + no + ' not installed' : ''}</small></span>`; };
/** One setting's row: every item as an icon chip with its own remove, who holds any of them, and the picker. */
const itemListRow = (list, k, label, tip, pickOp, offOp, btnFn) => { const items = itemList(list); return `<div class="ncm-r3-itemrow" data-tooltip="${esc(tip)}"><span class="col"><span class="k">${esc(label)}${items.length > 1 ? ' · any one counts' : ''}</span><span class="ncm-item-chips">${items.length ? items.map((n) => `<span class="ncm-item-chip">${itemArt(n)}${esc(n)}<button type="button" class="ncm-item-x" data-do="${offOp}" data-k="${k}" data-name="${esc(n)}" data-tooltip="Remove ${esc(n)}" aria-label="Remove ${esc(n)}"><i class="fas fa-xmark" aria-hidden="true"></i></button></span>`).join('') : '<small>None picked</small>'}</span>${whoHoldsHtml(items)}</span>${btnFn(items.length ? 'Add or remove' : 'Pick items', 'fa-box-open', 'Tick as many as you like from the items in your world', `data-do="${pickOp}" data-k="${k}"`)}</div>`; };
