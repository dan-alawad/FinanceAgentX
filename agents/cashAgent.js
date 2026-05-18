const connectRabbitMQ = require('../rabbitmq');
const { execFile } = require('child_process');
const path = require('path');

/**
 * Cash Agent - ML-Powered Financial Analysis
 * 
 * This agent receives company financial data via RabbitMQ,
 * calls the trained Python ML model for predictions, and
 * returns structured results with:
 *   - availableCash (predicted)
 *   - monthlyExpenses (predicted)
 *   - cashFlowStatus (predicted: "stable", "tight", or "critical")
 */

const INFERENCE_SCRIPT = path.join(__dirname, '..', 'cash_agent_model', 'inference.py');


function runMLPrediction(data) {
  return new Promise((resolve, reject) => {
    const inputJson = JSON.stringify(data);

    execFile('python', [INFERENCE_SCRIPT, inputJson], {
      timeout: 30000,   // 30 second timeout
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('ML model error:', error.message);
        if (stderr) console.error('stderr:', stderr);

        resolve(fallbackPrediction(data));
        return;
      }

      try {
        // Extract JSON from stdout (may contain prefix text)
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
        console.error('Raw stdout:', stdout);
        resolve(fallbackPrediction(data));
      }
    });
  });
}


function fallbackPrediction(data) {
  const revenue = data.revenue || 100000;
  const expenses = data.totalExpenses || 60000;
  const prevCash = data.previousCashBalance || 50000;

  const availableCash = Math.round(prevCash + revenue - expenses);
  const monthlyExpenses = Math.round(expenses);

  let cashFlowStatus = "stable";
  const expenseRatio = expenses / (revenue || 1);
  if (expenseRatio > 0.9) cashFlowStatus = "critical";
  else if (expenseRatio > 0.7) cashFlowStatus = "tight";

  return {
    agent: "cash",
    status: "completed",
    processedData: {
      company: data.companyName || "Unknown",
      availableCash: `$${availableCash.toLocaleString()}`,
      monthlyExpenses: `$${monthlyExpenses.toLocaleString()}`,
      cashFlowStatus: cashFlowStatus
    }
  };
}


async function startCashAgent() {

  const channel = await connectRabbitMQ();

  await channel.assertQueue('cash_queue');
  await channel.assertQueue('agent_results_queue');

  console.log('Cash Agent is waiting for messages... (ML-powered)');

  channel.consume('cash_queue', async (message) => {

    const request = JSON.parse(message.content.toString());

    console.log('Cash Agent received:', request);

    const data = request.data;

    const prediction = await runMLPrediction(data);

    const result = {
      taskId: request.taskId,
      agent: prediction.agent || "cash",
      status: prediction.status || "completed",
      processedData: prediction.processedData
    };

    console.log('Cash Agent ML result:', result);

    channel.sendToQueue(
      'agent_results_queue',
      Buffer.from(JSON.stringify(result))
    );

    channel.ack(message);

  });

}

startCashAgent();