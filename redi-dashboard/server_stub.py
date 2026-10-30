"""
백엔드 연동 테스트용 최소 서버 (FastAPI)

  pip install fastapi uvicorn
  uvicorn server_stub:app --reload --port 8000
  → http://localhost:8000  (대시보드가 LIVE 모드로 붙음)

실제 오케스트레이터에서는 get_state()가 SQLite의 attempts / rules / rounds 테이블을
집계해 docs/sample-state.json 과 같은 모양의 dict를 돌려주면 된다.
"""
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).parent
app = FastAPI(title="REDI dashboard stub")

# 대시보드를 다른 포트(예: python -m http.server)에서 열 때 필요
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_state() -> dict:
    # TODO(백엔드): 여기서 실제 상태를 집계해 반환
    state = json.loads((ROOT / "docs" / "sample-state.json").read_text(encoding="utf-8"))
    state["source"] = "stub"
    state.pop("step", None)
    state.pop("total_steps", None)
    return state


class Control(BaseModel):
    action: str  # play | next | next_round | end | reset


@app.get("/api/state")
def api_state():
    return get_state()


@app.post("/api/control")
def api_control(c: Control):
    # TODO(백엔드): 오케스트레이터 루프에 전달 (예: next_round → 다음 라운드 실행)
    return {"ok": True, "action": c.action}


# 마지막에 마운트해야 /api 경로를 가리지 않음
app.mount("/", StaticFiles(directory=ROOT, html=True), name="static")
