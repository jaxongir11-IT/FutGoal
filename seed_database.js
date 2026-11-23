const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// 1. Extract LEAGUES_STANDINGS_DATABASE
const standingsMatch = html.match(/const LEAGUES_STANDINGS_DATABASE\s*=\s*({[\s\S]*?});/);
let standings = {};
if (standingsMatch) {
  try { standings = eval('(' + standingsMatch[1] + ')'); } catch(e) { console.error('Standings error', e); }
}

// 2. Extract LEAGUES_SCORERS_DATABASE
const scorersMatch = html.match(/const LEAGUES_SCORERS_DATABASE\s*=\s*({[\s\S]*?});/);
let scorers = {};
if (scorersMatch) {
  try { scorers = eval('(' + scorersMatch[1] + ')'); } catch(e) { console.error('Scorers error', e); }
}

// 3. Extract LEAGUES_ASSISTS_DATABASE
const assistsMatch = html.match(/const LEAGUES_ASSISTS_DATABASE\s*=\s*({[\s\S]*?});/);
let assists = {};
if (assistsMatch) {
  try { assists = eval('(' + assistsMatch[1] + ')'); } catch(e) { console.error('Assists error', e); }
}

// 4. Extract DEFAULT_FOTMOB_MATCHES
const matchesMatch = html.match(/const DEFAULT_FOTMOB_MATCHES\s*=\s*(\[[\s\S]*?\]);/);
let matches = [];
if (matchesMatch) {
  try { matches = eval('(' + matchesMatch[1] + ')'); } catch(e) { console.error('Matches error', e); }
}

// 5. Extract TRANSFERS_DATA
const transfersMatch = html.match(/const TRANSFERS_DATA\s*=\s*(\[[\s\S]*?\]);/);
let transfers = [];
if (transfersMatch) {
  try { transfers = eval('(' + transfersMatch[1] + ')'); } catch(e) { console.error('Transfers error', e); }
}

// 6. Extract NEWS_DATABASE
const newsMatch = html.match(/const NEWS_DATABASE\s*=\s*(\[[\s\S]*?\]);/);
let news = [];
if (newsMatch) {
  try { news = eval('(' + newsMatch[1] + ')'); } catch(e) { console.error('News error', e); }
}

// 7. Extract TOP_20_LEAGUES_ORDER
const orderMatch = html.match(/const TOP_20_LEAGUES_ORDER\s*=\s*(\[[\s\S]*?\]);/);
let order = [];
if (orderMatch) {
  try { order = eval('(' + orderMatch[1] + ')'); } catch(e) { console.error('Order error', e); }
}

// Save all to data directory
fs.writeFileSync(path.join(dataDir, 'standings.json'), JSON.stringify(standings, null, 2));
fs.writeFileSync(path.join(dataDir, 'scorers.json'), JSON.stringify(scorers, null, 2));
fs.writeFileSync(path.join(dataDir, 'assists.json'), JSON.stringify(assists, null, 2));
fs.writeFileSync(path.join(dataDir, 'matches.json'), JSON.stringify(matches, null, 2));
fs.writeFileSync(path.join(dataDir, 'transfers.json'), JSON.stringify(transfers, null, 2));
fs.writeFileSync(path.join(dataDir, 'news.json'), JSON.stringify(news, null, 2));
fs.writeFileSync(path.join(dataDir, 'leagues_order.json'), JSON.stringify(order, null, 2));

console.log('Seeded database successfully:');
console.log('- Matches:', matches.length);
console.log('- Leagues:', Object.keys(standings).length);
console.log('- Transfers:', transfers.length);
console.log('- News:', news.length);
