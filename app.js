import * as maplibregl from "https://unpkg.com/maplibre-gl@6.18.0/dist/maplibre-gl.mjs";
import { PMTiles, Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm";

const BASEMAP_STYLE_URL = "https://carto.elemnt.earth/2026-06-23_marginalia/style.json";
const CONFIG_URL = "./config.ini";
const CONFIG_KEY = "pmtile_rice";
const SOURCE_ID = "eco-pmtiles";
const STYLE_MODES = {
  start_date: { field: "start_date", label: "ช่วงเริ่มปลูก" },
  harv_low: { field: "harv_low", label: "เดือนสิ้นสุดเก็บเกี่ยว" },
};

const elements = {
  shell: document.querySelector("#app-shell"),
  statusChip: document.querySelector("#status-chip"),
  statusText: document.querySelector("#status-text"),
  fitButton: document.querySelector("#fit-button"),
  retryButton: document.querySelector("#retry-button"),
  errorPanel: document.querySelector("#error-panel"),
  errorTitle: document.querySelector("#error-title"),
  errorMessage: document.querySelector("#error-message"),
  formatBadge: document.querySelector("#format-badge"),
  styleMode: document.querySelector("#style-mode"),
  sourceName: document.querySelector("#source-name"),
  zoomRange: document.querySelector("#zoom-range"),
  layerCount: document.querySelector("#layer-count"),
  layerToggle: document.querySelector("#layer-toggle"),
  opacityRange: document.querySelector("#opacity-range"),
  opacityOutput: document.querySelector("#opacity-output"),
  legendLabel: document.querySelector("#legend-label"),
  legendList: document.querySelector("#legend-list"),
  attributeSummary: document.querySelector("#attribute-summary"),
  attributeList: document.querySelector("#attribute-list"),
  attributeEmpty: document.querySelector("#attribute-empty"),
  coordinateReadout: document.querySelector("#coordinate-readout"),
};

let map;
let protocol;
let overlayLayerIds = [];
let thematicLayerIds = { fill: [], line: [], point: [] };
let dataBounds;
let dataMinZoom = 0;
let overlayKind;
let legendRules = [];
let harvestLegendRules = [];
let activeStyleMode = "start_date";
let enabledRuleIds = { start_date: new Set(), harv_low: new Set() };
let currentVectorMetadata = {};

class PMTilesNotFoundError extends Error {
  constructor(urls) {
    super("ไม่พบ PMTiles จาก pmtile_rice ทั้งความละเอียด 40m และ 30m");
    this.name = "PMTilesNotFoundError";
    this.urls = urls;
  }
}

function parseIni(text) {
  const values = {};
  let section = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    values[section ? `${section}.${key}` : key] = value;
    if (!(key in values)) values[key] = value;
  }

  return values;
}

function parseJsonConfigValue(text, key) {
  const match = new RegExp(`^\\s*${key}\\s*=`, "m").exec(text);
  if (!match) return undefined;

  const valueStart = text.slice(match.index + match[0].length).search(/[\[{]/);
  if (valueStart === -1) return undefined;

  const start = match.index + match[0].length + valueStart;
  const opening = text[start];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth === 0) return JSON.parse(text.slice(start, index + 1));
  }

  throw new Error(`${key} เป็น JSON ที่ปิดวงเล็บไม่ครบ`);
}

function normalizeLegendRules(rawLegend) {
  if (!Array.isArray(rawLegend)) return [];

  return rawLegend.map((item, index) => {
    const dates = item?.label_date;
    if (!Array.isArray(dates) || dates.length !== 2) {
      throw new Error(`legend ลำดับ ${index + 1} ต้องมี label_date [วันเริ่ม, วันสิ้นสุด]`);
    }

    const [startDate, endDate] = dates.map(String);
    if (![startDate, endDate].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))) {
      throw new Error(`legend ลำดับ ${index + 1} ต้องใช้วันที่รูปแบบ YYYY-MM-DD`);
    }
    if (startDate > endDate) {
      throw new Error(`legend ลำดับ ${index + 1} มีวันเริ่มหลังวันสิ้นสุด`);
    }

    const colour = String(item?.colour ?? "");
    if (!/^#[0-9a-f]{6}$/i.test(colour)) {
      throw new Error(`legend ลำดับ ${index + 1} ต้องใช้ colour แบบ #RRGGBB`);
    }

    return {
      id: `${startDate}:${endDate}`,
      name: String(item?.name ?? ""),
      labelDate: [startDate, endDate],
      label: String(item?.label || `${startDate} – ${endDate}`),
      colour,
    };
  });
}

