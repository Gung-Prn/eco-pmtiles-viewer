# คู่มือการกำหนดค่าและใช้งาน PMTiles Filter

เอกสารฉบับนี้อธิบายวิธีกำหนดค่าและใช้งานตัวกรองข้อมูล PMTiles ของโครงการ Eco PMTiles Viewer โดยอ้างอิงการทำงานจริงจาก [`app.js`](../app.js), [`config.ini`](../config.ini) และ [`maplibre-expressions.json`](../maplibre-expressions.json)

> **Source policy:** ระบบใช้ PMTiles เพียงแหล่งเดียวจากคีย์ `pmtile_rice` ไม่สร้างรายการ source จากหลายช่วงวันที่และไม่ใช้ `path_raw` การจำแนกช่วงวันทั้งหมดเกิดจาก attributes ภายใน PMTiles ไฟล์เดียว

เอกสารปรับปรุงล่าสุด: 12 พฤศจิกายน 2569

## สารบัญ

1. [ภาพรวมการทำงาน](#1-ภาพรวมการทำงาน)
2. [ข้อกำหนดของข้อมูล PMTiles](#2-ข้อกำหนดของข้อมูล-pmtiles)
3. [การกำหนดค่า config.ini](#3-การกำหนดค่า-configini)
4. [Filter แบบ start_date](#4-filter-แบบ-start_date)
5. [Filter แบบ harv_low](#5-filter-แบบ-harv_low)
6. [การเปิด–ปิดชั้นย่อยใน Legend](#6-การเปิดปิดชั้นย่อยใน-legend)
7. [การกำหนด Layer และ Zoom](#7-การกำหนด-layer-และ-zoom)
8. [HTML template สำหรับใช้งาน Filter](#8-html-template-สำหรับใช้งาน-filter)
9. [การเพิ่ม Filter mode ใหม่](#9-การเพิ่ม-filter-mode-ใหม่)
10. [การตรวจสอบและแก้ปัญหา](#10-การตรวจสอบและแก้ปัญหา)

## 1. ภาพรวมการทำงาน

ระบบใช้ PMTiles เป็นแหล่งข้อมูลแบบ vector tile และใช้ MapLibre GL JS แสดงผลบนแผนที่ การไหลของข้อมูลมีลำดับดังนี้

```text
config.ini
   │
   ├─ pmtile_rice ─────────────── URL ของ PMTiles เพียงแหล่งเดียว
   ├─ legend ──────────────────── กฎสีสำหรับ start_date
   └─ harvest_legend ──────────── กฎสีรายเดือนสำหรับ harv_low
                │
                ▼
        ตรวจสอบและ normalize ค่า
                │
                ▼
       สร้าง MapLibre expressions
                │
        ┌───────┴────────┐
        ▼                ▼
   paint expression   layer filter
   กำหนดสี feature   เลือก feature ที่แสดง
```

ระบบปัจจุบันมี Filter mode สองแบบ

| Mode | Property ใน PMTiles | ความหมาย | วิธีจำแนก |
|---|---|---|---|
| `start_date` | `start_date` | วันที่เริ่มปลูก | เปรียบเทียบกับช่วงวันเริ่มต้น–สิ้นสุด |
| `harv_low` | `harv_low` | วันที่สิ้นสุดเก็บเกี่ยวค่าต่ำ | ดึงเลขเดือนแล้วจำแนกเป็น 12 เดือน |

การเลือก Filter mode มีผลสองส่วนพร้อมกัน

- เปลี่ยนสีของ feature ด้วย paint expression
- กรอง feature ด้วย layer filter ตามรายการ Legend ที่เปิดอยู่

## 2. ข้อกำหนดของข้อมูล PMTiles

### 2.1 ประเภทข้อมูล

Filter attribute ใช้ได้เฉพาะ PMTiles ที่บรรจุ Mapbox Vector Tile หรือ MVT เท่านั้น Raster PMTiles เช่น PNG, JPEG, WEBP หรือ AVIF สามารถปรับความทึบและเปิด–ปิดชั้นข้อมูลได้ แต่ไม่สามารถกรองตาม attribute ของ feature ได้

### 2.2 Data contract

| รายการ | ข้อกำหนด |
|---|---|
| Tile type | Vector tile หรือ MVT |
| Tile coordinate system | Web Mercator tile matrix หรือ EPSG:3857 |
| Source layer | ต้องมี `vector_layers[].id` ใน PMTiles metadata |
| Geometry | `Polygon`, `LineString` หรือ `Point` |
| `start_date` | String รูปแบบ `YYYY-MM-DD` หรือ ISO-8601 ที่ 10 ตัวแรกเป็นวันที่ |
| `harv_low` | String รูปแบบ `YYYY-MM-DD` หรือ ISO-8601 ที่ตำแหน่ง 5–7 เป็นเลขเดือน `01`–`12` |
| สี | String แบบ `#RRGGBB` |

ตัวอย่าง properties ที่รองรับ

```json
{
  "start_date": "2026-09-18",
  "harv_low": "2026-12-03",
  "data_date": "2026-10-31"
}
```

ข้อควรระวังเกี่ยวกับวันที่

- วันที่ต้องเติมเลขศูนย์ให้ครบ เช่น `2026-07-01` ไม่ใช่ `2026-7-1`
- การเปรียบเทียบ `start_date` เป็นการเปรียบเทียบ string จึงถูกต้องเมื่อใช้รูปแบบ `YYYY-MM-DD`
- ระบบใช้ 10 ตัวแรกของ `start_date` และไม่ได้แปลง timezone
- ระบบใช้ตัวอักษรตำแหน่ง 5–7 ของ `harv_low` เป็นเลขเดือน
- ค่า `null`, ค่าว่าง หรือรูปแบบอื่นจะไม่ตรงกับกฎใด และจะถูกกรองออกเมื่อเปิดใช้ thematic filter
- Metadata ควรประกาศ field ทั้งสองเพื่อให้ UI รายงานสถานะได้ถูกต้อง แม้ expression จะประเมิน properties จากแต่ละ feature โดยตรงก็ตาม

## 3. การกำหนดค่า config.ini

### 3.1 URL เริ่มต้น

```ini
pmtile_rice = https://example.org/tiles/20261031_rice_40m.pmtiles
```

ข้อกำหนดของ URL

- ต้องเป็น `http://` หรือ `https://`
- Server ต้องรองรับ CORS
- Server ต้องรองรับ HTTP Range requests เพื่อให้ PMTiles อ่านเฉพาะ byte range ที่ต้องใช้
- ไม่ควรใส่ credential หรือ signed URL ที่มีข้อมูลลับในไฟล์ซึ่งต้องแชร์

### 3.2 การใช้ PMTiles เพียงแหล่งเดียว

ระบบอ่าน PMTiles จากค่า `pmtile_rice` เท่านั้น ไม่มี source selector และไม่อ่าน `path_raw` อีกต่อไป หากต้องการเปลี่ยนชุดข้อมูลให้แก้ URL นี้แล้ว reload หน้าเว็บ

```ini
pmtile_rice = https://example.org/tiles/20261031_rice_40m.pmtiles
```

การจำแนกหลายช่วงวันที่ยังทำได้จาก properties ภายใน PMTiles ไฟล์เดียว โดยใช้ `legend` กับ `start_date` ไม่จำเป็นต้องแยก PMTiles หนึ่งไฟล์ต่อหนึ่งช่วงวันที่

### 3.3 Fallback จาก 40m ไป 30m

เมื่อ URL ลงท้ายด้วย `_40m.pmtiles` และ Server ตอบ HTTP 404 ระบบจะทดลอง URL ที่เปลี่ยนเป็น `_30m.pmtiles` โดยอัตโนมัติ

```text
20261015_rice_40m.pmtiles
          │ HTTP 404
          ▼
20261015_rice_30m.pmtiles
```

หากไม่พบทั้งสอง URL ระบบจะแสดงข้อความ “ไม่เจอข้อมูล” และไม่เพิ่มชั้นข้อมูลที่เสียลงบนแผนที่

Fallback จะทำงานเฉพาะกรณี 404 เท่านั้น ข้อผิดพลาด CORS, HTTP 500, timeout หรือ PMTiles เสียจะถูกรายงานเป็นข้อผิดพลาดโดยตรง

## 4. Filter แบบ start_date

### 4.1 การกำหนด Legend

แต่ละรายการต้องมี `label_date` จำนวนสองค่า ได้แก่วันเริ่มต้นและวันสิ้นสุด สีจะถูกใช้เมื่อ `start_date` อยู่ในช่วงดังกล่าวแบบรวมวันต้นและวันปลาย

```ini
legend = [
  {
    "name": "rice",
    "label_date": ["2026-10-16", "2026-10-31"],
    "label": "16-31 ตุลาคม 2569",
    "colour": "#006100"
  },
  {
    "name": "rice",
    "label_date": ["2026-10-01", "2026-10-15"],
    "label": "01-15 ตุลาคม 2569",
    "colour": "#498A00"
  }
]
```

| Key | Required | คำอธิบาย |
|---|---:|---|
| `name` | ไม่บังคับ | ชื่อกลุ่มข้อมูล เช่น `rice` |
| `label_date` | บังคับ | Array `[วันเริ่ม, วันสิ้นสุด]` รูปแบบ `YYYY-MM-DD` |
| `label` | ไม่บังคับ | ข้อความที่แสดงใน Legend |
| `colour` | บังคับ | สี sRGB แบบ `#RRGGBB` |

### 4.2 Expression สำหรับอ่านวันที่

```json
[
  "slice",
  ["to-string", ["get", "start_date"]],
  0,
  10
]
```

Expression นี้ทำงานตามลำดับดังนี้

1. อ่าน property `start_date`
2. แปลงค่าเป็น string
3. เลือกเฉพาะตัวอักษรตำแหน่ง 0–10 หรือ `YYYY-MM-DD`

### 4.3 Condition สำหรับหนึ่งช่วงวันที่

```json
[
  "all",
  [
    ">=",
    ["slice", ["to-string", ["get", "start_date"]], 0, 10],
    "2026-10-16"
  ],
  [
    "<=",
    ["slice", ["to-string", ["get", "start_date"]], 0, 10],
    "2026-10-31"
  ]
]
```

### 4.4 Color expression

ระบบรวมทุกช่วงเป็น `case` expression โดยตรวจจากบนลงล่าง ช่วงวันที่จึงไม่ควรซ้อนทับกัน เพราะ feature ที่ตรงหลายช่วงจะใช้สีของช่วงแรก

```json
[
  "case",
  [
    "all",
    [">=", ["slice", ["to-string", ["get", "start_date"]], 0, 10], "2026-10-16"],
    ["<=", ["slice", ["to-string", ["get", "start_date"]], 0, 10], "2026-10-31"]
  ],
  "#006100",
  [
    "all",
    [">=", ["slice", ["to-string", ["get", "start_date"]], 0, 10], "2026-10-01"],
    ["<=", ["slice", ["to-string", ["get", "start_date"]], 0, 10], "2026-10-15"]
  ],
  "#498A00",
  "#2369DC"
]
```

`#2369DC` คือ fallback color เมื่อ feature ไม่ตรงกับกฎใด แต่ในระบบปัจจุบัน filter จะซ่อน feature ที่ไม่ตรงกับ Legend ที่เปิดอยู่ จึงมักไม่เห็น fallback color บนแผนที่

## 5. Filter แบบ harv_low

### 5.1 การกำหนด Harvest Legend

```ini
harvest_legend = [
  { "month": "01", "label": "มกราคม", "colour": "#006D44" },
  { "month": "02", "label": "กุมภาพันธ์", "colour": "#3DA269" },
  { "month": "03", "label": "มีนาคม", "colour": "#85B320" },
  { "month": "04", "label": "เมษายน", "colour": "#B6CD00" },
  { "month": "05", "label": "พฤษภาคม", "colour": "#44C8EC" },
  { "month": "06", "label": "มิถุนายน", "colour": "#0B4DA4" },
  { "month": "07", "label": "กรกฎาคม", "colour": "#4A4FC9" },
  { "month": "08", "label": "สิงหาคม", "colour": "#A647BC" },
  { "month": "09", "label": "กันยายน", "colour": "#E02B93" },
  { "month": "10", "label": "ตุลาคม", "colour": "#FA6700" },
  { "month": "11", "label": "พฤศจิกายน", "colour": "#FF8D00" },
  { "month": "12", "label": "ธันวาคม", "colour": "#FBC100" }
]
```

| Key | Required | คำอธิบาย |
|---|---:|---|
| `month` | บังคับ | เลขเดือน `01`–`12`; ห้ามซ้ำกัน |
| `label` | ไม่บังคับ | ชื่อเดือนหรือข้อความที่แสดงใน Legend |
| `colour` | บังคับ | สี sRGB แบบ `#RRGGBB` |

### 5.2 Expression สำหรับอ่านเดือน

```json
[
  "slice",
  ["to-string", ["get", "harv_low"]],
  5,
  7
]
```

ตัวอย่างผลลัพธ์

```text
harv_low = "2026-12-03"
                         └─ slice(5, 7) = "12"
```

### 5.3 Condition และสีรายเดือน

```json
[
  "case",
  ["==", ["slice", ["to-string", ["get", "harv_low"]], 5, 7], "01"],
  "#006D44",
  ["==", ["slice", ["to-string", ["get", "harv_low"]], 5, 7], "02"],
  "#3DA269",
  "#2369DC"
]
```

ไฟล์ [`maplibre-expressions.json`](../maplibre-expressions.json) มี expression ฉบับเต็มครบ 12 เดือน พร้อม filter สำหรับ Polygon, LineString และ Point

## 6. การเปิด–ปิดชั้นย่อยใน Legend

ระบบเก็บรายการที่เปิดอยู่แยกตาม mode

```js
const enabledRuleIds = {
  start_date: new Set(),
  harv_low: new Set(),
};
```

เมื่อผู้ใช้เปิดหรือปิด checkbox ระบบจะสร้าง filter ใหม่จากกฎที่เปิดอยู่เท่านั้น

```json
[
  "all",
  ["==", ["geometry-type"], "Polygon"],
  [
    "any",
    ["เงื่อนไขช่วงที่ 1"],
    ["เงื่อนไขช่วงที่ 2"]
  ]
]
```

ความหมายของ operators

| Operator | หน้าที่ |
|---|---|
| `all` | ทุกเงื่อนไขภายในต้องเป็นจริง |
| `any` | อย่างน้อยหนึ่งเงื่อนไขภายในต้องเป็นจริง |
| `==` | ค่าเท่ากัน |
| `>=` / `<=` | เปรียบเทียบขอบเขตช่วงวันที่แบบรวมขอบ |
| `geometry-type` | ตรวจชนิด geometry ของ feature |

กรณีพิเศษ

- เปิดทุก checkbox: แสดงทุก feature ที่ตรงกับ Legend
- ปิดบาง checkbox: ซ่อนเฉพาะกลุ่มที่ปิด
- ปิดทุก checkbox: filter ลงท้ายด้วย `false` และไม่แสดง feature ใด
- สลับ mode: ระบบจำสถานะ checkbox ของแต่ละ mode แยกกัน
- ปิดชั้น PMTiles หลัก: เปลี่ยน `layout.visibility` เป็น `none` โดยไม่เปลี่ยน checkbox ย่อย

## 7. การกำหนด Layer และ Zoom

### 7.1 Layer สำหรับแต่ละ geometry

ระบบสร้าง layer สูงสุดสามชนิดต่อหนึ่ง source layer

| Geometry | MapLibre layer type | Paint property ที่รับ expression |
|---|---|---|
| Polygon | `fill` | `fill-color` |
| LineString | `line` | `line-color` |
| Point | `circle` | `circle-color` |

ตัวอย่าง Polygon layer

```js
map.addLayer({
  id: "rice-fill",
  type: "fill",
  source: "eco-pmtiles",
  "source-layer": "ชื่อ-layer-จาก-pmtiles-metadata",
  filter: makeThematicFilter("Polygon"),
  paint: {
    "fill-color": makeThematicColorExpression("#2369DC"),
    "fill-opacity": 0.72,
    "fill-outline-color": "#12439D",
  },
});
```

### 7.2 Zoom expressions

```json
{
  "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.75, 12, 2],
  "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 12, 5]
}
```

ความหมาย

- ที่ zoom 4 เส้นกว้าง `0.75` pixel และจุดมีรัศมี `2` pixel
- ที่ zoom 12 เส้นกว้าง `2` pixels และจุดมีรัศมี `5` pixels
- ค่าระหว่าง zoom 4–12 ถูกคำนวณแบบ linear interpolation

### 7.3 ความต่างระหว่าง Filter กับ minzoom/maxzoom

`filter` ใช้เลือก feature จาก geometry หรือ properties ส่วน `minzoom` และ `maxzoom` ใช้กำหนดช่วง zoom ที่ layer ทั้งชั้นปรากฏ ทั้งสองอย่างเป็นคนละหน้าที่และสามารถใช้ร่วมกันได้

```js
map.addLayer({
  id: "rice-fill",
  type: "fill",
  source: "eco-pmtiles",
  "source-layer": "rice",
  minzoom: 4,
  maxzoom: 15,
  filter: makeThematicFilter("Polygon"),
  paint: {
    "fill-color": makeThematicColorExpression("#2369DC"),
  },
});
```

`maxzoom` ของ MapLibre layer เป็นขอบบนแบบไม่รวมค่า เช่น `maxzoom: 15` หมายถึง layer แสดงก่อนถึง zoom 15 หากไม่กำหนด `minzoom` หรือ `maxzoom` MapLibre จะใช้ค่ามาตรฐานของ Style layer แต่ข้อมูลจริงยังถูกจำกัดด้วยช่วง zoom ที่มี tile อยู่ใน PMTiles header

## 8. HTML template สำหรับใช้งาน Filter

Template ต่อไปนี้แสดงองค์ประกอบขั้นต่ำสำหรับเลือก mode, เปิด–ปิดชั้นย่อย และนำ expression จาก [`maplibre-expressions.json`](../maplibre-expressions.json) ไปใช้กับ MapLibre

ก่อนใช้งานให้แก้สองค่าใน JavaScript

- `PMTILES_URL`: URL ของไฟล์ PMTiles
- `SOURCE_LAYER`: ค่า `id` ของ vector layer จาก PMTiles metadata

```html
<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PMTiles Filter Template</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/maplibre-gl@6.18.0/dist/maplibre-gl.css"
    />
    <style>
      html,
      body,
      #map {
        width: 100%;
        height: 100%;
        margin: 0;
      }

      .filter-panel {
        position: absolute;
        z-index: 2;
        top: 1rem;
        right: 1rem;
        width: min(22rem, calc(100% - 2rem));
        max-height: calc(100% - 2rem);
        overflow: auto;
        padding: 1rem;
        border-radius: 1rem;
        background: rgb(255 255 255 / 90%);
        box-shadow: 0 0.75rem 2rem rgb(15 23 42 / 18%);
        font-family: sans-serif;
      }

      .filter-panel select,
      .legend-item {
        min-height: 2.75rem;
      }

      .filter-panel select {
        width: 100%;
      }

      .legend-list {
        display: grid;
        gap: 0.25rem;
        margin: 1rem 0 0;
        padding: 0;
        list-style: none;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .legend-swatch {
        width: 1.5rem;
        height: 0.75rem;
        border-radius: 999px;
      }
    </style>
  </head>
  <body>
    <div id="map" aria-label="แผนที่ PMTiles"></div>

    <aside class="filter-panel" aria-labelledby="filter-title">
      <h1 id="filter-title">ตัวกรอง PMTiles</h1>

      <label for="style-mode">รูปแบบการแสดงผล</label>
      <select id="style-mode">
        <option value="start_date">ช่วงเริ่มปลูก · start_date</option>
        <option value="harv_low">เดือนสิ้นสุดเก็บเกี่ยว · harv_low</option>
      </select>

      <ul class="legend-list" id="legend-list" aria-label="ชั้นข้อมูลย่อย"></ul>
    </aside>

    <script type="module">
      import * as maplibregl from "https://unpkg.com/maplibre-gl@6.18.0/dist/maplibre-gl.mjs";
      import { PMTiles, Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm";

      const PMTILES_URL = "https://example.org/tiles/rice.pmtiles";
      const SOURCE_LAYER = "rice";
      const SOURCE_ID = "rice-pmtiles";
      const LAYER_IDS = {
        Polygon: "rice-fill",
        LineString: "rice-line",
        Point: "rice-point",
      };

      const expressionConfig = await fetch("./maplibre-expressions.json")
        .then((response) => {
          if (!response.ok) throw new Error(`อ่าน expression ไม่ได้: HTTP ${response.status}`);
          return response.json();
        });

      const protocol = new Protocol({ metadata: true });
      maplibregl.addProtocol("pmtiles", protocol.tile);
      protocol.add(new PMTiles(PMTILES_URL));

      const map = new maplibregl.Map({
        container: "map",
        style: "https://carto.elemnt.earth/2026-06-23_marginalia/style.json",
        center: [100.55, 13.2],
        zoom: 5,
      });

      const modeSelect = document.querySelector("#style-mode");
      const legendList = document.querySelector("#legend-list");
      const enabledIds = {
        start_date: new Set(),
        harv_low: new Set(),
      };

      function ruleId(modeName, rule) {
        return modeName === "start_date"
          ? `${rule.label_date[0]}:${rule.label_date[1]}`
          : `month-${rule.month}`;
      }

      function conditionFor(modeName, rule) {
        const mode = expressionConfig.modes[modeName];
        if (modeName === "harv_low") {
          return ["==", mode.value_expression, rule.month];
        }
        return [
          "all",
          [">=", mode.value_expression, rule.label_date[0]],
          ["<=", mode.value_expression, rule.label_date[1]],
        ];
      }

      function makeFilter(modeName, geometryType) {
        const mode = expressionConfig.modes[modeName];
        const enabled = enabledIds[modeName];
        const conditions = mode.legend
          .filter((rule) => enabled.has(ruleId(modeName, rule)))
          .map((rule) => conditionFor(modeName, rule));

        return [
          "all",
          ["==", ["geometry-type"], geometryType],
          conditions.length ? ["any", ...conditions] : false,
        ];
      }

      function applyMode(modeName) {
        const mode = expressionConfig.modes[modeName];
        const colorProperties = {
          Polygon: "fill-color",
          LineString: "line-color",
          Point: "circle-color",
        };

        for (const [geometryType, layerId] of Object.entries(LAYER_IDS)) {
          if (!map.getLayer(layerId)) continue;
          map.setPaintProperty(layerId, colorProperties[geometryType], mode.color_expression);
          map.setFilter(layerId, makeFilter(modeName, geometryType));
        }
      }

      function renderLegend(modeName) {
        const mode = expressionConfig.modes[modeName];
        const enabled = enabledIds[modeName];
        legendList.replaceChildren();

        for (const rule of mode.legend) {
          const id = ruleId(modeName, rule);
          const item = document.createElement("li");
          const label = document.createElement("label");
          label.className = "legend-item";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = enabled.has(id);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) enabled.add(id);
            else enabled.delete(id);
            applyMode(modeName);
          });

          const swatch = document.createElement("span");
          swatch.className = "legend-swatch";
          swatch.style.backgroundColor = rule.colour;
          swatch.setAttribute("aria-hidden", "true");

          const text = document.createElement("span");
          text.textContent = rule.label;
          label.append(checkbox, swatch, text);
          item.append(label);
          legendList.append(item);
        }
      }

      map.on("load", () => {
        map.addSource(SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${PMTILES_URL}`,
        });

        map.addLayer({
          id: LAYER_IDS.Polygon,
          type: "fill",
          source: SOURCE_ID,
          "source-layer": SOURCE_LAYER,
          paint: {
            "fill-color": "#2369DC",
            "fill-opacity": 0.72,
          },
        });

        map.addLayer({
          id: LAYER_IDS.LineString,
          type: "line",
          source: SOURCE_ID,
          "source-layer": SOURCE_LAYER,
          paint: {
            "line-color": "#12439D",
            "line-width": expressionConfig.zoom_expressions.line_width,
          },
        });

        map.addLayer({
          id: LAYER_IDS.Point,
          type: "circle",
          source: SOURCE_ID,
          "source-layer": SOURCE_LAYER,
          paint: {
            "circle-color": "#DA761C",
            "circle-radius": expressionConfig.zoom_expressions.circle_radius,
          },
        });

        for (const [modeName, mode] of Object.entries(expressionConfig.modes)) {
          enabledIds[modeName] = new Set(
            mode.legend.map((rule) => ruleId(modeName, rule)),
          );
        }

        renderLegend(modeSelect.value);
        applyMode(modeSelect.value);
      });

      modeSelect.addEventListener("change", () => {
        renderLegend(modeSelect.value);
        applyMode(modeSelect.value);
      });
    </script>
  </body>
</html>
```

โครงสร้างไฟล์แนะนำเมื่อนำ template ไปใช้งาน

```text
pmtiles-filter-demo/
├── index.html
└── maplibre-expressions.json
```

ให้เปิดผ่าน HTTP server เนื่องจาก browser อาจไม่อนุญาต `fetch()` ไฟล์ JSON เมื่อเปิดด้วย `file://`

```bash
python3 -m http.server 8000
```

จากนั้นเปิด `http://localhost:8000/`

## 9. การเพิ่ม Filter mode ใหม่

สมมติต้องการเพิ่ม Filter จาก property `data_date`

### ขั้นที่ 1: กำหนด semantics ของ field

ต้องระบุให้ชัดเจนก่อนว่า `data_date` หมายถึงวันที่ข้อมูลถูกสร้าง วันที่ภาพดาวเทียม หรือวันที่สำรวจ และใช้ timezone ใด หลีกเลี่ยงการใช้ชื่อ field อย่างเดียวโดยไม่ทราบความหมาย

ตัวอย่าง contract

```text
field: data_date
type: string
format: YYYY-MM-DD
timezone: ไม่มีการแปลง timezone
comparison: inclusive date range
missing value: ไม่แสดงใน thematic layer
```

### ขั้นที่ 2: เพิ่ม mode

```js
const STYLE_MODES = {
  start_date: { field: "start_date", label: "ช่วงเริ่มปลูก" },
  harv_low: { field: "harv_low", label: "เดือนสิ้นสุดเก็บเกี่ยว" },
  data_date: { field: "data_date", label: "วันที่ข้อมูล" },
};
```

### ขั้นที่ 3: เพิ่ม configuration และ validation

ควรสร้าง key ใหม่ใน `config.ini` เช่น `data_date_legend` และเพิ่ม normalization function ที่ตรวจ

- รูปแบบวันที่
- วันเริ่มต้นไม่มากกว่าวันสิ้นสุด
- สีเป็น `#RRGGBB`
- ID ของแต่ละช่วงไม่ซ้ำกัน
- ช่วงไม่ซ้อนทับกัน หรือประกาศลำดับความสำคัญให้ชัดเจน

### ขั้นที่ 4: เพิ่ม condition

```js
const dataDateValue = ["slice", ["to-string", ["get", "data_date"]], 0, 10];

const condition = [
  "all",
  [">=", dataDateValue, rule.labelDate[0]],
  ["<=", dataDateValue, rule.labelDate[1]],
];
```

### ขั้นที่ 5: เพิ่มตัวเลือกใน HTML

```html
<option value="data_date">วันที่ข้อมูล · data_date</option>
```

### ขั้นที่ 6: เพิ่มชุดสถานะ checkbox

```js
enabledRuleIds.data_date = new Set(dataDateRules.map((rule) => rule.id));
```

## 10. การตรวจสอบและแก้ปัญหา

### 10.1 Checklist ก่อนใช้งาน

- [ ] PMTiles เปิดอ่าน header และ metadata ได้
- [ ] Tile type เป็น MVT สำหรับ attribute filter
- [ ] Metadata มี `vector_layers` และ `source-layer` ถูกต้อง
- [ ] Feature มี `start_date` และ/หรือ `harv_low`
- [ ] วันที่เป็น `YYYY-MM-DD` หรือ ISO-8601 ที่ตำแหน่งตรงตาม contract
- [ ] สีทั้งหมดเป็น `#RRGGBB`
- [ ] ช่วง `start_date` ไม่ซ้อนกัน
- [ ] `harvest_legend` ไม่มีเดือนซ้ำ
- [ ] Server รองรับ CORS และ HTTP Range requests
- [ ] ทดสอบ Polygon, LineString และ Point ตามชนิด geometry ที่มีจริง
- [ ] ทดสอบเปิดทุก checkbox, ปิดบางรายการ และปิดทั้งหมด
- [ ] ทดสอบสลับ mode แล้วสถานะ checkbox ของแต่ละ mode ยังถูกต้อง
- [ ] ทดสอบช่วง zoom ต่ำสุดและสูงสุดของ PMTiles
- [ ] ทดสอบ HTTP 404 ทั้งไฟล์ 40m และ 30m

### 10.2 ชั้นข้อมูลไม่แสดง

ตรวจตามลำดับนี้

1. เปิด browser console และดู HTTP status ของ PMTiles
2. ตรวจ CORS และ `Accept-Ranges` หรือการตอบ `206 Partial Content`
3. ตรวจว่า `source-layer` ตรงกับ `vector_layers[].id`
4. ตรวจว่า geometry ตรงกับ layer type
5. ตรวจว่ามี checkbox อย่างน้อยหนึ่งรายการเปิดอยู่
6. ตรวจรูปแบบของ `start_date` หรือ `harv_low`
7. ตรวจช่วง zoom ใน PMTiles header และค่าของ layer `minzoom`/`maxzoom`

### 10.3 มีสี แต่ไม่ตรงช่วง

สาเหตุที่พบบ่อย

- ช่วงวันที่ซ้อนกันและกฎแรกใน `case` ชนะ
- วันที่ไม่ได้เติมเลขศูนย์
- `harv_low` ไม่ได้อยู่ในรูปแบบ `YYYY-MM-DD`
- Property เป็น Unix timestamp หรือ number แทน string วันที่
- วันที่มี timezone แต่ต้องการเปรียบเทียบหลังแปลงเป็นเวลาท้องถิ่น ซึ่งระบบปัจจุบันยังไม่ได้ทำ

### 10.4 สี OKLCH ใช้กับ MapLibre ไม่ได้

MapLibre paint properties ควรใช้สีที่ Style expression รองรับ เช่น `#RRGGBB` หรือ `rgb(...)` อย่าส่งค่า CSS เช่น `oklch(...)` เข้า `fill-color`, `line-color` หรือ `circle-color` โดยตรง

```js
// ถูกต้อง
"fill-color": "#006100"

// ไม่ควรใช้กับ MapLibre expression ของโครงการนี้
"fill-color": "oklch(56% 0.2 256)"
```

### 10.5 Acceptance criteria

ถือว่า Filter พร้อมใช้งานเมื่อ

1. ระบบโหลด PMTiles เฉพาะ URL ที่กำหนดใน `pmtile_rice`
2. ระบบ fallback จาก 40m ไป 30m เฉพาะกรณี 404 ได้
3. `start_date` แสดงสีครบทุกช่วงและขอบวันแรก/วันสุดท้ายถูกต้อง
4. `harv_low` แสดงสีตรงกับเดือน `01`–`12`
5. ปิด Legend รายการใดแล้ว feature ของรายการนั้นหายจากทุก geometry layer
6. ปิด Legend ทั้งหมดแล้วไม่มี thematic feature แสดง
7. สลับ mode แล้วสี, filter และสถานะ checkbox เปลี่ยนพร้อมกัน
8. Raster PMTiles ไม่แสดงตัวเลือก attribute filter ที่ทำให้ผู้ใช้เข้าใจผิด
9. Error message แยกระหว่างไม่พบข้อมูล, CORS/network และ metadata ไม่ครบ

## ไฟล์ที่เกี่ยวข้อง

- [`app.js`](../app.js) — การอ่าน config, สร้าง expression และควบคุม UI
- [`config.ini`](../config.ini) — URL `pmtile_rice`, `legend` และ `harvest_legend`
- [`maplibre-expressions.json`](../maplibre-expressions.json) — expression ที่ export สำหรับแชร์
- [`index.html`](../index.html) — UI ของ Filter mode และ Legend
