# API Proxy Server with MongoDB

Node.js API proxy server that forwards requests to JSONPlaceholder API and logs them to MongoDB.

## Run the Solution

```bash
# Start with Docker Compose (MongoDB + API Server)
docker-compose up --build

# The server will be available at:
# http://localhost:3000
```

## Test the Solution

### 1. Check Health Status
```bash
curl http://localhost:3000/health
```

### 2. Test API Proxy
```bash
# Get posts
curl http://localhost:3000/api/posts/1

# Create a post
curl -X POST http://localhost:3000/api/posts \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "body": "Test body", "userId": 1}'
```

### 3. View Request Logs (MongoDB)
```bash
# View all logged requests
curl http://localhost:3000/logs

# Clear logs
curl -X DELETE http://localhost:3000/logs
```

### 4. Web Interface
Open http://localhost:3000 in your browser for interactive testing.

## Environment Variables

The server uses these MongoDB credentials from `docker-compose.yml`:
- `MONGO_USERNAME=root`
- `MONGO_PASSWORD=example`
- `MONGO_DATABASE=node-boilerplate`

All API requests are automatically logged to MongoDB with timestamps, duration, and request/response details.
