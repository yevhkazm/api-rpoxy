const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = 'https://jsonplaceholder.typicode.com/';
const API_KEY = process.env.API_KEY; // Get API key from environment

// MongoDB connection variables
const MONGO_HOST = process.env.MONGODB_HOST || process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGODB_PORT || process.env.MONGO_PORT || '27017';
const MONGO_DATABASE = process.env.MONGODB_DATABASE || process.env.MONGO_DATABASE || 'node-boilerplate';
const MONGO_USERNAME = process.env.MONGODB_USERNAME || process.env.MONGO_USERNAME || '';
const MONGO_PASSWORD = process.env.MONGODB_PASSWORD || process.env.MONGO_PASSWORD || '';
const MONGO_AUTH_SOURCE = process.env.MONGO_AUTH_SOURCE || 'admin';

// Build MongoDB URL
let MONGODB_URL;
if (process.env.MONGODB_URL) {
  MONGODB_URL = process.env.MONGODB_URL;
} else {
  const auth = MONGO_USERNAME && MONGO_PASSWORD ? `${encodeURIComponent(MONGO_USERNAME)}:${encodeURIComponent(MONGO_PASSWORD)}@` : '';
  const authSource = MONGO_USERNAME ? `?authSource=${MONGO_AUTH_SOURCE}` : '';
  MONGODB_URL = `mongodb://${auth}${MONGO_HOST}:${MONGO_PORT}/${MONGO_DATABASE}${authSource}`;
}

// MongoDB Schema for Request Logs
const requestLogSchema = new mongoose.Schema({
  method: String,
  url: String,
  headers: Object,
  body: mongoose.Schema.Types.Mixed,
  response: {
    status: Number,
    data: mongoose.Schema.Types.Mixed
  },
  timestamp: { type: Date, default: Date.now },
  duration: Number,
  authenticated: Boolean,
  apiKey: String
});

const RequestLog = mongoose.model('RequestLog', requestLogSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch((error) => console.error('❌ MongoDB connection error:', error));

// Middleware
app.use(express.json());

// API Key Authentication Middleware
const authenticateAPIKey = (req, res, next) => {
  const providedKey = req.headers['x-api-key'] || req.query.apikey;
  
  if (!API_KEY) {
    // If no API key is configured, allow all requests (dev mode)
    req.authenticated = false;
    req.apiKeyProvided = false;
    return next();
  }
  
  if (!providedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Provide via x-api-key header or apikey query parameter.'
    });
  }
  
  if (providedKey !== API_KEY) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid API key'
    });
  }
  
  req.authenticated = true;
  req.apiKeyProvided = providedKey;
  next();
};

// Request Logging Middleware
const logRequest = async (req, res, next) => {
  const startTime = Date.now();
  
  const originalSend = res.send;
  let responseData = null;
  
  res.send = function(data) {
    responseData = data;
    originalSend.call(this, data);
  };
  
  res.on('finish', async () => {
    try {
      const duration = Date.now() - startTime;
      
      const logEntry = new RequestLog({
        method: req.method,
        url: req.originalUrl,
        headers: req.headers,
        body: req.body,
        response: {
          status: res.statusCode,
          data: responseData
        },
        duration,
        authenticated: req.authenticated || false,
        apiKey: req.apiKeyProvided ? 'provided' : 'none'
      });
      
      await logEntry.save();
      console.log(`📝 ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms) [Auth: ${req.authenticated}]`);
    } catch (error) {
      console.error('❌ Error logging request:', error);
    }
  });
  
  next();
};

// Apply middlewares
app.use(logRequest);

// Public health endpoint (no API key required)
app.get('/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState;
  const statusMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  
  res.json({
    status: 'healthy',
    message: 'API Proxy Server is running',
    proxy_target: API_BASE_URL,
    server: 'Node.js/Express',
    mongodb: {
      status: statusMap[mongoStatus] || 'unknown',
      host: MONGO_HOST,
      port: MONGO_PORT,
      database: MONGO_DATABASE,
      username: MONGO_USERNAME || 'anonymous',
      authenticated: !!(MONGO_USERNAME && MONGO_PASSWORD)
    },
    security: {
      apiKeyRequired: !!API_KEY,
      apiKeyConfigured: !!API_KEY
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Documentation (public)
app.get('/', (req, res) => {
  res.json({
    message: 'API Proxy Server with Authentication',
    version: '1.0.0',
    endpoints: {
      'GET /health': 'Health check (public)',
      'GET /': 'API documentation (public)',
      'GET /logs': 'View request logs (requires API key)',
      'DELETE /logs': 'Clear logs (requires API key)',
      'ALL /api/*': 'Proxy to JSONPlaceholder API (requires API key)'
    },
    authentication: {
      method: 'API Key',
      header: 'x-api-key: YOUR_API_KEY',
      query: '?apikey=YOUR_API_KEY',
      required: !!API_KEY
    }
  });
});

// Protected logs endpoint
app.get('/logs', authenticateAPIKey, async (req, res) => {
  try {
    const { limit = 50, method, status } = req.query;
    
    const filter = {};
    if (method) filter.method = method.toUpperCase();
    if (status) filter['response.status'] = parseInt(status);
    
    const logs = await RequestLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .select('-__v');
    
    res.json({
      total: logs.length,
      authenticated: true,
      logs
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Protected clear logs endpoint
app.delete('/logs', authenticateAPIKey, async (req, res) => {
  try {
    const result = await RequestLog.deleteMany({});
    res.json({
      message: `Deleted ${result.deletedCount} log entries`,
      authenticated: true
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// Protected API proxy endpoints
app.use('/api/*', authenticateAPIKey, async (req, res) => {
  try {
    const targetUrl = API_BASE_URL + req.params[0] + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    
    const config = {
      method: req.method,
      url: targetUrl,
      headers: { ...req.headers },
      timeout: 10000
    };
    
    if (req.body && Object.keys(req.body).length > 0) {
      config.data = req.body;
    }
    
    delete config.headers.host;
    delete config.headers['x-api-key'];
    
    const response = await axios(config);
    res.status(response.status).json(response.data);
    
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ 
        error: 'Proxy Error', 
        message: error.message 
      });
    }
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.originalUrl} not found`,
    available_endpoints: ['GET /', 'GET /health', 'GET /logs', 'DELETE /logs', 'ALL /api/*']
  });
});

app.listen(PORT, () => {
  console.log('🚀 API Proxy Server with Authentication started!');
  console.log(`📡 Proxying requests to: ${API_BASE_URL}`);
  console.log(`🌐 Server running at: http://localhost:${PORT}`);
  console.log(`🔐 API Key Authentication: ${API_KEY ? 'ENABLED' : 'DISABLED'}`);
  console.log(`📖 Visit http://localhost:${PORT} for API documentation`);
});
