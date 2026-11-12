# Eco PMTiles Viewer

เว็บแผนที่สำหรับแสดง PMTiles บน MapLibre GL JS พร้อมตัวกรองข้อมูลสองรูปแบบ

- ช่วงเริ่มปลูกจาก `start_date`
- เดือนสิ้นสุดเก็บเกี่ยวจาก `harv_low`
- เปิด–ปิดกลุ่มย่อยจาก Legend ได้
- ใช้ PMTiles เพียงแหล่งเดียวจาก `pmtile_rice` ใน `config.ini`
- ทดลองไฟล์ `_30m.pmtiles` เมื่อ `_40m.pmtiles` ตอบ HTTP 404

## เอกสาร

- [คู่มือการกำหนดค่าและใช้งาน PMTiles Filter](docs/PMTILES_FILTER_GUIDE.md)
- [MapLibre expressions สำหรับนำไปใช้ร่วมกัน](maplibre-expressions.json)

## เปิดใช้งานในเครื่อง

```bash
python3 -m http.server 8000
```

จากนั้นเปิด <http://localhost:8000/>

## Data source requirements

PMTiles server ต้องรองรับ CORS และ HTTP Range requests โดย URL ต้องกำหนดใน `config.ini`
