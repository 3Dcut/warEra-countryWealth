async function run() {
    const allRes = await fetch("https://api2.warera.io/trpc/country.getAllCountries?input=" + encodeURIComponent(JSON.stringify({})));
    const allData = await allRes.json();
    const l = allData.result.data.find(c => c.name === 'Liechtenstein');
    if (!l) return console.log("Liechtenstein not found");
    
    const lRes = await fetch("https://api2.warera.io/trpc/country.getCountryById?input=" + encodeURIComponent(JSON.stringify({countryId: l._id})));
    const lData = await lRes.json();
    console.log(JSON.stringify(lData, null, 2));
}
run().catch(console.error);
