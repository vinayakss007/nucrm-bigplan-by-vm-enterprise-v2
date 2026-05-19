export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any) => void;
}

const defaultShouldRetry = (error: any): boolean => {
  if (!error) return false;
  const status = error.status || error.statusCode;
  if (status === 429 || status === 503) return true;
  if (status >= 500) return true;
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
  return false;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt === maxRetries) {
        break;
      }

      if (!shouldRetry(error)) {
        throw error;
      }

      if (onRetry) {
        onRetry(attempt + 1, error);
      }

      const waitTime = Math.min(delay, maxDelay);
      await sleep(waitTime);
      delay *= backoffMultiplier;
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  context: string = 'operation'
): Promise<T> {
  return withRetry(fn, {
    maxRetries: 4,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    onRetry: (attempt, error) => {
      console.log(`[Retry] ${context} - Attempt ${attempt} failed:`, error.message);
    },
  });
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailure: Date | null = null;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold = 5,
    private timeout = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.lastFailure && Date.now() - this.lastFailure.getTime() > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = new Date();

      if (this.failures >= this.threshold) {
        this.state = 'open';
      }

      throw error;
    }
  }

  getState() {
    return this.state;
  }

  reset() {
    this.failures = 0;
    this.state = 'closed';
    this.lastFailure = null;
  }
}