function normalizeHarvestLegendRules(rawLegend) {
  if (!Array.isArray(rawLegend)) return [];

  const rules = rawLegend.map((item, index) => {
    const month = String(item?.month ?? "").padStart(2, "0");
    if (!/^(?:0[1-9]|1[0-2])$/.test(month)) {
      throw new Error(`harvest_legend ลำดับ ${index + 1} ต้องมี month ระหว่าง 01–12`);
    }

    const colour = String(item?.colour ?? "");
    if (!/^#[0-9a-f]{6}$/i.test(colour)) {
      throw new Error(`harvest_legend ลำดับ ${index + 1} ต้องใช้ colour แบบ #RRGGBB`);
    }

    return {
      id: `month-${month}`,
      month,
      label: String(item?.label || `เดือน ${month}`),
      colour,
    };
  });

  if (new Set(rules.map((rule) => rule.month)).size !== rules.length) {
    throw new Error("harvest_legend มีเดือนซ้ำกัน");
  }
  return rules;
}

function getActiveRules() {
  return activeStyleMode === "harv_low" ? harvestLegendRules : legendRules;
}

function getActiveField() {
  return STYLE_MODES[activeStyleMode].field;
}

function makeRuleCondition(rule) {
  const field = getActiveField();
  if (activeStyleMode === "harv_low") {
    const monthValue = ["slice", ["to-string", ["get", field]], 5, 7];
    return ["==", monthValue, rule.month];
  }

  const dateValue = ["slice", ["to-string", ["get", field]], 0, 10];
  return [
    "all",
    [">=", dateValue, rule.labelDate[0]],
    ["<=", dateValue, rule.labelDate[1]],
  ];
}

function makeThematicColorExpression(fallbackColor) {
  const rules = getActiveRules();
  if (!rules.length) return fallbackColor;

  const expression = ["case"];
  for (const rule of rules) {
    expression.push(makeRuleCondition(rule), rule.colour);
  }
  expression.push(fallbackColor);
  return expression;
}

function makeThematicFilter(geometryType) {
  const rules = getActiveRules();
  if (!rules.length) return ["==", ["geometry-type"], geometryType];

  const enabled = enabledRuleIds[activeStyleMode];
  const conditions = rules.filter((rule) => enabled.has(rule.id)).map(makeRuleCondition);
  return [
    "all",
    ["==", ["geometry-type"], geometryType],
    conditions.length ? ["any", ...conditions] : false,
  ];
}

function updateThematicStyle() {
  if (!map || overlayKind !== "vector") return;

  const fallbackColor = cssToken("--map-color-layer-fill");
  const featureColor = makeThematicColorExpression(fallbackColor);
  for (const layerId of thematicLayerIds.fill) {
    if (!map.getLayer(layerId)) continue;
    map.setPaintProperty(layerId, "fill-color", featureColor);
    map.setFilter(layerId, makeThematicFilter("Polygon"));
  }
  for (const layerId of thematicLayerIds.line) {
    if (!map.getLayer(layerId)) continue;
    map.setPaintProperty(layerId, "line-color", featureColor);
    map.setFilter(layerId, makeThematicFilter("LineString"));
  }
  for (const layerId of thematicLayerIds.point) {
    if (!map.getLayer(layerId)) continue;
    map.setPaintProperty(layerId, "circle-color", featureColor);
    map.setFilter(layerId, makeThematicFilter("Point"));
  }
}

