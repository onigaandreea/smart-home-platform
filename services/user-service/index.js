const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const redis = require('redis');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Redis connection for caching
const redisClient = redis.createClient({
    url: process.env.REDIS_URL
});

redisClient.connect().catch(console.error);

// Initialize database
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        await client.query(`
      CREATE TABLE IF NOT EXISTS homes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        console.log('Database tables initialized');
    } finally {
        client.release();
    }
}

initDB();

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

// POST /api/register - Register new user
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if user already exists
        const existingUser = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const result = await pool.query(
            'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
            [email, hashedPassword, name]
        );

        const user = result.rows[0];

        // Create default home
        await pool.query(
            'INSERT INTO homes (user_id, name, address) VALUES ($1, $2, $3)',
            [user.id, 'My Home', 'Not set']
        );

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            },
            token
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/login - User login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Find user
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Cache user data in Redis
        await redisClient.setEx(
            `user:${user.id}`,
            3600,
            JSON.stringify({ id: user.id, email: user.email, name: user.name })
        );

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            },
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/profile - Get user profile (protected)
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        // Try to get from cache first
        const cached = await redisClient.get(`user:${req.user.id}`);

        if (cached) {
            return res.json({ user: JSON.parse(cached), source: 'cache' });
        }

        // If not in cache, get from database
        const result = await pool.query(
            'SELECT id, email, name, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];

        // Cache for future requests
        await redisClient.setEx(
            `user:${user.id}`,
            3600,
            JSON.stringify(user)
        );

        res.json({ user, source: 'database' });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/homes - Get user's homes
app.get('/api/homes', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM homes WHERE user_id = $1',
            [req.user.id]
        );

        res.json({ homes: result.rows });
    } catch (error) {
        console.error('Get homes error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/homes - Create a new home
app.post('/api/homes', authenticateToken, async (req, res) => {
    try {
        const { name, address } = req.body;

        const result = await pool.query(
            'INSERT INTO homes (user_id, name, address) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, name, address || 'Not set']
        );

        res.status(201).json({
            message: 'Home created successfully',
            home: result.rows[0]
        });
    } catch (error) {
        console.error('Create home error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/verify - Verify JWT token
app.post('/api/verify', (req, res) => {
    const token = req.body.token;

    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ valid: false, error: 'Invalid token' });
        }
        res.json({ valid: true, user });
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'user-service' });
});

app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
});