FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONPATH=/app/Backend
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/adc.json

CMD ["sh", "-c", "uvicorn main:app --app-dir Backend --host 0.0.0.0 --port ${PORT:-8080}"]
