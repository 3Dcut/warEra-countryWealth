const BASE_URL = "https://api2.warera.io/trpc";

export class WarEraAPI {
  private keys: string[];
  private currentKeyIdx = 0;
  private rateLimitedUntil: number[] = [0, 0];
  public onRateLimit?: (ms: number) => void;

  constructor(apiKey1: string = "", apiKey2: string = "") {
    this.keys = [apiKey1, apiKey2];
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async fetchAPI(endpoint: string, inputParams: any = null, retries = 5): Promise<any> {
    let url = `${BASE_URL}/${endpoint}`;
    if (inputParams) {
      url += `?input=${encodeURIComponent(JSON.stringify(inputParams))}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    const activeKey = this.keys[this.currentKeyIdx];
    if (activeKey) {
      headers["Authorization"] = `Bearer ${activeKey}`;
      headers["x-api-key"] = activeKey;
    }

    try {
      const response = await fetch(url, { method: "GET", headers });

      if (response.status === 429) {
        if (retries > 0) {
          this.rateLimitedUntil[this.currentKeyIdx] = Date.now() + 5000;
          const otherIdx = 1 - this.currentKeyIdx;

          if (this.rateLimitedUntil[otherIdx] > Date.now()) {
            // Beide Keys gesperrt — auf den frühesten warten
            const waitMs = Math.max(1, Math.min(this.rateLimitedUntil[0], this.rateLimitedUntil[1]) - Date.now());
            console.warn(`Beide Keys rate-limited. Warte ${waitMs}ms...`);
            if (this.onRateLimit) this.onRateLimit(waitMs);
            await this.sleep(waitMs);
          } else {
            // Zum anderen Key wechseln, sofort weiter
            console.warn(`429 auf Key ${this.currentKeyIdx + 1}, wechsle zu Key ${otherIdx + 1}.`);
            this.currentKeyIdx = otherIdx;
          }

          return this.fetchAPI(endpoint, inputParams, retries - 1);
        }
        throw new Error("Ratenlimit dauerhaft überschritten. Bitte API-Key verwenden oder später versuchen.");
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const raw = await response.json();
      return raw?.result?.data || raw;
    } catch (err: any) {
      if (retries > 0) {
        console.warn(`Error fetching ${endpoint}: ${err.message}. Retrying...`);
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

  async getUserById(userId: string) {
    return this.fetchAPI("user.getUserById", { userId });
  }

  async getCompanies(userId: string) {
    return this.fetchAPI("company.getCompanies", { userId, perPage: 100, direction: "forward" });
  }

  async getCompany(companyId: string) {
    return this.fetchAPI("company.getById", { companyId });
  }
}