function renderLegend(metadata) {
  const vectorLayers = Array.isArray(metadata?.vector_layers) ? metadata.vector_layers : [];
  const field = getActiveField();
  const rules = getActiveRules();
  const enabled = enabledRuleIds[activeStyleMode];
  const hasFeatureDate = vectorLayers.some((layer) =>
    Object.prototype.hasOwnProperty.call(layer?.fields ?? {}, field),
  );
  const latestDate = legendRules.reduce(
    (latest, rule) => (rule.labelDate[1] > latest ? rule.labelDate[1] : latest),
    "",
  );

  elements.legendList.replaceChildren();
  elements.legendLabel.textContent = !rules.length
    ? "ยังไม่ได้กำหนด legend"
    : hasFeatureDate
      ? activeStyleMode === "harv_low"
        ? `${field} · แยกตามเดือน`
        : `${field} · ข้อมูลล่าสุด ${latestDate}`
      : `ไม่พบ ${field} ใน PMTiles metadata`;

  for (const rule of rules) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    label.className = "legend-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled.has(rule.id);
    checkbox.setAttribute("aria-label", `แสดง ${rule.label}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) enabled.add(rule.id);
      else enabled.delete(rule.id);
      updateThematicStyle();
    });

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.backgroundColor = rule.colour;
    swatch.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.textContent = rule.label;
    const dates = document.createElement("small");
    dates.textContent = activeStyleMode === "harv_low"
      ? `เดือน ${rule.month}`
      : `${rule.labelDate[0]} – ${rule.labelDate[1]}`;
    text.append(dates);
    label.append(checkbox, swatch, text);
    item.append(label);
    elements.legendList.append(item);
  }
}

function cssToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setStatus(state, message) {
  elements.statusChip.dataset.state = state;
  elements.statusText.textContent = message;
}

function setError(title, message) {
  setStatus("error", "โหลดข้อมูลไม่สำเร็จ");
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
  elements.errorPanel.hidden = false;
  elements.retryButton.dataset.state = "error";
}

function clearError() {
  elements.errorPanel.hidden = true;
  delete elements.retryButton.dataset.state;
}

function isNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:bad response code|http)\s*:?\s*404\b/i.test(message);
}

function make30mFallbackUrl(url) {
  const fallbackUrl = new URL(url);
  const fallbackPath = fallbackUrl.pathname.replace(/_40m\.pmtiles$/i, "_30m.pmtiles");
  if (fallbackPath === fallbackUrl.pathname) return undefined;
  fallbackUrl.pathname = fallbackPath;
  return fallbackUrl.href;
}

async function loadPmtilesWithFallback(primaryUrl) {
  const fallbackUrl = make30mFallbackUrl(primaryUrl);
  const candidateUrls = fallbackUrl ? [primaryUrl, fallbackUrl] : [primaryUrl];

  for (const [index, candidateUrl] of candidateUrls.entries()) {
    if (index > 0) setStatus("loading", "ไม่พบข้อมูล 40m · กำลังลอง 30m…");

    const archive = new PMTiles(candidateUrl);
    try {
      const header = await archive.getHeader();
      const metadata = await archive.getMetadata().catch(() => ({}));
      return { archive, header, metadata, url: candidateUrl };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  throw new PMTilesNotFoundError(candidateUrls);
}

async function loadConfig() {
  let response;
  try {
    response = await fetch(CONFIG_URL, { cache: "no-store" });
  } catch (error) {
    throw new Error(
      "อ่าน config.ini ไม่ได้ กรุณาเปิดหน้านี้ผ่าน HTTP server เช่น python3 -m http.server 8000",
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new Error(`อ่าน config.ini ไม่ได้ (HTTP ${response.status})`);
  }

  const configText = await response.text();
  const config = parseIni(configText);
  const rawUrl = config[CONFIG_KEY];
  if (!rawUrl) {
    throw new Error(`ไม่พบคีย์ ${CONFIG_KEY} ใน config.ini`);
  }

  const defaultUrl = new URL(rawUrl, window.location.href);
  if (!/^https?:$/.test(defaultUrl.protocol)) {
    throw new Error(`${CONFIG_KEY} ต้องเป็น URL แบบ http หรือ https`);
  }

  const legend = parseJsonConfigValue(configText, "legend");
  const harvestLegend = parseJsonConfigValue(configText, "harvest_legend");
  return {
    defaultUrl: defaultUrl.href,
    legend: normalizeLegendRules(legend),
    harvestLegend: normalizeHarvestLegendRules(harvestLegend),
  };
}

function waitForMapStyle(mapInstance) {
  if (mapInstance.isStyleLoaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Marginalia basemap ใช้เวลาโหลดเกิน 20 วินาที"));
    }, 20_000);
    const onStyleLoad = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      mapInstance.off("style.load", onStyleLoad);
    };
    mapInstance.on("style.load", onStyleLoad);
  });
}

function makeMap() {
  const instance = new maplibregl.Map({
    container: "map",
    style: BASEMAP_STYLE_URL,
    center: [100.55, 13.2],
    zoom: 5,
    attributionControl: false,
  });

  instance.addControl(
    new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
    "top-left",
  );
  instance.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");
  instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

  instance.on("mousemove", (event) => {
    elements.coordinateReadout.textContent =
      `Lng ${event.lngLat.lng.toFixed(5)} · Lat ${event.lngLat.lat.toFixed(5)} · Z ${instance.getZoom().toFixed(1)}`;
  });

  instance.on("mouseout", () => {
    elements.coordinateReadout.textContent = `Lng — · Lat — · Z ${instance.getZoom().toFixed(1)}`;
  });

  return instance;
}

function makeBounds(header) {
  const numbers = [header.minLon, header.minLat, header.maxLon, header.maxLat];
  if (!numbers.every(Number.isFinite)) return null;
  if (header.minLon >= header.maxLon || header.minLat >= header.maxLat) return null;
  return [
    [header.minLon, header.minLat],
    [header.maxLon, header.maxLat],
  ];
}

function safeLayerId(value, index) {
  const slug = String(value || `layer-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${SOURCE_ID}-${index + 1}-${slug || "layer"}`;
}

function populateAttributes(metadata) {
  const rows = (metadata?.vector_layers ?? []).flatMap((layer) =>
    Object.entries(layer.fields ?? {}).map(([field, type]) => ({
      field,
      type,
      sourceLayer: layer.id,
    })),
  );

  elements.attributeList.replaceChildren();
  elements.attributeSummary.textContent = `Attributes · ${new Intl.NumberFormat("th-TH").format(rows.length)}`;
  elements.attributeEmpty.hidden = rows.length > 0;

  for (const row of rows) {
    const tableRow = document.createElement("tr");
    for (const value of [row.field, row.type, row.sourceLayer]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      tableRow.append(cell);
    }
    elements.attributeList.append(tableRow);
  }

  console.table(rows);
}

function addVectorLayers(metadata) {
  const vectorLayers = Array.isArray(metadata?.vector_layers) ? metadata.vector_layers : [];
  if (!vectorLayers.length) {
    throw new Error("PMTiles เป็น vector tile แต่ metadata ไม่มี vector_layers จึงระบุ source-layer ไม่ได้");
  }

  const colors = {
    fill: cssToken("--map-color-layer-fill"),
    line: cssToken("--map-color-layer-line"),
    point: cssToken("--map-color-layer-point"),
    paper: cssToken("--map-color-paper"),
  };

  const attribution = typeof metadata.attribution === "string" ? metadata.attribution : undefined;
  map.addSource(SOURCE_ID, {
    type: "vector",
    url: `pmtiles://${dataUrl}`,
    attribution,
  });

  vectorLayers.forEach((layer, index) => {
    const sourceLayer = layer.id;
    const baseId = safeLayerId(sourceLayer, index);
    const fillId = `${baseId}-fill`;
    const lineId = `${baseId}-line`;
    const pointId = `${baseId}-point`;

    map.addLayer({
      id: fillId,
      type: "fill",
      source: SOURCE_ID,
      "source-layer": sourceLayer,
      filter: makeThematicFilter("Polygon"),
      paint: {
        "fill-color": colors.fill,
        "fill-opacity": 0.72,
        "fill-outline-color": colors.line,
      },
    });

    map.addLayer({
      id: lineId,
      type: "line",
      source: SOURCE_ID,
      "source-layer": sourceLayer,
      filter: makeThematicFilter("LineString"),
      paint: {
        "line-color": colors.line,
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.75, 12, 2],
        "line-opacity": 0.86,
      },
    });

    map.addLayer({
      id: pointId,
      type: "circle",
      source: SOURCE_ID,
      "source-layer": sourceLayer,
      filter: makeThematicFilter("Point"),
      paint: {
        "circle-color": colors.point,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 12, 5],
        "circle-stroke-color": colors.paper,
        "circle-stroke-width": 1,
        "circle-opacity": 0.9,
      },
    });

    overlayLayerIds.push(fillId, lineId, pointId);
    thematicLayerIds.fill.push(fillId);
    thematicLayerIds.line.push(lineId);
    thematicLayerIds.point.push(pointId);
  });

  currentVectorMetadata = metadata;
  elements.layerCount.textContent = new Intl.NumberFormat("th-TH").format(vectorLayers.length);
  renderLegend(metadata);
  updateThematicStyle();
  attachFeatureInspection();
}

