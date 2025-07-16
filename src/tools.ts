import { z } from "zod";

// OpenAPI Specification: https://baselinesoftware.readme.io/openapi/64b6cee86ee24f0055b2c69a

/* 1️⃣  Baseline REST client */
let BASELINE_API_KEY = typeof process !== 'undefined' && process.env && process.env.BASELINE_API_KEY ? process.env.BASELINE_API_KEY : "";
let BASELINE_API_URL = process.env.BASELINE_API_URL || "https://production.baselinesoftware.com/production/api";

export function setBaselineApiKey(key: string | undefined) {
  if (key) BASELINE_API_KEY = key;
}

export function setBaselineApiUrl(url: string) {
  BASELINE_API_URL = url;
}

// Create fetch-based instance dynamically at runtime
function createBaselineClient() {
  const makeRequest = async (method: string, path: string, body?: any) => {
    if (!BASELINE_API_KEY) {
      throw new Error("BASELINE_API_KEY is not configured. Please set it via environment variables or the 'setBaselineApiKey' function.");
    }
    
    // Handle AWS Secrets Manager JSON format for the API key
    let apiKey = BASELINE_API_KEY;
    try {
      const parsed = JSON.parse(BASELINE_API_KEY);
      if (parsed && typeof parsed === 'object') {
        if (parsed.BASELINE_API_KEY) apiKey = parsed.BASELINE_API_KEY;
        else if (parsed.apiKey) apiKey = parsed.apiKey;
        else if (parsed.key) apiKey = parsed.key;
        else if (parsed.value) apiKey = parsed.value;
        else if (parsed.secret) apiKey = parsed.secret;
        else {
          const values = Object.values(parsed);
          const stringValues = values.filter(v => typeof v === 'string');
          if (stringValues.length > 0) apiKey = stringValues[0];
        }
      }
    } catch (e) {
      // Not JSON, use as-is
    }
    
    const headers = {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const config: RequestInit = {
      method,
      headers,
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASELINE_API_URL}${path}`, config);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - Body: ${errorBody}`);
    }

    // Handle cases where response might have no content (e.g., 204)
    const responseText = await response.text();
    const data = responseText ? JSON.parse(responseText) : {};
    
    return { data };
  };

  return {
    get: (path: string) => makeRequest('GET', path),
    post: (path: string, data: any) => makeRequest('POST', path, data),
    patch: (path: string, data: any) => makeRequest('PATCH', path, data),
    put: (path: string, data: any) => makeRequest('PUT', path, data),
    delete: (path: string) => makeRequest('DELETE', path),
  };
}

/* 2️⃣  Type Definitions */

// Interface definitions
export interface LoanUpdateData {
  [key: string]: any; // Accept any field the API supports
}

export interface TaskCreateData {
  Name: string; // Required field per API spec
  Description?: string;
  Date_Due?: string; // API uses Date_Due, not dueDate
  Status?: string; // API: "To Do" | "In Progress" | "Done" | "Not Required"
  Loan_Id?: string; // API uses Loan_Id, not loanId
  [key: string]: any; // Allow additional fields
}

export interface TaskUpdateData {
  Name?: string;
  Description?: string;
  Date_Due?: string;
  Status?: string;
  Loan_Id?: string;
  [key: string]: any; // Allow additional fields
}





// Schema utility is no longer needed - we use direct JSON Schema format

// Input validation helper
export function validateRequiredArgs(args: any, requiredFields: string[]): void {
  for (const field of requiredFields) {
    if (!args || args[field] === undefined || args[field] === null) {
      throw new Error(`Missing required argument: ${field}`);
    }
  }
}

// Input sanitization helper
export function sanitizeString(input: any): string {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }
  // Remove potentially dangerous characters and limit length
  return input.trim().replace(/[<>\"'&]/g, '').substring(0, 1000);
}

export function sanitizeObject(input: any): any {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Input must be an object');
  }
  
  const sanitizeValue = (obj: any): any => {
    if (typeof obj === 'string') {
      return sanitizeString(obj);
    } else if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        return obj.map(sanitizeValue);
      } else {
        const sanitized: any = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitizeValue(value);
        }
        return sanitized;
      }
    }
    return obj;
  };
  
  return sanitizeValue(input);
}

