const BASE_URL = "https://api2.warera.io/trpc";

export class WarEraAPI {
  private apiKey: string = "";
  public onRateLimit?: (ms: number) => void;
  public onDelayChange?: (ms: number) => void;

  public currentDelayMs: number = 650;
  public current429WaitTime: number = 5000;
  private queuePromise: Promise<void> = Promise.resolve();
  private isWaitingFor429 = false;

  constructor(apiKey: string = "") {
    this.apiKey = apiKey;
    // 1000/min = ~16 req/s => 60ms delay. Wir nutzen 65ms für etwas Puffer.
    // 100/min = ~1.6 req/s => 600ms delay. Wir nutzen 650ms für etwas Puffer.
    this.currentDelayMs = apiKey ? 65 : 650;
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

    // Exakter Zeittakt
    await this.waitForTurn();

    try {
      const response = await fetch(url, { method: "GET", headers });
      
      if (response.status === 429) {
        if (retries > 0) {
          console.warn(`429 Too Many Requests for ${endpoint}. Waiting...`);
          
          let waitTime = this.current429WaitTime;
          const retryAfterStr = response.headers.get('Retry-After');
          if (retryAfterStr) {
            const parsed = parseInt(retryAfterStr, 10);
            if (!isNaN(parsed)) waitTime = parsed * 1000;
          }

          // Erhöhe die Strafe für das nächste 429-Event (max 30 Sekunden)
          this.current429WaitTime = Math.min(this.current429WaitTime + 5000, 30000);

          if (this.onRateLimit) {
            this.onRateLimit(waitTime);
          }

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

      // Bei Erfolg: Die 429-Strafe entspannt sich langsam wieder (min 5 Sekunden)
      if (this.current429WaitTime > 5000) {
        this.current429WaitTime = Math.max(5000, this.current429WaitTime - 1000);
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
