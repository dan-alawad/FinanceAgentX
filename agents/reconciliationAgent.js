const connectRabbitMQ = require('../rabbitmq');
const { execFile } = require('child_process');
const path = require('path');

/**
 * Reconciliation Agent - ML-Powered Transaction Reconciliation
 * 
 * Predicts: matchedTransactions, unmatchedTransactions, reconciliationStatus
 * Falls back to rule-based estimation if ML model fails.
 */

const INFERENCE_SCRIPT = path.join(__dirname, '..', 'reconciliation_agent_model', 'inference.py');

function runMLPrediction(data) {
  return new Promise((resolve, reject) => {
    const inputJson = JSON.stringify(data);

    execFile('python', [INFERENCE_SCRIPT, inputJson], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('Reconciliation ML model error:', error.message);
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
  const total = data.totalTransactions || 100;
  const matchRate = (data.dataQuality || 80) / 100;
  const matched = Math.round(total * matchRate);
  const unmatched = total - matched;
  const status = matched / total > 0.95 ? 'successful' : (matched / total > 0.80 ? 'partial' : 'failed');

  return {
    agent: 'reconciliation',
    status: 'completed',
    processedData: {
      company: data.companyName || 'Unknown',
      matchedTransactions: matched,
      unmatchedTransactions: unmatched,
      reconciliationStatus: status
    }
  };
}

async function startReconciliationAgent() {
  const channel = await connectRabbitMQ();

  await channel.assertQueue('reconciliation_queue');
  await channel.assertQueue('agent_results_queue');

  console.log('Reconciliation Agent (ML) is waiting for messages...');

  channel.consume('reconciliation_queue', async (message) => {
    const request = JSON.parse(message.content.toString());
    console.log('Reconciliation Agent received:', request);

    const data = request.data;

    await new Promise(resolve => setTimeout(resolve, 2500));

    let prediction;
    try {
      prediction = await runMLPrediction(data);
    } catch (err) {
      console.error('Reconciliation Agent ML error:', err.message);
      prediction = fallbackPrediction(data);
    }

    const result = {
      taskId: request.taskId,
      ...prediction
    };

    console.log('Reconciliation Agent result:', result);

    channel.sendToQueue(
      'agent_results_queue',
      Buffer.from(JSON.stringify(result))
    );

    channel.ack(message);
  });
}

startReconciliationAgent();