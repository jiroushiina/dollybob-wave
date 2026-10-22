export default async function handler(req, res) {
  const { jcd, hd, rno } = req.query;
  if (!jcd || !hd || !rno) return res.status(400).json({ ok: false, error: 'missing params' });

  const j = String(jcd).padStart(2, '0');
  const url = `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${rno}&jcd=${j}&hd=${hd}`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; boatrace-proxy/1.0)' }
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: `upstream ${r.status}` });
    const html = await r.text();
    const odds = parseOdds3t(html);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, odds });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

function parseOdds3t(html) {
  const tableMatches = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  if (tableMatches.length < 4) return {};
  const tableHtml = tableMatches[3][0];

  const rowMatches = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  const grid = [];

  rowMatches.forEach((rm, ri) => {
    if (!grid[ri]) grid[ri] = [];
    const rowHtml = rm[0];
    const cellMatches = [...rowHtml.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)];
    let ci = 0;
    cellMatches.forEach(cm => {
      while (grid[ri][ci]) ci++;
      const attrs = cm[1];
      const inner = cm[2].replace(/<[^>]+>/g, '').trim();
      const rs = (attrs.match(/rowspan="?(\d+)"?/i) || [, 1])[1];
      const cs = (attrs.match(/colspan="?(\d+)"?/i) || [, 1])[1];
      for (let r = ri; r < ri + parseInt(rs); r++) {
        if (!grid[r]) grid[r] = [];
        for (let c = ci; c < ci + parseInt(cs); c++) grid[r][c] = inner;
      }
      ci += parseInt(cs);
    });
  });

  if (!grid[0]) return {};
  const header = grid[0];
  const odds = {};

  for (let col = 0; col < 18; col += 3) {
    const first = header[col];
    if (!first || !/^\d$/.test(first)) continue;
    for (let row = 1; row < grid.length; row++) {
      const g = grid[row];
      if (!g) continue;
      const second = g[col];
      const third = g[col + 1];
      const val = parseFloat(g[col + 2]);
      if (second && third && /^\d$/.test(second) && /^\d$/.test(third) && !isNaN(val)) {
        odds[`${first}-${second}-${third}`] = val;
      }
    }
  }

  return odds;
}