function addRasterLayer(metadata) {
  const layerId = `${SOURCE_ID}-raster`;
  const attribution = typeof metadata?.attribution === "string" ? metadata.attribution : undefined;
  map.addSource(SOURCE_ID, {
    type: "raster",
    url: `pmtiles://${dataUrl}`,
    tileSize: 256,
    attribution,
  });
  map.addLayer({
    id: layerId,
    type: "raster",
    source: SOURCE_ID,
    paint: {
      "raster-opacity": 0.72,
      "raster-fade-duration": 0,
    },
  });
  overlayLayerIds.push(layerId);
  elements.layerCount.textContent = "1";
  elements.legendLabel.textContent = "Raster overlay ไม่รองรับการจำแนก attribute";
  elements.legendList.replaceChildren();
}

function attachFeatureInspection() {
  map.on("mousemove", (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: overlayLayerIds });
    map.getCanvas().style.cursor = features.length ? "pointer" : "";
  });

  map.on("click", (event) => {
    const [feature] = map.queryRenderedFeatures(event.point, { layers: overlayLayerIds });
    if (!feature) return;

    const popupContent = document.createElement("article");
    popupContent.className = "feature-popup";
    const title = document.createElement("h2");
    title.textContent = feature.sourceLayer || "Feature properties";
    popupContent.append(title);

    const list = document.createElement("dl");
    const entries = Object.entries(feature.properties || {}).slice(0, 8);
    for (const [key, value] of entries) {
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = key;
      description.textContent = String(value);
      list.append(term, description);
    }
    if (!entries.length) {
      const description = document.createElement("dd");
      description.textContent = "ไม่มี properties ใน feature นี้";
      list.append(description);
    }
    popupContent.append(list);

    new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "20rem" })
      .setLngLat(event.lngLat)
      .setDOMContent(popupContent)
      .addTo(map);
  });
}

