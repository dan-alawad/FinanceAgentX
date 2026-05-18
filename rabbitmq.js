const amqp = require('amqplib');

let connection = null;
let channel = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const RECONNECT_DELAY = 5000; // 5 seconds

async function connectRabbitMQ() {
  if (channel) {
    return channel;
  }

  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();

  console.log(`Connected to RabbitMQ at ${RABBITMQ_URL}`);

  // Handle connection errors and auto-reconnect
  connection.on('error', (err) => {
    console.error('RabbitMQ connection error:', err.message);
    channel = null;
    connection = null;
  });

  connection.on('close', () => {
    console.warn('RabbitMQ connection closed. Reconnecting in', RECONNECT_DELAY / 1000, 'seconds...');
    channel = null;
    connection = null;
    setTimeout(() => {
      connectRabbitMQ().catch((err) => {
        console.error('RabbitMQ reconnection failed:', err.message);
      });
    }, RECONNECT_DELAY);
  });

  return channel;
}

module.exports = connectRabbitMQ;