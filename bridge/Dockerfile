FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir tzdata "paho-mqtt>=2,<3"
COPY bridge.py dashboard.py ./
COPY widgets ./widgets
CMD ["python", "-u", "bridge.py"]
