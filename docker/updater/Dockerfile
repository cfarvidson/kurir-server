FROM alpine:3.20

LABEL org.opencontainers.image.source="https://github.com/cfarvidson/kurir-server"
LABEL org.opencontainers.image.description="Kurir — out-of-band updater sidecar"
LABEL org.opencontainers.image.licenses="LicenseRef-OSaasy"

RUN apk add --no-cache \
    docker-cli \
    docker-cli-compose \
    python3 \
    ca-certificates

WORKDIR /workdir

COPY updater-server.py /usr/local/bin/updater-server.py
RUN chmod +x /usr/local/bin/updater-server.py

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=3).status==200 else 1)" || exit 1

CMD ["python3", "/usr/local/bin/updater-server.py"]
