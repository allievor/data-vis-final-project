// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GENRES = [
  "Action","Adventure","Animation","Comedy","Crime",
  "Documentary","Drama","Family","Fantasy","History",
  "Horror","Music","Mystery","Romance","Science Fiction",
  "Thriller","War","Western"
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun",
                     "Jul","Aug","Sep","Oct","Nov","Dec"];

const COLOR_PALETTE = [
  "#33a02c","#1f78b4","#1f78b4","#1f78b4","#33a02c",
  "#33a02c","#a6cee3","#b2df8a","#33a02c","#b2df8a",
  "#a6cee3","#a6cee3","#a6cee3","#b2df8a","#a6cee3",
  "#b2df8a","#1f78b4","#b2df8a"
];

const GENRE_COLORS = Object.fromEntries(GENRES.map((g, i) => [g, COLOR_PALETTE[i % COLOR_PALETTE.length]]));

const MARGIN = { top: 40, right: 40, bottom: 60, left: 60 };

// ─── STATE ────────────────────────────────────────────────────────────────────
let allMovies = [];
let selectedYear = "all";
let activeGenre = null;
let selectedGenre = null;   // drives the scatter plot
let currentFiltered = [];
let currentTop3ByGenre = {};
let currentTotalShares = {};
let currentG = null;

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

  // 2. Parse & filter to 2010–2018
  allMovies = deduped
    .map(d => {
      const rd = d.release_date?.trim();
      if (!rd) return null;
      const parts = rd.split("-");
      if (parts.length < 2) return null;
      const year = +parts[0];
      const month = +parts[1]; // 1-indexed
      const day = +parts[2];
      if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;

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
        day,
        profit: +d.profit || 0,
        gross_revenue:   +d.gross_revenue  || 0,
        production_budget: +d.production_budget || 0,
        genreWeights,
        genreFlags: Object.fromEntries(GENRES.map((g, i) => [g, genreFlags[i]]))
      };
    })
    .filter(d => d && d.year >= 2010 && d.year <= 2018);

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

  currentYearStr = selectedYear;
  if(currentYearStr === "all"){
    currentYearStr = "2010-2018"
  }


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

  const genreTotals = {};
  GENRES.forEach(g => genreTotals[g] = 0);

  allMovies.forEach(d => {
    GENRES.forEach(g => {
      genreTotals[g] += d.genreWeights[g];
    });
  });


  const totalSharesByGenre = {};

  GENRES.forEach(genre => {
    totalSharesByGenre[genre] = d3.sum(
      filtered,
      d => d.genreWeights[genre]
    );
  });

  // Sort genres by total contribution (largest first)
  const ORDERED_GENRES = GENRES
    .slice()
    .sort((a, b) => genreTotals[b] - genreTotals[a]);


  currentFiltered = filtered;
  currentTop3ByGenre = top3ByGenre;
  currentTotalShares = totalSharesByGenre;

  // ── D3 Stack ──
  const stack = d3.stack()
    .keys(ORDERED_GENRES)
    .offset(d3.stackOffsetWiggle)
    .order(d3.stackOrderNone);

  const series = stack(monthData);

  // ── Dimensions ──
  const container = document.getElementById("chart");
  const W = container.clientWidth || 900;
  const H = Math.min(750, window.innerHeight * 0.8);
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = H - MARGIN.top - MARGIN.bottom;

  const svg = d3.select("#chart")
    .append("svg")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  const g = svg.append("g")
    .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    svg.append("text")
    .attr("class", "chart-title")
    .attr("x", W / 2)
    .attr("y", 25)
    .attr("text-anchor", "middle")
    .text(`Movie Genre Release Trends (${currentYearStr})`);
  currentG = g;

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
    // Roving tabindex: first stream is reachable via Tab, rest via arrow keys
    .attr("tabindex", (d, i) => i === 0 ? "0" : "-1")
    .attr("role", "button")
    .attr("aria-label", d => `${d.key} genre stream. Press Enter to open scatter plot.`)
    .on("focus", function(event, d) {
      const genre = d.key;
      activeGenre = genre;
      currentG.selectAll(".stream").attr("opacity", s => s.key === genre ? 1 : 0.18);

      const top3 = currentTop3ByGenre[genre];
      const totalShare = currentTotalShares[genre];
      const fmt = v => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;

      let html = `<div class="tt-genre" style="color:${GENRE_COLORS[genre]}">${genre}: ${totalShare.toFixed(1)} shares</div>`;
      html += `<div class="tt-label">Top 3 by profit:</div>`;
      if (top3.length === 0) {
        html += `<div class="tt-movie">No data</div>`;
      } else {
        top3.forEach((m, i) => {
          html += `<div class="tt-movie"><span class="tt-rank">#${i+1}</span> ${m.movie}<span class="tt-profit">${fmt(m.profit)}</span></div>`;
        });
      }

      const rect = event.target.getBoundingClientRect();
      tooltip
        .style("display", "block")
        .style("opacity", "1")
        .html(html)
        .style("left", (rect.left + rect.width / 2 + 14) + "px")
        .style("top",  (rect.top  + 14) + "px");
    })
    .on("blur", function() {
      activeGenre = null;
      currentG.selectAll(".stream").attr("opacity", 0.82);
      tooltip.style("opacity","0").style("display","none");
    })
    .on("keydown", function(event, d) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectedGenre = d.key;
        const moviesForGenre = currentFiltered.filter(m => m.genreFlags[d.key] === 1);
        drawScatter(d.key, moviesForGenre);
      }
      // Roving tabindex: arrow keys move focus between streams
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        const all = currentG.selectAll(".stream").nodes();
        const i = all.indexOf(this);
        const next = all[(i + 1) % all.length];
        all.forEach(n => d3.select(n).attr("tabindex", "-1"));
        d3.select(next).attr("tabindex", "0");
        next.focus();
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        const all = currentG.selectAll(".stream").nodes();
        const i = all.indexOf(this);
        const prev = all[(i - 1 + all.length) % all.length];
        all.forEach(n => d3.select(n).attr("tabindex", "-1"));
        d3.select(prev).attr("tabindex", "0");
        prev.focus();
      }
    })
    .on("mousemove", function(event, d) {
      const genre = d.key;
      activeGenre = genre;
      totalShare = totalSharesByGenre[genre];

      g.selectAll(".stream").attr("opacity", s => s.key === genre ? 1 : 0.18);

      const top3 = top3ByGenre[genre];
      const fmt = v => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;

      let html = `<div class="tt-genre" style="color:${GENRE_COLORS[genre]}">${genre}: ${totalShare.toFixed(1)} shares</div>`;
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
        .style("top", (event.pageY - 160) + "px");
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
      .text(s.key);
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
      })
      .on("click", function() {
      selectedGenre = genre;
      const moviesForGenre = filtered.filter(m => m.genreFlags[genre] === 1);
      drawScatter(genre, moviesForGenre);
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
    .text(`${genre} Movies from ${currentYearStr}`);
  header.append("button")
    .attr("class","scatter-close")
    .text("✕")
    .on("click", () => {
      selectedGenre = null;
      container.style.display = "none";
      emptyEl.style.display   = "flex";
    });

  // ── Dimensions ──
  const W = container.clientWidth || 700;
  const H = 450;
  const SM = { top: 20, right: 20, bottom: 54, left: 85 };
  const iW = W - SM.left - SM.right;
  const iH = H - SM.top  - SM.bottom;

  const svg = d3.select("#scatter")
    .append("svg")
    .attr("width",  W)
    .attr("height", H);

  svg.append("defs").append("clipPath")
    .attr("id", "scatter-clip")
    .append("rect")
    .attr("width", iW)
    .attr("height", iH);

  const g = svg.append("g")
    .attr("transform", `translate(${SM.left},${SM.top})`);

  // Filter out rows with missing budget/gross
  const valid = movies.filter(d => d.production_budget > 0 && d.gross_revenue > 0);

  // ── Scales ──
  const xScale = d3.scaleLinear()
    .domain([0, d3.max(valid, d => d.production_budget) * 1.05])
    .range([0, iW]);

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(valid, d => d.gross_revenue) * 1.05])
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
    d3.max(valid, d => d.gross_revenue)
  );
  const gBreakEven = g.append("line")
    .attr("x1", xScale(0)).attr("y1", yScale(0))
    .attr("x2", xScale(beMax)).attr("y2", yScale(beMax))
    .attr("stroke","rgba(255,255,255,0.12)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray","4 3");

