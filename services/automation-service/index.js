const express = require('express');
const mongoose = require('mongoose');
const amqp = require('amqplib');
const { Kafka } = require('kafkajs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// MongoDB connection
mongoose.connect(process.env.MONGODB_URL || 'mongodb://mongo:27017/smarthome')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Automation Rule Schema
const automationSchema = new mongoose.Schema({
    userId: { type: Number, required: true },
    name: { type: String, required: true },
    description: { type: String },
    enabled: { type: Boolean, default: true },
    trigger: {
        type: { type: String, enum: ['time', 'device', 'sensor'], required: true },
        conditions: mongoose.Schema.Types.Mixed
    },
    actions: [{
        deviceId: Number,
        action: String,
        state: mongoose.Schema.Types.Mixed
    }],
    createdAt: { type: Date, default: Date.now },
    lastExecuted: { type: Date }
});

const Automation = mongoose.model('Automation', automationSchema);

// Schedule Schema
const scheduleSchema = new mongoose.Schema({
    userId: { type: Number, required: true },
    name: { type: String, required: true },
    deviceId: { type: Number, required: true },
    schedule: {
        days: [String],
        time: String
    },
    action: mongoose.Schema.Types.Mixed,
    enabled: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const Schedule = mongoose.model('Schedule', scheduleSchema);

// RabbitMQ connection
let rabbitChannel;
async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq:5672');
        rabbitChannel = await connection.createChannel();

        await rabbitChannel.assertQueue('automation.trigger', { durable: true });
        await rabbitChannel.assertQueue('device.command', { durable: true });

        console.log('Connected to RabbitMQ');

        // Listen for automation triggers
        rabbitChannel.consume('automation.trigger', async (msg) => {
            if (msg) {
                const trigger = JSON.parse(msg.content.toString());
                console.log('Automation triggered:', trigger);

                try {
                    // Find and execute matching automations
                    const automations = await Automation.find({
                        userId: trigger.userId,
                        enabled: true,
                        'trigger.type': trigger.type
                    });

                    for (const automation of automations) {
                        // Execute automation actions
                        for (const action of automation.actions) {
                            rabbitChannel.sendToQueue(
                                'device.command',
                                Buffer.from(JSON.stringify({
                                    deviceId: action.deviceId,
                                    state: action.state,
                                    automationId: automation._id
                                })),
                                { persistent: true }
                            );
                        }

                        // Update last executed time
                        automation.lastExecuted = new Date();
                        await automation.save();
                    }
                } catch (error) {
                    console.error('Error processing automation trigger:', error);
                }

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
    clientId: 'automation-service',
    brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['kafka:29092']
});

const kafkaProducer = kafka.producer();
const kafkaConsumer = kafka.consumer({ groupId: 'automation-service-group' });

async function connectKafka() {
    try {
        await kafkaProducer.connect();
        await kafkaConsumer.connect();
        await kafkaConsumer.subscribe({ topic: 'device-events', fromBeginning: false });
        await kafkaConsumer.subscribe({ topic: 'sensor-data', fromBeginning: false });

        console.log('Connected to Kafka');

        // Listen for device events that might trigger automations
        kafkaConsumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const event = JSON.parse(message.value.toString());
                    console.log(`Received event from ${topic}:`, event);

                    if (event.type === 'device.state_changed') {
                        // Check if this state change should trigger automations
                        const automations = await Automation.find({
                            userId: event.userId,
                            enabled: true,
                            'trigger.type': 'device',
                            'trigger.conditions.deviceId': event.deviceId
                        });

                        for (const automation of automations) {
                            // Check if conditions are met
                            const conditionsMet = checkConditions(automation.trigger.conditions, event.state);

                            if (conditionsMet) {
                                // Execute automation
                                for (const action of automation.actions) {
                                    if (rabbitChannel) {
                                        rabbitChannel.sendToQueue(
                                            'device.command',
                                            Buffer.from(JSON.stringify({
                                                deviceId: action.deviceId,
                                                state: action.state,
                                                automationId: automation._id
                                            })),
                                            { persistent: true }
                                        );
                                    }
                                }

                                // Publish automation executed event
                                await kafkaProducer.send({
                                    topic: 'automation-events',
                                    messages: [{
                                        key: automation._id.toString(),
                                        value: JSON.stringify({
                                            type: 'automation.executed',
                                            automationId: automation._id,
                                            trigger: event,
                                            actions: automation.actions,
                                            userId: event.userId,
                                            timestamp: new Date().toISOString()
                                        })
                                    }]
                                });

                                automation.lastExecuted = new Date();
                                await automation.save();
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error processing Kafka message:', error);
                }
            }
        });
    } catch (error) {
        console.error('Kafka connection error:', error);
        setTimeout(connectKafka, 5000);
    }
}

connectKafka();

// Helper function to check if conditions are met
function checkConditions(conditions, currentState) {
    if (!conditions || !currentState) return false;

    for (const key in conditions) {
        if (key !== 'deviceId' && conditions[key] !== currentState[key]) {
            return false;
        }
    }
    return true;
}

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

// GET /api/automations - Get all automations
app.get('/api/automations', authenticateToken, async (req, res) => {
    try {
        const { enabled } = req.query;

        const query = { userId: req.user.id };
        if (enabled !== undefined) {
            query.enabled = enabled === 'true';
        }

        const automations = await Automation.find(query).sort({ createdAt: -1 });

        res.json({ automations });
    } catch (error) {
        console.error('Get automations error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/automations/:id - Get specific automation
app.get('/api/automations/:id', authenticateToken, async (req, res) => {
    try {
        const automation = await Automation.findOne({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!automation) {
            return res.status(404).json({ error: 'Automation not found' });
        }

        res.json({ automation });
    } catch (error) {
        console.error('Get automation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/automations - Create new automation
app.post('/api/automations', authenticateToken, async (req, res) => {
    try {
        const { name, description, trigger, actions } = req.body;

        // Validation
        if (!name || !trigger || !actions) {
            return res.status(400).json({ error: 'Name, trigger, and actions are required' });
        }

        if (!trigger.type || !['time', 'device', 'sensor'].includes(trigger.type)) {
            return res.status(400).json({ error: 'Invalid trigger type' });
        }

        if (!Array.isArray(actions) || actions.length === 0) {
            return res.status(400).json({ error: 'At least one action is required' });
        }

        const automation = new Automation({
            userId: req.user.id,
            name,
            description: description || '',
            trigger,
            actions,
            enabled: true
        });

        await automation.save();

        // Publish automation created event
        try {
            await kafkaProducer.send({
                topic: 'automation-events',
                messages: [{
                    key: automation._id.toString(),
                    value: JSON.stringify({
                        type: 'automation.created',
                        automation,
                        userId: req.user.id,
                        timestamp: new Date().toISOString()
                    })
                }]
            });
        } catch (kafkaError) {
            console.error('Failed to publish to Kafka:', kafkaError);
        }

        res.status(201).json({
            message: 'Automation created successfully',
            automation
        });
    } catch (error) {
        console.error('Create automation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/automations/:id - Update automation
app.put('/api/automations/:id', authenticateToken, async (req, res) => {
    try {
        const automation = await Automation.findOne({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!automation) {
            return res.status(404).json({ error: 'Automation not found' });
        }

        // Update fields
        const { name, description, trigger, actions, enabled } = req.body;

        if (name) automation.name = name;
        if (description !== undefined) automation.description = description;
        if (trigger) automation.trigger = trigger;
        if (actions) automation.actions = actions;
        if (enabled !== undefined) automation.enabled = enabled;

        await automation.save();

        res.json({
            message: 'Automation updated successfully',
            automation
        });
    } catch (error) {
        console.error('Update automation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/automations/:id/toggle - Toggle automation enabled/disabled
app.patch('/api/automations/:id/toggle', authenticateToken, async (req, res) => {
    try {
        const automation = await Automation.findOne({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!automation) {
            return res.status(404).json({ error: 'Automation not found' });
        }

        automation.enabled = !automation.enabled;
        await automation.save();

        res.json({
            message: `Automation ${automation.enabled ? 'enabled' : 'disabled'}`,
            automation
        });
    } catch (error) {
        console.error('Toggle automation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/automations/:id - Delete automation
app.delete('/api/automations/:id', authenticateToken, async (req, res) => {
    try {
        const result = await Automation.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!result) {
            return res.status(404).json({ error: 'Automation not found' });
        }

        res.json({ message: 'Automation deleted successfully' });
    } catch (error) {
        console.error('Delete automation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/automations/:id/execute - Manually execute automation
app.post('/api/automations/:id/execute', authenticateToken, async (req, res) => {
    try {
        const automation = await Automation.findOne({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!automation) {
            return res.status(404).json({ error: 'Automation not found' });
        }

        // Execute automation actions
        for (const action of automation.actions) {
            if (rabbitChannel) {
                try {
                    rabbitChannel.sendToQueue(
                        'device.command',
                        Buffer.from(JSON.stringify({
                            deviceId: action.deviceId,
                            state: action.state,
                            automationId: automation._id
                        })),
                        { persistent: true }
                    );
                } catch (rabbitError) {
                    console.error('Failed to send to RabbitMQ:', rabbitError);
                }
            }
        }

        automation.lastExecuted = new Date();
        await automation.save();

        res.json({
            message: 'Automation executed successfully',
            automation
        });
    } catch (error) {
        console.error('Execute automation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/schedules - Get all schedules
app.get('/api/schedules', authenticateToken, async (req, res) => {
    try {
        const schedules = await Schedule.find({ userId: req.user.id })
            .sort({ createdAt: -1 });

        res.json({ schedules });
    } catch (error) {
        console.error('Get schedules error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/schedules/:id - Get specific schedule
app.get('/api/schedules/:id', authenticateToken, async (req, res) => {
    try {
        const schedule = await Schedule.findOne({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!schedule) {
            return res.status(404).json({ error: 'Schedule not found' });
        }

        res.json({ schedule });
    } catch (error) {
        console.error('Get schedule error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/schedules - Create new schedule
app.post('/api/schedules', authenticateToken, async (req, res) => {
    try {
        const { name, deviceId, schedule, action } = req.body;

        // Validation
        if (!name || !deviceId || !schedule || !action) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (!schedule.days || !schedule.time) {
            return res.status(400).json({ error: 'Schedule must include days and time' });
        }

        const newSchedule = new Schedule({
            userId: req.user.id,
            name,
            deviceId,
            schedule,
            action,
            enabled: true
        });

        await newSchedule.save();

        res.status(201).json({
            message: 'Schedule created successfully',
            schedule: newSchedule
        });
    } catch (error) {
        console.error('Create schedule error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/schedules/:id - Update schedule
app.put('/api/schedules/:id', authenticateToken, async (req, res) => {
    try {
        const schedule = await Schedule.findOne({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!schedule) {
            return res.status(404).json({ error: 'Schedule not found' });
        }

        const { name, deviceId, schedule: scheduleData, action, enabled } = req.body;

        if (name) schedule.name = name;
        if (deviceId) schedule.deviceId = deviceId;
        if (scheduleData) schedule.schedule = scheduleData;
        if (action) schedule.action = action;
        if (enabled !== undefined) schedule.enabled = enabled;

        await schedule.save();

        res.json({
            message: 'Schedule updated successfully',
            schedule
        });
    } catch (error) {
        console.error('Update schedule error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/schedules/:id - Delete schedule
app.delete('/api/schedules/:id', authenticateToken, async (req, res) => {
    try {
        const result = await Schedule.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!result) {
            return res.status(404).json({ error: 'Schedule not found' });
        }

        res.json({ message: 'Schedule deleted successfully' });
    } catch (error) {
        console.error('Delete schedule error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'automation-service' });
});

app.listen(PORT, () => {
    console.log(`Automation Service running on port ${PORT}`);
});