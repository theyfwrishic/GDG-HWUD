# Shuttle stop counter (phone camera, runs in the browser)

A static website. Open it on a phone, point the camera at the waiting area, and YOLOv8 counts the people inside it. Detection runs on the phone, so no video is uploaded and no server is needed.

## 1. Export the model (once, on a computer)
```bash
pip install ultralytics onnx
yolo export model=yolov8n.pt format=onnx imgsz=640 opset=12
```
Move the resulting `yolov8n.onnx` into the `models/` folder.
For slower phones export with `imgsz=416` instead and open the page with `?size=416` at the end of the address.

## 2. Host it (the camera needs https)
Upload this whole folder to any static host. Free options: Netlify (drag and drop the folder at app.netlify.com/drop), Cloudflare Pages, or GitHub Pages. They all give you an https address.

To try it before hosting: run `python -m http.server 8000` in this folder, then on the same computer open http://localhost:8000. A phone on the same Wi-Fi cannot use the camera over plain http, so for the phone use a tunnel such as `cloudflared tunnel --url http://localhost:8000` or `ngrok http 8000`, which gives you an https address.

## 3. Use it on the phone
1. Open the https address in Chrome or Safari and tap **Start camera**, then allow camera access.
2. Tap **Edit waiting area** and drag the four corners onto the place where people queue. The area is remembered on that phone.
3. Mount the phone high, angled down, with the screen on and the charger plugged in. The page asks the phone to stay awake.

## How it counts
- Only the person class is used. A person counts if their feet (bottom-centre of the box) are inside the waiting area.
- The big number is the median over the last 20 seconds (adjustable), so a flickering detection doesn't change it.
- Status is Calm, Busy (from 50% of a shuttle) or Send an extra shuttle (from 70%). Seats and percentages are in Settings.

## Saving and sharing counts
- Every 30 s a row is saved on the phone. **Download counts (CSV)** exports them for demand analysis.
- To see counts from another device, put an address in **Send counts to this address**. The page POSTs JSON like `{"stop": "...", "timestamp": "...", "raw_count": 12, "smoothed_count": 11, "status": "busy"}`. Your server must allow requests from the page (CORS).

## Notes
- Speed depends on the phone. Expect a few checks per second, shown under the raw count. That is plenty for a queue.
- Crowds that overlap heavily are undercounted. A high, angled camera helps most. You can use `yolov8s.onnx` for better accuracy if the phone copes (change `modelUrl` in `app.js`).
- Check your university's rules and put up a notice that a camera counts people at the stop.

View the entire Camera Module - https://gdg-hwud-2026.netlify.app
View the Uniloop - https://uniloop-gdg-2026.netlify.app

