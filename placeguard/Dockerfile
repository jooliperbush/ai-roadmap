# One image for the API and the workers. GPU workers use the same image on a CUDA host;
# install the `gpu` extra there to enable the Grounding DINO detector.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY placeguard ./placeguard
RUN pip install --no-cache-dir ".[api,audio]"
ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "placeguard.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
