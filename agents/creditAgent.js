const connectRabbitMQ = require('../rabbitmq');
const { execFile } = require('child_process');
const path = require('path');

/**
 * Credit Agent - ML-Powered Credit Assessment
 * 
 * Predicts: creditScore, riskLevel, loanEligibility
 * Falls back to rule-based estimation if ML model fails.
 */

const INFERENCE_SCRIPT = path.join(__dirname, '..', 'credit_agent_model', 'inference.py');

function runMLPrediction(data) {
  return new Promise((resolve, reject) => {
    const inputJson = JSON.stringify(data);

    execFile('python', [INFERENCE_SCRIPT, inputJson], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('Credit ML model error:', error.message);
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
  const debtToEquity = data.debtToEquity || 1.5;
  const latePayments = data.latePayments || 3;
  const paymentHistory = data.paymentHistory || 70;

  let score = 550 + paymentHistory * 1.5 - debtToEquity * 25 - latePayments * 15;
  score = Math.max(300, Math.min(850, Math.round(score)));

  let riskLevel = 'moderate';
  if (score >= 700 && debtToEquity < 1.5) riskLevel = 'low';
  else if (score < 550 || debtToEquity > 3.5) riskLevel = 'high';

  let loanEligibility = 'review';
  if (riskLevel === 'low' && score >= 680) loanEligibility = 'approved';
  else if (riskLevel === 'high' || score < 500) loanEligibility = 'denied';

  return {
    agent: 'credit',
    status: 'completed',
    processedData: {
      company: data.companyName || 'Unknown',
      creditScore: score,
      riskLevel,
      loanEligibility
    }
  };
}

async function startCreditAgent() {
  const channel = await connectRabbitMQ();

  await channel.assertQueue('credit_queue');
  await channel.assertQueue('agent_results_queue');

  console.log('Credit Agent (ML) is waiting for messages...');

  channel.consume('credit_queue', async (message) => {
    const request = JSON.parse(message.content.toString());
    console.log('Credit Agent received:', request);

    const data = request.data;

    await new Promise(resolve => setTimeout(resolve, 2000));

    let prediction;
    try {
      prediction = await runMLPrediction(data);
    } catch (err) {
      console.error('Credit Agent ML error:', err.message);
      prediction = fallbackPrediction(data);
    }

    const result = {
      taskId: request.taskId,
      ...prediction
    };

    console.log('Credit Agent result:', result);

    channel.sendToQueue(
      'agent_results_queue',
      Buffer.from(JSON.stringify(result))
    );

    channel.ack(message);
  });
}

startCreditAgent();