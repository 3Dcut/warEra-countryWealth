async function run() {
    // testing a single user to see structure
    const lRes = await fetch("https://api2.warera.io/trpc/user.getUserLite?input=" + encodeURIComponent(JSON.stringify({userIds: ["69bc474bea445d4a1936c646"]})));
    const lData = await lRes.json();
    console.log(JSON.stringify(lData, null, 2));
}
run().catch(console.error);
