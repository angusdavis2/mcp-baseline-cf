#!/usr/bin/env node

import { spawn } from 'child_process';
import axios from 'axios';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_URL = 'http://localhost:8787';

async function runSSETests() {
  console.log('\n============== Testing Cloudflare Worker SSE Transport ==============');

  let serverProcess;
  let sseClient;
  
  try {
    // Start the Cloudflare Worker development server
    console.log('🚀 Starting Cloudflare Worker development server...');
    serverProcess = spawn('npm', ['run', 'dev'], { 
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '..')
    });

    serverProcess.stderr.on('data', (data) => {
      const message = data.toString();
      if (process.argv.includes('--verbose')) {
        console.error(`SERVER STDERR: ${message}`);
      }
    });

    serverProcess.stdout.on('data', (data) => {
      const message = data.toString();
      if (process.argv.includes('--verbose')) {
        console.log(`SERVER STDOUT: ${message}`);
      }
    });

    console.log(`🚀 Server process started (PID: ${serverProcess.pid})`);
    
    // Wait for the server to be ready
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Create SSE client
    sseClient = await createSSEClient();
    
    // Run the same tests as MCP but via SSE transport
    await testSSEInitialization(sseClient);
    await testSSEToolingMetadata(sseClient);
    await testSSELoanTools(sseClient);

    console.log('\n🎉 All SSE tests passed!');

  } catch (error) {
    console.error('\n❌ SSE tests failed:', error.message);
    throw error;
  } finally {
    // Always clean up the SSE client and server process
    if (sseClient && sseClient._sseResponse) {
      console.log('🔌 Closing SSE connection...');
      sseClient._sseResponse.data.destroy(); // Close the connection
    }
    if (serverProcess) {
      console.log('\n🏁 Stopping server...');
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function createSSEClient() {
  console.log('\n----- Creating SSE Client -----');
  
  // Establish SSE connection
  console.log('Establishing SSE connection...');
  const sseResponse = await axios.get(`${SERVER_URL}/sse`, {
    headers: { 
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    },
    responseType: 'stream',
    timeout: 10000
  });

  let sessionEndpoint = null;
  const messageQueue = [];
  const messageHandlers = new Map();
  let requestId = 1;
  let currentEvent = null;
  let currentData = '';
  let buffer = '';
  
  // Set up SSE message handling
  sseResponse.data.on('data', (chunk) => {
    buffer += chunk.toString();
    
    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep the last incomplete line in buffer
    
    for (const line of lines) {
      if (process.argv.includes('--verbose')) {
        console.log(`📥 SSE line: ${line}`);
      }
      
      if (line.startsWith('event: ')) {
        // New event starting
        currentEvent = line.substring(7).trim();
        currentData = '';
      } else if (line.startsWith('data: ')) {
        // Accumulate data for current event
        currentData += line.substring(6);
      } else if (line === '' && currentEvent) {
        // End of SSE message
        if (currentEvent === 'endpoint') {
          sessionEndpoint = currentData.trim();
          console.log(`✅ Got session endpoint: ${sessionEndpoint}`);
        } else if (currentEvent === 'message') {
          try {
            const messageData = JSON.parse(currentData.trim());
            if (process.argv.includes('--verbose')) {
              console.log(`✅ Parsed SSE message:`, messageData);
            }
            if (messageData.id && messageHandlers.has(messageData.id)) {
              const handler = messageHandlers.get(messageData.id);
              messageHandlers.delete(messageData.id);
              if (process.argv.includes('--verbose')) {
                console.log(`🎯 Calling handler for message ID ${messageData.id}`);
              }
              handler(messageData);
            } else {
              if (process.argv.includes('--verbose')) {
                console.log(`📥 Queuing message (no handler found for ID ${messageData.id})`);
              }
              messageQueue.push(messageData);
            }
          } catch (e) {
            if (process.argv.includes('--verbose')) {
              console.log(`⚠️ Could not parse SSE message: ${e.message}`);
              console.log(`⚠️ Message data: ${currentData}`);
            }
          }
        }
        // Reset for next message
        currentEvent = null;
        currentData = '';
      }
    }
  });

  // Wait for session endpoint
  await new Promise((resolve, reject) => {
    const checkEndpoint = () => {
      if (sessionEndpoint) {
        resolve();
      } else {
        setTimeout(checkEndpoint, 100);
      }
    };
    checkEndpoint();
    
    setTimeout(() => {
      if (!sessionEndpoint) {
        reject(new Error('Failed to get session endpoint'));
      }
    }, 5000);
  });

  // Return client interface
  return {
    _sseResponse: sseResponse, // Expose the raw response object for cleanup
    async call(method, params) {
      const id = requestId++;
      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };

      // Register handler before sending request
      const responsePromise = new Promise((resolve, reject) => {
        messageHandlers.set(id, (responseMessage) => {
          if (responseMessage.error) {
            resolve({
              isError: true,
              content: [{ text: responseMessage.error.message || JSON.stringify(responseMessage.error) }]
            });
          } else {
            resolve({
              isError: false,
              content: [{ text: JSON.stringify(responseMessage.result) }]
            });
          }
        });

        // Timeout after 30 seconds
        setTimeout(() => {
          if (messageHandlers.has(id)) {
            messageHandlers.delete(id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });

      // Send message via POST to session endpoint
      const response = await axios.post(`${SERVER_URL}${sessionEndpoint}`, message, {
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        timeout: 30000
      });

      if (response.status !== 202) {
        throw new Error(`Expected 202 Accepted, got ${response.status}`);
      }

      // Wait for response via SSE
      return responsePromise;
    }
  };
}

async function testSSEInitialization(client) {
  console.log('\n----- Testing SSE Initialization -----');
  
  const initResult = await client.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-sse-client',
      version: '1.0.0'
    }
  });
  
  if (initResult.isError) {
    throw new Error(`Initialization failed: ${initResult.content[0].text}`);
  }
  
  console.log('✅ SSE initialization successful');
  
  try {
    const initResponse = JSON.parse(initResult.content[0].text);
    console.log(`📋 Server: ${initResponse.serverInfo?.name || 'Unknown'} v${initResponse.serverInfo?.version || 'Unknown'}`);
    console.log(`🔧 Protocol version: ${initResponse.protocolVersion}`);
  } catch (e) {
    console.log('⚠️ Could not parse initialization response:', e.message);
  }
}

async function testSSEToolingMetadata(client) {
  console.log('\n----- Testing SSE Tooling Metadata -----');
  
  const toolsResult = await client.call('tools/list', {});
  
  if (toolsResult.isError) {
    throw new Error(`Tools list failed: ${toolsResult.content[0].text}`);
  }
  
  console.log('✅ SSE tools list retrieved successfully');
  
  try {
    const toolsData = JSON.parse(toolsResult.content[0].text);
    const tools = toolsData.tools || [];
    console.log(`🔧 Found ${tools.length} tools available`);
    
    const expectedTools = ['getLoan', 'listLoans', 'createLoan', 'getTask', 'listTasks', 'createTask', 'deleteTask'];
    
    for (const expectedTool of expectedTools) {
      const tool = tools.find(t => t.name === expectedTool);
      if (!tool) {
        throw new Error(`Expected tool '${expectedTool}' not found in tools list`);
      }
    }
    console.log('✅ All expected loan origination tools found');
  } catch (e) {
    throw new Error(`Tools metadata parsing failed: ${e.message}`);
  }
}

async function testSSELoanTools(client) {
  console.log('\n----- Testing SSE Loan Tools -----');
  
  // Test the 'listLoans' tool
  console.log('Testing listLoans tool via SSE...');
  const listResult = await client.call('tools/call', { 
    name: 'listLoans', 
    arguments: {} 
  });
  
  let firstLoanId = null;
  
  if (listResult.isError) {
    // This might fail if BASELINE_API_KEY is not configured, which is expected
    console.log('⚠️ listLoans failed (expected if BASELINE_API_KEY not configured):', listResult.content[0].text);
  } else {
    console.log('✅ listLoans tool works correctly via SSE');
    
    try {
      // The content[0].text contains the JSON string directly
      const mcpResponseData = JSON.parse(listResult.content[0].text);
      
      if (process.argv.includes('--verbose')) {
        console.log('📋 Parsed loan data structure:', JSON.stringify(mcpResponseData, null, 2));
      }
      
      // Check if this is an MCP content wrapper or direct loan data
      let actualData;
      if (mcpResponseData.content && mcpResponseData.content[0] && mcpResponseData.content[0].text) {
        // This is an MCP response wrapper, parse the inner text
        actualData = JSON.parse(mcpResponseData.content[0].text);
      } else {
        // This is direct loan data
        actualData = mcpResponseData;
      }
      
      // The actual data should contain the loan data
      let loanCount = 0;
      let loans = [];
      
      if (actualData.totalCount !== undefined) {
        loanCount = actualData.totalCount;
        loans = actualData.loans || [];
      } else if (actualData.loans) {
        loans = actualData.loans;
        loanCount = loans.length;
      } else if (Array.isArray(actualData)) {
        loans = actualData;
        loanCount = loans.length;
      }
      
      console.log(`📊 Found ${loanCount} loans in the system`);
      
      if (loans.length > 0) {
        firstLoanId = loans[0].Id;
        console.log(`🎯 First loan ID: ${firstLoanId}`);
      } else {
        console.log('📭 No loans found in the system');
      }
    } catch (e) {
      console.log('⚠️ Could not parse loans data:', e.message);
      console.log('⚠️ Raw response:', listResult.content[0].text);
    }
  }

  // Test the 'getLoan' tool with the first loan ID if available, otherwise use a test ID
  console.log('Testing getLoan tool via SSE...');
  const loanIdToTest = firstLoanId || '12345';
  const getLoanResult = await client.call('tools/call', { 
    name: 'getLoan', 
    arguments: { loanId: loanIdToTest } 
  });
  
  if (getLoanResult.isError) {
    if (firstLoanId) {
      console.log(`⚠️ getLoan failed for actual loan ID ${firstLoanId}:`, getLoanResult.content[0].text);
    } else {
      console.log('⚠️ getLoan failed for test ID 12345 (expected - loan not found):', getLoanResult.content[0].text);
    }
  } else {
    console.log(`✅ getLoan tool works correctly via SSE for loan ID ${loanIdToTest}`);
    
    try {
      const resultData = JSON.parse(getLoanResult.content[0].text);
      if (resultData.loan && resultData.loan.Name) {
        console.log(`📋 Loan details: ${resultData.loan.Name} (Status: ${resultData.loan.Status || 'Unknown'})`);
      } else if (resultData.Name) {
        console.log(`📋 Loan details: ${resultData.Name} (Status: ${resultData.Status || 'Unknown'})`);
      }
    } catch (e) {
      console.log('⚠️ Could not parse loan details:', e.message);
      console.log('⚠️ Raw response:', getLoanResult.content[0].text);
    }
  }

  // Test the 'listTasks' tool
  console.log('Testing listTasks tool via SSE...');
  const listTasksResult = await client.call('tools/call', { 
    name: 'listTasks', 
    arguments: {} 
  });
  
  if (listTasksResult.isError) {
    // This might fail if BASELINE_API_KEY is not configured, which is expected
    console.log('⚠️ listTasks failed (expected if BASELINE_API_KEY not configured):', listTasksResult.content[0].text);
  } else {
    console.log('✅ listTasks tool works correctly via SSE');
    
    try {
      const mcpResponseData = JSON.parse(listTasksResult.content[0].text);
      
      if (process.argv.includes('--verbose')) {
        console.log('📋 Parsed task data structure:', JSON.stringify(mcpResponseData, null, 2));
      }
      
      // Check if this is an MCP content wrapper or direct task data
      let actualData;
      if (mcpResponseData.content && mcpResponseData.content[0] && mcpResponseData.content[0].text) {
        // This is an MCP response wrapper, parse the inner text
        actualData = JSON.parse(mcpResponseData.content[0].text);
      } else {
        // This is direct task data
        actualData = mcpResponseData;
      }
      
      let taskCount = 0;
      if (actualData.totalCount !== undefined) {
        taskCount = actualData.totalCount;
      } else if (actualData.tasks) {
        taskCount = actualData.tasks.length;
      } else if (Array.isArray(actualData)) {
        taskCount = actualData.length;
      }
      
      console.log(`📊 Found ${taskCount} tasks in the system`);
    } catch (e) {
      console.log('⚠️ Could not parse tasks data:', e.message);
      console.log('⚠️ Raw response:', listTasksResult.content[0].text);
    }
  }

  // Test tool validation - getLoan without required parameter
  console.log('Testing parameter validation via SSE...');
  const validationResult = await client.call('tools/call', { 
    name: 'getLoan', 
    arguments: { loanId: '' } 
  });
  
  if (validationResult.isError && validationResult.content[0].text.includes('non-empty string')) {
    console.log('✅ Parameter validation works correctly via SSE');
  } else {
    console.log('⚠️ Parameter validation test result via SSE:', validationResult.content[0].text);
  }
}

// Run the tests
(async () => {
  try {
    await runSSETests();
  } catch (err) {
    console.error('\n\n🚨 A critical error occurred during the SSE test run:', err);
    process.exit(1);
  }
})(); 