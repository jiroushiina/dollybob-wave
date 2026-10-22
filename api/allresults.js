export default async function handler(req, res) {
  const { hd } = req.query;
  if (!hd) return res.status(400).json({ ok: false, error: 'missing hd' });

  const url = `https://www.boatrace.jp/owpc/pc/race/pay?hd=${hd}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; boatrace-proxy/1.0)' } });
    if (!r.ok) return res.status(502).json({ ok: false, error: `upstream ${r.status}` });
    const html = await r.text();
    const results = parsePay(html);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

function parsePay(html) {
  const results = {};

  // Split into rows
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;
  while ((rowM = rowRe.exec(html)) !== null) {
    const row = rowM[1];

    // Race number from th
    const rnM = row.match(/<th[^>]*>(\d+)R<\/th>/);
    if (!rnM) continue;
    const rno = parseInt(rnM[1]);

    // Find all td elements in this row (both combo and payout)
    const allTds = [];
    const tdRe = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
    let tdM;
    while ((tdM = tdRe.exec(row)) !== null) {
      allTds.push({ attrs: tdM[1], inner: tdM[2] });
    }

    // Process pairs: combo td (has data-href with jcd) followed by payout td
    for (let i = 0; i < allTds.length - 1; i++) {
      const td = allTds[i];
      const jcdM = td.attrs.match(/data-href="[^"]*rno=(\d+)&jcd=(\d+)/);
      if (!jcdM) continue;

      const jcd = parseInt(jcdM[2]);

      // Extract combo digits from numberSet1_number spans
      const digits = [];
      const spanRe = /numberSet1_number[^>]*>(\d)</g;
      let sm;
      while ((sm = spanRe.exec(td.inner)) !== null) {
        digits.push(sm[1]);
      }
      if (digits.length < 3) continue;
      const combo = digits.slice(0, 3).join('-');

      // Payout from next td (no data-href)
      const payTd = allTds[i + 1];
      const payM = payTd.inner.match(/&yen;([\d,]+)/);
      const payout = payM ? parseInt(payM[1].replace(/,/g, '')) : 0;

      const key = `${jcd}_${rno}`;
      results[key] = { jcd, rno, combo, payout };
    }
  }

  return results;
}
