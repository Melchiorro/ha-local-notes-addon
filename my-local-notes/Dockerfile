FROM python:3.12-slim-bookworm

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN apt-get update && apt-get install -y dos2unix && \
    dos2unix run.sh && \
    chmod +x run.sh && \
    apt-get purge -y dos2unix && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

CMD [ "/app/run.sh" ]