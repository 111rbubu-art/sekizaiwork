# Docker で動かしたいとき用。venv で直接動かすなら要らない。
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./

# dataset と runs は外（ホスト）に置く。中に入れない。
VOLUME ["/app/dataset", "/app/runs"]
EXPOSE 8077
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8077"]
