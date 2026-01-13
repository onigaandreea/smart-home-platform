const { Kafka } = require('kafkajs');

// Kafka connection
const kafka = new Kafka({
    clientId: 'motion-detector',
    brokers: (process.env.KAFKA_BROKERS || 'kafka:29092').split(',')
});

const producer = kafka.producer();
let producerConnected = false;

async function connectKafka() {
    if (!producerConnected) {
        await producer.connect();
        producerConnected = true;
        console.log('Motion detector connected to Kafka');
    }
}

// Simulate motion detection processing
async function detectMotion(cameraId, imageData, userId) {
    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Simulate motion detection (70% chance of detecting motion)
    const motionDetected = Math.random() > 0.3;

    if (motionDetected) {
        // Simulate detecting number of people
        const peopleCount = Math.floor(Math.random() * 3) + 1;

        return {
            detected: true,
            confidence: 0.85 + Math.random() * 0.15, // 85-100% confidence
            peopleCount,
            cameraId,
            userId,
            timestamp: new Date().toISOString(),
            alertLevel: peopleCount > 1 ? 'high' : 'medium'
        };
    }

    return {
        detected: false,
        cameraId,
        userId,
        timestamp: new Date().toISOString()
    };
}

// Main handler function (FaaS entry point)
module.exports = async (event, context) => {
    try {
        console.log('Motion detector invoked with event:', event);

        // Parse the input
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        const { cameraId, imageData, userId, deviceName } = body;

        if (!cameraId || !userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Missing required fields: cameraId, userId'
                })
            };
        }

        // Connect to Kafka
        await connectKafka();

        // Process motion detection
        console.log(`Processing motion detection for camera ${cameraId}`);
        const detectionResult = await detectMotion(cameraId, imageData, userId);

        // Publish result to Kafka
        if (detectionResult.detected) {
            // Publish to sensor-data topic
            await producer.send({
                topic: 'sensor-data',
                messages: [{
                    key: cameraId.toString(),
                    value: JSON.stringify({
                        type: 'motion.detected',
                        cameraId,
                        deviceName: deviceName || `Camera ${cameraId}`,
                        userId,
                        confidence: detectionResult.confidence,
                        peopleCount: detectionResult.peopleCount,
                        alertLevel: detectionResult.alertLevel,
                        timestamp: detectionResult.timestamp
                    })
                }]
            });

            // If high alert, also trigger automation
            if (detectionResult.alertLevel === 'high') {
                await producer.send({
                    topic: 'automation-events',
                    messages: [{
                        key: `motion-${cameraId}`,
                        value: JSON.stringify({
                            type: 'security.alert',
                            trigger: 'motion_detection',
                            cameraId,
                            userId,
                            severity: 'high',
                            timestamp: detectionResult.timestamp
                        })
                    }]
                });
            }

            console.log(`Motion detected on camera ${cameraId} - confidence: ${(detectionResult.confidence * 100).toFixed(1)}%`);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: detectionResult.detected ? 'Motion detected' : 'No motion detected',
                result: detectionResult
            })
        };
    } catch (error) {
        console.error('Motion detection error:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Motion detection failed',
                message: error.message
            })
        };
    }
};

// HTTP server wrapper for standalone testing
if (require.main === module) {
    const express = require('express');
    const app = express();
    app.use(express.json());

    app.post('/motion-detect', async (req, res) => {
        const result = await module.exports({ body: req.body }, {});
        res.status(result.statusCode).json(JSON.parse(result.body));
    });

    app.get('/health', (req, res) => {
        res.json({ status: 'healthy', service: 'motion-detector' });
    });

    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => {
        console.log(`Motion detector function running on port ${PORT}`);
    });
}