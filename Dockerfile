# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static ./static

RUN addgroup --system --gid 1001 jobtracker && \
    adduser --system --uid 1001 --gid 1001 --no-create-home jobtracker && \
    mkdir -p /app/db /app/uploads && \
    chown -R jobtracker:jobtracker /app

USER jobtracker
EXPOSE 5000
CMD ["python", "app.py"]
