FROM python:3.12-slim
LABEL version="3"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY symbols/ ./symbols/

# Optional (wildcard COPY is a no-op if the file doesn't exist): bakes secrets
# like SLACK_FEEDBACK_WEBHOOK_URL into the image at build time, since Airbase
# has no env var / secrets UI to inject them at runtime. Settings() picks this
# up automatically via pydantic-settings' env_file=".env". Never commit a real
# backend/.env — it's gitignored, but Docker's build context isn't git, so
# this only works because you create it locally before running `airbase deploy`.
COPY .env* ./

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
