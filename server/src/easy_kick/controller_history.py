import copy
import uuid
from collections import deque


class ControllerHistory:
    """Bounded, in-memory controller frames for late-opening dashboard surfaces."""

    def __init__(self, maxlen: int = 5000):
        self._frames: deque[dict] = deque(maxlen=maxlen)
        self._session_id = uuid.uuid4().hex
        self._sequence = 0

    @property
    def session_id(self) -> str:
        return self._session_id

    def record(self, payload: dict) -> dict:
        self._sequence += 1
        frame = copy.deepcopy({
            **payload,
            "session_id": self._session_id,
            "seq": self._sequence,
        })
        self._frames.append(frame)
        return frame

    def snapshot(self) -> list[dict]:
        return copy.deepcopy(list(self._frames))

    def reset(self) -> None:
        self._frames.clear()
        self._session_id = uuid.uuid4().hex
        self._sequence = 0
