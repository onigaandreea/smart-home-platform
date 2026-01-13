const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const redis = require('redis');
const amqp = require('amqplib');
const { Kafka } = require('kafkajs');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3004;

// Create HTTP server
const server = http.createServer(app);

// WebSocket server with proper configuration
const wss = new WebSocket.Server({
    server,
    path: '/ws',
    clientTracking: true
});

// Redis clients for Pub/Sub and caching
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379',
    socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

const redisPub = redisClient.duplicate();
const redisSub = redisClient.duplicate();

// Connect Redis clients
(async () => {
    try {
        await redisClient.connect();
        await redisPub.connect();
        await redisSub.connect();
        console.log('✓ Connected to Redis');
    } catch (error) {
        console.error('Redis connection error:', error);
    }
})();

// Handle Redis errors
redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisPub.on('error', (err) => console.error('Redis Pub Error:', err));
redisSub.on('error', (err) => console.error('Redis Sub Error:', err));

// Store connected clients by userId
const clients = new Map();

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection established');

    // Set connection timeout
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // Handle incoming messages from client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'authenticate' && data.userId) {
                ws.userId = data.userId;

                // Store client connection
                if (!clients.has(data.userId)) {
                    clients.set(data.userId, new Set());
                }
                clients.get(data.userId).add(ws);

                console.log(`✓ User ${data.userId} authenticated. Total connections: ${wss.clients.size}`);

                // Send confirmation
                ws.send(JSON.stringify({
                    type: 'authenticated',
                    message: 'Connection established successfully',
                    timestamp: new Date().toISOString()
                }));
            } else if (data.type === 'ping') {
                // Respond to ping
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: new Date().toISOString()
                }));
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format',
                timestamp: new Date().toISOString()
            }));
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        if (ws.userId) {
            const userConnections = clients.get(ws.userId);
            if (userConnections) {
                userConnections.delete(ws);
                if (userConnections.size === 0) {
                    clients.delete(ws.userId);
                }
            }
            console.log(`✗ User ${ws.userId} disconnected. Total connections: ${wss.clients.size}`);
        }
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    // Send initial connection message
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Please authenticate with your userId',
        timestamp: new Date().toISOString()
    }));
});

// Heartbeat to detect broken connections
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating inactive connection');
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
    });
}, 30000); // Check every 30 seconds

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// Function to send notification to specific user
function sendToUser(userId, notification) {
    const userConnections = clients.get(userId);
    let deliveredCount = 0;

    if (userConnections && userConnections.size > 0) {
        userConnections.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(notification));
                    deliveredCount++;
                } catch (error) {
                    console.error('Error sending to client:', error);
                }
            }
        });
    }

    return deliveredCount > 0;
}

// Function to broadcast to all connected clients
function broadcastToAll(notification) {
    let deliveredCount = 0;

    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(notification));
                deliveredCount++;
            } catch (error) {
                console.error('Error broadcasting to client:', error);
            }
        }
    });

    console.log(`Broadcast delivered to ${deliveredCount} clients`);
    return deliveredCount;
}

// Subscribe to Redis pub/sub for distributed notifications
redisSub.subscribe('notifications', (message) => {
    try {
        const notification = JSON.parse(message);

        if (notification.broadcast) {
            // Broadcast to all connected clients
            broadcastToAll(notification);
        } else if (notification.userId) {
            // Send to specific user
            const delivered = sendToUser(notification.userId, notification);
            if (delivered) {
                console.log(`✓ Notification delivered to user ${notification.userId} on this instance`);
            }
        }
    } catch (error) {
        console.error('Error processing Redis message:', error);
    }
});

// Function to publish notification to Redis
async function publishNotification(notification) {
    try {
        await redisPub.publish('notifications', JSON.stringify(notification));
    } catch (error) {
        console.error('Error publishing to Redis:', error);
    }
}

// RabbitMQ connection
let rabbitChannel;
async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq:5672');
        rabbitChannel = await connection.createChannel();

        // Declare queues
        await rabbitChannel.assertQueue('device.command', { durable: true });
        await rabbitChannel.assertQueue('device.status', { durable: true });
        await rabbitChannel.assertQueue('automation.trigger', { durable: true });

        console.log('✓ Connected to RabbitMQ');

        // Listen for device status updates
        rabbitChannel.consume('device.status', async (msg) => {
            if (msg) {
                try {
                    const data = JSON.parse(msg.content.toString());
                    console.log('Received device status from RabbitMQ:', data);

                    const notification = {
                        type: 'device.status',
                        userId: data.userId,
                        message: `Device ${data.deviceId} status: ${data.status}`,
                        data: data,
                        timestamp: new Date().toISOString()
                    };

                    // Try local delivery
                    const delivered = sendToUser(notification.userId, notification);

                    // Also publish to Redis for other instances
                    await publishNotification(notification);

                    rabbitChannel.ack(msg);
                } catch (error) {
                    console.error('Error processing RabbitMQ message:', error);
                    rabbitChannel.nack(msg);
                }
            }
        });

        // Handle connection errors
        connection.on('error', (err) => {
            console.error('RabbitMQ connection error:', err);
            setTimeout(connectRabbitMQ, 5000);
        });

        connection.on('close', () => {
            console.log('RabbitMQ connection closed, reconnecting...');
            setTimeout(connectRabbitMQ, 5000);
        });
    } catch (error) {
        console.error('RabbitMQ connection error:', error);
        setTimeout(connectRabbitMQ, 5000);
    }
}