// ── Dots ──
const dotsGroup = g.append("g").attr("clip-path", "url(#scatter-clip)");

dotsGroup.selectAll(".scatter-dot")
  .data(valid)
  .join("circle")
  .attr("class", "scatter-dot")
  .attr("cx", d => xScale(d.production_budget))
  .attr("cy", d => yScale(d.gross_revenue))
  .attr("r", 5)
  .attr("fill", color)
  .attr("opacity", 0.7)
  .on("mousemove", function(event, d) {
    d3.select(this).attr("r", 7).attr("opacity", 1);

    const dateStr = `${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}-${d.year}`;

    let html = `<div class="stt-title">${d.movie}</div>`;
    html += row("Release Date", dateStr);
    html += row("Budget", fmt(d.production_budget));
    html += row("Revenue", fmt(d.gross_revenue));

    // Calculate tooltip position
    const tooltipWidth = scatterTooltip.node().offsetWidth; // Get tooltip width
    const windowWidth = window.innerWidth; // Get window width
    let tooltipX = event.pageX + 14; // Default position with padding
    let tooltipY = event.pageY - 20;

    // Adjust position if tooltip goes off the right edge
    if (tooltipX + tooltipWidth > windowWidth) {
      tooltipX = windowWidth - tooltipWidth - 10; // Align to the right edge with padding
      tooltipY = event.pageY + 20; // Move tooltip below the dot to avoid overlap
    }

    // Adjust position if tooltip goes off the top of the screen
    if (tooltipY < 0) {
      tooltipY = event.pageY + 20; // Move tooltip below the dot
    }

    scatterTooltip
      .style("display", "block")
      .style("opacity", "1")
      .html(html)
      .style("left", `${tooltipX}px`)
      .style("top", `${tooltipY}px`);
  })
  .on("mouseleave", function() {
    d3.select(this).attr("r", 5).attr("opacity", 0.7);
    scatterTooltip.style("opacity", "0").style("display", "none");
  });
  // ── Axes ──
  const gXAxis = g.append("g").attr("class","scatter-axis")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(v => `$${v/1e6|0}M`));

  const gYAxis = g.append("g").attr("class","scatter-axis")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(v => `$${v/1e6|0}M`));

  // ── Zoom ──
  const zoom = d3.zoom()
    .scaleExtent([1, 40])
    .translateExtent([[0, 0], [iW, iH]])
    .extent([[0, 0], [iW, iH]])
    .on("zoom", (event) => {
      const t = event.transform;

      // Rescale axes
      const newX = t.rescaleX(xScale);
      const newY = t.rescaleY(yScale);

      // Redraw axes with new scales
      gXAxis.call(d3.axisBottom(newX).ticks(5).tickFormat(v => `$${v/1e6|0}M`));
      gYAxis.call(d3.axisLeft(newY).ticks(5).tickFormat(v => `$${v/1e6|0}M`));

      // Reposition dots
      dotsGroup.selectAll(".scatter-dot")
        .attr("cx", d => newX(d.production_budget))
        .attr("cy", d => newY(d.gross_revenue));

      // Reposition break-even line
      gBreakEven
        .attr("x1", newX(0)).attr("y1", newY(0))
        .attr("x2", newX(beMax)).attr("y2", newY(beMax));
    });

  svg.call(zoom);

  // Reset zoom on double-click
  svg.on("dblclick.zoom", () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));

  // Zoom hint label
  g.append("text")
    .attr("x", iW).attr("y", -6)
    .attr("text-anchor", "end")
    .attr("font-size", "14px")
    .attr("fill", "rgba(255, 255, 255, 0.76)")
    .text("Scroll to zoom, double-click to reset");

  // Axis labels
  g.append("text").attr("class","axis-label")
    .attr("x", iW / 2).attr("y", iH + 46).attr("text-anchor","middle")
    .text("Production Budget");

  g.append("text").attr("class","axis-label")
    .attr("transform","rotate(-90)")
    .attr("x", -iH / 2).attr("y", -68).attr("text-anchor","middle")
    .text("Gross Revenue");
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

// ─── INFO MODAL ───────────────────────────────────────────────────────────────
const infoOverlay = document.getElementById("info-overlay");
const infoBtn     = document.getElementById("info-btn");
const infoClose   = document.getElementById("info-close");

// Make the overlay visible initially
infoOverlay.hidden = false;

function openInfo() {
  infoOverlay.hidden = false;
  infoClose.focus();
}

function closeInfo() {
  infoOverlay.hidden = true;
  infoBtn.focus();
}

infoBtn.addEventListener("click", openInfo);
infoClose.addEventListener("click", closeInfo);

// Close on backdrop click
infoOverlay.addEventListener("click", function(e) {
  if (e.target === infoOverlay) closeInfo();
});

// Close on Escape
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape" && !infoOverlay.hidden) closeInfo();
});