#!/usr/bin/env node

/**
 * Password Rotation Script for API Proxy
 * This script rotates MongoDB and API key passwords/secrets
 */

const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// Configuration
const CONFIG = {
  mongodb: {
    host: process.env.MONGODB_HOST || 'mongodb',
    port: process.env.MONGODB_PORT || '27017',
    database: process.env.MONGODB_DATABASE || 'api-proxy',
    currentUsername: process.env.MONGODB_USERNAME || 'root',
    currentPassword: process.env.MONGODB_PASSWORD || 'example'
  },
  rotation: {
    passwordLength: 16,
    includeSymbols: true,
    dryRun: process.env.DRY_RUN === 'true'
  }
};

class PasswordRotator {
  constructor() {
    this.logPrefix = '[PASSWORD-ROTATION]';
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${this.logPrefix} [${level}] ${message}`);
  }

  /**
   * Generate a secure random password
   */
  generatePassword(length = 16, includeSymbols = true) {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = includeSymbols ? '!@#$%^&*()_+-=[]{}|;:,.<>?' : '';
    
    const charset = lowercase + uppercase + numbers + symbols;
    let password = '';
    
    // Ensure at least one character from each category
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    if (includeSymbols) {
      password += symbols[Math.floor(Math.random() * symbols.length)];
    }
    
    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => 0.5 - Math.random()).join('');
  }

  /**
   * Generate a secure API key
   */
  generateApiKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Build MongoDB connection URL
   */
  buildMongoUrl(username, password) {
    const { host, port, database } = CONFIG.mongodb;
    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    return `mongodb://${encodedUsername}:${encodedPassword}@${host}:${port}/${database}?authSource=admin`;
  }

  /**
   * Test MongoDB connection
   */
  async testMongoConnection(username, password) {
    const url = this.buildMongoUrl(username, password);
    const client = new MongoClient(url);
    
    try {
      await client.connect();
      await client.db().admin().ping();
      this.log(`MongoDB connection test successful for user: ${username}`);
      return true;
    } catch (error) {
      this.log(`MongoDB connection test failed for user: ${username} - ${error.message}`, 'ERROR');
      return false;
    } finally {
      await client.close();
    }
  }

  /**
   * Update MongoDB user password
   */
  async updateMongoPassword(currentUsername, currentPassword, newPassword) {
    const url = this.buildMongoUrl(currentUsername, currentPassword);
    const client = new MongoClient(url);
    
    try {
      await client.connect();
      const adminDb = client.db().admin();
      
      // Update the user password
      await adminDb.command({
        updateUser: currentUsername,
        pwd: newPassword,
        roles: [
          { role: 'root', db: 'admin' }
        ]
      });
      
      this.log(`Successfully updated MongoDB password for user: ${currentUsername}`);
      return true;
    } catch (error) {
      this.log(`Failed to update MongoDB password: ${error.message}`, 'ERROR');
      return false;
    } finally {
      await client.close();
    }
  }

  /**
   * Base64 encode for Kubernetes secrets
   */
  base64Encode(str) {
    return Buffer.from(str).toString('base64');
  }

  /**
   * Generate Kubernetes secret YAML
   */
  generateSecretYaml(mongoPassword, apiKey) {
    const mongoPasswordB64 = this.base64Encode(mongoPassword);
    const mongoUsernameB64 = this.base64Encode(CONFIG.mongodb.currentUsername);
    const apiKeyB64 = this.base64Encode(apiKey);
    
    return `apiVersion: v1
kind: Secret
metadata:
  name: mongodb-secret
  namespace: api-proxy
type: Opaque
data:
  MONGO_PASSWORD: ${mongoPasswordB64}
  MONGO_USERNAME: ${mongoUsernameB64}

---
apiVersion: v1
kind: Secret
metadata:
  name: api-secret
  namespace: api-proxy
type: Opaque
data:
  API_KEY: ${apiKeyB64}`;
  }

