// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GENRES = [
  "Action","Adventure","Animation","Comedy","Crime",
  "Documentary","Drama","Family","Fantasy","History",
  "Horror","Music","Mystery","Romance","Science Fiction",
  "TV Movie","Thriller","War","Western"
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun",
                     "Jul","Aug","Sep","Oct","Nov","Dec"];

const COLOR_PALETTE = [
  "#e8a838","#e85d38","#38a8e8","#9b38e8","#38e86c",
  "#e838b4","#38e8d4","#e8e838","#e86c38","#386ce8",
  "#e83838","#38e8a8","#b4e838","#e8386c","#6ce838",
  "#8838e8","#e8b438","#38b4e8","#e8386c"
];

const GENRE_COLORS = Object.fromEntries(GENRES.map((g, i) => [g, COLOR_PALETTE[i % COLOR_PALETTE.length]]));

const MARGIN = { top: 40, right: 40, bottom: 60, left: 60 };

// ─── STATE ────────────────────────────────────────────────────────────────────
let allMovies = [];
let selectedYear = "all";
let activeGenre = null;
let selectedGenre = null;   // drives the scatter plot

// ─── TOOLTIPS ─────────────────────────────────────────────────────────────────
const tooltip = d3.select("#tooltip");
const scatterTooltip = d3.select("#scatter-tooltip");

