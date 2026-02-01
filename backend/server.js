// backend/server.js - ИСПРАВЛЕННЫЙ (с CORS для GitHub Pages)

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ CORS КОНФИГ - ИСПРАВЛЕННЫЙ
app.use(cors({
    origin: [
        'https://albert-tech.github.io',  // GitHub Pages (замени username!)
        'http://localhost:5000',
        'http://localhost:3000',
        'http://127.0.0.1:5000',
        'http://127.0.0.1:3000'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ============ ENDPOINTS ============

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Login endpoint
app.post('/admin/login', async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password required' });
        }

        // Get password hash from environment
        const passwordHash = process.env.ADMIN_PASSWORD_HASH;
        if (!passwordHash) {
            console.error('ADMIN_PASSWORD_HASH not configured');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        // Compare password with bcrypt hash
        const isValid = await bcrypt.compare(password, passwordHash);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // Generate JWT token
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            console.error('JWT_SECRET not configured');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = jwt.sign(
            { role: 'admin' },
            jwtSecret,
            { expiresIn: '1h' }
        );

        res.json({ token });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Middleware: verify JWT token
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid or expired token' });
    }
}

// Get all responses
app.get('/admin/responses', verifyToken, async (req, res) => {
    try {
        const fromDate = req.query.from_date;
        const toDate = req.query.to_date;

        let query = supabase.from('responses').select('*');

        if (fromDate) {
            query = query.gte('created_at', new Date(fromDate).toISOString());
        }
        if (toDate) {
            query = query.lte('created_at', new Date(toDate).toISOString());
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json(data || []);

    } catch (error) {
        console.error('Error fetching responses:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get statistics
app.get('/admin/responses/stats', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('responses')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const total = data.length;
        const bmiValues = data
            .map(row => parseFloat(row.computed?.bmi || 0))
            .filter(bmi => bmi > 0);

        const avgBmi = bmiValues.length > 0
            ? (bmiValues.reduce((a, b) => a + b, 0) / bmiValues.length).toFixed(1)
            : '0';

        const latestResponse = data.length > 0 ? data[0].created_at : null;

        res.json({
            total,
            avg_bmi: avgBmi,
            latest_response: latestResponse
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ START SERVER ============

app.listen(PORT, () => {
    console.log(`Admin backend running on port ${PORT}`);
    console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? '✓' : '✗ NOT SET'}`);
    console.log(`SUPABASE_SERVICE_KEY: ${process.env.SUPABASE_SERVICE_KEY ? '✓' : '✗ NOT SET'}`);
    console.log(`JWT_SECRET: ${process.env.JWT_SECRET ? '✓' : '✗ NOT SET'}`);
    console.log(`ADMIN_PASSWORD_HASH: ${process.env.ADMIN_PASSWORD_HASH ? '✓' : '✗ NOT SET'}`);
    console.log(`CORS origins: ${JSON.stringify(['ALBERT-tech.github.io', 'localhost:5000'])}`);
});
