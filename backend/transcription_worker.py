import base64
import json
import os
import sys
from pathlib import Path

try:
    import vosk
except Exception as exc:  # pragma: no cover - surfaced to Node as status error
    vosk = None
    VOSK_IMPORT_ERROR = (
        f'{exc}. Install it for this Python interpreter: "{sys.executable}" '
        f'using: {sys.executable} -m pip install -r requirements-transcription.txt'
    )
else:
    VOSK_IMPORT_ERROR = None
    vosk.SetLogLevel(-1)


DEFAULT_SAMPLE_RATE = int(os.getenv("TRANSCRIPTION_OUTPUT_SAMPLE_RATE", "16000"))
MODEL_CACHE = {}
SESSIONS = {}


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def error_response(request_id, message):
    emit(
        {
            "id": request_id,
            "success": False,
            "error": message,
        }
    )


def ensure_vosk_available():
    if vosk is None:
        raise RuntimeError(
            VOSK_IMPORT_ERROR
            or 'Python package "vosk" is not installed. Run: pip install vosk'
        )


def resolve_model_path(raw_model_path):
    model_path = Path(raw_model_path).resolve()
    if not model_path.exists():
        raise FileNotFoundError(f"Offline transcription model was not found at {model_path}")
    return str(model_path)


def get_model(model_path):
    ensure_vosk_available()
    resolved_model_path = resolve_model_path(model_path)

    if resolved_model_path not in MODEL_CACHE:
      MODEL_CACHE[resolved_model_path] = vosk.Model(resolved_model_path)

    return MODEL_CACHE[resolved_model_path]


def handle_status(request):
    model_path = request.get("modelPath")

    if vosk is None:
        return {
            "available": False,
            "reason": VOSK_IMPORT_ERROR
            or 'Python package "vosk" is not installed. Run: pip install vosk',
        }

    if not model_path:
        return {
            "available": False,
            "reason": "No Vosk model path was provided to the Python worker.",
        }

    if not Path(model_path).exists():
        return {
            "available": False,
            "reason": f"Offline transcription model was not found at {Path(model_path).resolve()}",
        }

    return {
        "available": True,
        "reason": None,
    }


def handle_start(request):
    session_id = request.get("sessionId")
    model_path = request.get("modelPath")
    sample_rate = int(request.get("outputSampleRate") or DEFAULT_SAMPLE_RATE)

    if not session_id:
        raise ValueError("Missing sessionId for transcription start request.")

    model = get_model(model_path)

    previous_session = SESSIONS.pop(session_id, None)
    if previous_session is not None:
        del previous_session

    recognizer = vosk.KaldiRecognizer(model, float(sample_rate))
    SESSIONS[session_id] = {
        "recognizer": recognizer,
        "sample_rate": sample_rate,
    }

    return {
        "sessionId": session_id,
        "sampleRate": sample_rate,
    }


def handle_chunk(request):
    session_id = request.get("sessionId")
    encoded_audio = request.get("audioBase64")

    if not session_id:
        raise ValueError("Missing sessionId for transcription chunk request.")

    if not encoded_audio:
        raise ValueError("Missing audioBase64 for transcription chunk request.")

    session = SESSIONS.get(session_id)
    if session is None:
        raise KeyError("Transcription session not found.")

    audio_bytes = base64.b64decode(encoded_audio)
    if not audio_bytes:
        return {
            "text": "",
            "isFinal": False,
        }

    recognizer = session["recognizer"]
    is_final = recognizer.AcceptWaveform(audio_bytes)
    raw_result = recognizer.Result() if is_final else recognizer.PartialResult()
    parsed_result = json.loads(raw_result)
    text = (parsed_result.get("text") or parsed_result.get("partial") or "").strip()

    return {
        "text": text,
        "isFinal": is_final,
    }


def handle_stop(request):
    session_id = request.get("sessionId")
    if not session_id:
        raise ValueError("Missing sessionId for transcription stop request.")

    session = SESSIONS.pop(session_id, None)
    if session is None:
        return {
            "text": "",
        }

    recognizer = session["recognizer"]
    raw_result = recognizer.FinalResult()
    parsed_result = json.loads(raw_result)
    text = (parsed_result.get("text") or "").strip()

    return {
        "text": text,
    }


def handle_request(request):
    action = request.get("action")

    if action == "status":
        return handle_status(request)
    if action == "start":
        return handle_start(request)
    if action == "chunk":
        return handle_chunk(request)
    if action == "stop":
        return handle_stop(request)

    raise ValueError(f"Unsupported transcription action: {action}")


def main():
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request.get("id")
            response = handle_request(request)
            emit(
                {
                    "id": request_id,
                    "success": True,
                    **response,
                }
            )
        except Exception as exc:  # pragma: no cover - runtime error forwarding
            request_id = None
            try:
                request_id = json.loads(line).get("id")
            except Exception:
                request_id = None

            error_response(request_id, str(exc))


if __name__ == "__main__":
    main()
