# � Kafka — Event Streaming in this Repo

> **A concise, repo-focused guide to Kafka, how it's used here, and practical tests you can run locally.**

---

## 📖 1. Why Kafka in this project
This repo uses **Kafka** for durable event streaming and asynchronous domain events (e.g., `device-events`, `automation-events`). Kafka provides **retention**, **replay**, **scalability**, and **multiple independent consumers** — ideal for audit logs, automations, and event-driven integrations.

**Key topics in this repo:**
- `device-events` — produced by the Device Service when devices are added or their state changes.
- `automation-events` — produced/consumed by automation logic; `device-service` subscribes to it to apply automation results.

---

## ⚙️ 2. Quickstart — bring Kafka & the stack up
From the repo root:

```bash
# Build and start required services (Kafka, Zookeeper, services, Kafdrop UI)
docker compose up -d --build

# Check containers
docker compose ps
```

Open Kafdrop (web UI) at **http://localhost:9000** to browse topics and messages. If you prefer the Kafka CLI, use `docker compose exec kafka` for `kafka-topics`, `kafka-console-producer` and `kafka-console-consumer`.

---

## 🧪 3. Test producing & consuming messages
### Option A — Use kcat (fast from host)

Produce a test automation event:

```bash
# On Windows use host.docker.internal:9092 if localhost fails
echo '{"type":"automation.executed","actions":[{"deviceId":1,"state":{"on":true}}]}' \
  | docker run --rm -i edenhill/kcat:1.7.0 -b host.docker.internal:9092 -t automation-events -P
```

Consume recent messages:

```bash
docker run --rm edenhill/kcat:1.7.0 -b host.docker.internal:9092 -t automation-events -C -o beginning
```

### Option B — Use Kafka tools inside the container

List topics:

```bash
docker compose exec kafka kafka-topics --bootstrap-server localhost:9092 --list
```

Produce with console-producer:

```bash
docker compose exec kafka bash -c "echo '{\"type\":\"automation.executed\",\"actions\":[{\"deviceId\":1,\"state\":{\"on\":true}}]}' | kafka-console-producer --broker-list localhost:9092 --topic automation-events"
```

Consume from beginning:

```bash
docker compose exec kafka kafka-console-consumer --bootstrap-server localhost:9092 --topic automation-events --from-beginning --max-messages 10
```

---

## 🔍 4. Verify service behavior (repo-specific)
- Watch the **Device Service** logs — it subscribes to `automation-events` and logs when events are handled:

```bash
docker compose logs -f device-service
# Look for: "Received automation event: {...}"
```

- Creating or updating a device via the API publishes to `device-events` (see `services/device-service/index.js` lines that call `kafkaProducer.send` when devices are added or state changes).

Example: create a device (this will also publish a `device.added` event):

```bash
curl -X POST http://localhost/api/devices \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Light","type":"light"}'
```

Then inspect Kafdrop or the `device-events` topic to see the message.

---

## 🧩 5. Quick reference — where Kafka is used in the code
- **Producer usage:** in `services/device-service/index.js` (look for `kafkaProducer.send({ topic: 'device-events', ... })`).
- **Consumer usage:** same file subscribes to `automation-events` via `kafka.consumer()` and handles `automation.executed` events.

These examples use the `kafkajs` client (`const { Kafka } = require('kafkajs')`) for both producing and consuming.

---

## 🛠️ 6. Troubleshooting & common pitfalls
- Windows host access: if host tools can't reach Kafka, use `host.docker.internal:9092` or update `KAFKA_ADVERTISED_LISTENERS` to include an address reachable from the host. 
- If messages don't appear in Kafdrop but do in logs, check listener configuration and advertised listeners. 
- Topics may be auto-created; if not, create them explicitly with `kafka-topics`.

**Useful debug commands:**

```bash
# Describe topic
docker compose exec kafka kafka-topics --bootstrap-server localhost:9092 --topic automation-events --describe

# List consumer groups
docker compose exec kafka kafka-consumer-groups --bootstrap-server localhost:9092 --list

# Describe a consumer group
docker compose exec kafka kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group device-service-group
```

---

## 📈 7. Best practices (brief)
- Use **keys** for ordered processing per entity (e.g., deviceId as message key). 
- Keep messages **idempotent** or include unique ids to avoid duplicate processing. 
- Set **retention** and partition count according to expected throughput & retention requirements. 
- Monitor consumer lags (consumer groups) and set appropriate **alerts**.

---

## ✅ 8. Quick playbook (one-minute test)
1. Start the stack: `docker compose up -d --build` ✅
2. Open Kafdrop: http://localhost:9000 ✅
3. Produce a test event using kcat or `kafka-console-producer` ✅
4. Check `device-service` logs: `docker compose logs -f device-service` — look for consumption logs ✅

---

## Wrap-up
This guide gives you practical steps to explore Kafka in this repository, run quick tests, and locate where events are produced and consumed in the codebase. If you want, I can add an automated test script under `scripts/` (e.g., `scripts/test-kafka.js`) to produce and verify messages end-to-end — shall I add it? 🚀
