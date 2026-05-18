const connectRabbitMQ = require('../rabbitmq');
const { execFile } = require('child_process');
const path = require('path');

/**
 * Budget Agent - ML-Powered Budget Analysis
 * 
 * Predicts: totalBudget, remainingBudget, approvedDepartments
 * Falls back to rule-based estimation if ML model fails.
 */

const INFERENCE_SCRIPT = path.join(__dirname, '..', 'budget_agent_model', 'inference.py');

function runMLPrediction(data) {
  return new Promise((resolve, reject) => {
    const inputJson = JSON.stringify(data);

    execFile('python', [INFERENCE_SCRIPT, inputJson], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('Budget ML model error:', error.message);
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
  const totalBudget = Math.round(revenue * 0.35);
  const remainingBudget = Math.round(totalBudget * 0.25);

  return {
    agent: 'budget',
    status: 'completed',
    processedData: {
      company: data.companyName || 'Unknown',
      totalBudget: `$${totalBudget.toLocaleString()}`,
      approvedDepartments: ['Marketing', 'Operations', 'IT'],
      remainingBudget: `$${remainingBudget.toLocaleString()}`
    }
  };
}

async function startBudgetAgent() {
  const channel = await connectRabbitMQ();

  await channel.assertQueue('budget_queue');
  await channel.assertQueue('agent_results_queue');

  console.log('Budget Agent (ML) is waiting for messages...');

  channel.consume('budget_queue', async (message) => {
    const request = JSON.parse(message.content.toString());
    console.log('Budget Agent received:', request);

    const data = request.data;

    await new Promise(resolve => setTimeout(resolve, 2000));

    let prediction;
    try {
      prediction = await runMLPrediction(data);
    } catch (err) {
      console.error('Budget Agent ML error:', err.message);
      prediction = fallbackPrediction(data);
    }

    const result = {
      taskId: request.taskId,
      ...prediction
    };

    console.log('Budget Agent result:', result);

    channel.sendToQueue(
      'agent_results_queue',
      Buffer.from(JSON.stringify(result))
    );

    channel.ack(message);
  });
}

startBudgetAgent();