function updateLayerVisibility() {
  const visibility = elements.layerToggle.checked ? "visible" : "none";
  overlayLayerIds.forEach((layerId) => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  });
}

function updateLayerOpacity() {
  const opacity = Number(elements.opacityRange.value) / 100;
  elements.opacityOutput.value = `${elements.opacityRange.value}%`;

  overlayLayerIds.forEach((layerId) => {
    const layer = map.getLayer(layerId);
    if (!layer) return;
    if (layer.type === "fill") map.setPaintProperty(layerId, "fill-opacity", opacity);
    if (layer.type === "line") map.setPaintProperty(layerId, "line-opacity", opacity);
    if (layer.type === "circle") map.setPaintProperty(layerId, "circle-opacity", opacity);
    if (layer.type === "raster") map.setPaintProperty(layerId, "raster-opacity", opacity);
  });
}

function fitToData() {
  if (!map || !dataBounds) return;
  const panelWidth = window.matchMedia("(min-width: 40rem)").matches ? 390 : 0;
  const padding = {
    top: 56,
    right: 56 + panelWidth,
    bottom: 72,
    left: 56,
  };
  const camera = map.cameraForBounds(dataBounds, {
    padding,
    maxZoom: 13,
  });
  if (!camera) return;

  map.easeTo({
    ...camera,
    zoom: Math.max(camera.zoom ?? dataMinZoom, dataMinZoom),
    padding,
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420,
  });
}

