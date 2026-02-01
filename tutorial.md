🚀 Kafka — Event Streaming in this Repo
A concise, repo-focused guide to Kafka, how it's used here, and practical tests you can run locally.

📖 1. Why Kafka in this project
This repo uses Kafka as a durable event backbone. Unlike a standard API call, Kafka provides retention, replayability, and decoupling. This allows multiple services to listen to the same event (e.g., an Audit service and an Automation service) without modifying the original source.

Primary Topics:

device-events: Produced by the Device Service when devices are registered or states change.

automation-events: Produced by Automation Logic; the Device Service subscribes to these to execute physical state changes.

⚙️ 2. Quickstart — Bring the stack up
From the repo root:

```bash
# Build and start the infrastructure (Kafka, Zookeeper, services, Kafdrop UI)
docker compose up -d --build

# Verify containers are running
docker compose ps
```

Web UI: Open Kafdrop at http://localhost:9000 to browse topics and view message payloads in your browser.

Direct Access: Use `docker compose exec kafka` to run native Kafka binaries.

🧪 3. Test producing & consuming messages
Option A — Use kcat (Fastest from host)
Ideal for testing without entering the Docker container.

Produce a test automation event:

```bash
echo '{"type":"automation.executed","actions":[{"deviceId":1,"state":{"on":true}}]}' \
  | docker run --rm -i edenhill/kcat:1.7.0 -b host.docker.internal:9092 -t automation-events -P
```

Consume recent messages:

```bash
docker run --rm edenhill/kcat:1.7.0 -b host.docker.internal:9092 -t automation-events -C -o beginning
```

Option B — Use native tools (Inside container)
List all topics:

```bash
docker compose exec kafka kafka-topics --bootstrap-server localhost:9092 --list
```

Produce via console-producer:

```bash
docker compose exec kafka bash -c "echo '{\"type\":\"manual.test\"}' | kafka-console-producer --broker-list localhost:9092 --topic automation-events"
```
🔍 4. Verify service behavior
Watch Logs: The Device Service logs whenever it processes a Kafka event.

```bash
docker compose logs -f device-service
# Look for: "Received automation event: {...}"
```
Trigger an Event: Creating a device via the API automatically publishes a device.added event.

```bash
curl -X POST http://localhost:3002/api/devices \
  -H "Content-Type: application/json" \
  -d '{"name":"Smart Lamp","type":"light"}'
```

Check Kafdrop or the device-events topic to see the resulting message.

🛠️ 5. Troubleshooting & Debugging
Windows/Mac Connectivity: If host tools can't reach Kafka, ensure KAFKA_ADVERTISED_LISTENERS includes host.docker.internal.

Consumer Groups: If messages aren't being processed, check if the service is stuck or lagging.

Describe consumer group status:

```bash
docker compose exec kafka kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group device-service-group
```
📈 6. Best Practices
Message Keys: Always use a unique identifier (like deviceId) as the message key to ensure ordered processing within a partition.

Idempotency: Ensure your logic can handle the same message twice without errors (At-least-once delivery).

Schemas: Keep JSON payloads consistent to avoid breaking downstream consumers.

✅ 7. One-Minute Playbook
Up: docker compose up -d 

View: Visit localhost:9000 

Trace: docker compose logs -f device-service 

Action: Send a test payload via kcat or curl. 