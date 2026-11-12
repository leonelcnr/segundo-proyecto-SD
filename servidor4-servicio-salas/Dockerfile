FROM python:3.12.8-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin salas \
 && mkdir -p /datos && chown salas:salas /datos
USER 10001:10001

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-m", "app.salud"]

STOPSIGNAL SIGTERM
ENTRYPOINT ["python", "-m", "app"]
