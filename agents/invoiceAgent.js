const connectRabbitMQ = require('../rabbitmq');
const { execFile } = require('child_process');
const path = require('path');

/**
 * Invoice Agent - ML-Powered Invoice Processing
 * 
 * Predicts: invoiceAmount, paymentStatus, duplicateCheck
 * Falls back to rule-based estimation if ML model fails.
 */

const INFERENCE_SCRIPT = path.join(__dirname, '..', 'invoice_agent_model', 'inference.py');

function runMLPrediction(data) {
  return new Promise((resolve, reject) => {
    const inputJson = JSON.stringify(data);

    execFile('python', [INFERENCE_SCRIPT, inputJson], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('Invoice ML model error:', error.message);
        if (stderr) console.error('stderr:', stderr);
        resolve(fallbackPrediction(data));
        return;
      }

      try {
        const lines = stdout.trim().split('\n');
        let jsonStr = '';
        let braceDepth = 0;
        let capturing = false;

        for (const line of lines) {
          for (const char of line) {
            if (char === '{') { capturing = true; braceDepth++; }
            if (capturing) jsonStr += char;
            if (char === '}') { braceDepth--; if (braceDepth === 0 && capturing) break; }
          }
          if (capturing) jsonStr += '\n';
          if (braceDepth === 0 && capturing) break;
        }

        const result = JSON.parse(jsonStr.trim());
        resolve(result);
      } catch (parseError) {
        console.error('Failed to parse ML output:', parseError.message);
        resolve(fallbackPrediction(data));
      }
    });
  });
}

function fallbackPrediction(data) {
  const revenue = data.revenue || 100000;
  const invoiceAmount = data.invoiceAmount || revenue * 0.1;
  const hasPO = data.hasPurchaseOrder || 0;
  const days = data.daysSinceReceived || 15;

  let paymentStatus = 'approved';
  if (!hasPO && days > 30) paymentStatus = 'pending';
  if (invoiceAmount > revenue * 0.5) paymentStatus = 'rejected';

  const duplicateCheck = (data.amountDeviation !== undefined && Math.abs(data.amountDeviation) < 2);

  return {
    agent: 'invoice',
    status: 'completed',
    processedData: {
      invoiceId: `INV-2026-${Math.floor(Math.random() * 900) + 100}`,
      company: data.companyName || 'Unknown',
      invoiceAmount: Math.round(invoiceAmount * 100) / 100,
      paymentStatus,
      duplicateCheck,
      notes: duplicateCheck
        ? 'Potential duplicate detected (fallback mode).'
        : 'Invoice processed via fallback analysis.'
    }
  };
}

async function startInvoiceAgent() {
  const channel = await connectRabbitMQ();

  await channel.assertQueue('invoice_queue');
  await channel.assertQueue('agent_results_queue');

  console.log('Invoice Agent (ML) is waiting for messages...');

  channel.consume('invoice_queue', async (message) => {
    const request = JSON.parse(message.content.toString());
    console.log('Invoice Agent received:', request);

    const data = request.data;

    await new Promise(resolve => setTimeout(resolve, 1500));

    let prediction;
    try {
      prediction = await runMLPrediction(data);
    } catch (err) {
      console.error('Invoice Agent ML error:', err.message);
      prediction = fallbackPrediction(data);
    }

    const result = {
      taskId: request.taskId,
      ...prediction
    };

    console.log('Invoice Agent result:', result);

    channel.sendToQueue(
      'agent_results_queue',
      Buffer.from(JSON.stringify(result))
    );

    channel.ack(message);
  });
}

startInvoiceAgent();