const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set up cache with 24-hour TTL (time to live)
const cache = new NodeCache({ stdTTL: 86400 });

// Configure CORS to allow requests from your frontend domain
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET']
}));

// Add basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Rate limiting to prevent abuse (100 requests per 15 minutes per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.'
});
app.use(apiLimiter);

// Endpoint to fetch stock data from Yahoo Finance
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { period = '5y', interval = '1d' } = req.query;
    
    // Create cache key
    const cacheKey = `${symbol}_${period}_${interval}`;
    
    // Check cache first
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`Cache hit for ${cacheKey}`);
      return res.json(cachedData);
    }
    
    console.log(`Fetching data for ${symbol} with period ${period} and interval ${interval}`);
    
    // Fetch from Yahoo Finance
    const data = await fetchFromYahoo(symbol, period, interval);
    
    // Store in cache
    cache.set(cacheKey, data);
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching stock data:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch stock data',
      message: error.message
    });
  }
});

// Yahoo Finance data fetcher
async function fetchFromYahoo(symbol, period, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${period}&interval=${interval}&includePrePost=false`;
  
  try {
    console.log(`Calling Yahoo Finance API: ${url}`);
    const response = await axios.get(url);
    const data = response.data;
    
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      throw new Error('No data received from Yahoo Finance');
    }
    
    return processYahooData(data);
  } catch (error) {
    console.error(`Yahoo Finance API error: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}, Data:`, error.response.data);
    }
    throw new Error(`Yahoo Finance API error: ${error.message}`);
  }
}

// Process Yahoo Finance data
function processYahooData(yahooData) {
  const result = yahooData.chart.result[0];
  const quotes = result.indicators.quote[0];
  const timestamps = result.timestamp;
  
  // Create CSV data
  let csvData = [
    ['date', 'open', 'high', 'low', 'close', 'volume']
  ];
  
  for (let i = 0; i < timestamps.length; i++) {
    const date = new Date(timestamps[i] * 1000);
    const dateString = date.toISOString().split('T')[0];
    
    // Skip points with null/undefined values
    if (quotes.open[i] === null || quotes.high[i] === null || 
        quotes.low[i] === null || quotes.close[i] === null) {
      continue;
    }
    
    csvData.push([
      dateString,
      quotes.open[i],
      quotes.high[i],
      quotes.low[i],
      quotes.close[i],
      quotes.volume[i]
    ]);
  }
  
  return csvData;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Stock data service running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log(`Example request: http://localhost:${PORT}/api/stock/AAPL?period=1mo&interval=1d`);
});