// ─── MAIN ─────────────────────────────────────────────────────────────────────
d3.csv("data/cleaned_movie_dataset.csv").then(raw => {
  // 1. Deduplicate by movie title (keep first occurrence)
  const seen = new Set();
  const deduped = raw.filter(d => {
    const key = d.movie?.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 2. Parse & filter to 2010–2019
  allMovies = deduped
    .map(d => {
      const rd = d.release_date?.trim();
      if (!rd) return null;
      const parts = rd.split("-");
      if (parts.length < 2) return null;
      const year = +parts[0];
      const month = +parts[1]; // 1-indexed
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;

      // Compute genre weight
      const genreFlags = GENRES.map(g => +(d[g] || 0));
      const genreSum = genreFlags.reduce((a, b) => a + b, 0);
      if (genreSum === 0) return null; // skip unclassified

      const weight = 1 / genreSum;
      const genreWeights = Object.fromEntries(GENRES.map((g, i) => [g, genreFlags[i] * weight]));

      return {
        movie: d.movie?.trim(),
        year,
        month,
        profit: +d.profit || 0,
        worldwide_gross:   +d.worldwide_gross   || 0,
        domestic_gross:    +d.domestic_gross    || 0,
        foreign_gross:     +d.foreign_gross     || 0,
        production_budget: +d.production_budget || 0,
        genreWeights,
        genreFlags: Object.fromEntries(GENRES.map((g, i) => [g, genreFlags[i]]))
      };
    })
    .filter(d => d && d.year >= 2010 && d.year <= 2019);

  // 3. Populate year filter
  const years = [...new Set(allMovies.map(d => d.year))].sort();
  const sel = d3.select("#year-filter");
  years.forEach(y => sel.append("option").attr("value", y).text(y));

  sel.on("change", function () {
    selectedYear = this.value;
    update();
  });

  update();
}).catch(err => {
  console.error("Failed to load CSV:", err);
  d3.select("#chart").append("p")
    .style("color","#e85d38")
    .text("⚠ Could not load cleaned_movie_dataset.csv");
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update() {
  d3.select("#chart").selectAll("*").remove();

  const filtered = selectedYear === "all"
    ? allMovies
    : allMovies.filter(d => d.year === +selectedYear);

  if (filtered.length === 0) {
    d3.select("#chart").append("p").attr("class","no-data").text("No data for selected year.");
    return;
  }

  // ── Aggregate: monthly genre weights ──
  // monthData[month][genre] = sum of weighted contributions
  const monthData = Array.from({length: 12}, (_, i) => {
    const obj = { month: i + 1 };
    GENRES.forEach(g => obj[g] = 0);
    return obj;
  });

  filtered.forEach(d => {
    const m = d.month - 1; // 0-indexed
    GENRES.forEach(g => {
      monthData[m][g] += d.genreWeights[g];
    });
  });

  // Normalize each month to share (0–1) so y-axis = share
  monthData.forEach(row => {
    const total = GENRES.reduce((s, g) => s + row[g], 0);
    if (total > 0) GENRES.forEach(g => row[g] = row[g] / total);
  });

  // ── Precompute top-3 profit movies per genre (from *filtered* data) ──
  const top3ByGenre = {};
  GENRES.forEach(genre => {
    top3ByGenre[genre] = filtered
      .filter(d => d.genreFlags[genre] === 1)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 3);
  });

  // ── D3 Stack ──
  const stack = d3.stack()
    .keys(GENRES)
    .offset(d3.stackOffsetWiggle)
    .order(d3.stackOrderInsideOut);

  const series = stack(monthData);

  // ── Dimensions ──
  const container = document.getElementById("chart");
  const W = container.clientWidth || 900;
  const H = Math.min(520, window.innerHeight * 0.55);
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = H - MARGIN.top - MARGIN.bottom;

  const svg = d3.select("#chart")
    .append("svg")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  const g = svg.append("g")
    .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

  // ── Scales ──
  const xScale = d3.scaleLinear()
    .domain([1, 12])
    .range([0, innerW]);

  const yExtent = [
    d3.min(series, s => d3.min(s, d => d[0])),
    d3.max(series, s => d3.max(s, d => d[1]))
  ];

  const yScale = d3.scaleLinear()
    .domain(yExtent)
    .range([innerH, 0]);

  // ── Area generator ──
  const area = d3.area()
    .x(d => xScale(d.data.month))
    .y0(d => yScale(d[0]))
    .y1(d => yScale(d[1]))
    .curve(d3.curveCatmullRom.alpha(0.5));

  // ── Draw streams ──
  const paths = g.selectAll(".stream")
    .data(series)
    .join("path")
    .attr("class", "stream")
    .attr("d", area)
    .attr("fill", d => GENRE_COLORS[d.key])
    .attr("opacity", 0.82)
    .style("cursor", "pointer")
    .on("mousemove", function(event, d) {
      const genre = d.key;
      activeGenre = genre;

      // Dim others
      g.selectAll(".stream").attr("opacity", s => s.key === genre ? 1 : 0.18);

      // Build tooltip content
      const top3 = top3ByGenre[genre];
      const fmt = v => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;

      let html = `<div class="tt-genre" style="color:${GENRE_COLORS[genre]}">${genre}</div>`;
      html += `<div class="tt-label">Top 3 by profit:</div>`;
      if (top3.length === 0) {
        html += `<div class="tt-movie">No data</div>`;
      } else {
        top3.forEach((m, i) => {
          html += `<div class="tt-movie"><span class="tt-rank">#${i+1}</span> ${m.movie}<span class="tt-profit">${fmt(m.profit)}</span></div>`;
        });
      }

      tooltip
        .style("display","block")
        .style("opacity","1")
        .html(html)
        .style("left", (event.pageX + 14) + "px")
        .style("top", (event.pageY - 20) + "px");
    })
    .on("mouseleave", function() {
      activeGenre = null;
      g.selectAll(".stream").attr("opacity", 0.82);
      tooltip.style("opacity","0").style("display","none");
    })
    .on("click", function(event, d) {
      selectedGenre = d.key;
      const moviesForGenre = filtered.filter(m => m.genreFlags[d.key] === 1);
      drawScatter(d.key, moviesForGenre);
    });

  // ── X Axis ──
  const xAxis = d3.axisBottom(xScale)
    .tickValues(d3.range(1, 13))
    .tickFormat(i => MONTH_NAMES[i - 1]);

  g.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(xAxis);

  // ── Y Axis label (minimal — wiggle offsets it, so just label) ──
  g.append("text")
    .attr("class","axis-label")
    .attr("transform","rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -48)
    .attr("text-anchor","middle")
    .text("Genre share of releases");

  g.append("text")
    .attr("class","axis-label")
    .attr("x", innerW / 2)
    .attr("y", innerH + 48)
    .attr("text-anchor","middle")
    .text("Month");

  // ── Genre labels on streams ──
  series.forEach(s => {
    // Find the month index where this stream is tallest
    let bestMonth = 6, bestHeight = -Infinity;
    s.forEach(d => {
      const h = Math.abs(d[1] - d[0]);
      if (h > bestHeight) { bestHeight = h; bestMonth = d.data.month; }
    });
    if (bestHeight < 0.015) return; // too small to label

    const midY = yScale((s[bestMonth - 1][0] + s[bestMonth - 1][1]) / 2);
    const midX = xScale(bestMonth);

    g.append("text")
      .attr("class","stream-label")
      .attr("x", midX)
      .attr("y", midY)
      .attr("text-anchor","middle")
      .attr("dominant-baseline","middle")
      .style("pointer-events","none")
      .text(s.key.length > 8 ? s.key.slice(0, 7) + "…" : s.key);
  });

  // ── Legend ──
  const legend = d3.select("#legend");
  legend.selectAll("*").remove();

  GENRES.forEach(genre => {
    const item = legend.append("div").attr("class","legend-item")
      .style("cursor","pointer")
      .on("mouseenter", function() {
        g.selectAll(".stream").attr("opacity", s => s.key === genre ? 1 : 0.18);
      })
      .on("mouseleave", function() {
        g.selectAll(".stream").attr("opacity", 0.82);
      });

    item.append("div").attr("class","legend-dot")
      .style("background", GENRE_COLORS[genre]);
    item.append("span").text(genre);
  });
}

// ─── SCATTER PLOT ─────────────────────────────────────────────────────────────
function drawScatter(genre, movies) {
  const container = document.getElementById("scatter");
  const emptyEl   = document.getElementById("scatter-empty");

  // Show panel, hide empty state
  emptyEl.style.display  = "none";
  container.style.display = "block";
  d3.select("#scatter").selectAll("*").remove();

  const color = GENRE_COLORS[genre];
  const fmt   = v => v >= 1e9 ? `$${(v/1e9).toFixed(2)}B`
                   : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M`
                   : `$${v.toLocaleString()}`;

  // ── Header with genre name + close button ──
  const header = d3.select("#scatter").append("div").attr("class","scatter-header");
  header.append("div")
    .attr("class","scatter-genre-title")
    .style("color", color)
    .text(genre);
  header.append("button")
    .attr("class","scatter-close")
    .text("✕")
    .on("click", () => {
      selectedGenre = null;
      container.style.display = "none";
      emptyEl.style.display   = "flex";
    });

  // ── Dimensions ──
  const W = container.clientWidth || 380;
  const H = 360;
  const SM = { top: 20, right: 20, bottom: 54, left: 62 };
  const iW = W - SM.left - SM.right;
  const iH = H - SM.top  - SM.bottom;

  const svg = d3.select("#scatter")
    .append("svg")
    .attr("width",  W)
    .attr("height", H);

  const g = svg.append("g")
    .attr("transform", `translate(${SM.left},${SM.top})`);

  // Filter out rows with missing budget/gross
  const valid = movies.filter(d => d.production_budget > 0 && d.worldwide_gross > 0);

  // ── Scales ──
  const xScale = d3.scaleLinear()
    .domain([0, d3.max(valid, d => d.production_budget) * 1.05])
    .range([0, iW]);

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(valid, d => d.worldwide_gross) * 1.05])
    .range([iH, 0]);

  // ── Grid lines ──
  g.append("g").attr("class","grid")
    .selectAll("line").data(yScale.ticks(5)).join("line")
    .attr("x1", 0).attr("x2", iW)
    .attr("y1", d => yScale(d)).attr("y2", d => yScale(d))
    .attr("stroke","rgba(255,255,255,0.05)").attr("stroke-width",1);

  g.append("g").attr("class","grid")
    .selectAll("line").data(xScale.ticks(5)).join("line")
    .attr("y1", 0).attr("y2", iH)
    .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
    .attr("stroke","rgba(255,255,255,0.05)").attr("stroke-width",1);

  // ── Break-even line (gross = budget) ──
  const beMax = Math.min(
    d3.max(valid, d => d.production_budget),
    d3.max(valid, d => d.worldwide_gross)
  );
  g.append("line")
    .attr("x1", xScale(0)).attr("y1", yScale(0))
    .attr("x2", xScale(beMax)).attr("y2", yScale(beMax))
    .attr("stroke","rgba(255,255,255,0.12)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray","4 3");

  // ── Dots ──
  g.selectAll(".scatter-dot")
    .data(valid)
    .join("circle")
    .attr("class","scatter-dot")
    .attr("cx", d => xScale(d.production_budget))
    .attr("cy", d => yScale(d.worldwide_gross))
    .attr("r", 5)
    .attr("fill", color)
    .attr("opacity", 0.7)
    .on("mousemove", function(event, d) {
      d3.select(this).attr("r", 7).attr("opacity", 1);

      const dateStr = `${d.year}-${String(d.month).padStart(2,"0")}`;
      let html = `<div class="stt-title">${d.movie}</div>`;
      html += row("Release",   dateStr);
      html += row("Budget",    fmt(d.production_budget));
      html += row("Worldwide", fmt(d.worldwide_gross));
      html += row("Domestic",  fmt(d.domestic_gross));
      html += row("Foreign",   fmt(d.foreign_gross));

      scatterTooltip
        .style("display","block").style("opacity","1")
        .html(html)
        .style("left", (event.pageX + 14) + "px")
        .style("top",  (event.pageY - 20) + "px");
    })
    .on("mouseleave", function() {
      d3.select(this).attr("r", 5).attr("opacity", 0.7);
      scatterTooltip.style("opacity","0").style("display","none");
    });

  // ── Axes ──
  g.append("g").attr("class","scatter-axis")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(v => `$${v/1e6|0}M`));

  g.append("g").attr("class","scatter-axis")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(v => `$${v/1e6|0}M`));

  // Axis labels
  g.append("text").attr("class","axis-label")
    .attr("x", iW / 2).attr("y", iH + 46).attr("text-anchor","middle")
    .text("Production Budget");

  g.append("text").attr("class","axis-label")
    .attr("transform","rotate(-90)")
    .attr("x", -iH / 2).attr("y", -52).attr("text-anchor","middle")
    .text("Worldwide Gross");
}

// helper for scatter tooltip rows
function row(label, value) {
  return `<div class="stt-row"><span>${label}</span><span>${value}</span></div>`;
}


let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(update, 180);
});