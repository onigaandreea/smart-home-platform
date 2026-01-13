const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const { Kafka } = require('kafkajs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Initialize database
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        home_id INTEGER,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        room VARCHAR(100),
        status VARCHAR(20) DEFAULT 'offline',
        state JSONB DEFAULT '{}',
        last_seen TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Insert sample devices
        const count = await client.query('SELECT COUNT(*) FROM devices WHERE user_id = 1');
        if (count.rows[0].count === '0') {
            await client.query(`
        INSERT INTO devices (user_id, home_id, name, type, room, status, state) VALUES
        (1, 1, 'Living Room Light', 'light', 'Living Room', 'online', '{"on": false, "brightness": 100}'),
        (1, 1, 'Bedroom Thermostat', 'thermostat', 'Bedroom', 'online', '{"temperature": 22, "mode": "auto"}'),
        (1, 1, 'Front Door Lock', 'lock', 'Entrance', 'online', '{"locked": true}'),
        (1, 1, 'Kitchen Camera', 'camera', 'Kitchen', 'online', '{"recording": false}'),
        (1, 1, 'Garden Sprinkler', 'sprinkler', 'Garden', 'online', '{"active": false}')
      `);
            console.log('Sample devices inserted');
        }

        console.log('Devices table initialized');
    } finally {
        client.release();
    }
}

initDB();

// RabbitMQ connection
let rabbitChannel;
async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL);
        rabbitChannel = await connection.createChannel();

        await rabbitChannel.assertQueue('device.command', { durable: true });
        await rabbitChannel.assertQueue('device.status', { durable: true });
        await rabbitChannel.assertQueue('automation.trigger', { durable: true });

        console.log('Connected to RabbitMQ');

        // Listen for device commands
        rabbitChannel.consume('device.command', async (msg) => {
            if (msg) {
                const command = JSON.parse(msg.content.toString());
                console.log('Received device command:', command);

                // Update device state
                await pool.query(
                    'UPDATE devices SET state = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2',
                    [JSON.stringify(command.state), command.deviceId]
                );

                // Acknowledge command processed
                rabbitChannel.sendToQueue(
                    'device.status',
                    Buffer.from(JSON.stringify({
                        deviceId: command.deviceId,
                        status: 'success',
                        state: command.state
                    })),
                    { persistent: true }
                );

                rabbitChannel.ack(msg);
            }
        });
    } catch (error) {
        console.error('RabbitMQ connection error:', error);
        setTimeout(connectRabbitMQ, 5000);
    }
}

connectRabbitMQ();

// Kafka connection
const kafka = new Kafka({
    clientId: 'device-service',
    brokers: process.env.KAFKA_BROKERS.split(',')
});

const kafkaProducer = kafka.producer();
const kafkaConsumer = kafka.consumer({ groupId: 'device-service-group' });

async function connectKafka() {
    try {
        await kafkaProducer.connect();
        await kafkaConsumer.connect();
        await kafkaConsumer.subscribe({ topic: 'automation-events', fromBeginning: false });

        console.log('Connected to Kafka');

        // Listen for automation triggers
        kafkaConsumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                const event = JSON.parse(message.value.toString());
                console.log('Received automation event:', event);

                if (event.type === 'automation.executed') {
                    // Update affected devices
                    for (const action of event.actions || []) {
                        if (action.deviceId) {
                            await pool.query(
                                'UPDATE devices SET state = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2',
                                [JSON.stringify(action.state), action.deviceId]
                            );
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Kafka connection error:', error);
        setTimeout(connectKafka, 5000);
    }
}

connectKafka();

// Middleware to verify JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// GET /api/devices - Get all user's devices
app.get('/api/devices', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM devices WHERE user_id = $1 ORDER BY room, name',
            [req.user.id]
        );

        res.json({ devices: result.rows });
    } catch (error) {
        console.error('Get devices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/devices/:id - Get specific device
app.get('/api/devices/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM devices WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ device: result.rows[0] });
    } catch (error) {
        console.error('Get device error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/devices - Add new device
app.post('/api/devices', authenticateToken, async (req, res) => {
    try {
        const { name, type, room, home_id } = req.body;

        const result = await pool.query(
            'INSERT INTO devices (user_id, home_id, name, type, room, status, state) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [req.user.id, home_id || 1, name, type, room, 'offline', JSON.stringify({})]
        );

        const device = result.rows[0];

        // Publish device added event to Kafka
        await kafkaProducer.send({
            topic: 'device-events',
            messages: [{
                key: device.id.toString(),
                value: JSON.stringify({
                    type: 'device.added',
                    device,
                    userId: req.user.id,
                    timestamp: new Date().toISOString()
                })
            }]
        });

        res.status(201).json({
            message: 'Device added successfully',
            device
        });
    } catch (error) {
        console.error('Add device error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/devices/:id/state - Update device state
app.put('/api/devices/:id/state', authenticateToken, async (req, res) => {
    try {
        const { state } = req.body;
        const deviceId = req.params.id;

        // Send command to device via RabbitMQ
        if (rabbitChannel) {
            rabbitChannel.sendToQueue(
                'device.command',
                Buffer.from(JSON.stringify({
                    deviceId,
                    state,
                    userId: req.user.id,
                    timestamp: new Date().toISOString()
                })),
                { persistent: true }
            );
        }

        // Update in database
        const result = await pool.query(
            'UPDATE devices SET state = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING *',
            [JSON.stringify(state), deviceId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const device = result.rows[0];

        // Publish state change event to Kafka
        await kafkaProducer.send({
            topic: 'device-events',
            messages: [{
                key: deviceId.toString(),
                value: JSON.stringify({
                    type: 'device.state_changed',
                    deviceId,
                    state,
                    userId: req.user.id,
                    timestamp: new Date().toISOString()
                })
            }]
        });

        res.json({
            message: 'Device state updated',
            device
        });
    } catch (error) {
        console.error('Update device state error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/devices/:id - Remove device
app.delete('/api/devices/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM devices WHERE id = $1 AND user_id = $2 RETURNING *',
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // Publish device removed event
        await kafkaProducer.send({
            topic: 'device-events',
            messages: [{
                key: req.params.id,
                value: JSON.stringify({
                    type: 'device.removed',
                    deviceId: req.params.id,
                    userId: req.user.id,
                    timestamp: new Date().toISOString()
                })
            }]
        });

        res.json({ message: 'Device removed successfully' });
    } catch (error) {
        console.error('Remove device error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'device-service' });
});

app.listen(PORT, () => {
    console.log(`Device Service running on port ${PORT}`);
});