function resetOverlayState() {
  overlayLayerIds = [];
  thematicLayerIds = { fill: [], line: [], point: [] };
  currentVectorMetadata = {};
  dataBounds = undefined;
  dataMinZoom = 0;
  overlayKind = undefined;
  elements.fitButton.disabled = true;
  elements.layerToggle.disabled = true;
  elements.opacityRange.disabled = true;
  elements.styleMode.disabled = true;
  elements.formatBadge.textContent = "กำลังอ่าน";
  elements.zoomRange.textContent = "—";
  elements.layerCount.textContent = "—";
  elements.legendLabel.textContent = "กำลังตรวจชนิดข้อมูล…";
  elements.legendList.replaceChildren();
  elements.attributeSummary.textContent = "Attributes · กำลังอ่าน…";
  elements.attributeList.replaceChildren();
  elements.attributeEmpty.hidden = true;
}

let dataUrl = "";

async function initialize() {
  clearError();
  setStatus("loading", "กำลังอ่าน config…");
  elements.retryButton.dataset.state = "loading";
  elements.styleMode.disabled = true;

  try {
    const config = await loadConfig();
    legendRules = config.legend;
    harvestLegendRules = config.harvestLegend;
    enabledRuleIds = {
      start_date: new Set(legendRules.map((rule) => rule.id)),
      harv_low: new Set(harvestLegendRules.map((rule) => rule.id)),
    };
    elements.styleMode.value = activeStyleMode;
    setStatus("loading", "กำลังอ่าน PMTiles…");

    if (!protocol) {
      protocol = new Protocol({ metadata: true });
      maplibregl.addProtocol("pmtiles", protocol.tile);
    }

    const { archive, header, metadata, url: resolvedUrl } =
      await loadPmtilesWithFallback(config.defaultUrl);
    dataUrl = resolvedUrl;
    protocol.add(archive);

    resetOverlayState();
    elements.sourceName.textContent = new URL(dataUrl).pathname.split("/").at(-1);
    dataBounds = makeBounds(header);
    dataMinZoom = header.minZoom;
    elements.zoomRange.textContent = `${header.minZoom}–${header.maxZoom}`;
    populateAttributes(metadata);

    if (map) map.remove();
    map = makeMap();
    setStatus("loading", "กำลังโหลด Marginalia basemap…");
    await waitForMapStyle(map);

    if (header.tileType === 1) {
      overlayKind = "vector";
      elements.formatBadge.textContent = "MVT";
      addVectorLayers(metadata);
      elements.styleMode.disabled = false;
    } else if ([2, 3, 4, 5].includes(header.tileType)) {
      overlayKind = "raster";
      elements.formatBadge.textContent = ["", "", "PNG", "JPEG", "WEBP", "AVIF"][header.tileType];
      addRasterLayer(metadata);
    } else {
      throw new Error(`ยังไม่รองรับ PMTiles tileType ${header.tileType}`);
    }

    elements.layerToggle.disabled = false;
    elements.opacityRange.disabled = false;
    elements.fitButton.disabled = !dataBounds;
    updateLayerOpacity();
    if (dataBounds) fitToData();

    delete elements.retryButton.dataset.state;
    setStatus("ready", overlayKind === "vector" ? "Vector พร้อมใช้งาน" : "Raster พร้อมใช้งาน");
  } catch (error) {
    console.error(error);
    elements.styleMode.disabled = overlayKind !== "vector";

    if (error instanceof PMTilesNotFoundError) {
      setError("ไม่เจอข้อมูล", error.message);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const corsHint = /fetch|cors|range|network/i.test(message)
      ? " ตรวจสอบว่า PMTiles server อนุญาต CORS และ HTTP Range requests"
      : "";
    setError("เปิดชั้นข้อมูลไม่ได้", `${message}${corsHint}`);
  }
}

elements.fitButton.addEventListener("click", fitToData);
elements.retryButton.addEventListener("click", initialize);
elements.layerToggle.addEventListener("change", updateLayerVisibility);
elements.opacityRange.addEventListener("input", updateLayerOpacity);
elements.styleMode.addEventListener("change", () => {
  activeStyleMode = elements.styleMode.value;
  renderLegend(currentVectorMetadata);
  updateThematicStyle();
});

initialize();