  /**
   * Log rotation event to MongoDB
   */
  async logRotationEvent(eventType, details) {
    const url = this.buildMongoUrl(CONFIG.mongodb.currentUsername, CONFIG.mongodb.currentPassword);
    const client = new MongoClient(url);
    
    try {
      await client.connect();
      const db = client.db(CONFIG.mongodb.database);
      const collection = db.collection('password_rotation_logs');
      
      const logEntry = {
        timestamp: new Date(),
        eventType,
        details,
        dryRun: CONFIG.rotation.dryRun,
        rotationId: crypto.randomUUID()
      };
      
      await collection.insertOne(logEntry);
      this.log(`Logged rotation event: ${eventType}`);
    } catch (error) {
      this.log(`Failed to log rotation event: ${error.message}`, 'ERROR');
    } finally {
      await client.close();
    }
  }

  /**
   * Main rotation process
   */
  async rotatePasswords() {
    this.log('Starting password rotation process...');
    
    try {
      // Generate new passwords
      const newMongoPassword = this.generatePassword(CONFIG.rotation.passwordLength, CONFIG.rotation.includeSymbols);
      const newApiKey = this.generateApiKey();
      
      this.log(`Generated new MongoDB password (${newMongoPassword.length} chars)`);
      this.log(`Generated new API key (${newApiKey.length} chars)`);
      
      // Test current connection
      const currentConnectionOk = await this.testMongoConnection(
        CONFIG.mongodb.currentUsername, 
        CONFIG.mongodb.currentPassword
      );
      
      if (!currentConnectionOk) {
        throw new Error('Cannot connect to MongoDB with current credentials');
      }
      
      if (CONFIG.rotation.dryRun) {
        this.log('DRY RUN MODE - No actual changes will be made', 'WARN');
        
        // Generate and display what would be created
        const secretYaml = this.generateSecretYaml(newMongoPassword, newApiKey);
        console.log('\n--- NEW SECRETS (DRY RUN) ---');
        console.log(secretYaml);
        console.log('--- END SECRETS ---\n');
        
        await this.logRotationEvent('dry_run_completed', {
          mongoPasswordLength: newMongoPassword.length,
          apiKeyLength: newApiKey.length
        });
        
        this.log('Dry run completed successfully');
        return;
      }
      
      // Update MongoDB password
      const mongoUpdateSuccess = await this.updateMongoPassword(
        CONFIG.mongodb.currentUsername,
        CONFIG.mongodb.currentPassword,
        newMongoPassword
      );
      
      if (!mongoUpdateSuccess) {
        throw new Error('Failed to update MongoDB password');
      }
      
      // Test new MongoDB connection
      const newConnectionOk = await this.testMongoConnection(
        CONFIG.mongodb.currentUsername,
        newMongoPassword
      );
      
      if (!newConnectionOk) {
        throw new Error('New MongoDB password connection test failed');
      }
      
      // Generate new Kubernetes secrets YAML
      const secretYaml = this.generateSecretYaml(newMongoPassword, newApiKey);
      
      console.log('\n--- NEW SECRETS ---');
      console.log(secretYaml);
      console.log('--- END SECRETS ---');
      
      // Log successful rotation
      await this.logRotationEvent('rotation_completed', {
        mongoPasswordRotated: true,
        apiKeyRotated: true,
        timestamp: new Date().toISOString()
      });
      
      this.log('Password rotation completed successfully!');
      this.log('Apply the new secrets with: kubectl apply -f <secrets-file>');
      this.log('Then restart deployments: kubectl rollout restart deployment/api-proxy deployment/mongodb -n api-proxy');
      
    } catch (error) {
      this.log(`Password rotation failed: ${error.message}`, 'ERROR');
      
      await this.logRotationEvent('rotation_failed', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const rotator = new PasswordRotator();
  
  // Check if running in dry run mode
  if (process.env.DRY_RUN === 'true') {
    rotator.log('Running in DRY RUN mode - no changes will be made', 'WARN');
  }
  
  await rotator.rotatePasswords();
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[PASSWORD-ROTATION] [FATAL] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[PASSWORD-ROTATION] [FATAL] Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('[PASSWORD-ROTATION] [FATAL] Main execution failed:', error);
    process.exit(1);
  });
}

module.exports = { PasswordRotator };
