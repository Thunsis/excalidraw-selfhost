#!/usr/bin/env python3
"""Agent canvas builder — programmatically create Excalidraw canvases in the cloud account.

Usage:
  ./scripts/canvas.py new "<name>" <elements.json> [--username xuan]
  ./scripts/canvas.py list [--username xuan]
  ./scripts/canvas.py demo [--username xuan]   # create a demo flowchart canvas

Requires: local ws-server running (default http://127.0.0.1:3020, override WS_API).
Username defaults to $EXCALIDRAW_WS_USER or "xuan" (username IS the credential,
no password — keep this tool on trusted machines only).

Elements JSON: an array of Excalidraw elements (see builder helpers below for
the minimal field set that restoreElements accepts).
"""

import json
import os
import random
import sys
import time
import urllib.request
import urllib.error

API = os.environ.get("WS_API", "http://127.0.0.1:3020")
USERNAME = os.environ.get("EXCALIDRAW_WS_USER", "xuan")


# ── builder helpers: minimal field set accepted by restoreElements ──────────

def el_id():
    return "".join(random.choices(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", k=20))


def base_el(etype, x, y, **extra):
    el = {
        "id": el_id(), "type": etype, "x": x, "y": y,
        "width": 0, "height": 0, "angle": 0,
        "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
        "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None,
        "index": "a0", "seed": random.randint(0, 2**31),
        "version": 1, "versionNonce": random.randint(0, 2**31),
        "isDeleted": False, "boundElements": [],
        "updated": int(time.time() * 1000), "link": None, "locked": False,
    }
    el.update(extra)
    return el


def text(x, y, s, size=20, color="#1e1e1e", **extra):
    return base_el("text", x, y, width=len(s) * size * 0.6, height=size * 1.25,
                   strokeColor=color, fontSize=size, fontFamily=1, text=s,
                   textAlign="left", verticalAlign="top", containerId=None,
                   originalText=s, lineHeight=1.25, autoResize=True, **extra)


def rect(x, y, w, h, fill="transparent", stroke="#1e1e1e", radius=True, **extra):
    el = base_el("rectangle", x, y, width=w, height=h, strokeColor=stroke,
                 backgroundColor=fill, **extra)
    if radius:
        el["roundness"] = {"type": 3}
    return el


def diamond(x, y, w, h, fill="transparent", stroke="#1e1e1e", **extra):
    return base_el("diamond", x, y, width=w, height=h, strokeColor=stroke,
                   backgroundColor=fill, **extra)


def ellipse(x, y, w, h, fill="transparent", stroke="#1e1e1e", **extra):
    return base_el("ellipse", x, y, width=w, height=h, strokeColor=stroke,
                   backgroundColor=fill, **extra)


def arrow(x1, y1, x2, y2, **extra):
    return base_el("arrow", x1, y1, width=x2 - x1, height=y2 - y1,
                   points=[[0, 0], [x2 - x1, y2 - y1]],
                   startBinding=None, endBinding=None,
                   startArrowhead=None, endArrowhead="arrow",
                   roundness={"type": 2}, elbowed=False, **extra)


# ── API ─────────────────────────────────────────────────────────────────────

def api(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()[:200]}")


def login():
    return api("/api/auth/login", "POST", {"username": USERNAME})["token"]


# ── commands ────────────────────────────────────────────────────────────────

def cmd_new(name, elements_file, token):
    with open(elements_file) as f:
        elements = json.load(f)
    res = api("/api/scenes", "POST", {"name": name, "elements": elements,
                                      "appState": {"viewBackgroundColor": "#ffffff"}}, token)
    print(f"✅ canvas saved: id={res['id']} name={name!r} elements={len(elements)}")


def cmd_list(token):
    data = api("/api/scenes", token=token)
    for s in data.get("scenes", []):
        print(f"  {s['id']:>4}  {s['updated_at']}  {s['name']}")


def cmd_demo(token):
    """Demo flowchart: title + 2 rounded boxes + arrow (like the PoC)."""
    els = [
        text(-240, -220, "Agent-built canvas", 28, "#6965db"),
        rect(-240, -140, 200, 80, fill="#dbeafe", stroke="#3b82f6"),
        text(-230, -115, "Step A", 20),
        rect(-240, 20, 200, 80, fill="#dcfce7", stroke="#22c55e"),
        text(-230, 45, "Step B", 20),
        arrow(-140, -60, -140, 20),
    ]
    name = f"Agent canvas {time.strftime('%Y-%m-%d %H:%M')}"
    res = api("/api/scenes", "POST", {"name": name, "elements": els,
                                      "appState": {"viewBackgroundColor": "#ffffff"}}, token)
    print(f"✅ demo canvas saved: id={res['id']} name={name!r} elements={len(els)}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    token = login()
    if cmd == "new" and len(sys.argv) >= 4:
        cmd_new(sys.argv[2], sys.argv[3], token)
    elif cmd == "list":
        cmd_list(token)
    elif cmd == "demo":
        cmd_demo(token)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
