#!/usr/bin/env node

import { spawn } from 'child_process';
import axios from 'axios';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_URL = 'http://localhost:8787';

async function runTests() {
  console.log('\n============== Testing Cloudflare Worker MCP Server ==============');

  let serverProcess;
  
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
        // Check if server is ready
        if (message.includes('Listening on http://localhost:8787')) {
          console.log('✅ Server is ready on http://localhost:8787');
        }
      }
    });

    console.log(`🚀 Server process started (PID: ${serverProcess.pid})`);
    
    // Wait for the server to be ready
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Create MCP client
    const client = createMcpClient();

    // Run tests
    await testToolingMetadata(client);
    await testLoanTools(client);

    console.log('\n🎉 All tests passed!');

  } catch (error) {
    console.error('\n❌ Tests failed:', error.message);
    if (error.response) {
      console.error("Response data:", error.response.data);
    }
    throw error;
  } finally {
    // Always clean up the server process
    if (serverProcess) {
      console.log('\n🏁 Stopping server...');
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

function createMcpClient() {
  let requestId = 1;
  let sessionId = null;
  
  const client = axios.create({
    baseURL: SERVER_URL,
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    }
  });

  return {
    call: async (method, params) => {
      const id = requestId++;
      const requestBody = { jsonrpc: "2.0", id, method, params };
      
      if (method === 'initialize' && !sessionId) {
        const initResponse = await client.post('/mcp', requestBody);
        sessionId = initResponse.headers['mcp-session-id'];
        await new Promise(resolve => setTimeout(resolve, 500));
        // For initialize, the response isn't streamed, so we can return directly.
        return initResponse.data;
      }

      // For subsequent calls, handle the SSE stream
      const response = await client.post('/mcp', requestBody, { 
        headers: { 'mcp-session-id': sessionId },
        responseType: 'stream'
      });

      return new Promise((resolve, reject) => {
        let buffer = '';
        response.data.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonData = JSON.parse(line.substring(6));
                if (jsonData.id === id) {
                  if (jsonData.error) {
                    reject(new Error(JSON.stringify(jsonData.error)));
                  } else {
                    resolve(jsonData.result);
                  }
                  return;
                }
              } catch (e) {
                // Ignore lines that aren't valid JSON
              }
            }
          }
        });
        response.data.on('error', (err) => reject(err));
        response.data.on('end', () => {
          // Handle any remaining data in buffer
          if (buffer.startsWith('data: ')) {
            try {
              const jsonData = JSON.parse(buffer.substring(6));
              if (jsonData.id === id) {
                if (jsonData.error) {
                  reject(new Error(JSON.stringify(jsonData.error)));
                } else {
                  resolve(jsonData.result);
                }
                return;
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }
          reject(new Error('Stream ended without receiving expected response'));
        });
      });
    }
  };
}

async function testToolingMetadata(client) {
  console.log('\n----- Testing Tooling Metadata -----');
  
  // Initialize the MCP connection
  const initResult = await client.call('initialize', { 
    protocolVersion: "2024-05-02",
    clientInfo: { name: "cloudflare-mcp-test", version: "1.0.0" },
    capabilities: {} 
  });
  console.log('✅ Initialized MCP connection');
  
  // List available tools
  const listResult = await client.call('tools/list', {});
  const tools = listResult.tools;

  if (!tools) {
    throw new Error(`Could not find tools in response: ${JSON.stringify(listResult)}`);
  }

  console.log(`✅ tools/list returned ${tools.length} tools:`);
  tools.forEach(tool => {
    console.log(`   - ${tool.name}: ${tool.description}`);
  });

  if (tools.length === 0) {
    throw new Error('No tools returned from tools/list');
  }

  // Verify expected tools exist
  const expectedTools = ['getLoan', 'listLoans', 'createLoan', 'getTask', 'listTasks', 'createTask', 'deleteTask'];
  for (const expectedTool of expectedTools) {
    const found = tools.find(tool => tool.name === expectedTool);
    if (!found) {
      throw new Error(`Expected tool '${expectedTool}' not found in tools list`);
    }
  }
  console.log('✅ All expected loan origination tools found');
}

async function testLoanTools(client) {
  console.log('\n----- Testing Loan Tools -----');
  
  // Test the 'listLoans' tool
  console.log('Testing listLoans tool...');
  const listResult = await client.call('tools/call', { 
    name: 'listLoans', 
    arguments: {} 
  });
  
  let firstLoanId = null;
  
  if (listResult.isError) {
    // This might fail if BASELINE_API_KEY is not configured, which is expected
    console.log('⚠️ listLoans failed (expected if BASELINE_API_KEY not configured):', listResult.content[0].text);
  } else {
    console.log('✅ listLoans tool works correctly');
    
    try {
      const loansData = JSON.parse(listResult.content[0].text);
      const loanCount = loansData.totalCount || (loansData.loans ? loansData.loans.length : 0);
      console.log(`📊 Found ${loanCount} loans in the system`);
      
      if (loansData.loans && loansData.loans.length > 0) {
        firstLoanId = loansData.loans[0].Id;
        console.log(`🎯 First loan ID: ${firstLoanId}`);
      } else {
        console.log('📭 No loans found in the system');
      }
    } catch (e) {
      console.log('⚠️ Could not parse loans data:', e.message);
    }
  }

  // Test the 'getLoan' tool with the first loan ID if available, otherwise use a test ID
  console.log('Testing getLoan tool...');
  const loanIdToTest = firstLoanId || '12345';
  const getLoanResult = await client.call('tools/call', { name: 'getLoan', arguments: { loanId: loanIdToTest } });
  
  if (getLoanResult.isError) {
    // This is an unexpected failure. Throw an error to fail the test suite.
    throw new Error(`getLoan failed for loan ID ${loanIdToTest}: ${getLoanResult.content[0].text}`);
  }
  
  console.log(`✅ getLoan tool works correctly for loan ID ${loanIdToTest}`);
  try {
    const loanData = JSON.parse(getLoanResult.content[0].text);
    if (loanData.loan && loanData.loan.Name) {
      console.log(`📋 Loan details: ${loanData.loan.Name} (Status: ${loanData.loan.Status || 'Unknown'})`);
    }
  } catch (e) {
    console.log('⚠️ Could not parse loan details:', e.message);
  }


  // Test the 'listTasks' tool
  console.log('Testing listTasks tool...');
  const listTasksResult = await client.call('tools/call', { 
    name: 'listTasks', 
    arguments: {} 
  });
  
  if (listTasksResult.isError) {
    // This might fail if BASELINE_API_KEY is not configured, which is expected
    console.log('⚠️ listTasks failed (expected if BASELINE_API_KEY not configured):', listTasksResult.content[0].text);
  } else {
    console.log('✅ listTasks tool works correctly');
  }

  // Test tool validation - getLoan without required parameter
  console.log('Testing parameter validation...');
  try {
    await client.call('tools/call', { name: 'getLoan', arguments: {} });
    // If the call succeeds, it's a failure for this test case.
    throw new Error('Parameter validation test failed. The call should have thrown an error but did not.');
  } catch (error) {
    // We expect an error. Now we check if it's the right one.
    if (error.message.includes('-32602') || error.message.includes('invalid_type')) {
      console.log('✅ Parameter validation works correctly');
    } else {
      throw new Error(`Parameter validation test failed with an unexpected error: ${error.message}`);
    }
  }
}



// Run the tests
(async () => {
  try {
    await runTests();
  } catch (err) {
    console.error('\n\n🚨 A critical error occurred during the test run:', err);
    process.exit(1);
  }
})(); 