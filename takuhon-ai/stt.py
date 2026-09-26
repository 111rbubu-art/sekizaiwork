"""声を文字にする（業務アプリの AI チャットの［🎤］用。2026-09-26）。

  Ollama の gemma4 e4b に音声を渡していたが、お寺の名前などが安定しなかった
  （慈宏寺→地蔵地・自供寺・御影）。日本語専用の音声認識 kotoba-whisper を、
  拓本AI と同じ GPU・同じサーバーで動かす。

  ・モデルは **初めて呼ばれたときに読む**（サーバーの起動は遅くしない）。
    初回は Hugging Face から 1.5GB ほど落とすので、1〜数分かかる。2 回目からはすぐ。
  ・GPU に置くのは 1.5GB 前後（半精度）。
  ・**prompt**（お寺の名前・業務の言葉）を渡すと、その書き方に寄せる。
  ・文のほかに **読み（ひらがな）** も返す。業務アプリはこの読みで
    登録してあるお寺の読みと照らし、漢字の取りちがえを直す（_aiTempleFromYomi）。
  ・モデルを変えたいときは 環境変数 TAKU_STT_MODEL。
"""
import base64
import io
import threading
import time
import wave

import numpy as np
import torch

MODEL_NAME = __import__("os").environ.get("TAKU_STT_MODEL", "kotoba-tech/kotoba-whisper-v2.0")
SR = 16000
MAX_SEC = 30                     # Whisper は 1 回に 30 秒まで。問い合わせはそれより短い

_S = {"model": None, "proc": None, "err": None, "loading": False, "at": None, "device": None}
_LOCK = threading.Lock()
_KKS = None


def status():
    return {"model": MODEL_NAME, "loaded": _S["model"] is not None, "loading": _S["loading"],
            "error": _S["err"], "loaded_at": _S["at"], "device": _S["device"]}


def _load(device):
    if _S["model"] is not None:
        return
    _S["loading"] = True
    try:
        from transformers import WhisperForConditionalGeneration, WhisperProcessor
        dt = torch.float16 if device.type == "cuda" else torch.float32
        proc = WhisperProcessor.from_pretrained(MODEL_NAME)
        model = WhisperForConditionalGeneration.from_pretrained(MODEL_NAME, torch_dtype=dt)
        model.to(device).eval()
        _S.update(model=model, proc=proc, err=None, at=time.time(), device=str(device))
    except Exception as e:                                   # noqa: BLE001
        _S["err"] = f"{type(e).__name__}: {e}"
        raise
    finally:
        _S["loading"] = False


def _wav_to_f32(b):
    """ブラウザが作る WAV（16kHz・1ch・16bit）を -1..1 の数の並びに。ほかの速さなら 16kHz に直す。"""
    try:
        with wave.open(io.BytesIO(b), "rb") as w:
            ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
    except (wave.Error, EOFError) as e:
        raise ValueError(f"WAV として読めません（{e}）") from e
    if sw != 2:
        raise ValueError(f"16bit の WAV だけ読めます（{sw * 8}bit でした）")
    a = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    if sr != SR and len(a):
        x = np.linspace(0, len(a) - 1, int(round(len(a) * SR / sr)))
        a = np.interp(x, np.arange(len(a)), a).astype(np.float32)
    return a[: SR * MAX_SEC]


_KANJI = __import__("re").compile(r"[\u4e00-\u9fff々]")


def yomi(text):
    """文の読み（ひらがな）。pykakasi が無ければ空。
    pykakasi は「寺」を「てら」、「〇〇家」の「家」を「いえ」、「納骨日」の「日」を「にち」と読むので、
    前が漢字の語なら「じ」「け」、納骨の後の日は「び」に直す（お寺の読みと照らすため）。"""
    global _KKS
    try:
        if _KKS is None:
            import pykakasi
            _KKS = pykakasi.kakasi()
        toks = _KKS.convert(text or "")
    except Exception:                                        # noqa: BLE001
        return ""
    out = []
    for i, x in enumerate(toks):
        o, h = x.get("orig", ""), x.get("hira", "")
        prev = toks[i - 1].get("orig", "") if i else ""
        after_kanji = bool(prev) and bool(_KANJI.search(prev[-1]))
        if o == "寺" and after_kanji:
            h = "じ"
        elif o == "家" and after_kanji:
            h = "け"
        elif o == "日" and prev.endswith("納骨"):
            h = "び"
        out.append(h)
    return "".join(out)


_HEAD = __import__("re").compile(r"^\s*([^\s、。]{1,6}?)(の|って|で|は)")


def head_yomis(text, cap=600):
    """文の頭の「〇〇の」の 〇〇 について、漢字 1 字ずつの**ありうる読み**を全部組み合わせた一覧。
    pykakasi は 1 つの読みしか返さない（「上一」→ うえいち）。お寺の名前を 別の字で書かれたとき
    （浄因寺 → 上一）、音読みの組み合わせ「じょういち」なら お寺の読みと照らせる。業務アプリが使う。"""
    m = _HEAD.match(text or "")
    if not m or not _KANJI.search(m.group(1)):
        return []
    head = m.group(1)
    # 「〇〇家」「〇〇さん」は 人の名前。お寺ではない
    if __import__("re").search(r"(家|さん|様|氏)$", head):
        return []
    try:
        global _KKS
        if _KKS is None:
            import pykakasi
            _KKS = pykakasi.kakasi()
        from pykakasi.kanji import Kanwa
        kw = Kanwa()
        toks = _KKS.convert(__import__("re").sub(r"(寺|院)$", "", head) or head)
    except Exception:                                        # noqa: BLE001
        return []
    # 辞書に 1 語で載っている言葉（高橋・吉田・福寿 など）は、その読みを信じる（ほかの読みは試さない）
    if len(toks) == 1 and len(toks[0].get("orig", "")) >= 2:
        return []
    outs = [""]
    for c in head:
        rs = [c]
        if _KANJI.search(c):
            t = kw.load(c) or {}
            rs = sorted({y for y, _ in t.get(c, []) if y}) or [c]
            rs = [y for y in rs if len(y) <= 3]              # 名乗りの長い読み（のぼる 等）は外す
            if c == "寺":
                rs = ["じ"]
        outs = [o + r for o in outs for r in rs][:cap]
    return outs


def transcribe(wav_b64, prompt, device):
    b = base64.b64decode(wav_b64)
    audio = _wav_to_f32(b)
    sec = len(audio) / SR
    if sec < 0.3:
        raise ValueError("録音が短すぎます")
    t0 = time.time()
    with _LOCK:
        _load(device)
        model, proc = _S["model"], _S["proc"]
        feats = proc(audio, sampling_rate=SR, return_tensors="pt").input_features
        feats = feats.to(device, dtype=next(model.parameters()).dtype)
        kw = {"language": "ja", "task": "transcribe", "max_new_tokens": 160}
        prompt = (prompt or "").strip()
        if prompt:
            kw["prompt_ids"] = torch.as_tensor(proc.get_prompt_ids(prompt[:200])).to(device)
        with torch.inference_mode():
            ids = model.generate(feats, **kw)
        text = proc.batch_decode(ids, skip_special_tokens=True)[0].strip()
    # 版によっては 渡した見本が頭に付いて返ることがあるので、外す
    if prompt and text.startswith(prompt[:200]):
        text = text[len(prompt[:200]):].strip()
    return {"text": text, "yomi": yomi(text), "head_yomis": head_yomis(text), "sec": round(sec, 2),
            "ms": int((time.time() - t0) * 1000), "model": MODEL_NAME}
