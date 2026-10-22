export default async function handler(req, res) {
  const { jcd, hd, rno } = req.query;
  if (!jcd || !hd || !rno) return res.status(400).json({ ok: false, error: 'missing params' });

  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${rno}&jcd=${String(jcd).padStart(2,'0')}&hd=${hd}`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; boatrace-proxy/1.0)' }
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: `upstream ${r.status}` });
    const html = await r.text();
    const data = parseBeforeInfo(html);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

function parseBeforeInfo(html) {
  const boats = [];

  // Find racer photo positions to delimit each boat's section
  const photoRe = /racerphoto\/(\d{4})\.jpg/g;
  const positions = [];
  let m;
  while ((m = photoRe.exec(html)) !== null) {
    positions.push({ toban: m[1], pos: m.index });
  }

  // Extract exhibition time rankings (for rank calculation)
  const etValues = [];

  positions.forEach((pos, i) => {
    const start = pos.pos;
    const end = i + 1 < positions.length ? positions[i + 1].pos : Math.min(html.length, start + 3000);
    const chunk = html.slice(start, end);

    // Weight: XX.Xkg pattern (40-70 range)
    const weightM = chunk.match(/\b([4-6]\d\.\d)\s*(?:kg|ｋｇ|）)/i);
    const weight = weightM ? parseFloat(weightM[1]) : null;

    // Exhibition time: 6.XX or 7.XX (distinct range)
    const etM = chunk.match(/\b([67]\.\d{2})\b/);
    const exhibitionTime = etM ? parseFloat(etM[1]) : null;
    if (exhibitionTime) etValues.push({ lane: i + 1, et: exhibitionTime });

    // Tilt: -X.X or X.X (-3.0 to 3.0, in 0.5 steps)
    const tiltM = chunk.match(/(-?[0-3]\.[50])\s*(?=\s|<|$)/);
    const tilt = tiltM ? parseFloat(tiltM[1]) : 0;

    // Parts exchange flags (ピストン/リング/電気/キャブ/シリンダ/シャフト/ギヤ/キャリボ)
    const parts = [];
    if (/ピストン/.test(chunk)) parts.push('ピストン');
    if (/リング/.test(chunk)) parts.push('リング');
    if (/電気/.test(chunk)) parts.push('電気');
    if (/キャブ/.test(chunk)) parts.push('キャブ');
    if (/シリンダ/.test(chunk)) parts.push('シリンダ');
    if (/シャフト/.test(chunk)) parts.push('シャフト');
    if (/ギヤ/.test(chunk)) parts.push('ギヤ');
    if (/キャリボ/.test(chunk)) parts.push('キャリボ');
    const propNew = /新/.test(chunk);

    boats.push({
      lane: i + 1,
      toban: parseInt(pos.toban),
      weight,
      exhibitionTime,
      tilt,
      parts,
      propNew,
      etRank: null // filled after sorting
    });
  });

  // Calculate exhibition time rankings
  if (etValues.length > 0) {
    const sorted = [...etValues].sort((a, b) => a.et - b.et); // lower = faster = better
    sorted.forEach((v, rank) => {
      const boat = boats.find(b => b.lane === v.lane);
      if (boat) boat.etRank = rank + 1;
    });
  }

  // Parse start exhibition ST values
  // Pattern: ".XX" or "F.XX" (e.g., ".05", "F.01")
  const stSection = html.indexOf('スタート展示');
  if (stSection !== -1) {
    const stChunk = html.slice(stSection, stSection + 2000);
    const stRe = /(?:^|\s)([1-6])\s+(F?\.\d{2})/gm;
    let sm;
    while ((sm = stRe.exec(stChunk)) !== null) {
      const lane = parseInt(sm[1]);
      const stStr = sm[2];
      const boat = boats.find(b => b.lane === lane);
      if (boat) {
        boat.startExhibitionFlying = stStr.startsWith('F');
        boat.startExhibitionST = parseFloat(stStr.replace('F', '0'));
      }
    }
  }

  // Parse weather
  const weather = {};
  const tempM = html.match(/気温\s*([\d.]+)\s*℃/);
  const windM = html.match(/風速\s*(\d+)\s*m/);
  const waterM = html.match(/水温\s*([\d.]+)\s*℃/);
  const waveM = html.match(/波高\s*(\d+)\s*cm/);
  const windDirM = html.match(/風向[\s\S]{0,20}?(北|南|東|西|北東|北西|南東|南西)/);
  if (tempM) weather.temp = parseFloat(tempM[1]);
  if (windM) weather.wind = parseInt(windM[1]);
  if (waterM) weather.waterTemp = parseFloat(waterM[1]);
  if (waveM) weather.wave = parseInt(waveM[1]);
  if (windDirM) weather.windDir = windDirM[1];

  return { boats, weather };
}
