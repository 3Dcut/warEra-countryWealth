const BASE_URL = "https://api2.warera.io/trpc";

export class WarEraAPI {
  private apiKey: string = "";
  
  // Rate limiting properties
  private requestDelayMs: number = 200;
  private lastRequestTime: number = 0;

  constructor(apiKey: string = "") {
    this.apiKey = apiKey;
    if (!this.apiKey) {
      // Slower delay when no token is used to avoid 429
      this.requestDelayMs = 1500;
    }
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async rateLimit() {
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.requestDelayMs) {
      await this.sleep(this.requestDelayMs - timeSinceLast);
    }
    this.lastRequestTime = Date.now();
  }

  private async fetchAPI(endpoint: string, inputParams: any = null, retries = 3): Promise<any> {
    await this.rateLimit();
    
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

    try {
      const response = await fetch(url, { method: "GET", headers });
      
      if (response.status === 429) {
        if (retries > 0) {
          console.warn(`429 Too Many Requests for ${endpoint}. Waiting...`);
          await this.sleep(5000); // Wait 5 seconds on 429
          return this.fetchAPI(endpoint, inputParams, retries - 1);
        }
        throw new Error("Rate limit exceeded persistently.");
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
