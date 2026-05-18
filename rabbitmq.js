const amqp = require('amqplib');

let channel;

async function connectRabbitMQ() {
  if (channel) {
    return channel;
  }

  const connection = await amqp.connect('amqp://localhost');
  channel = await connection.createChannel();

  console.log('Connected to RabbitMQ');

  return channel;
}

module.exports = connectRabbitMQ;