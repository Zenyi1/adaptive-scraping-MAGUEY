const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const csvWriter = require('csv-writer').createObjectCsvWriter;

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto('https://www.google.co.uk/maps/search/liquor+store/@33.511987,-112.1552963,10z?entry=ttu&g_ep=EgoyMDI1MDIwOS4wIKXMDSoASAFQAw%3D%3D');

    // Handle cookie consent dialog
    try {
        await page.click('button[aria-label="Reject all"]'); // Adjust the selector as needed
    } catch (error) {
        console.log('No cookie consent dialog found');
    }

    const targetText = "You've reached the end of the list."; // Corrected typo

    // Wait for the element to be present
    await page.waitForSelector('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]', { timeout: 10000 });

    await page.evaluate(async (targetText) => {
        const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (element) {
            console.log('Element found, starting to scroll...');
            while (!element.innerText.includes(targetText)) {
                element.scrollBy(0, 500); // Adjust the scroll amount as needed
                console.log('Scrolling...'); // Log when it scrolls
                await new Promise(resolve => setTimeout(resolve, 300)); // Adjust the delay as needed
            }
            console.log('Reached the end of the list.');
        } else {
            console.error('Element not found');
        }
    }, targetText);

    // Wait for content to load
    await page.waitForTimeout(400);

    // Extract and log the number of URLs found on the page
    const urls = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a');
        return Array.from(anchors).map(anchor => anchor.href);
    });

    console.log('Number of URLs found:', urls.length);
    console.log('URLs:', urls);

    // Prepare CSV writer
    const writer = csvWriter({
        path: path.join(__dirname, 'output.csv'),
        header: [
            { id: 'title', title: 'Title' },
            { id: 'address', title: 'Address' },
            { id: 'website', title: 'Website' },
            { id: 'phone', title: 'Phone' }
        ]
    });

    const records = [];

    // Visit each URL and extract address and title
    for (const url of urls) {
        await page.goto(url);

        // Extract address using the third XPath
        const address = await page.evaluate(() => {
            const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[9]/div[3]/button/div/div[2]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            return element ? element.innerText : 'Address not found';
        });

        // Extract title using the correct XPath
        const title = await page.evaluate(() => {
            const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[2]/div/div[1]/div[1]/h1', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            return element ? element.innerText : 'Title not found';
        });

        const websiteEelements = await page.$$('a[data-tooltip="Open website"]') || await page.$$('a[data-tooltip="Open menu link"]');
        let website = '';
        if (websiteEelements.length > 0) {
            website = await page.evaluate(element => element.getAttribute('href'), websiteEelements[0]);
        }

        const phoneElements = await page.$$('button[data-tooltip="Copy phone number"]');
        let phone = '';
        if (phoneElements.length > 0) {
            phone = await page.evaluate(element => element.textContent, phoneElements[0]);
        }

        console.log(`URL: ${url}`);
        console.log(`Address: ${address}`);
        console.log(`Title: ${title}`);
        console.log(`Website: ${website}`);
        console.log(`Phone: ${phone}`);

        records.push({ title, address, website, phone });
    }

    // Write records to CSV
    await writer.writeRecords(records);
    console.log('Data saved to output.csv');

    await browser.close();
})();