import { WarEraAPI } from './src/api.js';

async function run() {
    const api = new WarEraAPI();
    const deRes: any = await api.getCountry("6813b6d446e731854c7ac79c");
    const data = deRes.result?.data || deRes;
    console.log(JSON.stringify(data, null, 2));
}
run().catch(console.error);
