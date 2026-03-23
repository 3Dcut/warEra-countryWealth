const BASE_URL = "https://api2.warera.io/trpc";

export class WarEraAPI {
  private apiKey: string = "";
  public onRateLimit?: (ms: number) => void;
  public onDelayChange?: (ms: number) => void;

  public currentDelayMs: number = 20; // Start-Verzögerung pro Request
  private queuePromise: Promise<void> = Promise.resolve();
  private isWaitingFor429 = false;

  constructor(apiKey: string = "") {
    this.apiKey = apiKey;
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitForTurn() {
    const prevPromise = this.queuePromise;
    let resolveQueue!: () => void;
    this.queuePromise = new Promise(resolve => { resolveQueue = resolve; });
    
    await prevPromise;
    
    while (this.isWaitingFor429) {
      await this.sleep(100);
    }

    setTimeout(resolveQueue, this.currentDelayMs);
  }

  private async fetchAPI(endpoint: string, inputParams: any = null, retries = 5): Promise<any> {
    
    let url = `${BASE_URL}/${endpoint}`;
    if (inputParams) {
      url += `?input=${encodeURIComponent(JSON.stringify(inputParams))}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
      headers["x-api-key"] = this.apiKey;
    }

    // Stelle sicher, dass wir an der Reihe sind und warten unser dynamisches Delay ab
    await this.waitForTurn();

    try {
      const response = await fetch(url, { method: "GET", headers });
      
      if (response.status === 429) {
        // Massive Erhöhung des Delays zur Strafe und Vermeidung weiterer 429
        this.currentDelayMs = Math.min(this.currentDelayMs * 1.5 + 200, 10000);
        if (this.onDelayChange) this.onDelayChange(this.currentDelayMs);

        if (retries > 0) {
          console.warn(`429 Too Many Requests for ${endpoint}. Waiting... Neues Base-Delay: ${Math.round(this.currentDelayMs)}ms`);
          
          let waitTime = 5000;
          const retryAfterStr = response.headers.get('Retry-After');
          if (retryAfterStr) {
            const parsed = parseInt(retryAfterStr, 10);
            if (!isNaN(parsed)) waitTime = parsed * 1000;
          }

          if (this.onRateLimit) {
            this.onRateLimit(waitTime);
          }

          // Pausiere alle anderen, auf die Queue wartenden Requests
          this.isWaitingFor429 = true;
          await this.sleep(waitTime);
          this.isWaitingFor429 = false;

          return this.fetchAPI(endpoint, inputParams, retries - 1);
        }
        throw new Error("Ratenlimit dauerhaft überschritten. Bitte API-Key verwenden oder später versuchen.");
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Bei Erfolg: Delay minimal absenken (belohnen), damit wir wieder schneller werden
      if (this.currentDelayMs > 0) {
        this.currentDelayMs = Math.max(0, this.currentDelayMs - 1);
        if (this.onDelayChange) this.onDelayChange(this.currentDelayMs);
      }

      const raw = await response.json();
      return raw?.result?.data || raw;
    } catch (err: any) {
      if (retries > 0) {
        console.warn(`Error compiling ${endpoint}: ${err.message}. Retrying...`);
        await this.sleep(2000);
        return this.fetchAPI(endpoint, inputParams, retries - 1);
      }
      throw err;
    }
  }

  // --- Endpoints ---

  async getCountry(countryId: string) {
    return this.fetchAPI("country.getCountryById", { countryId });
  }

  async getAllCountries() {
    return this.fetchAPI("country.getAllCountries", {});
  }

  async getUsersByCountry(countryId: string, cursor?: string) {
    const params: any = { countryId, limit: 100 };
    if (cursor) params.cursor = cursor;
    return this.fetchAPI("user.getUsersByCountry", params);
  }

  async getRanking(rankingType: string) {
    return this.fetchAPI("ranking.getRanking", { rankingType });
  }

  async getUserLite(userId: string) {
    return this.fetchAPI("user.getUserLite", { userId });
  }

  async getCompanies(userId: string) {
    return this.fetchAPI("company.getCompanies", { userId, perPage: 100, direction: "forward" });
  }

  async getCompany(companyId: string) {
    return this.fetchAPI("company.getById", { companyId });
  }
}