// Schema utility - converts Zod schemas to JSON Schema format
export function convertZodSchemaToJsonSchema(inputSchema: any): any {
  if (!inputSchema || !inputSchema._def) {
    return {
      type: "object",
      properties: {},
      required: []
    };
  }

  // Handle ZodObject schema
  if (inputSchema._def.typeName === 'ZodObject') {
    const jsonSchema: any = {
      type: "object",
      properties: {},
      required: []
    };

    const shape = inputSchema._def.shape();
    for (const [key, schema] of Object.entries(shape)) {
      if (schema && typeof schema === 'object' && '_def' in schema) {
        const zodSchema = schema as any;
        const description = zodSchema._def?.description || key;
        
        if (zodSchema._def?.typeName === 'ZodString') {
          jsonSchema.properties[key] = {
            type: "string",
            description: description
          };
          jsonSchema.required.push(key);
        } else if (zodSchema._def?.typeName === 'ZodNumber') {
          jsonSchema.properties[key] = {
            type: "number",
            description: description
          };
          jsonSchema.required.push(key);
        } else if (zodSchema._def?.typeName === 'ZodBoolean') {
          jsonSchema.properties[key] = {
            type: "boolean",
            description: description
          };
          jsonSchema.required.push(key);
        } else if (zodSchema._def?.typeName === 'ZodOptional') {
          // Handle optional fields
          const innerSchema = zodSchema._def.innerType;
          if (innerSchema._def?.typeName === 'ZodString') {
            jsonSchema.properties[key] = {
              type: "string",
              description: description
            };
          } else if (innerSchema._def?.typeName === 'ZodNumber') {
            jsonSchema.properties[key] = {
              type: "number",
              description: description
            };
          } else if (innerSchema._def?.typeName === 'ZodBoolean') {
            jsonSchema.properties[key] = {
              type: "boolean",
              description: description
            };
          } else if (innerSchema._def?.typeName === 'ZodObject') {
            jsonSchema.properties[key] = {
              type: "object",
              description: description
            };
          }
        } else if (zodSchema._def?.typeName === 'ZodObject') {
          jsonSchema.properties[key] = {
            type: "object",
            description: description
          };
          jsonSchema.required.push(key);
        }
      }
    }

    return jsonSchema;
  }

  // Fallback for other schema types
  return {
    type: "object",
    properties: {},
    required: []
  };
}

/* 4️⃣  Tool Handlers */