connectRabbitMQ();

// Kafka connection
const kafka = new Kafka({
    clientId: 'notification-service',
    brokers: (process.env.KAFKA_BROKERS || 'kafka:29092').split(','),
    retry: {
        retries: 5,
        initialRetryTime: 300
    }
});

const kafkaConsumer = kafka.consumer({
    groupId: 'notification-service-group',
    sessionTimeout: 30000,
    heartbeatInterval: 3000
});

async function connectKafka() {
    try {
        await kafkaConsumer.connect();
        await kafkaConsumer.subscribe({
            topics: ['device-events', 'sensor-data', 'automation-events'],
            fromBeginning: false
        });

        console.log('✓ Connected to Kafka');

        // Process incoming events
        kafkaConsumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const event = JSON.parse(message.value.toString());
                    console.log(`Received event from ${topic}:`, event.type);

                    let notification = null;

                    switch (event.type) {
                        case 'device.state_changed':
                            notification = {
                                type: 'device.state_changed',
                                userId: event.userId,
                                message: `Device state changed`,
                                data: event,
                                timestamp: new Date().toISOString()
                            };
                            break;

                        case 'device.added':
                            notification = {
                                type: 'device.added',
                                userId: event.userId,
                                message: `New device added: ${event.device.name}`,
                                data: event,
                                timestamp: new Date().toISOString()
                            };
                            break;

                        case 'motion.detected':
                            notification = {
                                type: 'motion.detected',
                                userId: event.userId,
                                message: `🚨 Motion detected on ${event.deviceName || 'camera'}`,
                                data: event,
                                timestamp: new Date().toISOString()
                            };
                            break;

                        case 'security.alert':
                            notification = {
                                type: 'security.alert',
                                userId: event.userId,
                                message: `⚠️ Security Alert: High activity detected`,
                                data: event,
                                timestamp: new Date().toISOString()
                            };
                            break;

                        case 'automation.executed':
                            notification = {
                                type: 'automation.executed',
                                userId: event.userId,
                                message: `Automation executed successfully`,
                                data: event,
                                timestamp: new Date().toISOString()
                            };
                            break;

                        case 'automation.created':
                            notification = {
                                type: 'automation.created',
                                userId: event.userId,
                                message: `New automation created`,
                                data: event,
                                timestamp: new Date().toISOString()
                            };
                            break;

                        case 'inventory.updated':
                            notification = {
                                type: 'inventory.updated',
                                message: `Product inventory updated`,
                                data: event,
                                timestamp: new Date().toISOString(),
                                broadcast: true
                            };
                            break;
                    }

                    if (notification) {
                        if (notification.broadcast) {
                            // Broadcast to all
                            broadcastToAll(notification);
                            await publishNotification(notification);
                        } else if (notification.userId) {
                            // Send to specific user
                            const delivered = sendToUser(notification.userId, notification);

                            // Always publish to Redis for other instances and multiple tabs
                            await publishNotification(notification);
                        }
                    }
                } catch (error) {
                    console.error('Error processing Kafka message:', error);
                }
            }
        });

        // Handle Kafka errors
        kafkaConsumer.on('consumer.crash', async (error) => {
            console.error('Kafka consumer crashed:', error);
            await kafkaConsumer.disconnect();
            setTimeout(connectKafka, 5000);
        });

    } catch (error) {
        console.error('Kafka connection error:', error);
        setTimeout(connectKafka, 5000);
    }
}

connectKafka();

// REST API endpoints

// POST /api/notify - Send custom notification
app.post('/api/notify', async (req, res) => {
    try {
        const { userId, message, type, data } = req.body;

        if (!userId || !message) {
            return res.status(400).json({ error: 'userId and message are required' });
        }

        const notification = {
            type: type || 'custom',
            userId,
            message,
            data,
            timestamp: new Date().toISOString()
        };

        const delivered = sendToUser(userId, notification);
        await publishNotification(notification);

        res.json({
            message: 'Notification sent',
            delivered: delivered,
            notification
        });
    } catch (error) {
        console.error('Send notification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/stats - Get connection stats
app.get('/api/stats', (req, res) => {
    const stats = {
        totalConnections: wss.clients.size,
        totalUsers: clients.size,
        usersOnline: Array.from(clients.keys()),
        connectionsPerUser: {}
    };

    clients.forEach((connections, userId) => {
        stats.connectionsPerUser[userId] = connections.size;
    });

    res.json(stats);
});

// Health check
app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        service: 'notification-service',
        websocket: {
            connections: wss.clients.size,
            users: clients.size
        },
        redis: redisClient.isOpen ? 'connected' : 'disconnected',
        rabbitmq: rabbitChannel ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    };

    res.json(health);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');

    // Close WebSocket server
    wss.clients.forEach((ws) => {
        ws.close(1000, 'Server shutting down');
    });
    wss.close();

    // Close Redis connections
    await redisClient.quit();
    await redisPub.quit();
    await redisSub.quit();

    // Close Kafka
    await kafkaConsumer.disconnect();

    // Close HTTP server
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  Notification Service                  ║
║  Port: ${PORT}                            ║
║  WebSocket: ws://localhost:${PORT}/ws    ║
╚════════════════════════════════════════╝
  `);
});