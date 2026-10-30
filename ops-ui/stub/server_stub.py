"""
백엔드 연동 테스트용 스텁 (FastAPI)
실제 백엔드가 준비되기 전, 프론트가 LIVE 모드로 붙는지 확인하는 용도입니다.

    pip install fastapi uvicorn
    cd stub
    uvicorn server_stub:app --host 0.0.0.0 --port 8000

그다음 ops-ui 폴더에서 npm run dev → http://localhost:5173 (vite가 /api 를 8000으로 넘김)

- GET  /api/state    : states.json 의 단계별 상태를 돌려줌 (play 중이면 1초마다 한 단계 진행)
- POST /api/control  : {"action": "play" | "next" | "next_round" | "end" | "reset"}
- npm run build 로 만든 ../dist 가 있으면 / 에서 함께 서빙 (프론트·백엔드 한 주소)

실제 백엔드는 src/types.ts 의 DashboardState 모양만 지키면 됩니다.
"""
import json
import threading
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

HERE = Path(__file__).parent
STATES = json.loads((HERE / "states.json").read_text(encoding="utf-8"))
LAST = len(STATES) - 1

app = FastAPI(title="REDI dashboard stub")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

lock = threading.Lock()
sim = {"step": LAST, "playing": False}


def ticker() -> None:
    while True:
        time.sleep(1.0)
        with lock:
            if sim["playing"]:
                sim["step"] = min(LAST, sim["step"] + 1)
                sim["playing"] = sim["step"] < LAST


threading.Thread(target=ticker, daemon=True).start()


@app.get("/api/state")
def api_state():
    with lock:
        state = dict(STATES[sim["step"]])
    state["source"] = "stub"
    return state


class Control(BaseModel):
    action: str


@app.post("/api/control")
def api_control(c: Control):
    with lock:
        if c.action == "play":
            sim.update(step=0, playing=True)
        elif c.action == "next":
            sim.update(step=min(LAST, sim["step"] + 1), playing=False)
        elif c.action == "next_round":
            cur = STATES[min(LAST, sim["step"] + 1)]["round"]
            s = sim["step"]
            while s < LAST and STATES[s + 1]["round"] == cur:
                s += 1
            sim.update(step=s, playing=False)
        elif c.action == "end":
            sim.update(step=LAST, playing=False)
        elif c.action == "reset":
            sim.update(step=0, playing=False)
    return {"ok": True, "action": c.action}


DIST = HERE.parent / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="dashboard")