export const toolHandlers = {
  async getLoan(args: any) {
    try {
      validateRequiredArgs(args, ['loanId']);
      const { loanId } = args;
      
      if (typeof loanId !== 'string' || !loanId.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: loanId must be a non-empty string"
            }
          ],
          isError: true
        };
      }

      const sanitizedLoanId = sanitizeString(loanId);
      const response = await createBaselineClient().get(`/loan/${sanitizedLoanId}`);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving loan: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  },

  async listLoans(args: any) {
      try {
        // Call Baseline API Get all loans endpoint - no parameters
        const response = await createBaselineClient().get("/loan");
        const loans = response.data.loans || response.data;
        
        const result = {
          loans: loans,
          totalCount: loans.length
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: false
        };
      } catch (error: any) {
        console.error(`❌ listLoans tool error:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error listing loans: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          ],
          isError: true
        };
      }
  },

  async updateLoan(args: any) {
    try {
      validateRequiredArgs(args, ['loanId', 'updates']);
      const { loanId, updates } = args;
      
      if (typeof loanId !== 'string' || !loanId.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: loanId must be a non-empty string"
            }
          ],
          isError: true
        };
      }
      
      if (typeof updates !== 'object' || updates === null) {
        return {
          content: [
            {
              type: "text",
              text: "Error: updates must be an object"
            }
          ],
          isError: true
        };
      }

      const sanitizedLoanId = sanitizeString(loanId);
      const sanitizedUpdates = sanitizeObject(updates);
      
      const response = await createBaselineClient().patch(`/loan/${sanitizedLoanId}`, sanitizedUpdates);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error updating loan: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  },

  async createLoan(args: any) {
    try {
      validateRequiredArgs(args, ['loanData']);
      const { loanData } = args;
      
      if (typeof loanData !== 'object' || loanData === null) {
        return {
          content: [
            {
              type: "text",
              text: "Error: loanData must be an object"
            }
          ],
          isError: true
        };
      }

      const sanitizedLoanData = sanitizeObject(loanData);
      
      const response = await createBaselineClient().post("/loan", sanitizedLoanData);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating loan: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  },

  async getLoanLedger(args: any) {
    try {
      validateRequiredArgs(args, ['loanId']);
      const { loanId } = args;
      
      if (typeof loanId !== 'string' || !loanId.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: loanId must be a non-empty string"
            }
          ],
          isError: true
        };
      }

      const sanitizedLoanId = sanitizeString(loanId);
      const response = await createBaselineClient().get(`/loan/${sanitizedLoanId}/transaction`);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving loan ledger: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  },

  // Task-related handlers
  async getTask(args: any) {
    try {
      validateRequiredArgs(args, ['taskId']);
      const { taskId } = args;
      
      if (typeof taskId !== 'string' || !taskId.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: taskId must be a non-empty string"
            }
          ],
          isError: true
        };
      }

      const sanitizedTaskId = sanitizeString(taskId);
      const response = await createBaselineClient().get(`/task/${sanitizedTaskId}`);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving task: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  },

  async listTasks(args: any) {
    try {
      const { page } = args || {};
      
      let url = "/task";
      const params = new URLSearchParams();
      
      if (page) {
        if (typeof page !== 'number' || page < 0) {
          return {
            content: [
              {
                type: "text",
                text: "Error: page must be a non-negative number"
              }
            ],
            isError: true
          };
        }
        params.append('page', page.toString());
      }
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await createBaselineClient().get(url);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  },

  async createTask(args: any) {
    try {
      validateRequiredArgs(args, ['Name']);
      const sanitizedTaskData = sanitizeObject(args);
      const response = await createBaselineClient().post('/task', sanitizedTaskData);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating task: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
},

  async updateTask(args: any) {
    try {
      validateRequiredArgs(args, ['taskId', 'updates']);
      const { taskId, updates } = args;
      
      if (typeof taskId !== 'string' || !taskId.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: taskId must be a non-empty string"
            }
          ],
          isError: true
        };
      }

      if (!updates || typeof updates !== 'object') {
        return {
          content: [
            {
              type: "text",
              text: "Error: updates must be an object"
            }
          ],
          isError: true
        };
      }

      const sanitizedTaskId = sanitizeString(taskId);
      const sanitizedUpdates = sanitizeObject(updates);
      
      const response = await createBaselineClient().patch(`/task/${sanitizedTaskId}`, sanitizedUpdates);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error updating task: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  },

  async deleteTask(args: any) {
    try {
      validateRequiredArgs(args, ['taskId']);
      const { taskId } = args;
      
      if (typeof taskId !== 'string' || !taskId.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: taskId must be a non-empty string"
            }
          ],
          isError: true
        };
      }

      const sanitizedTaskId = sanitizeString(taskId);
      const response = await createBaselineClient().delete(`/task/${sanitizedTaskId}`);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting task: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  },

  // Borrower-related handlers
  async createBorrower(args: any) {
    try {
      validateRequiredArgs(args, ['borrowerData']);
      const { borrowerData } = args;

      if (!borrowerData || typeof borrowerData !== 'object') {
        return {
          content: [{ type: "text", text: "Error: borrowerData must be an object" }],
          isError: true
        };
      }

      const sanitizedBorrowerData = sanitizeObject(borrowerData);
      const response = await createBaselineClient().post('/borrower', sanitizedBorrowerData);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error creating borrower: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async listBorrowers(args: any) {
    try {
      const { page } = args || {};
      const params = new URLSearchParams();
      if (page) {
        params.append('page', page.toString());
      }

      let url = "/borrower";
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await createBaselineClient().get(url);
      
      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error listing borrowers: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async getBorrower(args: any) {
    try {
      validateRequiredArgs(args, ['borrowerId']);
      const { borrowerId } = args;

      if (typeof borrowerId !== 'string' || !borrowerId.trim()) {
        return {
          content: [{ type: "text", text: "Error: borrowerId must be a non-empty string" }],
          isError: true
        };
      }

      const sanitizedBorrowerId = sanitizeString(borrowerId);
      const response = await createBaselineClient().get(`/borrower/${sanitizedBorrowerId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error retrieving borrower: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async updateBorrower(args: any) {
    try {
      validateRequiredArgs(args, ['borrowerId', 'updates']);
      const { borrowerId, updates } = args;

      if (typeof borrowerId !== 'string' || !borrowerId.trim()) {
        return {
          content: [{ type: "text", text: "Error: borrowerId must be a non-empty string" }],
          isError: true
        };
      }

      if (!updates || typeof updates !== 'object') {
        return {
          content: [{ type: "text", text: "Error: updates must be an object" }],
          isError: true
        };
      }

      const sanitizedBorrowerId = sanitizeString(borrowerId);
      const sanitizedUpdates = sanitizeObject(updates);
      const response = await createBaselineClient().patch(`/borrower/${sanitizedBorrowerId}`, sanitizedUpdates);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error updating borrower: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async deleteBorrower(args: any) {
    try {
      validateRequiredArgs(args, ['borrowerId']);
      const { borrowerId } = args;

      if (typeof borrowerId !== 'string' || !borrowerId.trim()) {
        return {
          content: [{ type: "text", text: "Error: borrowerId must be a non-empty string" }],
          isError: true
        };
      }

      const sanitizedBorrowerId = sanitizeString(borrowerId);
      const response = await createBaselineClient().delete(`/borrower/${sanitizedBorrowerId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error deleting borrower: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async connectBorrowers(args: any) {
    try {
      validateRequiredArgs(args, ['borrowerId', 'connectToBorrowerId']);
      const { borrowerId, connectToBorrowerId } = args;

      if (typeof borrowerId !== 'string' || !borrowerId.trim() || typeof connectToBorrowerId !== 'string' || !connectToBorrowerId.trim()) {
        return {
          content: [{ type: "text", text: "Error: borrowerId and connectToBorrowerId must be non-empty strings" }],
          isError: true
        };
      }

      const sanitizedBorrowerId = sanitizeString(borrowerId);
      const sanitizedConnectToBorrowerId = sanitizeString(connectToBorrowerId);
      const response = await createBaselineClient().put(`/borrower/${sanitizedBorrowerId}/connect/${sanitizedConnectToBorrowerId}`, {});

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error connecting borrowers: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async disconnectBorrowers(args: any) {
    try {
      validateRequiredArgs(args, ['borrowerId', 'disconnectFromBorrowerId']);
      const { borrowerId, disconnectFromBorrowerId } = args;

      if (typeof borrowerId !== 'string' || !borrowerId.trim() || typeof disconnectFromBorrowerId !== 'string' || !disconnectFromBorrowerId.trim()) {
        return {
          content: [{ type: "text", text: "Error: borrowerId and disconnectFromBorrowerId must be non-empty strings" }],
          isError: true
        };
      }

      const sanitizedBorrowerId = sanitizeString(borrowerId);
      const sanitizedDisconnectFromBorrowerId = sanitizeString(disconnectFromBorrowerId);
      const response = await createBaselineClient().delete(`/borrower/${sanitizedBorrowerId}/connect/${sanitizedDisconnectFromBorrowerId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error disconnecting borrowers: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  // Vendor-related handlers
  async createVendor(args: any) {
    try {
      validateRequiredArgs(args, ['vendorData']);
      const { vendorData } = args;

      if (!vendorData || typeof vendorData !== 'object') {
        return {
          content: [{ type: "text", text: "Error: vendorData must be an object" }],
          isError: true
        };
      }

      const sanitizedVendorData = sanitizeObject(vendorData);
      const response = await createBaselineClient().post('/vendor', sanitizedVendorData);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error creating vendor: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async listVendors(args: any) {
    try {
      const { page } = args || {};
      const params = new URLSearchParams();
      if (page) {
        params.append('page', page.toString());
      }

      let url = "/vendor";
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await createBaselineClient().get(url);
      
      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error listing vendors: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async getVendor(args: any) {
    try {
      validateRequiredArgs(args, ['vendorId']);
      const { vendorId } = args;

      if (typeof vendorId !== 'string' || !vendorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: vendorId must be a non-empty string" }],
          isError: true
        };
      }

      const sanitizedVendorId = sanitizeString(vendorId);
      const response = await createBaselineClient().get(`/vendor/${sanitizedVendorId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error retrieving vendor: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async updateVendor(args: any) {
    try {
      validateRequiredArgs(args, ['vendorId', 'updates']);
      const { vendorId, updates } = args;

      if (typeof vendorId !== 'string' || !vendorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: vendorId must be a non-empty string" }],
          isError: true
        };
      }

      if (!updates || typeof updates !== 'object') {
        return {
          content: [{ type: "text", text: "Error: updates must be an object" }],
          isError: true
        };
      }

      const sanitizedVendorId = sanitizeString(vendorId);
      const sanitizedUpdates = sanitizeObject(updates);
      const response = await createBaselineClient().patch(`/vendor/${sanitizedVendorId}`, sanitizedUpdates);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error updating vendor: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async deleteVendor(args: any) {
    try {
      validateRequiredArgs(args, ['vendorId']);
      const { vendorId } = args;

      if (typeof vendorId !== 'string' || !vendorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: vendorId must be a non-empty string" }],
          isError: true
        };
      }

      const sanitizedVendorId = sanitizeString(vendorId);
      const response = await createBaselineClient().delete(`/vendor/${sanitizedVendorId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error deleting vendor: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async connectVendors(args: any) {
    try {
      validateRequiredArgs(args, ['vendorId', 'connectToVendorId']);
      const { vendorId, connectToVendorId } = args;

      if (typeof vendorId !== 'string' || !vendorId.trim() || typeof connectToVendorId !== 'string' || !connectToVendorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: vendorId and connectToVendorId must be non-empty strings" }],
          isError: true
        };
      }

      const sanitizedVendorId = sanitizeString(vendorId);
      const sanitizedConnectToVendorId = sanitizeString(connectToVendorId);
      const response = await createBaselineClient().put(`/vendor/${sanitizedVendorId}/connect/${sanitizedConnectToVendorId}`, {});

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error connecting vendors: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async disconnectVendors(args: any) {
    try {
      validateRequiredArgs(args, ['vendorId', 'disconnectFromVendorId']);
      const { vendorId, disconnectFromVendorId } = args;

      if (typeof vendorId !== 'string' || !vendorId.trim() || typeof disconnectFromVendorId !== 'string' || !disconnectFromVendorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: vendorId and disconnectFromVendorId must be non-empty strings" }],
          isError: true
        };
      }

      const sanitizedVendorId = sanitizeString(vendorId);
      const sanitizedDisconnectFromVendorId = sanitizeString(disconnectFromVendorId);
      const response = await createBaselineClient().delete(`/vendor/${sanitizedVendorId}/connect/${sanitizedDisconnectFromVendorId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error disconnecting vendors: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  // Investor-related handlers
  async createInvestor(args: any) {
    try {
      validateRequiredArgs(args, ['investorData']);
      const { investorData } = args;

      if (!investorData || typeof investorData !== 'object') {
        return {
          content: [{ type: "text", text: "Error: investorData must be an object" }],
          isError: true
        };
      }

      const sanitizedInvestorData = sanitizeObject(investorData);
      const response = await createBaselineClient().post('/investor', sanitizedInvestorData);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error creating investor: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async listInvestors(args: any) {
    try {
      const { page } = args || {};
      const params = new URLSearchParams();
      if (page) {
        params.append('page', page.toString());
      }

      let url = "/investor";
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await createBaselineClient().get(url);
      
      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error listing investors: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async getInvestor(args: any) {
    try {
      validateRequiredArgs(args, ['investorId']);
      const { investorId } = args;

      if (typeof investorId !== 'string' || !investorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: investorId must be a non-empty string" }],
          isError: true
        };
      }

      const sanitizedInvestorId = sanitizeString(investorId);
      const response = await createBaselineClient().get(`/investor/${sanitizedInvestorId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error retrieving investor: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async updateInvestor(args: any) {
    try {
      validateRequiredArgs(args, ['investorId', 'updates']);
      const { investorId, updates } = args;

      if (typeof investorId !== 'string' || !investorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: investorId must be a non-empty string" }],
          isError: true
        };
      }

      if (!updates || typeof updates !== 'object') {
        return {
          content: [{ type: "text", text: "Error: updates must be an object" }],
          isError: true
        };
      }

      const sanitizedInvestorId = sanitizeString(investorId);
      const sanitizedUpdates = sanitizeObject(updates);
      const response = await createBaselineClient().patch(`/investor/${sanitizedInvestorId}`, sanitizedUpdates);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error updating investor: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async deleteInvestor(args: any) {
    try {
      validateRequiredArgs(args, ['investorId']);
      const { investorId } = args;

      if (typeof investorId !== 'string' || !investorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: investorId must be a non-empty string" }],
          isError: true
        };
      }

      const sanitizedInvestorId = sanitizeString(investorId);
      const response = await createBaselineClient().delete(`/investor/${sanitizedInvestorId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error deleting investor: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async connectInvestors(args: any) {
    try {
      validateRequiredArgs(args, ['investorId', 'connectToInvestorId']);
      const { investorId, connectToInvestorId } = args;

      if (typeof investorId !== 'string' || !investorId.trim() || typeof connectToInvestorId !== 'string' || !connectToInvestorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: investorId and connectToInvestorId must be non-empty strings" }],
          isError: true
        };
      }

      const sanitizedInvestorId = sanitizeString(investorId);
      const sanitizedConnectToInvestorId = sanitizeString(connectToInvestorId);
      const response = await createBaselineClient().put(`/investor/${sanitizedInvestorId}/connect/${sanitizedConnectToInvestorId}`, {});

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error connecting investors: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  },

  async disconnectInvestors(args: any) {
    try {
      validateRequiredArgs(args, ['investorId', 'disconnectFromInvestorId']);
      const { investorId, disconnectFromInvestorId } = args;

      if (typeof investorId !== 'string' || !investorId.trim() || typeof disconnectFromInvestorId !== 'string' || !disconnectFromInvestorId.trim()) {
        return {
          content: [{ type: "text", text: "Error: investorId and disconnectFromInvestorId must be non-empty strings" }],
          isError: true
        };
      }

      const sanitizedInvestorId = sanitizeString(investorId);
      const sanitizedDisconnectFromInvestorId = sanitizeString(disconnectFromInvestorId);
      const response = await createBaselineClient().delete(`/investor/${sanitizedInvestorId}/connect/${sanitizedDisconnectFromInvestorId}`);

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error disconnecting investors: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }
};

/* 5️⃣  Tool Definitions for MCP */

export const toolDefinitions = [
  {
    name: "getLoan",
    description: "Returns a loan including its address and borrower. Retrieves complete loan information including property details, borrower info, financial terms, status, dates, and metadata.",
    inputSchema: z.object({
      loanId: z.string().describe("The numerical ID of the loan to retrieve")
    }),
    annotations: {
      title: "Get Loan Details",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-a-loan"
      }
    }
  },
  {
    name: "listLoans",
    description: `Returns a list of all loans in your account. Only basic information about the loans is returned. For full records, see the getLoan tool.

This endpoint takes no parameters and returns all loans in the account with basic information (Id, Name, Status).

Returns: Object containing "loans" array with:
- Id: Unique loan identifier (string)
- Name: Property address or loan name (string) 
- Status: Current workflow status (string)

For complete loan details including financial terms and borrower information, use getLoan(loanId).`,
    inputSchema: z.object({}),
    annotations: {
      title: "Get All Loans",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-all-loans"
      }
    }
  },
  {
    name: "updateLoan",
    description: `Updates specific fields of an existing loan. Only the fields you specify will be modified.

Examples:
- updateLoan({loanId: "12345", updates: {Name: "123 Main St, New Property"}})
- updateLoan({loanId: "12345", updates: {Status: "underwriting", Borrower_Name: "John Doe"}})
- updateLoan({loanId: "12345", updates: {Loan_Amount: 350000, Rate: 0.065}})
- updateLoan({loanId: "12345", updates: {Address_City: "Miami", Address_State: "FL"}})

**Note**: The actual update endpoint may use PATCH /loan/{id} but this is not documented in the OpenAPI spec.`,
    inputSchema: z.object({
      loanId: z.string().describe("The numerical ID of the loan to update"),
      updates: z.object({
        Name: z.string().optional().describe("Property address or loan name"),
        Status: z.enum(["lead", "processing", "underwriting", "approved", "closed", "servicing", "archived"]).optional().describe("Loan workflow status"),
        Borrower_Name: z.string().optional().describe("Primary borrower's name"),
        Borrower_Email: z.string().optional().describe("Primary borrower's email address"),
        Address_Street1: z.string().optional().describe("Property street address"),
        Address_City: z.string().optional().describe("Property city"),
        Address_State: z.string().optional().describe("Property state"),
        Address_Zipcode: z.string().optional().describe("Property ZIP code"),
        Loan_Amount: z.number().optional().describe("Loan amount in dollars"),
        Rate: z.number().optional().describe("Interest rate as decimal (e.g., 0.065 for 6.5%)"),
        Origination: z.string().optional().describe("Loan origination date (YYYY-MM-DD)"),
        Maturity: z.string().optional().describe("Loan maturity date (YYYY-MM-DD)")
      }).describe("The specific loan fields to update based on available API fields")
    }),
    annotations: {
      title: "Update Loan",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/modify-loan"
      }
    }
  },
  {
    name: "createLoan",
    description: `Creates a new loan application. All fields are optional. Any field available in the default product in your account can be set via a body parameter using its name.

Examples:
- createLoan({Name: "123 Main St Property", Status: "lead", Borrower_Name: "John Doe"})
- createLoan({Name: "456 Oak Ave", Loan_Amount: 350000, Rate: 0.065, Borrower_Email: "john@example.com"})
- createLoan({Name: "789 Pine St", Address_City: "Miami", Address_State: "FL", Status: "lead"})
- createLoan({Borrower_Name: "Jane Smith", Borrower_Email: "jane@example.com", Loan_Amount: 275000})

Returns: Object containing complete loan details with all fields populated.`,
    inputSchema: z.object({
      Id: z.string().optional().describe("(Optional) If not set, an ID will be generated automatically"),
      Name: z.string().optional().describe("Property address or loan name"),
      Status: z.enum(["lead", "processing", "underwriting", "approved", "closed", "servicing", "archived"]).optional().describe("Loan workflow status (default: servicing)"),
      Borrower_Name: z.string().optional().describe("Primary borrower's name"),
      Borrower_Email: z.string().optional().describe("Primary borrower's email address - if borrower exists, will be attached to loan"),
      Borrower_Id: z.string().optional().describe("Primary borrower's ID - if borrower exists, will be attached to loan"),
      Address_Street1: z.string().optional().describe("Property street address"),
      Address_City: z.string().optional().describe("Property city"),
      Address_State: z.string().optional().describe("Property state"),
      Address_Zipcode: z.string().optional().describe("Property ZIP code"),
      Loan_Amount: z.number().optional().describe("Loan amount in dollars"),
      Rate: z.number().optional().describe("Interest rate as decimal (e.g., 0.065 for 6.5%)"),
      Origination: z.string().optional().describe("Loan origination date (YYYY-MM-DD)"),
      Maturity: z.string().optional().describe("Loan maturity date (YYYY-MM-DD)")
    }),
    annotations: {
      title: "Create Loan",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/create-a-new-loan"
      }
    }
  },
  {
    name: "getLoanLedger",
    description: "Returns the top 50 transactions in the ledger of the loan. Associated payment, person, trust and charge details are included in each record if applicable.",
    inputSchema: z.object({
      loanId: z.string().describe("The numerical ID of the loan to retrieve the ledger for")
    }),
    annotations: {
      title: "Get Loan Ledger",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-a-loans-ledger"
      }
    }
  },
  {
    name: "getTask",
    description: `Retrieves complete task information including task details, status, due date, and associated loan.

Example:
- getTask({taskId: "1234"})

Returns: Object containing complete task details:
- Id: Unique task identifier (string)
- Name: Task title (string)
- Description: Task description (string)
- Status: Task status - "To Do", "In Progress", "Done", "Not Required" (string)
- Date_Due: Due date in YYYY-MM-DD format (string)
- Loan_Id: Associated loan ID (string)
- Subtasks: Array of subtask objects with Done and Name fields`,
    inputSchema: z.object({
      taskId: z.string().describe("The numerical ID of the task to retrieve")
    }),
    annotations: {
      title: "Get Task Details",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-a-task"
      }
    }
  },
  {
    name: "listTasks",
    description: `Retrieves a list of all tasks with pagination support.

Examples:
- listTasks() - Get first page of all tasks
- listTasks({page: 2}) - Get second page of tasks

Returns: Object containing "tasks" array and pagination info:
- Id: Unique task identifier (string)
- Name: Task title (string)
- Description: Task description (string)
- Status: Task status - "To Do", "In Progress", "Done", "Not Required" (string)
- Date_Due: Due date in YYYY-MM-DD format (string)
- Loan_Id: Associated loan ID (string)
- Subtasks: Array of subtask objects with Done and Name fields`,
    inputSchema: z.object({
      page: z.number().optional().describe("Page number for pagination (default: 0)")
    }),
    annotations: {
      title: "Get All Tasks",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-all-tasks"
      }
    }
  },
  {
    name: "createTask",
    description: `Creates a new task. All fields are optional except task name.

Examples:
- createTask({Name: "Review credit score", Status: "To Do", Date_Due: "2024-12-31"})
- createTask({Name: "Process application", Description: "Review and process loan application", Loan_Id: "5678"})
- createTask({Name: "Contact borrower", Status: "In Progress", Subtasks: [{Name: "Send email", Done: false}]})

Returns: Object containing complete task details with all fields populated.`,
    inputSchema: z.object({
      Name: z.string().describe("Task title/name"),
      Description: z.string().optional().describe("Task description"),
      Date_Due: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      Status: z.enum(["To Do", "In Progress", "Done", "Not Required"]).optional().describe("Task status"),
      Loan_Id: z.string().optional().describe("ID of a loan to be associated with"),
      Subtasks: z.array(z.object({
        Name: z.string().describe("Subtask name"),
        Done: z.boolean().optional().describe("Whether subtask is completed")
      })).optional().describe("Array of subtask objects")
    }),
    annotations: {
      title: "Create Task",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/create-a-new-task"
      }
    }
  },
  {
    name: "updateTask",
    description: `Updates specific fields of an existing task. Only the fields you specify will be modified.

Examples:
- updateTask({taskId: "1234", updates: {Status: "Done"}})
- updateTask({taskId: "1234", updates: {Name: "Updated task name", Description: "New description"}})
- updateTask({taskId: "1234", updates: {Date_Due: "2024-12-31", Status: "In Progress"}})
- updateTask({taskId: "1234", updates: {Subtasks: [{Name: "New subtask", Done: false}]}})`,
    inputSchema: z.object({
      taskId: z.string().describe("The numerical ID of the task to update"),
      updates: z.object({
        Name: z.string().optional().describe("Task title/name"),
        Description: z.string().optional().describe("Task description"),
        Date_Due: z.string().optional().describe("Due date in YYYY-MM-DD format"),
        Status: z.enum(["To Do", "In Progress", "Done", "Not Required"]).optional().describe("Task status"),
        Loan_Id: z.string().optional().describe("ID of a loan to be associated with"),
        Subtasks: z.array(z.object({
          Name: z.string().describe("Subtask name"),
          Done: z.boolean().optional().describe("Whether subtask is completed")
        })).optional().describe("Array of subtask objects")
      }).describe("The specific task fields to update")
    }),
    annotations: {
      title: "Update Task",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/modify-existing-task"
      }
    }
  },
  {
    name: "deleteTask",
    description: "Deletes a task.",
    inputSchema: z.object({
      taskId: z.string().describe("The numerical ID of the task to delete")
    }),
    annotations: {
      title: "Delete Task",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/delete-a-task"
      }
    }
  },
  {
    name: "createBorrower",
    description: "Creates a new borrower.",
    inputSchema: z.object({
      borrowerData: z.object({
        Name: z.string().optional(),
        First_Name: z.string().optional(),
        Last_Name: z.string().optional(),
        Phone: z.string().optional(),
        Email: z.string().optional(),
        Date_Birth: z.string().optional().describe("YYYY-MM-DD"),
        Is_Company: z.boolean().optional(),
        Address_Street1: z.string().optional(),
        Address_Street2: z.string().optional(),
        Address_City: z.string().optional(),
        Address_State: z.string().optional(),
        Address_Country: z.string().optional()
      }).describe("Data for the new borrower.")
    }),
    annotations: {
      title: "Create Borrower",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/create-a-new-borrower"
      }
    }
  },
  {
    name: "listBorrowers",
    description: "Retrieves a list of all borrowers.",
    inputSchema: z.object({
      page: z.number().optional().describe("Page number for pagination (default: 0)")
    }),
    annotations: {
      title: "Get All Borrowers",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-all-borrowers"
      }
    }
  },
  {
    name: "getBorrower",
    description: "Retrieves a specific borrower by their ID.",
    inputSchema: z.object({
      borrowerId: z.string().describe("The ID of the borrower to retrieve.")
    }),
    annotations: {
      title: "Get Borrower",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-a-borrower"
      }
    }
  },
  {
    name: "updateBorrower",
    description: "Updates an existing borrower's information.",
    inputSchema: z.object({
      borrowerId: z.string().describe("The ID of the borrower to update."),
      updates: z.object({
        Name: z.string().optional(),
        First_Name: z.string().optional(),
        Last_Name: z.string().optional(),
        Phone: z.string().optional(),
        Date_Birth: z.string().optional().describe("YYYY-MM-DD"),
        Is_Company: z.boolean().optional(),
        Address_Street1: z.string().optional(),
        Address_Street2: z.string().optional(),
        Address_City: z.string().optional(),
        Address_State: z.string().optional(),
        Address_Country: z.string().optional()
      }).describe("The fields to update for the borrower.")
    }),
    annotations: {
      title: "Update Borrower",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/modify-borrower"
      }
    }
  },
  {
    name: "deleteBorrower",
    description: "Deletes a specific borrower by their ID.",
    inputSchema: z.object({
      borrowerId: z.string().describe("The ID of the borrower to delete.")
    }),
    annotations: {
      title: "Delete Borrower",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/delete-borrower"
      }
    }
  },
  {
    name: "connectBorrowers",
    description: "Connects a borrower to another borrower (e.g., a person to a company).",
    inputSchema: z.object({
      borrowerId: z.string().describe("The ID of the first borrower."),
      connectToBorrowerId: z.string().describe("The ID of the borrower to connect to.")
    }),
    annotations: {
      title: "Connect Borrowers",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/connect-borrowers"
      }
    }
  },
  {
    name: "disconnectBorrowers",
    description: "Disconnects a borrower from another borrower.",
    inputSchema: z.object({
      borrowerId: z.string().describe("The ID of the first borrower."),
      disconnectFromBorrowerId: z.string().describe("The ID of the borrower to disconnect from.")
    }),
    annotations: {
      title: "Disconnect Borrowers",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/disconnect-borrowers"
      }
    }
  },
  {
    name: "createVendor",
    description: "Creates a new vendor.",
    inputSchema: z.object({
      vendorData: z.object({
        Name: z.string().optional(),
        First_Name: z.string().optional(),
        Last_Name: z.string().optional(),
        Phone: z.string().optional(),
        Email: z.string().optional(),
        Date_Birth: z.string().optional().describe("YYYY-MM-DD"),
        Is_Company: z.boolean().optional(),
        Address_Street1: z.string().optional(),
        Address_Street2: z.string().optional(),
        Address_City: z.string().optional(),
        Address_State: z.string().optional(),
        Address_Country: z.string().optional()
      }).describe("Data for the new vendor.")
    }),
    annotations: {
      title: "Create Vendor",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/create-a-new-vendor"
      }
    }
  },
  {
    name: "listVendors",
    description: "Retrieves a list of all vendors.",
    inputSchema: z.object({
      page: z.number().optional().describe("Page number for pagination (default: 0)")
    }),
    annotations: {
      title: "Get All Vendors",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-all-vendors"
      }
    }
  },
  {
    name: "getVendor",
    description: "Retrieves a specific vendor by their ID.",
    inputSchema: z.object({
      vendorId: z.string().describe("The ID of the vendor to retrieve.")
    }),
    annotations: {
      title: "Get Vendor",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-a-vendor"
      }
    }
  },
  {
    name: "updateVendor",
    description: "Updates an existing vendor's information.",
    inputSchema: z.object({
      vendorId: z.string().describe("The ID of the vendor to update."),
      updates: z.object({
        Name: z.string().optional(),
        First_Name: z.string().optional(),
        Last_Name: z.string().optional(),
        Phone: z.string().optional(),
        Date_Birth: z.string().optional().describe("YYYY-MM-DD"),
        Is_Company: z.boolean().optional(),
        Address_Street1: z.string().optional(),
        Address_Street2: z.string().optional(),
        Address_City: z.string().optional(),
        Address_State: z.string().optional(),
        Address_Country: z.string().optional()
      }).describe("The fields to update for the vendor.")
    }),
    annotations: {
      title: "Update Vendor",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/modify-an-existing-vendor"
      }
    }
  },
  {
    name: "deleteVendor",
    description: "Deletes a specific vendor by their ID.",
    inputSchema: z.object({
      vendorId: z.string().describe("The ID of the vendor to delete.")
    }),
    annotations: {
      title: "Delete Vendor",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/delete-a-vendor"
      }
    }
  },
  {
    name: "connectVendors",
    description: "Connects a vendor to another vendor (e.g., a person to a company).",
    inputSchema: z.object({
      vendorId: z.string().describe("The ID of the first vendor."),
      connectToVendorId: z.string().describe("The ID of the vendor to connect to.")
    }),
    annotations: {
      title: "Connect Vendors",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/connect-a-vendor-to-another-vendor"
      }
    }
  },
  {
    name: "disconnectVendors",
    description: "Disconnects a vendor from another vendor.",
    inputSchema: z.object({
      vendorId: z.string().describe("The ID of the first vendor."),
      disconnectFromVendorId: z.string().describe("The ID of the vendor to disconnect from.")
    }),
    annotations: {
      title: "Disconnect Vendors",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/delete-connection-vendor-from-another-vendor"
      }
    }
  },
  {
    name: "createInvestor",
    description: "Creates a new investor.",
    inputSchema: z.object({
      investorData: z.object({
        Name: z.string().optional(),
        First_Name: z.string().optional(),
        Last_Name: z.string().optional(),
        Phone: z.string().optional(),
        Email: z.string().optional(),
        Date_Birth: z.string().optional().describe("YYYY-MM-DD"),
        Is_Company: z.boolean().optional(),
        Address_Street1: z.string().optional(),
        Address_Street2: z.string().optional(),
        Address_City: z.string().optional(),
        Address_State: z.string().optional(),
        Address_Country: z.string().optional()
      }).describe("Data for the new investor.")
    }),
    annotations: {
      title: "Create Investor",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/create-a-new-investor"
      }
    }
  },
  {
    name: "listInvestors",
    description: "Retrieves a list of all investors.",
    inputSchema: z.object({
      page: z.number().optional().describe("Page number for pagination (default: 0)")
    }),
    annotations: {
      title: "Get All Investors",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-all-investor"
      }
    }
  },
  {
    name: "getInvestor",
    description: "Retrieves a specific investor by their ID.",
    inputSchema: z.object({
      investorId: z.string().describe("The ID of the investor to retrieve.")
    }),
    annotations: {
      title: "Get Investor",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/get-an-investor"
      }
    }
  },
  {
    name: "updateInvestor",
    description: "Updates an existing investor's information.",
    inputSchema: z.object({
      investorId: z.string().describe("The ID of the investor to update."),
      updates: z.object({
        Name: z.string().optional(),
        First_Name: z.string().optional(),
        Last_Name: z.string().optional(),
        Phone: z.string().optional(),
        Date_Birth: z.string().optional().describe("YYYY-MM-DD"),
        Is_Company: z.boolean().optional(),
        Address_Street1: z.string().optional(),
        Address_Street2: z.string().optional(),
        Address_City: z.string().optional(),
        Address_State: z.string().optional(),
        Address_Country: z.string().optional()
      }).describe("The fields to update for the investor.")
    }),
    annotations: {
      title: "Update Investor",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/modify-an-existing-investor"
      }
    }
  },
  {
    name: "deleteInvestor",
    description: "Deletes a specific investor by their ID.",
    inputSchema: z.object({
      investorId: z.string().describe("The ID of the investor to delete.")
    }),
    annotations: {
      title: "Delete Investor",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/delete-an-investor"
      }
    }
  },
  {
    name: "connectInvestors",
    description: "Connects an investor to another investor (e.g., a person to a company).",
    inputSchema: z.object({
      investorId: z.string().describe("The ID of the first investor."),
      connectToInvestorId: z.string().describe("The ID of the investor to connect to.")
    }),
    annotations: {
      title: "Connect Investors",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/connect-a-investor-to-another-investor"
      }
    }
  },
  {
    name: "disconnectInvestors",
    description: "Disconnects an investor from another investor.",
    inputSchema: z.object({
      investorId: z.string().describe("The ID of the first investor."),
      disconnectFromInvestorId: z.string().describe("The ID of the investor to disconnect from.")
    }),
    annotations: {
      title: "Disconnect Investors",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      "baselinesoftware.com/apiDocumentation": {
        "value": "https://baselinesoftware.readme.io/reference/delete-investor-connections-from-another-investor"
      }
    }
  }
]; 